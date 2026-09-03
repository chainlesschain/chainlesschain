import {
  RUNTIME_EVENTS,
  createRuntimeEvent,
  createCodingAgentEvent,
  CODING_AGENT_EVENT_TYPES,
} from "../../runtime/runtime-events.js";
import { createSessionRecord } from "../../runtime/contracts/session-record.js";
import { loadSideEffectLedger } from "../../lib/side-effect-ledger-store.js";
import { acquireSessionHostLease } from "../../lib/session-host-lease.js";
import { reconcileSideEffects } from "../../lib/side-effect-ledger.js";
import {
  formatMcpLedgerRecoveryNotice,
  loadMcpLedgerRecovery,
} from "../../lib/mcp-call-ledger-store.js";
import { isProxy } from "node:util/types";
import {
  MCP_RECOVERY_INVALID_CODE,
  classifyMcpRecoveryAdmission,
} from "../../lib/mcp-ledger-recovery-admission.js";
import { readSessionHostResumeState } from "../../lib/session-host-snapshot.js";
import { sanitizePersistedMessages } from "../../lib/session-message-provenance.js";
import {
  deleteJsonlSession,
  startSession as startJsonlSession,
} from "../../harness/jsonl-session-store.js";
import {
  normalizeSessionBudgetRootConfig,
  openProductionSessionBudgetRoot,
  resolveSessionBudgetRootOptions,
  sessionBudgetAdmissionError,
} from "../../lib/session-budget-production-root.js";
import { mergePricing } from "../../lib/llm-pricing.js";
import { ensureCanonicalSessionTranscript } from "../../lib/session-transcript-migration.js";

const PAYLOAD_DIGEST = /^sha256:[0-9a-f]{64}$/;
const RAW_AUTHORITY_HASH = /^[0-9a-f]{64}$/;
const MCP_REPLAY_DENY_FIELDS = new Set([
  "ledgerId",
  "serverName",
  "toolName",
  "inputBytes",
  "replayDigest",
]);
const MCP_RECOVERY_REMEDIATIONS = new Set([
  "inspect_transcript",
  "adjudicate_started_calls",
  "exact_replay_denied",
]);
const RESUME_RECOVERY_NOTICE = Symbol("cc.resume-recovery-notice");

function captureCanonicalHostSystemPrefix(session) {
  if (Array.isArray(session?._canonicalHostSystemPrefix)) {
    const explicit = sanitizePersistedMessages(
      session._canonicalHostSystemPrefix,
      { strict: true },
    );
    if (explicit.some((message) => message.role !== "system")) {
      throw new TypeError("Canonical WS host prefix is invalid");
    }
    return Object.freeze(explicit.map((message) => Object.freeze(message)));
  }
  const persisted = sanitizePersistedMessages(session?.messages || [], {
    strict: true,
  });
  const firstMessage = persisted[0] || null;
  const prefix = [];
  if (firstMessage?.role === "system") {
    // A WS session is created with exactly one host-owned system prompt. Any
    // later leading systems may be canonical summaries or recovery notices
    // serialized by the DB compatibility mirror; they must not be promoted
    // into the host prefix after a process restart.
    prefix.push(Object.freeze(firstMessage));
  }
  const frozenPrefix = Object.freeze(prefix);
  Object.defineProperty(session, "_canonicalHostSystemPrefix", {
    configurable: true,
    value: frozenPrefix,
  });
  return frozenPrefix;
}

function replaceResumeRecoveryNotice(session, notice) {
  const previous = session?._resumeRecoveryNoticeMessage || null;
  const messages = (
    Array.isArray(session?.messages) ? session.messages : []
  ).filter(
    (message) =>
      message !== previous && message?.[RESUME_RECOVERY_NOTICE] !== true,
  );
  let insertionIndex = 0;
  while (messages[insertionIndex]?.role === "system") insertionIndex += 1;

  let recoveryMessage = null;
  if (typeof notice === "string" && notice.trim()) {
    recoveryMessage = { role: "system", content: notice };
    Object.defineProperty(recoveryMessage, RESUME_RECOVERY_NOTICE, {
      value: true,
    });
    messages.splice(insertionIndex, 0, recoveryMessage);
  }
  session.messages = messages;
  Object.defineProperty(session, "_resumeRecoveryNoticeMessage", {
    configurable: true,
    writable: true,
    value: recoveryMessage,
  });
}

function recoveryErrorCode(error, fallbackCode) {
  try {
    return typeof error?.code === "string" && error.code
      ? error.code
      : fallbackCode;
  } catch {
    return fallbackCode;
  }
}

