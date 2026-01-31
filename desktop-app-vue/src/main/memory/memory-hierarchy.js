/**
 * Memory Hierarchy System (MemGPT-style)
 *
 * Implements a three-tier memory hierarchy:
 * - Working Memory: Current context, limited tokens
 * - Recall Memory: Recent memories, fast retrieval
 * - Archival Memory: Long-term storage, vector search
 *
 * @module memory-hierarchy
 * @version 1.0.0
 */

const EventEmitter = require('events');
const { logger } = require('../utils/logger.js');

/**
 * Memory importance levels
 */
const MemoryImportance = {
  LOW: 0.3,
  MEDIUM: 0.5,
  HIGH: 0.7,
  CRITICAL: 0.9,
};

/**
 * Memory types
 */
const MemoryType = {
  FACT: 'fact',           // User facts (name, preferences)
  CONVERSATION: 'conversation',  // Conversation summaries
  TASK: 'task',           // Task outcomes
  PATTERN: 'pattern',     // Learned patterns
  ASSOCIATION: 'association',   // Cross-reference links
  SYSTEM: 'system',       // System state
};

/**
 * Working Memory - Limited context window
 */
class WorkingMemory {
  constructor(config = {}) {
    this.maxTokens = config.maxTokens || 4000;
    this.currentTokens = 0;
    this.memories = [];
    this.systemMessage = '';
    this.userPersona = '';
  }

  /**
   * Add memory to working context
   * @param {Object} memory - Memory to add
   * @returns {boolean} Whether addition was successful
   */
  add(memory) {
    const tokenCount = this._estimateTokens(memory.content);

    // Check if we have room
    if (this.currentTokens + tokenCount > this.maxTokens) {
      return false;
    }

    this.memories.push({
      ...memory,
      tokens: tokenCount,
      addedAt: Date.now(),
    });
    this.currentTokens += tokenCount;

    return true;
  }

  /**
   * Remove oldest memory to make room
   * @returns {Object|null} Removed memory
   */
  evictOldest() {
    if (this.memories.length === 0) return null;

    // Sort by importance (keep important ones), then by time
    this.memories.sort((a, b) => {
      if (a.importance !== b.importance) {
        return a.importance - b.importance;
      }
      return a.addedAt - b.addedAt;
    });

    const removed = this.memories.shift();
    this.currentTokens -= removed.tokens;

    return removed;
  }

  /**
   * Get all working memories
   * @returns {Array} Current memories
   */
  getAll() {
    return [...this.memories];
  }

  /**
   * Get context for LLM
   * @returns {string} Formatted context
   */
  getContext() {
    let context = '';

    if (this.systemMessage) {
      context += `[System]: ${this.systemMessage}\n\n`;
    }

    if (this.userPersona) {
      context += `[User Persona]: ${this.userPersona}\n\n`;
    }

    if (this.memories.length > 0) {
      context += '[Working Memory]:\n';
      this.memories.forEach((m, i) => {
        context += `${i + 1}. [${m.type}] ${m.content}\n`;
      });
    }

    return context;
  }

  /**
   * Clear working memory
   */
  clear() {
    this.memories = [];
    this.currentTokens = 0;
  }

  /**
   * Set system message
   * @param {string} message - System message
   */
  setSystemMessage(message) {
    this.systemMessage = message;
  }

  /**
   * Set user persona
   * @param {string} persona - User persona description
   */
  setUserPersona(persona) {
    this.userPersona = persona;
  }

  /**
   * Get usage stats
   * @returns {Object} Usage statistics
   */
  getStats() {
    return {
      currentTokens: this.currentTokens,
      maxTokens: this.maxTokens,
      utilization: (this.currentTokens / this.maxTokens * 100).toFixed(1) + '%',
      memoryCount: this.memories.length,
    };
  }

  /**
   * Estimate token count
   * @private
   */
  _estimateTokens(text) {
    // Rough estimation: ~4 characters per token
    return Math.ceil(String(text).length / 4);
  }
}

