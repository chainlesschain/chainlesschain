/**
 * Durable adapter for MCP call-ledger records.
 *
 * Each started/settled record is appended to the canonical tamper-evident
 * session transcript. The payload already contains digests rather than raw
 * tool input/output. Recovery folds the newest record per ledger id and treats
 * every surviving `started` call as outcome-unknown; callers must inspect it
 * instead of automatically replaying the MCP operation.
 */
import { isProxy } from "node:util/types";
import {
  appendAuthorityEvent as storeAppendAuthorityEvent,
  appendAuthorityEventWithVerifiedProjection as storeAppendAuthorityEventWithVerifiedProjection,
  readVerifiedEvents as storeReadVerifiedEvents,
  readVerifiedProjection as storeReadVerifiedProjection,
} from "../harness/jsonl-session-store.js";
import {
  canonicalizeMcpNetworkScopes,
  canonicalizeMcpResourceScopes,
  LedgerFailureAction,
  MCP_CALL_LEDGER_OUTPUT_KINDS,
  MCP_CALL_LEDGER_PROTOCOL_LIMITS,
  MCP_CALL_LEDGER_SCHEMA_VERSION,
  McpCallStatus,
  McpEffect,
  computeMcpExactReplayDigest,
  normalizeMcpLedgerProtocolText,
  normalizeMcpEffectContract,
  sha256PayloadDigest,
  snapshotMcpJsonRpcInput,
} from "./mcp-call-ledger.js";

export const MCP_CALL_LEDGER_EVENT = "mcp_call_ledger";
export const MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION = 1;
export const MCP_CALL_RECOVERY_ADJUDICATION_EVENT =
  "mcp_call_recovery_adjudication";
export const MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION = 2;
export const McpCallRecoveryDecision = Object.freeze({
  CONFIRMED_APPLIED: "confirmed_applied",
  CONFIRMED_NOT_APPLIED: "confirmed_not_applied",
});
export const MCP_CALL_RECOVERY_AUTHORITY = "local-cli-tty";
export const MCP_CALL_RECOVERY_CONFIRMATION =
  "typed-digest-host-authority-revoke";
export const MCP_CALL_RECOVERY_LEGACY_CONFIRMATION =
  "typed-digest-host-stopped";

const TERMINAL = new Set([
  McpCallStatus.COMPLETED,
  McpCallStatus.FAILED,
  McpCallStatus.CANCELLED,
]);
const PAYLOAD_DIGEST = /^sha256:[0-9a-f]{64}$/;
const WORKFLOW_EFFECT_ID = /^sha256:[0-9a-f]{64}$/;
const WORKFLOW_CHILD_EFFECT_PROTOCOL = "cc-workflow-child-effect/v1";
const RAW_AUTHORITY_HASH = /^[0-9a-f]{64}$/;
const OUTPUT_KINDS = new Set(MCP_CALL_LEDGER_OUTPUT_KINDS);
const RECORD_FIELDS = new Set([
  "schemaVersion",
  "ledgerId",
  "sessionId",
  "turnId",
  "workflowEffectId",
  "workflowChildEffectId",
  "workflowChildSequence",
  "workflowEffectProtocol",
  "toolName",
  "serverName",
  "inputDigest",
  "inputBytes",
  "effectContract",
  "resourceScopes",
  "networkScopes",
  "prewritePolicy",
  "prewritePersistence",
  "status",
  "startedAt",
  "settledAt",
  "outputSummary",
  "outputDigest",
  "errorSummary",
  "settlementPersistence",
]);
const EFFECT_CONTRACT_FIELDS = new Set([
  "schemaVersion",
  "effect",
  "classification",
  "readOnly",
  "sideEffecting",
  "destructive",
  "idempotent",
  "openWorld",
  "trusted",
  "source",
]);
const OUTPUT_SUMMARY_FIELDS = new Set(["sha256", "bytes", "kind"]);
const ERROR_SUMMARY_FIELDS = new Set(["name", "code", "messageDigest"]);
const LEGACY_ADJUDICATION_FIELDS = new Set([
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
const ADJUDICATION_FIELDS = new Set([
  ...LEGACY_ADJUDICATION_FIELDS,
  "hostRevocation",
]);
const HOST_REVOCATION_FIELDS = new Set([
  "requestId",
  "revocationEpoch",
  "targetLeaseId",
  "targetFencingToken",
  "targetOwnerPid",
]);
const HOST_LEASE_ID = /^lease-[0-9a-f-]{36}$/;
const RECOVERY_PROJECTION_FIELDS = new Set([
  "sessionId",
  "records",
  "unsettled",
  "incidents",
  "adjudications",
  "replayDenied",
  "verified",
  "headHash",
  "recoveryDigest",
  "remediation",
]);
const RECOVERY_REMEDIATIONS = new Set([
  "inspect_transcript",
  "adjudicate_started_calls",
  "exact_replay_denied",
]);
const RECOVERY_DIGEST_SCHEMA_VERSION = 1;

export const MCP_LEDGER_RECOVERY_PROJECTION_INVALID_CODE =
  "CC_MCP_LEDGER_RECOVERY_PROJECTION_INVALID";

const VERIFIED_PROJECTION_AUTHORITY_FIELDS = new Set([
  "headHash",
  "eventCount",
  "readMessages",
]);

export class McpCallLedgerStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "McpCallLedgerStoreError";
    this.code = code;
    this.sessionId = normalizeMcpLedgerProtocolText(options.sessionId, null);
    this.ledgerId = normalizeMcpLedgerProtocolText(
      options.ledgerId,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.ledgerId,
    );
  }
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyFields(value, allowedFields) {
  return (
    isPlainObject(value) &&
    Object.keys(value).every((field) => allowedFields.has(field))
  );
}

function hasExactFields(value, requiredFields) {
  if (!hasOnlyFields(value, requiredFields)) return false;
  const fields = Object.keys(value);
  return (
    fields.length === requiredFields.size &&
    [...requiredFields].every((field) =>
      Object.prototype.hasOwnProperty.call(value, field),
    )
  );
}

function canonicalScopes(value, canonicalize) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return Object.freeze(canonicalize(value));
}

