/**
 * Host-owned, content-free resource accounting for long-running agent hosts.
 *
 * This is intentionally separate from a provider/session budget: it applies
 * backpressure to host queues and caches before work is admitted, while an
 * optional SessionResourceBudget remains the shared authority for tool time.
 * Queue slots retain only opaque identifiers, never renderer/event payloads.
 */

import { randomUUID } from "node:crypto";

export const HOST_BACKLOG_KINDS = Object.freeze(["renderer", "tool", "event"]);

export const DEFAULT_HOST_RESOURCE_LIMITS = Object.freeze({
  webFetchTtlMs: 60_000,
  maxWebFetchEntries: 32,
  maxWebFetchBytes: 8 * 1024 * 1024,
  maxWebSearchResults: 20,
  maxRendererBacklog: 64,
  maxToolBacklog: 32,
  maxEventBacklog: 256,
});

const BACKLOG_LIMIT_FIELDS = Object.freeze({
  renderer: "maxRendererBacklog",
  tool: "maxToolBacklog",
  event: "maxEventBacklog",
});

function normalizeNonNegativeInteger(field, value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`invalid host resource budget limit: ${field}`);
  }
  return normalized;
}

function normalizePositiveInteger(field, value) {
  const normalized = normalizeNonNegativeInteger(field, value);
  if (normalized < 1) {
    throw new TypeError(`invalid host resource budget limit: ${field}`);
  }
  return normalized;
}