/**
 * Recall Memory - Recent memories with fast access
 */
class RecallMemory {
  constructor(config = {}) {
    this.maxSize = config.maxSize || 100;
    this.memories = new Map();
    this.accessCounts = new Map();
    this.lastAccessed = new Map();
  }

  /**
   * Store memory
   * @param {string} id - Memory ID
   * @param {Object} memory - Memory object
   */
  store(id, memory) {
    this.memories.set(id, {
      ...memory,
      storedAt: Date.now(),
    });
    this.accessCounts.set(id, 0);
    this.lastAccessed.set(id, Date.now());

    // Evict if over capacity
    if (this.memories.size > this.maxSize) {
      this._evictLRU();
    }
  }

  /**
   * Retrieve memory
   * @param {string} id - Memory ID
   * @returns {Object|null} Memory or null
   */
  get(id) {
    const memory = this.memories.get(id);
    if (memory) {
      this.accessCounts.set(id, (this.accessCounts.get(id) || 0) + 1);
      this.lastAccessed.set(id, Date.now());
    }
    return memory || null;
  }

  /**
   * Search by query
   * @param {string} query - Search query
   * @param {number} limit - Max results
   * @returns {Array} Matching memories
   */
  search(query, limit = 10) {
    const queryLower = query.toLowerCase();
    const results = [];

    for (const [id, memory] of this.memories) {
      const content = String(memory.content).toLowerCase();
      if (content.includes(queryLower)) {
        results.push({
          id,
          ...memory,
          accessCount: this.accessCounts.get(id) || 0,
        });
      }
    }

    // Sort by relevance (simple match count) and access frequency
    results.sort((a, b) => {
      const aMatches = (String(a.content).match(new RegExp(queryLower, 'gi')) || []).length;
      const bMatches = (String(b.content).match(new RegExp(queryLower, 'gi')) || []).length;
      return bMatches - aMatches || b.accessCount - a.accessCount;
    });

    return results.slice(0, limit);
  }

  /**
   * Get recent memories
   * @param {number} limit - Max results
   * @returns {Array} Recent memories
   */
  getRecent(limit = 20) {
    const entries = Array.from(this.memories.entries())
      .map(([id, memory]) => ({ id, ...memory }))
      .sort((a, b) => b.storedAt - a.storedAt);

    return entries.slice(0, limit);
  }

  /**
   * Get all memories
   * @returns {Array} All memories
   */
  getAll() {
    return Array.from(this.memories.entries()).map(([id, memory]) => ({
      id,
      ...memory,
    }));
  }

  /**
   * Remove memory
   * @param {string} id - Memory ID
   * @returns {boolean} Whether removal was successful
   */
  remove(id) {
    this.accessCounts.delete(id);
    this.lastAccessed.delete(id);
    return this.memories.delete(id);
  }

  /**
   * Clear all memories
   */
  clear() {
    this.memories.clear();
    this.accessCounts.clear();
    this.lastAccessed.clear();
  }

  /**
   * Get stats
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      size: this.memories.size,
      maxSize: this.maxSize,
      utilization: (this.memories.size / this.maxSize * 100).toFixed(1) + '%',
    };
  }

  /**
   * Evict least recently used
   * @private
   */
  _evictLRU() {
    let oldestId = null;
    let oldestTime = Infinity;

    for (const [id, time] of this.lastAccessed) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.remove(oldestId);
    }
  }
}

/**
 * Archival Memory - Long-term storage with vector search
 */
class ArchivalMemory extends EventEmitter {
  constructor(config = {}) {
    super();
    this.db = config.database || null;
    this.ragManager = config.ragManager || null;
    this.tableName = 'long_term_memories';
  }

  /**
   * Set database instance
   * @param {Object} db - Database instance
   */
  setDatabase(db) {
    this.db = db;
  }

