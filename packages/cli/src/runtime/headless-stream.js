/**
 * Streaming-input headless runner — Claude-Code `--input-format stream-json`.
 *
 * Where `runAgentHeadless` runs ONE turn from a single prompt and exits, this
 * variant keeps a persistent conversation driven by NDJSON user events on
 * stdin: one JSON object per line, a turn per event, NDJSON results per turn,
 * until stdin closes. Pairs with `--output-format stream-json` for a full
 * program-to-agent duplex (SDK-style multi-turn).
 *
 * Input event shapes accepted (kept liberal for interop):
 *   {"type":"user","message":{"role":"user","content":"hi"}}
 *   {"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}
 *   {"type":"user","text":"hi"}   |  {"role":"user","content":"hi"}  |  {"prompt":"hi"}
 *
 * Reuses the exported permission/tool helpers + the core agent loop so it does
 * not duplicate (or fork) `runAgentHeadless`'s internals.
 */

import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  approvalBindingDigest,
  verifyApprovalBinding,
} from "../lib/agent-authority.js";
import { validateApprovalDecision } from "../lib/app-server/protocol.js";
import {
  APPROVAL_GRANTS_EVENT,
  ApprovalGrantLedger,
  approvalPermissionForContext,
} from "../lib/approval-grant-ledger.js";
import {
  normalizeInteractionBinding,
  sameInteractionBinding,
} from "../lib/interaction-binding.js";
import {
  addHooksV2EventObserver,
  emitHooksV2Event,
  executeHooksV2Event,
  resolvePromptExpansion,
} from "../lib/hooks-v2-producers.js";
import {
  projectHookPolicyDecision,
  projectToolPolicyDecision,
} from "../lib/policy-decision-event.js";
import { runWithHostHooksV2Workspace } from "../lib/hooks-v2-workspace-context.js";
import { bootstrap } from "./bootstrap.js";
import {
  buildSystemPrompt,
  chatWithTools as coreChatWithTools,
  agentLoop as coreAgentLoop,
} from "./agent-core.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { collapseConsecutiveMessagesInPlace } from "./message-roles.js";
import {
  estimateMessagesTokens,
  sanitizeToolPairs,
} from "../harness/prompt-compressor.js";
import { compactConversationWithProvider } from "../harness/provider-backed-compaction.js";
import { HostResourceBudget } from "../lib/host-resource-budget.js";
import { projectCanonicalResumeMessages } from "../lib/session-message-provenance.js";
import { isAbortError } from "../lib/abort-utils.js";
import { expandFileRefsAsync } from "./file-ref-expander.js";
// Per-turn helpers resolved at module load (not re-`await import`ed inside the
// turn loop). image-input + ide-context are pure local modules; pulling them up
// here — the same pattern as expandFileRefsAsync above — drops a per-turn ESM
// cache lookup + microtask on a long-lived stream session (the IDE chat panel).
import {
  detectImagePaths,
  resolveImages,
  buildUserContent,
  resolveVisionLlm,
} from "../lib/image-input.js";
import {
  buildIdePromptContext,
  expandIdeMentions,
} from "../lib/ide-context.js";
import { detectVersionSkew, versionSkewMessage } from "../lib/version-skew.js";
import { captureAmbientExecutionLocation } from "../lib/execution-location-runtime.js";
import {
  AGENT_EVOLUTION_INGRESS_FAILED_CODE,
  captureAgentEvolutionIngress,
} from "../lib/evolution/agent-evolution-ingress.js";
import { captureAgentSkillOutcomeIndex } from "../lib/evolution/agent-evolution-runtime-composition-brand.js";
import { captureSkillVectorAuthority } from "../lib/skill-vector-authority.js";
import {
  resolveAgentMcp,
  resolvePermissionPromptTool,
  makePermissionPromptConfirmer,
  readHeadlessMcpConfigErrors,
} from "./mcp-config.js";
import { maybeApplyToolSearch } from "./mcp-tool-search.js";
import {
  STREAM_PROTOCOL_VERSION,
  computePolicyDigest,
  computeToolsHash,
  buildLoadedSources,
  buildAgentCapabilities,
} from "../lib/headless-manifest.js";
import {
  negotiateProtocol,
  buildServerOffer,
  applyNegotiationToGate,
} from "../lib/capability-negotiation.js";
import { IterationBudget } from "../lib/iteration-budget.js";
import { CostBudget } from "../lib/cost-budget.js";
import {
  resolvePermissionMode,
  resolveEnabledTools,
  parseToolList,
  installPipeSafety,
} from "./headless-runner.js";
import {
  startSession as jsonlStartSession,
  appendUserMessage as jsonlAppendUserMessage,
  appendAssistantMessage as jsonlAppendAssistantMessage,
  appendTokenUsage as jsonlAppendTokenUsage,
  appendToolCallCompact as jsonlAppendToolCallCompact,
  appendLlmRetryCompact as jsonlAppendLlmRetryCompact,
  appendCompactEventIfMessagesMatch as jsonlAppendCompactEventIfMessagesMatch,
  appendEvent as jsonlAppendEvent,
  appendAuthorityEvent as jsonlAppendAuthorityEvent,
  readEvents as jsonlReadEvents,
  readVerifiedEvents as jsonlReadVerifiedEvents,
  readVerifiedProjection as jsonlReadVerifiedProjection,
  findLatestEvent as jsonlFindLatestEvent,
  sessionExists as jsonlSessionExists,
  sessionHasPersistedEvidence as jsonlSessionHasPersistedEvidence,
} from "../harness/jsonl-session-store.js";
import {
  isVerifiedSessionHostSnapshot,
  readSessionHostResumeState,
} from "../lib/session-host-snapshot.js";
import { acquireSessionHostLease } from "../lib/session-host-lease.js";
import {
  openProductionSessionBudgetRoot,
  sessionBudgetAdmissionError,
} from "../lib/session-budget-production-root.js";
import {
  beginSessionBudgetUsage,
  markSessionBudgetUsageUnknown,
  recordSessionBudgetUsage,
  rejectSessionBudgetUsageUnknown,
} from "../lib/session-budget-usage.js";
import { classifyStreamRetryReason } from "../lib/stream-retry.js";
import {
  SideEffectLedger,
  reconcileSideEffects,
  classifyToolSideEffect,
} from "../lib/side-effect-ledger.js";
import { collectToolResourceIdentifiers } from "../lib/permission-side-effect-center.js";
import { DiffReviewFollowUpTracker } from "../lib/diff-review-follow-up.js";
import {
  loadSideEffectLedger,
  persistSideEffectLedger,
} from "../lib/side-effect-ledger-store.js";
import {
  createSessionMcpLedgerSink,
  formatMcpLedgerRecoveryNotice,
} from "../lib/mcp-call-ledger-store.js";
import { createMcpHostRecoveryRuntime } from "../lib/mcp-host-recovery-runtime.js";
import { operationIdempotencyKey } from "../lib/idempotency.js";
import { TurnBindingLog, createTurnBindingFeed } from "../lib/turn-binding.js";
import { TURN_BINDING_EVENT } from "../lib/turn-binding-store.js";
import { getPlanModeManager } from "../lib/plan-mode.js";
import {
  SESSION_SLASH_COMMANDS,
  executeSessionSlashCommand,
  parseSessionSlashCommandEvent,
} from "./session-slash-commands.js";
import { extractPluginUsageAttribution } from "../lib/plugin-usage-attribution.js";
import { createHeadlessOutputBackpressure } from "./output-backpressure.js";
import {
  cleanupDeadlineError,
  createCleanupDeadline,
} from "./cleanup-deadline.js";
import {
  createSessionPersistenceFailure,
  projectSessionPersistenceFailure,
} from "../lib/session-persistence-failure.js";
import {
  projectRuntimeTokenUsage,
  projectRuntimeUsageBoundary,
  runtimeUsageEventType,
  markRuntimeLedgerPersistenceError,
} from "../lib/runtime-usage-ledger.js";

function invalidMcpRecoveryTransaction(capability, expected) {
  const error = new TypeError(
    `${capability} must ${expected} synchronously during MCP recovery`,
  );
  error.code = "CC_MCP_LEDGER_RECOVERY_TRANSACTION_INVALID";
  return error;
}

function requireSynchronousRecoveryResult(value, capability) {
  if (
    value === null ||
    value === undefined ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return value;
  }
  if (isProxy(value)) {
    throw invalidMcpRecoveryTransaction(capability, "return a non-Proxy value");
  }
  if (typeof value.then === "function") {
    // The async result is never authority, but a rejected Promise still needs
    // an observer so rejecting it fail-closed does not leak an unhandled
    // rejection into the host process.
    void Promise.resolve(value).catch(() => {});
    throw invalidMcpRecoveryTransaction(capability, "complete");
  }
  return value;
}

/**
 * Resolve the streaming-delta coalesce window (ms). Adjacent partial-message
 * text/thinking deltas are batched into a single `stream_event` line over this
 * window, cutting per-token JSON.stringify + write + downstream parse/postMessage
 * overhead (Claude-Code 2.1.191: "Reduced CPU usage during streaming responses by
 * coalescing text updates"). `0` (or a negative / non-numeric value) disables
 * batching, restoring the exact per-token emit behavior. Precedence:
 * explicit `options.streamCoalesceMs` > `CC_STREAM_COALESCE_MS` env > default 50.
 */
export function resolveStreamCoalesceMs(options = {}, env = {}) {
  const pick =
    options.streamCoalesceMs !== undefined
      ? options.streamCoalesceMs
      : env.CC_STREAM_COALESCE_MS;
  if (pick === undefined || pick === null || pick === "") return 50;
  const n = Number(pick);
  if (!Number.isFinite(n) || n < 0) return 50;
  return n;
}

/** Basic wire-safe trace-id sanitizer: keep only id-friendly chars, cap length
 *  (so an injected id can't smuggle whitespace/newlines into NDJSON or blow up
 *  a log line). Non-string / empty after trimming → falsy so a fresh one mints. */
function sanitizeTraceId(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[^A-Za-z0-9._:-]/g, "");
  return cleaned ? cleaned.slice(0, 128) : null;
}

/**
 * Resolve the run's cross-event trace id (additive protocol-v1, §1.2.1).
 * Precedence: explicit `options.traceId` > `CC_TRACE_ID` env > a freshly
 * minted per-process id. Callers may inject `deps.genTraceId` for
 * deterministic tests. The result is sanitized so an externally supplied id
 * stays a safe single NDJSON token.
 */
export function resolveTraceId(options = {}, env = {}, deps = {}) {
  const supplied =
    sanitizeTraceId(options.traceId) || sanitizeTraceId(env.CC_TRACE_ID);
  if (supplied) return supplied;
  const gen = deps.genTraceId || (() => `tr-${randomUUID()}`);
  return gen();
}

/**
 * Coalescer for the NDJSON output stream. Every line still flows through `emit`,
 * but consecutive partial-message text/thinking deltas are buffered and flushed
 * as one batched `stream_event` line: on a short timer (`coalesceMs`), whenever a
 * delta of the OTHER kind or any non-delta line is emitted (so ordering is always
 * preserved — a batched text run is flushed before the tool_use/result that
 * follows it), and at stream end (the terminal line routes through `emit`). With
 * `coalesceMs <= 0` deltas pass straight through, matching the legacy behavior.
 *
 * The flush timer is `unref()`d so it never holds the process open. Pure aside
 * from the injected `writeOut`/timer seams, so it unit-tests deterministically.
 *
 * Every emitted NDJSON line is stamped with a monotonic 1-based `seq`
 * (additive protocol-v1 field, agent-sdk docs/PROTOCOL.md §1.2.1) — the
 * coalescer is the single output choke point, so numbering here covers every
 * line including batched delta runs (one seq per LINE, not per token).
 * `stampSeq:false` restores the unstamped legacy output.
 *
 * When a `traceId` is provided, every line is ALSO stamped with `trace_id` —
 * a run-scoped cross-event correlation id (additive protocol-v1, §1.2.1). It
 * is opt-in (default: absent, legacy shape) so the IDE bridge can thread its
 * own id end-to-end (CC_TRACE_ID / --trace-id) while unstamped callers stay
 * byte-identical.
 */
export function createStreamCoalescer({
  writeOut,
  coalesceMs = 50,
  setTimer,
  clearTimer,
  stampSeq = true,
  traceId = null,
  fieldGate = null,
} = {}) {
  let seq = 0;
  // `fieldGate` (if provided) is read LIVE per line so a capability
  // negotiation arriving mid-stream (client `hello`) can suppress an additive
  // field the client said it can't parse. Absent / undefined key = stamp (so
  // the default path is byte-for-byte unchanged); only an explicit `false`
  // suppresses. See lib/capability-negotiation.js applyNegotiationToGate.
  const gateOn = (field) => !fieldGate || fieldGate[field] !== false;
  const rawEmit = (obj) => {
    let line = obj;
    if (
      !gateOn("permission_decision") &&
      (Object.prototype.hasOwnProperty.call(line, "permission_decision") ||
        Object.prototype.hasOwnProperty.call(line, "permission_decision_id"))
    ) {
      line = { ...line };
      delete line.permission_decision;
      delete line.permission_decision_id;
    }
    if (traceId && gateOn("trace_id")) line = { ...line, trace_id: traceId };
    if (stampSeq && gateOn("seq")) line = { ...line, seq: ++seq };
    writeOut(JSON.stringify(line) + "\n");
  };
  const startTimer =
    setTimer ||
    ((fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    });
  const stopTimer = clearTimer || ((t) => clearTimeout(t));

  let pending = null; // { kind: "text" | "thinking", text: string }
  let timer = null;

  const buildLine = (kind, text) => ({
    type: "stream_event",
    event: {
      type: "content_block_delta",
      delta:
        kind === "thinking"
          ? { type: "thinking_delta", thinking: text }
          : { type: "text_delta", text },
    },
  });

  const flush = () => {
    if (timer != null) {
      stopTimer(timer);
      timer = null;
    }
    if (!pending) return;
    const p = pending;
    pending = null;
    rawEmit(buildLine(p.kind, p.text));
  };

  const delta = (kind, text) => {
    if (!(coalesceMs > 0)) {
      rawEmit(buildLine(kind, text));
      return;
    }
    if (pending && pending.kind !== kind) flush();
    if (!pending) pending = { kind, text: "" };
    pending.text += text;
    if (timer == null) timer = startTimer(flush, coalesceMs);
  };

  return {
    // Any non-delta line flushes pending deltas first to preserve ordering.
    emit: (obj) => {
      flush();
      rawEmit(obj);
    },
    emitTextDelta: (text) => delta("text", text),
    emitThinkingDelta: (text) => delta("thinking", text),
    flush,
  };
}

/**
 * Structured view of the global plan-mode state for `plan_update` events
 * (the chat panel renders its plan card from this). Pure read; never throws.
 */
export function planSnapshot(pm) {
  let items = [];
  let risk = null;
  let planId = null;
  let planVersion = null;
  let previousPlanId = null;
  let executionLock = null;
  try {
    const plan = pm.currentPlan;
    planId = plan?.id || null;
    planVersion = plan?.version || null;
    previousPlanId = plan?.revisionOf || null;
    items = (plan?.items || []).map((i) => ({
      id: i.id,
      title: i.title,
      tool: i.tool,
      impact: i.estimatedImpact || "low",
      status: i.status,
      ...(i.turn ? { turn: i.turn } : {}),
      ...(i.toolUseId ? { tool_use_id: i.toolUseId } : {}),
      ...(i.startedAt ? { started_at: i.startedAt } : {}),
      ...(i.completedAt ? { completed_at: i.completedAt } : {}),
      ...(i.error ? { error: String(i.error).slice(0, 1000) } : {}),
    }));
    if (items.length > 0) {
      const r = pm.getRiskAssessment();
      if (r) risk = { level: r.level, totalScore: r.totalScore };
    }
    executionLock = pm.getExecutionLock?.() || null;
  } catch {
    /* snapshot is best-effort */
  }
  return {
    active: pm.isActive(),
    state: pm.state || null,
    plan_id: planId,
    plan_version: planVersion,
    previous_plan_id: previousPlanId,
    items,
    risk,
    ...(executionLock ? { execution_lock: executionLock } : {}),
  };
}

const MAX_PLAN_REVIEW_SNAPSHOT_CHARS = 24000;
const MAX_PLAN_REVIEW_COMMENTS = 64;
const MAX_PLAN_REVIEW_COMMENT_CHARS = 2000;
const HOST_EVENT_BACKLOG_CODE = "CC_HOST_EVENT_BACKLOG_EXHAUSTED";
const HOST_EVENT_BACKLOG_ERROR =
  "CC_HOST_EVENT_BACKLOG_EXHAUSTED: event backlog limit reached";

function boundedReviewString(value, limit) {
  return String(value == null ? "" : value).slice(0, limit);
}

function normalizePlanReviewComments(values) {
  const out = [];
  let remaining = MAX_PLAN_REVIEW_SNAPSHOT_CHARS;
  for (const raw of Array.isArray(values)
    ? values.slice(0, MAX_PLAN_REVIEW_COMMENTS)
    : []) {
    if (!raw || typeof raw !== "object" || remaining <= 0) continue;
    const text = boundedReviewString(
      raw.text,
      Math.min(MAX_PLAN_REVIEW_COMMENT_CHARS, remaining),
    ).trim();
    if (!text) continue;
    remaining -= text.length;
    const positive = (value) => {
      const number = Number(value);
      return Number.isInteger(number) && number > 0 ? number : null;
    };
    out.push({
      id: boundedReviewString(raw.id, 160) || `comment-${out.length + 1}`,
      sourceLine: positive(raw.sourceLine),
      itemId: boundedReviewString(raw.itemId, 160) || null,
      text,
      file: boundedReviewString(raw.file, 1024) || null,
      line: positive(raw.line),
      column: positive(raw.column),
      turn: positive(raw.turn),
    });
  }
  return out;
}

function normalizePlanExecutionLock(value) {
  if (!value || typeof value !== "object") return null;
  const strings = (input, limit = 128) => [
    ...new Set(
      (Array.isArray(input) ? input : [])
        .slice(0, limit)
        .map((entry) => boundedReviewString(entry, 160))
        .filter(Boolean),
    ),
  ];
  return {
    planId: boundedReviewString(value.planId, 160),
    permissionMode: boundedReviewString(value.permissionMode, 64) || "default",
    approvedItemIds: strings(value.approvedItemIds),
    allowedTools: strings(value.allowedTools),
    ...(value.createdAt
      ? { createdAt: boundedReviewString(value.createdAt, 64) }
      : {}),
  };
}

function planReviewFromInput(obj) {
  const review =
    obj && obj.review && typeof obj.review === "object" ? obj.review : null;
  const snapshot =
    typeof obj?.snapshot === "string"
      ? obj.snapshot
      : typeof review?.snapshot === "string"
        ? review.snapshot
        : "";
  const comments = normalizePlanReviewComments(review?.comments);
  if (!snapshot.trim() && comments.length === 0) return null;
  const text =
    snapshot.length > MAX_PLAN_REVIEW_SNAPSHOT_CHARS
      ? snapshot.slice(0, MAX_PLAN_REVIEW_SNAPSHOT_CHARS) +
        `\n\n[review snapshot truncated: ${snapshot.length - MAX_PLAN_REVIEW_SNAPSHOT_CHARS} chars omitted]`
      : snapshot;
  return {
    action: String(review?.action || obj.action || "").toLowerCase(),
    reviewedAt:
      typeof review?.reviewedAt === "string" ? review.reviewedAt : null,
    conversationId:
      typeof review?.conversationId === "string" ? review.conversationId : null,
    revision:
      Number.isInteger(review?.revision) && review.revision > 0
        ? review.revision
        : null,
    comments,
    executionLock: normalizePlanExecutionLock(review?.executionLock),
    snapshot: text,
  };
}

