import { createHash } from "node:crypto";
import { McpEffect, normalizeMcpEffectContract } from "./mcp-call-ledger.js";

export const MCP_CONFLICT_SCHEDULER_SCHEMA_VERSION = 1;

export const McpConflictReason = Object.freeze({
  NONE: "none",
  SAME_SCOPE_MAY_WRITE: "same-scope-may-write",
  MUTATING_EFFECT_SERIALIZED: "mutating-effect-serialized",
  UNKNOWN_EFFECT_SERIALIZED: "unknown-effect-serialized",
  UNTRUSTED_CONTRACT_SERIALIZED: "untrusted-contract-serialized",
  OPEN_WORLD_SERIALIZED: "open-world-serialized",
  MISSING_SCOPE_SERIALIZED: "missing-scope-serialized",
});

const HOST_EFFECT_CONTRACTS = new WeakSet();
const NORMALIZED_CONCURRENCY_REQUESTS = new WeakSet();

function stableHash(parts) {
  const hash = createHash("sha256");
  for (const part of parts) {
    const value = String(part);
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update("\0");
    hash.update(value);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Brand a contract at the host boundary. A plain object from a model or MCP
 * server cannot self-declare itself safe for parallel execution, even if it
 * copies every visible field from this object.
 */
export function createHostOwnedMcpEffectContract(contract = {}) {
  const normalized = normalizeMcpEffectContract(contract);
  const hostContract = Object.freeze({
    ...normalized,
    authority: "host",
  });
  HOST_EFFECT_CONTRACTS.add(hostContract);
  return hostContract;
}

export function isHostOwnedMcpEffectContract(contract) {
  return Boolean(
    contract &&
    typeof contract === "object" &&
    HOST_EFFECT_CONTRACTS.has(contract),
  );
}

function scopeValue(scope) {
  if (typeof scope === "string") return scope;
  if (!scope || typeof scope !== "object") return "";
  return scope.uri || scope.path || scope.id || scope.name || "";
}

function normalizeResourceScope(scope) {
  let value = String(scopeValue(scope) || "").trim();
  if (!value) return null;
  value = value.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(value)) {
    value = `${value[0].toLowerCase()}${value.slice(1)}`;
  }
  return `resource:${value}`;
}

function normalizeNetworkScope(scope) {
  const value = String(scopeValue(scope) || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (!url.hostname) return null;
    const authority = `${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}`;
    return `network:${url.protocol}//${authority}`;
  } catch {
    const authority = value
      .replace(/^.*@/, "")
      .split(/[/?#]/, 1)[0]
      .toLowerCase();
    return authority ? `network:${authority}` : null;
  }
}

function normalizeScopes(scopes, normalize) {
  if (!Array.isArray(scopes)) return [];
  return [...new Set(scopes.map(normalize).filter(Boolean))].sort();
}

function serialReason(descriptor) {
  if (!descriptor.hostOwned || descriptor.effectContract.trusted !== true) {
    return McpConflictReason.UNTRUSTED_CONTRACT_SERIALIZED;
  }
  if (descriptor.effectContract.effect === McpEffect.UNKNOWN) {
    return McpConflictReason.UNKNOWN_EFFECT_SERIALIZED;
  }
  if (
    descriptor.effectContract.effect === McpEffect.WRITE ||
    descriptor.effectContract.effect === McpEffect.DESTRUCTIVE ||
    descriptor.effectContract.sideEffecting === true
  ) {
    return McpConflictReason.MUTATING_EFFECT_SERIALIZED;
  }
  if (descriptor.effectContract.openWorld !== false) {
    return McpConflictReason.OPEN_WORLD_SERIALIZED;
  }
  if (descriptor.scopeKeys.length === 0) {
    return McpConflictReason.MISSING_SCOPE_SERIALIZED;
  }
  return null;
}

/** Normalize one scheduler request without retaining arbitrary input payloads. */
export function normalizeMcpConcurrencyRequest(request = {}, options = {}) {
  const rawContract = request.effectContract || {};
  const isHostOwned =
    options.isHostOwnedContract || isHostOwnedMcpEffectContract;
  const effectContract = normalizeMcpEffectContract(rawContract);
  const resourceScopeKeys = normalizeScopes(
    request.resourceScopes,
    normalizeResourceScope,
  );
  const networkScopeKeys = normalizeScopes(
    request.networkScopes,
    normalizeNetworkScope,
  );
  const scopeKeys = [...resourceScopeKeys, ...networkScopeKeys].sort();
  const descriptor = {
    schemaVersion: MCP_CONFLICT_SCHEDULER_SCHEMA_VERSION,
    hostOwned: isHostOwned(rawContract) === true,
    effectContract,
    resourceScopeKeys,
    networkScopeKeys,
    scopeKeys,
  };
  descriptor.serialReason = serialReason(descriptor);
  descriptor.parallelReadEligible = descriptor.serialReason === null;
  descriptor.stableKey = `mcp-scope:${stableHash([
    descriptor.hostOwned,
    effectContract.effect,
    effectContract.readOnly,
    effectContract.sideEffecting,
    effectContract.destructive,
    effectContract.idempotent,
    effectContract.openWorld,
    effectContract.trusted,
    ...scopeKeys,
  ])}`;

  Object.freeze(resourceScopeKeys);
  Object.freeze(networkScopeKeys);
  Object.freeze(scopeKeys);
  Object.freeze(descriptor);
  NORMALIZED_CONCURRENCY_REQUESTS.add(descriptor);
  return descriptor;
}

export function isNormalizedMcpConcurrencyRequest(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    NORMALIZED_CONCURRENCY_REQUESTS.has(value),
  );
}

function sharedScopes(left, right) {
  const rightScopes = new Set(right.scopeKeys);
  return left.scopeKeys.filter((scope) => rightScopes.has(scope));
}

function mayWrite(descriptor) {
  return (
    descriptor.effectContract.effect !== McpEffect.READ ||
    descriptor.effectContract.sideEffecting === true ||
    descriptor.effectContract.destructive === true
  );
}

function reasonText(code, details = {}) {
  switch (code) {
    case McpConflictReason.SAME_SCOPE_MAY_WRITE:
      return `Calls share ${details.sharedScopes.join(", ")} and at least one may write.`;
    case McpConflictReason.MUTATING_EFFECT_SERIALIZED:
      return "A write or destructive MCP effect is conservatively serialized.";
    case McpConflictReason.UNKNOWN_EFFECT_SERIALIZED:
      return "An unknown MCP effect is conservatively serialized.";
    case McpConflictReason.UNTRUSTED_CONTRACT_SERIALIZED:
      return "A non-host-owned or untrusted effect contract cannot authorize parallel execution.";
    case McpConflictReason.OPEN_WORLD_SERIALIZED:
      return "Open-world status was not explicitly ruled out by the host contract.";
    case McpConflictReason.MISSING_SCOPE_SERIALIZED:
      return "A scoped parallel read requires at least one resource or network scope.";
    default:
      return "Both calls are trusted, scoped, closed-world reads.";
  }
}

/**
 * Explain whether two calls may overlap. Any non-read descriptor is a global
 * serial barrier; shared-scope writes receive a more specific diagnostic.
 */
export function explainMcpConcurrency(leftRequest, rightRequest, options = {}) {
  const left = isNormalizedMcpConcurrencyRequest(leftRequest)
    ? leftRequest
    : normalizeMcpConcurrencyRequest(leftRequest, options);
  const right = isNormalizedMcpConcurrencyRequest(rightRequest)
    ? rightRequest
    : normalizeMcpConcurrencyRequest(rightRequest, options);
  const overlap = sharedScopes(left, right);
  let reasonCode = McpConflictReason.NONE;

  if (overlap.length > 0 && (mayWrite(left) || mayWrite(right))) {
    reasonCode = McpConflictReason.SAME_SCOPE_MAY_WRITE;
  } else if (!left.parallelReadEligible) {
    reasonCode = left.serialReason;
  } else if (!right.parallelReadEligible) {
    reasonCode = right.serialReason;
  }

  const conflict = reasonCode !== McpConflictReason.NONE;
  const pairKeys = [left.stableKey, right.stableKey].sort();
  return Object.freeze({
    conflict,
    canRunInParallel: !conflict,
    reasonCode,
    reason: reasonText(reasonCode, { sharedScopes: overlap }),
    stableKey: `mcp-conflict:${stableHash(pairKeys)}`,
    leftKey: left.stableKey,
    rightKey: right.stableKey,
    sharedScopes: Object.freeze(overlap),
  });
}

export class McpSchedulerAbortError extends Error {
  constructor(message = "MCP scheduler request aborted", details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "AbortError";
    this.code = "CC_MCP_SCHEDULER_ABORTED";
    this.requestId = details.requestId || null;
  }
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return number;
}

/**
 * Bounded FIFO conflict scheduler. Later reads never bypass an earlier queued
 * write/unknown barrier, preventing a continuous read stream from starving it.
 */
export class McpConflictScheduler {
  constructor(options = {}) {
    this.maxActive = positiveInteger(options.maxActive, 16, "maxActive");
    this.maxQueue = positiveInteger(options.maxQueue, 128, "maxQueue");
    this._now = options.now || (() => new Date());
    this._isHostOwnedContract =
      options.isHostOwnedContract || isHostOwnedMcpEffectContract;
    this._queue = [];
    this._active = new Map();
    this._sequence = 0;
  }

  _timestamp() {
    const value = this._now();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError("MCP scheduler clock returned an invalid timestamp");
    }
    return date.toISOString();
  }

  _nextRequestId() {
    this._sequence += 1;
    return `mcp-lock-${this._sequence.toString(36)}`;
  }

  acquire(request = {}, options = {}) {
    const requestId = this._nextRequestId();
    const signal = options.signal || null;
    if (signal?.aborted) {
      return Promise.reject(
        new McpSchedulerAbortError(
          "MCP scheduler request was already aborted",
          {
            requestId,
            cause: signal.reason,
          },
        ),
      );
    }
    if (this._queue.length >= this.maxQueue) {
      const error = new Error(
        `MCP scheduler queue is full (${this.maxQueue} waiting requests)`,
      );
      error.code = "CC_MCP_SCHEDULER_QUEUE_FULL";
      error.requestId = requestId;
      return Promise.reject(error);
    }

    const descriptor = normalizeMcpConcurrencyRequest(request, {
      isHostOwnedContract: this._isHostOwnedContract,
    });
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const entry = {
        requestId,
        descriptor,
        controller,
        resolve,
        reject,
        status: "queued",
        queuedAt: this._timestamp(),
        acquiredAt: null,
        externalSignal: signal,
        externalAbort: null,
      };
      if (signal) {
        entry.externalAbort = () => {
          this.abort(requestId, signal.reason);
        };
        signal.addEventListener("abort", entry.externalAbort, { once: true });
      }
      this._queue.push(entry);
      this._drain();
    });
  }

  _conflictsWithActive(descriptor) {
    for (const active of this._active.values()) {
      const explanation = explainMcpConcurrency(descriptor, active.descriptor, {
        isHostOwnedContract: this._isHostOwnedContract,
      });
      if (explanation.conflict) return explanation;
    }
    return null;
  }

  _drain() {
    while (this._queue.length > 0 && this._active.size < this.maxActive) {
      // Strict head-of-line ordering is intentional: a queued writer/unknown
      // barrier cannot be bypassed indefinitely by later compatible reads.
      const entry = this._queue[0];
      if (this._conflictsWithActive(entry.descriptor)) return;
      this._queue.shift();
      entry.status = "active";
      entry.acquiredAt = this._timestamp();
      this._active.set(entry.requestId, entry);
      entry.resolve(this._createLease(entry));
    }
  }

  _createLease(entry) {
    const scheduler = this;
    return Object.freeze({
      requestId: entry.requestId,
      stableKey: entry.descriptor.stableKey,
      descriptor: entry.descriptor,
      acquiredAt: entry.acquiredAt,
      signal: entry.controller.signal,
      release() {
        return scheduler.release(entry.requestId);
      },
      abort(reason) {
        return scheduler.abort(entry.requestId, reason);
      },
    });
  }

  _detachExternalAbort(entry) {
    if (entry?.externalSignal && entry.externalAbort) {
      entry.externalSignal.removeEventListener("abort", entry.externalAbort);
    }
  }

  release(leaseOrRequestId) {
    const requestId =
      typeof leaseOrRequestId === "string"
        ? leaseOrRequestId
        : leaseOrRequestId?.requestId;
    const entry = this._active.get(String(requestId || ""));
    if (!entry) return false;
    this._active.delete(entry.requestId);
    entry.status = "released";
    this._detachExternalAbort(entry);
    this._drain();
    return true;
  }

  abort(leaseOrRequestId, reason = undefined) {
    const requestId =
      typeof leaseOrRequestId === "string"
        ? leaseOrRequestId
        : leaseOrRequestId?.requestId;
    const key = String(requestId || "");
    const queuedIndex = this._queue.findIndex(
      (entry) => entry.requestId === key,
    );
    if (queuedIndex >= 0) {
      const [entry] = this._queue.splice(queuedIndex, 1);
      entry.status = "aborted";
      this._detachExternalAbort(entry);
      entry.controller.abort(reason);
      entry.reject(
        new McpSchedulerAbortError("Queued MCP scheduler request aborted", {
          requestId: entry.requestId,
          cause: reason,
        }),
      );
      this._drain();
      return true;
    }

    const active = this._active.get(key);
    if (!active) return false;
    if (active.controller.signal.aborted) return false;
    // AbortSignal delivery is advisory. Keep the conflict lock active until
    // the caller observes cancellation and releases in its finally block; an
    // immediate unlock could overlap a new writer with work still winding down.
    active.controller.abort(reason);
    active.status = "aborting";
    this._detachExternalAbort(active);
    return true;
  }

  explain(left, right) {
    return explainMcpConcurrency(left, right, {
      isHostOwnedContract: this._isHostOwnedContract,
    });
  }

  snapshot() {
    return Object.freeze({
      active: this._active.size,
      queued: this._queue.length,
      maxActive: this.maxActive,
      maxQueue: this.maxQueue,
      activeRequests: Object.freeze(
        [...this._active.values()].map((entry) =>
          Object.freeze({
            requestId: entry.requestId,
            stableKey: entry.descriptor.stableKey,
            acquiredAt: entry.acquiredAt,
          }),
        ),
      ),
      queuedRequests: Object.freeze(
        this._queue.map((entry) =>
          Object.freeze({
            requestId: entry.requestId,
            stableKey: entry.descriptor.stableKey,
            queuedAt: entry.queuedAt,
          }),
        ),
      ),
    });
  }
}

export function createMcpConflictScheduler(options = {}) {
  return new McpConflictScheduler(options);
}