  /**
   * Set RAG manager for vector search
   * @param {Object} ragManager - RAG manager instance
   */
  setRagManager(ragManager) {
    this.ragManager = ragManager;
  }

  /**
   * Store memory in archive
   * @param {Object} memory - Memory to store
   * @returns {Promise<string>} Memory ID
   */
  async store(memory) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const id = memory.id || this._generateId();
    const now = Date.now();

    try {
      await this.db.run(`
        INSERT OR REPLACE INTO ${this.tableName} (
          id, user_id, type, content, importance,
          metadata, embedding, created_at, accessed_at, access_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        memory.userId || 'default',
        memory.type || MemoryType.FACT,
        JSON.stringify(memory.content),
        memory.importance || MemoryImportance.MEDIUM,
        JSON.stringify(memory.metadata || {}),
        memory.embedding ? Buffer.from(new Float32Array(memory.embedding).buffer) : null,
        now,
        now,
        0,
      ]);

      // Also index in RAG if available
      if (this.ragManager && memory.content) {
        try {
          await this.ragManager.addDocument({
            id: `memory_${id}`,
            content: typeof memory.content === 'string'
              ? memory.content
              : JSON.stringify(memory.content),
            metadata: {
              memoryId: id,
              type: memory.type,
              importance: memory.importance,
            },
          });
        } catch (ragError) {
          logger.warn('[ArchivalMemory] RAG indexing failed:', ragError.message);
        }
      }

      this.emit('memory-stored', { id, memory });
      return id;
    } catch (error) {
      logger.error('[ArchivalMemory] Store failed:', error);
      throw error;
    }
  }

  /**
   * Retrieve memory by ID
   * @param {string} id - Memory ID
   * @returns {Promise<Object|null>} Memory or null
   */
  async get(id) {
    if (!this.db) return null;

    try {
      const row = await this.db.get(`
        SELECT * FROM ${this.tableName} WHERE id = ?
      `, [id]);

      if (row) {
        // Update access stats
        await this.db.run(`
          UPDATE ${this.tableName}
          SET accessed_at = ?, access_count = access_count + 1
          WHERE id = ?
        `, [Date.now(), id]);

        return this._parseRow(row);
      }
      return null;
    } catch (error) {
      logger.error('[ArchivalMemory] Get failed:', error);
      return null;
    }
  }

  /**
   * Search memories
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async search(query, options = {}) {
    const {
      limit = 10,
      type = null,
      minImportance = 0,
      useVector = true,
    } = options;

    const results = [];

    // Vector search via RAG
    if (useVector && this.ragManager) {
      try {
        const ragResults = await this.ragManager.search(query, { topK: limit });
        for (const result of ragResults) {
          if (result.metadata?.memoryId) {
            const memory = await this.get(result.metadata.memoryId);
            if (memory && memory.importance >= minImportance) {
              if (!type || memory.type === type) {
                results.push({
                  ...memory,
                  score: result.score,
                });
              }
            }
          }
        }
      } catch (error) {
        logger.warn('[ArchivalMemory] Vector search failed:', error.message);
      }
    }

    // Fallback to text search
    if (results.length < limit && this.db) {
      try {
        const whereClause = type
          ? 'WHERE content LIKE ? AND type = ? AND importance >= ?'
          : 'WHERE content LIKE ? AND importance >= ?';
        const params = type
          ? [`%${query}%`, type, minImportance]
          : [`%${query}%`, minImportance];

        const rows = await this.db.all(`
          SELECT * FROM ${this.tableName}
          ${whereClause}
          ORDER BY importance DESC, accessed_at DESC
          LIMIT ?
        `, [...params, limit - results.length]);

        for (const row of rows) {
          const memory = this._parseRow(row);
          if (!results.find(r => r.id === memory.id)) {
            results.push(memory);
          }
        }
      } catch (error) {
        logger.warn('[ArchivalMemory] Text search failed:', error.message);
      }
    }

    return results.slice(0, limit);
  }

  /**
   * Get memories by type
   * @param {string} type - Memory type
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Memories
   */
  async getByType(type, limit = 50) {
    if (!this.db) return [];

    try {
      const rows = await this.db.all(`
        SELECT * FROM ${this.tableName}
        WHERE type = ?
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `, [type, limit]);

      return rows.map(row => this._parseRow(row));
    } catch (error) {
      logger.error('[ArchivalMemory] GetByType failed:', error);
      return [];
    }
  }

  /**
   * Get most important memories
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Important memories
   */
  async getMostImportant(limit = 20) {
    if (!this.db) return [];

    try {
      const rows = await this.db.all(`
        SELECT * FROM ${this.tableName}
        ORDER BY importance DESC, access_count DESC
        LIMIT ?
      `, [limit]);

      return rows.map(row => this._parseRow(row));
    } catch (error) {
      logger.error('[ArchivalMemory] GetMostImportant failed:', error);
      return [];
    }
  }

  /**
   * Update memory importance
   * @param {string} id - Memory ID
   * @param {number} importance - New importance
   */
  async updateImportance(id, importance) {
    if (!this.db) return;

    try {
      await this.db.run(`
        UPDATE ${this.tableName}
        SET importance = ?
        WHERE id = ?
      `, [importance, id]);
    } catch (error) {
      logger.error('[ArchivalMemory] UpdateImportance failed:', error);
    }
  }

  /**
   * Delete memory
   * @param {string} id - Memory ID
   * @returns {Promise<boolean>} Success
   */
  async delete(id) {
    if (!this.db) return false;

    try {
      await this.db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);

      // Also remove from RAG
      if (this.ragManager) {
        try {
          await this.ragManager.deleteDocument(`memory_${id}`);
        } catch (e) {
          // Ignore RAG deletion errors
        }
      }

      this.emit('memory-deleted', { id });
      return true;
    } catch (error) {
      logger.error('[ArchivalMemory] Delete failed:', error);
      return false;
    }
  }

  /**
   * Get statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    if (!this.db) {
      return { total: 0, byType: {}, avgImportance: 0 };
    }

    try {
      const total = await this.db.get(`
        SELECT COUNT(*) as count FROM ${this.tableName}
      `);

      const byType = await this.db.all(`
        SELECT type, COUNT(*) as count
        FROM ${this.tableName}
        GROUP BY type
      `);

      const avgImportance = await this.db.get(`
        SELECT AVG(importance) as avg FROM ${this.tableName}
      `);

      return {
        total: total?.count || 0,
        byType: byType.reduce((acc, row) => {
          acc[row.type] = row.count;
          return acc;
        }, {}),
        avgImportance: avgImportance?.avg || 0,
      };
    } catch (error) {
      logger.error('[ArchivalMemory] GetStats failed:', error);
      return { total: 0, byType: {}, avgImportance: 0 };
    }
  }

  /**
   * Parse database row
   * @private
   */
  _parseRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      content: JSON.parse(row.content || '{}'),
      importance: row.importance,
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
    };
  }

  /**
   * Generate unique ID
   * @private
   */
  _generateId() {
    return `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Memory Hierarchy Manager - Coordinates all memory layers
 */
class MemoryHierarchy extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      workingMemoryTokens: config.workingMemoryTokens || 4000,
      recallMemorySize: config.recallMemorySize || 100,
      autoArchiveThreshold: config.autoArchiveThreshold || 20,
      importanceThreshold: config.importanceThreshold || 0.7,
      ...config,
    };

    this.working = new WorkingMemory({
      maxTokens: this.config.workingMemoryTokens,
    });

    this.recall = new RecallMemory({
      maxSize: this.config.recallMemorySize,
    });

    this.archival = new ArchivalMemory({
      database: config.database,
      ragManager: config.ragManager,
    });

    this._setupEventHandlers();
  }

