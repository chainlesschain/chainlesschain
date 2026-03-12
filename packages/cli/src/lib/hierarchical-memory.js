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
// Map<id, { id, content, type, importance, accessCount, createdAt, lastAccessed }>
export const _working = new Map();
export const _shortTerm = new Map();

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
export function storeMemory(db, content, options = {}) {
  if (!content || !content.trim()) {
    throw new Error("Memory content cannot be empty");
  }

  const importance = Math.max(
    0,
    Math.min(1, parseFloat(options.importance) || 0.5),
  );
  const type = options.type || "episodic";
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
    if (_shortTerm.size >= MEMORY_CONFIG.shortTermCapacity) {
      // Evict oldest
      const oldest = [..._shortTerm.entries()].sort(
        (a, b) => new Date(a[1].lastAccessed) - new Date(b[1].lastAccessed),
      )[0];
      if (oldest) _shortTerm.delete(oldest[0]);
    }
    _shortTerm.set(id, {
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
    if (_working.size >= MEMORY_CONFIG.workingCapacity) {
      const oldest = [..._working.entries()].sort(
        (a, b) => new Date(a[1].lastAccessed) - new Date(b[1].lastAccessed),
      )[0];
      if (oldest) _working.delete(oldest[0]);
    }
    _working.set(id, {
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
 */
export function recallMemory(db, query, options = {}) {
  if (!query || !query.trim()) return [];

  const limit = Math.max(1, parseInt(options.limit) || 20);
  const pattern = query.toLowerCase();
  const results = [];

  // Search working memory
  for (const mem of _working.values()) {
    if (mem.content.toLowerCase().includes(pattern)) {
      const retention = calcRetention(mem.lastAccessed);
      if (retention >= MEMORY_CONFIG.recallThreshold) {
        mem.accessCount++;
        mem.lastAccessed = nowISO();
        results.push({ ...mem, layer: "working", retention });
      }
    }
  }

  // Search short-term memory
  for (const mem of _shortTerm.values()) {
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

  // Promote working → short-term
  for (const [id, mem] of _working) {
    const retention = calcRetention(mem.lastAccessed);
    if (retention < MEMORY_CONFIG.recallThreshold) {
      _working.delete(id);
      forgotten++;
    } else if (mem.accessCount >= 3) {
      _working.delete(id);
      _shortTerm.set(id, { ...mem, lastAccessed: nowISO() });
      promoted++;
    }
  }

  // Promote short-term → long-term
  for (const [id, mem] of _shortTerm) {
    const retention = calcRetention(mem.lastAccessed);
    if (retention < MEMORY_CONFIG.recallThreshold) {
      _shortTerm.delete(id);
      forgotten++;
    } else if (mem.accessCount >= 5) {
      _shortTerm.delete(id);
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

  // In-memory layers
  for (const mem of _working.values()) {
    if (mem.type === type && mem.content.toLowerCase().includes(pattern)) {
      results.push({ ...mem, layer: "working" });
    }
  }
  for (const mem of _shortTerm.values()) {
    if (mem.type === type && mem.content.toLowerCase().includes(pattern)) {
      results.push({ ...mem, layer: "short-term" });
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

  // Prune in-memory layers by retention
  for (const [id, mem] of _working) {
    const retention = calcRetention(mem.lastAccessed);
    if (retention < MEMORY_CONFIG.recallThreshold) {
      _working.delete(id);
      pruned++;
    }
  }
  for (const [id, mem] of _shortTerm) {
    const retention = calcRetention(mem.lastAccessed);
    if (retention < MEMORY_CONFIG.recallThreshold) {
      _shortTerm.delete(id);
      pruned++;
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

  return {
    working: _working.size,
    shortTerm: _shortTerm.size,
    longTerm: ltCount.count,
    core: coreCount.count,
    shared: shareCount.count,
    total: _working.size + _shortTerm.size + ltCount.count + coreCount.count,
  };
}
