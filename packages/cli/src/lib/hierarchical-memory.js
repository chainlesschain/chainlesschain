/**
 * Hierarchical Memory 2.0 for CLI
 *
 * Four-layer memory system: working → short-term → long-term → core
 * with Ebbinghaus forgetting curve and spacing effect reinforcement.
 */

// ─── Configuration ───────────────────────────────────────────────
export const MEMORY_CONFIG = {
  workingCapacity: 50,
  shortTermCapacity: 500,
  longTermCapacity: 10000,
  forgettingRate: 0.1,
  recallThreshold: 0.3,
};

// ─── In-memory layers ────────────────────────────────────────────
// Internal storage: Map<namespace, Map<id, entry>>
// Default namespace "global" preserves backward compatibility.
const _workingNS = new Map();
const _shortTermNS = new Map();
const DEFAULT_NS = "global";

function _getWorkingNS(namespace) {
  const ns = namespace || DEFAULT_NS;
  if (!_workingNS.has(ns)) _workingNS.set(ns, new Map());
  return _workingNS.get(ns);
}

function _getShortTermNS(namespace) {
  const ns = namespace || DEFAULT_NS;
  if (!_shortTermNS.has(ns)) _shortTermNS.set(ns, new Map());
  return _shortTermNS.get(ns);
}

// ─── Backward-compatible proxy ──────────────────────────────────
// Existing code (and tests) access _working/_shortTerm as flat Maps:
//   _working.size, _working.get(id), _working.clear(), _working.delete(id)
// We proxy these to the default namespace while exposing namespaced internals.
function _createCompatProxy(nsMap, getNS) {
  return {
    // Flat access — routes to default namespace
    get size() {
      const ns = getNS(DEFAULT_NS);
      return ns.size;
    },
    get(key) {
      const ns = getNS(DEFAULT_NS);
      return ns.get(key);
    },
    set(key, value) {
      const ns = getNS(DEFAULT_NS);
      return ns.set(key, value);
    },
    has(key) {
      const ns = getNS(DEFAULT_NS);
      return ns.has(key);
    },
    delete(key) {
      const ns = getNS(DEFAULT_NS);
      return ns.delete(key);
    },
    values() {
      const ns = getNS(DEFAULT_NS);
      return ns.values();
    },
    entries() {
      const ns = getNS(DEFAULT_NS);
      return ns.entries();
    },
    keys() {
      const ns = getNS(DEFAULT_NS);
      return ns.keys();
    },
    forEach(callback) {
      const ns = getNS(DEFAULT_NS);
      return ns.forEach(callback);
    },
    [Symbol.iterator]() {
      const ns = getNS(DEFAULT_NS);
      return ns[Symbol.iterator]();
    },
    // Clear ALL namespaces (for test cleanup)
    clear() {
      nsMap.clear();
    },
    // ─── Namespace-aware internals (used by this module) ──────
    _nsMap: nsMap,
    _getNS: getNS,
  };
}

export const _working = _createCompatProxy(_workingNS, _getWorkingNS);
export const _shortTerm = _createCompatProxy(_shortTermNS, _getShortTermNS);

