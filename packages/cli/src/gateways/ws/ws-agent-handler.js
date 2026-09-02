/**
 * WebSocket Agent Handler
 *
 * Canonical location (Phase 6b of the CLI Runtime Convergence roadmap,
 * 2026-04-09). Previously lived at `../../lib/ws-agent-handler.js`; that
 * path is retained as an `@deprecated` re-export shim for backwards
 * compatibility.
 *
 * Handles agent session messages over WebSocket. Consumes agent-core's
 * agentLoop generator and routes events to the client via the interaction
 * adapter.
 */

import { createHash, randomUUID } from "node:crypto";
import { agentLoop, formatToolArgs } from "../../runtime/agent-core.js";
import { classifyToolSideEffect } from "../../lib/side-effect-ledger.js";
import { DiffReviewFollowUpTracker } from "../../lib/diff-review-follow-up.js";
import {
  loadSideEffectLedger,
  persistSideEffectLedger,
} from "../../lib/side-effect-ledger-store.js";
import { operationIdempotencyKey } from "../../lib/idempotency.js";
import { collectToolResourceIdentifiers } from "../../lib/permission-side-effect-center.js";
import {
  detectTaskType,
  selectModelForTask,
} from "../../lib/task-model-selector.js";
import { runnableTaskModel } from "../../lib/runnable-provider.js";
import { PlanState } from "../../lib/plan-mode.js";
import { CLISlotFiller } from "../../lib/slot-filler.js";
import { createAbortError, isAbortError } from "../../lib/abort-utils.js";
import { addHooksV2EventObserver } from "../../lib/hooks-v2-producers.js";
import {
  projectHookPolicyDecision,
  projectToolPolicyDecision,
} from "../../lib/policy-decision-event.js";
import {
  resolveRegisteredHostHooksV2Workspace,
  runWithHostHooksV2Workspace,
} from "../../lib/hooks-v2-workspace-context.js";
import { createWsApprovalGate } from "./ws-approval-gate.js";
import { createSessionMcpLedgerSink } from "../../lib/mcp-call-ledger-store.js";
import { createMcpHostRecoveryRuntime } from "../../lib/mcp-host-recovery-runtime.js";
import { compactConversationWithProvider } from "../../harness/provider-backed-compaction.js";
import {
  estimateMessagesTokens,
  PromptCompressor,
} from "../../harness/prompt-compressor.js";
import { resolveCliContextMemoryCutover } from "../../lib/context-memory-kernel/authority.js";
import { compactLiveMessagesCanonical } from "../../lib/context-memory-kernel/live-compaction.js";
import { projectCanonicalResumeMessages } from "../../lib/session-message-provenance.js";
import { feature } from "../../lib/feature-flags.js";
import { classifyStreamRetryReason } from "../../lib/stream-retry.js";
import {
  markRuntimeLedgerPersistenceError,
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
  runtimeToolCallId,
  runtimeUsageEventType,
} from "../../lib/runtime-usage-ledger.js";
import {
  appendCompactEventIfMessagesMatch,
  appendEvent,
  appendLlmRetryCompact,
  appendTokenUsage,
  appendToolCallCompact,
  claimWsTurnIfHead,
  computeWsTurnInputDigest,
  createWsTurnClaimId,
  normalizeWsTurnRequestId,
  readVerifiedProjection,
  readVerifiedWsTurnState,
  readVerifiedMessages,
  settleWsTurnClaim,
} from "../../harness/jsonl-session-store.js";
import { sessionBudgetAdmissionError } from "../../lib/session-budget-production-root.js";
import {
  beginSessionBudgetUsage,
  markSessionBudgetUsageUnknown,
  recordSessionBudgetUsage,
  rejectSessionBudgetUsageUnknown,
} from "../../lib/session-budget-usage.js";
import { HostResourceBudget } from "../../lib/host-resource-budget.js";
import { captureAgentEvolutionRuntimeComposition } from "../../lib/evolution/agent-evolution-runtime-composition-brand.js";

const CANONICAL_WS_TURN_QUEUES = new Map();
const CANONICAL_WS_CLAIM_CAS_ATTEMPTS = 4;
const CALL_LEDGER_PROTOCOL = "call-ledger";
const CALL_LEDGER_VERSION = 1;
const USAGE_LEDGER_PERSISTENCE_CODE = "CC_USAGE_LEDGER_PERSISTENCE_FAILED";
const USAGE_LEDGER_PERSISTENCE_MESSAGE =
  "Canonical usage ledger persistence failed; model and tool execution is blocked";

function usageProtocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function classifyCanonicalUsageProtocol(data = {}) {
  const record =
    data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const hasScope = Object.hasOwn(record, "observabilityScope");
  const hasProtocol = Object.hasOwn(record, "usageTelemetryProtocol");
  const hasVersion = Object.hasOwn(record, "usageTelemetryVersion");
  if (!hasScope && !hasProtocol && !hasVersion) return "legacy";
  if (!hasProtocol || !hasVersion) {
    throw usageProtocolError(
      "CC_USAGE_LEDGER_PROTOCOL_REQUIRED",
      "Canonical scoped sessions require call-ledger usage telemetry before model or tool execution",
    );
  }
  if (
    record.usageTelemetryProtocol !== CALL_LEDGER_PROTOCOL ||
    record.usageTelemetryVersion !== CALL_LEDGER_VERSION
  ) {
    throw usageProtocolError(
      "CC_USAGE_LEDGER_PROTOCOL_UNSUPPORTED",
      "Canonical session usage telemetry protocol is unsupported",
    );
  }
  return "call-ledger";
}

export function readCanonicalUsageProtocol(sessionId, projectionReader) {
  if (typeof projectionReader !== "function") return "legacy";
  return projectionReader(sessionId, () => {
    let sessionStart = null;
    return {
      accept(event) {
        if (event?.type === "session_start" && sessionStart === null) {
          sessionStart = event.data || {};
        }
      },
      finish() {
        return classifyCanonicalUsageProtocol(sessionStart || {});
      },
    };
  });
}

function runCanonicalWsTurnExclusive(sessionId, task) {
  const previous = CANONICAL_WS_TURN_QUEUES.get(sessionId) || Promise.resolve();
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => barrier);
  CANONICAL_WS_TURN_QUEUES.set(sessionId, tail);
  return previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      release();
      if (CANONICAL_WS_TURN_QUEUES.get(sessionId) === tail) {
        CANONICAL_WS_TURN_QUEUES.delete(sessionId);
      }
    });
}

export class WSAgentHandler {
  /**
   * @param {object} options
   * @param {import("./ws-session-gateway.js").Session} options.session
   * @param {import("../../lib/interaction-adapter.js").WebSocketInteractionAdapter} options.interaction
   * @param {object} [options.db]
   */
  constructor({
    session,
    interaction,
    db,
    approvalGate,
    agentLoop: runAgentLoop,
    compactionLlmQuery,
    compactionChatFn,
    canonicalSessionStore,
    sessionHostLease = null,
    sessionBudgetRoot = null,
    hostResourceBudget = null,
    evolutionCompositionFactory = null,
  }) {
    this.session = session;
    this.interaction = interaction;
    this.db = db || null;
    this._processing = false;
    this._abortController = null;
    this._activeRequestId = null;
    this._sessionHostLease = sessionHostLease;
    this._sessionBudgetRoot = sessionBudgetRoot;
    this._sessionBudget = sessionBudgetRoot?.budget || null;
    // session-protocol keeps one handler alive across reconnects and incoming
    // requests, making this authority session-scoped rather than turn-scoped.
    this._hostResourceBudget = hostResourceBudget || new HostResourceBudget();
    this._onSessionHostLeaseAbort = null;
    if (sessionHostLease?.signal) {
      this._onSessionHostLeaseAbort = () => {
        const reason =
          sessionHostLease.signal.reason ||
          createAbortError("Session host lease was lost");
        if (this._abortController && !this._abortController.signal.aborted) {
          this._abortController.abort(reason);
        }
        this.interaction?.rejectAllPending?.(reason);
      };
      sessionHostLease.signal.addEventListener(
        "abort",
        this._onSessionHostLeaseAbort,
        { once: true },
      );
      if (sessionHostLease.signal.aborted) this._onSessionHostLeaseAbort();
    }
    this._sessionBudgetSignal = sessionBudgetRoot?.options?.signal || null;
    this._onSessionBudgetAbort = null;
    if (this._sessionBudgetSignal) {
      this._onSessionBudgetAbort = () => {
        const reason = sessionBudgetAdmissionError(
          this._sessionBudget?.reason?.(),
          "WebSocket session",
        );
        if (this._abortController && !this._abortController.signal.aborted) {
          this._abortController.abort(reason);
        }
        this.interaction?.rejectAllPending?.(reason);
      };
      this._sessionBudgetSignal.addEventListener(
        "abort",
        this._onSessionBudgetAbort,
        { once: true },
      );
      if (this._sessionBudgetSignal.aborted) this._onSessionBudgetAbort();
    }
    // P0-2: monotonic sequence for crash-safe side-effect ledger op ids. The
    // session id + a per-op nonce keep ids unique across turns and processes.
    this._sideEffectSeq = 0;
    // P0 authority: permission-gate-over-WS. An explicitly injected gate wins
    // (tests / embedders); otherwise one is built lazily on the first turn
    // when CC_WS_APPROVAL_GATE=1 — its confirmer raises confirm questions
    // over the interaction adapter WITH an approval binding the client must
    // echo back on approve (mismatch → deny). Default (env unset, nothing
    // injected): approvalGate stays null and loopOptions are byte-identical.
    this._approvalGate = approvalGate || null;
    this._approvalGateInit = Boolean(approvalGate);
    this._mcpRecoveryRuntime = null;
    this._mcpRecoverySink = null;
    this._mcpRecoveryRevision = null;
    this._mcpRecoveryClient = null;
    this._agentLoop = runAgentLoop || agentLoop;
    if (
      evolutionCompositionFactory !== null &&
      typeof evolutionCompositionFactory !== "function"
    ) {
      throw new TypeError("evolutionCompositionFactory must be a function");
    }
    this._evolutionCompositionFactory = evolutionCompositionFactory;
    this._compactionLlmQuery = compactionLlmQuery || null;
    this._compactionSettlementBlock = null;
    this._compactionChatFn =
      compactionChatFn ||
      (async (...args) => {
        const { chatWithTools } = await import("../../runtime/agent-core.js");
        return chatWithTools(...args);
      });
    const injectedCanonicalStore = canonicalSessionStore || null;
    this._canonicalSessionStore = {
      appendCompactEventIfMessagesMatch,
      appendEvent,
      appendLlmRetryCompact,
      appendTokenUsage,
      appendToolCallCompact,
      claimWsTurnIfHead,
      computeWsTurnInputDigest,
      createWsTurnClaimId,
      normalizeWsTurnRequestId,
      readVerifiedProjection,
      readVerifiedWsTurnState,
      readVerifiedMessages,
      settleWsTurnClaim,
      ...(canonicalSessionStore || {}),
    };
    // Test/embedding stores historically injected only WS-turn CAS methods.
    // Preserve that compatibility as legacy unless they explicitly provide a
    // verified projection reader. The production store always supplies one.
    this._canonicalUsageProjectionReader =
      injectedCanonicalStore &&
      typeof injectedCanonicalStore.readVerifiedProjection !== "function"
        ? null
        : this._canonicalSessionStore.readVerifiedProjection;
    this._canonicalUsageProtocol = null;
    this._usageLedgerFailure = null;
    const explicitHostPrefix = Array.isArray(
      session?._canonicalHostSystemPrefix,
    )
      ? session._canonicalHostSystemPrefix
      : null;
    const hostSystemPrefix = explicitHostPrefix || [];
    if (!explicitHostPrefix) {
      for (const message of Array.isArray(session?.messages)
        ? session.messages
        : []) {
        if (message?.role !== "system") break;
        hostSystemPrefix.push(Object.freeze({ ...message }));
      }
    }
    this._canonicalHostSystemPrefix = explicitHostPrefix
      ? explicitHostPrefix
      : Object.freeze(hostSystemPrefix);
  }

