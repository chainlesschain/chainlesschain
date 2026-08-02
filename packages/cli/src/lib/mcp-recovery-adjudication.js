import { randomUUID as nodeRandomUUID } from "node:crypto";
import { appendAuthorityEventIfHead as storeAppendAuthorityEventIfHead } from "../harness/jsonl-session-store.js";
import {
  MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
  MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION,
  MCP_CALL_RECOVERY_AUTHORITY,
  MCP_CALL_RECOVERY_CONFIRMATION,
  McpCallRecoveryDecision,
  deriveMcpExactReplayDenies,
  loadMcpLedgerRecovery,
} from "./mcp-call-ledger-store.js";
import {
  MCP_CALL_LEDGER_PROTOCOL_LIMITS,
  normalizeMcpLedgerProtocolText,
  sha256PayloadDigest,
  snapshotMcpJsonRpcInput,
} from "./mcp-call-ledger.js";

const PAYLOAD_DIGEST = /^sha256:[0-9a-f]{64}$/;
const RAW_AUTHORITY_HASH = /^[0-9a-f]{64}$/;
const MAX_REASON_LENGTH = 4096;
const MCP_EFFECTS = new Set(["read", "unknown", "write", "destructive"]);
const MCP_RECOVERY_REMEDIATIONS = new Set([
  "inspect_transcript",
  "adjudicate_started_calls",
  "exact_replay_denied",
]);
const PUBLIC_REPLAY_DENY_FIELDS = new Set([
  "ledgerId",
  "serverName",
  "toolName",
  "inputBytes",
  "replayDigest",
]);

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
  try {
    return loadMcpLedgerRecovery(sessionId, {
      ...(Object.prototype.hasOwnProperty.call(
        dependencies,
        "readVerifiedProjection",
      )
        ? { readVerifiedProjection: dependencies.readVerifiedProjection }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(
        dependencies,
        "readVerifiedEvents",
      )
        ? { readVerifiedEvents: dependencies.readVerifiedEvents }
        : {}),
    });
  } catch (cause) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
      "MCP recovery adjudication requires a fully verified transcript",
      { sessionId, cause },
    );
  }
}

