import { randomUUID } from "node:crypto";
import {
  canonicalDigest,
  InMemorySessionContextPort,
  getCompactionPlanRejection,
} from "@chainlesschain/context-memory-kernel";
import { sessionExists } from "../../harness/jsonl-session-store.js";
import {
  contextItemsToMessages,
  createSummaryContextItem,
  messagesToContextItems,
} from "./message-adapter.js";
import { JsonlSessionContextPort } from "./jsonl-session-context-port.js";
import { createCliContextMemoryRuntime } from "./runtime.js";
import { imageTransportEstimate } from "../image-token-estimate.js";
import { projectRuntimeTokenUsage } from "../runtime-usage-ledger.js";
import { isCompactionHostBase } from "../compaction-host-provenance.js";
import {
  projectCanonicalResumeMessages,
  getDurableSystemMessageProvenance,
  isRuntimeOnlySessionMessage,
} from "../session-message-provenance.js";

const rejectedCompactionUsage = new WeakMap();

// Only the owned canonical adapter can associate an error with its completed
// summarizer. A caller-supplied error property is never a settlement authority.
export function getRejectedCompactionUsage(error) {
  return error && typeof error === "object"
    ? rejectedCompactionUsage.get(error) || null
    : null;
}

function estimatedTokens(messages) {
  return Math.max(
    0,
    (Array.isArray(messages) ? messages : []).reduce((total, message) => {
      const content =
        typeof message?.content === "string"
          ? message.content
          : JSON.stringify(message?.content ?? "");
      const image = imageTransportEstimate([message]);
      return (
        total +
        Math.max(
          1,
          Math.ceil((Buffer.byteLength(content, "utf8") - image.bytes) / 4) +
            image.tokens,
        )
      );
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
    allowExternalization = false,
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
        items: messagesToContextItems(messages, {
          sessionId,
          allowExternalization,
        }),
      },
    ]);
    this.commit = commit;
    this.sessionId = sessionId;
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
    const outputMessages = contextItemsToMessages(event.outputItems, {
      sessionId: this.sessionId,
    });
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

function kernelBudget(compressor, ephemeralTokens = 0, messages = []) {
  const inputBudget = Math.max(
    256,
    Math.trunc(
      Number(
        compressor?.getCompactionTokenBudget?.(messages) ??
          compressor?.maxTokens,
      ),
    ) || 16_384,
  );
  const reservedOutputTokens = Math.max(
    1,
    Math.min(2048, Math.floor(inputBudget / 10)),
  );
  return {
    modelWindowTokens: inputBudget + reservedOutputTokens,
    reservedOutputTokens,
    // Live host policy/retry text still consumes the provider window even
    // though it is deliberately absent from the durable authority partition.
    safetyMarginTokens: ephemeralTokens,
    recoveryReserveTokens: Math.min(
      256,
      Math.max(1, Math.floor(inputBudget * 0.05)),
    ),
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
export async function compactLiveMessagesCanonical(
  messagesInput,
  options = {},
) {
  const liveMessages = Array.isArray(messagesInput) ? [...messagesInput] : [];
  const sessionId = String(options.sessionId || `live-${randomUUID()}`);
  const operationId = String(options.operationId || `compact-${randomUUID()}`);
  const trigger = options.trigger || "auto";
  const operationNow =
    options.now ||
    new Date(Number((options.clock || Date.now)())).toISOString();
  const compressor = options.compressor;
  if (!compressor || typeof compressor.compress !== "function") {
    throw new TypeError(
      "canonical live compaction requires a compatibility summarizer",
    );
  }

  let summaryStats = null;
  let summaryReceipt = null;
  let runtime;
  let verifiedAuthoritySnapshot = null;
  const persistentSession =
    options.persist !== false &&
    Boolean(options.sessionId) &&
    sessionExists(sessionId);
  // Host policy is live-only. Durable summary/lineage systems retain their
  // private provenance and remain part of the exact authority comparison.
  // Unsaved sessions have no durable host projection: only privately admitted
  // live bases/nudges may bypass the planner, never arbitrary system messages.
  const messages = persistentSession
    ? projectCanonicalResumeMessages(liveMessages, { strict: true })
    : liveMessages.filter(
        (message) =>
          !isCompactionHostBase(message) &&
          !isRuntimeOnlySessionMessage(message),
      );
  const ephemeralMessages = [];
  {
    let sequence = 0;
    for (const message of liveMessages) {
      if (
        isRuntimeOnlySessionMessage(message) ||
        isCompactionHostBase(message) ||
        (persistentSession &&
          message.role === "system" &&
          !getDurableSystemMessageProvenance(message))
      )
        ephemeralMessages.push({ sequence, message });
      else sequence += 1;
    }
  }
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
      allowExternalization: persistentSession,
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
  } else if (persistentSession) {
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
        items: messagesToContextItems(messages, {
          sessionId,
          allowExternalization: false,
        }),
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
    const error = new Error(
      "canonical live compaction is not authoritative for this cohort",
    );
    error.code = "legacy_writer_fenced";
    throw error;
  }
  if (persistentSession) {
    const authority =
      verifiedAuthoritySnapshot ||
      (await runtime.sessionPort.readSnapshot(sessionId));
    const inputItems = messagesToContextItems(messages, {
      sessionId,
      allowExternalization: true,
    });
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
  let settledOutputItems = null;
  if (ephemeralMessages.length) {
    const appendCompaction = runtime.sessionPort.appendCompaction.bind(
      runtime.sessionPort,
    );
    runtime.sessionPort.appendCompaction = async (event, expectedHead) => {
      const result = await appendCompaction(event, expectedHead);
      if (result?.ok === true) settledOutputItems = event.outputItems;
      return result;
    };
  }
  let receipt;
  try {
    receipt = await runtime.kernel.compactContext({
      operationId,
      sessionId,
      ...kernelBudget(
        compressor,
        messagesToContextItems(
          ephemeralMessages.map(({ message }) => message),
          { sessionId, allowExternalization: false },
        ).reduce((total, item) => total + item.tokenEstimate, 0),
        messages,
      ),
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
        const droppedMessages = contextItemsToMessages(droppedItems, {
          sessionId,
        });
        const result = await compressor.compress(droppedMessages, {
          preserveToolPairs: true,
          ...(options.compressOptions || {}),
        });
        summaryStats = result.stats || {};
        summaryReceipt = usageReceipt(summaryStats, provider, model);
        const reduced =
          Number(summaryStats.saved || 0) > 0 ||
          result.messages.length < droppedMessages.length;
        const item = reduced
          ? createSummaryContextItem({
              messages: result.messages,
              parents: droppedItems,
              operationId: context.operationId,
              now: operationNow,
              allowExternalization: persistentSession,
            })
          : null;
        return {
          items: item ? [item] : [],
          usageReceipt: summaryReceipt,
          degraded: summaryStats.degraded === true,
          ...(summaryStats.degradedReason
            ? {
                degradedReason: String(summaryStats.degradedReason).slice(
                  0,
                  160,
                ),
              }
            : {}),
        };
      },
    });
  } catch (error) {
    const rejection = getCompactionPlanRejection(error);
    if (
      rejection?.operationId === operationId &&
      rejection.sessionId === sessionId &&
      summaryReceipt !== null &&
      rejection.usageReceipt &&
      canonicalDigest(rejection.usageReceipt) ===
        canonicalDigest(summaryReceipt) &&
      summaryStats?.summaryUsageUnknown !== true
    ) {
      try {
        const usage = projectRuntimeTokenUsage({
          ...(summaryStats.summaryCallId
            ? { callId: summaryStats.summaryCallId }
            : {}),
          provider: summaryStats.summaryProvider || provider,
          model: summaryStats.summaryModel || model,
          source: "semantic-compaction",
          usage: {
            input_tokens: summaryStats.summaryUsage?.inputTokens,
            output_tokens: summaryStats.summaryUsage?.outputTokens,
            cache_read_input_tokens:
              summaryStats.summaryUsage?.cacheReadTokens ?? 0,
            cache_creation_input_tokens:
              summaryStats.summaryUsage?.cacheCreationTokens ?? 0,
          },
        });
        rejectedCompactionUsage.set(
          error,
          Object.freeze({
            ...usage,
            usage: Object.freeze(usage.usage),
            receipt: Object.freeze({ ...summaryReceipt }),
          }),
        );
      } catch {
        // Missing or invalid usage retains the caller's unknown outcome path.
      }
    }
    throw error;
  }
  if (!["committed", "degraded"].includes(receipt.status)) {
    return {
      messages: liveMessages,
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
  // Reattach host policy and private retry nudges at their durable sequence
  // boundaries. They remain live, never enter the receipt, and do not move a
  // retry instruction behind tool exchanges that happened after that retry.
  const restoredMessages = [];
  let ephemeralIndex = 0;
  for (const item of [...(settledOutputItems || snapshot.items)].sort(
    (left, right) =>
      (left.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) -
        (right.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER) ||
      left.itemId.localeCompare(right.itemId, "en"),
  )) {
    const sequence = item.sourceRef.eventSequence ?? Number.MAX_SAFE_INTEGER;
    while (
      ephemeralIndex < ephemeralMessages.length &&
      ephemeralMessages[ephemeralIndex].sequence <= sequence
    )
      restoredMessages.push(ephemeralMessages[ephemeralIndex++].message);
    restoredMessages.push(...contextItemsToMessages([item], { sessionId }));
  }
  restoredMessages.push(
    ...ephemeralMessages.slice(ephemeralIndex).map(({ message }) => message),
  );
  return {
    messages: restoredMessages,
    stats: {
      ...(summaryStats || {}),
      strategy:
        receipt.status === "degraded" ? "deterministic-fallback" : "canonical",
      originalMessages: liveMessages.length,
      compressedMessages: restoredMessages.length,
      originalTokens: estimatedTokens(liveMessages),
      compressedTokens: estimatedTokens(restoredMessages),
      saved: Math.max(
        0,
        estimatedTokens(liveMessages) - estimatedTokens(restoredMessages),
      ),
      canonicalAlreadySettled: true,
      canonicalReceipt: receipt,
    },
    receipt,
  };
}
