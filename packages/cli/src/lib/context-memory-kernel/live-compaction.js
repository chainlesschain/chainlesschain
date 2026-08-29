import { randomUUID } from "node:crypto";
import {
  canonicalDigest,
  InMemorySessionContextPort,
} from "@chainlesschain/context-memory-kernel";
import { sessionExists } from "../../harness/jsonl-session-store.js";
import {
  contextItemsToMessages,
  createSummaryContextItem,
  messagesToContextItems,
} from "./message-adapter.js";
import { JsonlSessionContextPort } from "./jsonl-session-context-port.js";
import { createCliContextMemoryRuntime } from "./runtime.js";

function estimatedTokens(messages) {
  return Math.max(
    0,
    (Array.isArray(messages) ? messages : []).reduce((total, message) => {
      const content =
        typeof message?.content === "string"
          ? message.content
          : JSON.stringify(message?.content ?? "");
      return total + Math.max(1, Math.ceil(Buffer.byteLength(content, "utf8") / 4));
    }, 0),
  );
}

function compactionStats(event, outputMessages, summaryStats, trigger) {
  const originalMessages = Number(event.metadata?.inputMessageCount) || 0;
  const originalTokens = Number(event.metadata?.originalTokens) || 0;
  const compressedTokens = event.outputItems.reduce(
    (total, item) => total + item.tokenEstimate,
    0,
  );
  return {
    ...(summaryStats || {}),
    strategy: event.strategy,
    trigger,
    originalMessages,
    compressedMessages: outputMessages.length,
    originalTokens,
    compressedTokens,
    saved: Math.max(0, originalTokens - compressedTokens),
    canonical: event,
    canonicalAlreadySettled: true,
  };
}

class CallbackSessionContextPort extends InMemorySessionContextPort {
  constructor({
    sessionId,
    messages,
    memoryRevision,
    commit,
    trigger,
    summaryStats,
    head,
    physicalAuthority,
  }) {
    const initialHead =
      head ||
      canonicalDigest(
        { sessionId, messages },
        "chainlesschain.cli-live-session-head/v1",
      );
    super([
      {
        sessionId,
        head: initialHead,
        memoryRevision,
        items: messagesToContextItems(messages, { sessionId }),
      },
    ]);
    this.commit = commit;
    this.expectedMessages = [...messages];
    this.trigger = trigger;
    this.summaryStats = summaryStats;
    this.physicalAuthority = physicalAuthority === true;
  }

  async appendCompaction(event, expectedHead) {
    const snapshot = await this.readSnapshot(event.sessionId);
    if (!snapshot || snapshot.head !== expectedHead) {
      return { ok: false, currentHead: snapshot?.head || null };
    }
    const outputMessages = contextItemsToMessages(event.outputItems);
    const stats = compactionStats(
      event,
      outputMessages,
      this.summaryStats(),
      this.trigger,
    );
    const result = await this.commit(stats, outputMessages, {
      expectedMessages: this.expectedMessages,
      liveExpectedMessages: this.expectedMessages,
      trigger: this.trigger,
    });
    if (result === false || result?.ok === false || result?.stale === true) {
      return { ok: false, currentHead: result?.currentHead || null };
    }
    const inMemory = await super.appendCompaction(event, expectedHead);
    const physicalHead =
      result?.newHead || result?.headHash || result?.hash || null;
    if (this.physicalAuthority && !physicalHead) {
      const error = new Error(
        "canonical compaction settlement did not return its durable head",
      );
      error.code = "CC_COMPACTION_SETTLEMENT_HEAD_UNKNOWN";
      error.outcomeUnknown = true;
      throw error;
    }
    if (!physicalHead) return inMemory;
    const state = this.sessions.get(event.sessionId);
    if (state) state.head = physicalHead;
    const receipt = this.operations.get(event.operationId);
    if (receipt) {
      receipt.newHead = physicalHead;
      receipt.digest = canonicalDigest(
        receipt,
        "chainlesschain.compaction-receipt/v1",
      );
    }
    return { ok: true, newHead: physicalHead };
  }
}

