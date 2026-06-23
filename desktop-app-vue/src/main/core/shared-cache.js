/**
 * @module core/shared-cache
 * Phase 79: Cross-module shared LRU cache with TTL
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class SharedCacheManager extends EventEmitter {
  constructor() {
    super();
    this._namespaces = new Map();
    this._stats = { hits: 0, misses: 0, evictions: 0 };
    this._cleanupInterval = null;
  }

  initialize() {
    if (this._cleanupInterval) {
      return;
    }
    this._cleanupInterval = setInterval(() => this._cleanup(), 60000);
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
    logger.info("[SharedCache] Initialized with 60s cleanup interval");
  }

  createNamespace(name, options = {}) {
    if (this._namespaces.has(name)) {
      return this._namespaces.get(name);
    }

    const ns = {
      name,
      maxSize: options.maxSize || 1000,
      defaultTTL: options.defaultTTL || 300000, // 5 min
      // A Map preserves insertion order, so it IS the LRU order — the first key
      // is the least-recently-used (eviction candidate), the last is the most
      // recent. Bumping a key to MRU is delete()+set(); there is no separate
      // `order` array to keep in sync (which cost O(n) indexOf+splice per op).
      entries: new Map(),
      stats: { hits: 0, misses: 0, evictions: 0, sets: 0 },
    };
    this._namespaces.set(name, ns);
    return ns;
  }

  set(namespace, key, value, ttl) {
    const ns = this._namespaces.get(namespace);
    if (!ns) {
      this.createNamespace(namespace);
      return this.set(namespace, key, value, ttl);
    }

    const expiresAt = Date.now() + (ttl || ns.defaultTTL);

    // Evict if at capacity (only when adding a genuinely new key)
    if (!ns.entries.has(key) && ns.entries.size >= ns.maxSize) {
      this._evictOldest(ns);
    }

    // delete()+set() re-inserts the key at the end of the Map = most-recently-
    // used. (A bare set() on an existing key keeps its old position.)
    ns.entries.delete(key);
    ns.entries.set(key, { value, expiresAt, createdAt: Date.now() });

    ns.stats.sets++;
  }

  get(namespace, key) {
    const ns = this._namespaces.get(namespace);
    if (!ns) {
      this._stats.misses++;
      return undefined;
    }

    const entry = ns.entries.get(key);
    if (!entry) {
      ns.stats.misses++;
      this._stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      ns.entries.delete(key);
      ns.stats.misses++;
      this._stats.misses++;
      return undefined;
    }

    // Move to the most-recently-used position (delete()+set() on the Map).
    ns.entries.delete(key);
    ns.entries.set(key, entry);

    ns.stats.hits++;
    this._stats.hits++;
    return entry.value;
  }

  has(namespace, key) {
    // Read-only existence check. Must NOT delegate to get(): get() mutates
    // hit/miss stats and bumps the key to the end of the LRU order, so an
    // existence check would pollute cache metrics and keep has()-only keys from
    // ever being evicted.
    const ns = this._namespaces.get(namespace);
    if (!ns) {
      return false;
    }
    const entry = ns.entries.get(key);
    if (!entry) {
      return false;
    }
    return Date.now() <= entry.expiresAt;
  }

  delete(namespace, key) {
    const ns = this._namespaces.get(namespace);
    if (!ns) {
      return false;
    }
    const existed = ns.entries.delete(key);
    return existed;
  }

  clearNamespace(namespace) {
    const ns = this._namespaces.get(namespace);
    if (!ns) {
      return;
    }
    ns.entries.clear();
  }

  _evictOldest(ns) {
    if (ns.entries.size === 0) {
      return;
    }
    // First key in Map iteration order is the least-recently-used.
    const oldest = ns.entries.keys().next().value;
    ns.entries.delete(oldest);
    ns.stats.evictions++;
    this._stats.evictions++;
    this.emit("cache:eviction", { namespace: ns.name, key: oldest });
  }

  _cleanup() {
    const now = Date.now();
    for (const [, ns] of this._namespaces) {
      const expired = [];
      for (const [key, entry] of ns.entries) {
        if (now > entry.expiresAt) {
          expired.push(key);
        }
      }
      for (const key of expired) {
        ns.entries.delete(key);
      }
    }
  }

  getStats() {
    const namespaceStats = {};
    for (const [name, ns] of this._namespaces) {
      namespaceStats[name] = {
        size: ns.entries.size,
        maxSize: ns.maxSize,
        ...ns.stats,
      };
    }
    return { global: this._stats, namespaces: namespaceStats };
  }

  destroy() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    this._namespaces.clear();
  }
}

let instance = null;
function getSharedCacheManager() {
  if (!instance) {
    instance = new SharedCacheManager();
  }
  return instance;
}

module.exports = { SharedCacheManager, getSharedCacheManager };