  /**
   * Set database instance
   * @param {Object} db - Database instance
   */
  setDatabase(db) {
    this.archival.setDatabase(db);
  }

  /**
   * Set RAG manager
   * @param {Object} ragManager - RAG manager instance
   */
  setRagManager(ragManager) {
    this.archival.setRagManager(ragManager);
  }

  /**
   * Add memory to appropriate layer
   * @param {Object} memory - Memory to add
   * @param {string} layer - Target layer ('working', 'recall', 'archival')
   * @returns {Promise<string|boolean>} Result
   */
  async addMemory(memory, layer = 'recall') {
    switch (layer) {
      case 'working':
        return this.working.add(memory);

      case 'recall':
        const id = memory.id || this.archival._generateId();
        this.recall.store(id, memory);
        return id;

      case 'archival':
        return await this.archival.store(memory);

      default:
        throw new Error(`Unknown memory layer: ${layer}`);
    }
  }

  /**
   * Promote memory from recall to working
   * @param {string} id - Memory ID
   * @returns {boolean} Success
   */
  promoteToWorking(id) {
    const memory = this.recall.get(id);
    if (!memory) return false;

    const added = this.working.add(memory);
    if (!added) {
      // Evict to make room
      const evicted = this.working.evictOldest();
      if (evicted) {
        this.recall.store(evicted.id || this.archival._generateId(), evicted);
      }
      return this.working.add(memory);
    }
    return added;
  }