  async _prepareEvolutionTurn(requestId) {
    if (!this._evolutionCompositionFactory) return null;
    const sessionId = String(this.session.id);
    const stableRequestId =
      typeof requestId === "string" && requestId.trim()
        ? requestId.trim()
        : randomUUID();
    const runId = `ws-run-${createHash("sha256")
      .update(`${sessionId}\0${stableRequestId}`, "utf8")
      .digest("hex")}`;
    try {
      const composition = captureAgentEvolutionRuntimeComposition(
        await this._evolutionCompositionFactory(
          Object.freeze({
            mode: "legacy-websocket",
            runId,
            sessionId,
            requestId: stableRequestId,
            cwd: this.session.projectRoot,
          }),
        ),
      );
      if (composition.runId !== runId) {
        throw new TypeError(
          "Agent evolution composition belongs to another WebSocket turn",
        );
      }
      await composition.evolutionIngress.start();
      return composition;
    } catch (cause) {
      if (cause?.code === "CC_AGENT_EVOLUTION_INGRESS_FAILED") throw cause;
      const error = new Error(
        `WebSocket evolution ingress failed: ${cause?.message || String(cause)}`,
        { cause },
      );
      error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
      throw error;
    }
  }

  attachInteraction(interaction) {
    if (!interaction || interaction === this.interaction) return false;
    const previous = this.interaction;
    this.interaction = interaction;
    this.session.interaction = interaction;
    previous?.rejectAllPending?.(
      createAbortError("WebSocket session transport was reattached"),
    );
    return true;
  }

  assertSessionBudgetAdmission(operation = "WebSocket operation") {
    if (!this._sessionBudget) return true;
    if (
      this._sessionBudget.signal?.aborted === true ||
      this._sessionBudgetSignal?.aborted === true
    ) {
      throw sessionBudgetAdmissionError(
        this._sessionBudget.reason?.(),
        operation,
      );
    }
    return true;
  }

  _turnSignal(turnSignal) {
    const budgetSignal = this._sessionBudgetSignal;
    if (!budgetSignal) return turnSignal;
    return AbortSignal.any([turnSignal, budgetSignal]);
  }

  _recordSessionBudgetUsage(event, operation = "WebSocket usage settlement") {
    return recordSessionBudgetUsage(this._sessionBudget, event, operation);
  }

  _beginSessionBudgetUsage(event, operation = "WebSocket provider call") {
    return beginSessionBudgetUsage(this._sessionBudget, event, operation);
  }

  _markSessionBudgetUsageUnknown(event) {
    return markSessionBudgetUsageUnknown(this._sessionBudget, event);
  }

  _consumeSessionBudgetTurn(id, operation) {
    if (!this._sessionBudget?.consumeTurn) return null;
    const admission = this._sessionBudget.consumeTurn({ id });
    if (!admission?.ok) {
      throw sessionBudgetAdmissionError(admission?.reason, operation);
    }
    return admission;
  }

  _applyCanonicalMessages(messages) {
    const canonicalMessages = Array.isArray(messages) ? messages : [];
    this.session.messages = [
      ...this._canonicalHostSystemPrefix,
      ...canonicalMessages,
    ];

    // Resume recovery notices are host-owned runtime context rather than
    // canonical transcript content. Preserve the current notice separately,
    // after the leading system block, on every authoritative refresh.
    const recoveryNotice = this.session._resumeRecoveryNoticeMessage || null;
    if (recoveryNotice) {
      let insertionIndex = 0;
      while (this.session.messages[insertionIndex]?.role === "system") {
        insertionIndex += 1;
      }
      this.session.messages.splice(insertionIndex, 0, recoveryNotice);
    }
    return this.session.messages;
  }

  _resolveCanonicalUsageProtocol() {
    if (this.session.canonicalJsonlSession !== true) return "legacy";
    if (this._canonicalUsageProtocol) return this._canonicalUsageProtocol;

    // An embedding may attach the immutable session-start declaration directly
    // while supplying a partial canonical store. Never ignore such a marker.
    const attachedDeclaration = {};
    for (const field of [
      "observabilityScope",
      "usageTelemetryProtocol",
      "usageTelemetryVersion",
    ]) {
      if (Object.hasOwn(this.session, field)) {
        attachedDeclaration[field] = this.session[field];
      }
    }
    const attachedMode = classifyCanonicalUsageProtocol(attachedDeclaration);
    if (attachedMode !== "legacy") {
      this._canonicalUsageProtocol = attachedMode;
      return attachedMode;
    }

    this._canonicalUsageProtocol = readCanonicalUsageProtocol(
      this.session.id,
      this._canonicalUsageProjectionReader,
    );
    return this._canonicalUsageProtocol;
  }

  _usageLedgerTerminalError(cause = null) {
    const error = new Error(USAGE_LEDGER_PERSISTENCE_MESSAGE, {
      ...(cause ? { cause } : {}),
    });
    error.code = USAGE_LEDGER_PERSISTENCE_CODE;
    error.runtimeLedgerPersistence = true;
    return error;
  }

  _latchUsageLedgerFailure(error) {
    const marked = markRuntimeLedgerPersistenceError(error);
    this._usageLedgerFailure ||= Object.freeze({
      code: USAGE_LEDGER_PERSISTENCE_CODE,
      reason: "canonical_usage_ledger_persistence_failed",
    });
    return this._usageLedgerTerminalError(marked);
  }

  _assertUsageLedgerWritable() {
    if (this._usageLedgerFailure) throw this._usageLedgerTerminalError();
  }

  _callCanonicalLedgerStore(method, ...args) {
    this._assertUsageLedgerWritable();
    try {
      const result = this._canonicalSessionStore[method](...args);
      if (result && typeof result.then === "function") {
        void Promise.resolve(result).catch(() => {});
        throw new TypeError(
          `Canonical usage ledger ${method} must be synchronous`,
        );
      }
      return result;
    } catch (error) {
      throw this._latchUsageLedgerFailure(error);
    }
  }

  _persistCanonicalUsageBoundary(event, outcome) {
    let projected;
    try {
      projected = projectRuntimeUsageBoundary(event, outcome);
    } catch (error) {
      throw this._latchUsageLedgerFailure(error);
    }
    this._callCanonicalLedgerStore(
      "appendEvent",
      this.session.id,
      runtimeUsageEventType(outcome),
      projected,
    );
  }

  _persistCanonicalTokenUsage(event) {
    let projected;
    try {
      projected = projectRuntimeTokenUsage(event);
    } catch (error) {
      throw this._latchUsageLedgerFailure(error);
    }
    this._callCanonicalLedgerStore(
      "appendTokenUsage",
      this.session.id,
      projected,
    );
  }

  _persistCanonicalUsageSettlement(event) {
    if (event?.type === "token-usage") {
      this._persistCanonicalTokenUsage(event);
      return;
    }
    this._persistCanonicalUsageBoundary(event, "unknown");
  }

  _beginCanonicalCompactionUsage() {
    const call = Object.freeze({
      callId: `ws-cmp-${randomUUID()}`,
      provider: this.session.provider || null,
      model: this.session.model || null,
      source: "semantic-compaction",
    });
    this._consumeSessionBudgetTurn(
      `turn:${call.callId}`,
      "WebSocket compaction",
    );
    this._persistCanonicalUsageBoundary(call, "started");
    this._beginSessionBudgetUsage(call, "WebSocket compaction provider call");
    return call;
  }

