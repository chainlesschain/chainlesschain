import { randomUUID as nodeRandomUUID } from "node:crypto";
import {
  appendAuthorityEventIfHead as storeAppendAuthorityEventIfHead,
  readVerifiedEvents as storeReadVerifiedEvents,
} from "../harness/jsonl-session-store.js";
import {
  MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
  MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION,
  MCP_CALL_RECOVERY_AUTHORITY,
  MCP_CALL_RECOVERY_CONFIRMATION,
  McpCallRecoveryDecision,
  deriveMcpExactReplayDenies,
  reduceMcpLedgerEvents,
} from "./mcp-call-ledger-store.js";
import {
  MCP_CALL_LEDGER_PROTOCOL_LIMITS,
  normalizeMcpLedgerProtocolText,
  sha256PayloadDigest,
} from "./mcp-call-ledger.js";

const PAYLOAD_DIGEST = /^sha256:[0-9a-f]{64}$/;
const RAW_AUTHORITY_HASH = /^[0-9a-f]{64}$/;
const MAX_REASON_LENGTH = 4096;

export class McpRecoveryAdjudicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "McpRecoveryAdjudicationError";
    this.code = code;
    this.sessionId = options.sessionId || null;
    this.ledgerId = options.ledgerId || null;
  }
}

function canonicalLedgerId(value) {
  if (typeof value !== "string") return null;
  const normalized = normalizeMcpLedgerProtocolText(
    value,
    null,
    MCP_CALL_LEDGER_PROTOCOL_LIMITS.ledgerId,
  );
  return normalized === value ? normalized : null;
}

function canonicalIdentifier(value) {
  if (typeof value !== "string") return null;
  const normalized = normalizeMcpLedgerProtocolText(
    value,
    null,
    MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
  );
  return normalized === value ? normalized : null;
}

function requireDigest(value, label, pattern, options = {}) {
  if (typeof value === "string" && pattern.test(value)) return value;
  throw new McpRecoveryAdjudicationError(
    "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
    `${label} has an invalid digest format`,
    options,
  );
}

function requireDecision(value, options = {}) {
  if (Object.values(McpCallRecoveryDecision).includes(value)) return value;
  throw new McpRecoveryAdjudicationError(
    "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
    "MCP recovery decision must be confirmed_applied or confirmed_not_applied",
    options,
  );
}

function requireReason(value, options = {}) {
  if (typeof value !== "string") {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      "MCP recovery adjudication requires a reason",
      options,
    );
  }
  const reason = value.trim();
  if (!reason || reason.length > MAX_REASON_LENGTH) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      `MCP recovery reason must contain 1-${MAX_REASON_LENGTH} characters`,
      options,
    );
  }
  return reason;
}

export function readMcpRecoveryAuthority(sessionId, dependencies = {}) {
  const readVerifiedEvents =
    dependencies.readVerifiedEvents || storeReadVerifiedEvents;
  let events;
  try {
    events = readVerifiedEvents(sessionId);
  } catch (cause) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
      "MCP recovery adjudication requires a fully verified transcript",
      { sessionId, cause },
    );
  }
  if (!Array.isArray(events)) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
      "Verified MCP recovery events must be a synchronous array",
      { sessionId },
    );
  }
  return reduceMcpLedgerEvents(events, {
    sessionId,
    verified: true,
  });
}

export function publicMcpRecoveryAuthority(sessionId, recovery) {
  const unsettled = Array.isArray(recovery?.unsettled)
    ? recovery.unsettled.map((record) =>
        Object.freeze({
          ledgerId: record.ledgerId,
          serverName: record.serverName,
          toolName: record.toolName,
          effect: record.effectContract?.effect || "unknown",
          status: "outcome_unknown",
        }),
      )
    : [];
  const incidents = Array.isArray(recovery?.incidents)
    ? recovery.incidents.map((incident) =>
        Object.freeze({
          code: incident.code,
          ledgerId: incident.ledgerId || null,
        }),
      )
    : [];
  const replayDenied = Array.isArray(recovery?.replayDenied)
    ? recovery.replayDenied.map((entry) =>
        Object.freeze({
          ledgerId: entry.ledgerId,
          serverName: entry.serverName,
          toolName: entry.toolName,
          inputBytes: entry.inputBytes,
          replayDigest: entry.replayDigest,
        }),
      )
    : [];
  const adjudications = Array.isArray(recovery?.adjudications)
    ? recovery.adjudications.map((entry) =>
        Object.freeze({
          requestId: entry.requestId,
          ledgerId: entry.ledgerId,
          decision: entry.decision,
          authority: entry.authority,
          confirmation: entry.confirmation,
          reasonDigest: entry.reasonDigest,
        }),
      )
    : [];
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    verified: recovery?.verified === true,
    headHash: recovery?.headHash || null,
    recoveryDigest: recovery?.recoveryDigest || null,
    blockMode:
      incidents.length > 0 ? "all" : unsettled.length > 0 ? "unsafe" : null,
    unsettled: Object.freeze(unsettled),
    incidents: Object.freeze(incidents),
    adjudications: Object.freeze(adjudications),
    replayDenied: Object.freeze(replayDenied),
    remediation: recovery?.remediation || null,
  });
}