export function publicMcpRecoveryAuthority(sessionId, recovery) {
  let snapshot;
  try {
    snapshot = snapshotMcpJsonRpcInput(recovery);
  } catch (cause) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
      "MCP recovery authority is not strict synchronous plain data",
      { sessionId, cause },
    );
  }
  const canonicalSessionId = canonicalIdentifier(sessionId);
  if (
    !canonicalSessionId ||
    !snapshot ||
    Array.isArray(snapshot) ||
    snapshot.verified !== true ||
    snapshot.sessionId !== canonicalSessionId ||
    !Array.isArray(snapshot.unsettled) ||
    !Array.isArray(snapshot.incidents) ||
    !Array.isArray(snapshot.adjudications) ||
    !Array.isArray(snapshot.replayDenied) ||
    (snapshot.headHash !== null &&
      !RAW_AUTHORITY_HASH.test(String(snapshot.headHash || ""))) ||
    !PAYLOAD_DIGEST.test(String(snapshot.recoveryDigest || "")) ||
    (snapshot.remediation !== null &&
      !MCP_RECOVERY_REMEDIATIONS.has(snapshot.remediation))
  ) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
      "MCP recovery authority projection is malformed",
      { sessionId: canonicalSessionId || null },
    );
  }

  const invalidProjection = () => {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
      "MCP recovery authority contains malformed public fields",
      { sessionId: canonicalSessionId },
    );
  };
  const unsettled = snapshot.unsettled.map((record) => {
    const ledgerId = canonicalLedgerId(record?.ledgerId);
    const serverName = canonicalIdentifier(record?.serverName);
    const toolName = canonicalIdentifier(record?.toolName);
    const effect = record?.effectContract?.effect;
    if (
      !ledgerId ||
      !serverName ||
      !toolName ||
      !MCP_EFFECTS.has(effect) ||
      record?.status !== "started"
    ) {
      return invalidProjection();
    }
    return Object.freeze({
      ledgerId,
      serverName,
      toolName,
      effect,
      status: "outcome_unknown",
    });
  });
  const incidents = snapshot.incidents.map((incident) => {
    const code = canonicalIdentifier(incident?.code);
    const ledgerId =
      incident?.ledgerId === null
        ? null
        : canonicalLedgerId(incident?.ledgerId);
    if (!code || (incident?.ledgerId !== null && !ledgerId)) {
      return invalidProjection();
    }
    return Object.freeze({ code, ledgerId });
  });
  const replayDenied = snapshot.replayDenied.map((entry) => {
    const fields = Object.keys(entry || {});
    const ledgerId = canonicalLedgerId(entry?.ledgerId);
    const serverName = canonicalIdentifier(entry?.serverName);
    const toolName = canonicalIdentifier(entry?.toolName);
    if (
      fields.length !== PUBLIC_REPLAY_DENY_FIELDS.size ||
      fields.some((field) => !PUBLIC_REPLAY_DENY_FIELDS.has(field)) ||
      !ledgerId ||
      !serverName ||
      !toolName ||
      !Number.isSafeInteger(entry?.inputBytes) ||
      entry.inputBytes < 0 ||
      !PAYLOAD_DIGEST.test(String(entry?.replayDigest || ""))
    ) {
      return invalidProjection();
    }
    return Object.freeze({
      ledgerId,
      serverName,
      toolName,
      inputBytes: entry.inputBytes,
      replayDigest: entry.replayDigest,
    });
  });
  const adjudications = snapshot.adjudications.map((entry) => {
    const requestId = canonicalIdentifier(entry?.requestId);
    const ledgerId = canonicalLedgerId(entry?.ledgerId);
    if (
      !requestId ||
      !ledgerId ||
      !Object.values(McpCallRecoveryDecision).includes(entry?.decision) ||
      entry?.authority !== MCP_CALL_RECOVERY_AUTHORITY ||
      entry?.confirmation !== MCP_CALL_RECOVERY_CONFIRMATION ||
      !PAYLOAD_DIGEST.test(String(entry?.reasonDigest || ""))
    ) {
      return invalidProjection();
    }
    return Object.freeze({
      requestId,
      ledgerId,
      decision: entry.decision,
      authority: entry.authority,
      confirmation: entry.confirmation,
      reasonDigest: entry.reasonDigest,
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    sessionId: canonicalSessionId,
    verified: true,
    headHash: snapshot.headHash,
    recoveryDigest: snapshot.recoveryDigest,
    blockMode:
      incidents.length > 0 ? "all" : unsettled.length > 0 ? "unsafe" : null,
    unsettled: Object.freeze(unsettled),
    incidents: Object.freeze(incidents),
    adjudications: Object.freeze(adjudications),
    replayDenied: Object.freeze(replayDenied),
    remediation: snapshot.remediation,
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
  let safeRequest;
  try {
    safeRequest = snapshotMcpJsonRpcInput(request);
  } catch (cause) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      "MCP recovery adjudication request must be strict plain data",
      { cause },
    );
  }
  const sessionId = canonicalIdentifier(safeRequest?.sessionId);
  const ledgerId = canonicalLedgerId(safeRequest?.ledgerId);
  const context = {
    sessionId,
    ledgerId: ledgerId || null,
  };
  if (!sessionId || !ledgerId) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      "MCP recovery adjudication requires canonical sessionId and ledgerId",
      context,
    );
  }
  const decision = requireDecision(safeRequest.decision, context);
  const expectedHeadHash = requireDigest(
    safeRequest.expectedHeadHash,
    "expectedHeadHash",
    RAW_AUTHORITY_HASH,
    context,
  );
  const expectedRecoveryDigest = requireDigest(
    safeRequest.expectedRecoveryDigest,
    "expectedRecoveryDigest",
    PAYLOAD_DIGEST,
    context,
  );
  const reason = requireReason(safeRequest.reason, context);
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
    safeRequest.requestId || `mcp-recovery-${randomUUID()}`,
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
    appended = snapshotMcpJsonRpcInput(
      await appendAuthorityEventIfHead(
        sessionId,
        MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
        data,
        recovery.headHash,
      ),
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
    replayDigests: Object.freeze(
      decision === McpCallRecoveryDecision.CONFIRMED_APPLIED
        ? deriveMcpExactReplayDenies(target).map((deny) => deny.replayDigest)
        : [],
    ),
    replayDenied: decision === McpCallRecoveryDecision.CONFIRMED_APPLIED,
    runtimeReloadRequired: true,
    remediation: "restart_or_resume_before_mcp_calls",
  });
}
