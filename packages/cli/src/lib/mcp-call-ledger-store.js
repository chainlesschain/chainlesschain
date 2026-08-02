/**
 * Durable adapter for MCP call-ledger records.
 *
 * Each started/settled record is appended to the canonical tamper-evident
 * session transcript. The payload already contains digests rather than raw
 * tool input/output. Recovery folds the newest record per ledger id and treats
 * every surviving `started` call as outcome-unknown; callers must inspect it
 * instead of automatically replaying the MCP operation.
 */
import {
  appendAuthorityEvent as storeAppendAuthorityEvent,
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
} from "./mcp-call-ledger.js";

export const MCP_CALL_LEDGER_EVENT = "mcp_call_ledger";
export const MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION = 1;
export const MCP_CALL_RECOVERY_ADJUDICATION_EVENT =
  "mcp_call_recovery_adjudication";
export const MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION = 1;
export const McpCallRecoveryDecision = Object.freeze({
  CONFIRMED_APPLIED: "confirmed_applied",
  CONFIRMED_NOT_APPLIED: "confirmed_not_applied",
});
export const MCP_CALL_RECOVERY_AUTHORITY = "local-cli-tty";
export const MCP_CALL_RECOVERY_CONFIRMATION = "typed-digest-host-stopped";

const TERMINAL = new Set([
  McpCallStatus.COMPLETED,
  McpCallStatus.FAILED,
  McpCallStatus.CANCELLED,
]);
const PAYLOAD_DIGEST = /^sha256:[0-9a-f]{64}$/;
const RAW_AUTHORITY_HASH = /^[0-9a-f]{64}$/;
const OUTPUT_KINDS = new Set(MCP_CALL_LEDGER_OUTPUT_KINDS);
const RECORD_FIELDS = new Set([
  "schemaVersion",
  "ledgerId",
  "sessionId",
  "turnId",
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
const ADJUDICATION_FIELDS = new Set([
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
const RECOVERY_DIGEST_SCHEMA_VERSION = 1;

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
  const baseValid =
    record.schemaVersion === MCP_CALL_LEDGER_SCHEMA_VERSION &&
    isCanonicalProtocolText(
      record.ledgerId,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.ledgerId,
    ) &&
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
  if (
    !hasExactFields(value, ADJUDICATION_FIELDS) ||
    value.schemaVersion !== MCP_CALL_RECOVERY_ADJUDICATION_SCHEMA_VERSION ||
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
    value.confirmation !== MCP_CALL_RECOVERY_CONFIRMATION ||
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

function immutableRecordMatches(started, settled) {
  return IMMUTABLE_RECORD_FIELDS.every(
    (field) =>
      JSON.stringify(stableValue(started?.[field])) ===
      JSON.stringify(stableValue(settled?.[field])),
  );
}

/** Create the async sink accepted by `McpCallLedger`. */
export function createSessionMcpLedgerSink(sessionId, options = {}) {
  const appendEvent = options.appendEvent || storeAppendAuthorityEvent;
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

  return async (record, metadata = {}) => {
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
      const written = await appendEvent(sessionId, MCP_CALL_LEDGER_EVENT, {
        schemaVersion: MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION,
        phase,
        record: canonical,
      });
      if (written === false) {
        throw new Error("canonical session store rejected the event");
      }
      return true;
    } catch (cause) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_EVENT_PERSIST_FAILED",
        `MCP ledger event persistence failed for ${sessionId}: ${cause.message}`,
        { sessionId, ledgerId: canonical.ledgerId, cause },
      );
    }
  };
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
  const hasCustomLegacyReader =
    typeof options.readVerifiedEvents === "function" &&
    options.readVerifiedEvents !== storeReadVerifiedEvents;
  const readVerifiedProjection =
    options.readVerifiedProjection ||
    (hasCustomLegacyReader ? null : storeReadVerifiedProjection);
  const readVerifiedEvents =
    options.readVerifiedEvents || storeReadVerifiedEvents;
  try {
    if (typeof readVerifiedProjection === "function") {
      return readVerifiedProjection(sessionId, () => {
        const reducer = createMcpLedgerEventReducer({
          sessionId,
          verified: true,
        });
        return {
          accept: reducer.accept,
          finish: reducer.finish,
        };
      });
    }
    const verifiedEvents = readVerifiedEvents(sessionId);
    if (!Array.isArray(verifiedEvents)) {
      const invalid = new TypeError(
        "Verified MCP ledger events must be returned synchronously as an array",
      );
      invalid.code = "CC_MCP_LEDGER_VERIFIED_EVENTS_INVALID";
      throw invalid;
    }
    return reduceMcpLedgerEvents(verifiedEvents, {
      sessionId,
      verified: true,
    });
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