export function buildMcpRecoveryAdjudicationChallenge({
  sessionId,
  ledgerId,
  decision,
  recoveryDigest,
} = {}) {
  const canonicalSessionId = canonicalIdentifier(sessionId);
  const canonicalId = canonicalLedgerId(ledgerId);
  const canonicalDecision = requireDecision(decision, { ledgerId });
  const canonicalDigest = requireDigest(
    recoveryDigest,
    "recoveryDigest",
    PAYLOAD_DIGEST,
    { ledgerId },
  );
  if (!canonicalSessionId || !canonicalId) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      "MCP recovery sessionId or ledgerId is invalid",
      { sessionId, ledgerId },
    );
  }
  return (
    `HOST STOPPED; ADJUDICATE ${canonicalSessionId} ${canonicalId} ` +
    `${canonicalDecision} ${canonicalDigest}`
  );
}

/**
 * Append exactly one human adjudication authority event under a verified-head
 * CAS. A stale comparison is returned to the caller and is never retried.
 */
export async function adjudicateMcpRecovery(request, dependencies = {}) {
  const sessionId = canonicalIdentifier(request?.sessionId);
  const ledgerId = canonicalLedgerId(request?.ledgerId);
  const context = {
    sessionId,
    ledgerId: ledgerId || request?.ledgerId || null,
  };
  if (!sessionId || !ledgerId) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      "MCP recovery adjudication requires canonical sessionId and ledgerId",
      context,
    );
  }
  const decision = requireDecision(request.decision, context);
  const expectedHeadHash = requireDigest(
    request.expectedHeadHash,
    "expectedHeadHash",
    RAW_AUTHORITY_HASH,
    context,
  );
  const expectedRecoveryDigest = requireDigest(
    request.expectedRecoveryDigest,
    "expectedRecoveryDigest",
    PAYLOAD_DIGEST,
    context,
  );
  const reason = requireReason(request.reason, context);
  const recovery = readMcpRecoveryAuthority(sessionId, dependencies);

  if (
    recovery.headHash !== expectedHeadHash ||
    recovery.recoveryDigest !== expectedRecoveryDigest
  ) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_STALE",
      "MCP recovery authority changed; run show again before adjudicating",
      context,
    );
  }
  if (recovery.incidents.length > 0) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INCIDENTS_PRESENT",
      "MCP recovery incidents require transcript inspection before adjudication",
      context,
    );
  }
  const target = recovery.unsettled.find(
    (record) => record.ledgerId === ledgerId,
  );
  if (!target || target.status !== "started") {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_TARGET_INVALID",
      "Only a verified started-only MCP call can be adjudicated",
      context,
    );
  }

  const reasonDigest = sha256PayloadDigest(reason);
  const randomUUID = dependencies.randomUUID || nodeRandomUUID;
  const requestId = canonicalIdentifier(
    request.requestId || `mcp-recovery-${randomUUID()}`,
  );
  if (!requestId) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      "MCP recovery requestId is invalid",
      context,
    );
  }
  const data = Object.freeze({
    schemaVersion: MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION,
    requestId,
    sessionId,
    ledgerId,
    decision,
    expectedHeadHash: recovery.headHash,
    expectedRecoveryDigest: recovery.recoveryDigest,
    authority: MCP_CALL_RECOVERY_AUTHORITY,
    confirmation: MCP_CALL_RECOVERY_CONFIRMATION,
    reasonDigest,
  });
  const appendAuthorityEventIfHead =
    dependencies.appendAuthorityEventIfHead || storeAppendAuthorityEventIfHead;
  let appended;
  try {
    appended = await appendAuthorityEventIfHead(
      sessionId,
      MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
      data,
      recovery.headHash,
    );
  } catch (cause) {
    if (cause?.code === "SESSION_REVISION_STALE") {
      throw new McpRecoveryAdjudicationError(
        "CC_MCP_RECOVERY_ADJUDICATION_STALE",
        "MCP recovery authority changed; run show again before adjudicating",
        { ...context, cause },
      );
    }
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_PERSIST_FAILED",
      "MCP recovery adjudication was not persisted",
      { ...context, cause },
    );
  }
  if (!appended || !RAW_AUTHORITY_HASH.test(String(appended.hash || ""))) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_PERSIST_FAILED",
      "MCP recovery adjudication did not return a durable authority hash",
      context,
    );
  }

  return Object.freeze({
    schemaVersion: MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION,
    requestId,
    sessionId,
    ledgerId,
    decision,
    previousHeadHash: recovery.headHash,
    headHash: appended.hash,
    expectedRecoveryDigest: recovery.recoveryDigest,
    reasonDigest,
    replayDigests:
      decision === McpCallRecoveryDecision.CONFIRMED_APPLIED
        ? deriveMcpExactReplayDenies(target).map((deny) => deny.replayDigest)
        : [],
    replayDenied: decision === McpCallRecoveryDecision.CONFIRMED_APPLIED,
    runtimeReloadRequired: true,
    remediation: "restart_or_resume_before_mcp_calls",
  });
}
