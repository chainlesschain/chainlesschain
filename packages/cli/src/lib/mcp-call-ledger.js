import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";

export const MCP_CALL_LEDGER_SCHEMA_VERSION = 1;

export const MCP_CALL_LEDGER_PROTOCOL_LIMITS = Object.freeze({
  identifier: 256,
  ledgerId: 256,
  errorName: 96,
  errorCode: 128,
  scopeCount: 64,
  resourceScope: 1024,
  networkScopeInput: 2048,
  networkScope: 512,
});

export const MCP_CALL_LEDGER_OUTPUT_KINDS = Object.freeze([
  "array",
  "bigint",
  "boolean",
  "buffer",
  "function",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
]);

export const McpEffect = Object.freeze({
  READ: "read",
  UNKNOWN: "unknown",
  WRITE: "write",
  DESTRUCTIVE: "destructive",
});

export const McpCallStatus = Object.freeze({
  STARTED: "started",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const LedgerFailureAction = Object.freeze({
  FAIL_CLOSED: "fail-closed",
  FAIL_OPEN: "fail-open",
});

/**
 * A missing prewrite is tolerable only for a host-classified read. Unknown
 * effects stay fail-closed because an absent or incomplete MCP annotation is
 * not proof that the tool is side-effect free. Write/destructive are hard-coded
 * fail-closed and cannot be weakened through constructor options.
 */
export const DEFAULT_MCP_PREWRITE_FAILURE_POLICY = Object.freeze({
  [McpEffect.READ]: LedgerFailureAction.FAIL_OPEN,
  [McpEffect.UNKNOWN]: LedgerFailureAction.FAIL_CLOSED,
  [McpEffect.WRITE]: LedgerFailureAction.FAIL_CLOSED,
  [McpEffect.DESTRUCTIVE]: LedgerFailureAction.FAIL_CLOSED,
});

const EFFECTS = new Set(Object.values(McpEffect));
const TERMINAL_STATUSES = new Set([
  McpCallStatus.COMPLETED,
  McpCallStatus.FAILED,
  McpCallStatus.CANCELLED,
]);
const FAILURE_ACTIONS = new Set(Object.values(LedgerFailureAction));

function canonicalStringify(value, stack = new Set()) {
  if (value === null) return "null";

  const type = typeof value;
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "number") {
    return Number.isFinite(value)
      ? JSON.stringify(value)
      : JSON.stringify(`[number:${String(value)}]`);
  }
  if (type === "bigint") return JSON.stringify(`[bigint:${String(value)}]`);
  if (type === "undefined") return '"[undefined]"';
  if (type === "function" || type === "symbol") {
    return JSON.stringify(`[unsupported:${type}]`);
  }

  if (Buffer.isBuffer(value)) {
    return JSON.stringify(`[buffer:${value.toString("base64")}]`);
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return JSON.stringify(`[bytes:${bytes.toString("base64")}]`);
  }
  if (value instanceof Date) {
    return JSON.stringify(`[date:${value.toISOString()}]`);
  }

  if (stack.has(value)) {
    throw new TypeError("MCP ledger payload must not contain circular values");
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalStringify(item, stack)).join(",")}]`;
    }

    const entries = Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalStringify(value[key], stack)}`,
      );
    return `{${entries.join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function summarizeMcpPayload(value) {
  const canonical = canonicalStringify(value);
  return Object.freeze({
    sha256: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    bytes: Buffer.byteLength(canonical, "utf8"),
    kind:
      value === null
        ? "null"
        : Array.isArray(value)
          ? "array"
          : Buffer.isBuffer(value)
            ? "buffer"
            : typeof value,
  });
}

/** Return a stable SHA-256 digest without retaining the source value. */
export function sha256PayloadDigest(value) {
  return summarizeMcpPayload(value).sha256;
}

/**
 * Content-free identity for one exact MCP invocation. The byte count is bound
 * alongside the payload digest so every admission surface compares the same
 * canonical input representation used by the durable ledger.
 */
export function computeMcpExactReplayDigest({
  serverName,
  toolName,
  inputDigest,
  inputBytes,
} = {}) {
  return sha256PayloadDigest({
    schemaVersion: 1,
    serverName,
    toolName,
    inputDigest,
    inputBytes,
  });
}

function replaceProtocolControlCharacters(value) {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || (code >= 127 && code <= 159) ? " " : character;
    })
    .join("");
}

/** Canonicalize a bounded protocol label without retaining control bytes. */
export function normalizeMcpLedgerProtocolText(
  value,
  fallback = null,
  maxLength = MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
) {
  if (value === undefined || value === null || value === "") return fallback;
  const text = replaceProtocolControlCharacters(String(value));
  return text.trim().slice(0, maxLength).trim() || fallback;
}

function safeIdentifier(
  value,
  fallback = null,
  maxLength = MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
) {
  return normalizeMcpLedgerProtocolText(value, fallback, maxLength);
}

function nullableBoolean(value) {
  return typeof value === "boolean" ? value : null;
}

/**
 * Copy only the host-owned effect fields. Arbitrary server annotation payloads
 * are deliberately not persisted here: the admission layer must first reduce
 * them to this conservative contract.
 */
export function normalizeMcpEffectContract(contract = {}) {
  if (typeof contract === "string") contract = { effect: contract };
  const candidate = safeIdentifier(
    contract.effect || contract.classification,
    McpEffect.UNKNOWN,
    32,
  ).toLowerCase();
  let effect = EFFECTS.has(candidate) ? candidate : McpEffect.UNKNOWN;
  const destructive =
    effect === McpEffect.DESTRUCTIVE || contract.destructive === true;
  const sideEffecting =
    destructive ||
    effect === McpEffect.WRITE ||
    contract.sideEffecting === true;
  if (destructive) effect = McpEffect.DESTRUCTIVE;
  else if (sideEffecting && effect === McpEffect.READ) effect = McpEffect.WRITE;

  return Object.freeze({
    schemaVersion: MCP_CALL_LEDGER_SCHEMA_VERSION,
    effect,
    readOnly: effect === McpEffect.READ && !sideEffecting,
    sideEffecting,
    destructive,
    idempotent: nullableBoolean(contract.idempotent),
    openWorld: nullableBoolean(contract.openWorld),
    trusted: contract.trusted === true,
    source: safeIdentifier(
      contract.source,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    ),
  });
}

export function canonicalizeMcpResourceScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  const normalized = [];
  const seen = new Set();
  for (const scope of scopes) {
    if (typeof scope !== "string") continue;
    const value = safeIdentifier(
      scope,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.resourceScope,
    );
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= MCP_CALL_LEDGER_PROTOCOL_LIMITS.scopeCount) break;
  }
  return normalized;
}

function normalizeNetworkScope(scope) {
  if (typeof scope !== "string") return null;
  const value = safeIdentifier(
    scope,
    null,
    MCP_CALL_LEDGER_PROTOCOL_LIMITS.networkScopeInput,
  );
  if (!value) return null;

  // Network ledger entries retain the authority target, never URL credentials,
  // query strings, fragments, or path-carried request data.
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!url.hostname) return null;
    return safeIdentifier(
      `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.networkScope,
    );
  } catch {
    return null;
  }
}

export function canonicalizeMcpNetworkScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  const normalized = [];
  const seen = new Set();
  for (const scope of scopes) {
    const value = normalizeNetworkScope(scope);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= MCP_CALL_LEDGER_PROTOCOL_LIMITS.scopeCount) break;
  }
  return normalized;
}

function timestamp(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("MCP ledger clock returned an invalid timestamp");
  }
  return date.toISOString();
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function frozenSnapshot(record) {
  const snapshot = cloneRecord(record);
  for (const value of Object.values(snapshot)) {
    if (value && typeof value === "object") Object.freeze(value);
  }
  return Object.freeze(snapshot);
}

function summarizeError(error) {
  const message = String(error?.message || error || "unknown error");
  return Object.freeze({
    name: safeIdentifier(
      error?.name,
      "Error",
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.errorName,
    ),
    code: safeIdentifier(
      error?.code,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.errorCode,
    ),
    messageDigest: sha256PayloadDigest(message),
  });
}

function normalizeStatus(outcome = {}) {
  if (outcome.status) {
    const status = String(outcome.status).toLowerCase();
    if (!TERMINAL_STATUSES.has(status)) {
      throw new TypeError(
        `Invalid MCP ledger terminal status "${outcome.status}"`,
      );
    }
    return status;
  }
  if (outcome.cancelled === true || outcome.error?.name === "AbortError") {
    return McpCallStatus.CANCELLED;
  }
  return outcome.error ? McpCallStatus.FAILED : McpCallStatus.COMPLETED;
}

function resolveSinkWriter(sink) {
  if (!sink) return null;
  if (typeof sink === "function") return sink;
  if (typeof sink.append === "function") return sink.append.bind(sink);
  if (typeof sink.write === "function") return sink.write.bind(sink);
  throw new TypeError(
    "MCP call ledger sink must be a function, append(), or write()",
  );
}