  _settleCanonicalCompactionUsage(call, result) {
    if (!call) return;
    const unknown = result?.usageUnknownEvent || null;
    if (unknown) {
      const reason = unknown.reason || "provider_transport_outcome_unknown";
      this._persistCanonicalUsageBoundary(
        {
          ...call,
          code:
            reason === "provider_usage_not_reported"
              ? "provider_usage_missing"
              : unknown.code || "provider_call_failed",
        },
        "unknown",
      );
      if (this._markSessionBudgetUsageUnknown(call)) {
        rejectSessionBudgetUsageUnknown(
          call,
          "WebSocket compaction provider call",
        );
      }
      return;
    }
    if (result?.usageEvent?.usage) {
      const usageEvent = {
        ...call,
        usage: result.usageEvent.usage,
      };
      this._persistCanonicalTokenUsage(usageEvent);
      this._recordSessionBudgetUsage(
        usageEvent,
        "WebSocket compaction usage settlement",
      );
      return;
    }
    this._persistCanonicalUsageBoundary(
      { ...call, code: "provider_usage_missing" },
      "unknown",
    );
    if (this._markSessionBudgetUsageUnknown(call)) {
      rejectSessionBudgetUsageUnknown(
        call,
        "WebSocket compaction provider call",
      );
    }
  }

  _settleCanonicalCompactionFailure(call) {
    if (!call) return;
    this._persistCanonicalUsageBoundary(
      { ...call, code: "provider_call_failed" },
      "unknown",
    );
    this._markSessionBudgetUsageUnknown(call);
  }

  _latchCompactionSettlement({
    code,
    reason,
    commitState = "unknown",
    usageOutcome = null,
  }) {
    this._compactionSettlementBlock = Object.freeze({
      code: code || "CC_COMPACTION_SETTLEMENT_UNKNOWN",
      reason: reason || "canonical_compaction_settlement_failed",
      commitState,
      ...(usageOutcome ? { usageOutcome } : {}),
    });
    return this._compactionSettlementBlock;
  }

  _reconcileCompactionSettlementBlock() {
    if (
      this._compactionSettlementBlock?.commitState !== "provider-usage-unknown"
    ) {
      this._compactionSettlementBlock = null;
    }
  }

  _emitCompactionUsage(requestId, usageEvent) {
    if (!usageEvent) return;
    this.interaction.emit("token-usage", {
      requestId,
      ...usageEvent,
    });
  }

  _emitCompactionUsageUnknown(requestId, usageUnknownEvent) {
    const block = this._latchCompactionSettlement({
      code: "CC_COMPACTION_USAGE_UNKNOWN",
      reason: usageUnknownEvent?.reason || "provider_transport_outcome_unknown",
      commitState: "provider-usage-unknown",
      usageOutcome: "unknown",
    });
    this.interaction.emit("compaction-usage-unknown", {
      requestId,
      ...usageUnknownEvent,
      code: block.code,
    });
    return block;
  }

  _contextMemoryCutover() {
    return resolveCliContextMemoryCutover({
      env: this.session.contextMemoryEnv || process.env,
      scopeKey: `cli:session:${this.session.id}`,
    });
  }

  async _compactContextMemory(messages, providerOptions, trigger) {
    const cutover = this._contextMemoryCutover();
    if (!cutover.canonical) {
      return compactConversationWithProvider(messages, providerOptions);
    }
    const probe = new PromptCompressor({
      model: providerOptions.model,
      provider: providerOptions.provider,
      ...(providerOptions.maxMessages
        ? { maxMessages: providerOptions.maxMessages }
        : {}),
      ...(providerOptions.maxTokens
        ? { maxTokens: providerOptions.maxTokens }
        : {}),
    });
    if (
      providerOptions.onlyIfNeeded === true &&
      !probe.shouldAutoCompact(messages)
    ) {
      const tokens = estimateMessagesTokens(messages);
      return {
        messages: [...messages],
        stats: {
          strategy: "none",
          originalMessages: messages.length,
          compressedMessages: messages.length,
          originalTokens: tokens,
          compressedTokens: tokens,
          saved: 0,
        },
        degradedEvent: null,
        usageEvent: null,
        usageUnknownEvent: null,
      };
    }

    let compatibilityResult = null;
    const canonical = await compactLiveMessagesCanonical(messages, {
      compressor: {
        maxTokens: probe.maxTokens,
        compress: async (dropped) => {
          compatibilityResult = await compactConversationWithProvider(
            dropped,
            providerOptions,
          );
          await providerOptions.onContextMemorySummarySettled?.(
            compatibilityResult,
          );
          return compatibilityResult;
        },
      },
      sessionId: this.session.id,
      operationId: `${trigger}-${randomUUID()}`,
      provider: this.session.provider,
      model: this.session.model,
      env: this.session.contextMemoryEnv || process.env,
      persist: this.session.canonicalJsonlSession === true,
      trigger,
      ...(this.session.canonicalJsonlSession === true
        ? {
            commit: (stats, output, settlement) => {
              this._sessionHostLease?.assert?.();
              const result =
                this._canonicalSessionStore.appendCompactEventIfMessagesMatch(
                  this.session.id,
                  {
                    ...stats,
                    trigger,
                    messages: projectCanonicalResumeMessages(output, {
                      strict: true,
                    }),
                  },
                  settlement.expectedMessages,
                );
              if (result && typeof result.then === "function") {
                void Promise.resolve(result).catch(() => {});
                const error = new TypeError(
                  "Canonical compact settlement must be synchronous",
                );
                error.code = "CC_COMPACTION_SETTLEMENT_ASYNC";
                throw error;
              }
              return result;
            },
          }
        : {}),
    });
    if (canonical.receipt.status === "stale") {
      const error = new Error(
        "session messages changed during canonical compaction",
      );
      error.code = "SESSION_REVISION_STALE";
      throw error;
    }
    if (
      canonical.receipt.status === "reconciliation_required" &&
      !compatibilityResult?.usageUnknownEvent
    ) {
      const error = new Error("canonical compaction requires reconciliation");
      error.code = "CC_COMPACTION_RECONCILIATION_REQUIRED";
      throw error;
    }
    return {
      messages: canonical.messages,
      stats: canonical.stats,
      degradedEvent: compatibilityResult?.degradedEvent || null,
      usageEvent: compatibilityResult?.usageEvent || null,
      usageUnknownEvent: compatibilityResult?.usageUnknownEvent || null,
    };
  }

  _canonicalTurnFromAuthority(state, requestId, userMessage, inputDigest) {
    const status = state?.status || (state?.turn ? "completed" : "none");
    this._applyCanonicalMessages(state?.messages || []);
    this._reconcileCompactionSettlementBlock();
    if (status === "completed" && state.turn) {
      return {
        requestId,
        userMessage,
        inputDigest,
        status,
        settled: true,
        replayed: true,
        response: state.turn.assistant.content,
      };
    }
    if (status === "failed") {
      return {
        requestId,
        userMessage,
        inputDigest,
        status,
        settled: true,
        replayed: true,
        failureCode: state.settlement?.failure?.code || "CC_WS_TURN_FAILED",
      };
    }
    if (status === "pending") {
      return {
        requestId,
        userMessage,
        inputDigest,
        status,
        settled: false,
        pending: true,
        replayed: true,
      };
    }
    return null;
  }

