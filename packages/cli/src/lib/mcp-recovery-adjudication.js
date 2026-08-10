import { appendAuthorityEventIfHead as storeAppendAuthorityEventIfHead } from "../harness/jsonl-session-store.js";
import {
  MCP_CALL_RECOVERY_ADJUDICATION_EVENT,
  MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION,
  MCP_CALL_RECOVERY_AUTHORITY,
  MCP_CALL_RECOVERY_CONFIRMATION,
  MCP_CALL_RECOVERY_LEGACY_CONFIRMATION,
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
import { revokeSessionHostAuthority as storeRevokeSessionHostAuthority } from "./session-host-lease.js";

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
const PUBLIC_ADJUDICATION_FIELDS_V1 = new Set([
  "schemaVersion",
  "requestId",
  "sessionId",
  "ledgerId",
  "decision",
  "expectedHeadHash",
  "expectedRecoveryDigest",
  "authority",
  "confirmation",
  "reasonDigest",
]);
const PUBLIC_ADJUDICATION_FIELDS_V2 = new Set([
  ...PUBLIC_ADJUDICATION_FIELDS_V1,
  "hostRevocation",
]);
const PUBLIC_HOST_REVOCATION_FIELDS = new Set([
  "requestId",
  "revocationEpoch",
  "targetLeaseId",
  "targetFencingToken",
  "targetOwnerPid",
]);
const HOST_LEASE_ID = /^lease-[0-9a-f-]{36}$/;

export class McpRecoveryAdjudicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "McpRecoveryAdjudicationError";
    this.code = code;
    this.sessionId = options.sessionId || null;
    this.ledgerId = options.ledgerId || null;
    this.hostRevocation = options.hostRevocation || null;
    this.commitState = options.commitState || null;
    this.outcomeUnknown = options.outcomeUnknown === true;
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
    const legacy = entry?.schemaVersion === 1;
    const fields = Object.keys(entry || {});
    const allowedFields = legacy
      ? PUBLIC_ADJUDICATION_FIELDS_V1
      : PUBLIC_ADJUDICATION_FIELDS_V2;
    const requestId = canonicalIdentifier(entry?.requestId);
    const ledgerId = canonicalLedgerId(entry?.ledgerId);
    const confirmationIsValid =
      (entry?.schemaVersion === 1 &&
        entry?.confirmation === MCP_CALL_RECOVERY_LEGACY_CONFIRMATION) ||
      (entry?.schemaVersion === MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION &&
        entry?.confirmation === MCP_CALL_RECOVERY_CONFIRMATION);
    const revocation = entry?.hostRevocation;
    const revocationFields = Object.keys(revocation || {});
    const targetIsNull = revocation?.targetLeaseId === null;
    const revocationIsValid =
      legacy ||
      (revocationFields.length === PUBLIC_HOST_REVOCATION_FIELDS.size &&
        revocationFields.every((field) =>
          PUBLIC_HOST_REVOCATION_FIELDS.has(field),
        ) &&
        revocation?.requestId === requestId &&
        Number.isSafeInteger(revocation?.revocationEpoch) &&
        revocation.revocationEpoch >= 1 &&
        (targetIsNull
          ? revocation.targetFencingToken === null &&
            revocation.targetOwnerPid === null
          : HOST_LEASE_ID.test(String(revocation?.targetLeaseId || "")) &&
            Number.isSafeInteger(revocation?.targetFencingToken) &&
            revocation.targetFencingToken >= 1 &&
            Number.isSafeInteger(revocation?.targetOwnerPid) &&
            revocation.targetOwnerPid >= 1));
    if (
      fields.length !== allowedFields.size ||
      fields.some((field) => !allowedFields.has(field)) ||
      !requestId ||
      !ledgerId ||
      !Object.values(McpCallRecoveryDecision).includes(entry?.decision) ||
      entry?.authority !== MCP_CALL_RECOVERY_AUTHORITY ||
      !confirmationIsValid ||
      !revocationIsValid ||
      !PAYLOAD_DIGEST.test(String(entry?.reasonDigest || ""))
    ) {
      return invalidProjection();
    }
    return Object.freeze({
      schemaVersion: entry.schemaVersion,
      requestId,
      ledgerId,
      decision: entry.decision,
      authority: entry.authority,
      confirmation: entry.confirmation,
      reasonDigest: entry.reasonDigest,
      ...(legacy
        ? {}
        : {
            hostRevocation: Object.freeze({
              requestId: revocation.requestId,
              revocationEpoch: revocation.revocationEpoch,
              targetLeaseId: revocation.targetLeaseId,
              targetFencingToken: revocation.targetFencingToken,
              targetOwnerPid: revocation.targetOwnerPid,
            }),
          }),
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
    `HOST STOPPED AND MCP DISPATCH DRAINED; REVOKE HOST AUTHORITY; ADJUDICATE ${canonicalSessionId} ${canonicalId} ` +
    `${canonicalDecision} ${canonicalDigest}`
  );
}

function deterministicAdjudicationRequestId({
  sessionId,
  ledgerId,
  decision,
  expectedHeadHash,
  expectedRecoveryDigest,
  reasonDigest,
}) {
  const digest = sha256PayloadDigest({
    schemaVersion: MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION,
    sessionId,
    ledgerId,
    decision,
    expectedHeadHash,
    expectedRecoveryDigest,
    reasonDigest,
  });
  return `mcp-recovery-${digest.slice("sha256:".length)}`;
}

function canonicalHostRevocation(value, requestId, context) {
  let snapshot;
  try {
    snapshot = snapshotMcpJsonRpcInput(value);
  } catch (cause) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_HOST_REVOCATION_FAILED",
      "MCP recovery host revocation returned malformed authority",
      { ...context, cause },
    );
  }
  const targetIsNull = snapshot?.targetLeaseId === null;
  if (
    !snapshot ||
    snapshot.requestId !== requestId ||
    snapshot.reasonCode !== "mcp-recovery-adjudication" ||
    !Number.isSafeInteger(snapshot.revocationEpoch) ||
    snapshot.revocationEpoch < 1 ||
    typeof snapshot.replayed !== "boolean" ||
    (targetIsNull
      ? snapshot.targetFencingToken !== null || snapshot.targetOwnerPid !== null
      : !HOST_LEASE_ID.test(String(snapshot.targetLeaseId || "")) ||
        !Number.isSafeInteger(snapshot.targetFencingToken) ||
        snapshot.targetFencingToken < 1 ||
        !Number.isSafeInteger(snapshot.targetOwnerPid) ||
        snapshot.targetOwnerPid < 1)
  ) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_HOST_REVOCATION_FAILED",
      "MCP recovery host revocation returned malformed authority",
      context,
    );
  }
  return Object.freeze({
    requestId: snapshot.requestId,
    revocationEpoch: snapshot.revocationEpoch,
    replayed: snapshot.replayed,
    targetLeaseId: snapshot.targetLeaseId,
    targetFencingToken: snapshot.targetFencingToken,
    targetOwnerPid: snapshot.targetOwnerPid,
  });
}

