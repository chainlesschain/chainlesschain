/**
 * @module ai-engine/memory/hierarchical-memory
 * Phase 83: Hierarchical memory system
 * Layers: working → short-term → long-term → core
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class HierarchicalMemory extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._working = new Map(); // Volatile, current session
    this._shortTerm = new Map(); // Decays over hours
    this._longTerm = new Map(); // Persisted, decays over days
    this._core = new Map(); // Permanent, never forgotten
    this._consolidationTimer = null;
    this._config = {
      workingCapacity: 50,
      shortTermCapacity: 500,
      longTermCapacity: 10000,
      consolidationInterval: 300000, // 5 min
      forgettingRate: 0.1,
      recallThreshold: 0.3,
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadLongTermMemories();
    await this._loadCoreMemories();
    this._startConsolidation();
    this.initialized = true;
    logger.info(
      `[HierarchicalMemory] Initialized: ${this._longTerm.size} long-term, ${this._core.size} core memories`,
    );
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_long_term (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'episodic',
          importance REAL DEFAULT 0.5,
          access_count INTEGER DEFAULT 0,
          last_accessed TEXT,
          decay_rate REAL DEFAULT 0.1,
          associations TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS memory_core (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'semantic',
          importance REAL DEFAULT 1.0,
          source TEXT,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS memory_sharing (
          id TEXT PRIMARY KEY,
          memory_id TEXT NOT NULL,
          shared_with TEXT NOT NULL,
          privacy_level TEXT DEFAULT 'filtered',
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn(
        "[HierarchicalMemory] Table creation warning:",
        error.message,
      );
    }
  }

  async _loadLongTermMemories() {
    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM memory_long_term ORDER BY importance DESC LIMIT 1000",
        )
        .all();
      for (const row of rows) {
        this._longTerm.set(row.id, {
          ...row,
          associations: JSON.parse(row.associations || "[]"),
          metadata: JSON.parse(row.metadata || "{}"),
        });
      }
    } catch (error) {
      logger.warn(
        "[HierarchicalMemory] Failed to load long-term memories:",
        error.message,
      );
    }
  }

  async _loadCoreMemories() {
    try {
      const rows = this.db.prepare("SELECT * FROM memory_core").all();
      for (const row of rows) {
        this._core.set(row.id, {
          ...row,
          metadata: JSON.parse(row.metadata || "{}"),
        });
      }
    } catch (error) {
      logger.warn(
        "[HierarchicalMemory] Failed to load core memories:",
        error.message,
      );
    }
  }

  _startConsolidation() {
    if (this._consolidationTimer) {
      return;
    }
    this._consolidationTimer = setInterval(
      () => this.consolidate(),
      this._config.consolidationInterval,
    );
    if (this._consolidationTimer.unref) {
      this._consolidationTimer.unref();
    }
  }

  // Store memory at appropriate layer
  store(content, options = {}) {
    const id =
      options.id ||
      `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const memory = {
      id,
      content,
      type: options.type || "episodic",
      importance: options.importance || 0.5,
      access_count: 0,
      last_accessed: new Date().toISOString(),
      decay_rate: options.decay_rate || this._config.forgettingRate,
      associations: options.associations || [],
      metadata: options.metadata || {},
      created_at: new Date().toISOString(),
      strength: 1.0,
    };

    // Route to appropriate layer based on importance
    if (options.core || memory.importance >= 0.9) {
      this._core.set(id, memory);
      this._persistCore(memory);
    } else if (memory.importance >= 0.6) {
      this._longTerm.set(id, memory);
      this._persistLongTerm(memory);
    } else if (memory.importance >= 0.3) {
      this._shortTerm.set(id, memory);
    } else {
      this._working.set(id, memory);
      // Evict if over capacity
      if (this._working.size > this._config.workingCapacity) {
        const oldest = this._working.keys().next().value;
        this._working.delete(oldest);
      }
    }

    this.emit("memory:stored", {
      id,
      layer: this._getLayer(id),
      type: memory.type,
    });
    return { id, layer: this._getLayer(id) };
  }

  _getLayer(id) {
    if (this._core.has(id)) {
      return "core";
    }
    if (this._longTerm.has(id)) {
      return "long-term";
    }
    if (this._shortTerm.has(id)) {
      return "short-term";
    }
    if (this._working.has(id)) {
      return "working";
    }
    return "unknown";
  }

  // Recall with forgetting curve
  recall(query, options = {}) {
    const results = [];
    const searchText = (
      typeof query === "string" ? query : JSON.stringify(query)
    ).toLowerCase();

    // Search all layers (core first, then long-term, etc.)
    const layers = [
      { name: "core", store: this._core },
      { name: "long-term", store: this._longTerm },
      { name: "short-term", store: this._shortTerm },
      { name: "working", store: this._working },
    ];

    for (const layer of layers) {
      for (const [id, memory] of layer.store) {
        const contentStr = (
          typeof memory.content === "string"
            ? memory.content
            : JSON.stringify(memory.content)
        ).toLowerCase();
        if (
          contentStr.includes(searchText) ||
          searchText.includes(contentStr.substring(0, 50))
        ) {
          // Apply forgetting curve
          const age =
            (Date.now() - new Date(memory.created_at).getTime()) / 3600000; // hours
          const retention = Math.exp(-memory.decay_rate * age);

          if (
            retention >= this._config.recallThreshold ||
            layer.name === "core"
          ) {
            memory.access_count = (memory.access_count || 0) + 1;
            memory.last_accessed = new Date().toISOString();
            // Strengthen memory on recall (spacing effect)
            memory.strength = Math.min(1.0, (memory.strength || 0.5) + 0.1);

            results.push({
              id,
              content: memory.content,
              layer: layer.name,
              type: memory.type,
              importance: memory.importance,
              retention,
              strength: memory.strength,
              accessCount: memory.access_count,
            });
          }
        }
      }
    }

    // Sort by importance * retention
    results.sort(
      (a, b) => b.importance * b.retention - a.importance * a.retention,
    );

    const limit = options.limit || 10;
    return results.slice(0, limit);
  }

  // Memory consolidation (simulates sleep-based memory integration)
  consolidate() {
    let promoted = 0;
    let forgotten = 0;
    const now = Date.now();

    // Working → Short-term (frequently accessed)
    for (const [id, memory] of this._working) {
      if (memory.access_count >= 3 || memory.importance >= 0.3) {
        this._shortTerm.set(id, memory);
        this._working.delete(id);
        promoted++;
      }
    }

    // Short-term → Long-term (important + reinforced)
    for (const [id, memory] of this._shortTerm) {
      const age = (now - new Date(memory.created_at).getTime()) / 3600000;
      if (memory.access_count >= 5 || memory.importance >= 0.6) {
        this._longTerm.set(id, memory);
        this._shortTerm.delete(id);
        this._persistLongTerm(memory);
        promoted++;
      } else if (age > 24) {
        // Forget if not accessed in 24h
        this._shortTerm.delete(id);
        forgotten++;
      }
    }

    // Forget weak long-term memories
    for (const [id, memory] of this._longTerm) {
      const age = (now - new Date(memory.created_at).getTime()) / 3600000;
      const retention = Math.exp(-memory.decay_rate * age);
      if (retention < this._config.recallThreshold && memory.access_count < 3) {
        this._longTerm.delete(id);
        forgotten++;
      }
    }

    if (promoted > 0 || forgotten > 0) {
      this.emit("memory:consolidated", { promoted, forgotten });
      logger.info(
        `[HierarchicalMemory] Consolidation: ${promoted} promoted, ${forgotten} forgotten`,
      );
    }

    return { promoted, forgotten };
  }

  // Cross-agent memory sharing
  shareMemory(memoryId, targetAgentId, privacyLevel = "filtered") {
    const memory = this._longTerm.get(memoryId) || this._core.get(memoryId);
    if (!memory) {
      return null;
    }

    const shared = { ...memory };
    if (privacyLevel === "filtered") {
      // Remove sensitive metadata
      shared.metadata = {};
      delete shared.associations;
    }

    try {
      this.db
        .prepare(
          `
        INSERT INTO memory_sharing (id, memory_id, shared_with, privacy_level)
        VALUES (?, ?, ?, ?)
      `,
        )
        .run(`share-${Date.now()}`, memoryId, targetAgentId, privacyLevel);
    } catch (error) {
      logger.error("[HierarchicalMemory] Share failed:", error.message);
    }

    this.emit("memory:shared", { memoryId, targetAgentId });
    return shared;
  }

  // Search episodic memories (time-ordered events)
  searchEpisodic(query, options = {}) {
    return this.recall(query, { ...options, type: "episodic" }).filter(
      (m) => m.type === "episodic",
    );
  }

  // Search semantic memories (facts, concepts)
  searchSemantic(query, options = {}) {
    return this.recall(query, { ...options, type: "semantic" }).filter(
      (m) => m.type === "semantic",
    );
  }

  prune(options = {}) {
    const maxAge = options.maxAge || 168; // 7 days in hours
    const now = Date.now();
    let pruned = 0;

    for (const [id, memory] of this._longTerm) {
      const age = (now - new Date(memory.created_at).getTime()) / 3600000;
      if (age > maxAge && memory.access_count < 2 && memory.importance < 0.5) {
        this._longTerm.delete(id);
        pruned++;
      }
    }

    this.emit("memory:pruned", { count: pruned });
    return { pruned };
  }

  _persistLongTerm(memory) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO memory_long_term (id, content, type, importance, access_count, last_accessed, decay_rate, associations, metadata, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          memory.id,
          typeof memory.content === "string"
            ? memory.content
            : JSON.stringify(memory.content),
          memory.type,
          memory.importance,
          memory.access_count,
          memory.last_accessed,
          memory.decay_rate,
          JSON.stringify(memory.associations),
          JSON.stringify(memory.metadata),
        );
    } catch (error) {
      logger.error(
        "[HierarchicalMemory] Persist long-term failed:",
        error.message,
      );
    }
  }

  _persistCore(memory) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO memory_core (id, content, type, importance, source, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          memory.id,
          typeof memory.content === "string"
            ? memory.content
            : JSON.stringify(memory.content),
          memory.type,
          memory.importance,
          memory.source || null,
          JSON.stringify(memory.metadata),
        );
    } catch (error) {
      logger.error("[HierarchicalMemory] Persist core failed:", error.message);
    }
  }

  getStats() {
    return {
      working: this._working.size,
      shortTerm: this._shortTerm.size,
      longTerm: this._longTerm.size,
      core: this._core.size,
      total:
        this._working.size +
        this._shortTerm.size +
        this._longTerm.size +
        this._core.size,
    };
  }

  destroy() {
    if (this._consolidationTimer) {
      clearInterval(this._consolidationTimer);
      this._consolidationTimer = null;
    }
  }
}

let instance = null;
function getHierarchicalMemory() {
  if (!instance) {
    instance = new HierarchicalMemory();
  }
  return instance;
}

module.exports = { HierarchicalMemory, getHierarchicalMemory };