function kernelBudget(compressor) {
  const inputBudget = Math.max(256, Math.trunc(Number(compressor?.maxTokens)) || 16_384);
  const reservedOutputTokens = Math.max(1, Math.min(2048, Math.floor(inputBudget / 10)));
  return {
    modelWindowTokens: inputBudget + reservedOutputTokens,
    reservedOutputTokens,
    safetyMarginTokens: 0,
    recoveryReserveTokens: Math.min(256, Math.max(1, Math.floor(inputBudget * 0.05))),
  };
}

function usageReceipt(stats, provider, model) {
  if (stats?.summaryUsageUnknown === true) {
    const error = new Error(
      stats.summaryUsageUnknownReason || "semantic compaction usage is unknown",
    );
    error.code = "reconciliation_required";
    error.outcomeUnknown = true;
    throw error;
  }
  const callId = stats?.summaryCallId;
  if (!callId) return { outcome: "not_metered" };
  if (stats.summaryUsageLedgerSettled !== true || !stats.summaryUsage) {
    const error = new Error("semantic compaction usage ledger is unsettled");
    error.code = "provider_usage_unsettled";
    error.outcomeUnknown = true;
    throw error;
  }
  return {
    outcome: "settled",
    callId,
    ...(stats.summaryProvider || provider
      ? { provider: stats.summaryProvider || provider }
      : {}),
    ...(stats.summaryModel || model
      ? { model: stats.summaryModel || model }
      : {}),
    inputTokens: stats.summaryUsage.inputTokens || 0,
    outputTokens: stats.summaryUsage.outputTokens || 0,
    ledgerDigest: canonicalDigest(
      { callId, usage: stats.summaryUsage },
      "chainlesschain.cli-live-compaction-usage/v1",
    ),
  };
}

/**
 * Canonical live compaction. PromptCompressor is used only as a bounded
 * summarizer for the Kernel-selected dropped partition; it cannot commit or
 * choose the authoritative output on its own.
 */