export class McpCallLedgerPersistenceError extends Error {
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "McpCallLedgerPersistenceError";
    this.code = details.code || "CC_MCP_LEDGER_PERSIST_FAILED";
    this.ledgerId = details.ledgerId || null;
    this.effect = details.effect || McpEffect.UNKNOWN;
    this.phase = details.phase || null;
  }
}

/**
 * Host-owned, append-friendly MCP call ledger.
 *
 * Typical call-site usage:
 *
 *   const call = await ledger.begin({ ... });
 *   let outcome;
 *   try {
 *     const result = await mcpClient.callTool(...);
 *     outcome = { status: "completed", output: result };
 *     return result;
 *   } catch (error) {
 *     outcome = { error };
 *     throw error;
 *   } finally {
 *     await call.settle(outcome);
 *   }
 */
export class McpCallLedger {
  constructor(options = {}) {
    this._sink = resolveSinkWriter(options.sink || null);
    this._now = options.now || (() => new Date());
    this._randomUUID = options.randomUUID || nodeRandomUUID;
    this._sequence = 0;
    this._records = new Map();

    const requested = options.prewriteFailurePolicy || {};
    for (const [effect, action] of Object.entries(requested)) {
      if (!EFFECTS.has(effect) || !FAILURE_ACTIONS.has(action)) {
        throw new TypeError(
          `Invalid MCP ledger prewrite policy: ${effect}=${action}`,
        );
      }
    }
    this.prewriteFailurePolicy = Object.freeze({
      ...DEFAULT_MCP_PREWRITE_FAILURE_POLICY,
      [McpEffect.READ]:
        requested[McpEffect.READ] ||
        DEFAULT_MCP_PREWRITE_FAILURE_POLICY[McpEffect.READ],
      [McpEffect.UNKNOWN]:
        requested[McpEffect.UNKNOWN] ||
        DEFAULT_MCP_PREWRITE_FAILURE_POLICY[McpEffect.UNKNOWN],
      // Authority-bearing effects are never configurable to fail-open.
      [McpEffect.WRITE]: LedgerFailureAction.FAIL_CLOSED,
      [McpEffect.DESTRUCTIVE]: LedgerFailureAction.FAIL_CLOSED,
    });
  }

  async _persist(record, phase) {
    if (!this._sink) return false;
    await this._sink(frozenSnapshot(record), Object.freeze({ phase }));
    return true;
  }

  _nextLedgerId() {
    this._sequence += 1;
    const randomPart = safeIdentifier(this._randomUUID(), "uuid", 128).replace(
      /[^a-zA-Z0-9_-]/g,
      "-",
    );
    return `mcp-${randomPart}-${this._sequence.toString(36)}`;
  }

  async begin(call = {}) {
    const toolName = safeIdentifier(
      call.toolName || call.tool,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    );
    const serverName = safeIdentifier(
      call.serverName || call.server,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
    );
    if (!toolName) throw new TypeError("MCP ledger begin requires toolName");
    if (!serverName)
      throw new TypeError("MCP ledger begin requires serverName");

    const ledgerId = this._nextLedgerId();
    const effectContract = normalizeMcpEffectContract(
      call.effectContract || call.effect || {},
    );
    const input = summarizeMcpPayload(
      Object.prototype.hasOwnProperty.call(call, "input") ? call.input : {},
    );
    const prewritePolicy =
      this.prewriteFailurePolicy[effectContract.effect] ||
      LedgerFailureAction.FAIL_CLOSED;
    let record = {
      schemaVersion: MCP_CALL_LEDGER_SCHEMA_VERSION,
      ledgerId,
      sessionId: safeIdentifier(
        call.sessionId,
        null,
        MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
      ),
      turnId: safeIdentifier(
        call.turnId ?? call.turn,
        null,
        MCP_CALL_LEDGER_PROTOCOL_LIMITS.identifier,
      ),
      toolName,
      serverName,
      inputDigest: input.sha256,
      inputBytes: input.bytes,
      effectContract,
      resourceScopes: canonicalizeMcpResourceScopes(call.resourceScopes),
      networkScopes: canonicalizeMcpNetworkScopes(call.networkScopes),
      prewritePolicy,
      prewritePersistence: this._sink ? "pending" : "memory-only",
      status: McpCallStatus.STARTED,
      startedAt: timestamp(this._now),
      settledAt: null,
      outputSummary: null,
      outputDigest: null,
      errorSummary: null,
    };
    this._records.set(ledgerId, record);

    let prewritePersisted = false;
    try {
      prewritePersisted = await this._persist(record, "started");
      if (prewritePersisted) {
        record = { ...record, prewritePersistence: "persisted" };
        this._records.set(ledgerId, record);
      }
    } catch (error) {
      const persistenceError = summarizeError(error);
      if (prewritePolicy === LedgerFailureAction.FAIL_CLOSED) {
        record = {
          ...record,
          status: McpCallStatus.FAILED,
          settledAt: timestamp(this._now),
          prewritePersistence: "failed-closed",
          errorSummary: persistenceError,
        };
        this._records.set(ledgerId, record);
        throw new McpCallLedgerPersistenceError(
          "MCP call blocked because its ledger prewrite could not be persisted",
          {
            code: "CC_MCP_LEDGER_PREWRITE_FAILED",
            ledgerId,
            effect: effectContract.effect,
            phase: "started",
            cause: error,
          },
        );
      }

      record = {
        ...record,
        prewritePersistence: "failed-open",
        prewriteError: persistenceError,
      };
      this._records.set(ledgerId, record);
    }

    const ledger = this;
    return Object.freeze({
      ledgerId,
      prewritePersisted,
      prewritePolicy,
      record: frozenSnapshot(record),
      settle(outcome = {}) {
        return ledger.settle(ledgerId, outcome);
      },
    });
  }