  async _compactCanonicalHistoryBeforeClaim(requestId, signal = null) {
    const { session } = this;
    if (
      session.autoCompact === false ||
      (!feature("PROMPT_COMPRESSOR") &&
        !this._contextMemoryCutover().canonical) ||
      this._compactionSettlementBlock?.commitState === "provider-usage-unknown"
    ) {
      return true;
    }

    const before = session.messages.length;
    const expectedMessages = [...session.messages];
    const strictUsageTelemetry =
      this._resolveCanonicalUsageProtocol() === "call-ledger";
    const meterCompaction =
      strictUsageTelemetry || Boolean(this._sessionBudget);
    let compactionUsageCall = null;
    let compactionUsageSettled = false;
    let result;
    try {
      this._sessionHostLease?.assert?.();
      result = await this._compactContextMemory(session.messages, {
        provider: session.provider,
        model: session.model,
        baseUrl: session.baseUrl,
        apiKey: session.apiKey,
        signal:
          signal || this._sessionBudgetSignal || this._sessionHostLease?.signal,
        onlyIfNeeded: true,
        preserveCompletedExchange: true,
        llmQuery: this._compactionLlmQuery,
        chatFn: this._compactionChatFn,
        chatOptions: {
          cwd: session.projectRoot,
          sessionId: session.id,
        },
        ...(meterCompaction
          ? {
              onProviderCallStart: () => {
                const call = this._beginCanonicalCompactionUsage();
                compactionUsageCall = call;
                return call.callId;
              },
            }
          : {}),
        maxMessages: session.compactionMaxMessages,
        maxTokens: session.compactionMaxTokens,
        maxOutputTokens: session.compactionMaxOutputTokens,
        summaryInputMaxChars: session.compactionInputMaxChars,
        onContextMemorySummarySettled: (summaryResult) => {
          if (compactionUsageCall && !compactionUsageSettled) {
            this._settleCanonicalCompactionUsage(
              compactionUsageCall,
              summaryResult,
            );
            compactionUsageSettled = true;
          }
        },
      }, "auto");
      if (compactionUsageCall && !compactionUsageSettled) {
        this._settleCanonicalCompactionUsage(compactionUsageCall, result);
        compactionUsageSettled = true;
      }
      this._sessionHostLease?.assert?.();
    } catch (error) {
      if (
        compactionUsageCall &&
        !compactionUsageSettled &&
        error?.runtimeLedgerPersistence !== true
      ) {
        this._settleCanonicalCompactionFailure(compactionUsageCall);
        compactionUsageSettled = true;
      }
      if (error?.runtimeLedgerPersistence === true) throw error;
      if (isAbortError(error) || this._sessionHostLease?.signal?.aborted) {
        throw error;
      }
      const block = this._latchCompactionSettlement({
        code: error?.code || "CC_COMPACTION_FAILED",
        reason: `compaction_failed:${String(error?.message || error).slice(0, 240)}`,
        commitState: "provider-outcome-unknown",
      });
      this.interaction.emit("compaction-degraded", {
        requestId,
        reason: block.reason,
        summaryMode: "none",
        code: block.code,
      });
      this.interaction.emit("error", {
        requestId,
        code: block.code,
        message: "Canonical history could not be compacted before turn claim",
      });
      return false;
    }

    const {
      messages: compacted,
      stats,
      degradedEvent,
      usageEvent,
      usageUnknownEvent,
    } = result;
    if (degradedEvent) {
      this.interaction.emit("compaction-degraded", {
        requestId,
        ...degradedEvent,
      });
    }
    if (usageUnknownEvent) {
      const block = this._emitCompactionUsageUnknown(
        requestId,
        usageUnknownEvent,
      );
      this.interaction.emit("error", {
        requestId,
        code: block.code,
        message:
          "Compaction provider usage is unknown; the paid compaction is not retried",
      });
      return false;
    }

    const messagesChanged =
      session.messages.length !== expectedMessages.length ||
      session.messages.some(
        (message, index) => message !== expectedMessages[index],
      );
    const shouldSettle = stats?.strategy !== "none" && stats?.saved > 0;
    let settlementError = null;
    if (
      !messagesChanged &&
      shouldSettle &&
      stats?.canonicalAlreadySettled !== true
    ) {
      try {
        const settlement =
          this._canonicalSessionStore.appendCompactEventIfMessagesMatch(
            session.id,
            {
              ...stats,
              trigger: "auto",
              messages: projectCanonicalResumeMessages(compacted, {
                strict: true,
              }),
            },
            expectedMessages,
          );
        if (settlement && typeof settlement.then === "function") {
          void Promise.resolve(settlement).catch(() => {});
          const error = new TypeError(
            "Canonical compact settlement must be synchronous",
          );
          error.code = "CC_COMPACTION_SETTLEMENT_ASYNC";
          throw error;
        }
      } catch (error) {
        settlementError = error;
      }
    }

    this._emitCompactionUsage(requestId, usageEvent);
    if (messagesChanged || settlementError) {
      const stale = settlementError?.code === "SESSION_REVISION_STALE";
      let reconciled = false;
      if (stale) {
        try {
          const authoritativeMessages =
            this._canonicalSessionStore.readVerifiedMessages(session.id);
          if (!Array.isArray(authoritativeMessages)) {
            throw new TypeError(
              "Canonical message refresh must be synchronous",
            );
          }
          this._applyCanonicalMessages(authoritativeMessages);
          this._reconcileCompactionSettlementBlock();
          reconciled = true;
        } catch {
          // Latch below until a later verified canonical refresh succeeds.
        }
      }
      const block =
        reconciled && stale
          ? {
              code: "CC_COMPACTION_REVISION_STALE",
              reason: "session_messages_changed_during_compaction",
              commitState: "reconciled-stale",
            }
          : this._latchCompactionSettlement({
              code:
                settlementError?.code ||
                (messagesChanged
                  ? "CC_COMPACTION_LOCAL_STATE_CHANGED"
                  : "CC_COMPACTION_SETTLEMENT_UNKNOWN"),
              reason:
                messagesChanged || stale
                  ? "session_messages_changed_during_compaction"
                  : "canonical_compaction_settlement_failed",
              commitState: "unknown",
            });
      this.interaction.emit("compaction-degraded", {
        requestId,
        reason: block.reason,
        summaryMode: "none",
        code: block.code,
      });
      this.interaction.emit("error", {
        requestId,
        code: block.code,
        message:
          "Canonical compaction did not settle; the paid compaction is not retried",
      });
      return false;
    }

    if (shouldSettle) {
      session.messages.length = 0;
      session.messages.push(...compacted);
      this.interaction.emit("compaction", {
        requestId,
        stats,
        trigger: "auto",
        messagesBefore: before,
        messagesAfter: session.messages.length,
      });
    }
    return true;
  }

  _claimCanonicalTurn(userMessage, requestId) {
    const inputDigest =
      this._canonicalSessionStore.computeWsTurnInputDigest(userMessage);
    let state = this._canonicalSessionStore.readVerifiedWsTurnState(
      this.session.id,
      requestId,
      { inputDigest },
    );
    let terminal = this._canonicalTurnFromAuthority(
      state,
      requestId,
      userMessage,
      inputDigest,
    );
    if (terminal) return terminal;

    const opaqueClaimId = this._canonicalSessionStore.createWsTurnClaimId();
    let lastConflict = null;
    for (
      let attempt = 1;
      attempt <= CANONICAL_WS_CLAIM_CAS_ATTEMPTS;
      attempt++
    ) {
      try {
        const claimed = this._canonicalSessionStore.claimWsTurnIfHead(
          this.session.id,
          { requestId, user: userMessage, inputDigest, opaqueClaimId },
          state.headHash,
        );
        if (!claimed?.acquired) {
          terminal = this._canonicalTurnFromAuthority(
            claimed,
            requestId,
            userMessage,
            inputDigest,
          );
          if (terminal) return terminal;
          throw Object.assign(
            new Error("Canonical WebSocket request claim was not acquired"),
            { code: "CC_WS_TURN_CLAIM_NOT_ACQUIRED" },
          );
        }
        this._applyCanonicalMessages(claimed.messages);
        const baseMessages = [...this.session.messages];
        this.session.messages.push({ role: "user", content: userMessage });
        return {
          requestId,
          userMessage,
          inputDigest,
          opaqueClaimId,
          status: "pending",
          claimAcquired: true,
          settled: false,
          settlementAttempted: false,
          failureSettlementAttempted: false,
          replayed: false,
          response: null,
          baseMessages,
        };
      } catch (error) {
        if (error?.code !== "SESSION_REVISION_STALE") throw error;
        lastConflict = error;
        state = this._canonicalSessionStore.readVerifiedWsTurnState(
          this.session.id,
          requestId,
          { inputDigest },
        );
        terminal = this._canonicalTurnFromAuthority(
          state,
          requestId,
          userMessage,
          inputDigest,
        );
        if (terminal) return terminal;
      }
    }
    const error = new Error(
      "Canonical WebSocket claim could not settle after revision conflicts",
      { cause: lastConflict },
    );
    error.code = "CC_WS_TURN_CLAIM_CAS_RETRY_EXHAUSTED";
    throw error;
  }

  _settleCanonicalSuccess(turn, assistantContent) {
    if (typeof assistantContent !== "string" || !assistantContent.trim()) {
      const error = new Error(
        "Canonical WebSocket turn produced no assistant response",
      );
      error.code = "CC_WS_EMPTY_ASSISTANT_RESPONSE";
      throw error;
    }
    turn.settlementAttempted = true;
    const settled = this._canonicalSessionStore.settleWsTurnClaim(
      this.session.id,
      {
        requestId: turn.requestId,
        inputDigest: turn.inputDigest,
        opaqueClaimId: turn.opaqueClaimId,
        outcome: "completed",
        user: turn.userMessage,
        assistant: assistantContent,
      },
    );
    if (settled?.status !== "completed" || !settled.turn) {
      const error = new Error("Canonical WebSocket success was not settled");
      error.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
      error.commitState = "unknown";
      throw error;
    }
    this._applyCanonicalMessages(settled.messages);
    turn.settled = true;
    turn.status = "completed";
    turn.response = settled.turn.assistant.content;
    turn.replayed = settled.deduplicated === true;
    return { content: turn.response, replayed: turn.replayed };
  }

  _settleCanonicalFailure(turn, failureCode) {
    if (
      !turn?.claimAcquired ||
      turn.settled ||
      turn.settlementAttempted ||
      turn.failureSettlementAttempted
    ) {
      return false;
    }
    turn.failureSettlementAttempted = true;
    const settled = this._canonicalSessionStore.settleWsTurnClaim(
      this.session.id,
      {
        requestId: turn.requestId,
        inputDigest: turn.inputDigest,
        opaqueClaimId: turn.opaqueClaimId,
        outcome: "failed",
        failureCode,
      },
    );
    if (settled?.status !== "failed") {
      const error = new Error("Canonical WebSocket failure was not settled");
      error.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
      error.commitState = "unknown";
      throw error;
    }
    turn.settled = true;
    turn.status = "failed";
    this._applyCanonicalMessages(settled.messages);
    return true;
  }

  _ensureMcpRecoveryRuntime() {
    const { session } = this;
    const revision = Number(session.mcpLedgerRecoveryRevision || 0);
    const rawClient = session.mcpClient || null;
    if (!this._mcpRecoveryRuntime || this._mcpRecoveryClient !== rawClient) {
      const controller = this._mcpRecoveryRuntime?.controller || null;
      // Only a newly verified resume revision may lower an existing runtime
      // latch. A transport/client replacement by itself preserves settlement
      // outcome-unknown authority across the new wrapper.
      if (
        controller &&
        this._mcpRecoveryRevision !== revision &&
        typeof controller.replaceVerifiedRecovery === "function"
      ) {
        controller.replaceVerifiedRecovery(
          session.mcpLedgerRecovery || {
            incidents: [],
            unsettled: [],
            replayDenied: [],
          },
        );
      }
      this._mcpRecoverySink = createSessionMcpLedgerSink(session.id, {
        recovery: session.mcpLedgerRecovery || null,
      });
      this._mcpRecoveryRuntime = createMcpHostRecoveryRuntime({
        bundle: {
          mcpClient: rawClient,
          externalToolDescriptors: session.externalToolDescriptors || {},
          externalToolExecutors: session.externalToolExecutors || {},
        },
        rawClient,
        sessionId: session.id,
        sink: this._mcpRecoverySink,
        recovery: session.mcpLedgerRecovery || null,
        controller,
        dispatchAdmission: this._sessionHostLease?.admitMcpDispatch || null,
      });
      this._mcpRecoveryClient = rawClient;
      this._mcpRecoveryRevision = revision;
    } else if (this._mcpRecoveryRevision !== revision) {
      this._mcpRecoveryRuntime.controller.replaceVerifiedRecovery(
        session.mcpLedgerRecovery || {
          incidents: [],
          unsettled: [],
          replayDenied: [],
        },
      );
      this._mcpRecoverySink?.replaceRecoveryFence?.(
        session.mcpLedgerRecovery || null,
      );
      this._mcpRecoveryRevision = revision;
    }
    return this._mcpRecoveryRuntime;
  }