function planReviewSystemMessage(review) {
  if (!review || (!review.snapshot && !review.comments?.length)) return null;
  const meta = [
    review.action ? `action=${review.action}` : null,
    review.reviewedAt ? `reviewedAt=${review.reviewedAt}` : null,
    review.conversationId ? `conversationId=${review.conversationId}` : null,
    review.revision ? `revision=${review.revision}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const sections = [
    "[PLAN REVIEW SNAPSHOT]" + (meta ? ` ${meta}` : ""),
    review.snapshot || "(no Markdown snapshot)",
  ];
  if (review.comments?.length) {
    sections.push(
      "[PLAN REVIEW STRUCTURED COMMENTS]",
      JSON.stringify(review.comments),
    );
  }
  if (review.executionLock) {
    sections.push(
      "[PLAN REVIEW REQUESTED EXECUTION LOCK - AUDIT ONLY]",
      JSON.stringify(review.executionLock),
    );
  }
  return sections.join("\n");
}
import { withQuietStdout } from "./quiet-stdout.js";

/**
 * Parse one NDJSON input line into { text } / { error } / null (blank → skip).
 */
export function parseInputEvent(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { error: `invalid JSON line: ${trimmed.slice(0, 80)}` };
  }
  // Capability handshake (agent-sdk docs/PROTOCOL.md §1.3): an optional first
  // line by which the client announces the protocol range + wire features it
  // understands, so the CLI can negotiate a common level and step down on
  // disagreement. {"type":"hello","protocol_version":2,"features":[...]}
  if (obj && typeof obj === "object" && obj.type === "hello") {
    const offer = {};
    if (obj.protocol_version !== undefined)
      offer.protocolVersion = obj.protocol_version;
    if (obj.min_protocol_version !== undefined)
      offer.minProtocolVersion = obj.min_protocol_version;
    if (obj.features !== undefined) offer.features = obj.features;
    return { hello: offer };
  }
  // Session-scoped slash commands (IDE panel / SDK control plane). These are
  // dispatched against live session state and never become model turns:
  //   {"type":"slash_command","command":"status","args":"","request_id":"r1"}
  const slashCommand = parseSessionSlashCommandEvent(obj);
  if (slashCommand) return { slashCommand };
  // Plan-mode control events (chat-panel plan UI):
  //   {"type":"plan","action":"enter"|"approve"|"reject"}
  if (obj && typeof obj === "object" && obj.type === "plan") {
    const rawAction = String(obj.action || "").toLowerCase();
    const action = rawAction === "requestchanges" ? "revise" : rawAction;
    if (!action) return null;
    const planReview = planReviewFromInput(obj);
    return planReview ? { plan: action, planReview } : { plan: action };
  }
  // Turn interrupt (panel Stop / Claude-Code Esc parity): aborts the
  // in-flight turn without ending the conversation. {"type":"interrupt"}
  if (obj && typeof obj === "object" && obj.type === "interrupt") {
    return { interrupt: true };
  }
  // Manual compaction (panel `/compact`, Claude-Code IDE parity): trim the
  // live conversation history in place between turns. {"type":"compact"}
  if (obj && typeof obj === "object" && obj.type === "compact") {
    return { compact: true };
  }
  // Approval verdicts (panel/SDK for --interactive-approvals). New clients
  // send the canonical structured decision and echo the request binding. The
  // boolean remains an N-1 migration field for older clients only.
  //   {"type":"approval","id":"appr-1","decision":{"kind":"acceptOnce"},"binding":"..."}
  //   {"type":"approval","id":"appr-1","approve":true|false} // legacy
  if (obj && typeof obj === "object" && obj.type === "approval") {
    if (!obj.id) return null;
    const structured = obj.decision !== undefined;
    let decision;
    let invalidReason = null;
    if (structured) {
      const validation = validateApprovalDecision(obj.decision);
      if (validation.ok) {
        decision = obj.decision;
      } else {
        invalidReason = "invalid-decision";
        decision = {
          kind: "decline",
          reason: "Invalid structured approval decision",
        };
      }
    } else {
      decision =
        obj.approve === true
          ? { kind: "acceptOnce" }
          : { kind: "decline", reason: "Legacy boolean denial" };
    }
    const approve = [
      "acceptOnce",
      "acceptForTurn",
      "acceptForSession",
    ].includes(decision.kind);
    if (
      !invalidReason &&
      structured &&
      typeof obj.approve === "boolean" &&
      obj.approve !== approve
    ) {
      invalidReason = "decision-boolean-mismatch";
      decision = {
        kind: "decline",
        reason: "Structured and legacy approval verdicts disagree",
      };
    }
    return {
      approval: {
        id: String(obj.id),
        approve: invalidReason ? false : approve,
        decision,
        structured,
        invalidReason,
        // Optional approval binding (authority §"权限来源与跨 Agent 授权边界"):
        // when present it must match the digest the matching approval_request
        // advertised, so a stale/mis-routed/param-substituted verdict can't
        // green-light a different tool call. Absent → legacy behavior.
        binding: typeof obj.binding === "string" ? obj.binding : null,
      },
    };
  }
  // Answer to an ask_user_question (panel QuickPick for interactive questions):
  //   {"type":"answer","id":"q-1","answer":<string|string[]|null>}
  // A null/absent answer cancels (handler → user_timeout, model proceeds).
  if (obj && typeof obj === "object" && obj.type === "answer") {
    if (!obj.id) return null;
    return {
      answer: {
        id: String(obj.id),
        value: obj.answer === undefined ? null : obj.answer,
        ...(obj.binding && typeof obj.binding === "object"
          ? { binding: normalizeInteractionBinding(obj.binding) }
          : {}),
      },
    };
  }
  // PDH self-learning feedback (design module 101 §3.5.13). The personal-data
  // chat's 纠正卡 sends {"type":"feedback","turn_id":…,"kind":"positive"|
  // "negative"|"correction","comment":…} after a reply. A missing kind → skip.
  if (obj && typeof obj === "object" && obj.type === "feedback") {
    const kind = String(obj.kind || "").toLowerCase();
    if (!kind) return null;
    return {
      feedback: {
        turnId: obj.turn_id != null ? String(obj.turn_id) : null,
        kind,
        comment: typeof obj.comment === "string" ? obj.comment : null,
      },
    };
  }
  // PDH guided-collection resume (design module 101 §3.5.15). When a PDH tool
  // returns assist_required (e.g. "log into the app first") the chat's 引导卡
  // sends {"type":"resume","token":…,"action":"completed"|"skip"} once the user
  // finishes or skips the in-app step. A missing action → skip.
  if (obj && typeof obj === "object" && obj.type === "resume") {
    const action = String(obj.action || "").toLowerCase();
    if (!action) return null;
    return {
      resume: {
        token: obj.token != null ? String(obj.token) : null,
        action,
      },
    };
  }
  const msg = obj && typeof obj === "object" ? obj.message || obj : {};
  let content = msg.content ?? obj.text ?? obj.prompt;
  if (Array.isArray(content)) {
    content = content
      .map((b) => (typeof b === "string" ? b : b?.text || ""))
      .join("");
  }
  // Vision input (chat-panel image paste): {"type":"user","text":…,
  // "images":["/abs/file.png", …]} — file paths, resolved at turn build via
  // the same image-input pipeline as `cc agent --image`.
  const rawImages =
    obj && typeof obj === "object" ? obj.images || msg.images : null;
  let images = Array.isArray(rawImages)
    ? rawImages.filter((p) => typeof p === "string" && p.trim())
    : [];
  // Claude-Code-style: auto-attach local image-file paths the user typed into
  // the message (so "describe ./shot.png" reads the image, like Claude Code).
  // Opt out with CC_AUTO_IMAGE=0. Explicit `images` (paste) still win.
  if (
    typeof content === "string" &&
    content.trim() &&
    process.env.CC_AUTO_IMAGE !== "0"
  ) {
    const detected = detectImagePaths(content);
    if (detected.images.length) {
      images = [...images, ...detected.images];
      content = detected.text;
    }
  }
  images = [...new Set(images)].slice(0, 8);
  // §3.5.10 接线6: optional per-turn LLM override (PDH privacy-tier switch) —
  // {"type":"user","text":…,"llm":{"provider","model","baseUrl"?,"apiKey"?}}.
  // Switches THIS turn's model (e.g. cloud → your own PC Ollama) without
  // restarting the session. Reuses the same per-turn loopOptions seam as vision.
  const llm = sanitizeLlmHint(
    obj && typeof obj === "object" ? obj.llm || msg.llm : null,
  );
  if (typeof content !== "string" || !content.trim()) {
    // An image-only turn is valid — give the model something to act on.
    if (images.length) {
      const r = { text: "Please look at the attached image(s).", images };
      if (llm) r.llm = llm;
      return r;
    }
    return null;
  }
  const result = images.length ? { text: content, images } : { text: content };
  if (llm) result.llm = llm;
  return result;
}

/**
 * §3.5.10 接线6: sanitize a per-turn LLM override hint. Requires at least a
 * provider or model (string); baseUrl/apiKey optional. Returns null when absent
 * or malformed (the turn then uses the session default).
 */
export function sanitizeLlmHint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const provider = str(raw.provider);
  const model = str(raw.model);
  if (!provider && !model) return null;
  const hint = {};
  if (provider) hint.provider = provider;
  if (model) hint.model = model;
  const baseUrl = str(raw.baseUrl);
  if (baseUrl) hint.baseUrl = baseUrl;
  const apiKey = str(raw.apiKey);
  if (apiKey) hint.apiKey = apiKey;
  return hint;
}

/**
 * Yield NDJSON lines from a byte/string stream (stdin). Splits on "\n" and
 * flushes any trailing partial line when the stream ends.
 *
 * A single line with no terminating "\n" must never accumulate without bound:
 * a stuck / garbage producer (or a runaway multi-MB inline payload) that never
 * emits a newline would otherwise grow `buf` unbounded and OOM this long-lived
 * stream process. When a line exceeds the cap, a short head is yielded (so the
 * caller surfaces it as an invalid-JSON error rather than dropping it silently)
 * and the rest of that monster line is discarded until its newline — the stream
 * resyncs cleanly to the next well-formed line. Cap precedence:
 * `opts.maxLineLength` > `CC_MAX_INPUT_LINE_BYTES` env > 16 MB default.
 */
export async function* readJsonLines(input, opts = {}) {
  const envCap = Number(process.env.CC_MAX_INPUT_LINE_BYTES);
  const maxLineLength =
    Number.isFinite(opts.maxLineLength) && opts.maxLineLength > 0
      ? opts.maxLineLength
      : Number.isFinite(envCap) && envCap > 0
        ? envCap
        : 16 * 1024 * 1024;
  let buf = "";
  let overflow = false; // discarding the tail of an over-long line until its \n
  // Reuse ONE streaming decoder across chunks so a multi-byte UTF-8 character
  // (e.g. a 3-byte Chinese char) split across two Buffer chunks is reassembled
  // rather than corrupted. process.stdin yields Buffers with no setEncoding, so
  // a per-chunk `chunk.toString("utf-8")` would turn a split character into
  // U+FFFD replacement chars.
  const decoder = new TextDecoder();
  for await (const chunk of input) {
    buf +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
    // Still skipping past an over-long line: drop everything up to (and
    // including) the next newline, then resume normal line parsing. While no
    // newline has arrived, keep `buf` empty so we don't re-grow it.
    if (overflow) {
      const nl = buf.indexOf("\n");
      if (nl < 0) {
        buf = "";
        continue;
      }
      buf = buf.slice(nl + 1);
      overflow = false;
    }
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, idx);
      buf = buf.slice(idx + 1);
    }
    // No newline in the remaining buffer and it has blown past the cap — this is
    // a pathological unterminated line. Yield a short head (an invalid-JSON
    // error for the caller) and discard the rest until the next newline.
    if (buf.length > maxLineLength) {
      yield buf.slice(0, 200);
      buf = "";
      overflow = true;
    }
  }
  buf += decoder.decode(); // flush any bytes held from a final partial char
  if (!overflow && buf.trim()) yield buf;
}

/**
 * P0-2: on a stream resume, surface any irreversible tool that was in flight
 * when the prior run died. Same reconcile + wording as the single-prompt
 * runner (headless-runner.js) and the WS bridge (session-protocol.js): a
 * `started`-but-unsettled op's outcome is UNKNOWN, so the model must VERIFY
 * before any replay rather than silently re-issue the effect. Returns
 * {count, items, notice} or null when nothing needs verification — a clean
 * (or absent) ledger keeps the resume byte-identical to today.
 */
function buildSideEffectRecovery(ledger) {
  try {
    const plan = reconcileSideEffects(ledger);
    if (!plan.inspect.length) return null;
    const items = plan.plans
      .filter((p) => p.action === "inspect")
      .map((p) => {
        const op = ledger.get(p.opId) || {};
        return {
          kind: op.kind || "unknown",
          key: op.key || null,
          reason: p.reason,
        };
      });
    const notice =
      "Recovery notice — the previous run was interrupted while these " +
      "irreversible operations were in flight; their outcome is UNKNOWN. Do " +
      "NOT blindly re-run them. Verify whether each already took effect before " +
      "repeating it, and ask the user if unsure:\n" +
      items
        .map(
          (it) =>
            `  • [${it.kind}]${it.key ? ` (${it.key})` : ""} — ${it.reason}`,
        )
        .join("\n");
    return { count: items.length, items, notice };
  } catch {
    return null;
  }
}

/**
 * Run a single turn through the core agent loop, emitting NDJSON events.
 * Returns the turn outcome so the caller can grow history + the result line.
 */
async function runTurn(
  messages,
  loopOptions,
  {
    runLoop,
    emit,
    costBudget,
    nextToolUseId,
    sideEffects,
    turnNumber,
    turnBindingFeed,
    waitForOutput,
    persistUsageEvent,
    persistToolEvent,
    sessionBudget,
    evolutionIngress = null,
    emitPolicyDecisionEvents = false,
    now = Date.now,
  },
) {
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  const toolCalls = [];
  let finalText = "";
  let endReason = "complete";
  let stopForCost = false;
  let stopForCompactionUsageUnknown = false;
  let responseCompleted = false;
  // P0-2: the side-effect op currently in flight (at most one — the loop runs
  // tools serially). Non-null only between a dangerous tool's tool-executing
  // and its tool-result.
  let currentSideEffectOpId = null;
  // Precise tool telemetry is normally carried by tool-result. Keep private
  // event-boundary fallbacks keyed by call id because read-only batches can run
  // concurrently after every start boundary is persisted.
  const toolStartedAt = new Map();
  const diffReviewFollowUps = new DiffReviewFollowUpTracker(
    sideEffects?.ledger,
  );

  // Collapse consecutive same-role turns before the model call ONLY when the
  // caller flags a resume-degenerate transcript (`mergeRoles`): a resumed
  // session whose previous run produced NO assistant response leaves a trailing
  // bare `user` turn, so splicing the first live prompt after it sends two
  // adjacent `user` messages — which Anthropic/Bedrock reject as "roles must
  // alternate" (Claude Code 2.1.187 parity). It is GATED rather than applied
  // every turn because the live turn loop legitimately produces consecutive
  // `user` messages — an interrupted turn's dangling prompt, a PDH feedback
  // note (§3.5.13) — that must reach the model distinctly and must not be
  // folded (folding the interrupt-dangling turn even resurrects the abandoned
  // request).
  //
  // Collapse IN PLACE (not a folded copy): the persistent `messages` array is
  // reused for every later turn, so leaving the `[user, user]` pair in it would
  // re-break the SECOND live turn (which re-sends the lingering pair). The gated
  // turn is the first after resume, still tool-free (resumed history is
  // user/assistant/system only), so an in-place fold is safe and the helper
  // never folds `tool` turns regardless. Un-gated later turns are untouched, so
  // the intentional interrupt/feedback consecutive-`user` states are preserved.
  if (loopOptions.mergeRoles) {
    collapseConsecutiveMessagesInPlace(messages);
  }
  for await (const event of runLoop(messages, loopOptions)) {
    if (evolutionIngress !== null) {
      await evolutionIngress.ingestAgentEvent(event);
    }
    turnBindingFeed?.handleEvent(event);
    switch (event.type) {
      case "tool-executing": {
        // Additive protocol-v1 correlation id ("tu-<n>", session-scoped —
        // agent-sdk docs/PROTOCOL.md §1.2.1): the matching tool_result below
        // echoes the same id so UIs can pair calls without adjacency.
        const toolUseId =
          event.tool_use_id || (nextToolUseId ? nextToolUseId() : undefined);
        const pm = getPlanModeManager();
        const planItem = pm.startPlanItemForTool(event.tool, {
          toolUseId,
          turn: turnNumber,
        });
        toolCalls.push({
          id: toolUseId,
          tool: event.tool,
          args: event.args,
          planItemId: planItem?.id || null,
        });
        toolStartedAt.set(toolUseId, now());
        persistToolEvent?.("started", toolCalls[toolCalls.length - 1]);
        emit({
          type: "tool_use",
          ...(toolUseId ? { id: toolUseId } : {}),
          ...(planItem?.id ? { plan_item_id: planItem.id } : {}),
          ...(planItem?.turn ? { turn: planItem.turn } : {}),
          tool: event.tool,
          args: event.args,
        });
        if (planItem) {
          emit({ type: "plan_update", ...planSnapshot(pm) });
        }
        // P0-2: record an irreversible effect as STARTED (persisted before it
        // settles) so a crash before the matching tool-result leaves a
        // reconcilable "in flight" marker instead of a silent replay — mirrors
        // the single-prompt runner and the WS bridge. `sideEffects` is null
        // when the session doesn't persist, keeping that path byte-identical.
        currentSideEffectOpId = null;
        if (sideEffects) {
          const se = classifyToolSideEffect(event.tool, event.args);
          if (se) {
            const opId = sideEffects.nextOpId();
            currentSideEffectOpId = opId;
            sideEffects.ledger
              .prepare(opId, {
                kind: se.kind,
                key: se.key,
                // Content-addressed key: a resumed replay of the SAME effect
                // derives the SAME key, so an external provider can de-dupe
                // and countDuplicateCommittedEffects can measure `0` repeats.
                meta: {
                  tool: event.tool,
                  toolUseId: toolUseId || null,
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
            sideEffects.persist();
            sideEffects.assert?.();
          }
        }
        break;
      }
      case "tool-result": {
        const err = event.error || event.result?.error || null;
        // P0-2: settle the in-flight side-effect (commit on success, fail on
        // a clean error) and persist the updated ledger snapshot.
        if (sideEffects && currentSideEffectOpId) {
          if (event.permission_decision) {
            sideEffects.ledger.annotate(currentSideEffectOpId, {
              permissionDecision: event.permission_decision,
            });
          }
          if (event.result?._diffReviewAudit) {
            diffReviewFollowUps.observe(
              sideEffects.ledger,
              currentSideEffectOpId,
              event.result._diffReviewAudit,
            );
          }
          if (err)
            sideEffects.ledger.fail(
              currentSideEffectOpId,
              String(err).slice(0, 200),
            );
          else sideEffects.ledger.commit(currentSideEffectOpId);
          sideEffects.persist();
          currentSideEffectOpId = null;
        }
        // The loop runs tools serially, so this result settles the most
        // recent tool_use (same adjacency rule the is_error attribution
        // below has always used).
        const lastCall =
          (event.tool_use_id
            ? toolCalls.find((call) => call.id === event.tool_use_id)
            : null) ||
          (toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : null);
        if (lastCall) {
          lastCall.is_error = Boolean(err);
          lastCall.durationMs =
            event.result?.toolTelemetryRecord?.durationMs ??
            (toolStartedAt.get(lastCall.id) === undefined
              ? undefined
              : Math.max(0, now() - toolStartedAt.get(lastCall.id)));
          Object.assign(lastCall, extractPluginUsageAttribution(event.result));
          persistToolEvent?.("settled", {
            ...lastCall,
            invocationReceipt: event.result?.invocationReceipt,
          });
        }
        if (lastCall) toolStartedAt.delete(lastCall.id);
        const pm = getPlanModeManager();
        const settledItem = lastCall?.planItemId
          ? pm.settlePlanItem(lastCall.planItemId, {
              success: !err,
              error: err,
              result: event.result,
            })
          : null;
        emit({
          type: "tool_result",
          ...(lastCall?.id ? { id: lastCall.id } : {}),
          ...(lastCall?.planItemId
            ? { plan_item_id: lastCall.planItemId }
            : {}),
          ...(settledItem?.turn ? { turn: settledItem.turn } : {}),
          tool: event.tool,
          is_error: Boolean(err),
          error: err,
          result: event.result,
          ...(event.permission_decision_id
            ? { permission_decision_id: event.permission_decision_id }
            : {}),
          ...(event.permission_decision
            ? { permission_decision: event.permission_decision }
            : {}),
        });
        if (
          (typeof emitPolicyDecisionEvents === "function"
            ? emitPolicyDecisionEvents()
            : emitPolicyDecisionEvents) === true
        ) {
          const policyEvent = projectToolPolicyDecision(event, {
            sessionId: loopOptions.sessionId,
            turnId: event.turn_id,
            toolUseId: lastCall?.id,
          });
          if (policyEvent) emit(policyEvent);
        }
        if (settledItem) {
          emit({ type: "plan_update", ...planSnapshot(pm) });
        }
        break;
      }
      case "token-usage":
        if (event.ledgerPersisted !== true) persistUsageEvent?.(event);
        recordSessionBudgetUsage(
          sessionBudget,
          event,
          "headless usage settlement",
        );
        // 用量归因: attributed child-loop usage (sub-agent / isolated skill)
        // is forwarded on the stream (same wire shape) and counted toward the
        // cost budget, but stays out of the turn's `usage` envelope, which
        // keeps its long-standing main-loop-only semantics.
        if (!event.attribution) {
          usage.input_tokens += event.usage?.input_tokens || 0;
          usage.output_tokens += event.usage?.output_tokens || 0;
          // Carry prompt-cache tokens into the turn's accumulated usage so the
          // final `result` envelope (read by IDE panels) reflects caching too.
          usage.cache_read_input_tokens +=
            event.usage?.cache_read_input_tokens || 0;
          usage.cache_creation_input_tokens +=
            event.usage?.cache_creation_input_tokens || 0;
        }
        emit({
          type: "token_usage",
          provider: event.provider,
          model: event.model,
          usage: event.usage,
          ...(event.source ? { source: event.source } : {}),
        });
        if (costBudget) {
          costBudget.add({
            provider: event.provider,
            model: event.model,
            usage: event.usage,
          });
          if (costBudget.exceeded()) {
            endReason = "cost-budget-exhausted";
            stopForCost = true;
          }
        }
        break;
      case "model-usage-started":
      case "model-usage-unknown":
        if (event.ledgerPersisted !== true) persistUsageEvent?.(event);
        if (event.type === "model-usage-started") {
          beginSessionBudgetUsage(
            sessionBudget,
            event,
            "headless provider call",
          );
        } else if (markSessionBudgetUsageUnknown(sessionBudget, event)) {
          rejectSessionBudgetUsageUnknown(event, "headless provider call");
        }
        break;
      case "compaction-usage-unknown":
        if (event.ledgerPersisted !== true) {
          persistUsageEvent?.({
            ...event,
            type: "model-usage-unknown",
            code: event.code || "provider_transport_outcome_unknown",
          });
        }
        if (markSessionBudgetUsageUnknown(sessionBudget, event)) {
          rejectSessionBudgetUsageUnknown(
            event,
            "headless semantic compaction",
          );
        }
        emit({
          type: "compaction_usage_unknown",
          provider: event.provider,
          model: event.model,
          source: event.source || "semantic-compaction",
          reason: event.reason || "provider_transport_outcome_unknown",
          usage_outcome: "unknown",
        });
        endReason = "compaction-usage-unknown";
        stopForCompactionUsageUnknown = true;
        break;
      case "iteration-warning":
        emit({ type: "iteration_warning", message: event.message });
        break;
      case "iteration-budget-exhausted":
        endReason = "max_turns";
        emit({ type: "iteration_budget_exhausted", budget: event.budget });
        break;
      case "response-complete":
        finalText = event.content || "";
        responseCompleted = true;
        break;
      case "run-ended":
        if (event.reason) endReason = event.reason;
        break;
      default:
        if (event.type) emit(event);
        break;
    }
    await waitForOutput?.();
    // Hard cost cap reached — stop consuming the loop (break the for-await, not
    // just the switch) so no further paid LLM call is made.
    if (stopForCost || stopForCompactionUsageUnknown) break;
  }
  if (
    sideEffects &&
    diffReviewFollowUps.complete(sideEffects.ledger, {
      status:
        responseCompleted || endReason === "complete"
          ? "completed-without-reproposal"
          : "interrupted",
      reason: responseCompleted || endReason === "complete" ? null : endReason,
    }).length > 0
  ) {
    sideEffects.persist();
  }
  return { finalText, endReason, usage, toolCalls };
}

/**
 * Drive a multi-turn headless conversation from NDJSON stdin events.
 *
 * @param {object} options  same shape as runAgentHeadless (minus single prompt)
 * @param {object} [deps]   { input, bootstrap, getApprovalGate, agentLoop,
 *                            writeOut, writeErr, expandFileRefs }
 * @returns {Promise<{exitCode:number, turns:number}>}
 */
function createHeadlessStreamCleanupScope({ input, timeoutMs, onReport }) {
  let mcpClient = null;
  let remoteApproval = null;
  let inputCancel = null;
  let interactionCleanup = null;
  let outputCleanup = null;
  let sessionEnd = null;
  let reason = "error";
  let stopRequested = false;
  let interactionCleanupPromise = Promise.resolve();
  let cleanupPromise = null;

  const runBestEffort = async (operation) => {
    if (typeof operation !== "function") return;
    try {
      await operation();
    } catch {
      // Cleanup is exhaustive: one failing disposer must not prevent the
      // remaining resources from being retired.
    }
  };

  const stopInputOwner = () => {
    try {
      if (input && input.readableEnded !== true && input.destroyed !== true) {
        if (typeof input.destroy === "function") input.destroy();
        else input.pause?.();
      }
    } catch {
      // Best-effort for non-Node custom input objects.
    }
  };
  const cancelInputIterator = () => {
    try {
      Promise.resolve(inputCancel?.()).catch(() => {});
    } catch {
      // A custom async iterator may reject cancellation synchronously.
    }
  };
  const settleInteractions = () => {
    interactionCleanupPromise = runBestEffort(() =>
      interactionCleanup?.(reason),
    );
  };
  const requestStop = () => {
    if (stopRequested) return;
    stopRequested = true;
    stopInputOwner();
    cancelInputIterator();
    settleInteractions();
  };

  return {
    setReason(nextReason) {
      if (!stopRequested && !cleanupPromise && nextReason) {
        reason = String(nextReason);
      }
    },
    setMcpClient(client) {
      mcpClient = client || null;
    },
    setRemoteApproval(approval) {
      remoteApproval = approval || null;
    },
    setInputCancel(cancel) {
      inputCancel = typeof cancel === "function" ? cancel : null;
      if (stopRequested) cancelInputIterator();
    },
    setInteractionCleanup(cleanup) {
      interactionCleanup = typeof cleanup === "function" ? cleanup : null;
      if (stopRequested) settleInteractions();
    },
    setOutputCleanup(cleanup) {
      outputCleanup = typeof cleanup === "function" ? cleanup : null;
    },
    setSessionEnd(cleanup) {
      sessionEnd = typeof cleanup === "function" ? cleanup : null;
    },
    requestStop,
    cleanup() {
      if (!cleanupPromise) {
        cleanupPromise = (async () => {
          const deadline = createCleanupDeadline({
            timeoutMs,
            label: "headless-stream-cleanup",
          });
          // Stop the live stdin owner before network/process resources. A
          // flowing stdin iterator can otherwise keep the process alive after
          // an early return or exception.
          requestStop();
          await deadline.run("interactions", () => interactionCleanupPromise);
          await deadline.run("output-coalescer", () => outputCleanup?.(reason));
          await deadline.run("mcp", () => mcpClient?.disconnectAll?.());
          await deadline.run("remote-approval", () =>
            remoteApproval?.close?.(),
          );
          await deadline.run("session-end", () => sessionEnd?.(reason));
          const report = deadline.report();
          try {
            onReport?.(report);
          } catch {
            // Metrics/reporting cannot change cleanup semantics.
          }
          if (report.timedOut) throw cleanupDeadlineError(report);
          return report;
        })();
      }
      return cleanupPromise;
    },
  };
}

const STREAM_SESSION_ID = Symbol("streamSessionId");
const STREAM_SESSION_HOST_LEASE = Symbol("streamSessionHostLease");

async function withStreamSessionHostLease(options, deps, streamCleanup, task) {
  if (options.observabilityScope != null && options.ephemeral === true) {
    throw new Error(
      "observability scope requires durable session persistence and cannot be combined with ephemeral mode",
    );
  }
  const sessionId =
    options.sessionId || `headless-stream-${Date.now()}-${process.pid}`;
  const persist =
    (Boolean(options.sessionId) || options.observabilityScope != null) &&
    options.ephemeral !== true;
  const hasInjectedSessionStore =
    typeof deps.sessionHasPersistedEvidence === "function" ||
    typeof deps.sessionExists === "function" ||
    typeof deps.rebuildMessages === "function" ||
    typeof deps.appendCompactEventIfMessagesMatch === "function" ||
    typeof deps.appendEvent === "function" ||
    typeof deps.appendAuthorityEvent === "function" ||
    typeof deps.readVerifiedEvents === "function" ||
    typeof deps.readVerifiedProjection === "function";
  const acquireHostLease =
    deps.acquireSessionHostLease ||
    (!hasInjectedSessionStore ? acquireSessionHostLease : null);
  let lease = null;
  let budgetRoot = null;
  let onLeaseAbort = null;
  try {
    if (persist && typeof acquireHostLease === "function") {
      lease = acquireHostLease(sessionId, { hostKind: "headless-stream" });
      if (lease?.signal) {
        onLeaseAbort = () => {
          streamCleanup.setReason("session_host_lease_lost");
          streamCleanup.requestStop();
        };
        lease.signal.addEventListener("abort", onLeaseAbort, { once: true });
        if (lease.signal.aborted) onLeaseAbort();
      }
    }
    let scopedOptions = lease?.signal
      ? {
          ...options,
          signal: options.signal
            ? AbortSignal.any([options.signal, lease.signal])
            : lease.signal,
        }
      : options;
    budgetRoot = openProductionSessionBudgetRoot(
      persist ? sessionId : null,
      options.sessionBudgetRoot,
      {
        persist,
        signal: scopedOptions.signal || null,
        table: options.sessionBudgetRoot?.table,
        open: deps.openSessionBudget,
        store: deps.sessionBudgetStore,
        registry: deps.sessionBudgetRegistry,
      },
    );
    if (budgetRoot.enabled) {
      scopedOptions = { ...scopedOptions, ...budgetRoot.options };
    }
    return await task(scopedOptions, {
      ...deps,
      [STREAM_SESSION_ID]: sessionId,
      [STREAM_SESSION_HOST_LEASE]: lease,
    });
  } finally {
    budgetRoot?.close?.();
    if (lease?.signal && onLeaseAbort) {
      lease.signal.removeEventListener("abort", onLeaseAbort);
    }
    lease?.release?.();
  }
}

export async function runAgentHeadlessStream(options = {}, deps = {}) {
  const trustedWorkspaceRoot = options.cwd || process.cwd();
  const input = deps.input || process.stdin;
  const pipeState = { closed: false };
  const streamCleanup = createHeadlessStreamCleanupScope({
    input,
    timeoutMs: deps.cleanupDeadlineMs,
    onReport: deps.onCleanupReport,
  });
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;
  const shouldInstallPipeSafety =
    typeof deps.installPipeSafety === "function" ||
    (!deps.writeOut && !deps.writeErr);
  const pipeAbort = shouldInstallPipeSafety ? new AbortController() : null;
  const managesNativeOutput = !deps.writeOut || !deps.writeErr;
  const outputAbort = managesNativeOutput ? new AbortController() : null;
  const handlePipeClosed = () => {
    if (pipeState.closed) return;
    pipeState.closed = true;
    streamCleanup.setReason("pipe_closed");
    process.exitCode = 0;
    pipeAbort?.abort();
    streamCleanup.requestStop();
  };
  const outputFlow =
    deps.outputFlow ||
    createHeadlessOutputBackpressure({
      stdout,
      stderr,
      writeOut: deps.writeOut,
      writeErr: deps.writeErr,
      maxQueuedBytes: deps.outputBackpressureMaxBytes,
      drainTimeoutMs: deps.outputBackpressureTimeoutMs,
      onFailure: (error) => {
        outputAbort?.abort(error);
        if (error?.code === "EPIPE") handlePipeClosed();
      },
    });
  const abortSignals = [
    options.signal,
    pipeAbort?.signal,
    outputAbort?.signal,
  ].filter(Boolean);
  const runtimeOptions =
    abortSignals.length === 0
      ? options
      : {
          ...options,
          signal:
            abortSignals.length === 1
              ? abortSignals[0]
              : AbortSignal.any(abortSignals),
        };
  const runtimeDeps = {
    ...deps,
    writeOut: outputFlow.writeOut,
    writeErr: outputFlow.writeErr,
    outputFlow,
  };
  const onCallerAbort = () => {
    streamCleanup.setReason("aborted");
    streamCleanup.requestStop();
  };
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  if (options.signal?.aborted) onCallerAbort();
  const installSafety = deps.installPipeSafety || installPipeSafety;
  let disposePipeSafety = null;

  let outcome;
  let failure = null;
  try {
    disposePipeSafety = shouldInstallPipeSafety
      ? installSafety([stdout, stderr], handlePipeClosed)
      : null;

    outcome = await runWithHostHooksV2Workspace(trustedWorkspaceRoot, () =>
      withStreamSessionHostLease(
        runtimeOptions,
        runtimeDeps,
        streamCleanup,
        (scopedOptions, scopedDeps) =>
          runAgentHeadlessStreamInWorkspace(
            scopedOptions,
            scopedDeps,
            pipeState,
            streamCleanup,
          ),
      ),
    );
  } catch (error) {
    failure = error;
  } finally {
    try {
      await streamCleanup.cleanup();
    } catch (error) {
      failure ||= error;
    }
    try {
      await outputFlow.wait();
    } catch (error) {
      failure ||= error;
    }
    outputFlow.dispose();
    options.signal?.removeEventListener("abort", onCallerAbort);
    disposePipeSafety?.();
  }

  if (pipeState.closed && failure?.isCleanupDeadlineFailure !== true) {
    return { ...(outcome || { turns: 0 }), exitCode: 0 };
  }
  if (failure) throw failure;
  return outcome;
}

async function runAgentHeadlessStreamInWorkspace(
  options = {},
  deps = {},
  pipeState = { closed: false },
  streamCleanup,
) {
  const evolutionIngress =
    options.evolutionIngress == null
      ? null
      : captureAgentEvolutionIngress(options.evolutionIngress);
  const skillOutcomeIndex =
    options.skillOutcomeIndex == null
      ? null
      : captureAgentSkillOutcomeIndex(options.skillOutcomeIndex);
  const skillVectorAuthority =
    options.skillVectorAuthority == null
      ? null
      : captureSkillVectorAuthority(options.skillVectorAuthority);
  if (
    evolutionIngress !== null &&
    skillOutcomeIndex !== null &&
    evolutionIngress.tenantId !== skillOutcomeIndex.tenantId
  ) {
    throw new TypeError(
      "Agent evolution ingress and Skill outcome index must share one tenant",
    );
  }
  const retrievalTenant =
    evolutionIngress?.tenantId ?? skillOutcomeIndex?.tenantId ?? null;
  if (
    retrievalTenant !== null &&
    skillVectorAuthority !== null &&
    retrievalTenant !== skillVectorAuthority.tenantId
  ) {
    throw new TypeError("Agent retrieval authorities must share one tenant");
  }
  const model = options.model || "qwen2.5:7b";
  const provider = options.provider || "ollama";
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const apiKey = options.apiKey || null;
  const writeOut = deps.writeOut;
  const writeErr = deps.writeErr;

  const sessionId =
    deps[STREAM_SESSION_ID] ||
    options.sessionId ||
    `headless-stream-${Date.now()}-${process.pid}`;
  if (evolutionIngress !== null) {
    await evolutionIngress.start();
  }
  // The input stream may drive many turns. Allocate once at the stream-run
  // boundary so every turn (and its nested agents) shares cache/backlog limits.
  // SessionResourceBudget remains separately leased by executeTool.
  const hostResourceBudget =
    options.hostResourceBudget || new HostResourceBudget();
  const persist =
    (Boolean(options.sessionId) || options.observabilityScope != null) &&
    options.ephemeral !== true;
  const sessionHostLease = deps[STREAM_SESSION_HOST_LEASE] || null;
  const traceId = resolveTraceId(options, process.env, deps);
  const fieldGate = {
    seq: true,
    trace_id: true,
    tool_use_id: true,
    // Hook lifecycle events can occur before the optional first-line hello.
    // Buffer their additive policy projection until negotiation either accepts
    // or disables this feature.
    permission_decision: null,
  };
  const streamCoalescer =
    deps.streamCoalescer ||
    createStreamCoalescer({
      writeOut,
      coalesceMs: resolveStreamCoalesceMs(options, process.env),
      traceId,
      fieldGate,
    });
  const emit = streamCoalescer.emit;
  const pendingHookPolicyEvents = [];
  const settlePermissionDecisionGate = (enabled) => {
    fieldGate.permission_decision = enabled === true;
    if (fieldGate.permission_decision) {
      for (const event of pendingHookPolicyEvents.splice(0)) emit(event);
    } else {
      pendingHookPolicyEvents.length = 0;
    }
  };
  const removeHookObserver =
    options.includeHookEvents === true
      ? addHooksV2EventObserver(sessionId, (event) => {
          emit(event);
          const policyEvent = projectHookPolicyDecision(event);
          if (!policyEvent) return;
          if (fieldGate.permission_decision === true) emit(policyEvent);
          else if (fieldGate.permission_decision == null) {
            pendingHookPolicyEvents.push(policyEvent);
          }
        })
      : null;
  streamCleanup.setOutputCleanup(() => streamCoalescer.flush?.());

  const hasInjectedSessionStore =
    typeof deps.sessionHasPersistedEvidence === "function" ||
    typeof deps.sessionExists === "function" ||
    typeof deps.rebuildMessages === "function" ||
    typeof deps.appendCompactEventIfMessagesMatch === "function" ||
    typeof deps.appendEvent === "function" ||
    typeof deps.appendAuthorityEvent === "function" ||
    typeof deps.readVerifiedEvents === "function" ||
    typeof deps.readVerifiedProjection === "function";
  const unavailableAuthorityCapability = (operation) => () => {
    const error = new Error(
      `Injected session store must provide ${operation} for MCP authority`,
    );
    error.code = "SESSION_AUTHORITY_CAPABILITY_UNAVAILABLE";
    throw error;
  };

  // A persisted stream resume is an authority boundary, not best-effort chat
  // history. Resolve it before config/settings, Setup hooks, bootstrap, MCP,
  // model or tool access. The canonical reader folds active messages and MCP
  // recovery from one verified, anchored transcript sample under the writer
  // lock; a damaged or asynchronous seam refuses the entire host session.
  let canonicalResume = null;
  let canonicalResumeMessages = null;
  let canonicalMcpCallRecovery = null;
  if (persist) {
    const readResumeState =
      deps.readSessionHostResumeState || readSessionHostResumeState;
    const readVerifiedEvents =
      deps.readVerifiedEvents ||
      (hasInjectedSessionStore
        ? unavailableAuthorityCapability("readVerifiedEvents")
        : jsonlReadVerifiedEvents);
    const readVerifiedProjection =
      typeof deps.readVerifiedProjection === "function"
        ? deps.readVerifiedProjection
        : !hasInjectedSessionStore
          ? jsonlReadVerifiedProjection
          : null;
    const resumeDependencies = {
      sessionExists:
        deps.sessionHasPersistedEvidence ||
        deps.sessionExists ||
        jsonlSessionHasPersistedEvidence,
      readVerifiedEvents: (...args) =>
        requireSynchronousRecoveryResult(
          readVerifiedEvents(...args),
          "readVerifiedEvents",
        ),
      ...(readVerifiedProjection
        ? {
            readVerifiedProjection: (...args) =>
              requireSynchronousRecoveryResult(
                readVerifiedProjection(...args),
                "readVerifiedProjection",
              ),
          }
        : {}),
    };
    try {
      const existingSession = requireSynchronousRecoveryResult(
        resumeDependencies.sessionExists(sessionId),
        "sessionExists",
      );
      if (typeof existingSession !== "boolean") {
        throw invalidMcpRecoveryTransaction(
          "sessionExists",
          "return a boolean",
        );
      }
      if (options.observabilityScope != null && existingSession) {
        const code = "CC_OBSERVABILITY_SCOPE_IMMUTABLE";
        const error =
          "An existing stream session scope cannot be overwritten; create a new scoped session";
        emit({
          type: "result",
          subtype: "error_session_resume",
          is_error: true,
          code,
          error,
          session_id: sessionId,
        });
        writeErr(`${code}: ${error}\n`);
        return { exitCode: 1, turns: 0 };
      }
      canonicalResume = existingSession
        ? requireSynchronousRecoveryResult(
            readResumeState(sessionId, {
              ...resumeDependencies,
              sessionExists: () => true,
            }),
            "readSessionHostResumeState",
          )
        : null;
      if (canonicalResume !== null) {
        if (
          isProxy(canonicalResume) ||
          !isVerifiedSessionHostSnapshot(canonicalResume.snapshot) ||
          !Array.isArray(canonicalResume.messages) ||
          isProxy(canonicalResume.messages) ||
          !canonicalResume.recovery ||
          typeof canonicalResume.recovery !== "object" ||
          isProxy(canonicalResume.recovery) ||
          !Array.isArray(canonicalResume.recovery.unsettled) ||
          isProxy(canonicalResume.recovery.unsettled) ||
          !Array.isArray(canonicalResume.recovery.incidents) ||
          isProxy(canonicalResume.recovery.incidents)
        ) {
          throw invalidMcpRecoveryTransaction(
            "readSessionHostResumeState",
            "return one verified session-host projection",
          );
        }
        if (
          !canonicalResume.messages.every(
            (message) =>
              message &&
              !isProxy(message) &&
              ["system", "user", "assistant", "tool"].includes(message.role),
          )
        ) {
          throw invalidMcpRecoveryTransaction(
            "readSessionHostResumeState",
            "return plain replay messages with supported roles",
          );
        }
        canonicalResumeMessages = [...canonicalResume.messages];
        const notice = formatMcpLedgerRecoveryNotice(canonicalResume.recovery);
        if (notice) {
          canonicalMcpCallRecovery = {
            count: canonicalResume.recovery.unsettled.length,
            incidents: canonicalResume.recovery.incidents.length,
            items: canonicalResume.recovery.unsettled
              .slice(0, 10)
              .map((record) => ({
                ledgerId: record.ledgerId,
                server: record.serverName,
                tool: record.toolName,
                effect: record.effectContract?.effect || "unknown",
              })),
            notice,
          };
        }
      }
    } catch {
      const code = "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED";
      emit({
        type: "result",
        subtype: "error_session_resume",
        is_error: true,
        code,
        error: "Canonical stream session could not be verified",
        session_id: sessionId,
      });
      writeErr(`${code}: canonical stream resume was refused\n`);
      return { exitCode: 1, turns: 0 };
    }
  }
  // Vision model (config.llm.visionModel) — image turns switch to it for that
  // turn only (resolveVisionLlm falls back to the default when unset), so a
  // pasted/typed image is read by a vision-capable model even though the
  // session's default model is text-only.
  let visionModel = options.visionModel;
  if (!visionModel) {
    try {
      const { loadConfig } = await import("../lib/config-manager.js");
      visionModel = loadConfig()?.llm?.visionModel || undefined;
    } catch {
      /* optional — resolveVisionLlm falls back to DEFAULT_VISION_MODEL */
    }
  }
  const cwd = options.cwd || process.cwd();
  const additionalDirectories = Array.isArray(options.additionalDirectories)
    ? options.additionalDirectories.filter(Boolean)
    : [];

  // .claude/settings.json permission rules (deny > ask > allow); see
  // runAgentHeadless for the full semantics. null = no file → unchanged.
  let permissionRules = options.permissionRules || null;
  let permissionRulesProvider = options.permissionRulesProvider || null;
  let managedSettings = null;
  let settingsFiles = [];
  const { createPermissionRulesProvider, loadPermissionAuthority } =
    await import("../lib/permission-authority.js");
  const authorityOptions = {
    cwd,
    settingsFile: options.settingsFile,
    managedSettingsFile: options.managedSettingsFile,
    baseRules: options.permissionRules || null,
  };
  const loadedPermissionAuthority = loadPermissionAuthority(authorityOptions);
  managedSettings = loadedPermissionAuthority.managed;
  settingsFiles = Array.isArray(loadedPermissionAuthority.files)
    ? loadedPermissionAuthority.files
    : [];
  permissionRules = loadedPermissionAuthority.hasRules
    ? loadedPermissionAuthority.rules
    : null;
  if (!permissionRulesProvider) {
    permissionRulesProvider = createPermissionRulesProvider(authorityOptions);
  }

  // .claude/settings.json `hooks` block (decision-capable PreToolUse/PostToolUse).
  let settingsHooks = options.settingsHooks || null;
  if (!settingsHooks) {
    try {
      const { loadHooks, projectHookTrustNotice, attachAuthorityErrors } =
        await import("../lib/settings-hooks.cjs");
      const loaded = loadHooks({ cwd, settingsFile: options.settingsFile });
      const { mergePluginHooks } =
        await import("../lib/plugin-runtime/hooks.js");
      const effectiveHooks = mergePluginHooks(
        attachAuthorityErrors(loaded.hooks, loaded.authorityErrors),
        { cwd },
      );
      settingsHooks =
        Object.keys(effectiveHooks).length > 0 ||
        effectiveHooks._authorityErrors.length > 0
          ? effectiveHooks
          : null;
      // Explain the explicit content-bound trust gate. stderr keeps NDJSON
      // stdout clean; the notice itself never grants Hook authority.
      try {
        const notice = projectHookTrustNotice({
          cwd,
          settingsFile: options.settingsFile,
        });
        if (notice) writeErr(notice + "\n");
      } catch {
        /* notice output is best-effort; the runtime gate is fail-closed */
      }
    } catch (error) {
      settingsHooks = {};
      Object.defineProperty(settingsHooks, "_authorityErrors", {
        value: Object.freeze([
          Object.freeze({
            sourceFile: null,
            code: error?.code || "CC_HOOK_AUTHORITY_LOAD_FAILED",
          }),
        ]),
        enumerable: false,
      });
    }
  }

  // autoMode.classifyAllShell (Claude-Code 2.1.193): classify the built-in
  // verification allowlist through the shell-policy instead of fast-pathing it.
  let classifyAllShell = options.classifyAllShell || false;
  if (!classifyAllShell) {
    try {
      const { readBooleanSetting } = await import("../lib/settings-loader.cjs");
      classifyAllShell =
        readBooleanSetting("autoMode.classifyAllShell", {
          cwd,
          settingsFile: options.settingsFile,
        }) === true;
    } catch {
      classifyAllShell = false; // fail-open
    }
  }

  const input = deps.input || process.stdin;
  const runLoop = deps.agentLoop || coreAgentLoop;
  const doBootstrap = deps.bootstrap || bootstrap;
  const executeLifecycleHooks = deps.executeHooksV2Event || executeHooksV2Event;
  const doExpand = deps.expandFileRefs || expandFileRefsAsync;
  const runSessionSlashCommand =
    deps.executeSessionSlashCommand || executeSessionSlashCommand;
  let turns = 0;

  streamCleanup.setSessionEnd(async (reason) => {
    if (!settingsHooks) return;
    const runObserveHooks =
      deps.runObserveHooks ||
      (await import("../lib/settings-hook-events.js")).runObserveHooks;
    await runObserveHooks(
      settingsHooks,
      "SessionEnd",
      { reason, cwd, session_id: sessionId },
      { cwd },
    );
  });

  const getApprovalGate =
    deps.getApprovalGate ||
    (async () => {
      const m = await import("../lib/session-core-singletons.js");
      return m.getApprovalGate();
    });

  if (managedSettings) {
    const { assertManagedPermissionMode } =
      await import("../lib/settings-loader.cjs");
    assertManagedPermissionMode(options.permissionMode, managedSettings);
  }
  const perm = resolvePermissionMode(options.permissionMode);
  const enabledToolNames = resolveEnabledTools({
    allowedTools: options.allowedTools,
    readOnly: perm.readOnly,
  });
  const disabledTools = options.disallowedTools || [];

  let db = null;
  try {
    // Bootstrap logs db/config diagnostics via console.info (→ stdout); divert
    // to stderr so the NDJSON stream stays clean.
    const ctx = await withQuietStdout(() => doBootstrap({ verbose: false }));
    db = ctx.db || null;
  } catch {
    // DB optional — static-prompt fallback.
  }

  const setupHooks = await executeLifecycleHooks(
    "Setup",
    {
      schema_version: 1,
      session_id: sessionId,
      cwd,
      database_available: db != null,
      enabled_tools: enabledToolNames,
      settings_files: settingsFiles,
    },
    { failClosed: true },
  );
  if (setupHooks.blocked || setupHooks.decision === "block") {
    const reason =
      setupHooks.blockingResult?.reason ||
      setupHooks.error ||
      "blocked by Setup hook";
    emit({
      type: "result",
      subtype: "blocked",
      is_error: true,
      result: reason,
      session_id: sessionId,
    });
    streamCleanup.setReason("blocked");
    return { exitCode: 2, turns: 0 };
  }

  // Session persistence + resume (chat-panel "session resume" / --resume):
  // an EXPLICIT session id (--session / --resume) opts into JSONL persistence —
  // prior history is rebuilt into the conversation and every new turn is
  // appended, so a later run with the same id picks up where this one left
  // off. Anonymous runs (no id) stay persistence-free, exactly as before.
  const storeReadEvents = deps.readEvents || jsonlReadEvents;
  const storeFindLatestEvent =
    deps.findLatestEvent ||
    (deps.readEvents
      ? (sessionId, type, predicate = null) => {
          const events = storeReadEvents(sessionId) || [];
          for (let index = events.length - 1; index >= 0; index -= 1) {
            const event = events[index];
            if (type != null && event?.type !== type) continue;
            if (typeof predicate === "function" && !predicate(event)) continue;
            return event;
          }
          return null;
        }
      : hasInjectedSessionStore
        ? () => null
        : jsonlFindLatestEvent);
  const store = {
    sessionExists: deps.sessionExists || jsonlSessionExists,
    startSession: deps.startSession || jsonlStartSession,
    appendUserMessage: deps.appendUserMessage || jsonlAppendUserMessage,
    appendAssistantMessage:
      deps.appendAssistantMessage || jsonlAppendAssistantMessage,
    appendTokenUsage: deps.appendTokenUsage || jsonlAppendTokenUsage,
    appendToolCallCompact:
      deps.appendToolCallCompact ||
      (hasInjectedSessionStore ? () => true : jsonlAppendToolCallCompact),
    appendLlmRetryCompact:
      deps.appendLlmRetryCompact ||
      (hasInjectedSessionStore ? () => true : jsonlAppendLlmRetryCompact),
    appendCompactEventIfMessagesMatch:
      deps.appendCompactEventIfMessagesMatch ||
      (hasInjectedSessionStore
        ? unavailableAuthorityCapability("appendCompactEventIfMessagesMatch")
        : jsonlAppendCompactEventIfMessagesMatch),
    appendEvent:
      deps.appendEvent ||
      (hasInjectedSessionStore ? () => true : jsonlAppendEvent),
    appendAuthorityEvent:
      deps.appendAuthorityEvent ||
      deps.appendEvent ||
      (hasInjectedSessionStore
        ? unavailableAuthorityCapability("appendAuthorityEvent")
        : jsonlAppendAuthorityEvent),
    readEvents: storeReadEvents,
    readVerifiedEvents:
      deps.readVerifiedEvents ||
      (hasInjectedSessionStore
        ? unavailableAuthorityCapability("readVerifiedEvents")
        : jsonlReadVerifiedEvents),
    readVerifiedProjection:
      deps.readVerifiedProjection ||
      (hasInjectedSessionStore ? null : jsonlReadVerifiedProjection),
    findLatestEvent: storeFindLatestEvent,
  };
  let mcpLedgerSink = null;

  // ── P0-2: crash-safe side-effect ledger — the stream twin of the
  // single-prompt runner (headless-runner.js) and the WS bridge
  // (ws-agent-handler.js). Dangerous tools (file writes, opaque shell,
  // git push, publish/schedule/notify/browser actions) are recorded
  // prepare→start→commit|fail with the snapshot persisted BEFORE the effect
  // settles, so an IDE chat-panel worker killed mid-flight is surfaced for
  // verification on resume instead of being blindly replayed. Only active when
  // persisting (an anonymous/--ephemeral stream can't be resumed); a run that
  // touches no dangerous tool writes nothing.
  const loadLedger = deps.loadSideEffectLedger || loadSideEffectLedger;
  const persistLedger = deps.persistSideEffectLedger || persistSideEffectLedger;
  let sideEffectLedger = null;
  let sideEffectLedgerLoadError = null;
  if (persist) {
    try {
      sideEffectLedger = loadLedger(sessionId);
    } catch (error) {
      // Read-only turns remain available, but the first classified side effect
      // fails before the generator can resume into the actual operation.
      sideEffectLedger = new SideEffectLedger();
      sideEffectLedgerLoadError = error;
    }
  }
  let sideEffectSeq = 0;
  // Run-scoped nonce keeps op ids unique even when two runs resume the same
  // session (prepare() is idempotent on opId, so a collision would silently
  // drop the newer record).
  const sideEffectRunNonce = String(deps.now ? deps.now() : Date.now());
  const sideEffects = sideEffectLedger
    ? {
        ledger: sideEffectLedger,
        persist: () => {
          if (sideEffectLedgerLoadError) throw sideEffectLedgerLoadError;
          const persisted = persistLedger(sessionId, sideEffectLedger);
          if (persisted === false) {
            const error = new Error(
              `Side-effect ledger persistence was rejected for ${sessionId}`,
            );
            error.code = "SIDE_EFFECT_LEDGER_PERSIST_FAILED";
            throw error;
          }
          return persisted;
        },
        nextOpId: () => `${sideEffectRunNonce}:${sideEffectSeq++}`,
        assert: () => sessionHostLease?.assert?.(),
      }
    : null;

  // P1 unified turn/checkpoint producer for long-lived stream sessions. Load
  // the latest snapshot on resume, then append one explicit coverage record
  // for every input turn (including tool-free turns).
  let turnBindingLog = new TurnBindingLog();
  let turnBindingPersistenceError = null;
  let turnBindingDegradationEmitted = false;
  let turnBindingTerminalEmitted = false;
  const recordTurnBindingFailure = (error, operation) => {
    if (turnBindingPersistenceError) return turnBindingPersistenceError;
    const wrapped = new Error(
      `Turn binding ${operation} failed for ${sessionId}: ${
        error?.message || String(error)
      }`,
      { cause: error },
    );
    wrapped.code =
      operation === "read"
        ? "TURN_BINDING_READ_FAILED"
        : "TURN_BINDING_PERSIST_FAILED";
    turnBindingPersistenceError = wrapped;
    return wrapped;
  };
  const emitTurnBindingFailure = () => {
    if (!turnBindingPersistenceError) return false;
    if (!turnBindingDegradationEmitted) {
      emit({
        type: "recovery_degraded",
        component: "turn_binding",
        session_id: sessionId,
        error: turnBindingPersistenceError.message,
      });
      turnBindingDegradationEmitted = true;
    }
    if (!turnBindingTerminalEmitted) {
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: turnBindingPersistenceError.message,
        session_id: sessionId,
      });
      turnBindingTerminalEmitted = true;
    }
    return true;
  };
  if (persist) {
    try {
      const event = store.findLatestEvent(
        sessionId,
        TURN_BINDING_EVENT,
        (candidate) => candidate?.data && typeof candidate.data === "object",
      );
      if (event) {
        turnBindingLog = TurnBindingLog.fromJSON(event.data);
      }
    } catch (error) {
      recordTurnBindingFailure(error, "read");
    }
  }
  const turnBindingFeed = persist
    ? createTurnBindingFeed({
        log: turnBindingLog,
        nonce: sideEffectRunNonce,
      })
    : null;
  const persistTurnBindingLog = () => {
    if (!turnBindingFeed?.isDirty()) return true;
    if (turnBindingPersistenceError) return false;
    try {
      const persisted = store.appendAuthorityEvent(
        sessionId,
        TURN_BINDING_EVENT,
        turnBindingLog.toJSON(),
      );
      if (persisted === false) {
        throw new Error("session store rejected the binding snapshot");
      }
      turnBindingFeed.clearDirty();
      return true;
    } catch (error) {
      recordTurnBindingFailure(error, "persistence");
      return false;
    }
  };

  // Structured approval grants are exact tool+args+cwd capabilities. Turn
  // grants are memory-only and reset before every model turn; session grants
  // are restored only from a verified authority event and are appended under
  // the same anchored transcript contract as other session authority state.
  let approvalGrantLedger = new ApprovalGrantLedger({ sessionId });
  let approvalGrantPersistenceError = null;
  if (persist) {
    try {
      const event = store.findLatestEvent(
        sessionId,
        APPROVAL_GRANTS_EVENT,
        (candidate) => candidate?.data && typeof candidate.data === "object",
      );
      if (event) {
        approvalGrantLedger = ApprovalGrantLedger.fromJSON(event.data, {
          sessionId,
        });
      }
    } catch (error) {
      approvalGrantPersistenceError = error;
      approvalGrantLedger = new ApprovalGrantLedger({ sessionId });
      emit({
        type: "recovery_degraded",
        component: "approval_grants",
        session_id: sessionId,
        error:
          "Persisted approval grants could not be verified; all grants were discarded",
      });
    }
  }
  const persistApprovalGrants = (ledger = approvalGrantLedger) => {
    if (!persist || approvalGrantPersistenceError) return false;
    try {
      const persisted = store.appendAuthorityEvent(
        sessionId,
        APPROVAL_GRANTS_EVENT,
        ledger.toJSON(),
      );
      if (persisted === false) {
        throw new Error("session store rejected approval grants");
      }
      return true;
    } catch (error) {
      approvalGrantPersistenceError = error;
      return false;
    }
  };
  const listApprovalGrants = () => approvalGrantLedger.listGrants();
  const revokeApprovalGrant = (grantId) => {
    const existing = approvalGrantLedger
      .listGrants()
      .find((grant) => grant.grantId === String(grantId || ""));
    if (!existing) {
      return { success: false, error: "Approval grant was not found" };
    }
    if (existing.lifetime === "turn") {
      const result = approvalGrantLedger.revoke(grantId);
      return { success: result.revoked, grant: result.grant };
    }

    // Session revocation is a copy/persist/swap transaction. Preserve current
    // turn grants in the candidate, but never expose it as active until its
    // authority event has been appended successfully.
    const candidate = ApprovalGrantLedger.fromJSON(
      approvalGrantLedger.toJSON(),
      { sessionId },
    );
    candidate.turnId = approvalGrantLedger.turnId;
    candidate.turnGrants = new Map(approvalGrantLedger.turnGrants);
    const result = candidate.revoke(grantId);
    if (!result.revoked) {
      return { success: false, error: "Approval grant was not found" };
    }
    if (persist && !persistApprovalGrants(candidate)) {
      return {
        success: false,
        error: "Approval grant revocation could not be persisted",
      };
    }
    approvalGrantLedger = candidate;
    return { success: true, grant: result.grant };
  };

  // ── Interactive approvals (--interactive-approvals; chat-panel UX) ────────
  // CONFIRM-tier decisions (risky shell via the ApprovalGate, settings/hook
  // `ask`) normally fail closed in headless. With this opt-in they become a
  // structured round-trip instead: emit `approval_request`, BLOCK the tool
  // until a canonical structured decision (or an N-1 boolean response) arrives
  // on stdin (handled by the concurrent pump below, so the wait never
  // deadlocks), fail closed on
  // timeout (CC_APPROVAL_TIMEOUT_MS, default 120s) or stdin close. The
  // resolution is echoed as `approval_resolved` so UIs can settle their cards.
  const interactive = options.interactiveApprovals === true;
  const pendingApprovals = new Map();
  let approvalSeq = 0;
  const approvalTimeoutMs =
    Number(process.env.CC_APPROVAL_TIMEOUT_MS) > 0
      ? Number(process.env.CC_APPROVAL_TIMEOUT_MS)
      : 120000;
  const settleApproval = (
    id,
    decision,
    via,
    incomingBinding = null,
    { structured = false, invalidReason = null } = {},
  ) => {
    const p = pendingApprovals.get(id);
    if (!p) return;
    const approve = [
      "acceptOnce",
      "acceptForTurn",
      "acceptForSession",
    ].includes(decision?.kind);
    // Approval binding (authority §"权限来源与跨 Agent 授权边界"): an *approve*
    // verdict that carries a binding which does NOT match the one the request
    // advertised is stale / mis-routed / argument-tampered — reject it (deny,
    // fail closed) instead of green-lighting a different or changed tool call.
    // A legacy boolean verdict with no binding stays backward-compatible. A
    // structured approval must echo the binding; a deny always wins.
    if (
      approve === true &&
      p.binding &&
      ((structured && !incomingBinding) ||
        (incomingBinding && !verifyApprovalBinding(p.binding, incomingBinding)))
    ) {
      pendingApprovals.delete(id);
      clearTimeout(p.timer);
      const rejectionReason = incomingBinding
        ? "binding-mismatch"
        : "binding-missing";
      emit({
        type: "approval_resolved",
        id,
        approved: false,
        decision: {
          kind: "decline",
          reason: `Approval ${rejectionReason}`,
        },
        via: rejectionReason,
        session_id: sessionId,
      });
      p.resolve(false);
      return;
    }
    if (
      approve &&
      (decision.kind === "acceptForTurn" ||
        decision.kind === "acceptForSession")
    ) {
      const priorSessionGrants = new Map(approvalGrantLedger.sessionGrants);
      const priorRevision = approvalGrantLedger.revision;
      const applied = approvalGrantLedger.applyDecision(
        decision,
        p.requiredPermission,
        p.binding,
      );
      decision = applied.decision;
      if (applied.persistedScope && persist && !persistApprovalGrants()) {
        approvalGrantLedger.sessionGrants = priorSessionGrants;
        approvalGrantLedger.revision = priorRevision;
        decision = { kind: "acceptOnce" };
        via = "session-grant-persistence-failed";
      }
    }
    pendingApprovals.delete(id);
    clearTimeout(p.timer);
    emit({
      type: "approval_resolved",
      id,
      approved: invalidReason ? false : approve,
      decision,
      via: invalidReason || via,
      session_id: sessionId,
    });
    p.resolve(!invalidReason && approve);
  };
  const interactiveConfirm = (ctx = {}) => {
    const requiredPermission = approvalPermissionForContext(ctx, { cwd });
    if (approvalGrantLedger.allows(requiredPermission)) return true;
    return new Promise((resolve) => {
      const id = `appr-${++approvalSeq}`;
      // Bind this approval request to the exact call it authorizes: the request
      // id, its normalized arguments, and the policy/rule in force. The digest
      // rides on `approval_request` so a UI/relay can echo it back on approve,
      // letting settleApproval reject a verdict meant for a different call.
      const binding = approvalBindingDigest({
        toolCallId: id,
        args:
          ctx.args ?? (ctx.command != null ? { command: ctx.command } : null),
        policyDigest: ctx.rule || ctx.riskLevel || ctx.risk || null,
      });
      const timer = setTimeout(
        () =>
          settleApproval(
            id,
            { kind: "decline", reason: "Approval timed out" },
            "timeout",
          ),
        approvalTimeoutMs,
      );
      timer.unref?.();
      pendingApprovals.set(id, {
        resolve,
        timer,
        binding,
        requiredPermission,
      });
      emit({
        type: "approval_request",
        id,
        session_id: sessionId,
        tool: ctx.tool || ctx.toolName || null,
        command: ctx.command || ctx.args?.command || null,
        risk: ctx.riskLevel || ctx.risk || null,
        rule: ctx.rule || null,
        reason: ctx.reason || null,
        binding,
        requested_permissions: [requiredPermission],
      });
    });
  };

  let approvalGate = null;
  try {
    approvalGate = await getApprovalGate();
    approvalGate =
      approvalGate?.createSessionScope?.(sessionId) || approvalGate;
    if (approvalGate && (options.permissionMode || "default") === "auto") {
      // autoMode.decisions: user-configured riskLevel → allow/ask/deny
      // classifier (same wiring as headless-runner). Only wrap when settings
      // customize the map so the unconfigured path stays byte-identical.
      try {
        const {
          loadAutoModeConfig,
          resolveAutoModeDecisions,
          createAutoModeApprovalGate,
        } = await import("../lib/auto-mode-config.js");
        const autoConfig = loadAutoModeConfig({
          cwd,
          settingsFile: options.settingsFile,
        });
        const resolved = resolveAutoModeDecisions(autoConfig.effective);
        if (resolved.customized) {
          approvalGate = createAutoModeApprovalGate(approvalGate, resolved);
        }
      } catch {
        // fail to the default trusted mapping — never block the run
      }
    }
    if (approvalGate) {
      approvalGate.setAuthorizationConsumer?.(null);
      await approvalGate.setSessionPolicy?.(sessionId, perm.sessionPolicy);
      await approvalGate.awaitPersistence?.();
      approvalGate.setConfirmer?.(
        interactive && perm.allowInteractiveApprovals
          ? interactiveConfirm
          : perm.confirmer,
      );
    }
  } catch {
    approvalGate = null;
  }

  // ── Interactive questions (ask_user_question round-trip; chat-panel UX) ────
  // Same structured pattern as approvals: when the consumer opts in (the IDE
  // panel sets CC_INTERACTIVE_QUESTIONS=1 in the child env), the model's
  // `ask_user_question` tool emits `question_request`, BLOCKS until a
  // {"type":"answer",id,answer} arrives on stdin, and times out gracefully
  // (CC_QUESTION_TIMEOUT_MS, default 180s) — the handler maps the timeout to
  // user_timeout so the model proceeds, never a hard failure. Off by default
  // (env unset / pipes) → agent-core gets no askUser → user_not_reachable, the
  // existing graceful "proceed autonomously" path. Backward-safe: an env var
  // (not a flag) means an old `cc` simply ignores it.
  const interactiveQuestions =
    options.interactiveQuestions === true ||
    process.env.CC_INTERACTIVE_QUESTIONS === "1";
  const pendingQuestions = new Map();
  let questionSeq = 0;
  const questionTimeoutMs =
    Number(process.env.CC_QUESTION_TIMEOUT_MS) > 0
      ? Number(process.env.CC_QUESTION_TIMEOUT_MS)
      : 180000;
  const settleQuestion = (id, answer, via) => {
    const p = pendingQuestions.get(id);
    if (!p) return;
    pendingQuestions.delete(id);
    clearTimeout(p.timer);
    emit({ type: "question_resolved", id, via, session_id: sessionId });
    p.resolve(answer);
  };
  const failQuestion = (id, via) => {
    const p = pendingQuestions.get(id);
    if (!p) return;
    pendingQuestions.delete(id);
    clearTimeout(p.timer);
    emit({ type: "question_resolved", id, via, session_id: sessionId });
    const e = new Error(`ask_user_question ${via}`);
    e.code = "USER_TIMEOUT"; // handler → user_timeout (model proceeds, not a failure)
    p.reject(e);
  };
  streamCleanup.setInteractionCleanup((reason) => {
    const via = reason === "pipe_closed" ? "pipe-closed" : "session-closed";
    for (const [id, pending] of [...pendingApprovals.entries()]) {
      pendingApprovals.delete(id);
      clearTimeout(pending.timer);
      try {
        emit({
          type: "approval_resolved",
          id,
          approved: false,
          decision: {
            kind: "decline",
            reason: `Approval ${via}`,
          },
          via,
          session_id: sessionId,
        });
      } catch {
        // The output pipe may itself be the reason cleanup is running.
      }
      pending.resolve(false);
    }
    for (const [id, pending] of [...pendingQuestions.entries()]) {
      pendingQuestions.delete(id);
      clearTimeout(pending.timer);
      try {
        emit({ type: "question_resolved", id, via, session_id: sessionId });
      } catch {
        // Best-effort cleanup notification.
      }
      const error = new Error(`ask_user_question ${via}`);
      error.code = "USER_TIMEOUT";
      pending.reject(error);
    }
  });
  const interactionAskUser = ({
    question,
    options: qOptions,
    multiSelect,
    timeoutMs,
    metadata,
    sessionId: requestedSessionId,
    turnId,
    toolUseId,
  } = {}) =>
    new Promise((resolve, reject) => {
      const id = `q-${++questionSeq}`;
      const binding = normalizeInteractionBinding({
        sessionId: requestedSessionId ?? sessionId,
        turnId,
        toolUseId,
        sequence: questionSeq,
      });
      const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : questionTimeoutMs;
      const timer = setTimeout(() => failQuestion(id, "timeout"), ms);
      timer.unref?.();
      pendingQuestions.set(id, { resolve, reject, timer, binding });
      emit({
        type: "question_request",
        id,
        session_id: sessionId,
        binding,
        ...(binding.turnId ? { turn_id: binding.turnId } : {}),
        ...(binding.toolUseId ? { tool_use_id: binding.toolUseId } : {}),
        question: typeof question === "string" ? question : "",
        options: Array.isArray(qOptions) ? qOptions : null,
        multiSelect: multiSelect === true,
        ...(metadata && typeof metadata === "object" ? { metadata } : {}),
      });
    });

  // --output-style (or settings.json `outputStyle`) persona, appended.
  let outputStyleBody = null;
  try {
    const { resolveOutputStyle } = await import("../lib/output-styles.js");
    const st = resolveOutputStyle(options.outputStyle, cwd);
    if (st && st.body) outputStyleBody = st.body;
  } catch {
    outputStyleBody = null;
  }
  // Large-monorepo context lever: `instructionExcludes` (settings.json or an
  // explicit caller/SDK option) suppresses instruction/rule/@import files that
  // resolve into excluded subtrees. Explicit option wins; else union settings.
  let instructionExcludes = Array.isArray(options.instructionExcludes)
    ? options.instructionExcludes
    : null;
  if (!instructionExcludes) {
    try {
      const { readStringArraySetting } =
        await import("../lib/settings-loader.cjs");
      const fromSettings = readStringArraySetting("instructionExcludes", {
        cwd,
        settingsFile: options.settingsFile,
      });
      if (fromSettings && fromSettings.length)
        instructionExcludes = fromSettings;
    } catch {
      instructionExcludes = null; // fail-open
    }
  }
  // --json-schema (P2 §"JSON Schema 与流式结构化结果"): resolve + meta-validate
  // the schema up front (fail-fast on a broken contract, mirroring the
  // single-prompt path), then inject its output contract into the system prompt
  // so the model's final reply is JSON. A per-turn `structured_result` event is
  // emitted after each turn below. Off by default → nothing changes.
  let _jsonSchema = null;
  let _jso = null;
  if (options.jsonSchema) {
    try {
      _jso = await import("../lib/json-schema-output.js");
      _jsonSchema = await _jso.loadSchemaFileWithRefs(
        _jso._deps.fs,
        options.jsonSchema,
      );
    } catch (err) {
      // Fail-fast, exactly like `cc agent -p --json-schema` on a bad schema.
      writeErr(`Error: ${err.message}\n`);
      return { exitCode: 1, turns: 0 };
    }
  }

  // --no-project-memory (options.projectMemory === false) → lean system prompt:
  // skip both the rules.md append inside buildSystemPrompt AND the auto-loaded
  // cc.md/CLAUDE.md instruction block. Only `=== false` changes anything; when
  // the flag is absent (undefined) both paths stay byte-identical.
  const _leanNoProjectMemory = options.projectMemory === false;
  let _loadedInstructions = null;
  const systemContent = composeSystemPrompt(
    buildSystemPrompt(cwd, {
      additionalDirectories,
      projectMemory: options.projectMemory,
    }),
    {
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: _jsonSchema
        ? [options.appendSystemPrompt, _jso.buildSchemaInstruction(_jsonSchema)]
            .filter(Boolean)
            .join("\n\n")
        : options.appendSystemPrompt,
      outputStyle: outputStyleBody,
      instructionExcludes,
      projectMemory: _leanNoProjectMemory ? false : undefined,
      onInstructionsLoaded: (loaded) => {
        _loadedInstructions = loaded;
      },
    },
  );
  const messages = [{ role: "system", content: systemContent }];

  // settings.json InstructionsLoaded hooks (observe-only): fire once with the
  // exact loaded instruction file set right after the system prompt is built.
  // Best-effort; no-op when project memory is off or no hook is registered.
  if (settingsHooks && _loadedInstructions) {
    try {
      const { runInstructionsLoadedHooks } =
        await import("../lib/settings-hook-events.js");
      const ctx = (
        await runInstructionsLoadedHooks(settingsHooks, {
          files: _loadedInstructions.files,
          cwd,
          sessionId,
        })
      ).additionalContext;
      if (ctx) messages.push({ role: "system", content: ctx });
    } catch (_err) {
      // best-effort
    }
  }

  // §3.5.13 flywheel consumption (design module 101): in a PDH session, lead
  // with the user's standing feedback preferences learned ACROSS sessions
  // (corrections + net sentiment) so the agent honours past corrections from
  // the very first turn — the read side of pdh-feedback-ledger.js. Gated to PDH
  // context (the in-APK chat sets CHAINLESSCHAIN_PDH_PORT; `--pdh` forces,
  // `--no-pdh` opts out) so IDE/coding sessions are never polluted. Best-effort.
  // PDH context gate — reused by the §3.5.13 flywheel injection below and the
  // §3.5.18 egress reporting after each turn (in-APK chat sets
  // CHAINLESSCHAIN_PDH_PORT; `--pdh` forces, `--no-pdh` opts out).
  let pdhContext = false;
  try {
    const { isInPdhTerminal } = await import("../lib/pdh-bridge.js");
    pdhContext =
      options.pdh === true ||
      (options.pdh !== false && isInPdhTerminal(process.env));
    if (pdhContext) {
      const { readFeedback, summarizeFeedback, feedbackSystemNote } =
        await import("../lib/pdh-feedback-ledger.js");
      const note = feedbackSystemNote(summarizeFeedback(readFeedback()));
      if (note) messages.push({ role: "system", content: note });
    }
  } catch {
    /* learned-preference injection must never break the chat */
  }

  // settings.json SessionStart hooks → inject session context once (observe-only).
  if (settingsHooks) {
    try {
      const { runSessionStartHooks } =
        await import("../lib/settings-hook-events.js");
      const ctx = (
        await runSessionStartHooks(settingsHooks, {
          source: "startup",
          cwd,
          sessionId,
        })
      ).additionalContext;
      if (ctx) messages.push({ role: "system", content: ctx });
    } catch (_err) {
      // best-effort
    }
  }

  // Resume: replay the persisted conversation (fresh system prompt always
  // leads; persisted system turns are dropped, mirroring runAgentHeadless).
  let resumedMessages = 0;
  let sideEffectRecovery = null;
  let mcpCallRecovery = null;
  let mcpLedgerRecovery = null;
  let mcpLedgerRecoveryError = null;
  if (persist) {
    if (canonicalResume) {
      // The history and MCP authority below came from the same verified head.
      // No second pathname read is allowed between verification and replay.
      if (sideEffectLedger) {
        sideEffectRecovery = buildSideEffectRecovery(sideEffectLedger);
      }
      if (sideEffectRecovery) {
        messages.push({ role: "system", content: sideEffectRecovery.notice });
      }
      mcpLedgerRecovery = canonicalResume.recovery;
      mcpCallRecovery = canonicalMcpCallRecovery;
      if (mcpCallRecovery) {
        messages.push({ role: "system", content: mcpCallRecovery.notice });
      }
      messages.push(...canonicalResumeMessages);
      // Preserve the existing public counter semantics: control-plane stream
      // metadata counts conversational turns, never private system context.
      resumedMessages = canonicalResumeMessages.filter(
        (message) => message.role !== "system",
      ).length;
    } else {
      try {
        const startedSessionId = requireSynchronousRecoveryResult(
          store.startSession(sessionId, {
            title: "stream session",
            provider,
            model,
            observabilityScope: options.observabilityScope,
            executionLocation: captureAmbientExecutionLocation({
              provider,
              model,
            }),
          }),
          "startSession",
        );
        if (
          options.observabilityScope != null &&
          startedSessionId !== sessionId
        ) {
          throw new Error(
            "Scoped stream session creation did not confirm the requested durable session id",
          );
        }
      } catch (error) {
        const code = "CC_SESSION_PERSISTENCE_START_FAILED";
        const persistenceError = createSessionPersistenceFailure(error, {
          sessionId,
          operation: "session-start",
        });
        const persistence = projectSessionPersistenceFailure(persistenceError, {
          phase: "before-model",
        });
        if (persistence) {
          try {
            deps.onPersistenceFailure?.(persistence);
          } catch {
            // Observability cannot change persistence semantics.
          }
        }
        emit({
          type: "result",
          subtype: persistence
            ? "error_persistence"
            : "error_session_persistence",
          is_error: true,
          code: persistence?.code || code,
          error: "Canonical stream session could not be created",
          session_id: sessionId,
          ...(persistence ? { persistence } : {}),
        });
        writeErr(
          `${persistence?.code || code}: canonical stream session creation was refused\n`,
        );
        return {
          exitCode: 1,
          turns: 0,
          ...(persistence ? { persistence } : {}),
        };
      }
    }
  }

  // Resume-degenerate role sanitation (Claude Code 2.1.187 parity): when the
  // replayed history ends with a bare `user` turn (the prior run produced no
  // assistant response), the FIRST live prompt would make two adjacent `user`
  // messages. Arm a one-shot flag consumed by the first model call so the merge
  // fires exactly once — the live turn loop's intentional consecutive-`user`
  // states (interrupt-dangling turn, PDH feedback note) are never folded.
  let sanitizeRolesNextTurn =
    resumedMessages > 0 && messages[messages.length - 1]?.role === "user";

  // `system:init` intentionally precedes MCP connection so stream consumers
  // receive their manifest promptly. Validation itself is local and side-effect
  // free, so preflight just its bounded, redacted projection here; the normal
  // resolver below remains authoritative for parsing and connection.
  let initialMcpServerErrors = [];
  if (options.mcpConfig) {
    try {
      initialMcpServerErrors = readHeadlessMcpConfigErrors(options.mcpConfig);
    } catch {
      // The normal resolver reports unreadable/malformed files as its existing
      // config error result. Never place filesystem/parser details in init.
    }
  }

  emit({
    type: "system",
    subtype: "init",
    // Deterministic-headless manifest (gap-analysis 2026-07-11): protocol
    // version + persistence + live sources + policy/tool digests. The init
    // event fires BEFORE MCP resolution here (stream consumers expect it
    // promptly), so `mcp` in loaded_sources reflects the run's MCP intent
    // (config file / registry auto-connect enabled), not connection outcome.
    protocol_version: STREAM_PROTOCOL_VERSION,
    session_id: sessionId,
    session_persistence: persist,
    model,
    provider,
    permission_mode: options.permissionMode || "default",
    tools: enabledToolNames,
    tools_hash: computeToolsHash(enabledToolNames),
    policy_digest: computePolicyDigest({
      permissionMode: options.permissionMode,
      allowedTools: options.allowedTools,
      disallowedTools: disabledTools,
      permissionRules,
    }),
    loaded_sources: buildLoadedSources({
      permissionRules,
      settingsHooks,
      mcp: Boolean(options.mcpConfig) || options.useRegisteredMcp !== false,
      enabledToolNames,
    }),
    ...(initialMcpServerErrors.length > 0
      ? { mcp_server_errors: initialMcpServerErrors }
      : {}),
    slash_commands: [...SESSION_SLASH_COMMANDS],
    input_format: "stream-json",
    additional_directories: additionalDirectories,
    resumed_messages: resumedMessages,
  });

  // P0-2 visible recovery notice: same `raw` info-line contract as
  // provider_fallback / version_skew (the shipped IDE panels map `raw` → an
  // info line), so both panels render it with zero IDE changes. Emitted right
  // after `init` so consumers keep seeing init as the first line; absent
  // entirely on a clean (or ledger-free) resume.
  if (sideEffectRecovery) {
    emit({
      type: "raw",
      subtype: "side_effect_recovery",
      text: `⚠️ ${sideEffectRecovery.count} interrupted side-effect(s) need verification before replay (resume ${sessionId}).`,
      count: sideEffectRecovery.count,
      items: sideEffectRecovery.items,
      session_id: sessionId,
    });
  }
  if (mcpCallRecovery) {
    emit({
      type: "raw",
      subtype: "mcp_call_recovery",
      text: `⚠️ ${mcpCallRecovery.count} interrupted MCP call(s) and ${mcpCallRecovery.incidents} ledger incident(s) need inspection before replay (resume ${sessionId}).`,
      count: mcpCallRecovery.count,
      incidents: mcpCallRecovery.incidents,
      items: mcpCallRecovery.items,
      session_id: sessionId,
    });
  }

  // Goal binding (cc goal, Phase 1) — resolved once and injected on every turn.
  // `--goal <id>` binds explicitly; `--goal` with no value auto-resolves.
  let goalPrepareCallFn;
  if (options.goal !== undefined && options.goal !== false) {
    try {
      const explicitId = typeof options.goal === "string" ? options.goal : null;
      const { resolveActiveGoal } = await import("../lib/goal-store.js");
      const goal = (deps.resolveActiveGoal || resolveActiveGoal)({
        explicitId,
        sessionId,
      });
      if (goal) {
        const { goalPrepareCall } = await import("../lib/goal-context.js");
        goalPrepareCallFn = goalPrepareCall(goal);
      }
    } catch {
      /* goal binding is best-effort — proceed without it */
    }
  }

  // Combine the ad-hoc --mcp-config file with the registered (cc mcp add)
  // auto-connect servers into one client for the whole stream session, exposing
  // every tool to the LLM. A bad --mcp-config file fails up front; registered
  // connects are best-effort. --no-mcp disables the registered set.
  let mcp = null;
  {
    const doResolve = deps.resolveAgentMcp || resolveAgentMcp;
    try {
      mcp = await doResolve(
        {
          mcpConfigPath: options.mcpConfig || null,
          managedSettingsFile: options.managedSettingsFile,
          db: db?.getDatabase?.() || null,
          includeRegistered: options.useRegisteredMcp !== false,
          // --strict-mcp-config: only the --mcp-config servers (ignore
          // registered + IDE bridge) for a reproducible MCP surface.
          strict: options.strictMcpConfig === true,
          ide: options.ide,
          pdh: options.pdh,
          jetbrains: options.jetbrains,
          cwd: options.cwd || process.cwd(),
          // advertise the session id to spawned stdio MCP servers
          sessionId,
        },
        {
          writeErr,
          mcpConfigWarnings: false,
          loadMcpConfig: deps.loadMcpConfig,
          loadRegisteredMcp: deps.loadRegisteredMcp,
          loadIdeMcp: deps.loadIdeMcp,
          loadJetbrainsMcp: deps.loadJetbrainsMcp,
        },
      );
      streamCleanup.setMcpClient(mcp?.mcpClient);
      // MCP tool search (context scaling): defer big tool schemas behind the
      // internal tool_search tool. Below-threshold / disabled → no-op.
      if (mcp) {
        try {
          (deps.maybeApplyToolSearch || maybeApplyToolSearch)(mcp, {
            model,
            provider,
            cwd: options.cwd || process.cwd(),
            writeErr,
          });
        } catch {
          // best-effort — full schemas still work without deferral
        }
      }
    } catch (err) {
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: err.message,
      });
      return { exitCode: 1, turns: 0 };
    }
  }

  mcpLedgerSink = persist
    ? createSessionMcpLedgerSink(
        sessionId,
        hasInjectedSessionStore
          ? { appendEvent: store.appendAuthorityEvent }
          : { recovery: mcpLedgerRecovery },
      )
    : null;
  const mcpRecoveryRuntime = createMcpHostRecoveryRuntime({
    bundle: mcp,
    sessionId,
    sink: mcpLedgerSink,
    recovery: mcpLedgerRecovery,
    recoveryError: mcpLedgerRecoveryError,
    dispatchAdmission: sessionHostLease?.admitMcpDispatch || null,
  });
  const hostMcp = mcp
    ? { ...mcp, mcpClient: mcpRecoveryRuntime.client || mcp.mcpClient }
    : null;

  // MCP servers may pause a tool flow with `elicitation/create`. Register the
  // handler only after MCP resolution so the client is initialized before use.
  // Reuse the structured Desktop/headless question channel, while preserving
  // the MCP response shape (`action` + object `content`) at this boundary.
  if (mcp?.mcpClient?.on) {
    mcp.mcpClient.on("elicitation-deferred", (request) => {
      emit({
        type: "elicitation_deferred",
        session_id: sessionId,
        server: request.server || null,
        request_id: request.requestId ?? null,
        mode: request.mode || "form",
        message: request.message || "",
        requested_schema: request.requestedSchema || null,
        elicitation_id: request.elicitationId || null,
        url: request.url || null,
        url_host: request.urlHost || null,
        reason: request.reason || "no_interactive_host",
        wire_action: request.wireAction || "decline",
      });
    });
    mcp.mcpClient.on("elicitation-complete", (event) => {
      emit({
        type: "elicitation_complete",
        session_id: sessionId,
        server: event.server || null,
        elicitation_id: event.elicitationId || null,
      });
    });
  }
  if (mcp?.mcpClient?.setElicitationHandler && interactiveQuestions) {
    const elicitationHandler = async (request) => {
      const hookContext = {
        schema_version: 1,
        server: request.server || null,
        request_id: request.requestId ?? null,
        message: request.message || "MCP server requests additional input",
        requested_schema: request.requestedSchema || null,
        mode: request.mode || "form",
        elicitation_id: request.elicitationId || null,
        url: request.url || null,
        url_host: request.urlHost || null,
        session_id: sessionId,
      };
      emitHooksV2Event("MCPElicitation", hookContext);
      emitHooksV2Event("Elicitation", hookContext);
      try {
        const answer = await interactionAskUser({
          question:
            request.mode === "url"
              ? `${request.message || "MCP server requests an external interaction"}\nOpen secure URL on ${request.urlHost}?`
              : request.message || "MCP server requests additional input",
          timeoutMs: request.timeoutMs,
          metadata: {
            kind: "mcp_elicitation",
            server: request.server,
            requestId: request.requestId,
            mode: request.mode || "form",
            requestedSchema: request.requestedSchema || null,
            elicitationId: request.elicitationId || null,
            url: request.url || null,
            urlHost: request.urlHost || null,
          },
        });
        const response =
          answer == null
            ? { action: "cancel" }
            : request.mode === "url"
              ? { action: "accept" }
              : {
                  action: "accept",
                  content:
                    answer && typeof answer === "object"
                      ? answer
                      : { value: answer },
                };
        emitHooksV2Event("ElicitationResult", {
          ...hookContext,
          action: response.action,
        });
        return response;
      } catch (error) {
        emitHooksV2Event("ElicitationResult", {
          ...hookContext,
          action: "cancel",
          reason: error?.code || error?.message || "interaction_failed",
        });
        throw error;
      }
    };
    mcp.mcpClient.setElicitationHandler(elicitationHandler, {
      signal: options.signal || null,
    });
  }

  // Seed MCP roots for --add-dir (roots/list_changed parity): advertise the full
  // workspace-root list to connected MCP servers when the stream session started
  // with extra roots. No --add-dir → workspaceRootDirs = [cwd] → no-op. Mirrors
  // the single-prompt runner + the REPL /add-dir path. Best-effort.
  if (hostMcp?.mcpClient && additionalDirectories.length > 0) {
    try {
      const { notifyMcpRootsChanged, workspaceRootDirs } =
        await import("../repl/add-dir.js");
      notifyMcpRootsChanged(
        [hostMcp.mcpClient],
        workspaceRootDirs(options.cwd || process.cwd(), additionalDirectories),
      );
    } catch {
      // best-effort — root advertisement never blocks a run
    }
  }

  // --permission-prompt-tool: defer CONFIRM-tier approvals to an MCP tool
  // (loaded via --mcp-config) instead of headless fail-closed.
  if (options.permissionPromptTool) {
    let ppt;
    try {
      ppt = resolvePermissionPromptTool(mcp, options.permissionPromptTool);
    } catch (err) {
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: err.message,
      });
      return { exitCode: 1, turns: 0 };
    }
    if (approvalGate && typeof approvalGate.setConfirmer === "function") {
      approvalGate.setConfirmer(
        makePermissionPromptConfirmer({
          mcpClient: hostMcp.mcpClient,
          server: ppt.server,
          tool: ppt.tool,
        }),
      );
    }
  }

  // --remote-control: route CONFIRM-tier approvals to paired mobile/web
  // devices (第四阶段 #2). Pairing info is emitted as a stream event so panel
  // hosts can render the QR. --permission-prompt-tool and --interactive-
  // approvals win when given (this block skips) — explicit routing beats the
  // ambient device bridge.
  let _remoteApproval = null;
  if (
    options.remoteControl &&
    !options.permissionPromptTool &&
    options.interactiveApprovals !== true
  ) {
    try {
      if (
        !approvalGate ||
        typeof approvalGate.setConfirmer !== "function" ||
        typeof approvalGate.setAuthorizationConsumer !== "function" ||
        typeof approvalGate.consumeAuthorization !== "function"
      ) {
        const error = new Error(
          "installed session-core cannot bind and consume durable remote approval",
        );
        error.code = "CC_REMOTE_APPROVAL_GATE_UNAVAILABLE";
        throw error;
      }
      const startRemoteApproval =
        deps.startHeadlessRemoteApproval ||
        (await import("../lib/remote-approval-bridge.js"))
          .startHeadlessRemoteApproval;
      _remoteApproval = await startRemoteApproval({
        agentSessionId: sessionId,
        allowLan: options.remoteControlAllowLan === true,
        env: process.env,
      });
      streamCleanup.setRemoteApproval(_remoteApproval);
      emit({
        type: "remote_control",
        subtype: "pairing",
        pairing_uri: _remoteApproval.pairing.uri,
        remote_session_id: _remoteApproval.pairing.remoteSessionId,
        expires_at: _remoteApproval.pairing.expiresAt,
      });
      approvalGate.setConfirmer(_remoteApproval.confirmer);
      approvalGate.setAuthorizationConsumer(
        _remoteApproval.consumeAuthorization,
      );
    } catch (err) {
      emit({
        type: "remote_control",
        subtype: "unavailable",
        error: err.message,
      });
      _remoteApproval = null;
    }
  }

  const streamInteraction = {};
  if (interactiveQuestions) streamInteraction.askUser = interactionAskUser;
  if (options.includeHookEvents === true) {
    streamInteraction.emit = (kind, payload = {}) => {
      const subAgentId =
        typeof payload.subAgentId === "string" && payload.subAgentId.trim()
          ? payload.subAgentId.slice(0, 160)
          : null;
      if (!subAgentId) return;
      const base = {
        schema_version: 1,
        subagent_id: subAgentId,
        parent_id:
          typeof payload.parentSessionId === "string" &&
          payload.parentSessionId.trim()
            ? payload.parentSessionId.slice(0, 160)
            : sessionId,
        ...(typeof payload.role === "string" && payload.role.trim()
          ? { role: payload.role.trim().slice(0, 96) }
          : {}),
      };
      if (kind === "sub-agent.started") {
        emit({
          type: "subagent_started",
          ...base,
          background: payload.background === true,
        });
      } else if (
        kind === "sub-agent.completed" ||
        kind === "sub-agent.failed"
      ) {
        emit({
          type: "subagent_completed",
          ...base,
          status: kind === "sub-agent.failed" ? "failed" : "completed",
          background: payload.background === true,
          ...(Number.isFinite(payload.iterationCount)
            ? {
                iteration_count: Math.max(
                  0,
                  Math.floor(payload.iterationCount),
                ),
              }
            : {}),
        });
      } else if (kind === "sub-agent.progress") {
        emit({
          type: "subagent_progress",
          ...base,
          event_type:
            typeof payload.event_type === "string"
              ? payload.event_type.slice(0, 96)
              : "unknown",
          ...(typeof payload.tool === "string" && payload.tool
            ? { tool: payload.tool.slice(0, 128) }
            : {}),
          ...(Number.isFinite(payload.iteration_count)
            ? {
                iteration_count: Math.max(
                  0,
                  Math.floor(payload.iteration_count),
                ),
              }
            : {}),
          ...(Number.isFinite(payload.token_count)
            ? { token_count: Math.max(0, Math.floor(payload.token_count)) }
            : {}),
        });
      }
    };
  }

  const loopOptionsBase = {
    model,
    provider,
    // Extended thinking (Anthropic; opt-in via --think/--ultrathink).
    // thinkingBudget (--thinking-budget) = legacy-model budget_tokens override.
    thinking: options.thinking || null,
    thinkingBudget: options.thinkingBudget || null,
    baseUrl,
    apiKey,
    cwd,
    additionalDirectories,
    ...(skillOutcomeIndex === null ? {} : { skillOutcomeIndex }),
    ...(skillVectorAuthority === null ? {} : { skillVectorAuthority }),
    sessionId,
    sessionBudget: options.sessionBudget || null,
    hostResourceBudget,
    sessionHostSnapshot: canonicalResume?.snapshot || null,
    // Auto-checkpoint (Claude-Code parity): snapshot the work tree before each
    // mutating tool so a stream consumer (e.g. the IDE chat panel) can rewind.
    // Keyed by this run's sessionId — agent-core falls back to it — so the panel
    // lists/restores with `cc checkpoint list|restore -s <sessionId>`. Off by
    // default (no behavior change for callers that don't opt in); git engine
    // only, a no-op outside a git repo.
    autoCheckpoint: options.autoCheckpoint || false,
    checkpointSession: options.checkpointSession || sessionId,
    managedCheckpoint: options.managedCheckpoint === true,
    managedCheckpointStateDir: options.managedCheckpointStateDir || null,
    managedCheckpointExclusions: options.managedCheckpointExclusions || [],
    hookDb: db,
    approvalGate,
    permissionRules,
    permissionRulesProvider,
    settingsHooks,
    toolAdmission: options.toolAdmission || null,
    classifyAllShell,
    enabledToolNames,
    disabledTools,
    // --interactive-approvals: settings/hook `ask` (and, with an IDE bridge,
    // edit reviews via openDiff) route to the structured approval round-trip
    // instead of failing closed. Absent in CI/pipes → unchanged fail-closed.
    permissionConfirm: interactive ? interactiveConfirm : undefined,
    // ask_user_question round-trip (opt-in via CC_INTERACTIVE_QUESTIONS): give
    // the tool handler an askUser that emits question_request + blocks on stdin.
    // Absent → agent-core returns user_not_reachable (graceful proceed).
    interaction:
      Object.keys(streamInteraction).length > 0 ? streamInteraction : undefined,
    prepareCall: goalPrepareCallFn,
    // --mcp-config wiring (tool defs + dispatch map + live client).
    mcpClient: mcp?.mcpClient || null,
    mcpHostClient: mcpRecoveryRuntime.client || mcp?.mcpClient || null,
    extraToolDefinitions: mcp?.extraToolDefinitions || undefined,
    externalToolExecutors: mcp?.externalToolExecutors || undefined,
    externalToolDescriptors: mcp?.externalToolDescriptors || undefined,
    // A null sink disables durable writes, not recovery admission. Retain the
    // guarded ledger so outcome-unknown calls cannot be retried in-process.
    mcpCallLedger: mcpRecoveryRuntime.ledger,
    mcpDispatchAdmission: sessionHostLease?.admitMcpDispatch || null,
    onCompaction: persist
      ? (stats, compacted, settlement = {}) => {
          sessionHostLease?.assert?.();
          return requireSynchronousRecoveryResult(
            store.appendCompactEventIfMessagesMatch(
              sessionId,
              {
                ...stats,
                trigger: settlement.trigger || "auto",
                messages: projectCanonicalResumeMessages(compacted, {
                  strict: true,
                }),
              },
              settlement.expectedMessages,
            ),
            "appendCompactEventIfMessagesMatch",
          );
        }
      : undefined,
    chatFn: deps.chatFn || options.chatFn || undefined,
    signal: options.signal || undefined,
    // --include-partial-messages: stream live assistant-text deltas as
    // `stream_event` lines. Output here is always NDJSON, so gating on the
    // flag alone suffices.
    onToken: options.includePartialMessages
      ? (text) => streamCoalescer.emitTextDelta(text)
      : undefined,
    // Extended-thinking reasoning deltas (Anthropic; only when thinking is on).
    // Surfaced as a thinking_delta so consumers can render a dimmed/collapsed
    // reasoning block — the visible half of the /think toggle.
    onThinking: options.includePartialMessages
      ? (thinking) => streamCoalescer.emitThinkingDelta(thinking)
      : undefined,
    // Auto-retry notice (Claude-Code 2.1.181): the streaming call hit a
    // transient API connection drop and is retrying. Surfaced unconditionally
    // (not gated on --include-partial-messages) so programmatic NDJSON
    // consumers can log/monitor reconnects rather than seeing an opaque pause.
    onStreamRetry: (attempt, error, telemetry = {}) => {
      emit({
        type: "stream_retry",
        attempt,
        message: "API connection dropped — retrying",
      });
      if (persist) {
        try {
          store.appendLlmRetryCompact(sessionId, {
            attempt,
            durationMs: telemetry.durationMs,
            provider: telemetry.provider || provider,
            model: telemetry.model || model,
            reason: classifyStreamRetryReason(error),
          });
        } catch (persistenceError) {
          throw markRuntimeLedgerPersistenceError(persistenceError);
        }
      }
    },
    strictUsageTelemetry: persist,
    // Visible cross-vendor fallback notice: when the configured provider hits an
    // auth error and the loop falls back to another vendor (or relabels via
    // baseUrl), surface it as a `raw` info line the panel renders instead of a
    // silent vendor switch. Structured fields carry the machine-readable detail.
    onProviderFallback: (info) =>
      emit({
        type: "raw",
        subtype: "provider_fallback",
        text: `⚠️ ${info.message || `已从 "${info.from}" 切换到 "${info.to}"`}`,
        from: info.from,
        to: info.to,
        reason: info.reason,
        session_id: sessionId,
      }),
  };

  // --max-budget-usd: a SESSION-WIDE USD spend cap across all turns. Folded
  // from token-usage in runTurn; once reached the session ends before the next
  // paid call. null → no cap (unchanged behavior).
  const costBudget = options.maxCostUsd
    ? new CostBudget({
        limitUsd: options.maxCostUsd,
        table: options.priceTable,
      })
    : null;

  let sawError = false;
  let evolutionIngressFailed = false;
  let terminalPersistenceFailure = null;
  const persistUsageEvent = persist
    ? (event) => {
        try {
          if (event.type === "token-usage") {
            store.appendTokenUsage(sessionId, projectRuntimeTokenUsage(event));
            return;
          }
          const outcome =
            event.type === "model-usage-started" ? "started" : "unknown";
          store.appendEvent(
            sessionId,
            runtimeUsageEventType(outcome),
            projectRuntimeUsageBoundary(event, outcome),
          );
        } catch (error) {
          throw markRuntimeLedgerPersistenceError(error);
        }
      }
    : null;
  const persistToolEvent = persist
    ? (outcome, call) => {
        try {
          const id = call?.id || `tool-${toolUseCounter + 1}`;
          if (outcome === "started") {
            store.appendEvent(sessionId, "tool_call_started", {
              id,
              tool: call.tool,
            });
            return;
          }
          store.appendToolCallCompact(sessionId, {
            id,
            tool: call.tool,
            isError: Boolean(call.is_error),
            skill:
              call.skill ||
              (call.tool === "run_skill"
                ? call.args?.skill_name || null
                : undefined),
            plugin: call.plugin || undefined,
            pluginVersion: call.pluginVersion || undefined,
            durationMs: call.durationMs,
            invocationReceipt: call.invocationReceipt,
          });
        } catch (error) {
          throw markRuntimeLedgerPersistenceError(error);
        }
      }
    : null;
  const childToolExecs = new Map();
  const persistChildToolBoundary = persistToolEvent
    ? (event) => {
        const id = event?.tool_use_id;
        childToolExecs.set(id, {
          tool: event?.tool || "?",
          startedAt: deps.now ? deps.now() : Date.now(),
        });
        persistToolEvent("started", { id, tool: event?.tool || "?" });
      }
    : undefined;
  const persistChildToolSettlement = persistToolEvent
    ? (event) => {
        const id = event?.tool_use_id;
        const started = childToolExecs.get(id);
        childToolExecs.delete(id);
        persistToolEvent("settled", {
          id,
          tool: event?.tool || started?.tool || "?",
          is_error: Boolean(event?.error || event?.result?.error),
          skill: event?.attribution?.skill,
          invocationReceipt: event?.result?.invocationReceipt,
          durationMs: started
            ? Math.max(
                0,
                (deps.now ? deps.now() : Date.now()) - started.startedAt,
              )
            : undefined,
        });
      }
    : undefined;
  // Session-scoped tool-call correlation ids ("tu-<n>", additive protocol-v1
  // field): one counter across ALL turns so ids never repeat within a session.
  // Gated by the capability handshake (docs/PROTOCOL.md §1.3): a client that
  // negotiated tool_use_id off gets undefined (no `id` field emitted).
  let toolUseCounter = 0;
  const nextToolUseId = () =>
    fieldGate.tool_use_id === false ? undefined : `tu-${++toolUseCounter}`;
  // Version-skew notice (friendly reminder): a chat-panel agent process is
  // long-lived, so if cc was updated on disk while it kept running, it's still
  // executing stale in-memory code (a fixed bug then looks "not fixed"). Checked
  // each turn until detected so a mid-session `npm i -g` is caught on the next
  // message; emitted ONCE as a `raw` line the panel already renders.
  let versionSkewNotified = false;
  // Once any turn attaches an image, the image stays in the conversation
  // history — so every later turn (even a text-only follow-up like "what colour
  // is it?") must keep using the vision LLM, otherwise a text-only default model
  // is handed image content it can't read. Claude Code never hits this (one
  // multimodal model); cc splits text/vision models, so we sticky the routing.
  let conversationHasImages = false;

  // ── Concurrent stdin pump (turn-interrupt support) ────────────────────────
  // Input is consumed AS IT ARRIVES — not between turns — so an
  // {"type":"interrupt"} can abort the IN-FLIGHT turn immediately (chat-panel
  // Stop / Claude-Code Esc parity) instead of waiting in line behind it.
  // Normal events queue for the serial turn loop below; interrupts act on the
  // live per-turn AbortController and are never queued.
  // A normal input can contain arbitrary user data, so retain it only while it
  // is waiting for the serial turn loop. Interrupts/approvals/answers remain
  // out-of-band controls and never consume a queue slot.
  const queue = [];
  let wakeQueue = null;
  let inputDone = false;
  let currentAbort = null;
  let inputBacklogFailure = false;
  let slashRequestSeq = 0;
  const inputLines = readJsonLines(input);
  const releaseQueuedInputEvents = () => {
    while (queue.length > 0) {
      const queued = queue.shift();
      try {
        queued?.lease?.release?.();
      } catch {
        // Drain every opaque slot even when an injected test authority has a
        // faulty disposer. Its payload is deliberately never inspected here.
      }
    }
  };
  const failInputEventBacklog = () => {
    if (inputBacklogFailure) return;
    inputBacklogFailure = true;
    releaseQueuedInputEvents();
    // A flood can happen while a model turn is running. Abort that turn before
    // surfacing the stable host diagnostic; otherwise it could continue to do
    // paid/tool work after the host has refused its input backlog.
    currentAbort?.abort();
    streamCleanup.setReason("host_event_backlog_exhausted");
    streamCleanup.requestStop();
    wakeQueue?.();
  };
  streamCleanup.setInputCancel(() => {
    releaseQueuedInputEvents();
    return inputLines.return?.();
  });
  (async () => {
    try {
      for await (const line of inputLines) {
        const parsed = parseInputEvent(line);
        if (parsed == null) continue;
        if (parsed.hello) {
          // Capability handshake (docs/PROTOCOL.md §1.3): negotiate the client's
          // offer against this CLI's, apply the agreed feature set to the live
          // field-gate, and echo the result. Never queued (it's out-of-band
          // control, like interrupt/approval). Incompatible (ok:false) leaves
          // the gate untouched — the CLI keeps its safe baseline.
          const negotiated = negotiateProtocol(
            buildServerOffer(buildAgentCapabilities()),
            parsed.hello,
          );
          applyNegotiationToGate(negotiated, fieldGate);
          settlePermissionDecisionGate(fieldGate.permission_decision !== false);
          emit({
            type: "system",
            subtype: "negotiated",
            session_id: sessionId,
            protocol_version: negotiated.agreedVersion,
            features: negotiated.features,
            downgraded: negotiated.downgraded,
            disabled_features: negotiated.disabledFeatures,
            ok: negotiated.ok,
            reason: negotiated.reason,
          });
          continue;
        }
        if (fieldGate.permission_decision == null) {
          settlePermissionDecisionGate(true);
        }
        if (parsed.interrupt) {
          currentAbort?.abort();
          continue;
        }
        if (parsed.approval) {
          // Approval verdicts settle a BLOCKED tool — never queued.
          settleApproval(
            parsed.approval.id,
            parsed.approval.decision,
            parsed.approval.approve ? "user-approve" : "user-deny",
            parsed.approval.binding,
            {
              structured: parsed.approval.structured,
              invalidReason: parsed.approval.invalidReason,
            },
          );
          continue;
        }
        if (parsed.answer) {
          // Answers settle a BLOCKED ask_user_question — never queued. A null
          // value (user cancelled the QuickPick) → user_timeout (model proceeds).
          const pending = pendingQuestions.get(parsed.answer.id);
          if (
            !pending ||
            !sameInteractionBinding(pending.binding, parsed.answer.binding)
          ) {
            emit({
              type: "question_response_rejected",
              id: parsed.answer.id,
              reason: "binding_mismatch",
              session_id: sessionId,
            });
            continue;
          }
          if (parsed.answer.value == null)
            failQuestion(parsed.answer.id, "cancelled");
          else
            settleQuestion(
              parsed.answer.id,
              parsed.answer.value,
              "user-answer",
            );
          continue;
        }
        try {
          if (typeof hostResourceBudget?.admitEvent !== "function") {
            throw new TypeError(
              "host resource budget does not provide admitEvent()",
            );
          }
          const lease = hostResourceBudget.admitEvent();
          if (!lease || typeof lease.release !== "function") {
            throw new TypeError(
              "host resource budget event admission is invalid",
            );
          }
          queue.push({ parsed, lease });
        } catch {
          // Refuse the whole input stream rather than dropping one unbounded
          // event and then accepting more. The externally-visible error below
          // is fixed and contains none of the rejected line's content.
          failInputEventBacklog();
          break;
        }
        if (wakeQueue) wakeQueue();
      }
    } catch {
      /* input stream error → treat as EOF */
    }
    inputDone = true;
    // stdin closed while approvals were pending → fail closed so the blocked
    // turn can finish and the process can exit.
    for (const id of [...pendingApprovals.keys()]) {
      settleApproval(
        id,
        { kind: "decline", reason: "Approval input closed" },
        "stdin-closed",
      );
    }
    // stdin closed while a question was pending → user_timeout (model proceeds).
    for (const id of [...pendingQuestions.keys()]) {
      failQuestion(id, "stdin-closed");
    }
    if (wakeQueue) wakeQueue();
  })();
  const nextEvent = async () => {
    for (;;) {
      if (queue.length > 0) {
        const queued = queue.shift();
        try {
          return queued.parsed;
        } finally {
          // The serial loop now owns the event; it is no longer backlog.
          queued.lease.release();
        }
      }
      if (inputDone || options.signal?.aborted) return null;
      await new Promise((r) => {
        let settled = false;
        const wake = () => {
          if (settled) return;
          settled = true;
          options.signal?.removeEventListener("abort", wake);
          if (wakeQueue === wake) wakeQueue = null;
          r();
        };
        wakeQueue = wake;
        options.signal?.addEventListener("abort", wake, { once: true });
        if (options.signal?.aborted) wake();
      });
    }
  };

  for (;;) {
    await deps.outputFlow?.wait?.();
    const parsed = await nextEvent();
    if (inputBacklogFailure) {
      emit({
        type: "result",
        subtype: "error_host_resource_budget",
        is_error: true,
        code: HOST_EVENT_BACKLOG_CODE,
        error: HOST_EVENT_BACKLOG_ERROR,
        session_id: sessionId,
      });
      sawError = true;
      break;
    }
    if (parsed == null) break; // stdin closed
    sessionHostLease?.assert?.();
    if (turnBindingPersistenceError) {
      emitTurnBindingFailure();
      sawError = true;
      break;
    }

    if (parsed.slashCommand) {
      const requestId =
        parsed.slashCommand.requestId || `slash-${++slashRequestSeq}`;
      let result;
      try {
        result = await runSessionSlashCommand(
          parsed.slashCommand,
          {
            sessionId,
            cwd,
            provider,
            model,
            apiKey,
            messages,
            messageCount: messages.length,
            additionalDirectories,
            extraRoots: additionalDirectories.length,
            mcp,
            permissionRules,
            permissionMode: options.permissionMode || "default",
            settingsHooks,
            settingsFiles,
            loadedInstructions: _loadedInstructions,
            projectMemoryEnabled:
              options.projectMemory !== false &&
              process.env.CC_PROJECT_MEMORY !== "0",
            listApprovalGrants,
            revokeApprovalGrant,
          },
          deps.sessionSlashCommandDeps || {},
        );
      } catch (error) {
        result = {
          ok: false,
          code: "COMMAND_FAILED",
          error: String(error?.message || error),
        };
      }
      emit({
        type: "slash_command_result",
        request_id: requestId,
        command: parsed.slashCommand.command,
        session_id: sessionId,
        ok: result?.ok === true,
        ...(result?.ok === true
          ? { text: String(result.output || "") }
          : {
              error: {
                code: result?.code || "COMMAND_FAILED",
                message: String(result?.error || "Slash command failed"),
              },
            }),
      });
      continue;
    }

    // One-time version-skew reminder (see flag declaration above). Best-effort;
    // never blocks a turn. detectVersionSkew() returns null when this process is
    // running the currently-installed version, so a fresh/up-to-date session
    // stays quiet.
    if (!versionSkewNotified) {
      try {
        const skew = detectVersionSkew();
        if (skew) {
          versionSkewNotified = true;
          emit({
            type: "raw",
            subtype: "version_skew",
            text: `⚠️ ${versionSkewMessage(skew)}`,
            running_version: skew.loaded,
            installed_version: skew.installed,
            session_id: sessionId,
          });
        }
      } catch {
        /* version-skew notice is best-effort */
      }
    }

    if (parsed.error) {
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: parsed.error,
      });
      sawError = true;
      continue;
    }

    // Manual `/compact` uses the same provider-backed structured handoff as the
    // other long-lived hosts. Provider/schema failures degrade to the shared
    // extractive handoff instead of silently dropping all but recent turns.
    if (parsed.compact) {
      const before = messages.length;
      const expectedMessages = [...messages];
      let compacted;
      let stats;
      let degradedEvent;
      let usageEvent;
      let usageUnknownEvent;
      const compactionCallId = `compact-${++slashRequestSeq}`;
      let compactionProviderStarted = false;
      try {
        const providerCompactionOptions = {
          provider,
          model,
          baseUrl,
          apiKey,
          signal: options.signal,
          force: true,
          preserveCompletedExchange: true,
          llmQuery:
            deps.compactionLlmQuery || options.compactionLlmQuery || null,
          chatFn:
            deps.compactionChatFn ||
            options.compactionChatFn ||
            coreChatWithTools,
          chatOptions: { cwd, sessionId },
          maxOutputTokens: options.compactionMaxOutputTokens,
          summaryInputMaxChars: options.compactionInputMaxChars,
          onProviderCallStart: () => {
            const event = {
              type: "model-usage-started",
              callId: compactionCallId,
              provider,
              model,
              source: "semantic-compaction",
            };
            persistUsageEvent?.(event);
            beginSessionBudgetUsage(
              options.sessionBudget,
              event,
              "headless semantic compaction",
            );
            compactionProviderStarted = true;
            return compactionCallId;
          },
        };
        const { resolveCliContextMemoryCutover } =
          await import("../lib/context-memory-kernel/authority.js");
        const cutover = resolveCliContextMemoryCutover({
          env: options.contextMemoryEnv || process.env,
          scopeKey: `cli:session:${sessionId}`,
        });
        if (cutover.canonical) {
          const { compactLiveMessagesCanonical } =
            await import("../lib/context-memory-kernel/live-compaction.js");
          let compatibilityResult = null;
          const canonical = await compactLiveMessagesCanonical(messages, {
            compressor: {
              maxTokens: Math.max(
                256,
                Math.floor(estimateMessagesTokens(messages) * 0.6),
              ),
              compress: async (dropped) => {
                compatibilityResult = await compactConversationWithProvider(
                  dropped,
                  providerCompactionOptions,
                );
                return compatibilityResult;
              },
            },
            sessionId,
            operationId: `manual-${randomUUID()}`,
            provider,
            model,
            env: options.contextMemoryEnv || process.env,
            persist,
            trigger: "manual",
            ...(persist
              ? {
                  commit: (canonicalStats, output, settlement = {}) => {
                    sessionHostLease?.assert?.();
                    return requireSynchronousRecoveryResult(
                      store.appendCompactEventIfMessagesMatch(
                        sessionId,
                        {
                          ...canonicalStats,
                          trigger: "manual",
                          messages: projectCanonicalResumeMessages(output, {
                            strict: true,
                          }),
                        },
                        settlement.expectedMessages,
                      ),
                      "appendCompactEventIfMessagesMatch",
                    );
                  },
                }
              : {}),
          });
          compacted = canonical.messages;
          stats = canonical.stats;
          degradedEvent = compatibilityResult?.degradedEvent || null;
          usageEvent = compatibilityResult?.usageEvent || null;
          usageUnknownEvent = compatibilityResult?.usageUnknownEvent || null;
          if (canonical.receipt.status === "stale") {
            const error = new Error(
              "session messages changed during canonical compaction",
            );
            error.code = "SESSION_REVISION_STALE";
            throw error;
          }
        } else {
          ({
            messages: compacted,
            stats,
            degradedEvent,
            usageEvent,
            usageUnknownEvent,
          } = await compactConversationWithProvider(
            messages,
            providerCompactionOptions,
          ));
        }
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted) throw error;
        if (error?.runtimeLedgerPersistence === true) throw error;
        if (compactionProviderStarted) {
          const event = {
            type: "model-usage-unknown",
            callId: compactionCallId,
            provider,
            model,
            source: "semantic-compaction",
            code: "provider_call_failed",
          };
          persistUsageEvent?.(event);
          if (markSessionBudgetUsageUnknown(options.sessionBudget, event)) {
            rejectSessionBudgetUsageUnknown(
              event,
              "headless semantic compaction",
            );
          }
        }
        emit({
          type: "compaction-degraded",
          reason: `compaction_failed:${String(error?.message || error).slice(0, 240)}`,
          summaryMode: "none",
        });
        continue;
      }
      if (degradedEvent) {
        emit({ type: "compaction-degraded", ...degradedEvent });
      }
      if (usageUnknownEvent) {
        const event = {
          type: "model-usage-unknown",
          callId: compactionCallId,
          provider: usageUnknownEvent.provider || provider,
          model: usageUnknownEvent.model || model,
          source: "semantic-compaction",
          code: "provider_transport_outcome_unknown",
        };
        persistUsageEvent?.(event);
        if (markSessionBudgetUsageUnknown(options.sessionBudget, event)) {
          rejectSessionBudgetUsageUnknown(
            event,
            "headless semantic compaction",
          );
        }
        emit({
          type: "compaction_usage_unknown",
          ...usageUnknownEvent,
          usage_outcome: "unknown",
        });
        emit({
          type: "result",
          subtype: "error_compaction_usage_unknown",
          is_error: true,
          code: "CC_COMPACTION_USAGE_UNKNOWN",
          error:
            "Compaction provider usage is unknown; the paid compaction is not retried",
          session_id: sessionId,
          ...(costBudget ? { budget_state: "unverifiable" } : {}),
        });
        sawError = true;
        break;
      }
      let costExceeded = false;
      if (usageEvent) {
        const event = {
          type: "token-usage",
          callId: compactionCallId,
          ...usageEvent,
          source: "semantic-compaction",
        };
        persistUsageEvent?.(event);
        recordSessionBudgetUsage(
          options.sessionBudget,
          event,
          "headless semantic compaction usage settlement",
        );
        emit({ type: "token_usage", ...usageEvent });
        if (costBudget) {
          costBudget.add(usageEvent);
          costExceeded = costBudget.exceeded();
        }
      }

      // Provider work above is intentionally outside the canonical writer
      // lock. Settle the candidate once, under the JSONL message-projection CAS,
      // before replacing the live history. A stale/unknown settlement is never
      // retried here: that could duplicate either the paid summary call or a
      // compact event whose fsync outcome is unknown.
      const shouldPersistCompact = stats?.strategy !== "none";
      let settlementError = null;
      let persistenceFailure = null;
      if (
        persist &&
        shouldPersistCompact &&
        stats?.canonicalAlreadySettled !== true
      ) {
        try {
          sessionHostLease?.assert?.();
          requireSynchronousRecoveryResult(
            store.appendCompactEventIfMessagesMatch(
              sessionId,
              {
                ...stats,
                trigger: "manual",
                messages: projectCanonicalResumeMessages(compacted, {
                  strict: true,
                }),
              },
              expectedMessages,
            ),
            "appendCompactEventIfMessagesMatch",
          );
        } catch (error) {
          settlementError = error;
          const normalized = createSessionPersistenceFailure(error, {
            sessionId,
            operation: "append-authority-event",
          });
          persistenceFailure = projectSessionPersistenceFailure(normalized, {
            phase: "after-model",
          });
          if (persistenceFailure) {
            terminalPersistenceFailure = persistenceFailure;
            try {
              deps.onPersistenceFailure?.(persistenceFailure);
            } catch {
              // Observability cannot change persistence semantics.
            }
          }
        }
      }

      if (!settlementError) {
        messages.length = 0;
        messages.push(...compacted);
        emit({
          type: "compaction",
          stats,
          messages_before: before,
          messages_after: messages.length,
        });
        emitHooksV2Event("PostCompact", {
          schema_version: 1,
          trigger: "manual",
          session_id: sessionId,
          messages_before: before,
          messages_after: messages.length,
          stats,
          cwd,
        });
      } else {
        const stale = settlementError?.code === "SESSION_REVISION_STALE";
        const code = stale
          ? "CC_COMPACTION_REVISION_STALE"
          : persistenceFailure?.code ||
            settlementError?.code ||
            "CC_COMPACTION_SETTLEMENT_FAILED";
        emit({
          type: "compaction-degraded",
          reason: stale
            ? "session_messages_changed_during_compaction"
            : "canonical_compaction_settlement_failed",
          summaryMode: "none",
          code,
        });
        emit({
          type: "result",
          subtype: persistenceFailure
            ? "error_persistence"
            : stale
              ? "error_compaction_stale"
              : "error_session_persistence",
          is_error: true,
          code,
          error: "Canonical compaction was not settled",
          session_id: sessionId,
          ...(persistenceFailure ? { persistence: persistenceFailure } : {}),
        });
        sawError = true;
      }

      if (costExceeded) {
        sawError = true;
        emit({
          type: "cost_budget_exhausted",
          limit_usd: options.maxCostUsd,
          spent_usd: costBudget.spentUsd,
          session_id: sessionId,
          turn: turns,
        });
      }
      if (settlementError || costExceeded) {
        break;
      }
      if (!shouldPersistCompact && persist) {
        // A repeated `/compact` against an already-compact context is a no-op:
        // do not grow the canonical chain with duplicate checkpoints.
        sessionHostLease?.assert?.();
      }
      continue;
    }

    // Plan-mode control events (chat-panel plan UI). Mirrors the REPL's
    // /plan verbs: enter blocks write tools (blocked calls become plan items),
    // approve unlocks them and IMMEDIATELY runs a continuation turn, reject
    // exits plan mode. Every control answers with a `plan_update` event.
    if (parsed.plan) {
      const pm = getPlanModeManager();
      const reviewMessage = [
        "approve",
        "reject",
        "revise",
        "regenerate",
      ].includes(parsed.plan)
        ? planReviewSystemMessage(parsed.planReview)
        : null;
      if (reviewMessage) {
        messages.push({ role: "system", content: reviewMessage });
      }
      if (parsed.plan === "enter") {
        if (!pm.isActive()) {
          pm.enterPlanMode({ title: "Agent Plan" });
          messages.push({
            role: "system",
            content:
              "[PLAN MODE ACTIVE] You are now in plan mode. You can read " +
              "files, search, and analyze — but write/execute tools are " +
              "blocked. Any blocked tool calls will be recorded as plan " +
              "items. Analyze the task thoroughly, then the user will " +
              "approve your plan.",
          });
        }
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
        continue;
      }
      if (parsed.plan === "reject") {
        if (pm.isActive()) pm.rejectPlan("User rejected");
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
        continue;
      }
      if (parsed.plan === "revise" || parsed.plan === "regenerate") {
        if (!pm.isActive()) {
          emit({
            type: "plan_update",
            ...planSnapshot(pm),
            session_id: sessionId,
            note: "nothing to revise",
          });
          continue;
        }
        const revision = pm.beginPlanRevision({
          reason: parsed.plan,
        });
        if (revision.error) {
          emit({
            type: "plan_update",
            ...planSnapshot(pm),
            session_id: sessionId,
            note: revision.error,
          });
          continue;
        }
        messages.push({
          role: "system",
          content:
            `[PLAN REVISION REQUESTED] Plan ${revision.previousPlan.id} is frozen. ` +
            `Create version ${revision.plan.version} as plan ${revision.plan.id}. ` +
            (parsed.plan === "regenerate"
              ? "Regenerate the plan from scratch using the review snapshot."
              : "Revise the plan using the inline comments and reviewer notes."),
        });
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
        parsed.text =
          parsed.plan === "regenerate"
            ? "Regenerate the plan from the review feedback."
            : "Revise the plan from the review feedback.";
      } else if (parsed.plan === "approve") {
        if (!pm.isActive() || !(pm.currentPlan?.items?.length > 0)) {
          emit({
            type: "plan_update",
            ...planSnapshot(pm),
            session_id: sessionId,
            note: "nothing to approve",
          });
          continue;
        }
        const approval = pm.approvePlan({
          permissionMode: options.permissionMode || "default",
        });
        const executionLock = approval.executionLock;
        messages.push({
          role: "system",
          content:
            `[PLAN APPROVED] The user has approved your plan with ${pm.currentPlan.items.length} items. ` +
            `Permission mode is ${executionLock.permissionMode}. The execution lock permits only: ` +
            `${executionLock.allowedTools.join(", ")}. Execute the approved plan items in order; ` +
            "request a plan revision before using any other tool.",
        });
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
        // Fall through into the normal turn machinery with a continuation
        // prompt — the agent starts executing without an extra user message.
        parsed.text = "Proceed with the approved plan.";
      } else if (!parsed.text) {
        continue; // unknown plan action — ignored
      }
    }

    // PDH self-learning feedback (design module 101 §3.5.13). Always ack so the
    // chat app can confirm receipt. A `correction` re-drives a turn so the model
    // adapts within the session; `positive`/`negative` are recorded as a
    // lightweight preference note in history without forcing a fresh reply.
    if (parsed.feedback) {
      const { turnId, kind, comment } = parsed.feedback;
      emit({
        type: "feedback_ack",
        turn_id: turnId,
        kind,
        session_id: sessionId,
      });
      // §3.5.13: persist to the cross-session learning ledger so the next
      // session can honour the user's standing preferences ("越用越聪明"
      // flywheel). Best-effort — a learning ledger must never break the chat.
      try {
        const { appendFeedback } =
          await import("../lib/pdh-feedback-ledger.js");
        appendFeedback({ sessionId, turnId, kind, comment });
      } catch {
        /* persistence is best-effort */
      }
      if (kind === "correction") {
        parsed.text = comment
          ? `用户对上一轮回复给出纠正：${comment}\n请据此调整并重新回复。`
          : "用户认为上一轮回复需要纠正，请反思后给出更准确的回复。";
        // fall through into the normal turn machinery with the correction prompt
      } else {
        const tag = kind === "positive" ? "认可" : "不满意";
        messages.push({
          role: "user",
          content: `（用户反馈：对上一轮回复表示${tag}。请在后续回复中延续/修正此偏好。）`,
        });
        continue;
      }
    }

    // PDH guided-collection resume (design module 101 §3.5.15). A PDH tool
    // returned assist_required (e.g. "log into the app first"); the chat's 引导卡
    // sends a resume once the user finishes or skips the in-app step. Ack so the
    // app can dismiss the card, then re-drive the model to retry (completed) or
    // move on (skip).
    if (parsed.resume) {
      const { token, action } = parsed.resume;
      emit({ type: "resume_ack", token, action, session_id: sessionId });
      parsed.text =
        action === "skip"
          ? "我跳过了刚才需要的引导操作，请不要重试该步骤，继续处理其它事项或做个小结。"
          : "我已完成刚才需要的引导操作，请重试刚才的采集/操作。";
      // fall through into the normal turn machinery with the continuation prompt
    }

    // --replay-user-messages: echo each accepted user message back on the
    // output stream (Claude-Code parity) so a consumer can correlate replies to
    // inputs / log the transcript. Echoes the raw user text, before @file or
    // IDE-context expansion.
    if (options.replayUserMessages && parsed.text) {
      emit({
        type: "user",
        message: { role: "user", content: parsed.text },
        session_id: sessionId,
      });
    }

    // Per-turn iteration budget so one turn can't starve the rest.
    const budget = Number.isFinite(options.maxTurns)
      ? new IterationBudget({
          limit: Math.max(1, Math.floor(options.maxTurns)),
        })
      : new IterationBudget();

    // Custom slash-command macro expansion per user event (Claude-Code parity:
    // a /name from .claude/commands runs in panel / stream mode too, not just
    // the REPL). expandCommand already runs @file expansion, so the @-ref pass
    // below is skipped when a macro matched. Opt out: options.slashMacros:false.
    let userContent = parsed.text;
    let slashExpanded = false;
    // A matched command's `model:` / `allowed-tools:` frontmatter scopes THIS
    // turn's loopOptions below (parity with `cc command run` / headless -p).
    let turnMacroModel = null;
    let turnMacroTools = null;
    if (
      options.slashMacros !== false &&
      typeof parsed.text === "string" &&
      parsed.text.startsWith("/")
    ) {
      try {
        const doMacro =
          deps.resolveSlashMacro ||
          (await import("../repl/slash-macro.js")).resolveSlashMacro;
        const macro = await doMacro(parsed.text, { cwd });
        if (macro && macro.matched) {
          userContent = macro.promptText;
          slashExpanded = true;
          for (const w of macro.warnings || []) {
            writeErr(`  /${macro.name}: ${w}\n`);
          }
          writeErr(`  command: /${macro.name} [${macro.scope}]\n`);
          if (macro.model) {
            turnMacroModel = macro.model;
            writeErr(`  command: model → ${turnMacroModel}\n`);
          }
          if (macro.allowedTools) {
            turnMacroTools = parseToolList(macro.allowedTools);
          }
        }
      } catch {
        // macro resolution is best-effort — fall back to the literal text
      }
    }

    // @file expansion per user event (parity with single-turn headless).
    // Skipped when a slash macro already expanded (expandCommand ran @refs).
    if (!slashExpanded && options.expandFileRefs !== false) {
      const expanded = await doExpand(parsed.text, { cwd });
      userContent = expanded.prompt;
      for (const w of expanded.warnings) writeErr(`  @ref: ${w}\n`);
    }

    const expansionHooks = await executeLifecycleHooks(
      "UserPromptExpansion",
      {
        schema_version: 1,
        session_id: sessionId,
        turn: turns + 1,
        cwd,
        prompt: userContent,
        original_prompt: parsed.text,
      },
      { failClosed: true },
    );
    const expansion = resolvePromptExpansion(userContent, expansionHooks);
    if (expansion.blocked) {
      emit({
        type: "result",
        subtype: "blocked",
        is_error: true,
        result: expansion.reason || "blocked by UserPromptExpansion hook",
        session_id: sessionId,
      });
      sawError = true;
      continue;
    }
    userContent = expansion.prompt;

    // settings.json UserPromptSubmit hooks. block → skip this turn; context → inject.
    if (settingsHooks) {
      try {
        const { runUserPromptSubmitHooks } =
          await import("../lib/settings-hook-events.js");
        const ups = await runUserPromptSubmitHooks(settingsHooks, {
          prompt: userContent,
          cwd,
          sessionId,
        });
        if (ups.blocked) {
          emit({
            type: "result",
            subtype: "blocked",
            is_error: true,
            result: ups.reason || "blocked by UserPromptSubmit hook",
            session_id: sessionId,
          });
          continue;
        }
        if (ups.additionalContext) {
          userContent += `\n\n[hook context]\n${ups.additionalContext}`;
        }
      } catch (_err) {
        // settings hook dispatch is best-effort
      }
    }

    // IDE live context (Claude-Code parity): re-shared on every turn while an
    // IDE bridge is connected — the user's selection moves between prompts.
    // Best-effort; CC_IDE_CONTEXT=0 disables.
    try {
      const ideCtx = await (
        deps.buildIdePromptContext || buildIdePromptContext
      )(hostMcp);
      if (ideCtx) userContent += `\n\n${ideCtx}`;
      // Explicit @selection / @diagnostics mentions (Claude-Code parity);
      // scan the original user event text, append the expansion ephemerally.
      const mentioned = await expandIdeMentions(parsed.text, hostMcp);
      for (const w of mentioned.warnings) writeErr(`  @ide: ${w}\n`);
      if (mentioned.block) userContent += `\n\n${mentioned.block}`;
    } catch {
      // optional polish — never fail the turn over it
    }

    // Attach pasted/added images (panel parity with `--image`): file paths →
    // data URLs → OpenAI-style multimodal content. buildUserContent returns
    // the plain string when there are no images, so text turns are unchanged.
    // On an image turn, also switch THIS turn to the vision LLM (model only —
    // same account/key) so it's read by a vision-capable model.
    let turnContent = userContent;
    if (parsed.images && parsed.images.length) {
      try {
        turnContent = buildUserContent(
          userContent,
          resolveImages(parsed.images),
        );
        conversationHasImages = true;
      } catch (err) {
        emit({
          type: "result",
          subtype: "error",
          is_error: true,
          result: `image attach failed: ${err.message}`,
          session_id: sessionId,
        });
        continue; // bad attachment kills the turn, not the session
      }
    }
    // Route to the vision LLM (model only — same provider/account/key/baseUrl)
    // on any turn that carries an image AND on every later turn once the
    // conversation holds an image, so a text-only follow-up about the image
    // isn't sent to a text-only default model that can't read the history.
    let turnVisionLlm = null;
    if (conversationHasImages) {
      turnVisionLlm = resolveVisionLlm({
        hasImage: true,
        flags: {},
        llm: { provider, baseUrl, apiKey, visionModel },
      });
      if (parsed.images && parsed.images.length) {
        writeErr(
          `  [image] ${parsed.images.length} attached → vision model ${turnVisionLlm.model}\n`,
        );
      }
    }

    // §3.5.10 接线6: explicit per-turn LLM override (PDH privacy-tier switch).
    // Applies to THIS turn only; the vision override (above) still wins on image
    // turns since an image needs a vision-capable model.
    const turnLlmOverride = parsed.llm || null;
    if (turnLlmOverride && !turnVisionLlm) {
      writeErr(
        `  [llm] this turn → ${turnLlmOverride.provider || provider}/${
          turnLlmOverride.model || "(session model)"
        }\n`,
      );
    }

    if (evolutionIngress !== null) {
      await evolutionIngress.ingestUserPrompt({
        content: parsed.text,
        imageCount: parsed.images?.length || 0,
        sessionId,
        source: "headless-stream",
        turn: turns + 1,
      });
    }
    messages.push({ role: "user", content: turnContent });
    let persistenceFailure = null;
    if (persist) {
      try {
        store.appendUserMessage(sessionId, turnContent);
      } catch (error) {
        const persistenceError = createSessionPersistenceFailure(error, {
          sessionId,
          operation: "user-turn-append",
        });
        persistenceFailure = projectSessionPersistenceFailure(
          persistenceError,
          { phase: "before-model" },
        );
        if (persistenceFailure) {
          try {
            deps.onPersistenceFailure?.(persistenceFailure);
          } catch {
            // Observability cannot change persistence semantics.
          }
        }
      }
    }
    turns += 1;
    approvalGrantLedger.beginTurn(turns);
    if (persistenceFailure) {
      terminalPersistenceFailure = persistenceFailure;
      sawError = true;
      emit({
        type: "result",
        subtype: "error_persistence",
        is_error: true,
        code: persistenceFailure.code,
        error: "Session user turn was not durably persisted",
        session_id: sessionId,
        turn: turns,
        persistence: persistenceFailure,
      });
      break;
    }
    turnBindingFeed?.beginTurn(messages.length, {
      worktreeId: options.worktreeId ?? null,
    });

    // Per-turn abort scope: an {"type":"interrupt"} from the pump above
    // aborts THIS turn (LLM fetch included — the signal reaches chatWithTools)
    // while the conversation/process stays alive for the next message.
    currentAbort = new AbortController();
    const turnSignal = options.signal
      ? AbortSignal.any([options.signal, currentAbort.signal])
      : currentAbort.signal;

    // Consume the one-shot resume-degeneracy flag for THIS turn (see
    // sanitizeRolesNextTurn) so the role merge fires exactly once, whether the
    // model call completes or is interrupted.
    const mergeRolesThisTurn = sanitizeRolesNextTurn;
    sanitizeRolesNextTurn = false;

    let outcome;
    try {
      outcome = await runTurn(
        messages,
        {
          ...loopOptionsBase,
          // Custom-command frontmatter scopes THIS turn (parity with `cc command
          // run` / headless -p): a matched /name applies its model: and
          // allowed-tools:. Lowest-priority override — an explicit per-turn
          // privacy (turnLlmOverride) or vision (turnVisionLlm) switch below
          // still wins on model.
          ...(turnMacroModel ? { model: turnMacroModel } : {}),
          ...(turnMacroTools ? { enabledToolNames: turnMacroTools } : {}),
          // §3.5.10 接线6: explicit per-turn LLM override (privacy-tier switch);
          // only the fields provided are overridden (e.g. provider+model+baseUrl
          // to route to your own PC Ollama for one turn).
          ...(turnLlmOverride
            ? {
                ...(turnLlmOverride.provider
                  ? { provider: turnLlmOverride.provider }
                  : {}),
                ...(turnLlmOverride.model
                  ? { model: turnLlmOverride.model }
                  : {}),
                ...(turnLlmOverride.baseUrl
                  ? { baseUrl: turnLlmOverride.baseUrl }
                  : {}),
                ...(turnLlmOverride.apiKey
                  ? { apiKey: turnLlmOverride.apiKey }
                  : {}),
              }
            : {}),
          // Image turn → switch this turn's provider/model/baseUrl/apiKey to
          // the vision LLM (model only; same account/key/baseUrl). Wins over an
          // explicit llm override above (an image needs a vision model).
          ...(turnVisionLlm
            ? {
                provider: turnVisionLlm.provider,
                model: turnVisionLlm.model,
                baseUrl: turnVisionLlm.baseUrl,
                apiKey: turnVisionLlm.apiKey,
              }
            : {}),
          iterationBudget: budget,
          signal: turnSignal,
          onUsageBoundary: persistUsageEvent,
          onUsageSettlement: persistUsageEvent,
          onToolCallBoundary: persistChildToolBoundary,
          onToolCallSettlement: persistChildToolSettlement,
          // Keep the session heartbeat and protocol pumps live while a
          // foreground command such as a networked git push is still running.
          nonBlockingShell: true,
          // Resume-degenerate role merge for the first live model call only.
          mergeRoles: mergeRolesThisTurn,
        },
        {
          runLoop,
          emit,
          costBudget,
          nextToolUseId,
          sideEffects,
          turnNumber: turns,
          turnBindingFeed,
          waitForOutput: deps.outputFlow?.wait,
          now: deps.now || Date.now,
          persistUsageEvent,
          persistToolEvent,
          sessionBudget: options.sessionBudget || null,
          evolutionIngress,
          emitPolicyDecisionEvents: () =>
            options.includeHookEvents === true &&
            fieldGate.permission_decision !== false,
        },
      );
    } catch (err) {
      currentAbort = null;
      if (err?.code === AGENT_EVOLUTION_INGRESS_FAILED_CODE) {
        emit({
          type: "result",
          subtype: "error_evolution_ingress",
          is_error: true,
          code: err.code,
          error: err.message,
          turn: turns,
        });
        sawError = true;
        evolutionIngressFailed = true;
        break;
      }
      if (persist) {
        const normalized = createSessionPersistenceFailure(err, {
          sessionId,
          operation: "append-event",
        });
        const telemetryPersistence = projectSessionPersistenceFailure(
          normalized,
          { phase: "after-model" },
        );
        if (telemetryPersistence) {
          terminalPersistenceFailure = telemetryPersistence;
          try {
            deps.onPersistenceFailure?.(telemetryPersistence);
          } catch {
            // Observability cannot change persistence semantics.
          }
          emit({
            type: "result",
            subtype: "error_persistence",
            is_error: true,
            code: telemetryPersistence.code,
            persistence: telemetryPersistence,
            turn: turns,
          });
          sawError = true;
          break;
        }
        if (err?.runtimeLedgerPersistence === true) {
          emit({
            type: "result",
            subtype: "error_persistence",
            is_error: true,
            code: "CC_RUNTIME_LEDGER_PERSISTENCE_FAILED",
            turn: turns,
          });
          sawError = true;
          break;
        }
      }
      if (
        err?.code === "CC_SESSION_BUDGET_EXHAUSTED" ||
        err?.code === "CC_SESSION_BUDGET_USAGE_UNKNOWN" ||
        options.sessionBudget?.signal?.aborted === true
      ) {
        const budgetReason =
          options.sessionBudget?.reason?.() ||
          err.budgetReason ||
          "session-aborted";
        emit({
          type: "result",
          subtype: "error_session_budget",
          is_error: true,
          code: err.code,
          error:
            err?.code === "CC_SESSION_BUDGET_USAGE_UNKNOWN"
              ? err.message
              : sessionBudgetAdmissionError(budgetReason, "run").message,
          budget_reason: budgetReason,
          turn: turns,
        });
        sawError = true;
        break;
      }
      const isAbort =
        err?.name === "AbortError" || /abort/i.test(err?.message || "");
      if (isAbort && !options.signal?.aborted) {
        // User-initiated turn interrupt — not an error; no assistant message
        // is recorded (the dangling user turn is fine for the next exchange).
        //
        // BUT if the interrupt landed mid-tool-loop, `messages` now holds an
        // assistant turn whose tool_calls never got their results — sending
        // that next turn makes strict providers (Anthropic) reject the whole
        // request ("tool_use without tool_result"), wedging the rest of the
        // session. Drop the dangling call/result pair in place before
        // continuing. Always re-balance (not gated on length): a partial
        // interrupt that trims one assistant turn's tool_calls in place leaves
        // the array length unchanged. sanitizeToolPairs is idempotent on an
        // already-balanced array and leaves user/text turns untouched, so the
        // intentional dangling-user state above is preserved.
        const balanced = sanitizeToolPairs(messages);
        messages.length = 0;
        messages.push(...balanced);
        emit({
          type: "result",
          subtype: "interrupted",
          is_error: false,
          interrupted: true,
          session_id: sessionId,
          turn: turns,
        });
        continue;
      }
      if (isAbort) break; // outer options.signal — caller is shutting down
      emit({
        type: "result",
        subtype: "error",
        is_error: true,
        error: err?.message || String(err),
        turn: turns,
      });
      sawError = true;
      continue;
    } finally {
      persistTurnBindingLog();
    }
    if (turnBindingPersistenceError) {
      emitTurnBindingFailure();
      sawError = true;
      break;
    }
    currentAbort = null;

    if (outcome.endReason === "compaction-usage-unknown") {
      sawError = true;
      emit({
        type: "result",
        subtype: "error_compaction_usage_unknown",
        is_error: true,
        code: "CC_COMPACTION_USAGE_UNKNOWN",
        error:
          "Compaction provider usage is unknown; the paid compaction is not retried",
        session_id: sessionId,
        turn: turns,
        usage: outcome.usage,
        ...(costBudget ? { budget_state: "unverifiable" } : {}),
      });
      break;
    }

    // §3.5.18 出境台账: report what left the device this turn (the cloud-LLM
    // call + any egress-classed tool) so the Android transparency ledger —
    // which cannot see the cc subprocess's cloud call — records it. PDH-gated
    // and emit-only (cc never keeps its own ledger; it stays a single on-device
    // encrypted store). A local-only turn emits nothing — the honest "0 条出境".
    // Uses the EFFECTIVE per-turn LLM (a §3.5.10 privacy-tier / vision override
    // is exactly the egress-relevant decision).
    if (pdhContext) {
      try {
        const { turnEgressEvents } = await import("../lib/pdh-egress.js");
        const effProvider =
          turnVisionLlm?.provider || turnLlmOverride?.provider || provider;
        const effModel =
          turnVisionLlm?.model || turnLlmOverride?.model || model;
        const effBaseUrl =
          turnVisionLlm?.baseUrl || turnLlmOverride?.baseUrl || baseUrl;
        for (const ev of turnEgressEvents({
          provider: effProvider,
          baseUrl: effBaseUrl,
          model: effModel,
          toolCalls: outcome.toolCalls,
          usage: outcome.usage,
          sessionId,
          turn: turns,
        })) {
          emit(ev);
        }
      } catch {
        /* egress reporting is best-effort — never break the chat */
      }
    }

    // Grow the conversation so the next turn has context.
    messages.push({ role: "assistant", content: outcome.finalText });
    if (persist) {
      try {
        store.appendAssistantMessage(sessionId, outcome.finalText);
      } catch (error) {
        const persistenceError = createSessionPersistenceFailure(error, {
          sessionId,
          operation: "assistant-turn-append",
        });
        persistenceFailure = projectSessionPersistenceFailure(
          persistenceError,
          { phase: "after-model" },
        );
        if (persistenceFailure) {
          terminalPersistenceFailure = persistenceFailure;
          try {
            deps.onPersistenceFailure?.(persistenceFailure);
          } catch {
            // Observability cannot change persistence semantics.
          }
        }
      }
    }

    const exhausted =
      outcome.endReason === "budget-exhausted" ||
      outcome.endReason === "max_turns";
    const costStopped = outcome.endReason === "cost-budget-exhausted";
    const isError =
      exhausted ||
      costStopped ||
      outcome.endReason === "no-response" ||
      Boolean(persistenceFailure);
    if (isError) sawError = true;

    if (costStopped) {
      emit({
        type: "cost_budget_exhausted",
        limit_usd: options.maxCostUsd,
        spent_usd: costBudget?.spentUsd,
        session_id: sessionId,
        turn: turns,
      });
    }

    emit({
      type: "result",
      subtype: exhausted
        ? "error_max_turns"
        : costStopped
          ? "error_max_budget"
          : persistenceFailure
            ? "error_persistence"
            : isError
              ? "error"
              : "success",
      is_error: isError,
      result: outcome.finalText,
      session_id: sessionId,
      turn: turns,
      usage: outcome.usage,
      ...(persistenceFailure ? { persistence: persistenceFailure } : {}),
    });

    // --json-schema (P2): emit this turn's structured verdict right after its
    // result — schema_digest + valid + value/errors from the turn's final text.
    // Never falls back to free text; an unparseable/invalid reply reports
    // valid:false with coded/pointered errors. Parity with single-prompt output.
    if (_jsonSchema) {
      const parsed = _jso.extractJsonPayload(String(outcome.finalText ?? ""));
      emit({
        ..._jso.buildStructuredResult(
          _jsonSchema,
          parsed.ok ? parsed.value : null,
        ),
        session_id: sessionId,
        turn: turns,
      });
    }

    // Session-wide cost cap reached → stop accepting further turns.
    if (costStopped || persistenceFailure) break;

    // While planning, blocked tool calls grew the plan during this turn —
    // push the fresh snapshot so the panel's plan card stays live.
    {
      const pm = getPlanModeManager();
      if (pm.isActive()) {
        emit({
          type: "plan_update",
          ...planSnapshot(pm),
          session_id: sessionId,
        });
      }
    }
  }

  streamCleanup.setReason(
    pipeState.closed
      ? "pipe_closed"
      : options.signal?.aborted
        ? "aborted"
        : inputDone
          ? "stdin_closed"
          : "completed",
  );
  await streamCleanup.cleanup();
  removeHookObserver?.();

  if (evolutionIngress !== null && !evolutionIngressFailed) {
    await evolutionIngress.complete();
  }

  if (!pipeState.closed) {
    emit({ type: "system", subtype: "end", session_id: sessionId, turns });
  }
  return {
    exitCode: pipeState.closed ? 0 : sawError ? 1 : 0,
    turns,
    ...(terminalPersistenceFailure
      ? { persistence: terminalPersistenceFailure }
      : {}),
  };
}