function persistedHostRevocation(hostRevocation) {
  return Object.freeze({
    requestId: hostRevocation.requestId,
    revocationEpoch: hostRevocation.revocationEpoch,
    targetLeaseId: hostRevocation.targetLeaseId,
    targetFencingToken: hostRevocation.targetFencingToken,
    targetOwnerPid: hostRevocation.targetOwnerPid,
  });
}

function exactAdjudicationReadback(sessionId, data, dependencies) {
  try {
    const recovery = readMcpRecoveryAuthority(sessionId, dependencies);
    const expected = sha256PayloadDigest(data);
    const match = recovery.adjudications.find(
      (entry) =>
        entry?.requestId === data.requestId &&
        sha256PayloadDigest(entry) === expected,
    );
    if (!match || !RAW_AUTHORITY_HASH.test(String(recovery.headHash || ""))) {
      return null;
    }
    return Object.freeze({ hash: recovery.headHash, recovery });
  } catch {
    return null;
  }
}

/**
 * Durably revoke current host authority, then append exactly one human
 * adjudication event under a verified-head CAS. A stale comparison is never
 * retried; the capability-reducing revocation remains durable on append loss.
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
  const requestId = canonicalIdentifier(
    safeRequest.requestId ||
      deterministicAdjudicationRequestId({
        sessionId,
        ledgerId,
        decision,
        expectedHeadHash: recovery.headHash,
        expectedRecoveryDigest: recovery.recoveryDigest,
        reasonDigest,
      }),
  );
  if (!requestId) {
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_ADJUDICATION_INPUT_INVALID",
      "MCP recovery requestId is invalid",
      context,
    );
  }
  const revokeSessionHostAuthority =
    dependencies.revokeSessionHostAuthority || storeRevokeSessionHostAuthority;
  let hostRevocation;
  try {
    hostRevocation = canonicalHostRevocation(
      await revokeSessionHostAuthority(sessionId, {
        requestId,
        reasonCode: "mcp-recovery-adjudication",
      }),
      requestId,
      context,
    );
  } catch (cause) {
    if (cause instanceof McpRecoveryAdjudicationError) throw cause;
    const commitState = cause?.commitState || "unknown";
    if (commitState !== "not-committed") {
      throw new McpRecoveryAdjudicationError(
        "CC_MCP_RECOVERY_HOST_REVOCATION_OUTCOME_UNKNOWN",
        "MCP recovery host revocation outcome is unknown; do not retry or adjudicate until exact authority readback succeeds",
        {
          ...context,
          cause,
          commitState,
          outcomeUnknown: true,
        },
      );
    }
    throw new McpRecoveryAdjudicationError(
      "CC_MCP_RECOVERY_HOST_REVOCATION_FAILED",
      "MCP recovery host authority could not be durably revoked; no adjudication was appended",
      { ...context, cause, commitState },
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
    hostRevocation: persistedHostRevocation(hostRevocation),
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
        "MCP recovery authority changed after host revocation; run show again before adjudicating",
        { ...context, cause, hostRevocation },
      );
    }
    const commitState = cause?.commitState || "unknown";
    if (commitState !== "not-committed") {
      const readback = exactAdjudicationReadback(sessionId, data, dependencies);
      if (readback) {
        appended = readback;
      } else {
        throw new McpRecoveryAdjudicationError(
          "CC_MCP_RECOVERY_ADJUDICATION_OUTCOME_UNKNOWN",
          "MCP recovery adjudication persistence outcome is unknown; host authority remains revoked and exact transcript reconciliation is required before retry",
          {
            ...context,
            cause,
            hostRevocation,
            commitState,
            outcomeUnknown: true,
          },
        );
      }
    } else {
      throw new McpRecoveryAdjudicationError(
        "CC_MCP_RECOVERY_ADJUDICATION_PERSIST_FAILED",
        "MCP recovery adjudication was not persisted; host authority remains revoked",
        { ...context, cause, hostRevocation, commitState },
      );
    }
  }
  if (!appended || !RAW_AUTHORITY_HASH.test(String(appended.hash || ""))) {
    const readback = exactAdjudicationReadback(sessionId, data, dependencies);
    if (readback) {
      appended = readback;
    } else {
      throw new McpRecoveryAdjudicationError(
        "CC_MCP_RECOVERY_ADJUDICATION_OUTCOME_UNKNOWN",
        "MCP recovery adjudication returned no durable authority hash; host authority remains revoked and exact transcript reconciliation is required",
        {
          ...context,
          hostRevocation,
          commitState: appended?.commitState || "unknown",
          outcomeUnknown: true,
        },
      );
    }
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
    hostRevocation,
    runtimeReloadRequired: true,
    remediation: "restart_or_resume_before_mcp_calls",
  });
}