  refreshMcpRecoveryRuntime() {
    try {
      return this._ensureMcpRecoveryRuntime();
    } catch (cause) {
      const error = new Error("WS MCP recovery runtime refresh failed", {
        cause,
      });
      try {
        error.code = cause?.code || "CC_MCP_RECOVERY_REFRESH_FAILED";
      } catch {
        error.code = "CC_MCP_RECOVERY_REFRESH_FAILED";
      }
      // If an earlier runtime exists, make it unusable immediately. The
      // session protocol also attaches an ALL-blocking projection so a future
      // runtime cannot silently recover as clean.
      this._mcpRecoveryRuntime?.controller?.latchAll?.(error.code);
      throw error;
    }
  }

  _recordSessionState(type, payload = {}) {
    if (typeof this.session?._recordSessionStateEvent !== "function") return;
    try {
      this.session._recordSessionStateEvent(type, payload);
    } catch (_err) {
      // Recovery persistence is best-effort for the live turn. A persisted
      // running marker is reconciled fail-closed when the session resumes.
    }
  }

  /** Resolve the session's approval gate (lazy, opt-in; null when disabled). */
  async _ensureApprovalGate() {
    if (this._approvalGateInit) return this._approvalGate;
    this._approvalGateInit = true;
    if (process.env.CC_WS_APPROVAL_GATE === "1") {
      this._approvalGate = await createWsApprovalGate({
        sessionId: this.session.id,
        interaction: this.interaction,
        cwd: this.session.projectRoot,
      });
    }
    return this._approvalGate;
  }

  /**
   * Handle a user message — one turn of the agentic loop.
   *
   * @param {string} userMessage
   * @param {string} [requestId] - id from ws message for response correlation
   */
  async handleMessage(userMessage, requestId) {
    if (this.session?.canonicalJsonlSession === true) {
      let canonicalRequestId;
      try {
        canonicalRequestId =
          this._canonicalSessionStore.normalizeWsTurnRequestId(requestId);
      } catch (error) {
        this.interaction.emit("error", {
          requestId: null,
          code: error?.code || "CC_WS_REQUEST_ID_INVALID",
          message: error?.message || "WebSocket request id is invalid",
        });
        return;
      }
      return runCanonicalWsTurnExclusive(this.session.id, () =>
        this._handleMessage(userMessage, canonicalRequestId),
      );
    }
    return this._handleMessage(userMessage, requestId);
  }