// ─── Helpers ─────────────────────────────────────────────────────
function generateId() {
  return `hmem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Calculate retention using Ebbinghaus forgetting curve.
 * retention = e^(-decay_rate * age_hours)
 */
function calcRetention(
  createdOrAccessed,
  decayRate = MEMORY_CONFIG.forgettingRate,
) {
  const ageMs = Date.now() - new Date(createdOrAccessed).getTime();
  const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
  return Math.exp(-decayRate * ageHours);
}

// ─── Table setup ─────────────────────────────────────────────────

/**
 * Create persistent memory tables for long-term / core / sharing
 */
export function ensureMemoryTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_long_term (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'episodic',
      importance REAL DEFAULT 0.5,
      access_count INTEGER DEFAULT 0,
      retention REAL DEFAULT 1.0,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed TEXT DEFAULT (datetime('now')),
      layer TEXT DEFAULT 'long-term'
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_core (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'semantic',
      importance REAL DEFAULT 1.0,
      access_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_sharing (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      source_agent TEXT DEFAULT 'local',
      target_agent TEXT NOT NULL,
      privacy_level TEXT DEFAULT 'filtered',
      shared_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

// ─── Store ───────────────────────────────────────────────────────

/**
 * Store a memory at the appropriate layer based on importance.
 * core >= 0.9, long-term >= 0.6, short-term >= 0.3, working < 0.3
 */
/**
 * Store a memory at the appropriate layer based on importance.
 * core >= 0.9, long-term >= 0.6, short-term >= 0.3, working < 0.3
 *
 * @param {object} db - Database instance
 * @param {string} content - Memory content
 * @param {object} [options]
 * @param {number} [options.importance=0.5]
 * @param {string} [options.type="episodic"]
 * @param {string} [options.namespace] - Namespace for in-memory isolation (default: "global")
 */
export function storeMemory(db, content, options = {}) {
  if (!content || !content.trim()) {
    throw new Error("Memory content cannot be empty");
  }

  const importance = Math.max(
    0,
    Math.min(1, parseFloat(options.importance) || 0.5),
  );
  const type = options.type || "episodic";
  const namespace = options.namespace || DEFAULT_NS;
  const id = generateId();
  const now = nowISO();

  let layer;
  if (importance >= 0.9) {
    layer = "core";
    ensureMemoryTables(db);
    db.prepare(
      `INSERT INTO memory_core (id, content, type, importance, created_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, content, type, importance, now, now);
  } else if (importance >= 0.6) {
    layer = "long-term";
    ensureMemoryTables(db);
    db.prepare(
      `INSERT INTO memory_long_term (id, content, type, importance, layer, created_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, content, type, importance, "long-term", now, now);
  } else if (importance >= 0.3) {
    layer = "short-term";
    const nsMap = _getShortTermNS(namespace);
    if (nsMap.size >= MEMORY_CONFIG.shortTermCapacity) {
      // Evict oldest
      const oldest = [...nsMap.entries()].sort(
        (a, b) => new Date(a[1].lastAccessed) - new Date(b[1].lastAccessed),
      )[0];
      if (oldest) nsMap.delete(oldest[0]);
    }
    nsMap.set(id, {
      id,
      content,
      type,
      importance,
      accessCount: 0,
      createdAt: now,
      lastAccessed: now,
    });
  } else {
    layer = "working";
    const nsMap = _getWorkingNS(namespace);
    if (nsMap.size >= MEMORY_CONFIG.workingCapacity) {
      const oldest = [...nsMap.entries()].sort(
        (a, b) => new Date(a[1].lastAccessed) - new Date(b[1].lastAccessed),
      )[0];
      if (oldest) nsMap.delete(oldest[0]);
    }
    nsMap.set(id, {
      id,
      content,
      type,
      importance,
      accessCount: 0,
      createdAt: now,
      lastAccessed: now,
    });
  }

  return { id, layer };
}

// ─── Recall ──────────────────────────────────────────────────────

/**
 * Search all memory layers with Ebbinghaus forgetting curve.
 * Strengthens recalled memories (spacing effect).
 *
 * When options.namespace is set, searches that namespace's in-memory maps
 * plus the shared long-term/core DB layers. Without namespace, searches
 * the default "global" namespace (backward compatible).
 */
export function recallMemory(db, query, options = {}) {
  if (!query || !query.trim()) return [];

  const limit = Math.max(1, parseInt(options.limit) || 20);
  const pattern = query.toLowerCase();
  const namespace = options.namespace || DEFAULT_NS;
  const results = [];

  // Search working memory (namespace-scoped)
  const workingNS = _getWorkingNS(namespace);
  for (const mem of workingNS.values()) {
    if (mem.content.toLowerCase().includes(pattern)) {
      const retention = calcRetention(mem.lastAccessed);
      if (retention >= MEMORY_CONFIG.recallThreshold) {
        mem.accessCount++;
        mem.lastAccessed = nowISO();
        results.push({ ...mem, layer: "working", retention });
      }
    }
  }

  // Search short-term memory (namespace-scoped)
  const shortTermNS = _getShortTermNS(namespace);
  for (const mem of shortTermNS.values()) {
    if (mem.content.toLowerCase().includes(pattern)) {
      const retention = calcRetention(mem.lastAccessed);
      if (retention >= MEMORY_CONFIG.recallThreshold) {
        mem.accessCount++;
        mem.lastAccessed = nowISO();
        results.push({ ...mem, layer: "short-term", retention });
      }
    }
  }

  // Search long-term memory (DB)
  ensureMemoryTables(db);
  const ltRows = db
    .prepare(`SELECT * FROM memory_long_term WHERE content LIKE ? LIMIT ?`)
    .all(`%${query}%`, limit);
  for (const row of ltRows) {
    const retention = calcRetention(row.last_accessed);
    if (retention >= MEMORY_CONFIG.recallThreshold) {
      db.prepare(
        `UPDATE memory_long_term SET access_count = access_count + 1, last_accessed = ? WHERE id = ?`,
      ).run(nowISO(), row.id);
      results.push({
        id: row.id,
        content: row.content,
        type: row.type,
        importance: row.importance,
        accessCount: row.access_count + 1,
        createdAt: row.created_at,
        lastAccessed: nowISO(),
        layer: "long-term",
        retention,
      });
    }
  }

  // Search core memory (DB) — core memories don't decay
  const coreRows = db
    .prepare(`SELECT * FROM memory_core WHERE content LIKE ? LIMIT ?`)
    .all(`%${query}%`, limit);
  for (const row of coreRows) {
    db.prepare(
      `UPDATE memory_core SET access_count = access_count + 1, last_accessed = ? WHERE id = ?`,
    ).run(nowISO(), row.id);
    results.push({
      id: row.id,
      content: row.content,
      type: row.type,
      importance: row.importance,
      accessCount: row.access_count + 1,
      createdAt: row.created_at,
      lastAccessed: nowISO(),
      layer: "core",
      retention: 1.0,
    });
  }

  // Sort by retention * importance descending
  results.sort(
    (a, b) => b.retention * b.importance - a.retention * a.importance,
  );
  return results.slice(0, limit);
}

// ─── Consolidate ─────────────────────────────────────────────────

/**
 * Promote memories up the hierarchy and forget stale entries.
 * working → short-term (accessCount >= 3)
 * short-term → long-term (accessCount >= 5)
 * Forget entries below recall threshold.
 */
export function consolidateMemory(db) {
  ensureMemoryTables(db);
  let promoted = 0;
  let forgotten = 0;

  // Promote working → short-term (across all namespaces)
  for (const [ns, nsMap] of _workingNS) {
    const shortTermNS = _getShortTermNS(ns);
    for (const [id, mem] of nsMap) {
      const retention = calcRetention(mem.lastAccessed);
      if (retention < MEMORY_CONFIG.recallThreshold) {
        nsMap.delete(id);
        forgotten++;
      } else if (mem.accessCount >= 3) {
        nsMap.delete(id);
        shortTermNS.set(id, { ...mem, lastAccessed: nowISO() });
        promoted++;
      }
    }
  }

  // Promote short-term → long-term (across all namespaces)
  for (const [, nsMap] of _shortTermNS) {
    for (const [id, mem] of nsMap) {
      const retention = calcRetention(mem.lastAccessed);
      if (retention < MEMORY_CONFIG.recallThreshold) {
        nsMap.delete(id);
        forgotten++;
      } else if (mem.accessCount >= 5) {
        nsMap.delete(id);
        const now = nowISO();
        db.prepare(
          `INSERT INTO memory_long_term (id, content, type, importance, access_count, layer, created_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          mem.content,
          mem.type,
          mem.importance,
          mem.accessCount,
          "long-term",
          mem.createdAt,
          now,
        );
        promoted++;
      }
    }
  }

  return { promoted, forgotten };
}