  beginCall(call = {}) {
    return this.begin(call);
  }

  async settle(ticketOrLedgerId, outcome = {}) {
    const ledgerId = safeIdentifier(
      typeof ticketOrLedgerId === "string"
        ? ticketOrLedgerId
        : ticketOrLedgerId?.ledgerId,
      null,
      MCP_CALL_LEDGER_PROTOCOL_LIMITS.ledgerId,
    );
    if (!ledgerId || !this._records.has(ledgerId)) {
      throw new Error(`Unknown MCP ledger entry: ${ledgerId || "(missing)"}`);
    }

    const current = this._records.get(ledgerId);
    const status = normalizeStatus(outcome);
    if (TERMINAL_STATUSES.has(current.status)) {
      if (current.status === status) return frozenSnapshot(current);
      const error = new Error(
        `MCP ledger entry ${ledgerId} is already settled as ${current.status}`,
      );
      error.code = "CC_MCP_LEDGER_ALREADY_SETTLED";
      throw error;
    }

    const hasOutput =
      Object.prototype.hasOwnProperty.call(outcome, "output") ||
      Object.prototype.hasOwnProperty.call(outcome, "result");
    const output = hasOutput
      ? summarizeMcpPayload(
          Object.prototype.hasOwnProperty.call(outcome, "output")
            ? outcome.output
            : outcome.result,
        )
      : null;
    const errorSummary = outcome.error ? summarizeError(outcome.error) : null;
    const settlementPersistence =
      current.prewritePersistence === "failed-open"
        ? "skipped-no-prewrite"
        : this._sink
          ? "pending"
          : "memory-only";
    let settled = {
      ...current,
      status,
      settledAt: timestamp(this._now),
      outputSummary: output,
      outputDigest: output?.sha256 || null,
      errorSummary,
      settlementPersistence,
    };
    this._records.set(ledgerId, settled);

    // A failed-open call has no durable start. Appending a terminal record would
    // create an orphan authority event that recovery must reject, so settlement
    // remains an in-memory fact for this process only.
    if (current.prewritePersistence === "failed-open") {
      return frozenSnapshot(settled);
    }

    try {
      const persisted = await this._persist(settled, "settled");
      if (persisted) {
        settled = { ...settled, settlementPersistence: "persisted" };
        this._records.set(ledgerId, settled);
      }
    } catch (error) {
      settled = {
        ...settled,
        settlementPersistence: "failed",
        settlementError: summarizeError(error),
      };
      this._records.set(ledgerId, settled);
      throw new McpCallLedgerPersistenceError(
        "MCP call settled, but its ledger outcome could not be persisted",
        {
          code: "CC_MCP_LEDGER_SETTLE_FAILED",
          ledgerId,
          effect: current.effectContract.effect,
          phase: "settled",
          cause: error,
        },
      );
    }

    return frozenSnapshot(settled);
  }

  settleCall(ticketOrLedgerId, outcome = {}) {
    return this.settle(ticketOrLedgerId, outcome);
  }

  get(ledgerId) {
    const record = this._records.get(String(ledgerId || ""));
    return record ? frozenSnapshot(record) : null;
  }

  list() {
    return [...this._records.values()].map(frozenSnapshot);
  }
}

export function createMcpCallLedger(options = {}) {
  return new McpCallLedger(options);
}