function isCanonicalProtocolText(value, maxLength, nullable = false) {
  if (value === null) return nullable;
  if (typeof value !== "string") return false;
  return value === normalizeMcpLedgerProtocolText(value, null, maxLength);
}

function canonicalOutputSummary(value) {
  if (value === null) return null;
  if (
    !hasOnlyFields(value, OUTPUT_SUMMARY_FIELDS) ||
    !PAYLOAD_DIGEST.test(String(value.sha256 || "")) ||
    !Number.isInteger(value.bytes) ||
    value.bytes < 0 ||
    !OUTPUT_KINDS.has(value.kind)
  ) {
    return false;
  }
  return Object.freeze({
    sha256: value.sha256,
    bytes: value.bytes,
    kind: value.kind,
  });
}

function canonicalErrorSummary(value) {
  if (value === null) return null;
  if (
    !hasOnlyFields(value, ERROR_SUMMARY_FIELDS) ||
    !isCanonicalProtocolText(
      value.name,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.errorName,
    ) ||
    (value.code !== null &&
      !isCanonicalProtocolText(
        value.code,
        MCP_CALL_LEDGER_PROTOCOL_LIMITS.errorCode,
      )) ||
    !PAYLOAD_DIGEST.test(String(value.messageDigest || ""))
  ) {
    return false;
  }
  return Object.freeze({
    name: value.name,
    code: value.code,
    messageDigest: value.messageDigest,
  });
}

function canonicalRecord(record) {
  if (!hasOnlyFields(record, RECORD_FIELDS)) return null;
  if (!hasOnlyFields(record.effectContract, EFFECT_CONTRACT_FIELDS))
    return null;
  if (
    record.effectContract.schemaVersion !== undefined &&
    record.effectContract.schemaVersion !== MCP_CALL_LEDGER_SCHEMA_VERSION
  ) {
    return null;
  }

  const effectContract = normalizeMcpEffectContract(record.effectContract);
  const resourceScopes = canonicalScopes(
    record.resourceScopes,
    canonicalizeMcpResourceScopes,
  );
  const networkScopes = canonicalScopes(
    record.networkScopes,
    canonicalizeMcpNetworkScopes,
  );
  const outputSummary = canonicalOutputSummary(record.outputSummary);
  const errorSummary = canonicalErrorSummary(record.errorSummary);
  const effectSourceValid =
    record.effectContract.source == null ||
    isCanonicalProtocolText(
      record.effectContract.source,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    );
  const workflowFields = [
    record.workflowEffectId,
    record.workflowChildEffectId,
    record.workflowChildSequence,
    record.workflowEffectProtocol,
  ];
  const hasWorkflowBinding = workflowFields.some((value) => value != null);
  const workflowBindingValid =
    !hasWorkflowBinding ||
    (WORKFLOW_EFFECT_ID.test(record.workflowEffectId || "") &&
      WORKFLOW_EFFECT_ID.test(record.workflowChildEffectId || "") &&
      Number.isSafeInteger(record.workflowChildSequence) &&
      record.workflowChildSequence >= 1 &&
      record.workflowEffectProtocol === WORKFLOW_CHILD_EFFECT_PROTOCOL);
  const workflowBinding = hasWorkflowBinding
    ? {
        workflowEffectId: record.workflowEffectId,
        workflowChildEffectId: record.workflowChildEffectId,
        workflowChildSequence: record.workflowChildSequence,
        workflowEffectProtocol: record.workflowEffectProtocol,
      }
    : {};
  const baseValid =
    record.schemaVersion === MCP_CALL_LEDGER_SCHEMA_VERSION &&
    isCanonicalProtocolText(
      record.ledgerId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.ledgerId,
    ) &&
    workflowBindingValid &&
    isCanonicalProtocolText(
      record.sessionId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
      true,
    ) &&
    isCanonicalProtocolText(
      record.turnId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
      true,
    ) &&
    isCanonicalProtocolText(
      record.toolName,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    ) &&
    isCanonicalProtocolText(
      record.serverName,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    ) &&
    effectSourceValid &&
    PAYLOAD_DIGEST.test(String(record.inputDigest || "")) &&
    Number.isInteger(record.inputBytes) &&
    record.inputBytes >= 0 &&
    Object.values(McpEffect).includes(effectContract.effect) &&
    resourceScopes !== null &&
    networkScopes !== null &&
    outputSummary !== false &&
    errorSummary !== false &&
    (record.outputDigest === null ||
      PAYLOAD_DIGEST.test(String(record.outputDigest || ""))) &&
    (outputSummary === null
      ? record.outputDigest === null
      : record.outputDigest === outputSummary.sha256) &&
    Object.values(LedgerFailureAction).includes(record.prewritePolicy) &&
    (![McpEffect.WRITE, McpEffect.DESTRUCTIVE].includes(
      effectContract.effect,
    ) ||
      record.prewritePolicy === LedgerFailureAction.FAIL_CLOSED) &&
    ["pending", "persisted", "failed-open", "failed-closed"].includes(
      record.prewritePersistence,
    ) &&
    validTimestamp(record.startedAt) &&
    [McpCallStatus.STARTED, ...TERMINAL].includes(record.status);
  if (!baseValid) return null;

  if (record.status === McpCallStatus.STARTED) {
    if (
      record.prewritePersistence === "pending" &&
      record.settledAt === null &&
      outputSummary === null &&
      record.outputDigest === null &&
      errorSummary === null &&
      record.settlementPersistence == null
    ) {
      return Object.freeze({
        schemaVersion: record.schemaVersion,
        ledgerId: record.ledgerId,
        sessionId: record.sessionId,
        turnId: record.turnId,
        ...workflowBinding,
        toolName: record.toolName,
        serverName: record.serverName,
        inputDigest: record.inputDigest,
        inputBytes: record.inputBytes,
        effectContract,
        resourceScopes,
        networkScopes,
        prewritePolicy: record.prewritePolicy,
        prewritePersistence: record.prewritePersistence,
        status: record.status,
        startedAt: record.startedAt,
        settledAt: null,
        outputSummary: null,
        outputDigest: null,
        errorSummary: null,
      });
    }
    return null;
  }
  if (
    record.prewritePersistence !== "persisted" ||
    !validTimestamp(record.settledAt) ||
    record.settlementPersistence !== "pending"
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    ledgerId: record.ledgerId,
    sessionId: record.sessionId,
    turnId: record.turnId,
    ...workflowBinding,
    toolName: record.toolName,
    serverName: record.serverName,
    inputDigest: record.inputDigest,
    inputBytes: record.inputBytes,
    effectContract,
    resourceScopes,
    networkScopes,
    prewritePolicy: record.prewritePolicy,
    prewritePersistence: record.prewritePersistence,
    status: record.status,
    startedAt: record.startedAt,
    settledAt: record.settledAt,
    outputSummary,
    outputDigest: record.outputDigest,
    errorSummary,
    settlementPersistence: record.settlementPersistence,
  });
}