// ─── Episodic / Semantic search ──────────────────────────────────

/**
 * Search episodic-type memories across all layers
 */
export function searchEpisodic(db, query, options = {}) {
  return _searchByType(db, query, "episodic", options);
}

/**
 * Search semantic-type memories across all layers
 */
export function searchSemantic(db, query, options = {}) {
  return _searchByType(db, query, "semantic", options);
}

function _searchByType(db, query, type, options = {}) {
  if (!query || !query.trim()) return [];

  const limit = Math.max(1, parseInt(options.limit) || 20);
  const pattern = query.toLowerCase();
  const results = [];

  // In-memory layers (search all namespaces)
  for (const [, nsMap] of _workingNS) {
    for (const mem of nsMap.values()) {
      if (mem.type === type && mem.content.toLowerCase().includes(pattern)) {
        results.push({ ...mem, layer: "working" });
      }
    }
  }
  for (const [, nsMap] of _shortTermNS) {
    for (const mem of nsMap.values()) {
      if (mem.type === type && mem.content.toLowerCase().includes(pattern)) {
        results.push({ ...mem, layer: "short-term" });
      }
    }
  }

  // DB layers
  ensureMemoryTables(db);
  const ltRows = db
    .prepare(
      `SELECT * FROM memory_long_term WHERE type = ? AND content LIKE ? LIMIT ?`,
    )
    .all(type, `%${query}%`, limit);
  for (const row of ltRows) {
    results.push({
      id: row.id,
      content: row.content,
      type: row.type,
      importance: row.importance,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      layer: "long-term",
    });
  }

  const coreRows = db
    .prepare(
      `SELECT * FROM memory_core WHERE type = ? AND content LIKE ? LIMIT ?`,
    )
    .all(type, `%${query}%`, limit);
  for (const row of coreRows) {
    results.push({
      id: row.id,
      content: row.content,
      type: row.type,
      importance: row.importance,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      layer: "core",
    });
  }

  return results.slice(0, limit);
}