function cloneCacheValue(value) {
  // WebFetch produces JSON-compatible values. structuredClone retains arrays
  // and JSON output without allowing callers to mutate the retained cache.
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function cacheValueBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export class HostResourceBudgetError extends Error {
  constructor(reason, message = null) {
    super(message || `Host resource budget exhausted: ${reason}`);
    this.name = "HostResourceBudgetError";
    this.code = "ERR_HOST_RESOURCE_BUDGET";
    this.budgetReason = reason;
    this.retryable = false;
  }
}

/**
 * A host creates one instance per interactive/headless run and passes it to
 * tool adapters. Slots represent work waiting to be rendered, completed, or
 * delivered; callers must release them once their consumer has drained it.
 */
export class HostResourceBudget {
  constructor({
    sessionBudget = null,
    webFetchTtlMs = DEFAULT_HOST_RESOURCE_LIMITS.webFetchTtlMs,
    maxWebFetchEntries = DEFAULT_HOST_RESOURCE_LIMITS.maxWebFetchEntries,
    maxWebFetchBytes = DEFAULT_HOST_RESOURCE_LIMITS.maxWebFetchBytes,
    maxWebSearchResults = DEFAULT_HOST_RESOURCE_LIMITS.maxWebSearchResults,
    maxRendererBacklog = DEFAULT_HOST_RESOURCE_LIMITS.maxRendererBacklog,
    maxToolBacklog = DEFAULT_HOST_RESOURCE_LIMITS.maxToolBacklog,
    maxEventBacklog = DEFAULT_HOST_RESOURCE_LIMITS.maxEventBacklog,
    now = () => Date.now(),
  } = {}) {
    if (
      sessionBudget !== null &&
      (typeof sessionBudget !== "object" ||
        typeof sessionBudget.beginTool !== "function")
    ) {
      throw new TypeError("sessionBudget must provide beginTool()");
    }
    if (typeof now !== "function") {
      throw new TypeError("host resource budget now must be a function");
    }

    this._sessionBudget = sessionBudget;
    this._now = now;
    this.webFetchTtlMs = normalizeNonNegativeInteger(
      "webFetchTtlMs",
      webFetchTtlMs,
    );
    this.maxWebFetchEntries = normalizeNonNegativeInteger(
      "maxWebFetchEntries",
      maxWebFetchEntries,
    );
    this.maxWebFetchBytes = normalizeNonNegativeInteger(
      "maxWebFetchBytes",
      maxWebFetchBytes,
    );
    this.maxWebSearchResults = normalizePositiveInteger(
      "maxWebSearchResults",
      maxWebSearchResults,
    );
    this._backlogs = new Map(
      HOST_BACKLOG_KINDS.map((kind) => [
        kind,
        {
          max: normalizeNonNegativeInteger(
            BACKLOG_LIMIT_FIELDS[kind],
            {
              maxRendererBacklog,
              maxToolBacklog,
              maxEventBacklog,
            }[BACKLOG_LIMIT_FIELDS[kind]],
          ),
          slots: new Set(),
        },
      ]),
    );
    this._webFetchCache = new Map();
    this._webFetchCacheBytes = 0;
  }

  _backlog(kind) {
    const backlog = this._backlogs.get(kind);
    if (!backlog) throw new TypeError(`invalid host backlog kind: ${kind}`);
    return backlog;
  }

  admit(kind) {
    const backlog = this._backlog(kind);
    if (backlog.slots.size >= backlog.max) {
      throw new HostResourceBudgetError(`${kind}-backlog`);
    }
    const id = `host-${kind}-${randomUUID()}`;
    backlog.slots.add(id);
    let released = false;
    return Object.freeze({
      id,
      kind,
      release: () => {
        if (released) return false;
        released = true;
        return backlog.slots.delete(id);
      },
    });
  }

  admitRenderer() {
    return this.admit("renderer");
  }

  admitEvent() {
    return this.admit("event");
  }

  admitTool({ kind = "tool" } = {}) {
    const slot = this.admit("tool");
    let sessionLease = null;
    try {
      if (this._sessionBudget) {
        const admission = this._sessionBudget.beginTool({
          id: `host-tool-${randomUUID()}`,
          kind: String(kind || "tool"),
        });
        if (!admission?.ok) {
          throw new HostResourceBudgetError(
            `session-${admission?.reason || "tool-admission"}`,
          );
        }
        sessionLease = admission;
      }
    } catch (error) {
      slot.release();
      throw error;
    }

    let released = false;
    return Object.freeze({
      ...slot,
      release: () => {
        if (released) return false;
        released = true;
        try {
          sessionLease?.end();
        } catch {
          // A session may already be aborting when a completed host I/O task
          // releases its slot. The authoritative abort is preserved, while
          // this cleanup must still make the bounded host slot reusable.
        } finally {
          slot.release();
        }
        return true;
      },
    });
  }

  capWebSearchResults(value) {
    const requested = normalizePositiveInteger("webSearchResults", value);
    return Math.min(requested, this.maxWebSearchResults);
  }

  _expireWebFetch(now = this._now()) {
    for (const [key, entry] of this._webFetchCache) {
      if (entry.expiresAt > now) continue;
      this._webFetchCache.delete(key);
      this._webFetchCacheBytes -= entry.bytes;
    }
  }

  getWebFetch(key) {
    if (typeof key !== "string" || key.length === 0) return null;
    this._expireWebFetch();
    const entry = this._webFetchCache.get(key);
    if (!entry) return null;
    // Map insertion order gives us a bounded LRU cache without retaining any
    // user-provided key outside the configured entry/byte ceilings.
    this._webFetchCache.delete(key);
    this._webFetchCache.set(key, entry);
    return cloneCacheValue(entry.value);
  }

  putWebFetch(key, value) {
    if (
      this.webFetchTtlMs === 0 ||
      this.maxWebFetchEntries === 0 ||
      this.maxWebFetchBytes === 0 ||
      typeof key !== "string" ||
      key.length === 0
    ) {
      return false;
    }
    const copy = cloneCacheValue(value);
    const bytes = cacheValueBytes(copy);
    if (bytes > this.maxWebFetchBytes) return false;
    this._expireWebFetch();
    const previous = this._webFetchCache.get(key);
    if (previous) {
      this._webFetchCache.delete(key);
      this._webFetchCacheBytes -= previous.bytes;
    }
    while (
      this._webFetchCache.size >= this.maxWebFetchEntries ||
      this._webFetchCacheBytes + bytes > this.maxWebFetchBytes
    ) {
      const oldest = this._webFetchCache.entries().next().value;
      if (!oldest) break;
      const [oldestKey, oldestEntry] = oldest;
      this._webFetchCache.delete(oldestKey);
      this._webFetchCacheBytes -= oldestEntry.bytes;
    }
    this._webFetchCache.set(key, {
      expiresAt: this._now() + this.webFetchTtlMs,
      bytes,
      value: copy,
    });
    this._webFetchCacheBytes += bytes;
    return true;
  }

  status() {
    this._expireWebFetch();
    const backlog = Object.fromEntries(
      [...this._backlogs.entries()].map(([kind, state]) => [
        kind,
        { active: state.slots.size, max: state.max },
      ]),
    );
    return Object.freeze({
      limits: Object.freeze({
        webFetchTtlMs: this.webFetchTtlMs,
        maxWebFetchEntries: this.maxWebFetchEntries,
        maxWebFetchBytes: this.maxWebFetchBytes,
        maxWebSearchResults: this.maxWebSearchResults,
        maxRendererBacklog: backlog.renderer.max,
        maxToolBacklog: backlog.tool.max,
        maxEventBacklog: backlog.event.max,
      }),
      backlog: Object.freeze(backlog),
      webFetchCache: Object.freeze({
        entries: this._webFetchCache.size,
        bytes: this._webFetchCacheBytes,
      }),
    });
  }
}