function phaseMatchesRecord(phase, record) {
  return (
    (phase === "started" && record.status === McpCallStatus.STARTED) ||
    (phase === "settled" && TERMINAL.has(record.status))
  );
}

const IMMUTABLE_RECORD_FIELDS = Object.freeze([
  "schemaVersion",
  "ledgerId",
  "sessionId",
  "turnId",
  "workflowEffectId",
  "workflowChildEffectId",
  "workflowChildSequence",
  "workflowEffectProtocol",
  "toolName",
  "serverName",
  "inputDigest",
  "inputBytes",
  "effectContract",
  "resourceScopes",
  "networkScopes",
  "prewritePolicy",
  "startedAt",
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value ?? null;
}

function stableSorted(values) {
  return values.map(stableValue).sort((left, right) => {
    const leftDigest = sha256PayloadDigest(left);
    const rightDigest = sha256PayloadDigest(right);
    const digestOrder =
      leftDigest < rightDigest ? -1 : leftDigest > rightDigest ? 1 : 0;
    if (digestOrder) return digestOrder;
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
}

function canonicalAdjudication(value) {
  const legacy = value?.schemaVersion === 1;
  const validConfirmation =
    (legacy && value?.confirmation === MCP_CALL_RECOVERY_LEGACY_CONFIRMATION) ||
    (value?.schemaVersion === MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION &&
      value?.confirmation === MCP_CALL_RECOVERY_CONFIRMATION);
  const fields = legacy ? LEGACY_ADJUDICATION_FIELDS : ADJUDICATION_FIELDS;
  const revocation = value?.hostRevocation;
  const targetIsNull = revocation?.targetLeaseId === null;
  const validRevocation =
    legacy ||
    (hasExactFields(revocation, HOST_REVOCATION_FIELDS) &&
      revocation.requestId === value?.requestId &&
      Number.isSafeInteger(revocation.revocationEpoch) &&
      revocation.revocationEpoch >= 1 &&
      (targetIsNull
        ? revocation.targetFencingToken === null &&
          revocation.targetOwnerPid === null
        : HOST_LEASE_ID.test(String(revocation.targetLeaseId || "")) &&
          Number.isSafeInteger(revocation.targetFencingToken) &&
          revocation.targetFencingToken >= 1 &&
          Number.isSafeInteger(revocation.targetOwnerPid) &&
          revocation.targetOwnerPid >= 1));
  if (
    !hasExactFields(value, fields) ||
    !validConfirmation ||
    !validRevocation ||
    !isCanonicalProtocolText(
      value.requestId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    ) ||
    !isCanonicalProtocolText(
      value.sessionId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    ) ||
    !isCanonicalProtocolText(
      value.ledgerId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.ledgerId,
    ) ||
    !Object.values(McpCallRecoveryDecision).includes(value.decision) ||
    !RAW_AUTHORITY_HASH.test(String(value.expectedHeadHash || "")) ||
    !PAYLOAD_DIGEST.test(String(value.expectedRecoveryDigest || "")) ||
    value.authority !== MCP_CALL_RECOVERY_AUTHORITY ||
    !PAYLOAD_DIGEST.test(String(value.reasonDigest || ""))
  ) {
    return null;
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    requestId: value.requestId,
    sessionId: value.sessionId,
    ledgerId: value.ledgerId,
    decision: value.decision,
    expectedHeadHash: value.expectedHeadHash,
    expectedRecoveryDigest: value.expectedRecoveryDigest,
    authority: value.authority,
    confirmation: value.confirmation,
    reasonDigest: value.reasonDigest,
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
}

function replayToolNamesFromRecord(record) {
  const toolName = record?.toolName;
  const serverName = record?.serverName;
  if (typeof toolName !== "string" || typeof serverName !== "string") {
    return [];
  }
  const aliasPrefix = `mcp__${serverName}__`;
  if (!toolName.startsWith(aliasPrefix)) return [toolName];
  const stripped = toolName.slice(aliasPrefix.length);
  // Historical records did not identify whether toolName was the raw host
  // name or the model-facing alias. Preserve both exact candidates so either
  // interpretation remains denied; new writes use the raw name in agent-core.
  return stripped && stripped !== toolName ? [toolName, stripped] : [toolName];
}

export function deriveMcpExactReplayDenies(record) {
  return Object.freeze(
    replayToolNamesFromRecord(record).map((toolName) =>
      Object.freeze({
        ledgerId: record.ledgerId,
        serverName: record.serverName,
        toolName,
        inputBytes: record.inputBytes,
        replayDigest: computeMcpExactReplayDigest({ ...record, toolName }),
      }),
    ),
  );
}

function exactReplayKey(value) {
  return JSON.stringify([
    value?.serverName || null,
    value?.toolName || null,
    Number.isInteger(value?.inputBytes) ? value.inputBytes : null,
    value?.replayDigest || computeMcpExactReplayDigest(value),
  ]);
}

function exactReplayKeysFromRecord(record) {
  return deriveMcpExactReplayDenies(record).map(exactReplayKey);
}

/** Deterministic digest of the complete active MCP recovery authority. */
export function computeMcpRecoveryDigest(recovery = {}) {
  const unsettled = Array.isArray(recovery.unsettled) ? recovery.unsettled : [];
  const incidents = Array.isArray(recovery.incidents) ? recovery.incidents : [];
  const adjudications = Array.isArray(recovery.adjudications)
    ? recovery.adjudications
    : [];
  const replayDenied = Array.isArray(recovery.replayDenied)
    ? recovery.replayDenied
    : [];
  return sha256PayloadDigest({
    schemaVersion: RECOVERY_DIGEST_SCHEMA_VERSION,
    sessionId: recovery.sessionId || null,
    headHash: recovery.headHash || null,
    unsettled: stableSorted(unsettled),
    incidents: stableSorted(incidents),
    adjudications: stableSorted(adjudications),
    replayDenied: stableSorted(replayDenied),
  });
}

/**
 * Stable host generation fence. Ordinary transcript messages and this host's
 * own started/settled records do not rotate it; adjudication, replay denies or
 * integrity incidents do. A host must reload a newly verified projection to
 * adopt a changed fence.
 */
export function computeMcpRecoveryFenceDigest(recovery = {}) {
  const incidents = Array.isArray(recovery.incidents) ? recovery.incidents : [];
  const adjudications = Array.isArray(recovery.adjudications)
    ? recovery.adjudications
    : [];
  const replayDenied = Array.isArray(recovery.replayDenied)
    ? recovery.replayDenied
    : [];
  return sha256PayloadDigest({
    schemaVersion: 1,
    sessionId: recovery.sessionId || null,
    incidents: stableSorted(
      incidents.map((entry) => ({
        code: entry?.code || null,
        ledgerId: entry?.ledgerId || null,
      })),
    ),
    adjudications: stableSorted(
      adjudications.map((entry) => ({
        requestId: entry?.requestId || null,
        ledgerId: entry?.ledgerId || null,
        decision: entry?.decision || null,
        authority: entry?.authority || null,
        confirmation: entry?.confirmation || null,
        reasonDigest: entry?.reasonDigest || null,
        ...(entry?.schemaVersion ===
        MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION
          ? { hostRevocation: entry?.hostRevocation || null }
          : {}),
      })),
    ),
    replayDenied: stableSorted(
      replayDenied.map((entry) => ({
        ledgerId: entry?.ledgerId || null,
        serverName: entry?.serverName || null,
        toolName: entry?.toolName || null,
        inputBytes: Number.isSafeInteger(entry?.inputBytes)
          ? entry.inputBytes
          : null,
        replayDigest: entry?.replayDigest || null,
      })),
    ),
  });
}

function immutableRecordMatches(started, settled) {
  return IMMUTABLE_RECORD_FIELDS.every(
    (field) =>
      JSON.stringify(stableValue(started?.[field])) ===
      JSON.stringify(stableValue(settled?.[field])),
  );
}

function invalidRecoveryProjection(reason, cause) {
  const error = new TypeError(
    `Verified MCP recovery projection is invalid (${reason})`,
    cause ? { cause } : undefined,
  );
  error.code = MCP_LEDGER_RECOVERY_PROJECTION_INVALID_CODE;
  return error;
}

/** Validate one canonical projection completion without invoking accessors. */
export function assertMcpVerifiedProjectionAuthority(
  authority,
  { acceptedCount, headHash },
) {
  if (
    !authority ||
    typeof authority !== "object" ||
    Array.isArray(authority) ||
    isProxy(authority) ||
    (Object.getPrototypeOf(authority) !== Object.prototype &&
      Object.getPrototypeOf(authority) !== null) ||
    Object.getOwnPropertySymbols(authority).length > 0
  ) {
    throw invalidRecoveryProjection("completion-authority-not-plain");
  }
  const descriptors = Object.getOwnPropertyDescriptors(authority);
  const fields = Object.keys(descriptors);
  if (
    fields.length !== VERIFIED_PROJECTION_AUTHORITY_FIELDS.size ||
    fields.some(
      (field) =>
        !VERIFIED_PROJECTION_AUTHORITY_FIELDS.has(field) ||
        !("value" in descriptors[field]) ||
        !descriptors[field].enumerable,
    )
  ) {
    throw invalidRecoveryProjection("completion-authority-malformed");
  }
  const projectedHeadHash = descriptors.headHash.value;
  const projectedEventCount = descriptors.eventCount.value;
  if (
    (projectedHeadHash !== null &&
      (typeof projectedHeadHash !== "string" ||
        !RAW_AUTHORITY_HASH.test(projectedHeadHash))) ||
    !Number.isSafeInteger(projectedEventCount) ||
    projectedEventCount < 0 ||
    typeof descriptors.readMessages.value !== "function" ||
    projectedEventCount !== acceptedCount ||
    projectedHeadHash !== headHash
  ) {
    throw invalidRecoveryProjection("completion-authority-mismatch");
  }
  return Object.freeze({
    headHash: projectedHeadHash,
    eventCount: projectedEventCount,
  });
}

/**
 * Copy a recovery authority through the strict MCP JSON boundary before any
 * caller consumes it. This rejects Promises/thenables, Proxies, accessors,
 * toJSON hooks and malformed projections without invoking user getters.
 */
export function snapshotMcpLedgerRecoveryProjection(sessionId, recovery) {
  let snapshot;
  try {
    snapshot = snapshotMcpJsonRpcInput(recovery);
  } catch (cause) {
    throw invalidRecoveryProjection("not-strict-synchronous-data", cause);
  }

  if (
    !hasExactFields(snapshot, RECOVERY_PROJECTION_FIELDS) ||
    snapshot.sessionId !== sessionId ||
    snapshot.verified !== true ||
    !Array.isArray(snapshot.records) ||
    !Array.isArray(snapshot.unsettled) ||
    !Array.isArray(snapshot.incidents) ||
    !Array.isArray(snapshot.adjudications) ||
    !Array.isArray(snapshot.replayDenied) ||
    (snapshot.headHash !== null &&
      (typeof snapshot.headHash !== "string" ||
        !RAW_AUTHORITY_HASH.test(snapshot.headHash))) ||
    typeof snapshot.recoveryDigest !== "string" ||
    !PAYLOAD_DIGEST.test(snapshot.recoveryDigest) ||
    (snapshot.remediation !== null &&
      !RECOVERY_REMEDIATIONS.has(snapshot.remediation))
  ) {
    throw invalidRecoveryProjection("malformed-authority");
  }

  if (snapshot.recoveryDigest !== computeMcpRecoveryDigest(snapshot)) {
    throw invalidRecoveryProjection("digest-mismatch");
  }

  const expectedRemediation =
    snapshot.incidents.length > 0
      ? "inspect_transcript"
      : snapshot.unsettled.length > 0
        ? "adjudicate_started_calls"
        : snapshot.replayDenied.length > 0
          ? "exact_replay_denied"
          : null;
  if (snapshot.remediation !== expectedRemediation) {
    throw invalidRecoveryProjection("remediation-mismatch");
  }
  return snapshot;
}

/** Create the async sink accepted by `McpCallLedger`. */
export function createSessionMcpLedgerSink(sessionId, options = {}) {
  const appendEvent = options.appendEvent || storeAppendAuthorityEvent;
  const appendFencedEvent =
    options.appendFencedEvent ||
    storeAppendAuthorityEventWithVerifiedProjection;
  let recoveryFenceDigest = Object.prototype.hasOwnProperty.call(
    options,
    "recovery",
  )
    ? computeMcpRecoveryFenceDigest({
        ...(options.recovery || {}),
        sessionId,
      })
    : null;
  if (
    !isCanonicalProtocolText(
      sessionId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    )
  ) {
    throw new TypeError("MCP ledger session sink requires sessionId");
  }
  if (typeof appendEvent !== "function") {
    throw new TypeError("MCP ledger session sink requires appendEvent");
  }
  if (typeof appendFencedEvent !== "function") {
    throw new TypeError("MCP ledger session sink requires appendFencedEvent");
  }

  const sink = async (record, metadata = {}) => {
    const canonical = canonicalRecord(record);
    if (!canonical) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_RECORD_INVALID",
        "MCP ledger refused to persist an invalid record",
        { sessionId, ledgerId: record?.ledgerId || null },
      );
    }
    if (canonical.sessionId !== sessionId) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_SESSION_MISMATCH",
        "MCP ledger record session does not match its durable transcript",
        { sessionId, ledgerId: canonical.ledgerId },
      );
    }
    const phase = String(metadata.phase || "");
    if (phase !== "started" && phase !== "settled") {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_PHASE_INVALID",
        `MCP ledger event phase is invalid: ${phase || "(missing)"}`,
        { sessionId, ledgerId: canonical.ledgerId },
      );
    }
    if (!phaseMatchesRecord(phase, canonical)) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_PHASE_STATUS_MISMATCH",
        `MCP ledger event phase ${phase} does not match status ${canonical.status}`,
        { sessionId, ledgerId: canonical.ledgerId },
      );
    }
    try {
      const eventData = {
        schemaVersion: MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION,
        phase,
        record: canonical,
      };
      const written = recoveryFenceDigest
        ? await appendFencedEvent(sessionId, MCP_CALL_LEDGER_EVENT, eventData, {
            createProjection: () => {
              const reducer = createMcpLedgerEventReducer({
                sessionId,
                verified: true,
              });
              let acceptedCount = 0;
              return Object.freeze({
                accept: (event) => {
                  acceptedCount += 1;
                  return reducer.accept(event);
                },
                finish: (authority) => {
                  const recovery = reducer.finish();
                  assertMcpVerifiedProjectionAuthority(authority, {
                    acceptedCount,
                    headHash: recovery.headHash,
                  });
                  return recovery;
                },
              });
            },
            validateProjection: (recovery) => {
              const currentFence = computeMcpRecoveryFenceDigest(recovery);
              if (currentFence !== recoveryFenceDigest) {
                throw new McpCallLedgerStoreError(
                  "CC_MCP_LEDGER_HOST_FENCE_STALE",
                  "MCP host recovery authority changed; restart or resume before executing MCP calls",
                  { sessionId, ledgerId: canonical.ledgerId },
                );
              }
            },
          })
        : await appendEvent(sessionId, MCP_CALL_LEDGER_EVENT, eventData);
      if (written === false) {
        throw new Error("canonical session store rejected the event");
      }
      return true;
    } catch (cause) {
      if (
        cause instanceof McpCallLedgerStoreError &&
        cause.code === "CC_MCP_LEDGER_HOST_FENCE_STALE"
      ) {
        throw cause;
      }
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_EVENT_PERSIST_FAILED",
        `MCP ledger event persistence failed for ${sessionId}: ${cause.message}`,
        { sessionId, ledgerId: canonical.ledgerId, cause },
      );
    }
  };
  sink.replaceRecoveryFence = (recovery) => {
    recoveryFenceDigest = computeMcpRecoveryFenceDigest({
      ...(recovery || {}),
      sessionId,
    });
    return recoveryFenceDigest;
  };
  sink.getRecoveryFenceDigest = () => recoveryFenceDigest;
  return sink;
}