// ─── Sharing ─────────────────────────────────────────────────────

/**
 * Share a memory with another agent
 */
export function shareMemory(
  db,
  memoryId,
  targetAgentId,
  privacyLevel = "filtered",
) {
  ensureMemoryTables(db);

  if (!memoryId || !targetAgentId) {
    throw new Error("memoryId and targetAgentId are required");
  }

  const id = `share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO memory_sharing (id, memory_id, target_agent, privacy_level) VALUES (?, ?, ?, ?)`,
  ).run(id, memoryId, targetAgentId, privacyLevel);

  return { id, memoryId, targetAgentId, privacyLevel };
}

// ─── Prune ───────────────────────────────────────────────────────

/**
 * Remove weak old memories from all layers
 */
export function pruneMemory(db, options = {}) {
  ensureMemoryTables(db);
  const maxAgeHours = parseFloat(options.maxAge) || 720; // 30 days default
  let pruned = 0;

  // Prune in-memory layers by retention (across all namespaces)
  for (const [, nsMap] of _workingNS) {
    for (const [id, mem] of nsMap) {
      const retention = calcRetention(mem.lastAccessed);
      if (retention < MEMORY_CONFIG.recallThreshold) {
        nsMap.delete(id);
        pruned++;
      }
    }
  }
  for (const [, nsMap] of _shortTermNS) {
    for (const [id, mem] of nsMap) {
      const retention = calcRetention(mem.lastAccessed);
      if (retention < MEMORY_CONFIG.recallThreshold) {
        nsMap.delete(id);
        pruned++;
      }
    }
  }

  // Prune long-term DB entries older than maxAge with low access
  const cutoff = new Date(
    Date.now() - maxAgeHours * 60 * 60 * 1000,
  ).toISOString();
  const result = db
    .prepare(
      `DELETE FROM memory_long_term WHERE last_accessed < ? AND access_count < 3 AND importance < 0.5`,
    )
    .run(cutoff);
  pruned += result.changes;

  return { pruned };
}

// ─── Stats ───────────────────────────────────────────────────────

/**
 * Return memory counts per layer
 */
