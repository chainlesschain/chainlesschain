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
} from "../harness/jsonl-session-store.js";
import {
  LedgerFailureAction,
  MCP_CALL_LEDGER_SCHEMA_VERSION,
  McpCallStatus,
  McpEffect,
  normalizeMcpEffectContract,
} from "./mcp-call-ledger.js";

export const MCP_CALL_LEDGER_EVENT = "mcp_call_ledger";
export const MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION = 1;

const TERMINAL = new Set([
  McpCallStatus.COMPLETED,
  McpCallStatus.FAILED,
  McpCallStatus.CANCELLED,
]);
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/i;
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

export class McpCallLedgerStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "McpCallLedgerStoreError";
    this.code = code;
    this.sessionId = options.sessionId || null;
    this.ledgerId = options.ledgerId || null;
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

function canonicalStringArray(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return Object.freeze([...value]);
}

function canonicalOutputSummary(value) {
  if (value === null) return null;
  if (
    !hasOnlyFields(value, OUTPUT_SUMMARY_FIELDS) ||
    !SHA256_DIGEST.test(String(value.sha256 || "")) ||
    !Number.isInteger(value.bytes) ||
    value.bytes < 0 ||
    typeof value.kind !== "string" ||
    !value.kind
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
    typeof value.name !== "string" ||
    !value.name ||
    (value.code !== null && typeof value.code !== "string") ||
    !SHA256_DIGEST.test(String(value.messageDigest || ""))
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
  const resourceScopes = canonicalStringArray(record.resourceScopes);
  const networkScopes = canonicalStringArray(record.networkScopes);
  const outputSummary = canonicalOutputSummary(record.outputSummary);
  const errorSummary = canonicalErrorSummary(record.errorSummary);
  const baseValid =
    record.schemaVersion === MCP_CALL_LEDGER_SCHEMA_VERSION &&
    typeof record.ledgerId === "string" &&
    record.ledgerId.length > 0 &&
    (record.sessionId === null || typeof record.sessionId === "string") &&
    (record.turnId === null || typeof record.turnId === "string") &&
    typeof record.toolName === "string" &&
    typeof record.serverName === "string" &&
    SHA256_DIGEST.test(String(record.inputDigest || "")) &&
    Number.isInteger(record.inputBytes) &&
    record.inputBytes >= 0 &&
    Object.values(McpEffect).includes(effectContract.effect) &&
    resourceScopes !== null &&
    networkScopes !== null &&
    outputSummary !== false &&
    errorSummary !== false &&
    (record.outputDigest === null ||
      SHA256_DIGEST.test(String(record.outputDigest || ""))) &&
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
  if (typeof sessionId !== "string" || !sessionId.trim()) {
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
 * Fold transcript events into the latest record per ledger id. Malformed MCP
 * ledger events are incidents, not silently skipped authority facts.
 */
export function reduceMcpLedgerEvents(events) {
  const records = new Map();
  const incidents = [];
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type !== MCP_CALL_LEDGER_EVENT) continue;
    const envelope = event.data;
    const record = canonicalRecord(envelope?.record);
    if (
      envelope?.schemaVersion !== MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION ||
      !record ||
      !phaseMatchesRecord(envelope?.phase, record)
    ) {
      incidents.push(
        Object.freeze({
          code: "CC_MCP_LEDGER_EVENT_CORRUPT",
          ledgerId: record?.ledgerId || null,
        }),
      );
      continue;
    }

    const previous = records.get(record.ledgerId);
    if (previous && TERMINAL.has(previous.status)) {
      incidents.push(
        Object.freeze({
          code: "CC_MCP_LEDGER_TERMINAL_REWRITTEN",
          ledgerId: record.ledgerId,
        }),
      );
      continue;
    }
    if (previous && record.status === McpCallStatus.STARTED) {
      incidents.push(
        Object.freeze({
          code: "CC_MCP_LEDGER_DUPLICATE_START",
          ledgerId: record.ledgerId,
        }),
      );
      continue;
    }
    if (!previous && record.status !== McpCallStatus.STARTED) {
      incidents.push(
        Object.freeze({
          code: "CC_MCP_LEDGER_START_MISSING",
          ledgerId: record.ledgerId,
        }),
      );
      continue;
    }
    if (
      previous &&
      record.status !== McpCallStatus.STARTED &&
      !immutableRecordMatches(previous, record)
    ) {
      incidents.push(
        Object.freeze({
          code: "CC_MCP_LEDGER_RECORD_MISMATCH",
          ledgerId: record.ledgerId,
        }),
      );
      continue;
    }
    records.set(record.ledgerId, Object.freeze({ ...record }));
  }

  const snapshots = [...records.values()];
  return Object.freeze({
    records: Object.freeze(snapshots),
    unsettled: Object.freeze(
      snapshots.filter((record) => record.status === McpCallStatus.STARTED),
    ),
    incidents: Object.freeze(incidents),
  });
}

export function loadMcpLedgerRecovery(sessionId, options = {}) {
  const readVerifiedEvents =
    options.readVerifiedEvents || storeReadVerifiedEvents;
  try {
    return reduceMcpLedgerEvents(readVerifiedEvents(sessionId) || []);
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
  if (unsettled.length === 0 && incidents.length === 0) return null;

  const lines = unsettled.map((record) => {
    const effect = record.effectContract?.effect || "unknown";
    return `  • ${record.ledgerId}: ${record.serverName}/${record.toolName} [${effect}] — outcome unknown; inspect before retry`;
  });
  for (const incident of incidents) {
    lines.push(
      `  • ledger incident ${incident.code}${incident.ledgerId ? ` (${incident.ledgerId})` : ""} — fail closed and inspect transcript`,
    );
  }
  const omitted =
    Math.max(0, (recovery?.unsettled?.length || 0) - unsettled.length) +
    Math.max(0, (recovery?.incidents?.length || 0) - incidents.length);
  if (omitted > 0)
    lines.push(`  • ${omitted} additional ledger item(s) omitted`);

  return (
    "MCP recovery notice — a previous run left MCP calls whose durable " +
    "outcome cannot be proven. Do NOT automatically retry them. Verify the " +
    "external resource first and ask the user when uncertain:\n" +
    lines.join("\n")
  );
}
