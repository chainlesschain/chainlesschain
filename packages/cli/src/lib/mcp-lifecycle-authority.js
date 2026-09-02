/**
 * Durable, generation-fenced authority for one logical MCP client/server
 * relationship.
 *
 * Transport objects are intentionally ephemeral. This authority retains the
 * desired resource subscriptions, legal lifecycle transitions, and bounded
 * RPC settlement receipts across a hot reconnect or process restart. A stale
 * transport generation can therefore neither publish callbacks nor mutate the
 * replacement connection's state.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getStatePath } from "./paths.js";
import {
  mutateSecurityStore,
  readSecurityStore,
} from "./durable-security-store.js";
import { withFileLock } from "./with-file-lock.js";

const STORE_SCHEMA = "chainlesschain.mcp-lifecycle-authority.v1";
const STORE_VERSION = 1;
const MAX_SERVERS = 256;
const MAX_RECEIPTS = 512;
const MAX_SETTLED_RPC = 512;
const MAX_PENDING_RPC = 512;
const MAX_SUBSCRIPTIONS = 256;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ATTEMPT_PATTERN = /^mcp-attempt-[0-9a-f-]{36}$/u;
const OWNER_PATTERN = /^mcp-owner-[0-9a-f-]{36}$/u;

export const MCP_LIFECYCLE_PHASES = Object.freeze({
  DISABLED: "disabled",
  IDLE: "idle",
  CONNECTING: "connecting",
  INITIALIZING: "initializing",
  DISCOVERING: "discovering",
  READY: "ready",
  RECONNECTING: "reconnecting",
  DISCONNECTING: "disconnecting",
  FAILED: "failed",
});

const TRANSITIONS = Object.freeze({
  disabled: new Set(["idle"]),
  idle: new Set(["connecting", "reconnecting", "disabled"]),
  connecting: new Set([
    "initializing",
    "reconnecting",
    "disconnecting",
    "failed",
    "disabled",
  ]),
  initializing: new Set([
    "discovering",
    "reconnecting",
    "disconnecting",
    "failed",
    "disabled",
  ]),
  discovering: new Set([
    "ready",
    "reconnecting",
    "disconnecting",
    "failed",
    "disabled",
  ]),
  ready: new Set(["reconnecting", "disconnecting", "failed", "disabled"]),
  reconnecting: new Set([
    "initializing",
    "disconnecting",
    "failed",
    "disabled",
  ]),
  disconnecting: new Set(["reconnecting", "idle", "failed", "disabled"]),
  failed: new Set([
    "connecting",
    "reconnecting",
    "disconnecting",
    "idle",
    "disabled",
  ]),
});

const ACTIVE_PHASES = new Set([
  "connecting",
  "initializing",
  "discovering",
  "ready",
  "reconnecting",
]);

export const MCP_LIFECYCLE_ERROR_CODES = Object.freeze({
  DISABLED: "CC_MCP_LIFECYCLE_DISABLED",
  FENCED: "CC_MCP_LIFECYCLE_FENCED",
  INVALID_TRANSITION: "CC_MCP_LIFECYCLE_INVALID_TRANSITION",
  BACKPRESSURE: "CC_MCP_LIFECYCLE_BACKPRESSURE",
  CORRUPT: "CC_MCP_LIFECYCLE_CORRUPT",
});

function lifecycleError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "McpLifecycleAuthorityError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function boundedId(value, label) {
  const id = String(value ?? "");
  if (
    !id ||
    id.includes("\0") ||
    /[\r\n]/u.test(id) ||
    Buffer.byteLength(id, "utf8") > 512
  ) {
    throw new TypeError(`${label} must be a bounded identifier`);
  }
  return id;
}

function isBoundedId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    !/[\r\n]/u.test(value) &&
    Buffer.byteLength(value, "utf8") <= 512
  );
}

function finiteTime(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer timestamp`);
  }
  return value;
}

function serverKey(sessionId, name) {
  return sha256(
    `mcp-lifecycle-server-v1\n${boundedId(sessionId, "sessionId")}\n${boundedId(name, "server name")}`,
  );
}

function targetDigest(config = {}) {
  let endpoint = null;
  if (typeof config.url === "string") {
    try {
      const parsed = new URL(config.url);
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      endpoint = parsed.href;
    } catch {
      endpoint = "invalid-url";
    }
  }
  return sha256(
    JSON.stringify({
      transport: String(config.transport || (endpoint ? "http" : "stdio")),
      endpoint,
      command:
        typeof config.command === "string" ? sha256(config.command) : null,
      args:
        Array.isArray(config.args) &&
        config.args.every((argument) => typeof argument === "string")
          ? sha256(JSON.stringify(config.args))
          : null,
      cwd: typeof config.cwd === "string" ? sha256(config.cwd) : null,
      configScope:
        typeof config.configScope === "string" ? config.configScope : null,
    }),
  );
}

function emptyMetrics() {
  return {
    connectionAttempts: 0,
    reconnectAttempts: 0,
    restartRecoveries: 0,
    rpcRegistered: 0,
    rpcSettled: 0,
    rpcFailedClosed: 0,
    rpcRecoveredAfterRestart: 0,
    duplicateCallbacksRejected: 0,
    staleCallbacksRejected: 0,
    unmatchedCallbacksRejected: 0,
    duplicateCallbacksAccepted: 0,
    staleCallbacksAccepted: 0,
    lostCallbacks: 0,
  };
}

function emptyStore() {
  return {
    schema: STORE_SCHEMA,
    schemaVersion: STORE_VERSION,
    revision: 0,
    updatedAtMs: 0,
    servers: {},
  };
}

function newRecord({ key, name, sessionId, configDigest, now }) {
  return {
    key,
    name,
    sessionId,
    configDigest,
    desired: "enabled",
    phase: "idle",
    generation: 0,
    sequence: 0,
    ownerId: null,
    attemptId: null,
    attemptStartedAtMs: null,
    readyAtMs: null,
    lastTransitionAtMs: now,
    lastFailureCode: null,
    tlsIdentityDigest: null,
    subscriptions: [],
    pendingRpc: [],
    settledRpc: [],
    receipts: [],
    metrics: emptyMetrics(),
  };
}

function validateRecord(record, expectedKey) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.key !== expectedKey ||
    !DIGEST_PATTERN.test(record.key || "") ||
    !isBoundedId(record.name) ||
    !isBoundedId(record.sessionId) ||
    !DIGEST_PATTERN.test(record.configDigest || "") ||
    !["enabled", "disabled"].includes(record.desired) ||
    !Object.values(MCP_LIFECYCLE_PHASES).includes(record.phase) ||
    !Number.isSafeInteger(record.generation) ||
    record.generation < 0 ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 0 ||
    (record.ownerId !== null && !OWNER_PATTERN.test(record.ownerId)) ||
    (record.attemptId !== null && !ATTEMPT_PATTERN.test(record.attemptId)) ||
    (["idle", "disabled"].includes(record.phase) &&
      (record.ownerId !== null || record.attemptId !== null)) ||
    (!["idle", "disabled"].includes(record.phase) &&
      (record.ownerId === null || record.attemptId === null)) ||
    (record.desired === "disabled") !== (record.phase === "disabled") ||
    (record.attemptStartedAtMs !== null &&
      (!Number.isSafeInteger(record.attemptStartedAtMs) ||
        record.attemptStartedAtMs < 0)) ||
    (record.readyAtMs !== null &&
      (!Number.isSafeInteger(record.readyAtMs) || record.readyAtMs < 0)) ||
    !Number.isSafeInteger(record.lastTransitionAtMs) ||
    record.lastTransitionAtMs < 0 ||
    (record.lastFailureCode !== null && !isBoundedId(record.lastFailureCode)) ||
    (record.tlsIdentityDigest !== null &&
      !DIGEST_PATTERN.test(record.tlsIdentityDigest)) ||
    !Array.isArray(record.subscriptions) ||
    record.subscriptions.length > MAX_SUBSCRIPTIONS ||
    new Set(record.subscriptions).size !== record.subscriptions.length ||
    record.subscriptions.some(
      (uri) =>
        typeof uri !== "string" ||
        uri.length === 0 ||
        Buffer.byteLength(uri, "utf8") > 8192,
    ) ||
    !Array.isArray(record.pendingRpc) ||
    record.pendingRpc.length > MAX_PENDING_RPC ||
    !Array.isArray(record.settledRpc) ||
    record.settledRpc.length > MAX_SETTLED_RPC ||
    !Array.isArray(record.receipts) ||
    record.receipts.length > MAX_RECEIPTS
  ) {
    throw lifecycleError(
      MCP_LIFECYCLE_ERROR_CODES.CORRUPT,
      "MCP lifecycle authority contains an invalid server record",
    );
  }
  const pending = new Set();
  for (const item of record.pendingRpc) {
    if (
      !item ||
      !DIGEST_PATTERN.test(item.digest || "") ||
      pending.has(item.digest) ||
      typeof item.method !== "string" ||
      item.method.length === 0 ||
      item.method.length > 256 ||
      !Number.isSafeInteger(item.generation) ||
      item.generation < 1 ||
      !Number.isSafeInteger(item.registeredAtMs) ||
      item.registeredAtMs < 0
    ) {
      throw lifecycleError(
        MCP_LIFECYCLE_ERROR_CODES.CORRUPT,
        "MCP lifecycle authority contains an invalid pending RPC",
      );
    }
    pending.add(item.digest);
  }
  if (
    record.settledRpc.some((digest) => !DIGEST_PATTERN.test(digest)) ||
    new Set(record.settledRpc).size !== record.settledRpc.length ||
    record.settledRpc.some((digest) => pending.has(digest))
  ) {
    throw lifecycleError(
      MCP_LIFECYCLE_ERROR_CODES.CORRUPT,
      "MCP lifecycle authority RPC receipts are invalid",
    );
  }
  const expectedMetrics = Object.keys(emptyMetrics());
  if (
    !record.metrics ||
    Object.keys(record.metrics).sort().join("\0") !==
      expectedMetrics.sort().join("\0") ||
    expectedMetrics.some(
      (key) =>
        !Number.isSafeInteger(record.metrics[key]) || record.metrics[key] < 0,
    ) ||
    record.metrics.rpcRegistered !==
      record.metrics.rpcSettled + record.pendingRpc.length ||
    record.metrics.rpcFailedClosed > record.metrics.rpcSettled ||
    record.metrics.rpcRecoveredAfterRestart > record.metrics.rpcFailedClosed ||
    record.metrics.duplicateCallbacksAccepted !== 0 ||
    record.metrics.staleCallbacksAccepted !== 0 ||
    record.metrics.lostCallbacks !== 0
  ) {
    throw lifecycleError(
      MCP_LIFECYCLE_ERROR_CODES.CORRUPT,
      "MCP lifecycle authority callback accounting is invalid",
    );
  }
  return record;
}

function validateStore(store, { missing = false } = {}) {
  if (missing && Object.keys(store).length === 0) return emptyStore();
  if (
    !store ||
    store.schema !== STORE_SCHEMA ||
    store.schemaVersion !== STORE_VERSION ||
    !Number.isSafeInteger(store.revision) ||
    store.revision < 0 ||
    !Number.isSafeInteger(store.updatedAtMs) ||
    store.updatedAtMs < 0 ||
    !store.servers ||
    typeof store.servers !== "object" ||
    Array.isArray(store.servers) ||
    Object.keys(store.servers).length > MAX_SERVERS
  ) {
    throw lifecycleError(
      MCP_LIFECYCLE_ERROR_CODES.CORRUPT,
      "MCP lifecycle authority store is invalid",
    );
  }
  for (const [key, record] of Object.entries(store.servers)) {
    validateRecord(record, key);
  }
  return store;
}

function appendReceipt(record, receipt) {
  record.sequence += 1;
  record.receipts.push({ sequence: record.sequence, ...receipt });
  if (record.receipts.length > MAX_RECEIPTS) record.receipts.shift();
}

function assertLegalTransition(from, to, { allowSame = false } = {}) {
  if (from === to && allowSame) return;
  if (TRANSITIONS[from]?.has(to)) return;
  throw lifecycleError(
    MCP_LIFECYCLE_ERROR_CODES.INVALID_TRANSITION,
    `Illegal MCP lifecycle transition ${from} -> ${to}`,
    { from, to },
  );
}

function failClosedPending(
  record,
  now,
  outcome,
  { recoveredAfterRestart = false } = {},
) {
  if (record.pendingRpc.length === 0) return 0;
  const recovered = record.pendingRpc.length;
  record.metrics.rpcSettled += recovered;
  record.metrics.rpcFailedClosed += recovered;
  if (recoveredAfterRestart) {
    record.metrics.rpcRecoveredAfterRestart += recovered;
  }
  for (const pending of record.pendingRpc) {
    record.settledRpc.push(pending.digest);
    appendReceipt(record, {
      type: "rpc-terminal",
      digest: pending.digest,
      outcome,
      generation: pending.generation,
      atMs: now,
    });
  }
  record.pendingRpc = [];
  record.settledRpc = record.settledRpc.slice(-MAX_SETTLED_RPC);
  return recovered;
}

function rpcDigest(token, requestId) {
  return sha256(
    `mcp-rpc-v1\n${token.key}\n${token.generation}\n${String(requestId)}`,
  );
}

function publicToken(record) {
  return Object.freeze({
    key: record.key,
    name: record.name,
    sessionId: record.sessionId,
    generation: record.generation,
    ownerId: record.ownerId,
    attemptId: record.attemptId,
  });
}

function publicRecord(record) {
  return structuredClone(record);
}

export function defaultMcpLifecycleAuthorityPath() {
  return path.join(getStatePath(), "mcp-lifecycle-authority.json");
}

export class McpLifecycleAuthority {
  constructor({
    statePath = null,
    now = () => Date.now(),
    createOwnerId = () => `mcp-owner-${crypto.randomUUID()}`,
    createAttemptId = () => `mcp-attempt-${crypto.randomUUID()}`,
    lock = withFileLock,
  } = {}) {
    this.statePath = statePath == null ? null : path.resolve(statePath);
    this._now = now;
    this._createOwnerId = createOwnerId;
    this._createAttemptId = createAttemptId;
    this._lock = lock;
    this._memory = emptyStore();
  }

  _read() {
    if (!this.statePath) return validateStore(structuredClone(this._memory));
    // A Windows replace can briefly make the destination path unobservable to
    // an unlocked reader. Treating that ENOENT as an empty authority loses the
    // server snapshot even though the replacement is about to become visible.
    // Durable reads therefore share the exact strict lock used by mutations.
    if (!fs.existsSync(path.dirname(this.statePath))) {
      return validateStore({}, { missing: true });
    }
    return this._lock(
      this.statePath,
      () => {
        const value = readSecurityStore(
          this.statePath,
          "MCP lifecycle authority",
        );
        return validateStore(value, {
          missing: Object.keys(value).length === 0,
        });
      },
      { timeoutMs: 2000, staleMs: 30000, failIfUnavailable: true },
    );
  }

  _mutate(mutator) {
    const apply = (draft, missing = false) => {
      const current = validateStore(draft, { missing });
      const next = structuredClone(current);
      const result = mutator(next);
      next.revision = current.revision + 1;
      next.updatedAtMs = finiteTime(this._now(), "now");
      validateStore(next);
      return { next, result };
    };
    if (!this.statePath) {
      const { next, result } = apply(this._memory);
      this._memory = next;
      return result;
    }
    return mutateSecurityStore(
      this.statePath,
      "MCP lifecycle authority",
      (draft) => {
        const missing = Object.keys(draft).length === 0;
        const { next, result } = apply(draft, missing);
        for (const key of Reflect.ownKeys(draft)) delete draft[key];
        Object.assign(draft, next);
        return result;
      },
      { lock: this._lock },
    );
  }

  _record(store, { name, sessionId, config = {} }) {
    const canonicalName = boundedId(name, "server name");
    const canonicalSession = boundedId(sessionId || "default", "sessionId");
    const key = serverKey(canonicalSession, canonicalName);
    let record = store.servers[key];
    if (!record) {
      if (Object.keys(store.servers).length >= MAX_SERVERS) {
        const evictable = Object.values(store.servers)
          .filter(
            (candidate) =>
              !ACTIVE_PHASES.has(candidate.phase) &&
              candidate.phase !== "disconnecting" &&
              candidate.pendingRpc.length === 0,
          )
          .sort(
            (left, right) =>
              left.lastTransitionAtMs - right.lastTransitionAtMs ||
              left.key.localeCompare(right.key),
          )[0];
        if (!evictable) {
          throw lifecycleError(
            MCP_LIFECYCLE_ERROR_CODES.BACKPRESSURE,
            "MCP lifecycle authority server capacity is full",
          );
        }
        delete store.servers[evictable.key];
      }
      record = newRecord({
        key,
        name: canonicalName,
        sessionId: canonicalSession,
        configDigest: targetDigest(config),
        now: finiteTime(this._now(), "now"),
      });
      store.servers[key] = record;
    }
    return record;
  }

  markDisabled({ name, sessionId = "default", config = {} }) {
    return this._mutate((store) => {
      const record = this._record(store, { name, sessionId, config });
      const from = record.phase;
      if (from === "disabled") {
        record.configDigest = targetDigest(config);
        return publicRecord(record);
      }
      assertLegalTransition(from, "disabled");
      const now = finiteTime(this._now(), "now");
      failClosedPending(record, now, "disabled-failed-closed");
      record.generation += 1;
      record.desired = "disabled";
      record.phase = "disabled";
      record.configDigest = targetDigest(config);
      record.ownerId = null;
      record.attemptId = null;
      record.lastTransitionAtMs = now;
      appendReceipt(record, {
        type: "transition",
        from,
        to: "disabled",
        generation: record.generation,
        atMs: record.lastTransitionAtMs,
      });
      return publicRecord(record);
    });
  }

  beginConnection({
    name,
    sessionId = "default",
    config = {},
    reconnect = false,
    explicitEnable = false,
  }) {
    return this._mutate((store) => {
      const record = this._record(store, { name, sessionId, config });
      if (record.desired === "disabled" && !explicitEnable) {
        throw lifecycleError(
          MCP_LIFECYCLE_ERROR_CODES.DISABLED,
          `MCP server "${record.name}" is disabled`,
          { name: record.name },
        );
      }
      const now = finiteTime(this._now(), "now");
      if (record.phase === "disabled") {
        assertLegalTransition("disabled", "idle");
        record.phase = "idle";
        record.lastTransitionAtMs = now;
        appendReceipt(record, {
          type: "transition",
          from: "disabled",
          to: "idle",
          generation: record.generation,
          atMs: now,
        });
      }
      const from = record.phase;
      const recovering =
        ACTIVE_PHASES.has(from) || from === MCP_LIFECYCLE_PHASES.DISCONNECTING;
      const nextPhase = reconnect || recovering ? "reconnecting" : "connecting";
      assertLegalTransition(from, nextPhase, {
        allowSame: from === "reconnecting" && nextPhase === "reconnecting",
      });
      failClosedPending(record, now, "recovered-after-restart", {
        recoveredAfterRestart: true,
      });
      record.desired = "enabled";
      record.configDigest = targetDigest(config);
      record.generation += 1;
      record.ownerId = this._createOwnerId();
      record.attemptId = this._createAttemptId();
      if (
        !OWNER_PATTERN.test(record.ownerId) ||
        !ATTEMPT_PATTERN.test(record.attemptId)
      ) {
        throw new TypeError("MCP lifecycle authority generated an invalid id");
      }
      record.phase = nextPhase;
      record.attemptStartedAtMs = now;
      record.readyAtMs = null;
      record.lastTransitionAtMs = now;
      record.lastFailureCode = null;
      record.tlsIdentityDigest = null;
      record.metrics.connectionAttempts += 1;
      if (reconnect || recovering) record.metrics.reconnectAttempts += 1;
      if (recovering) record.metrics.restartRecoveries += 1;
      appendReceipt(record, {
        type: "transition",
        from,
        to: record.phase,
        generation: record.generation,
        atMs: now,
      });
      return publicToken(record);
    });
  }

  _currentRecord(store, token) {
    const record = store.servers[token?.key];
    if (
      !record ||
      record.generation !== token?.generation ||
      record.ownerId !== token?.ownerId ||
      record.attemptId !== token?.attemptId
    ) {
      throw lifecycleError(
        MCP_LIFECYCLE_ERROR_CODES.FENCED,
        "MCP lifecycle generation is stale",
        {
          expectedGeneration: record?.generation ?? null,
          actualGeneration: token?.generation ?? null,
        },
      );
    }
    return record;
  }

  transition(token, to, details = {}) {
    return this._mutate((store) => {
      const record = this._currentRecord(store, token);
      const from = record.phase;
      if (from === to) return publicRecord(record);
      assertLegalTransition(from, to);
      const now = finiteTime(this._now(), "now");
      if (to === "idle" || to === "disabled") {
        failClosedPending(record, now, `${to}-failed-closed`);
      }
      if (to === "disabled") record.desired = "disabled";
      if (from === "disabled" && to === "idle") record.desired = "enabled";
      record.phase = to;
      record.lastTransitionAtMs = now;
      if (to === "ready") record.readyAtMs = now;
      if (to === "failed") {
        record.lastFailureCode = boundedId(
          details.reasonCode || "CC_MCP_CONNECTION_FAILED",
          "failure code",
        );
      }
      if (details.tlsIdentityDigest != null) {
        if (!DIGEST_PATTERN.test(details.tlsIdentityDigest)) {
          throw new TypeError("MCP TLS identity digest is invalid");
        }
        record.tlsIdentityDigest = details.tlsIdentityDigest;
      }
      if (to === "idle" || to === "disabled") {
        record.ownerId = null;
        record.attemptId = null;
      }
      appendReceipt(record, {
        type: "transition",
        from,
        to,
        generation: record.generation,
        atMs: now,
        ...(record.lastFailureCode && to === "failed"
          ? { reasonCode: record.lastFailureCode }
          : {}),
      });
      return publicRecord(record);
    });
  }

  registerRpc(token, requestId, method) {
    return this._mutate((store) => {
      const record = this._currentRecord(store, token);
      if (!ACTIVE_PHASES.has(record.phase)) {
        throw lifecycleError(
          MCP_LIFECYCLE_ERROR_CODES.INVALID_TRANSITION,
          `MCP RPC cannot start while lifecycle is ${record.phase}`,
        );
      }
      if (record.pendingRpc.length >= MAX_PENDING_RPC) {
        throw lifecycleError(
          MCP_LIFECYCLE_ERROR_CODES.BACKPRESSURE,
          "MCP lifecycle pending RPC capacity is full",
        );
      }
      const digest = rpcDigest(token, requestId);
      if (
        record.pendingRpc.some((item) => item.digest === digest) ||
        record.settledRpc.includes(digest)
      ) {
        throw lifecycleError(
          MCP_LIFECYCLE_ERROR_CODES.FENCED,
          "MCP RPC id was already registered for this generation",
        );
      }
      const now = finiteTime(this._now(), "now");
      record.pendingRpc.push({
        digest,
        method: String(method).slice(0, 256),
        generation: record.generation,
        registeredAtMs: now,
      });
      record.metrics.rpcRegistered += 1;
      appendReceipt(record, {
        type: "rpc-registered",
        digest,
        method: String(method).slice(0, 256),
        generation: record.generation,
        atMs: now,
      });
      return digest;
    });
  }

  settleRpc(token, requestId, outcome = "completed") {
    return this._mutate((store) => {
      const record = store.servers[token?.key];
      const current = Boolean(
        record &&
        record.generation === token?.generation &&
        record.ownerId === token?.ownerId &&
        record.attemptId === token?.attemptId,
      );
      if (!current) {
        if (record) {
          record.metrics.staleCallbacksRejected += 1;
          appendReceipt(record, {
            type: "rpc-rejected",
            reason: "stale-terminal",
            generation: token?.generation ?? 0,
            atMs: finiteTime(this._now(), "now"),
          });
        }
        return false;
      }
      const digest = rpcDigest(token, requestId);
      const index = record.pendingRpc.findIndex(
        (item) => item.digest === digest,
      );
      if (index < 0) {
        if (record.settledRpc.includes(digest)) {
          record.metrics.duplicateCallbacksRejected += 1;
        } else {
          record.metrics.unmatchedCallbacksRejected += 1;
        }
        return false;
      }
      record.pendingRpc.splice(index, 1);
      record.settledRpc.push(digest);
      record.settledRpc = record.settledRpc.slice(-MAX_SETTLED_RPC);
      record.metrics.rpcSettled += 1;
      if (outcome !== "completed") record.metrics.rpcFailedClosed += 1;
      appendReceipt(record, {
        type: "rpc-terminal",
        digest,
        outcome: boundedId(outcome, "RPC outcome"),
        generation: record.generation,
        atMs: finiteTime(this._now(), "now"),
      });
      return true;
    });
  }

  rejectUnexpectedRpc(token, requestId, reason = "unmatched") {
    return this._mutate((store) => {
      const record = store.servers[token?.key];
      if (!record) return false;
      const current =
        record.generation === token?.generation &&
        record.ownerId === token?.ownerId &&
        record.attemptId === token?.attemptId;
      if (!current || reason === "stale") {
        record.metrics.staleCallbacksRejected += 1;
      } else {
        const digest = rpcDigest(token, requestId);
        if (record.settledRpc.includes(digest) || reason === "duplicate") {
          record.metrics.duplicateCallbacksRejected += 1;
        } else {
          record.metrics.unmatchedCallbacksRejected += 1;
        }
      }
      appendReceipt(record, {
        type: "rpc-rejected",
        reason: boundedId(reason, "callback rejection reason"),
        generation: token?.generation ?? 0,
        atMs: finiteTime(this._now(), "now"),
      });
      return false;
    });
  }

  setSubscription(token, uri, enabled) {
    const normalized = String(uri || "");
    if (!normalized || Buffer.byteLength(normalized, "utf8") > 8192) {
      throw new TypeError("MCP subscription URI must be bounded");
    }
    return this._mutate((store) => {
      const record = this._currentRecord(store, token);
      const subscriptions = new Set(record.subscriptions);
      if (enabled) {
        if (
          subscriptions.size >= MAX_SUBSCRIPTIONS &&
          !subscriptions.has(normalized)
        ) {
          throw lifecycleError(
            MCP_LIFECYCLE_ERROR_CODES.BACKPRESSURE,
            "MCP lifecycle subscription capacity is full",
          );
        }
        subscriptions.add(normalized);
      } else {
        subscriptions.delete(normalized);
      }
      record.subscriptions = [...subscriptions].sort();
      appendReceipt(record, {
        type: enabled ? "subscription-added" : "subscription-removed",
        uriDigest: sha256(normalized),
        generation: record.generation,
        atMs: finiteTime(this._now(), "now"),
      });
      return [...record.subscriptions];
    });
  }

  clearSubscriptions(token) {
    return this._mutate((store) => {
      const record = this._currentRecord(store, token);
      const cleared = record.subscriptions.length;
      record.subscriptions = [];
      if (cleared > 0) {
        appendReceipt(record, {
          type: "subscriptions-cleared",
          count: cleared,
          generation: record.generation,
          atMs: finiteTime(this._now(), "now"),
        });
      }
      return cleared;
    });
  }

  desiredSubscriptions(token) {
    const store = this._read();
    const record = this._currentRecord(store, token);
    return [...record.subscriptions];
  }

  snapshot({ name, sessionId = "default" }) {
    const store = this._read();
    const record = store.servers[serverKey(sessionId, name)];
    return record ? publicRecord(record) : null;
  }

  snapshotAll() {
    return structuredClone(this._read());
  }
}

export const MCP_LIFECYCLE_AUTHORITY_LIMITS = Object.freeze({
  maxServers: MAX_SERVERS,
  maxReceipts: MAX_RECEIPTS,
  maxPendingRpc: MAX_PENDING_RPC,
  maxSettledRpc: MAX_SETTLED_RPC,
  maxSubscriptions: MAX_SUBSCRIPTIONS,
});