export function getMemoryStats(db) {
  ensureMemoryTables(db);

  const ltCount = db
    .prepare(`SELECT COUNT(*) as count FROM memory_long_term`)
    .get();
  const coreCount = db
    .prepare(`SELECT COUNT(*) as count FROM memory_core`)
    .get();
  const shareCount = db
    .prepare(`SELECT COUNT(*) as count FROM memory_sharing`)
    .get();

  // Sum across all namespaces
  let workingTotal = 0;
  for (const [, nsMap] of _workingNS) workingTotal += nsMap.size;
  let shortTermTotal = 0;
  for (const [, nsMap] of _shortTermNS) shortTermTotal += nsMap.size;

  return {
    working: workingTotal,
    shortTerm: shortTermTotal,
    longTerm: ltCount.count,
    core: coreCount.count,
    shared: shareCount.count,
    namespaces: {
      working: [..._workingNS.keys()],
      shortTerm: [..._shortTermNS.keys()],
    },
    total: workingTotal + shortTermTotal + ltCount.count + coreCount.count,
  };
}

// ═════════════════════════════════════════════════════════════════
// Phase 83 — Hierarchical Memory 2.0 additions (strictly-additive)
// Frozen canonical enums + metadata-aware store + promote/demote
// + permission-based sharing + episodic/semantic V2 search
// + consolidation status tracking + timer lifecycle
// ═════════════════════════════════════════════════════════════════

export const MEMORY_LAYER = Object.freeze({
  WORKING: "working",
  SHORT_TERM: "short-term",
  LONG_TERM: "long-term",
  CORE: "core",
});

export const MEMORY_TYPE = Object.freeze({
  EPISODIC: "episodic",
  SEMANTIC: "semantic",
  PROCEDURAL: "procedural",
});

export const CONSOLIDATION_STATUS = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const SHARE_PERMISSION = Object.freeze({
  READ: "read",
  COPY: "copy",
  MODIFY: "modify",
});

const _LAYER_VALUES = new Set(Object.values(MEMORY_LAYER));
const _TYPE_VALUES = new Set(Object.values(MEMORY_TYPE));
const _PERM_VALUES = new Set(Object.values(SHARE_PERMISSION));

// V2 state (parallel to existing in-memory maps)
const _v2MetaNS = new Map();
const _v2Shares = [];
const _v2Consolidations = [];
let _consolidationTimer = null;

/**
 * Public accessor for the Ebbinghaus forgetting curve used internally.
 * retention = e^(-decay_rate * age_hours)
 */
export function applyForgettingCurve(
  createdOrAccessed,
  rate = MEMORY_CONFIG.forgettingRate,
) {
  return calcRetention(createdOrAccessed, rate);
}

/**
 * Record V2 metadata for an already-stored memory. Metadata is not
 * persisted to the DB — lives alongside the in-memory layer.
 */
export function attachMetadata(memoryId, metadata, namespace = DEFAULT_NS) {
  if (!memoryId) throw new Error("memoryId is required");
  if (!metadata || typeof metadata !== "object")
    throw new Error("metadata must be an object");
  if (!_v2MetaNS.has(namespace)) _v2MetaNS.set(namespace, new Map());
  const meta = _v2MetaNS.get(namespace).get(memoryId) || {};
  const merged = { ...meta, ...metadata, memoryId };
  _v2MetaNS.get(namespace).set(memoryId, merged);
  return merged;
}

/**
 * Find which layer a memoryId lives in (in-memory only).
 */
function _locateInMemory(memoryId) {
  for (const [ns, nsMap] of _workingNS) {
    if (nsMap.has(memoryId))
      return { layer: MEMORY_LAYER.WORKING, namespace: ns, nsMap };
  }
  for (const [ns, nsMap] of _shortTermNS) {
    if (nsMap.has(memoryId))
      return { layer: MEMORY_LAYER.SHORT_TERM, namespace: ns, nsMap };
  }
  return null;
}

/**
 * Promote a memory one layer up: working → short-term → long-term.
 */