/**
 * Create an incremental MCP authority reducer. Every transcript event must be
 * passed to `accept()` in canonical order so verified prefix linkage remains
 * part of the projection. The retained heap is the active MCP authority state,
 * not the complete transcript.
 */
export function createMcpLedgerEventReducer(options = {}) {
  const records = new Map();
  const incidents = [];
  const adjudications = new Map();
  const adjudicationRequestIds = new Set();
  const replayDenied = new Map();
  const targetSessionId =
    typeof options.sessionId === "string" ? options.sessionId : null;
  const verified = options.verified === true;
  const addIncident = (code, ledgerId = null) => {
    incidents.push(Object.freeze({ code, ledgerId }));
  };
  let prefixHeadHash = null;

  const accept = (event) => {
    const priorHeadHash = prefixHeadHash;
    const eventHeadHash = RAW_AUTHORITY_HASH.test(String(event?.hash || ""))
      ? event.hash
      : null;
    const prefixLinked =
      eventHeadHash !== null && (event?.prevHash ?? null) === priorHeadHash;
    prefixHeadHash = eventHeadHash;
    if (verified && !prefixLinked) {
      addIncident("CC_MCP_RECOVERY_AUTHORITY_PREFIX_INVALID");
      return;
    }

    if (event?.type === MCP_CALL_RECOVERY_ADJUDICATION_EVENT) {
      const adjudication = canonicalAdjudication(event.data);
      if (!adjudication) {
        addIncident("CC_MCP_RECOVERY_ADJUDICATION_CORRUPT");
        return;
      }
      if (!verified) {
        addIncident(
          "CC_MCP_RECOVERY_ADJUDICATION_UNVERIFIED",
          adjudication.ledgerId,
        );
        return;
      }
      if (
        targetSessionId === null ||
        adjudication.sessionId !== targetSessionId ||
        priorHeadHash !== adjudication.expectedHeadHash ||
        event.prevHash !== adjudication.expectedHeadHash
      ) {
        addIncident(
          "CC_MCP_RECOVERY_ADJUDICATION_HEAD_MISMATCH",
          adjudication.ledgerId,
        );
        return;
      }
      if (incidents.length > 0) {
        addIncident(
          "CC_MCP_RECOVERY_ADJUDICATION_INCIDENTS_PRESENT",
          adjudication.ledgerId,
        );
        return;
      }

      const currentSnapshots = [...records.values()];
      const currentRecovery = {
        sessionId: targetSessionId,
        headHash: priorHeadHash,
        unsettled: currentSnapshots.filter(
          (record) =>
            record.status === McpCallStatus.STARTED &&
            !adjudications.has(record.ledgerId),
        ),
        incidents,
        adjudications: [...adjudications.values()],
        replayDenied: [...replayDenied.values()],
      };
      if (
        adjudication.expectedRecoveryDigest !==
        computeMcpRecoveryDigest(currentRecovery)
      ) {
        addIncident(
          "CC_MCP_RECOVERY_ADJUDICATION_DIGEST_MISMATCH",
          adjudication.ledgerId,
        );
        return;
      }

      const target = records.get(adjudication.ledgerId);
      if (
        !target ||
        target.status !== McpCallStatus.STARTED ||
        adjudications.has(adjudication.ledgerId) ||
        adjudicationRequestIds.has(adjudication.requestId)
      ) {
        addIncident(
          "CC_MCP_RECOVERY_ADJUDICATION_TARGET_INVALID",
          adjudication.ledgerId,
        );
        return;
      }

      adjudications.set(adjudication.ledgerId, adjudication);
      adjudicationRequestIds.add(adjudication.requestId);
      if (adjudication.decision === McpCallRecoveryDecision.CONFIRMED_APPLIED) {
        for (const deny of deriveMcpExactReplayDenies(target)) {
          const key = exactReplayKey(deny);
          if (!replayDenied.has(key)) replayDenied.set(key, deny);
        }
      }
      return;
    }

    if (event?.type !== MCP_CALL_LEDGER_EVENT) return;
    const envelope = event.data;
    const record = canonicalRecord(envelope?.record);
    if (
      envelope?.schemaVersion !== MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION ||
      !record ||
      !phaseMatchesRecord(envelope?.phase, record)
    ) {
      addIncident("CC_MCP_LEDGER_EVENT_CORRUPT", record?.ledgerId || null);
      return;
    }

    if (targetSessionId !== null && record.sessionId !== targetSessionId) {
      addIncident("CC_MCP_LEDGER_SESSION_MISMATCH", record.ledgerId);
      return;
    }

    if (adjudications.has(record.ledgerId)) {
      addIncident("CC_MCP_LEDGER_ADJUDICATED_REWRITTEN", record.ledgerId);
      return;
    }

    if (
      exactReplayKeysFromRecord(record).some((key) => replayDenied.has(key))
    ) {
      addIncident("CC_MCP_LEDGER_EXACT_REPLAY_RECORDED", record.ledgerId);
      return;
    }

    const previous = records.get(record.ledgerId);
    if (previous && TERMINAL.has(previous.status)) {
      addIncident("CC_MCP_LEDGER_TERMINAL_REWRITTEN", record.ledgerId);
      return;
    }
    if (previous && record.status === McpCallStatus.STARTED) {
      addIncident("CC_MCP_LEDGER_DUPLICATE_START", record.ledgerId);
      return;
    }
    if (!previous && record.status !== McpCallStatus.STARTED) {
      addIncident("CC_MCP_LEDGER_START_MISSING", record.ledgerId);
      return;
    }
    if (
      previous &&
      record.status !== McpCallStatus.STARTED &&
      !immutableRecordMatches(previous, record)
    ) {
      addIncident("CC_MCP_LEDGER_RECORD_MISMATCH", record.ledgerId);
      return;
    }
    records.set(record.ledgerId, Object.freeze({ ...record }));
  };

  const finish = () => {
    const snapshots = [...records.values()];
    const unsettled = snapshots.filter(
      (record) =>
        record.status === McpCallStatus.STARTED &&
        !adjudications.has(record.ledgerId),
    );
    const denied = [...replayDenied.values()];
    const recovery = {
      sessionId: targetSessionId,
      records: Object.freeze(snapshots),
      unsettled: Object.freeze(unsettled),
      incidents: Object.freeze(incidents),
      adjudications: Object.freeze([...adjudications.values()]),
      replayDenied: Object.freeze(denied),
      verified,
      headHash: prefixHeadHash,
    };
    const remediation =
      incidents.length > 0
        ? "inspect_transcript"
        : unsettled.length > 0
          ? "adjudicate_started_calls"
          : denied.length > 0
            ? "exact_replay_denied"
            : null;
    return Object.freeze({
      ...recovery,
      recoveryDigest: computeMcpRecoveryDigest(recovery),
      remediation,
    });
  };

  return Object.freeze({ accept, finish });
}