  async _handleMessage(userMessage, requestId) {
    if (this._processing) {
      this.interaction.emit("error", {
        requestId,
        code: "BUSY",
        message: "Session is currently processing a message",
      });
      return;
    }

    this._processing = true;
    const abortController = new AbortController();
    const turnSignal = this._turnSignal(abortController.signal);
    this._abortController = abortController;
    this._activeRequestId = requestId || null;
    let sideEffectLedger = null;
    let diffReviewFollowUps = null;
    let runRecorded = false;
    let canonicalTurn = null;
    let strictUsageTelemetry = false;
    let evolutionComposition = null;

    try {
      const { session } = this;
      this.assertSessionBudgetAdmission("WebSocket turn");
      this._sessionHostLease?.assert?.();

      if (session.canonicalJsonlSession === true) {
        const inputDigest =
          this._canonicalSessionStore.computeWsTurnInputDigest(userMessage);
        const preflightState =
          this._canonicalSessionStore.readVerifiedWsTurnState(
            session.id,
            requestId,
            { inputDigest },
          );
        canonicalTurn = this._canonicalTurnFromAuthority(
          preflightState,
          requestId,
          userMessage,
          inputDigest,
        );
        if (!canonicalTurn) {
          strictUsageTelemetry =
            this._resolveCanonicalUsageProtocol() === "call-ledger";
          if (strictUsageTelemetry) this._assertUsageLedgerWritable();
          const compacted = await this._compactCanonicalHistoryBeforeClaim(
            requestId,
            turnSignal,
          );
          if (!compacted) return;
        }
        canonicalTurn ||= this._claimCanonicalTurn(userMessage, requestId);
        if (canonicalTurn.status === "completed") {
          this.interaction.emit("response-complete", {
            requestId,
            content: canonicalTurn.response,
            replayed: true,
          });
          return;
        }
        if (canonicalTurn.status === "failed") {
          this.interaction.emit("error", {
            requestId,
            code: canonicalTurn.failureCode,
            message: "WebSocket request previously settled as failed",
            replayed: true,
          });
          return;
        }
        if (canonicalTurn.pending) {
          this.interaction.emit("response-pending", {
            requestId,
            status: "pending",
            code: "CC_WS_TURN_PENDING",
            remediation: "adjudicate_or_use_new_request_id",
          });
          return;
        }
      }
      if (this._evolutionCompositionFactory !== null) {
        evolutionComposition = await this._prepareEvolutionTurn(requestId);
      }
      if (evolutionComposition !== null) {
        await evolutionComposition.evolutionIngress.ingestUserPrompt({
          content: userMessage,
          sessionId: session.id,
          requestId: requestId || null,
          source: "legacy-websocket",
        });
      }
      if (session.canonicalJsonlSession !== true) {
        session.messages.push({ role: "user", content: userMessage });
      }
      this._recordSessionState("run.started", {
        requestId: requestId || null,
        startedAt: new Date().toISOString(),
      });
      runRecorded = true;

      // Auto-select model based on task type — runnable-first: never switch
      // onto a provider with no usable key (you'd just 401). Keep the
      // configured model in that case.
      let activeModel = session.model;
      const taskDetection = detectTaskType(userMessage);
      if (taskDetection.confidence > 0.3) {
        const recommended = selectModelForTask(
          session.provider,
          taskDetection.taskType,
        );
        const switchTo = runnableTaskModel({
          provider: session.provider,
          currentModel: activeModel,
          recommended,
          apiKey: session.apiKey,
        });
        if (switchTo) {
          activeModel = switchTo;
          this.interaction.emit("model-switch", {
            requestId,
            from: session.model,
            to: activeModel,
            reason: taskDetection.name,
          });
        }
      }

      // Create slot filler for interactive parameter collection
      const slotFiller = new CLISlotFiller({
        interaction: this.interaction,
        db: this.db,
      });
      const mcpRecoveryRuntime = this._ensureMcpRecoveryRuntime();

      // Run agent loop. Turn-scoped approval grants are reset before the
      // model/tool boundary for every user message; session grants remain in
      // the verified authority ledger owned by the session-scoped gate.
      const approvalGate = await this._ensureApprovalGate();
      approvalGate?.beginTurn?.(requestId || `turn-${Date.now()}`);
      const loopOptions = {
        provider: session.provider,
        model: activeModel,
        baseUrl: session.baseUrl || "http://localhost:11434",
        apiKey: session.apiKey,
        contextEngine: session.contextEngine,
        hookDb: this.db,
        cwd: session.projectRoot,
        sessionId: session.id,
        planManager: session.planManager,
        hostResourceBudget: this._hostResourceBudget,
        enabledToolNames: session.enabledToolNames || null,
        hostManagedToolPolicy: session.hostManagedToolPolicy || null,
        extraToolDefinitions: session.externalToolDefinitions || [],
        externalToolDescriptors: session.externalToolDescriptors || {},
        externalToolExecutors: session.externalToolExecutors || {},
        mcpClient: session.mcpClient || null,
        mcpHostClient: mcpRecoveryRuntime.client || session.mcpClient || null,
        // MCP calls must use the same durable prewrite/settlement contract as
        // headless and REPL sessions. For unknown/write/destructive effects a
        // failed prewrite blocks the network call inside agent-core.
        mcpCallLedger: mcpRecoveryRuntime.ledger,
        mcpDispatchAdmission: this._sessionHostLease?.admitMcpDispatch || null,
        shellPolicyOverrides: session.shellPolicyOverrides || null,
        slotFiller,
        interaction: this.interaction,
        signal: turnSignal,
        sessionBudget: this._sessionBudget,
        // P0 authority: null unless opted in (byte-identical default — agent
        // core already defaults `options.approvalGate || null`).
        approvalGate,
        // Canonical WS history is compacted before ws_turn_prepare. Compaction
        // inside agent-core would include the staged pending user, which is not
        // part of the canonical message projection until turn settlement.
        ...(session.canonicalJsonlSession === true
          ? { autoCompact: false }
          : {}),
        ...(strictUsageTelemetry
          ? {
              strictUsageTelemetry: true,
              onUsageBoundary: (event) =>
                this._persistCanonicalUsageBoundary(event, "started"),
              onUsageSettlement: (event) =>
                this._persistCanonicalUsageSettlement(event),
              onStreamRetry: (attempt, error, telemetry = {}) =>
                this._callCanonicalLedgerStore(
                  "appendLlmRetryCompact",
                  session.id,
                  {
                    attempt,
                    durationMs: telemetry.durationMs,
                    provider: telemetry.provider || session.provider,
                    model: telemetry.model || activeModel,
                    reason: classifyStreamRetryReason(error),
                  },
                ),
            }
          : {}),
      };

      // P0-2: crash-safe side-effect ledger for the IDE/bridge path — mirrors
      // the headless runner. A dangerous tool is recorded prepare→start (snapshot
      // persisted BEFORE it settles) and commit/fail on its result, so a bridge
      // worker killed mid-flight is surfaced for verification on resume (see
      // handleSessionResume) instead of being blindly replayed.
      sideEffectLedger = loadSideEffectLedger(session.id);
      diffReviewFollowUps = new DiffReviewFollowUpTracker(sideEffectLedger);
      let currentSideEffectOpId = null;
      let currentTodoWrite = null;
      const activeToolCalls = new Map();
      const activeToolCallOrder = [];
      const boundedToolUseId = (value) =>
        typeof value === "string" &&
        value.trim() &&
        value.length <= 128 &&
        !/\p{Cc}/u.test(value)
          ? value.trim()
          : null;
      const boundedToolName = (value) => {
        if (typeof value !== "string") return "?";
        const clean = value.replace(/\p{Cc}/gu, "").trim();
        return clean ? clean.slice(0, 160) : "?";
      };
      const beginToolUsage = (event) => {
        const providerId = boundedToolUseId(event.tool_use_id);
        const record = {
          id: runtimeToolCallId(providerId || undefined),
          providerId,
          tool: boundedToolName(event.tool),
          startedAt: Date.now(),
        };
        this._callCanonicalLedgerStore(
          "appendEvent",
          session.id,
          "tool_call_started",
          { id: record.id, tool: record.tool },
        );
        activeToolCallOrder.push(record);
        if (providerId) activeToolCalls.set(providerId, record);
      };
      const settleToolUsage = (event) => {
        const providerId = boundedToolUseId(event.tool_use_id);
        const record =
          (providerId ? activeToolCalls.get(providerId) : null) ||
          activeToolCallOrder.find(
            (entry) => entry.tool === boundedToolName(event.tool),
          ) ||
          null;
        if (!record) return;
        const durationMs =
          event.result?.toolTelemetryRecord?.durationMs ??
          Math.max(0, Date.now() - record.startedAt);
        this._callCanonicalLedgerStore("appendToolCallCompact", session.id, {
          id: record.id,
          tool: record.tool,
          isError: Boolean(event.error || event.result?.error),
          skill:
            event?.attribution?.skill ||
            (record.tool === "run_skill"
              ? event.result?.skill || event.result?.skill_name || undefined
              : undefined),
          durationMs,
        });
        if (record.providerId) activeToolCalls.delete(record.providerId);
        const index = activeToolCallOrder.indexOf(record);
        if (index >= 0) activeToolCallOrder.splice(index, 1);
      };
      if (strictUsageTelemetry) {
        loopOptions.onToolCallBoundary = beginToolUsage;
        loopOptions.onToolCallSettlement = settleToolUsage;
      }

      const executeAgentTurn = async () => {
        for await (const event of this._agentLoop(
          session.messages,
          loopOptions,
        )) {
          if (evolutionComposition !== null) {
            await evolutionComposition.evolutionIngress.ingestAgentEvent(event);
          }
          switch (event.type) {
            case "slot-filling":
              this.interaction.emit("slot-filling", {
                requestId,
                slot: event.slot,
                question: event.question,
              });
              break;

            case "tool-executing":
              if (strictUsageTelemetry) beginToolUsage(event);
              this.interaction.emit("tool-executing", {
                requestId,
                tool: event.tool,
                args: event.args,
                display: formatToolArgs(event.tool, event.args),
              });
              currentSideEffectOpId = null;
              currentTodoWrite =
                event.tool === "todo_write" && Array.isArray(event.args?.todos)
                  ? event.args.todos.map((todo) => ({
                      id: todo.id,
                      content: todo.content,
                      status: todo.status,
                    }))
                  : null;
              {
                const se = classifyToolSideEffect(event.tool, event.args);
                if (se) {
                  const opId = `ws:${session.id}:${Date.now()}:${this._sideEffectSeq++}`;
                  currentSideEffectOpId = opId;
                  sideEffectLedger
                    .prepare(opId, {
                      kind: se.kind,
                      key: se.key,
                      meta: {
                        tool: event.tool,
                        toolUseId: event.tool_use_id || null,
                        turnId: event.turn_id || null,
                        resources: collectToolResourceIdentifiers(
                          event.tool,
                          event.args,
                        ),
                        idempotencyKey: operationIdempotencyKey({
                          tool: event.tool,
                          args: event.args,
                        }),
                      },
                    })
                    .start(opId);
                  persistSideEffectLedger(session.id, sideEffectLedger);
                  this._sessionHostLease?.assert?.();
                }
              }
              break;

            case "tool-result":
              if (strictUsageTelemetry) settleToolUsage(event);
              this.interaction.emit("tool-result", {
                requestId,
                tool: event.tool,
                result: event.result,
                error: event.error,
                permission_decision_id: event.permission_decision_id || null,
                permission_decision: event.permission_decision || null,
              });
              {
                const policyEvent = projectToolPolicyDecision(event, {
                  sessionId: session.id,
                  turnId: event.turn_id,
                  toolUseId: event.tool_use_id,
                });
                if (policyEvent) {
                  const { type: _type, ...payload } = policyEvent;
                  this.interaction.emit("policy-decision", {
                    requestId,
                    ...payload,
                  });
                }
              }
              if (
                event.tool === "todo_write" &&
                currentTodoWrite &&
                !event.error &&
                !event.result?.error &&
                event.result?.success === true &&
                Number.isSafeInteger(event.result.revision)
              ) {
                this._recordSessionState("todo.snapshot", {
                  todo: {
                    sessionId: session.id,
                    revision: event.result.revision,
                    todos: currentTodoWrite,
                  },
                });
              }
              currentTodoWrite = null;
              if (currentSideEffectOpId) {
                const err = event.error || event.result?.error || null;
                if (event.permission_decision) {
                  sideEffectLedger.annotate(currentSideEffectOpId, {
                    permissionDecision: event.permission_decision,
                  });
                }
                if (event.result?._diffReviewAudit) {
                  diffReviewFollowUps.observe(
                    sideEffectLedger,
                    currentSideEffectOpId,
                    event.result._diffReviewAudit,
                  );
                }
                if (err)
                  sideEffectLedger.fail(
                    currentSideEffectOpId,
                    String(err).slice(0, 200),
                  );
                else sideEffectLedger.commit(currentSideEffectOpId);
                persistSideEffectLedger(session.id, sideEffectLedger);
                currentSideEffectOpId = null;
              }
              break;

            case "compaction-degraded":
              this.interaction.emit("compaction-degraded", {
                requestId,
                reason: event.reason,
                summaryMode: event.summaryMode,
                ...(event.code ? { code: event.code } : {}),
                stats: event.stats,
              });
              break;

            case "compaction-usage-unknown":
              if (strictUsageTelemetry && event.ledgerPersisted !== true) {
                this._persistCanonicalUsageBoundary(event, "unknown");
              }
              this._emitCompactionUsageUnknown(requestId, event);
              if (this._markSessionBudgetUsageUnknown(event)) {
                rejectSessionBudgetUsageUnknown(
                  event,
                  "WebSocket semantic compaction",
                );
              }
              break;

            case "model-usage-started":
              if (strictUsageTelemetry && event.ledgerPersisted !== true) {
                this._persistCanonicalUsageBoundary(event, "started");
              }
              this._beginSessionBudgetUsage(event);
              break;

            case "model-usage-unknown":
              if (strictUsageTelemetry && event.ledgerPersisted !== true) {
                this._persistCanonicalUsageBoundary(event, "unknown");
              }
              if (this._markSessionBudgetUsageUnknown(event)) {
                rejectSessionBudgetUsageUnknown(
                  event,
                  "WebSocket provider call",
                );
              }
              break;

            case "compaction":
              this.interaction.emit("compaction", {
                requestId,
                stats: event.stats,
              });
              break;

            case "token-usage":
              if (
                session.canonicalJsonlSession === true &&
                (strictUsageTelemetry || this._sessionBudget) &&
                event.ledgerPersisted !== true
              ) {
                this._persistCanonicalTokenUsage(event);
              }
              this._recordSessionBudgetUsage(event);
              this.interaction.emit("token-usage", {
                requestId,
                provider: event.provider,
                model: event.model,
                usage: event.usage,
                ...(event.source ? { source: event.source } : {}),
              });
              break;

            case "response-complete":
              if (evolutionComposition !== null) {
                await evolutionComposition.evolutionIngress.complete();
              }
              if (session.canonicalJsonlSession === true) {
                const settled = this._settleCanonicalSuccess(
                  canonicalTurn,
                  event.content,
                );
                this.interaction.emit("response-complete", {
                  requestId,
                  content: settled.content,
                  replayed: settled.replayed,
                });
              } else {
                if (event.content) {
                  session.messages.push({
                    role: "assistant",
                    content: event.content,
                  });
                }
                this.interaction.emit("response-complete", {
                  requestId,
                  content: event.content,
                });
              }
              break;
          }
        }
      };
      const hooksWorkspaceBinding = resolveRegisteredHostHooksV2Workspace(
        session.hooksV2WorkspaceBindingId,
      );
      const runAgentTurn = () =>
        hooksWorkspaceBinding
          ? runWithHostHooksV2Workspace(
              hooksWorkspaceBinding.workspaceRoot,
              executeAgentTurn,
            )
          : executeAgentTurn();

      const removeHookPolicyObserver = addHooksV2EventObserver(
        session.id,
        (event) => {
          const policyEvent = projectHookPolicyDecision(event);
          if (!policyEvent) return;
          const { type: _type, ...payload } = policyEvent;
          this.interaction.emit("policy-decision", {
            requestId,
            ...payload,
          });
        },
      );
      try {
        if (session.mcpClient?.withElicitationContext) {
          await session.mcpClient.withElicitationContext(
            session.id,
            runAgentTurn,
          );
        } else {
          await runAgentTurn();
        }
      } finally {
        removeHookPolicyObserver();
      }
      if (session.canonicalJsonlSession === true && !canonicalTurn?.settled) {
        const error = new Error(
          "Canonical WebSocket turn completed without an assistant response",
        );
        error.code = "CC_WS_EMPTY_ASSISTANT_RESPONSE";
        throw error;
      }
      if (
        diffReviewFollowUps.complete(sideEffectLedger, {
          status: "completed-without-reproposal",
        }).length > 0
      ) {
        persistSideEffectLedger(session.id, sideEffectLedger);
      }

      // Update last activity
      session.lastActivity = new Date().toISOString();
    } catch (err) {
      let surfacedError = err;
      const sessionBudgetFailed =
        err?.code === "CC_SESSION_BUDGET_EXHAUSTED" ||
        err?.code === "CC_SESSION_BUDGET_USAGE_UNKNOWN" ||
        this._sessionBudget?.signal?.aborted === true;
      if (
        sessionBudgetFailed &&
        err?.code !== "CC_SESSION_BUDGET_EXHAUSTED" &&
        err?.code !== "CC_SESSION_BUDGET_USAGE_UNKNOWN"
      ) {
        surfacedError = sessionBudgetAdmissionError(
          this._sessionBudget?.reason?.(),
          "WebSocket turn",
        );
      }
      if (
        canonicalTurn?.claimAcquired &&
        !canonicalTurn.settled &&
        !canonicalTurn.settlementAttempted
      ) {
        const failureCode = sessionBudgetFailed
          ? surfacedError?.code || "CC_SESSION_BUDGET_EXHAUSTED"
          : isAbortError(err)
            ? "CC_WS_TURN_INTERRUPTED"
            : err?.code === "CC_WS_EMPTY_ASSISTANT_RESPONSE"
              ? "CC_WS_EMPTY_ASSISTANT_RESPONSE"
              : "CC_WS_TURN_FAILED";
        try {
          this._settleCanonicalFailure(canonicalTurn, failureCode);
        } catch (settlementError) {
          surfacedError = new Error(
            "WebSocket turn settlement is outcome-unknown; explicit adjudication or a new request id is required",
            { cause: settlementError },
          );
          surfacedError.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
        }
      } else if (
        canonicalTurn?.claimAcquired &&
        canonicalTurn.settlementAttempted &&
        !canonicalTurn.settled
      ) {
        surfacedError = new Error(
          "WebSocket turn settlement is outcome-unknown; explicit adjudication or a new request id is required",
          { cause: err },
        );
        surfacedError.code = "CC_WS_TURN_SETTLEMENT_UNKNOWN";
      }
      if (
        surfacedError?.runtimeLedgerPersistence === true &&
        surfacedError?.code !== "CC_WS_TURN_SETTLEMENT_UNKNOWN"
      ) {
        surfacedError = this._usageLedgerTerminalError(surfacedError);
      }
      if (canonicalTurn?.baseMessages && canonicalTurn.status !== "completed") {
        this.session.messages = [...canonicalTurn.baseMessages];
      }
      if (
        sideEffectLedger &&
        diffReviewFollowUps?.complete(sideEffectLedger, {
          status: "interrupted",
          reason: isAbortError(err) ? "aborted" : err.message,
        }).length > 0
      ) {
        persistSideEffectLedger(this.session.id, sideEffectLedger);
      }
      if (
        !sessionBudgetFailed &&
        (isAbortError(err) || abortController.signal.aborted)
      ) {
        return;
      }

      this.interaction.emit("error", {
        requestId,
        code: surfacedError?.code || "AGENT_ERROR",
        message: surfacedError.message,
      });

      // Record error in context engine
      if (this.session.contextEngine) {
        this.session.contextEngine.recordError({
          step: "ws-agent-loop",
          message: surfacedError.message,
        });
      }
    } finally {
      if (canonicalTurn?.baseMessages && canonicalTurn.status !== "completed") {
        this.session.messages = [...canonicalTurn.baseMessages];
      }
      if (runRecorded) {
        this._recordSessionState("run.settled", {
          requestId: requestId || null,
          settledAt: new Date().toISOString(),
        });
      }
      this._processing = false;
      if (this._abortController === abortController) {
        this._abortController = null;
      }
      if (this._activeRequestId === requestId) {
        this._activeRequestId = null;
      }
    }
  }