export async function compactLiveMessagesCanonical(messagesInput, options = {}) {
  const messages = Array.isArray(messagesInput) ? [...messagesInput] : [];
  const sessionId = String(options.sessionId || `live-${randomUUID()}`);
  const operationId = String(options.operationId || `compact-${randomUUID()}`);
  const trigger = options.trigger || "auto";
  const operationNow =
    options.now ||
    new Date(Number((options.clock || Date.now)())).toISOString();
  const compressor = options.compressor;
  if (!compressor || typeof compressor.compress !== "function") {
    throw new TypeError("canonical live compaction requires a compatibility summarizer");
  }

  let summaryStats = null;
  let runtime;
  let verifiedAuthoritySnapshot = null;
  const persistentSession =
    options.persist !== false &&
    Boolean(options.sessionId) &&
    sessionExists(sessionId);
  if (typeof options.commit === "function") {
    const bootstrapRuntime = createCliContextMemoryRuntime({
      sessionId,
      scopeKey: `cli:session:${sessionId}`,
      env: options.env,
      clock: options.clock,
      memoryFilePath: options.memoryFilePath,
    });
    if (persistentSession) {
      verifiedAuthoritySnapshot = await new JsonlSessionContextPort({
        sessionId,
      }).readSnapshot(sessionId);
    }
    const sessionPort = new CallbackSessionContextPort({
      sessionId,
      messages,
      memoryRevision: await bootstrapRuntime.memoryPort.getRevision(),
      commit: options.commit,
      trigger,
      summaryStats: () => summaryStats,
      ...(verifiedAuthoritySnapshot?.head
        ? { head: verifiedAuthoritySnapshot.head, physicalAuthority: true }
        : {}),
    });
    runtime = createCliContextMemoryRuntime({
      sessionId,
      scopeKey: `cli:session:${sessionId}`,
      env: options.env,
      clock: options.clock,
      memoryPort: bootstrapRuntime.memoryPort,
      sessionPort,
    });
  } else if (
    persistentSession
  ) {
    runtime = createCliContextMemoryRuntime({
      sessionId,
      scopeKey: `cli:session:${sessionId}`,
      env: options.env,
      clock: options.clock,
      memoryFilePath: options.memoryFilePath,
    });
  } else {
    const bootstrapRuntime = createCliContextMemoryRuntime({
      scopeKey: `cli:session:${sessionId}`,
      env: options.env,
      clock: options.clock,
      memoryFilePath: options.memoryFilePath,
    });
    const sessionPort = new InMemorySessionContextPort([
      {
        sessionId,
        head: canonicalDigest(
          { sessionId, messages },
          "chainlesschain.cli-live-session-head/v1",
        ),
        memoryRevision: await bootstrapRuntime.memoryPort.getRevision(),
        items: messagesToContextItems(messages, { sessionId }),
      },
    ]);
    runtime = createCliContextMemoryRuntime({
      sessionId,
      scopeKey: `cli:session:${sessionId}`,
      env: options.env,
      clock: options.clock,
      memoryPort: bootstrapRuntime.memoryPort,
      sessionPort,
    });
  }
  if (!runtime.decision.canonical) {
    const error = new Error("canonical live compaction is not authoritative for this cohort");
    error.code = "legacy_writer_fenced";
    throw error;
  }
  if (
    persistentSession
  ) {
    const authority =
      verifiedAuthoritySnapshot ||
      (await runtime.sessionPort.readSnapshot(sessionId));
    const inputItems = messagesToContextItems(messages, { sessionId });
    const inputDigest = canonicalDigest(
      inputItems.map((item) => item.digest),
      "chainlesschain.cli-live-message-set/v1",
    );
    const authorityDigest = canonicalDigest(
      authority.items.map((item) => item.digest),
      "chainlesschain.cli-live-message-set/v1",
    );
    if (inputDigest !== authorityDigest) {
      const error = new Error(
        "live messages do not match the verified session authority",
      );
      error.code = "SESSION_REVISION_STALE";
      throw error;
    }
  }

  const provider = options.provider || "provider.local";
  const model = options.model || "default";
  const memoryRevision = await runtime.memoryPort.getRevision();
  const receipt = await runtime.kernel.compactContext({
    operationId,
    sessionId,
    ...kernelBudget(compressor),
    sink: provider,
    scopeAdmissions: [{ scope: "session", scopeId: sessionId }],
    policyVersion: "cli-context-policy-v1",
    modelProfile: model,
    memoryRevision,
    allowFallback: false,
    now: operationNow,
    metadata: {
      inputMessageCount: messages.length,
      originalTokens: estimatedTokens(messages),
      trigger,
      provider,
      model,
    },
    summarizer: async (droppedItems, context) => {
      const droppedMessages = contextItemsToMessages(droppedItems);
      const result = await compressor.compress(droppedMessages, {
        preserveToolPairs: true,
        ...(options.compressOptions || {}),
      });
      summaryStats = result.stats || {};
      const reduced =
        Number(summaryStats.saved || 0) > 0 ||
        result.messages.length < droppedMessages.length;
      const item = reduced
        ? createSummaryContextItem({
            messages: result.messages,
            parents: droppedItems,
            operationId: context.operationId,
            now: operationNow,
          })
        : null;
      return {
        items: item ? [item] : [],
        usageReceipt: usageReceipt(summaryStats, provider, model),
        degraded: summaryStats.degraded === true,
        ...(summaryStats.degradedReason
          ? { degradedReason: String(summaryStats.degradedReason).slice(0, 160) }
          : {}),
      };
    },
  });
  if (!["committed", "degraded"].includes(receipt.status)) {
    return {
      messages,
      stats: {
        ...(summaryStats || {}),
        strategy: "none",
        saved: 0,
        canonicalAlreadySettled: true,
        canonicalReceipt: receipt,
      },
      receipt,
    };
  }
  const snapshot = await runtime.sessionPort.readSnapshot(sessionId);
  const outputMessages = contextItemsToMessages(snapshot.items);
  return {
    messages: outputMessages,
    stats: {
      ...(summaryStats || {}),
      strategy: receipt.status === "degraded" ? "deterministic-fallback" : "canonical",
      originalMessages: messages.length,
      compressedMessages: outputMessages.length,
      originalTokens: estimatedTokens(messages),
      compressedTokens: estimatedTokens(outputMessages),
      saved: Math.max(0, estimatedTokens(messages) - estimatedTokens(outputMessages)),
      canonicalAlreadySettled: true,
      canonicalReceipt: receipt,
    },
    receipt,
  };
}