/**
 * Batch compatibility wrapper around the incremental authority reducer.
 */
export function reduceMcpLedgerEvents(events, options = {}) {
  const reducer = createMcpLedgerEventReducer(options);
  for (const event of Array.isArray(events) ? events : []) {
    reducer.accept(event);
  }
  return reducer.finish();
}

export function loadMcpLedgerRecovery(sessionId, options = {}) {
  const hasInjectedProjection = Object.prototype.hasOwnProperty.call(
    options,
    "readVerifiedProjection",
  );
  const hasInjectedLegacyReader = Object.prototype.hasOwnProperty.call(
    options,
    "readVerifiedEvents",
  );
  if (
    (hasInjectedProjection &&
      typeof options.readVerifiedProjection !== "function") ||
    (hasInjectedLegacyReader &&
      typeof options.readVerifiedEvents !== "function")
  ) {
    throw new McpCallLedgerStoreError(
      "CC_MCP_LEDGER_EVENT_READ_FAILED",
      `MCP ledger recovery failed for ${sessionId}: verified reader is invalid`,
      {
        sessionId,
        cause: invalidRecoveryProjection("reader-not-callable"),
      },
    );
  }
  const hasCustomLegacyReader =
    hasInjectedLegacyReader &&
    options.readVerifiedEvents !== storeReadVerifiedEvents;
  const readVerifiedProjection = hasInjectedProjection
    ? options.readVerifiedProjection
    : hasCustomLegacyReader
      ? null
      : storeReadVerifiedProjection;
  const readVerifiedEvents =
    options.readVerifiedEvents || storeReadVerifiedEvents;
  try {
    if (typeof readVerifiedProjection === "function") {
      let projectionCreated = false;
      let finishedProjection;
      const returnedProjection = readVerifiedProjection(sessionId, () => {
        if (projectionCreated) {
          throw invalidRecoveryProjection("factory-reused");
        }
        projectionCreated = true;
        let acceptedCount = 0;
        let finished = false;
        const reducer = createMcpLedgerEventReducer({
          sessionId,
          verified: true,
        });
        return Object.freeze({
          accept(event) {
            if (finished) {
              throw invalidRecoveryProjection("accept-after-finish");
            }
            acceptedCount += 1;
            reducer.accept(event);
          },
          finish(authority) {
            if (finished) {
              throw invalidRecoveryProjection("finish-reused");
            }
            finished = true;
            const recovery = reducer.finish();
            assertMcpVerifiedProjectionAuthority(authority, {
              acceptedCount,
              headHash: recovery.headHash,
            });
            finishedProjection = recovery;
            return recovery;
          },
        });
      });
      if (
        !projectionCreated ||
        finishedProjection === undefined ||
        returnedProjection !== finishedProjection
      ) {
        throw invalidRecoveryProjection("reader-bypassed-factory");
      }
      return snapshotMcpLedgerRecoveryProjection(sessionId, returnedProjection);
    }
    const verifiedEvents = snapshotMcpJsonRpcInput(
      readVerifiedEvents(sessionId),
    );
    if (!Array.isArray(verifiedEvents)) {
      const invalid = new TypeError(
        "Verified MCP ledger events must be returned synchronously as an array",
      );
      invalid.code = "CC_MCP_LEDGER_VERIFIED_EVENTS_INVALID";
      throw invalid;
    }
    return snapshotMcpLedgerRecoveryProjection(
      sessionId,
      reduceMcpLedgerEvents(verifiedEvents, {
        sessionId,
        verified: true,
      }),
    );
  } catch (cause) {
    throw new McpCallLedgerStoreError(
      "CC_MCP_LEDGER_EVENT_READ_FAILED",
      `MCP ledger recovery failed for ${sessionId}: ${cause.message}`,
      { sessionId, cause },
    );
  }
}