  /**
   * Archive memory from recall to archival
   * @param {string} id - Memory ID
   * @returns {Promise<string|null>} Archived memory ID
   */
  async archiveFromRecall(id) {
    const memory = this.recall.get(id);
    if (!memory) return null;

    const archivedId = await this.archival.store(memory);
    this.recall.remove(id);

    return archivedId;
  }

  /**
   * Search across all memory layers
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Results by layer
   */
  async search(query, options = {}) {
    const { limit = 10 } = options;

    const results = {
      working: [],
      recall: this.recall.search(query, limit),
      archival: await this.archival.search(query, { ...options, limit }),
    };

    // Also check working memory
    const workingMemories = this.working.getAll();
    const queryLower = query.toLowerCase();
    results.working = workingMemories.filter(m =>
      String(m.content).toLowerCase().includes(queryLower)
    );

    return results;
  }

  /**
   * Auto-manage memory - evict from recall to archival when threshold reached
   */
  async autoManage() {
    const recallStats = this.recall.getStats();

    if (recallStats.size >= this.config.autoArchiveThreshold) {
      const memories = this.recall.getAll();

      // Find memories to archive (old or high importance)
      for (const memory of memories) {
        if (memory.importance >= this.config.importanceThreshold) {
          await this.archiveFromRecall(memory.id);
          logger.info(`[MemoryHierarchy] Auto-archived memory: ${memory.id}`);
        }
      }
    }
  }

  /**
   * Get statistics from all layers
   * @returns {Promise<Object>} Combined statistics
   */
  async getStats() {
    return {
      working: this.working.getStats(),
      recall: this.recall.getStats(),
      archival: await this.archival.getStats(),
    };
  }

  /**
   * Clear all memories
   * @param {Array} layers - Layers to clear (default: all)
   */
  async clear(layers = ['working', 'recall']) {
    if (layers.includes('working')) {
      this.working.clear();
    }
    if (layers.includes('recall')) {
      this.recall.clear();
    }
    // Archival is not cleared by default for safety
  }

  /**
   * Setup event handlers
   * @private
   */
  _setupEventHandlers() {
    this.archival.on('memory-stored', (data) => {
      this.emit('memory-archived', data);
    });

    this.archival.on('memory-deleted', (data) => {
      this.emit('memory-deleted', data);
    });
  }
}

module.exports = {
  MemoryImportance,
  MemoryType,
  WorkingMemory,
  RecallMemory,
  ArchivalMemory,
  MemoryHierarchy,
};