export function promoteMemoryV2(db, memoryId) {
  if (!memoryId) throw new Error("memoryId is required");
  const loc = _locateInMemory(memoryId);
  if (loc && loc.layer === MEMORY_LAYER.WORKING) {
    const mem = loc.nsMap.get(memoryId);
    loc.nsMap.delete(memoryId);
    _getShortTermNS(loc.namespace).set(memoryId, {
      ...mem,
      lastAccessed: nowISO(),
    });
    return {
      id: memoryId,
      from: MEMORY_LAYER.WORKING,
      to: MEMORY_LAYER.SHORT_TERM,
    };
  }
  if (loc && loc.layer === MEMORY_LAYER.SHORT_TERM) {
    const mem = loc.nsMap.get(memoryId);
    loc.nsMap.delete(memoryId);
    ensureMemoryTables(db);
    const now = nowISO();
    db.prepare(
      `INSERT INTO memory_long_term (id, content, type, importance, access_count, layer, created_at, last_accessed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      memoryId,
      mem.content,
      mem.type,
      mem.importance,
      mem.accessCount,
      "long-term",
      mem.createdAt,
      now,
    );
    return {
      id: memoryId,
      from: MEMORY_LAYER.SHORT_TERM,
      to: MEMORY_LAYER.LONG_TERM,
    };
  }
  throw new Error(`Memory not found in working/short-term: ${memoryId}`);
}

/**
 * Demote a memory one layer down: short-term → working.
 * (long-term/core demotion requires DB round-trip; not exposed here.)
 */
export function demoteMemoryV2(memoryId) {
  if (!memoryId) throw new Error("memoryId is required");
  for (const [ns, nsMap] of _shortTermNS) {
    if (nsMap.has(memoryId)) {
      const mem = nsMap.get(memoryId);
      nsMap.delete(memoryId);
      _getWorkingNS(ns).set(memoryId, { ...mem, lastAccessed: nowISO() });
      return {
        id: memoryId,
        from: MEMORY_LAYER.SHORT_TERM,
        to: MEMORY_LAYER.WORKING,
      };
    }
  }
  throw new Error(`Memory not in short-term: ${memoryId}`);
}

/**
 * Share a memory with fine-grained permissions.
 * permissions: subset of {read, copy, modify} — validated against SHARE_PERMISSION.
 */
export function shareMemoryV2(
  db,
  { memoryId, sourceAgent, targetAgent, permissions = ["read"] } = {},
) {
  if (!memoryId || !targetAgent) {
    throw new Error("memoryId and targetAgent are required");
  }
  const perms = Array.isArray(permissions) ? permissions : [permissions];
  for (const p of perms) {
    if (!_PERM_VALUES.has(p)) throw new Error(`Invalid permission: ${p}`);
  }
  ensureMemoryTables(db);
  const id = `sharev2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sharedAt = nowISO();
  const record = {
    id,
    memoryId,
    sourceAgent: sourceAgent || "local",
    targetAgent,
    permissions: [...perms],
    sharedAt,
    revokedAt: null,
  };
  _v2Shares.push(record);
  try {
    db.prepare(
      `INSERT INTO memory_sharing (id, memory_id, source_agent, target_agent, privacy_level, shared_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      memoryId,
      record.sourceAgent,
      targetAgent,
      perms.join(","),
      sharedAt,
    );
  } catch {
    /* schema drift tolerated */
  }
  return record;
}

export function revokeShare(shareId) {
  const record = _v2Shares.find((s) => s.id === shareId);
  if (!record) throw new Error(`Share not found: ${shareId}`);
  if (record.revokedAt) throw new Error(`Share already revoked`);
  record.revokedAt = nowISO();
  return record;
}

export function listShares(options = {}) {
  let result = [..._v2Shares];
  if (options.memoryId)
    result = result.filter((s) => s.memoryId === options.memoryId);
  if (options.targetAgent)
    result = result.filter((s) => s.targetAgent === options.targetAgent);
  if (options.activeOnly) result = result.filter((s) => !s.revokedAt);
  return result;
}

function _timeInRange(ts, range) {
  if (!range) return true;
  const t = new Date(ts).getTime();
  if (range.from && t < new Date(range.from).getTime()) return false;
  if (range.to && t > new Date(range.to).getTime()) return false;
  return true;
}

/**
 * Search episodic memories with time range + scene + context filters.
 */
export function searchEpisodicV2(db, options = {}) {
  const { timeRange, scene, context, query, limit = 20, namespace } = options;
  const results = [];
  const scanLayer = (nsMap, ns, layerName) => {
    for (const [id, mem] of nsMap) {
      if (mem.type !== MEMORY_TYPE.EPISODIC) continue;
      const meta = _v2MetaNS.get(ns)?.get(id);
      if (timeRange && !_timeInRange(mem.createdAt, timeRange)) continue;
      if (scene && meta?.scene !== scene) continue;
      if (context && !(meta?.context || "").includes(context)) continue;
      if (query && !mem.content.toLowerCase().includes(query.toLowerCase()))
        continue;
      results.push({ ...mem, layer: layerName, metadata: meta || null });
    }
  };
  for (const [ns, nsMap] of _workingNS) {
    if (namespace && ns !== namespace) continue;
    scanLayer(nsMap, ns, MEMORY_LAYER.WORKING);
  }
  for (const [ns, nsMap] of _shortTermNS) {
    if (namespace && ns !== namespace) continue;
    scanLayer(nsMap, ns, MEMORY_LAYER.SHORT_TERM);
  }
  return results.slice(0, limit);
}

/**
 * Search semantic memories with concept-overlap similarity.
 * similarity = |A ∩ B| / max(|A|, |B|) (Szymkiewicz–Simpson-like)
 */
export function searchSemanticV2(db, options = {}) {
  const {
    concepts = [],
    query,
    similarityThreshold = 0,
    limit = 20,
    namespace,
  } = options;
  const results = [];
  const scanLayer = (nsMap, ns, layerName) => {
    for (const [id, mem] of nsMap) {
      if (mem.type !== MEMORY_TYPE.SEMANTIC) continue;
      const meta = _v2MetaNS.get(ns)?.get(id);
      const memConcepts = meta?.concepts || [];
      let sim = 0;
      if (concepts.length > 0) {
        const overlap = concepts.filter((c) => memConcepts.includes(c)).length;
        const denom = Math.max(concepts.length, memConcepts.length) || 1;
        sim = overlap / denom;
        if (sim < similarityThreshold) continue;
      }
      if (query && !mem.content.toLowerCase().includes(query.toLowerCase()))
        continue;
      results.push({
        ...mem,
        layer: layerName,
        metadata: meta || null,
        similarity: sim,
      });
    }
  };
  for (const [ns, nsMap] of _workingNS) {
    if (namespace && ns !== namespace) continue;
    scanLayer(nsMap, ns, MEMORY_LAYER.WORKING);
  }
  for (const [ns, nsMap] of _shortTermNS) {
    if (namespace && ns !== namespace) continue;
    scanLayer(nsMap, ns, MEMORY_LAYER.SHORT_TERM);
  }
  results.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
  return results.slice(0, limit);
}

/**
 * Consolidation run with status tracking and optional pattern extraction.
 * Delegates to existing consolidateMemory() for promotion logic.
 */
export function consolidateV2(db, options = {}) {
  const id = `consol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    status: CONSOLIDATION_STATUS.PROCESSING,
    startedAt: nowISO(),
    completedAt: null,
    promoted: 0,
    forgotten: 0,
    patterns: [],
    error: null,
  };
  _v2Consolidations.push(record);
  try {
    // Pattern extraction snapshot BEFORE consolidation (so we can see
    // frequently-accessed short-term items before they get promoted out).
    if (options.extractPatterns) {
      for (const [, nsMap] of _shortTermNS) {
        for (const mem of nsMap.values()) {
          if (mem.accessCount >= 2) {
            record.patterns.push({
              id: mem.id,
              type: mem.type,
              content: mem.content.slice(0, 80),
              accessCount: mem.accessCount,
            });
          }
        }
      }
    }
    const result = consolidateMemory(db);
    record.promoted = result.promoted;
    record.forgotten = result.forgotten;
    record.status = CONSOLIDATION_STATUS.COMPLETED;
    record.completedAt = nowISO();
  } catch (err) {
    record.status = CONSOLIDATION_STATUS.FAILED;
    record.completedAt = nowISO();
    record.error = err.message;
  }
  return record;
}

export function listConsolidations(options = {}) {
  let result = [..._v2Consolidations];
  if (options.status)
    result = result.filter((c) => c.status === options.status);
  return result;
}

/**
 * Prune with per-layer scope + custom threshold.
 */
export function pruneV2(db, options = {}) {
  const { layer, maxAge = 720, threshold } = options;
  if (layer && !_LAYER_VALUES.has(layer))
    throw new Error(`Invalid layer: ${layer}`);
  const effectiveThreshold = threshold ?? MEMORY_CONFIG.recallThreshold;
  let pruned = 0;

  if (!layer || layer === MEMORY_LAYER.WORKING) {
    for (const [, nsMap] of _workingNS) {
      for (const [id, mem] of nsMap) {
        const retention = calcRetention(mem.lastAccessed);
        if (retention < effectiveThreshold) {
          nsMap.delete(id);
          pruned++;
        }
      }
    }
  }
  if (!layer || layer === MEMORY_LAYER.SHORT_TERM) {
    for (const [, nsMap] of _shortTermNS) {
      for (const [id, mem] of nsMap) {
        const retention = calcRetention(mem.lastAccessed);
        if (retention < effectiveThreshold) {
          nsMap.delete(id);
          pruned++;
        }
      }
    }
  }
  if (!layer || layer === MEMORY_LAYER.LONG_TERM) {
    const cutoff = new Date(Date.now() - maxAge * 60 * 60 * 1000).toISOString();
    ensureMemoryTables(db);
    const result = db
      .prepare(
        `DELETE FROM memory_long_term WHERE last_accessed < ? AND access_count < 3`,
      )
      .run(cutoff);
    pruned += result.changes || 0;
  }

  return { pruned, layer: layer || "all" };
}

/**
 * Start a periodic consolidation timer. Returns timer handle.
 * Only one timer at a time — repeat calls return the existing handle.
 */
export function startConsolidationTimer({
  intervalMs = 60_000,
  db,
  onTick,
} = {}) {
  if (_consolidationTimer) return _consolidationTimer;
  if (!db) throw new Error("db is required for consolidation timer");
  _consolidationTimer = setInterval(() => {
    const rec = consolidateV2(db);
    if (onTick) {
      try {
        onTick(rec);
      } catch {
        /* swallow */
      }
    }
  }, intervalMs);
  return _consolidationTimer;
}

export function stopConsolidationTimer() {
  if (_consolidationTimer) {
    clearInterval(_consolidationTimer);
    _consolidationTimer = null;
    return true;
  }
  return false;
}

/**
 * Extended stats — base + per-layer breakdown + consolidation + shares.
 */
export function getStatsV2(db) {
  const base = getMemoryStats(db);

  const perLayer = {
    [MEMORY_LAYER.WORKING]: base.working,
    [MEMORY_LAYER.SHORT_TERM]: base.shortTerm,
    [MEMORY_LAYER.LONG_TERM]: base.longTerm,
    [MEMORY_LAYER.CORE]: base.core,
  };

  const byStatus = {};
  for (const c of _v2Consolidations) {
    byStatus[c.status] = (byStatus[c.status] || 0) + 1;
  }

  return {
    ...base,
    perLayer,
    consolidation: {
      total: _v2Consolidations.length,
      byStatus,
      last: _v2Consolidations[_v2Consolidations.length - 1] || null,
    },
    shares: {
      total: _v2Shares.length,
      active: _v2Shares.filter((s) => !s.revokedAt).length,
      revoked: _v2Shares.filter((s) => s.revokedAt).length,
    },
    metadataEntries: [..._v2MetaNS.values()].reduce(
      (sum, m) => sum + m.size,
      0,
    ),
  };
}

/**
 * Test helper — clear all V2 state + stop timer.
 */
export function _resetV2State() {
  _v2MetaNS.clear();
  _v2Shares.length = 0;
  _v2Consolidations.length = 0;
  if (_consolidationTimer) {
    clearInterval(_consolidationTimer);
    _consolidationTimer = null;
  }
}