/** Bounded, content-free recovery notice for model/IDE presentation. */
export function formatMcpLedgerRecoveryNotice(recovery, options = {}) {
  const maxItems = Math.max(1, Math.min(20, Number(options.maxItems) || 10));
  const unsettled = Array.isArray(recovery?.unsettled)
    ? recovery.unsettled.slice(0, maxItems)
    : [];
  const incidents = Array.isArray(recovery?.incidents)
    ? recovery.incidents.slice(0, maxItems)
    : [];
  const replayDenied = Array.isArray(recovery?.replayDenied)
    ? recovery.replayDenied.slice(0, maxItems)
    : [];
  if (
    unsettled.length === 0 &&
    incidents.length === 0 &&
    replayDenied.length === 0
  ) {
    return null;
  }

  const lines = unsettled.map((record) => {
    const effect = record.effectContract?.effect || "unknown";
    return `  • ${record.ledgerId}: ${record.serverName}/${record.toolName} [${effect}] — outcome unknown; inspect before retry`;
  });
  for (const incident of incidents) {
    lines.push(
      `  • ledger incident ${incident.code}${incident.ledgerId ? ` (${incident.ledgerId})` : ""} — fail closed and inspect transcript`,
    );
  }
  for (const deny of replayDenied) {
    lines.push(
      `  • ${deny.ledgerId}: ${deny.serverName}/${deny.toolName} — exact replay denied (${deny.replayDigest})`,
    );
  }
  const omitted =
    Math.max(0, (recovery?.unsettled?.length || 0) - unsettled.length) +
    Math.max(0, (recovery?.incidents?.length || 0) - incidents.length) +
    Math.max(0, (recovery?.replayDenied?.length || 0) - replayDenied.length);
  if (omitted > 0)
    lines.push(`  • ${omitted} additional ledger item(s) omitted`);

  return (
    "MCP recovery notice — a previous run left MCP recovery authority that " +
    "must be enforced. Do NOT automatically retry denied or outcome-unknown " +
    "calls. Verify the external resource first and ask the user when uncertain:\n" +
    lines.join("\n")
  );
}
