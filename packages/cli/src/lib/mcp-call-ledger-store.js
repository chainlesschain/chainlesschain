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
  appendEvent as storeAppendEvent,
  readEvents as storeReadEvents,
} from "../harness/jsonl-session-store.js";
import {
  MCP_CALL_LEDGER_SCHEMA_VERSION,
  McpCallStatus,
} from "./mcp-call-ledger.js";

export const MCP_CALL_LEDGER_EVENT = "mcp_call_ledger";
export const MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION = 1;

const TERMINAL = new Set([
  McpCallStatus.COMPLETED,
  McpCallStatus.FAILED,
  McpCallStatus.CANCELLED,
]);

export class McpCallLedgerStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "McpCallLedgerStoreError";
    this.code = code;
    this.sessionId = options.sessionId || null;
    this.ledgerId = options.ledgerId || null;
  }
}

function validRecord(record) {
  return (
    record &&
    typeof record === "object" &&
    record.schemaVersion === MCP_CALL_LEDGER_SCHEMA_VERSION &&
    typeof record.ledgerId === "string" &&
    record.ledgerId.length > 0 &&
    typeof record.toolName === "string" &&
    typeof record.serverName === "string" &&
    [McpCallStatus.STARTED, ...TERMINAL].includes(record.status)
  );
}

function phaseMatchesRecord(phase, record) {
  return (
    (phase === "started" && record.status === McpCallStatus.STARTED) ||
    (phase === "settled" && TERMINAL.has(record.status))
  );
}

/** Create the async sink accepted by `McpCallLedger`. */
export function createSessionMcpLedgerSink(sessionId, options = {}) {
  const appendEvent = options.appendEvent || storeAppendEvent;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new TypeError("MCP ledger session sink requires sessionId");
  }
  if (typeof appendEvent !== "function") {
    throw new TypeError("MCP ledger session sink requires appendEvent");
  }

  return async (record, metadata = {}) => {
    if (!validRecord(record)) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_RECORD_INVALID",
        "MCP ledger refused to persist an invalid record",
        { sessionId, ledgerId: record?.ledgerId || null },
      );
    }
    const phase = String(metadata.phase || "");
    if (phase !== "started" && phase !== "settled") {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_PHASE_INVALID",
        `MCP ledger event phase is invalid: ${phase || "(missing)"}`,
        { sessionId, ledgerId: record.ledgerId },
      );
    }
    if (!phaseMatchesRecord(phase, record)) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_PHASE_STATUS_MISMATCH",
        `MCP ledger event phase ${phase} does not match status ${record.status}`,
        { sessionId, ledgerId: record.ledgerId },
      );
    }
    try {
      const written = await appendEvent(sessionId, MCP_CALL_LEDGER_EVENT, {
        schemaVersion: MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION,
        phase,
        record,
      });
      if (written === false) {
        throw new Error("canonical session store rejected the event");
      }
      return true;
    } catch (cause) {
      throw new McpCallLedgerStoreError(
        "CC_MCP_LEDGER_EVENT_PERSIST_FAILED",
        `MCP ledger event persistence failed for ${sessionId}: ${cause.message}`,
        { sessionId, ledgerId: record.ledgerId, cause },
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
    const record = envelope?.record;
    if (
      envelope?.schemaVersion !== MCP_CALL_LEDGER_EVENT_SCHEMA_VERSION ||
      !validRecord(record) ||
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
    if (!previous && record.status !== McpCallStatus.STARTED) {
      incidents.push(
        Object.freeze({
          code: "CC_MCP_LEDGER_START_MISSING",
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
  const readEvents = options.readEvents || storeReadEvents;
  try {
    return reduceMcpLedgerEvents(readEvents(sessionId) || []);
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