function ownDataValue(record, key, fallback = null) {
  if (!record || typeof record !== "object" || isProxy(record)) {
    const error = new TypeError(`MCP recovery ${key} record is not plain data`);
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return fallback;
  if (!("value" in descriptor)) {
    const error = new TypeError(`MCP recovery ${key} must be a data property`);
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  return descriptor.value;
}

function recoveryString(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  const error = new TypeError("MCP recovery scalar must be a string");
  error.code = MCP_RECOVERY_INVALID_CODE;
  throw error;
}

function snapshotMcpRecord(record) {
  const effectContract = ownDataValue(record, "effectContract", null);
  let effect = "unknown";
  if (effectContract != null) {
    if (typeof effectContract !== "object" || isProxy(effectContract)) {
      const error = new TypeError("MCP recovery effect contract is malformed");
      error.code = MCP_RECOVERY_INVALID_CODE;
      throw error;
    }
    effect = recoveryString(
      ownDataValue(effectContract, "effect", "unknown"),
      "unknown",
    );
  }
  return Object.freeze({
    ledgerId: recoveryString(ownDataValue(record, "ledgerId", null), null),
    serverName: recoveryString(
      ownDataValue(record, "serverName", "unknown"),
      "unknown",
    ),
    toolName: recoveryString(
      ownDataValue(record, "toolName", "unknown"),
      "unknown",
    ),
    effect,
  });
}

function snapshotMcpIncident(incident) {
  return Object.freeze({
    code: recoveryString(
      ownDataValue(incident, "code", MCP_RECOVERY_INVALID_CODE),
      MCP_RECOVERY_INVALID_CODE,
    ),
    ledgerId: recoveryString(ownDataValue(incident, "ledgerId", null), null),
  });
}

function snapshotMcpReplayDeny(entry) {
  if (!entry || typeof entry !== "object" || isProxy(entry)) {
    const error = new TypeError("MCP replay deny entry is malformed");
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  const descriptors = Object.getOwnPropertyDescriptors(entry);
  const fields = Object.keys(descriptors);
  if (
    fields.length !== MCP_REPLAY_DENY_FIELDS.size ||
    fields.some((field) => !MCP_REPLAY_DENY_FIELDS.has(field)) ||
    [...MCP_REPLAY_DENY_FIELDS].some(
      (field) => !descriptors[field] || !("value" in descriptors[field]),
    )
  ) {
    const error = new TypeError("MCP replay deny entry schema is invalid");
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  const snapshot = Object.freeze({
    ledgerId: recoveryString(descriptors.ledgerId.value, null),
    serverName: recoveryString(descriptors.serverName.value, null),
    toolName: recoveryString(descriptors.toolName.value, null),
    inputBytes: descriptors.inputBytes.value,
    replayDigest: recoveryString(descriptors.replayDigest.value, null),
  });
  if (
    !snapshot.ledgerId ||
    !snapshot.serverName ||
    !snapshot.toolName ||
    !Number.isInteger(snapshot.inputBytes) ||
    snapshot.inputBytes < 0 ||
    !PAYLOAD_DIGEST.test(snapshot.replayDigest || "")
  ) {
    const error = new TypeError("MCP replay deny identity is invalid");
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  return snapshot;
}

function strictMcpRecoverySnapshot(recovery) {
  if (recovery == null) {
    const error = new TypeError("MCP recovery projection is missing");
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  const admission = classifyMcpRecoveryAdmission(recovery);
  if (admission.reasonCode) {
    const error = new TypeError("MCP recovery projection is malformed");
    error.code = admission.reasonCode;
    throw error;
  }

  // classifyMcpRecoveryAdmission rejects proxies/accessors first. Capture the
  // two authority arrays exactly once as own data descriptors so a formatter
  // or time-varying getter can never turn an unsafe projection into clean state.
  const descriptors = Object.getOwnPropertyDescriptors(recovery);
  const unsettledSource = descriptors.unsettled?.value;
  const incidentsSource = descriptors.incidents?.value;
  const replayDeniedSource = descriptors.replayDenied?.value;
  if (
    !Array.isArray(unsettledSource) ||
    !Array.isArray(incidentsSource) ||
    !Array.isArray(replayDeniedSource)
  ) {
    const error = new TypeError("MCP recovery arrays are unavailable");
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  const unsettled = Object.freeze(unsettledSource.map(snapshotMcpRecord));
  const incidents = Object.freeze(incidentsSource.map(snapshotMcpIncident));
  const replayDenied = Object.freeze(
    replayDeniedSource.map(snapshotMcpReplayDeny),
  );
  const headHash = recoveryString(
    ownDataValue(recovery, "headHash", null),
    null,
  );
  const recoveryDigest = recoveryString(
    ownDataValue(recovery, "recoveryDigest", null),
    null,
  );
  if (
    (headHash != null && !RAW_AUTHORITY_HASH.test(headHash)) ||
    (recoveryDigest != null && !PAYLOAD_DIGEST.test(recoveryDigest))
  ) {
    const error = new TypeError("MCP recovery authority digest is invalid");
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  const remediation = recoveryString(
    ownDataValue(recovery, "remediation", null),
    null,
  );
  if (remediation !== null && !MCP_RECOVERY_REMEDIATIONS.has(remediation)) {
    const error = new TypeError("MCP recovery remediation is invalid");
    error.code = MCP_RECOVERY_INVALID_CODE;
    throw error;
  }
  return Object.freeze({
    admission,
    unsettled,
    incidents,
    replayDenied,
    headHash,
    recoveryDigest,
    remediation,
  });
}

function failClosedMcpRecovery(
  error,
  fallbackCode = "CC_MCP_LEDGER_EVENT_READ_FAILED",
) {
  const code = recoveryErrorCode(error, fallbackCode);
  const incident = Object.freeze({ code, ledgerId: null });
  return Object.freeze({
    count: 1,
    unsettled: Object.freeze([]),
    incidents: Object.freeze([incident]),
    replayDenied: Object.freeze([]),
    blockMode: "all",
    headHash: null,
    recoveryDigest: null,
    remediation: "inspect_transcript",
    notice:
      "MCP recovery notice — the durable MCP ledger could not be verified. " +
      "Do NOT automatically retry prior MCP actions; inspect the session " +
      `transcript first (${code}).`,
  });
}

/**
 * P0-2: on a bridge/IDE resume, surface any irreversible tool that was in flight
 * when the prior worker died. Returns a de-identified recovery descriptor (kind
 * + short key + reason, never argument values) plus a human-readable notice, or
 * null when nothing needs verification. PURE apart from reading the ledger.
 */
function buildSideEffectResumeRecovery(sessionId, loadLedger) {
  try {
    const ledger = loadLedger(sessionId);
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
    return { count: items.length, items, incidents: [], notice };
  } catch (error) {
    const code = recoveryErrorCode(
      error,
      "CC_SIDE_EFFECT_LEDGER_RECOVERY_FAILED",
    );
    return {
      count: 1,
      items: [],
      incidents: [{ code }],
      notice:
        "Side-effect recovery notice — the durable side-effect ledger could " +
        "not be verified. Do NOT automatically retry prior irreversible " +
        `operations until the transcript is inspected (${code}).`,
    };
  }
}

function buildMcpResumeRecovery(sessionId, loadRecovery, formatNotice) {
  try {
    const snapshot = strictMcpRecoverySnapshot(loadRecovery(sessionId));
    const unsettled = Object.freeze(
      snapshot.unsettled.map((record) =>
        Object.freeze({
          ledgerId: record.ledgerId,
          serverName: record.serverName,
          toolName: record.toolName,
          effect: record.effect,
          status: "outcome_unknown",
        }),
      ),
    );
    const incidents = snapshot.incidents;
    const requiresInspection =
      unsettled.length > 0 ||
      incidents.length > 0 ||
      snapshot.replayDenied.length > 0 ||
      snapshot.admission.blockMode != null;
    let notice = null;
    if (requiresInspection) {
      const formatterProjection = Object.freeze({
        unsettled: Object.freeze(
          snapshot.unsettled.map((record) =>
            Object.freeze({
              ledgerId: record.ledgerId,
              serverName: record.serverName,
              toolName: record.toolName,
              effectContract: Object.freeze({ effect: record.effect }),
            }),
          ),
        ),
        incidents,
        replayDenied: snapshot.replayDenied,
      });
      notice = formatNotice(formatterProjection);
      if (notice != null && typeof notice !== "string") {
        const error = new TypeError(
          "MCP recovery formatter must return a synchronous string or null",
        );
        error.code = MCP_RECOVERY_INVALID_CODE;
        throw error;
      }
      notice ||=
        "MCP recovery notice — durable MCP state requires inspection. Do NOT " +
        "automatically retry prior MCP actions until recovery is adjudicated.";
    }
    return Object.freeze({
      count: unsettled.length + incidents.length + snapshot.replayDenied.length,
      unsettled,
      incidents,
      headHash: snapshot.headHash,
      recoveryDigest: snapshot.recoveryDigest,
      replayDenied: snapshot.replayDenied,
      remediation: snapshot.remediation,
      notice,
      ...(snapshot.admission.blockMode
        ? { blockMode: snapshot.admission.blockMode }
        : {}),
    });
  } catch (error) {
    return failClosedMcpRecovery(error);
  }
}

/**
 * Build the de-identified recovery payload shared by the IDE envelope and the
 * resumed model. Dependencies are injectable so fail-closed recovery can be
 * tested without touching a user's durable session directory.
 */
export function buildResumeRecovery(sessionId, dependencies = {}) {
  const sideEffects = buildSideEffectResumeRecovery(
    sessionId,
    dependencies.loadSideEffectLedger || loadSideEffectLedger,
  );
  const mcp = buildMcpResumeRecovery(
    sessionId,
    dependencies.loadMcpLedgerRecovery || loadMcpLedgerRecovery,
    dependencies.formatMcpLedgerRecoveryNotice || formatMcpLedgerRecoveryNotice,
  );
  if (!sideEffects && !mcp) return null;

  return {
    count: (sideEffects?.count || 0) + (mcp?.count || 0),
    items: sideEffects?.items || [],
    sideEffectIncidents: sideEffects?.incidents || [],
    ...(mcp ? { mcp } : {}),
    notice: [sideEffects?.notice, mcp?.notice].filter(Boolean).join("\n\n"),
  };
}

// Build a unified envelope for a solicited WS response. The bridge correlates
// by `requestId` (the inbound request's id) and unwraps `payload` for callers
// so existing flat-shape consumers keep working unchanged.
function envelopeResponse(type, id, payload, sessionId) {
  return createCodingAgentEvent(type, payload || {}, {
    requestId: id,
    sessionId: sessionId || null,
    source: "cli-runtime",
  });
}

function envelopeError(id, code, message, sessionId, details = {}) {
  return createCodingAgentEvent(
    CODING_AGENT_EVENT_TYPES.ERROR,
    { ...details, code, message },
    {
      requestId: id,
      sessionId: sessionId || null,
      source: "cli-runtime",
    },
  );
}

// Phase 5 envelope opt-in via beta flag `unified-envelope-2026-04-16`.
// Falls back to false if BetaFlags is unavailable so legacy behavior wins.
const PHASE5_ENVELOPE_FLAG = "unified-envelope-2026-04-16";

function wsBudgetDependency(server, name, fallback) {
  const candidate = server?._sessionBudgetDependencies?.[name];
  return typeof candidate === "function" ? candidate : fallback;
}

function resolveWsSessionBudget(message) {
  return resolveSessionBudgetRootOptions({
    sessionBudget: message.sessionBudget,
    sessionMaxConcurrent: message.sessionMaxConcurrent,
    sessionMaxSpawns: message.sessionMaxSpawns,
    sessionMaxDepth: message.sessionMaxDepth,
    sessionMaxTurns: message.sessionMaxTurns,
    sessionMaxTokens: message.sessionMaxTokens,
    sessionMaxCostUsd: message.sessionMaxCostUsd,
    sessionMaxWallMs: message.sessionMaxWallMs,
    sessionMaxToolMs: message.sessionMaxToolMs,
  });
}

function sameSessionBudgetConfig(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

async function _isPhase5EnvelopesEnabled() {
  try {
    const { getBetaFlags } =
      await import("../../lib/session-core-singletons.js");
    const flags = await getBetaFlags();
    return flags.isEnabled(PHASE5_ENVELOPE_FLAG);
  } catch (_e) {
    return false;
  }
}

async function ensureSessionHandler(
  server,
  ws,
  session,
  { sessionHostLease: suppliedSessionHostLease = null } = {},
) {
  const budgetConfig = session.sessionBudgetRoot
    ? normalizeSessionBudgetRootConfig(session.sessionBudgetRoot)
    : resolveSessionBudgetRootOptions({});
  if (budgetConfig.enabled && session.type === "chat") {
    const error = new Error(
      "Durable WebSocket session budgets require an agent session",
    );
    error.code = "CC_SESSION_BUDGET_WS_AGENT_REQUIRED";
    suppliedSessionHostLease?.release?.();
    throw error;
  }

  const { WebSocketInteractionAdapter } =
    await import("../../lib/interaction-adapter.js");
  const enablePhase5Envelopes = await _isPhase5EnvelopesEnabled();
  session.interaction = new WebSocketInteractionAdapter(ws, session.id, {
    enablePhase5Envelopes,
    envelopeBus: server.envelopeBus || null,
    onPendingApprovalChange: ({ type, payload }) => {
      if (
        server.sessionManager &&
        typeof server.sessionManager.recordSessionStateEvent === "function"
      ) {
        server.sessionManager.recordSessionStateEvent(
          session.id,
          type,
          payload,
        );
      }
    },
  });

  const existingHandler = server.sessionHandlers.get(session.id);
  if (existingHandler) {
    suppliedSessionHostLease?.release?.();
    existingHandler.assertSessionBudgetAdmission?.("WebSocket resume");
    if (typeof existingHandler.attachInteraction === "function") {
      existingHandler.attachInteraction(session.interaction);
    } else {
      existingHandler.interaction = session.interaction;
    }
  }

  // Route MCP elicitation through the authenticated WS question channel. The
  // MCP client may be shared by the runtime, so this is deliberately only a
  // transport hook; the MCP request/answer ids remain inside the pending
  // interaction entry and unknown answers are ignored by the adapter.
  if (
    session.mcpClient &&
    typeof session.mcpClient.setElicitationHandler === "function"
  ) {
    session.mcpClient.setElicitationHandler(
      async (request) => {
        const answer = await session.interaction.askElicitation(request);
        if (answer == null) return { action: "cancel" };
        if (typeof answer === "object") {
          return { action: "accept", content: answer };
        }
        return { action: "accept", content: { value: answer } };
      },
      { sessionId: session.id, timeoutMs: 180000 },
    );
  }

  if (existingHandler) return existingHandler;

  let handler;
  if (session.type === "chat") {
    const { WSChatHandler } = await import("../../lib/ws-chat-handler.js");
    handler = new WSChatHandler({
      session,
      interaction: session.interaction,
    });
  } else {
    const { WSAgentHandler } = await import("./ws-agent-handler.js");
    let sessionHostLease =
      suppliedSessionHostLease ||
      wsBudgetDependency(
        server,
        "acquireSessionHostLease",
        acquireSessionHostLease,
      )(session.id, { hostKind: "ws" });
    let sessionBudgetRoot = null;
    try {
      if (budgetConfig.enabled) {
        const priceTable =
          budgetConfig.limits.maxUsd != null
            ? wsBudgetDependency(
                server,
                "mergePricing",
                mergePricing,
              )(server.sessionManager.config?.llm?.pricing)
            : undefined;
        sessionBudgetRoot = wsBudgetDependency(
          server,
          "openProductionSessionBudgetRoot",
          openProductionSessionBudgetRoot,
        )(session.id, budgetConfig, {
          persist: true,
          signal: sessionHostLease.signal || null,
          table: priceTable,
        });
        if (
          sessionBudgetRoot?.enabled !== true ||
          !sessionBudgetRoot.budget ||
          !sessionBudgetRoot.options ||
          sessionBudgetRoot.options.sessionBudget !==
            sessionBudgetRoot.budget ||
          typeof sessionBudgetRoot.close !== "function"
        ) {
          const error = new Error("WebSocket session budget root is invalid");
          error.code = "CC_SESSION_BUDGET_ROOT_INVALID";
          throw error;
        }
        if (sessionBudgetRoot.budget.signal?.aborted === true) {
          throw sessionBudgetAdmissionError(
            sessionBudgetRoot.budget.reason?.(),
            "WebSocket startup",
          );
        }
      }
      handler = new WSAgentHandler({
        session,
        interaction: session.interaction,
        db: server.sessionManager.db,
        sessionHostLease,
        sessionBudgetRoot,
        evolutionCompositionFactory: server.evolutionCompositionFactory,
        skillOutcomeIndex: server.skillOutcomeIndex,
      });
      sessionHostLease = null;
      sessionBudgetRoot = null;
    } catch (error) {
      const cleanupErrors = [];
      try {
        sessionBudgetRoot?.close?.();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      try {
        sessionHostLease?.release?.();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          "WebSocket handler bootstrap and authority cleanup both failed",
        );
      }
      throw error;
    }
  }

  server.sessionHandlers.set(session.id, handler);
  return handler;
}

export async function handleSessionCreate(server, id, ws, message) {
  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(
        id,
        "NO_SESSION_SUPPORT",
        "Session support not configured on this server",
      ),
    );
    return;
  }

  const {
    sessionType,
    provider,
    model,
    apiKey,
    baseUrl,
    projectRoot,
    enabledToolNames,
    hostManagedToolPolicy,
    worktreeIsolation,
    systemPromptExtension,
    shellPolicyOverrides,
    sessionBudget,
    sessionMaxConcurrent,
    sessionMaxSpawns,
    sessionMaxDepth,
    sessionMaxTurns,
    sessionMaxTokens,
    sessionMaxCostUsd,
    sessionMaxWallMs,
    sessionMaxToolMs,
  } = message;

  let createdSessionId = null;
  let canonicalSessionCreated = false;
  let bootstrapLease = null;
  let delegatedBootstrapLease = null;
  try {
    const sessionBudgetRoot = resolveWsSessionBudget({
      sessionBudget,
      sessionMaxConcurrent,
      sessionMaxSpawns,
      sessionMaxDepth,
      sessionMaxTurns,
      sessionMaxTokens,
      sessionMaxCostUsd,
      sessionMaxWallMs,
      sessionMaxToolMs,
    });
    if (sessionBudgetRoot.enabled && (sessionType || "agent") !== "agent") {
      const error = new Error(
        "Durable WebSocket session budgets require sessionType=agent",
      );
      error.code = "CC_SESSION_BUDGET_WS_AGENT_REQUIRED";
      throw error;
    }
    const { sessionId } = server.sessionManager.createSession({
      type: sessionType || "agent",
      provider,
      model,
      apiKey,
      baseUrl,
      projectRoot,
      enabledToolNames,
      hostManagedToolPolicy,
      worktreeIsolation,
      systemPromptExtension,
      shellPolicyOverrides,
      sessionBudgetRoot: sessionBudgetRoot.enabled ? sessionBudgetRoot : null,
      requireDurable: sessionBudgetRoot.enabled,
    });
    createdSessionId = sessionId;

    const session = server.sessionManager.getSession(sessionId);
    if (
      (sessionType || "agent") === "agent" &&
      (sessionBudgetRoot.enabled ||
        typeof server.sessionManager.markCanonicalSession === "function")
    ) {
      bootstrapLease = wsBudgetDependency(
        server,
        "acquireSessionHostLease",
        acquireSessionHostLease,
      )(sessionId, { hostKind: "ws" });
      let startedSessionId;
      try {
        startedSessionId = wsBudgetDependency(
          server,
          "startJsonlSession",
          startJsonlSession,
        )(sessionId, {
          title: `WS agent ${new Date().toISOString().slice(0, 10)}`,
          provider: session.provider,
          model: session.model || "",
          ...(sessionBudgetRoot.enabled ? { sessionBudgetRoot } : {}),
        });
        canonicalSessionCreated = true;
      } catch (cause) {
        const error = new Error(
          "WebSocket canonical session could not be durably created",
          { cause },
        );
        error.code = sessionBudgetRoot.enabled
          ? "CC_SESSION_BUDGET_SESSION_START_FAILED"
          : "CC_WS_CANONICAL_SESSION_START_FAILED";
        throw error;
      }
      if (startedSessionId !== sessionId) {
        const error = new Error(
          "WebSocket canonical session returned a different session id",
        );
        error.code = sessionBudgetRoot.enabled
          ? "CC_SESSION_BUDGET_SESSION_START_FAILED"
          : "CC_WS_CANONICAL_SESSION_START_FAILED";
        throw error;
      }
      if (typeof server.sessionManager.markCanonicalSession === "function") {
        server.sessionManager.markCanonicalSession(sessionId);
      } else {
        session.canonicalJsonlSession = true;
      }
      const canonicalStart = wsBudgetDependency(
        server,
        "readSessionHostResumeState",
        readSessionHostResumeState,
      )(sessionId);
      if (!canonicalStart?.snapshot?.verified) {
        const error = new Error(
          "WebSocket canonical session could not be verified",
        );
        error.code = sessionBudgetRoot.enabled
          ? "CC_SESSION_BUDGET_SESSION_START_FAILED"
          : "CC_WS_CANONICAL_SESSION_START_FAILED";
        throw error;
      }
      if (
        sessionBudgetRoot.enabled &&
        (!canonicalStart.sessionBudgetRoot ||
          !sameSessionBudgetConfig(
            canonicalStart.sessionBudgetRoot,
            sessionBudgetRoot,
          ))
      ) {
        const error = new Error(
          "Budgeted WebSocket JSONL declaration does not match the requested root",
        );
        error.code = "CC_SESSION_BUDGET_CONFIG_MISMATCH";
        throw error;
      }
      session.canonicalJsonlSession = true;
      session.sessionHostSnapshot = canonicalStart.snapshot;
    }
    const record = createSessionRecord(session, {
      sessionId,
      sessionType: sessionType || "agent",
      provider,
      model,
      projectRoot: projectRoot || null,
      baseProjectRoot: session?.baseProjectRoot || projectRoot || null,
      worktreeIsolation: worktreeIsolation === true,
      worktree: session?.worktree || null,
      status: "created",
    });

    delegatedBootstrapLease = bootstrapLease;
    bootstrapLease = null;
    await ensureSessionHandler(server, ws, session, {
      sessionHostLease: delegatedBootstrapLease,
    });
    delegatedBootstrapLease = null;

    server.emit("session:create", { sessionId, type: sessionType || "agent" });

    // Phase 5: broadcast service envelope for unified subscribers.
    if (typeof server.broadcastEnvelope === "function") {
      server.broadcastEnvelope({
        type: "session.created",
        sessionId,
        payload: {
          sessionType: sessionType || "agent",
          provider,
          model,
          projectRoot: projectRoot || null,
        },
      });
    }
    server.emit(
      RUNTIME_EVENTS.SESSION_START,
      createRuntimeEvent(
        RUNTIME_EVENTS.SESSION_START,
        {
          sessionId,
          sessionType: sessionType || "agent",
          provider,
          model,
          projectRoot: projectRoot || null,
          record,
        },
        { kind: "server", sessionId },
      ),
    );

    server._send(
      ws,
      envelopeResponse(
        CODING_AGENT_EVENT_TYPES.SESSION_STARTED,
        id,
        {
          sessionId,
          sessionType: sessionType || "agent",
          record,
        },
        sessionId,
      ),
    );
  } catch (err) {
    if (createdSessionId) {
      const createdSession = server.sessionManager.getSession(createdSessionId);
      createdSession?.mcpClient?.clearElicitationHandler?.(createdSessionId);
      const handler = server.sessionHandlers.get(createdSessionId);
      try {
        handler?.destroy?.();
      } catch {
        // The creation failure remains authoritative; rollback below still
        // removes the unpublished manager/database state.
      }
      server.sessionHandlers.delete(createdSessionId);
      if (canonicalSessionCreated) {
        try {
          wsBudgetDependency(
            server,
            "deleteJsonlSession",
            deleteJsonlSession,
          )(createdSessionId);
        } catch {
          // The bootstrap failure remains authoritative. A durable tombstone
          // or orphan cleanup incident must never become session.started.
        }
      }
      try {
        if (
          typeof server.sessionManager.rollbackSessionCreation === "function"
        ) {
          server.sessionManager.rollbackSessionCreation(createdSessionId);
        } else {
          server.sessionManager.closeSession(createdSessionId);
        }
      } catch {
        // Do not turn a failed bootstrap into a successful protocol response.
      }
    }
    try {
      bootstrapLease?.release?.();
    } catch {
      // Preserve the bootstrap error sent below.
    }
    try {
      delegatedBootstrapLease?.release?.();
    } catch {
      // ensureSessionHandler may already have attempted this release.
    }
    server._send(
      ws,
      envelopeError(
        id,
        err?.code || "SESSION_CREATE_FAILED",
        err?.message || "WebSocket session creation failed",
        createdSessionId,
      ),
    );
  }
}

export async function handleSessionResume(server, id, ws, message) {
  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const { sessionId } = message;
  // Always consult the canonical transcript before the compatibility store.
  // A manager without the newer markCanonicalSession() hook may still be
  // resuming a session that another host already committed to JSONL. Skipping
  // this read lets stale DB/WS state replace verified history and also bypasses
  // missing/tampered/rollback refusal. readSessionHostResumeState() returns
  // null for a genuinely absent transcript, so legacy-only sessions retain
  // their compatibility fallback without weakening canonical authority.
  let canonicalResume = wsBudgetDependency(
    server,
    "readSessionHostResumeState",
    readSessionHostResumeState,
  )(sessionId);
  if (canonicalResume && !canonicalResume.snapshot.verified) {
    server._send(
      ws,
      envelopeError(
        id,
        "CC_SESSION_HOST_SNAPSHOT_UNVERIFIED",
        "Canonical JSONL session is not verified; resume was refused",
        sessionId,
        { sessionSnapshot: canonicalResume.snapshot },
      ),
    );
    return;
  }
  let session = server.sessionManager.resumeSession(sessionId);
  if (
    !session &&
    canonicalResume?.snapshot?.verified === true &&
    typeof server.sessionManager.resumeCanonicalSession === "function"
  ) {
    try {
      session = server.sessionManager.resumeCanonicalSession(sessionId, {
        type: "agent",
      });
    } catch {
      session = null;
    }
  }

  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (
    canonicalResume?.snapshot?.verified === true &&
    session.canonicalJsonlSession !== true &&
    typeof server.sessionManager.markCanonicalSession === "function"
  ) {
    try {
      server.sessionManager.markCanonicalSession(session.id);
      canonicalResume = wsBudgetDependency(
        server,
        "readSessionHostResumeState",
        readSessionHostResumeState,
      )(session.id);
    } catch (error) {
      server._send(
        ws,
        envelopeError(
          id,
          error?.code || "CC_WS_CANONICAL_SESSION_BIND_FAILED",
          error?.message || "WebSocket canonical session binding failed",
          sessionId,
        ),
      );
      return;
    }
  }

  if (
    !canonicalResume &&
    session.type === "agent" &&
    typeof server.sessionManager.markCanonicalSession === "function"
  ) {
    try {
      ensureCanonicalSessionTranscript({
        sessionId: session.id,
        title: `WS agent ${new Date().toISOString().slice(0, 10)}`,
        provider: session.provider,
        model: session.model || "",
        messages: session.messages,
        source: "sqlite:llm_sessions",
        stripLeadingSystem: true,
      });
      if (typeof server.sessionManager.markCanonicalSession === "function") {
        server.sessionManager.markCanonicalSession(session.id);
      } else {
        session.canonicalJsonlSession = true;
      }
      canonicalResume = wsBudgetDependency(
        server,
        "readSessionHostResumeState",
        readSessionHostResumeState,
      )(session.id);
      if (!canonicalResume?.snapshot?.verified) {
        throw Object.assign(
          new Error("Migrated WebSocket session could not be verified"),
          { code: "CC_WS_CANONICAL_SESSION_MIGRATION_FAILED" },
        );
      }
    } catch (error) {
      server._send(
        ws,
        envelopeError(
          id,
          error?.code || "CC_WS_CANONICAL_SESSION_MIGRATION_FAILED",
          error?.message || "WebSocket session migration failed",
          sessionId,
        ),
      );
      return;
    }
  }

  let sessionBudgetRoot;
  let canonicalSessionBudgetRoot = null;
  try {
    sessionBudgetRoot = session.sessionBudgetRoot
      ? normalizeSessionBudgetRootConfig(session.sessionBudgetRoot)
      : resolveSessionBudgetRootOptions({});
    canonicalSessionBudgetRoot = canonicalResume?.sessionBudgetRoot
      ? normalizeSessionBudgetRootConfig(canonicalResume.sessionBudgetRoot)
      : null;
  } catch (error) {
    server._send(
      ws,
      envelopeError(
        id,
        error?.code || "CC_SESSION_BUDGET_CONFIG_INVALID",
        error?.message || "Persisted WebSocket session budget is invalid",
        sessionId,
      ),
    );
    return;
  }
  if (
    sessionBudgetRoot.enabled &&
    (!canonicalResume || !canonicalSessionBudgetRoot)
  ) {
    server._send(
      ws,
      envelopeError(
        id,
        "CC_SESSION_BUDGET_JSONL_REQUIRED",
        "Budgeted WebSocket session has no canonical JSONL budget authority",
        sessionId,
      ),
    );
    return;
  }
  if (
    canonicalSessionBudgetRoot?.enabled === true &&
    sessionBudgetRoot.enabled !== true
  ) {
    sessionBudgetRoot = canonicalSessionBudgetRoot;
  } else if (
    canonicalSessionBudgetRoot &&
    !sameSessionBudgetConfig(canonicalSessionBudgetRoot, sessionBudgetRoot)
  ) {
    server._send(
      ws,
      envelopeError(
        id,
        "CC_SESSION_BUDGET_CONFIG_MISMATCH",
        "WebSocket DB and canonical JSONL budget declarations do not match",
        sessionId,
      ),
    );
    return;
  }
  session.sessionBudgetRoot = sessionBudgetRoot.enabled
    ? sessionBudgetRoot
    : null;

  // A JSONL transcript is the cross-host fact source. A fully verified one
  // replaces a stale DB/WS copy. The damaged case returned above before the
  // manager or agent handler could be resumed; only a genuinely absent JSONL
  // transcript keeps the legacy WS-store compatibility path.
  const sessionSnapshot = canonicalResume?.snapshot || null;
  if (canonicalResume) {
    // Capture the fresh host-owned prefix exactly once. Canonical refreshes
    // later in the WS handler must never rescan a message array that already
    // contains a durable compact-summary system turn, or the summary would be
    // mistaken for host context and duplicated after each claim/settlement.
    let hostSystemPrefix;
    try {
      hostSystemPrefix = captureCanonicalHostSystemPrefix(session);
    } catch {
      server._send(
        ws,
        envelopeError(
          id,
          "CC_SESSION_HOST_PREFIX_INVALID",
          "Canonical WS host system prefix is invalid; resume was refused",
          sessionId,
          { sessionSnapshot },
        ),
      );
      return;
    }
    session.messages = [...hostSystemPrefix, ...canonicalResume.messages];
    session.canonicalJsonlSession = true;
    session.sessionHostSnapshot = sessionSnapshot;
  } else {
    session.canonicalJsonlSession = false;
    session.sessionHostSnapshot = null;
  }

  // P0-2: reconcile the crash-safe side-effect ledger. If a dangerous tool was
  // in flight when the prior worker died, warn the IDE client AND inject a
  // system note so the resumed model does not silently replay it.
  const recoveryDependencies = {
    ...(server.resumeRecoveryDependencies || {}),
  };
  if (canonicalResume?.recovery) {
    recoveryDependencies.loadMcpLedgerRecovery = () => canonicalResume.recovery;
  }
  let recovery = buildResumeRecovery(session.id, recoveryDependencies);
  session.mcpLedgerRecovery = recovery?.mcp || {
    count: 0,
    unsettled: [],
    incidents: [],
    replayDenied: [],
    notice: null,
  };
  session.mcpLedgerRecoveryRevision =
    Number(session.mcpLedgerRecoveryRevision || 0) + 1;
  replaceResumeRecoveryNotice(session, recovery?.notice || null);

  // Recovery authority must be attached before a handler is created/refreshed
  // or history is exposed. Otherwise an existing clean controller can admit a
  // turn in the resume window before the unsafe projection reaches it.
  try {
    // Existing handlers retain the durable lease and budget root, but their
    // interaction adapter belongs to the previous WebSocket transport. Route
    // every resume through the common bootstrap so it can reattach the new
    // transport without reopening either authority.
    await ensureSessionHandler(server, ws, session);
  } catch (error) {
    server._send(
      ws,
      envelopeError(
        id,
        error?.code || "SESSION_RESUME_FAILED",
        error?.message || "WebSocket session handler could not be resumed",
        sessionId,
        { ...(sessionSnapshot ? { sessionSnapshot } : {}) },
      ),
    );
    return;
  }
  const handler = server.sessionHandlers.get(sessionId);
  if (typeof handler?.refreshMcpRecoveryRuntime === "function") {
    try {
      await handler.refreshMcpRecoveryRuntime();
    } catch (error) {
      const failedMcp = failClosedMcpRecovery(
        error,
        "CC_MCP_RECOVERY_REFRESH_FAILED",
      );
      session.mcpLedgerRecovery = failedMcp;
      session.mcpLedgerRecoveryRevision =
        Number(session.mcpLedgerRecoveryRevision || 0) + 1;
      recovery = Object.freeze({
        ...recovery,
        count:
          Math.max(
            0,
            Number(recovery?.count || 0) - Number(recovery?.mcp?.count || 0),
          ) + failedMcp.count,
        mcp: failedMcp,
        notice: [recovery?.notice, failedMcp.notice]
          .filter(Boolean)
          .join("\n\n"),
      });
      replaceResumeRecoveryNotice(session, recovery.notice);
    }
  }

  const history = (
    Array.isArray(session.messages) ? session.messages : []
  ).filter((m) => m?.role !== "system");
  const record = createSessionRecord(session, {
    history,
    messageCount: history.length,
    status: "resumed",
  });
  // Runtime-bus subscribers receive control-plane continuity metadata, not
  // transcript content. The direct resume response below still carries the
  // requested history to the authenticated IDE client.
  const runtimeRecord = { ...record, history: [] };
  const stateSnapshot =
    typeof server.sessionManager.getSessionStateSnapshot === "function"
      ? server.sessionManager.getSessionStateSnapshot(session.id)
      : null;

  server.emit(
    RUNTIME_EVENTS.SESSION_RESUME,
    createRuntimeEvent(
      RUNTIME_EVENTS.SESSION_RESUME,
      {
        sessionId: session.id,
        historyCount: history.length,
        sessionType: session.type || null,
        record: runtimeRecord,
        ...(stateSnapshot ? { stateSnapshot } : {}),
        ...(recovery ? { recovery } : {}),
        ...(sessionSnapshot ? { sessionSnapshot } : {}),
      },
      { kind: "server", sessionId: session.id },
    ),
  );

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.SESSION_RESUMED,
      id,
      {
        sessionId: session.id,
        history,
        record,
        ...(stateSnapshot ? { stateSnapshot } : {}),
        ...(recovery ? { recovery } : {}),
        ...(sessionSnapshot ? { sessionSnapshot } : {}),
      },
      session.id,
    ),
  );
}

export function handleSessionMessage(server, id, ws, message) {
  const { sessionId, content } = message;
  const handler = server.sessionHandlers.get(sessionId);

  if (!handler) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `No active session handler for: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  // Review-mode gate: while the session has a pending blocking review the
  // user must resolve it (approve/reject) before any new agent turn runs.
  if (
    server.sessionManager &&
    typeof server.sessionManager.isReviewBlocking === "function" &&
    server.sessionManager.isReviewBlocking(sessionId)
  ) {
    server._send(
      ws,
      envelopeError(
        id,
        "REVIEW_BLOCKING",
        "Session is in review mode — resolve the pending review before sending new messages.",
        sessionId,
      ),
    );
    return;
  }

  server.emit(
    RUNTIME_EVENTS.SESSION_MESSAGE,
    createRuntimeEvent(
      RUNTIME_EVENTS.SESSION_MESSAGE,
      {
        sessionId,
        messageId: id,
        content,
      },
      { kind: "server", sessionId },
    ),
  );

  handler
    .handleMessage(content, id)
    .then(() => {
      if (server.sessionManager) {
        try {
          server.sessionManager.persistMessages(sessionId);
        } catch (_err) {
          // Non-critical.
        }
      }
    })
    .catch((err) => {
      server._send(
        ws,
        envelopeError(id, "MESSAGE_FAILED", err.message, sessionId),
      );
    });
}

export function handleSessionPolicyUpdate(server, id, ws, message) {
  const { sessionId, hostManagedToolPolicy } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.updateSessionPolicy
    ? server.sessionManager.updateSessionPolicy(
        sessionId,
        hostManagedToolPolicy,
      )
    : null;

  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true, sessionId },
      sessionId,
    ),
  );
}

export function handleSessionList(server, id, ws) {
  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const sessions = server.sessionManager.listSessions().map((session) => ({
    ...session,
    record: createSessionRecord(session, {
      sessionId: session.id,
      sessionType: session.type || null,
      status: session.status || "listed",
      history: Array.isArray(session.messages)
        ? session.messages.filter((item) => item.role !== "system")
        : [],
    }),
  }));
  server._send(
    ws,
    envelopeResponse(CODING_AGENT_EVENT_TYPES.SESSION_LIST, id, { sessions }),
  );
}

export function handleSessionClose(server, id, ws, message) {
  const { sessionId } = message;
  const cleanupErrors = [];

  const closingSession = server.sessionManager?.getSession?.(sessionId);
  if (closingSession?.mcpClient?.clearElicitationHandler) {
    closingSession.mcpClient.clearElicitationHandler(sessionId);
  }

  const handler = server.sessionHandlers.get(sessionId);
  if (handler && handler.destroy) {
    try {
      handler.destroy();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  server.sessionHandlers.delete(sessionId);

  if (server.sessionManager) {
    try {
      server.sessionManager.closeSession(sessionId);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (cleanupErrors.length > 0) {
    server._send(
      ws,
      envelopeError(
        id,
        "CC_WS_SESSION_CLOSE_FAILED",
        "WebSocket session authority could not be durably closed",
        sessionId,
      ),
    );
    return;
  }

  server.emit("session:close", { sessionId });

  // Phase 5: broadcast service envelope for unified subscribers.
  if (typeof server.broadcastEnvelope === "function") {
    server.broadcastEnvelope({
      type: "session.closed",
      sessionId,
      payload: {},
    });
  }
  server.emit(
    RUNTIME_EVENTS.SESSION_END,
    createRuntimeEvent(
      RUNTIME_EVENTS.SESSION_END,
      {
        sessionId,
        record: createSessionRecord(
          { id: sessionId, type: null },
          { sessionId, status: "closed", history: [], messageCount: 0 },
        ),
      },
      { kind: "server", sessionId },
    ),
  );

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true, sessionId },
      sessionId,
    ),
  );
}

export async function handleSessionInterrupt(server, id, ws, message) {
  const { sessionId } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const handler = server.sessionHandlers.get(sessionId);
  const handlerCanInterrupt =
    handler && typeof handler.interrupt === "function";
  const result = handlerCanInterrupt
    ? await handler.interrupt()
    : {
        sessionId,
        interrupted: true,
        wasProcessing: false,
        interruptedRequestId: null,
      };

  if (
    !handlerCanInterrupt &&
    typeof server.sessionManager.recordSessionStateEvent === "function"
  ) {
    server.sessionManager.recordSessionStateEvent(
      sessionId,
      "run.interrupted",
      {
        requestId: result.interruptedRequestId,
        interruptedAt: new Date().toISOString(),
        reason: "client_interrupt",
      },
    );
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.SESSION_INTERRUPTED,
      id,
      result,
      sessionId,
    ),
  );
}

export function handleSessionAnswer(server, id, ws, message) {
  // `binding` (authority §"权限来源"): an approve answer may echo the binding the
  // request advertised so the interaction adapter can reject a stale / tampered
  // verdict. Absent → backward-compatible (no binding check).
  const { sessionId, requestId, answer, binding = null } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  let settlement = null;
  let settlementAttempted = false;
  if (session && session.interaction && session.interaction.resolveAnswer) {
    settlementAttempted = true;
    settlement = session.interaction.resolveAnswer(requestId, answer, binding);
  }

  // New adapters return an explicit settlement result. Legacy/custom
  // interactions return undefined and preserve the historical success ACK.
  const settled = settlementAttempted && settlement?.settled !== false;

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      {
        success: settled,
        settled,
        ...(settlement?.reason ? { reason: settlement.reason } : {}),
      },
      sessionId,
    ),
  );
}

export async function handleApprovalGrantsList(server, id, ws, message) {
  const sessionId = message.sessionId;
  const session = server.sessionManager?.getSession?.(sessionId) || null;
  const handler = server.sessionHandlers?.get?.(sessionId) || null;
  if (!session || !handler?.listApprovalGrants) {
    server._send(
      ws,
      envelopeError(
        id,
        "APPROVAL_GRANT_SESSION_UNAVAILABLE",
        "Approval grant session is not active",
        sessionId,
      ),
    );
    return;
  }
  const grants = await handler.listApprovalGrants();
  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true, grants },
      sessionId,
    ),
  );
}

export async function handleApprovalGrantRevoke(server, id, ws, message) {
  const sessionId = message.sessionId;
  const grantId = String(message.grantId || "");
  const handler = server.sessionHandlers?.get?.(sessionId) || null;
  if (!grantId || !handler?.revokeApprovalGrant) {
    server._send(
      ws,
      envelopeError(
        id,
        "APPROVAL_GRANT_REVOKE_INVALID",
        "An active approval grant and grantId are required",
        sessionId,
      ),
    );
    return;
  }
  const result = await handler.revokeApprovalGrant(grantId);
  if (!result?.success) {
    server._send(
      ws,
      envelopeError(
        id,
        "APPROVAL_GRANT_REVOKE_FAILED",
        result?.error || "Approval grant could not be revoked",
        sessionId,
      ),
    );
    return;
  }
  const grants = await handler.listApprovalGrants();
  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true, revoked: result.grant, grants },
      sessionId,
    ),
  );
}

/**
 * Query sub-agents spawned from a session.
 *
 * Message shape: { type: "sub-agent-list", id, sessionId }
 * Returns: envelope with payload { sessionId, active: [...], history: [...] }
 *
 * If `sessionId` is omitted, returns the global registry view so diagnostic
 * tools (e.g. `chainlesschain tasks list --sub-agents`) can inspect every
 * active child agent in the runtime.
 */
export async function handleSubAgentList(server, id, ws, message) {
  const sessionId = message?.sessionId || null;

  try {
    const { SubAgentRegistry } =
      await import("../../lib/sub-agent-registry.js");
    const registry = SubAgentRegistry.getInstance();

    let payload;
    if (sessionId) {
      const scoped = registry.getByParent(sessionId);
      payload = {
        sessionId,
        active: scoped.active,
        history: scoped.history,
        stats: registry.getStats(),
      };
    } else {
      payload = {
        sessionId: null,
        active: registry.getActive(),
        history: registry.getHistory(),
        stats: registry.getStats(),
      };
    }

    server._send(
      ws,
      envelopeResponse(
        CODING_AGENT_EVENT_TYPES.SUB_AGENT_LIST,
        id,
        payload,
        sessionId,
      ),
    );
  } catch (err) {
    server._send(
      ws,
      envelopeError(id, "SUB_AGENT_LIST_FAILED", err.message, sessionId),
    );
  }
}

/**
 * Fetch a single sub-agent snapshot by id.
 *
 * Message shape: { type: "sub-agent-get", id, subAgentId, sessionId? }
 * Returns: envelope carrying the registry snapshot (active or history) or
 *          an error envelope when the id is unknown.
 */
export async function handleSubAgentGet(server, id, ws, message) {
  const { subAgentId, sessionId } = message || {};

  if (!subAgentId) {
    server._send(
      ws,
      envelopeError(
        id,
        "MISSING_SUB_AGENT_ID",
        "sub-agent-get requires a subAgentId",
        sessionId || null,
      ),
    );
    return;
  }

  try {
    const { SubAgentRegistry } =
      await import("../../lib/sub-agent-registry.js");
    const snapshot = SubAgentRegistry.getInstance().getById(subAgentId);

    if (!snapshot) {
      server._send(
        ws,
        envelopeError(
          id,
          "SUB_AGENT_NOT_FOUND",
          `Sub-agent not found: ${subAgentId}`,
          sessionId || null,
        ),
      );
      return;
    }

    server._send(
      ws,
      envelopeResponse(
        CODING_AGENT_EVENT_TYPES.SUB_AGENT_LIST,
        id,
        {
          sessionId: sessionId || snapshot.parentId || null,
          subAgent: snapshot,
        },
        sessionId || snapshot.parentId || null,
      ),
    );
  } catch (err) {
    server._send(
      ws,
      envelopeError(id, "SUB_AGENT_GET_FAILED", err.message, sessionId || null),
    );
  }
}

/**
 * Helper: emit a review.* envelope through the session's interaction adapter
 * so every subscriber (bridge, renderer store) receives the same event
 * stream other runtime events use. Falls back to directly sending over the
 * current ws if the session has no interaction bound yet.
 */
function _emitReviewEvent(server, session, type, payload, ws) {
  const envelope = createCodingAgentEvent(
    type,
    { ...(payload || {}), sessionId: session.id },
    {
      sessionId: session.id,
      source: "cli-runtime",
    },
  );

  const interaction = session && session.interaction;
  if (interaction && typeof interaction.emit === "function") {
    try {
      interaction.emit(type, envelope.payload);
      return;
    } catch (_err) {
      // Fall through to ws send below.
    }
  }

  if (ws) {
    server._send(ws, envelope);
  }
}

/**
 * Enter review mode — block sendMessage until the review is resolved.
 *
 * Message shape:
 *   { type: "review-enter", id, sessionId, reason?, requestedBy?, checklist?, blocking? }
 */
export function handleReviewEnter(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const reviewState = server.sessionManager.enterReview(sessionId, {
    reason: message.reason || null,
    requestedBy: message.requestedBy || "user",
    checklist: message.checklist || [],
    blocking: message.blocking !== false,
  });

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_REQUESTED,
      id,
      { sessionId, reviewState },
      sessionId,
    ),
  );

  _emitReviewEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.REVIEW_REQUESTED,
    { reviewState },
    ws,
  );
}

/**
 * Submit a comment or toggle a checklist item on the active review.
 *
 * Message shape:
 *   { type: "review-submit", id, sessionId,
 *     comment?: { author?, content },
 *     checklistItemId?, checklistItemDone?, checklistItemNote? }
 */
export function handleReviewSubmit(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const updated = server.sessionManager.submitReviewComment(sessionId, {
    comment: message.comment || null,
    checklistItemId: message.checklistItemId || null,
    checklistItemDone: message.checklistItemDone,
    checklistItemNote: message.checklistItemNote,
  });

  if (!updated) {
    server._send(
      ws,
      envelopeError(
        id,
        "REVIEW_NOT_PENDING",
        "No pending review for this session",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_UPDATED,
      id,
      { sessionId, reviewState: updated },
      sessionId,
    ),
  );

  _emitReviewEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.REVIEW_UPDATED,
    { reviewState: updated },
    ws,
  );
}

/**
 * Resolve the active review with approved/rejected. Unblocks sendMessage.
 *
 * Message shape:
 *   { type: "review-resolve", id, sessionId, decision, resolvedBy?, summary? }
 */
export function handleReviewResolve(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const resolved = server.sessionManager.resolveReview(sessionId, {
    decision: message.decision,
    resolvedBy: message.resolvedBy || "user",
    summary: message.summary || null,
  });

  if (!resolved) {
    server._send(
      ws,
      envelopeError(
        id,
        "REVIEW_NOT_PENDING",
        "No pending review for this session",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_RESOLVED,
      id,
      { sessionId, reviewState: resolved },
      sessionId,
    ),
  );

  _emitReviewEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.REVIEW_RESOLVED,
    { reviewState: resolved },
    ws,
  );
}

/**
 * Fetch the current review state snapshot (or null if none).
 *
 * Message shape: { type: "review-status", id, sessionId }
 */
export function handleReviewStatus(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.REVIEW_STATE,
      id,
      { sessionId, reviewState: session.reviewState || null },
      sessionId,
    ),
  );
}

/**
 * Helper: emit a patch.* envelope through the session's interaction adapter
 * (same fan-out pattern as _emitReviewEvent).
 */
function _emitPatchEvent(server, session, type, payload, ws) {
  const envelope = createCodingAgentEvent(
    type,
    { ...(payload || {}), sessionId: session.id },
    {
      sessionId: session.id,
      source: "cli-runtime",
    },
  );

  const interaction = session && session.interaction;
  if (interaction && typeof interaction.emit === "function") {
    try {
      interaction.emit(type, envelope.payload);
      return;
    } catch (_err) {
      // Fall through to ws send below.
    }
  }

  if (ws) {
    server._send(ws, envelope);
  }
}

/**
 * Propose a patch (or batch of file edits) for preview.
 *
 * Message shape:
 *   { type: "patch-propose", id, sessionId, files: [...], origin?, reason? }
 */
export function handlePatchPropose(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!Array.isArray(message.files) || message.files.length === 0) {
    server._send(
      ws,
      envelopeError(
        id,
        "INVALID_PAYLOAD",
        "patch-propose requires a non-empty files array",
        sessionId,
      ),
    );
    return;
  }

  const patch = server.sessionManager.proposePatch(sessionId, {
    files: message.files,
    origin: message.origin || "tool",
    reason: message.reason || null,
    requestId: message.requestId || null,
  });

  if (!patch) {
    server._send(
      ws,
      envelopeError(
        id,
        "PATCH_PROPOSE_FAILED",
        "Unable to record patch",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_PROPOSED,
      id,
      { sessionId, patch },
      sessionId,
    ),
  );

  _emitPatchEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.PATCH_PROPOSED,
    { patch },
    ws,
  );
}

/**
 * Apply a previously-proposed patch.
 *
 * Message shape:
 *   { type: "patch-apply", id, sessionId, patchId, resolvedBy?, note? }
 */
export function handlePatchApply(server, id, ws, message) {
  const { sessionId, patchId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!patchId) {
    server._send(
      ws,
      envelopeError(id, "INVALID_PAYLOAD", "patchId is required", sessionId),
    );
    return;
  }

  const patch = server.sessionManager.applyPatch(sessionId, patchId, {
    resolvedBy: message.resolvedBy || "user",
    note: message.note || null,
  });

  if (!patch) {
    server._send(
      ws,
      envelopeError(
        id,
        "PATCH_NOT_FOUND",
        `Patch not found: ${patchId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_APPLIED,
      id,
      { sessionId, patch },
      sessionId,
    ),
  );

  _emitPatchEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.PATCH_APPLIED,
    { patch },
    ws,
  );
}

/**
 * Reject/discard a previously-proposed patch.
 *
 * Message shape:
 *   { type: "patch-reject", id, sessionId, patchId, resolvedBy?, reason? }
 */
export function handlePatchReject(server, id, ws, message) {
  const { sessionId, patchId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!patchId) {
    server._send(
      ws,
      envelopeError(id, "INVALID_PAYLOAD", "patchId is required", sessionId),
    );
    return;
  }

  const patch = server.sessionManager.rejectPatch(sessionId, patchId, {
    resolvedBy: message.resolvedBy || "user",
    reason: message.reason || null,
  });

  if (!patch) {
    server._send(
      ws,
      envelopeError(
        id,
        "PATCH_NOT_FOUND",
        `Patch not found: ${patchId}`,
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_REJECTED,
      id,
      { sessionId, patch },
      sessionId,
    ),
  );

  _emitPatchEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.PATCH_REJECTED,
    { patch },
    ws,
  );
}

/**
 * Fetch the patch summary for a session (pending + history + totals).
 *
 * Message shape: { type: "patch-summary", id, sessionId }
 */
export function handlePatchSummary(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const summary = server.sessionManager.getPatchSummary(sessionId);

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.PATCH_SUMMARY,
      id,
      { sessionId, summary },
      sessionId,
    ),
  );
}

/**
 * Helper: emit a task-graph.* envelope through the session's interaction
 * adapter (same fan-out pattern as _emitPatchEvent).
 */
function _emitTaskGraphEvent(server, session, type, payload, ws) {
  const envelope = createCodingAgentEvent(
    type,
    { ...(payload || {}), sessionId: session.id },
    {
      sessionId: session.id,
      source: "cli-runtime",
    },
  );

  const interaction = session && session.interaction;
  if (interaction && typeof interaction.emit === "function") {
    try {
      interaction.emit(type, envelope.payload);
      return;
    } catch (_err) {
      // Fall through to ws send below.
    }
  }

  if (ws) {
    server._send(ws, envelope);
  }
}

/**
 * Create a session-scoped task graph.
 *
 * Message shape:
 *   { type: "task-graph-create", id, sessionId, title?, nodes: [...] }
 */
export function handleTaskGraphCreate(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!Array.isArray(message.nodes)) {
    server._send(
      ws,
      envelopeError(
        id,
        "INVALID_PAYLOAD",
        "task-graph-create requires a nodes array",
        sessionId,
      ),
    );
    return;
  }

  const graph = server.sessionManager.createTaskGraph(sessionId, {
    graphId: message.graphId,
    title: message.title,
    description: message.description,
    nodes: message.nodes,
  });

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_CREATED,
      id,
      { sessionId, graph },
      sessionId,
    ),
  );

  _emitTaskGraphEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.TASK_GRAPH_CREATED,
    { graph },
    ws,
  );
}