  async listApprovalGrants() {
    const gate = await this._ensureApprovalGate();
    if (!gate?.listGrants) return [];
    return gate.listGrants();
  }

  async revokeApprovalGrant(grantId) {
    const gate = await this._ensureApprovalGate();
    if (!gate?.revokeGrant) {
      return { success: false, error: "Approval grant authority unavailable" };
    }
    return gate.revokeGrant(grantId);
  }

  async interrupt() {
    const wasProcessing = this._processing;
    const interruptedRequestId = this._activeRequestId || null;
    const reason = createAbortError("Session interrupted by client");

    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(reason);
    }

    if (typeof this.interaction?.rejectAllPending === "function") {
      this.interaction.rejectAllPending(reason);
    }

    this._recordSessionState("run.interrupted", {
      requestId: interruptedRequestId,
      interruptedAt: new Date().toISOString(),
      reason: "client_interrupt",
    });

    return {
      sessionId: this.session?.id || null,
      interrupted: true,
      wasProcessing,
      interruptedRequestId,
    };
  }

  destroy() {
    const wasProcessing = this._processing;
    const interruptedRequestId = this._activeRequestId || null;
    const reason = createAbortError("Session closed");
    if (this._abortController && !this._abortController.signal.aborted) {
      this._abortController.abort(reason);
    }
    if (typeof this.interaction?.rejectAllPending === "function") {
      this.interaction.rejectAllPending(reason);
    }
    if (wasProcessing) {
      this._recordSessionState("run.interrupted", {
        requestId: interruptedRequestId,
        interruptedAt: new Date().toISOString(),
        reason: "session_closed",
      });
    }
    if (this._sessionHostLease?.signal && this._onSessionHostLeaseAbort) {
      this._sessionHostLease.signal.removeEventListener(
        "abort",
        this._onSessionHostLeaseAbort,
      );
    }
    this._onSessionHostLeaseAbort = null;
    if (this._sessionBudgetSignal && this._onSessionBudgetAbort) {
      this._sessionBudgetSignal.removeEventListener(
        "abort",
        this._onSessionBudgetAbort,
      );
    }
    this._onSessionBudgetAbort = null;
    this._sessionBudgetSignal = null;
    const cleanupErrors = [];
    try {
      this._sessionBudgetRoot?.close?.();
    } catch (error) {
      cleanupErrors.push(error);
    }
    this._sessionBudgetRoot = null;
    this._sessionBudget = null;
    try {
      this._sessionHostLease?.release?.();
    } catch (error) {
      cleanupErrors.push(error);
    }
    this._sessionHostLease = null;
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "WebSocket session authority cleanup failed",
      );
    }
  }

  /**
   * Handle slash commands within the session.
   *
   * @param {string} command - e.g. "/plan enter", "/model qwen2:7b"
   * @param {string} [requestId]
   */
  async handleSlashCommand(command, requestId) {
    const [cmd, ...args] = command.trim().split(/\s+/);
    const arg = args.join(" ").trim();
    const { session } = this;

    switch (cmd) {
      case "/model":
        if (arg) {
          session.model = arg;
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { model: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { model: session.model },
          });
        }
        break;

      case "/provider": {
        const supported = [
          "ollama",
          "anthropic",
          "openai",
          "deepseek",
          "dashscope",
          "mistral",
          "gemini",
          "volcengine",
        ];
        if (arg && supported.includes(arg)) {
          session.provider = arg;
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { provider: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { provider: session.provider, available: supported },
          });
        }
        break;
      }

      case "/clear":
        session.messages.length = 1; // Keep system prompt
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { cleared: true },
        });
        break;

      case "/compact": {
        if (this._compactionSettlementBlock) {
          const block = this._compactionSettlementBlock;
          this.interaction.emit("compaction-degraded", {
            requestId,
            reason: block.reason,
            summaryMode: "none",
            code: block.code,
          });
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: {
              messageCount: session.messages.length,
              error: block,
            },
          });
          break;
        }

        let strictUsageTelemetry = false;
        if (session.canonicalJsonlSession === true) {
          try {
            strictUsageTelemetry =
              this._resolveCanonicalUsageProtocol() === "call-ledger";
            if (strictUsageTelemetry) this._assertUsageLedgerWritable();
          } catch (error) {
            const admission = {
              code: error?.code || "CC_USAGE_LEDGER_ADMISSION_FAILED",
              reason: "canonical_usage_telemetry_admission_failed",
            };
            this.interaction.emit("compaction-degraded", {
              requestId,
              reason: admission.reason,
              summaryMode: "none",
              code: admission.code,
            });
            this.interaction.emit("command-response", {
              requestId,
              command: cmd,
              result: {
                messageCount: session.messages.length,
                error: admission,
              },
            });
            break;
          }
        }
        const meterCompaction =
          strictUsageTelemetry || Boolean(this._sessionBudget);

        const before = session.messages.length;
        const expectedMessages = [...session.messages];
        let result = null;
        let commandError = null;
        let compactionUsageCall = null;
        let compactionUsageSettled = false;
        try {
          this.assertSessionBudgetAdmission("WebSocket compaction");
          this._sessionHostLease?.assert?.();
          result = await this._compactContextMemory(session.messages, {
            provider: session.provider,
            model: session.model,
            baseUrl: session.baseUrl,
            apiKey: session.apiKey,
            signal: this._sessionBudgetSignal || this._sessionHostLease?.signal,
            force: true,
            preserveCompletedExchange: true,
            llmQuery: this._compactionLlmQuery,
            chatFn: this._compactionChatFn,
            chatOptions: {
              cwd: session.projectRoot,
              sessionId: session.id,
            },
            ...(meterCompaction
              ? {
                  onProviderCallStart: () => {
                    const call = this._beginCanonicalCompactionUsage();
                    compactionUsageCall = call;
                    return call.callId;
                  },
                }
              : {}),
            maxOutputTokens: session.compactionMaxOutputTokens,
            summaryInputMaxChars: session.compactionInputMaxChars,
            onContextMemorySummarySettled: (summaryResult) => {
              if (compactionUsageCall && !compactionUsageSettled) {
                this._settleCanonicalCompactionUsage(
                  compactionUsageCall,
                  summaryResult,
                );
                compactionUsageSettled = true;
              }
            },
          }, "manual");
          if (compactionUsageCall && !compactionUsageSettled) {
            this._settleCanonicalCompactionUsage(compactionUsageCall, result);
            compactionUsageSettled = true;
          }
          this._sessionHostLease?.assert?.();
        } catch (error) {
          if (
            compactionUsageCall &&
            !compactionUsageSettled &&
            error?.runtimeLedgerPersistence !== true
          ) {
            this._settleCanonicalCompactionFailure(compactionUsageCall);
            compactionUsageSettled = true;
          }
          if (isAbortError(error) || this._sessionHostLease?.signal?.aborted) {
            throw error;
          }
          commandError =
            error?.runtimeLedgerPersistence === true
              ? {
                  code: USAGE_LEDGER_PERSISTENCE_CODE,
                  reason: "canonical_usage_ledger_persistence_failed",
                  commitState: "usage-ledger-failed",
                }
              : this._latchCompactionSettlement({
                  code: error?.code || "CC_COMPACTION_FAILED",
                  reason: `compaction_failed:${String(error?.message || error).slice(0, 240)}`,
                  commitState: "provider-outcome-unknown",
                });
          this.interaction.emit("compaction-degraded", {
            requestId,
            reason: commandError.reason,
            summaryMode: "none",
            code: commandError.code,
          });
        }
        if (result) {
          const {
            messages,
            stats,
            degradedEvent,
            usageEvent,
            usageUnknownEvent,
          } = result;
          if (degradedEvent) {
            this.interaction.emit("compaction-degraded", {
              requestId,
              ...degradedEvent,
            });
          }
          if (usageUnknownEvent) {
            commandError = this._emitCompactionUsageUnknown(
              requestId,
              usageUnknownEvent,
            );
          }
          const messagesChanged =
            session.messages.length !== expectedMessages.length ||
            session.messages.some(
              (message, index) => message !== expectedMessages[index],
            );
          let settlementError = null;
          if (
            !commandError &&
            !messagesChanged &&
            session.canonicalJsonlSession === true &&
            stats?.canonicalAlreadySettled !== true
          ) {
            if (stats?.strategy !== "none") {
              try {
                const settlement =
                  this._canonicalSessionStore.appendCompactEventIfMessagesMatch(
                    session.id,
                    {
                      ...stats,
                      trigger: "manual",
                      messages: projectCanonicalResumeMessages(messages, {
                        strict: true,
                      }),
                    },
                    expectedMessages,
                  );
                if (settlement && typeof settlement.then === "function") {
                  void Promise.resolve(settlement).catch(() => {});
                  const error = new TypeError(
                    "Canonical compact settlement must be synchronous",
                  );
                  error.code = "CC_COMPACTION_SETTLEMENT_ASYNC";
                  throw error;
                }
              } catch (error) {
                settlementError = error;
              }
            }
          }

          if (!commandError && !messagesChanged && !settlementError) {
            session.messages.length = 0;
            session.messages.push(...messages);
            this.interaction.emit("compaction", {
              requestId,
              stats,
              messagesBefore: before,
              messagesAfter: session.messages.length,
            });
          } else if (!commandError) {
            const stale = settlementError?.code === "SESSION_REVISION_STALE";
            let reconciled = false;
            if (stale) {
              try {
                const authoritativeMessages =
                  this._canonicalSessionStore.readVerifiedMessages(session.id);
                if (!Array.isArray(authoritativeMessages)) {
                  throw new TypeError(
                    "Canonical message refresh must be synchronous",
                  );
                }
                this._applyCanonicalMessages(authoritativeMessages);
                this._reconcileCompactionSettlementBlock();
                reconciled = true;
              } catch {
                // Latch below until a later verified canonical refresh.
              }
            }
            commandError =
              reconciled && stale
                ? {
                    code: "CC_COMPACTION_REVISION_STALE",
                    reason: "session_messages_changed_during_compaction",
                    commitState: "reconciled-stale",
                  }
                : this._latchCompactionSettlement({
                    code:
                      settlementError?.code ||
                      (messagesChanged
                        ? "CC_COMPACTION_LOCAL_STATE_CHANGED"
                        : "CC_COMPACTION_SETTLEMENT_UNKNOWN"),
                    reason:
                      messagesChanged || stale
                        ? "session_messages_changed_during_compaction"
                        : "canonical_compaction_settlement_failed",
                    commitState: "unknown",
                  });
            this.interaction.emit("compaction-degraded", {
              requestId,
              reason: commandError.reason,
              summaryMode: "none",
              code: commandError.code,
            });
          }
          // Provider usage is emitted exactly once even when the message CAS
          // rejects the candidate; the paid request already happened and is
          // never retried by this command.
          this._emitCompactionUsage(requestId, usageEvent);
        }
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: {
            messageCount: session.messages.length,
            ...(commandError ? { error: commandError } : {}),
          },
        });
        break;
      }

      case "/task":
        if (arg === "clear") {
          if (session.contextEngine) session.contextEngine.clearTask();
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { cleared: true },
          });
        } else if (arg) {
          if (session.contextEngine) session.contextEngine.setTask(arg);
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { task: arg },
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: {
              task: session.contextEngine?.taskContext?.objective || null,
            },
          });
        }
        break;

      case "/stats":
        if (session.contextEngine) {
          const stats = session.contextEngine.getStats();
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: stats,
          });
        } else {
          this.interaction.emit("command-response", {
            requestId,
            command: cmd,
            result: { error: "Context engine not available" },
          });
        }
        break;

      case "/session":
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: {
            id: session.id,
            type: session.type,
            provider: session.provider,
            model: session.model,
            messageCount: session.messages.length,
            projectRoot: session.projectRoot,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
          },
        });
        break;

      case "/plan":
        this._handlePlanCommand(arg, requestId);
        break;

      default:
        this.interaction.emit("command-response", {
          requestId,
          command: cmd,
          result: { error: `Unknown command: ${cmd}` },
        });
    }
  }

  /**
   * Handle /plan sub-commands.
   */
  _handlePlanCommand(subCmd, requestId) {
    const planManager = this.session.planManager;

    if (!subCmd || subCmd === "enter") {
      if (planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan",
          result: { error: "Already in plan mode" },
        });
      } else {
        planManager.enterPlanMode({ title: "Agent Plan" });
        this.session.messages.push({
          role: "system",
          content:
            "[PLAN MODE ACTIVE] You are now in plan mode. You can read files, search, and analyze — but write/execute tools are blocked. Any blocked tool calls will be recorded as plan items. Analyze the task thoroughly, then the user will approve your plan.",
        });
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan",
          result: { state: "analyzing", message: "Entered plan mode" },
        });
      }
    } else if (subCmd === "show") {
      if (!planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan show",
          result: { error: "Not in plan mode" },
        });
      } else {
        this.interaction.emit("plan-ready", {
          requestId,
          summary: planManager.generatePlanSummary(),
          risk: planManager.getRiskAssessment(),
          items: planManager.currentPlan?.items || [],
        });
      }
    } else if (subCmd === "approve" || subCmd === "yes") {
      if (!planManager.isActive()) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: { error: "No plan to approve" },
        });
      } else if (
        !planManager.currentPlan ||
        planManager.currentPlan.items.length === 0
      ) {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: { error: "Plan has no items" },
        });
      } else {
        planManager.approvePlan();
        this.session.messages.push({
          role: "system",
          content: `[PLAN APPROVED] The user has approved your plan with ${planManager.currentPlan.items.length} items. You can now use all tools including write_file, edit_file, run_shell, git, and run_skill. Execute the plan items in order.`,
        });
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan approve",
          result: {
            state: PlanState.APPROVED,
            itemCount: planManager.currentPlan.items.length,
          },
        });
      }
    } else if (subCmd === "reject" || subCmd === "no") {
      if (planManager.isActive()) {
        planManager.rejectPlan("User rejected");
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan reject",
          result: { state: PlanState.REJECTED },
        });
      } else {
        this.interaction.emit("command-response", {
          requestId,
          command: "/plan reject",
          result: { error: "No plan to reject" },
        });
      }
    } else if (subCmd === "exit") {
      if (planManager.isActive()) {
        planManager.exitPlanMode({ savePlan: true });
      }
      this.interaction.emit("command-response", {
        requestId,
        command: "/plan exit",
        result: { state: PlanState.INACTIVE },
      });
    } else {
      this.interaction.emit("command-response", {
        requestId,
        command: "/plan",
        result: {
          error: `Unknown /plan subcommand: ${subCmd}`,
          available: ["enter", "show", "approve", "reject", "exit"],
        },
      });
    }
  }
}