/**
 * Add a node to an existing task graph.
 *
 * Message shape:
 *   { type: "task-graph-add-node", id, sessionId, node: { id, title, dependsOn? } }
 */
export function handleTaskGraphAddNode(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const node = message.node || null;
  if (!node || !node.id) {
    server._send(
      ws,
      envelopeError(
        id,
        "INVALID_PAYLOAD",
        "task-graph-add-node requires node.id",
        sessionId,
      ),
    );
    return;
  }

  const graph = server.sessionManager.addTaskNode(sessionId, node);
  if (!graph) {
    server._send(
      ws,
      envelopeError(
        id,
        "TASK_GRAPH_ADD_FAILED",
        "Unable to add node (no graph, or duplicate id)",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_ADDED,
      id,
      { sessionId, graph, nodeId: node.id },
      sessionId,
    ),
  );

  _emitTaskGraphEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_ADDED,
    { graph, nodeId: node.id },
    ws,
  );
}

/**
 * Update a task graph node (status, result, error, metadata).
 *
 * Message shape:
 *   { type: "task-graph-update-node", id, sessionId, nodeId, updates: { status?, result?, error? } }
 */
export function handleTaskGraphUpdateNode(server, id, ws, message) {
  const { sessionId, nodeId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (!nodeId) {
    server._send(
      ws,
      envelopeError(id, "INVALID_PAYLOAD", "nodeId is required", sessionId),
    );
    return;
  }

  const graph = server.sessionManager.updateTaskNode(
    sessionId,
    nodeId,
    message.updates || {},
  );

  if (!graph) {
    server._send(
      ws,
      envelopeError(
        id,
        "TASK_GRAPH_NODE_NOT_FOUND",
        `Task node not found: ${nodeId}`,
        sessionId,
      ),
    );
    return;
  }

  const node = graph.nodes[nodeId];
  let eventType = CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_UPDATED;
  if (node && node.status === "completed") {
    eventType = CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_COMPLETED;
  } else if (node && node.status === "failed") {
    eventType = CODING_AGENT_EVENT_TYPES.TASK_GRAPH_NODE_FAILED;
  }

  server._send(
    ws,
    envelopeResponse(eventType, id, { sessionId, graph, nodeId }, sessionId),
  );

  _emitTaskGraphEvent(server, session, eventType, { graph, nodeId }, ws);

  if (graph.status === "completed" || graph.status === "failed") {
    _emitTaskGraphEvent(
      server,
      session,
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_COMPLETED,
      { graph },
      ws,
    );
  }
}

/**
 * Advance the task graph: promote any pending node whose deps are satisfied.
 *
 * Message shape: { type: "task-graph-advance", id, sessionId }
 */
export function handleTaskGraphAdvance(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const result = server.sessionManager.advanceTaskGraph(sessionId);
  if (!result) {
    server._send(
      ws,
      envelopeError(
        id,
        "TASK_GRAPH_NOT_FOUND",
        "No task graph on session",
        sessionId,
      ),
    );
    return;
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_ADVANCED,
      id,
      { sessionId, graph: result.graph, becameReady: result.becameReady },
      sessionId,
    ),
  );

  _emitTaskGraphEvent(
    server,
    session,
    CODING_AGENT_EVENT_TYPES.TASK_GRAPH_ADVANCED,
    { graph: result.graph, becameReady: result.becameReady },
    ws,
  );
}

/**
 * Fetch the current task graph state.
 *
 * Message shape: { type: "task-graph-state", id, sessionId }
 */
export function handleTaskGraphState(server, id, ws, message) {
  const { sessionId } = message || {};

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  const graph = server.sessionManager.getTaskGraph(sessionId);

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.TASK_GRAPH_STATE,
      id,
      { sessionId, graph },
      sessionId,
    ),
  );
}

export function handleHostToolResult(server, id, ws, message) {
  const { sessionId, requestId, success, result, error, toolName } = message;

  if (!server.sessionManager) {
    server._send(
      ws,
      envelopeError(id, "NO_SESSION_SUPPORT", "Session support not configured"),
    );
    return;
  }

  const session = server.sessionManager.getSession(sessionId);
  if (!session || !session.interaction) {
    server._send(
      ws,
      envelopeError(
        id,
        "SESSION_NOT_FOUND",
        `Session not found: ${sessionId}`,
        sessionId,
      ),
    );
    return;
  }

  if (typeof session.interaction.resolveHostTool === "function") {
    session.interaction.resolveHostTool(requestId, {
      success: success !== false,
      result,
      error: error || null,
      toolName: toolName || null,
    });
  }

  server._send(
    ws,
    envelopeResponse(
      CODING_AGENT_EVENT_TYPES.COMMAND_RESPONSE,
      id,
      { success: true },
      sessionId,
    ),
  );
}
