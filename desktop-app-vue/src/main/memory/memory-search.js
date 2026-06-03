/**
 * Memory Search System
 *
 * Advanced memory retrieval with RAG integration:
 * - Semantic search via embeddings
 * - Keyword matching
 * - Temporal filtering
 * - Importance weighting
 *
 * @module memory-search
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");

/**
 * Search modes
 */
const SearchMode = {
  SEMANTIC: "semantic", // Vector similarity
  KEYWORD: "keyword", // Text matching
  HYBRID: "hybrid", // Combined
  TEMPORAL: "temporal", // Time-based
};

/**
 * Memory Search Engine
 */
class MemorySearchEngine {
  constructor(config = {}) {
    this.config = {
      defaultMode: SearchMode.HYBRID,
      semanticWeight: 0.6,
      keywordWeight: 0.4,
      minRelevance: 0.3,
      maxResults: 20,
      enableCaching: true,
      cacheMaxSize: 100,
      cacheTTL: 5 * 60 * 1000, // 5 minutes
      ...config,
    };

    this.memoryHierarchy = null;
    this.ragManager = null;
    this.embeddingClient = null;

    // Search cache
    this.cache = new Map();
    this.cacheTimestamps = new Map();
  }

  /**
   * Set memory hierarchy
   * @param {MemoryHierarchy} memoryHierarchy - Memory hierarchy instance
   */
  setMemoryHierarchy(memoryHierarchy) {
    this.memoryHierarchy = memoryHierarchy;
  }

  /**
   * Set RAG manager for semantic search
   * @param {Object} ragManager - RAG manager instance
   */
  setRagManager(ragManager) {
    this.ragManager = ragManager;
  }

  /**
   * Set embedding client
   * @param {Object} embeddingClient - Embedding client instance
   */
  setEmbeddingClient(embeddingClient) {
    this.embeddingClient = embeddingClient;
  }

  /**
   * Search memories
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async search(query, options = {}) {
    const {
      mode = this.config.defaultMode,
      limit = this.config.maxResults,
      minRelevance = this.config.minRelevance,
      types = null,
      timeRange = null,
      includeArchival = true,
    } = options;

    // Check cache
    const cacheKey = this._getCacheKey(query, options);
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      logger.debug("[MemorySearch] Cache hit for:", query);
      return cached;
    }

    let results = [];

    try {
      switch (mode) {
        case SearchMode.SEMANTIC:
          results = await this._semanticSearch(query, {
            limit,
            types,
            includeArchival,
          });
          break;

        case SearchMode.KEYWORD:
          results = await this._keywordSearch(query, {
            limit,
            types,
            includeArchival,
          });
          break;

        case SearchMode.HYBRID:
          results = await this._hybridSearch(query, {
            limit,
            types,
            includeArchival,
          });
          break;

        case SearchMode.TEMPORAL:
          results = await this._temporalSearch(query, {
            limit,
            types,
            timeRange,
          });
          break;

        default:
          results = await this._hybridSearch(query, {
            limit,
            types,
            includeArchival,
          });
      }

      // Filter by relevance
      results = results.filter(
        (r) => (r.relevance || r.score || 0) >= minRelevance,
      );

      // Sort by relevance
      results.sort(
        (a, b) => (b.relevance || b.score || 0) - (a.relevance || a.score || 0),
      );

      // Limit results
      results = results.slice(0, limit);

      // Cache results
      this._addToCache(cacheKey, results);

      return results;
    } catch (error) {
      logger.error("[MemorySearch] Search failed:", error);
      return [];
    }
  }

  /**
   * Semantic search using embeddings
   * @private
   */
  async _semanticSearch(query, options) {
    const { limit, types, includeArchival } = options;
    const results = [];

    // Search via RAG manager
    if (this.ragManager) {
      try {
        const ragResults = await this.ragManager.search(query, {
          topK: limit * 2, // Get more to filter
          filter: types ? { type: { $in: types } } : undefined,
        });

        for (const result of ragResults) {
          results.push({
            id: result.id,
            content: result.content,
            type: result.metadata?.type || "unknown",
            relevance: result.score,
            source: "semantic",
            metadata: result.metadata,
          });
        }
      } catch (error) {
        logger.warn("[MemorySearch] RAG search failed:", error.message);
      }
    }

    // Also search archival memory directly if available
    if (includeArchival && this.memoryHierarchy) {
      try {
        const archivalResults = await this.memoryHierarchy.archival.search(
          query,
          {
            limit,
            type: types?.[0],
            useVector: true,
          },
        );

        for (const memory of archivalResults) {
          if (!results.find((r) => r.id === memory.id)) {
            results.push({
              id: memory.id,
              content: memory.content,
              type: memory.type,
              relevance: memory.score || 0.5,
              source: "archival",
              metadata: memory.metadata,
            });
          }
        }
      } catch (error) {
        logger.warn("[MemorySearch] Archival search failed:", error.message);
      }
    }

    return results;
  }

  /**
   * Keyword search using text matching
   * @private
   */
  async _keywordSearch(query, options) {
    const { limit, types, includeArchival } = options;
    const results = [];

    if (!this.memoryHierarchy) {
      return results;
    }

    // Search recall memory
    const recallResults = this.memoryHierarchy.recall.search(query, limit);
    for (const memory of recallResults) {
      if (!types || types.includes(memory.type)) {
        results.push({
          id: memory.id,
          content: memory.content,
          type: memory.type,
          relevance: this._calculateKeywordRelevance(query, memory.content),
          source: "recall",
          metadata: memory.metadata,
        });
      }
    }

    // Search archival memory
    if (includeArchival) {
      try {
        const archivalResults = await this.memoryHierarchy.archival.search(
          query,
          {
            limit,
            type: types?.[0],
            useVector: false, // Keyword only
          },
        );

        for (const memory of archivalResults) {
          if (!results.find((r) => r.id === memory.id)) {
            results.push({
              id: memory.id,
              content: memory.content,
              type: memory.type,
              relevance: this._calculateKeywordRelevance(query, memory.content),
              source: "archival",
              metadata: memory.metadata,
            });
          }
        }
      } catch (error) {
        logger.warn(
          "[MemorySearch] Archival keyword search failed:",
          error.message,
        );
      }
    }

    return results;
  }

  /**
   * Hybrid search combining semantic and keyword
   * @private
   */
  async _hybridSearch(query, options) {
    const [semanticResults, keywordResults] = await Promise.all([
      this._semanticSearch(query, options),
      this._keywordSearch(query, options),
    ]);

    // Merge results with weighted scores
    const merged = new Map();

    for (const result of semanticResults) {
      merged.set(result.id, {
        ...result,
        semanticScore: result.relevance,
        keywordScore: 0,
      });
    }

    for (const result of keywordResults) {
      if (merged.has(result.id)) {
        const existing = merged.get(result.id);
        existing.keywordScore = result.relevance;
      } else {
        merged.set(result.id, {
          ...result,
          semanticScore: 0,
          keywordScore: result.relevance,
        });
      }
    }

    // Calculate combined relevance
    const results = Array.from(merged.values()).map((r) => ({
      ...r,
      relevance:
        r.semanticScore * this.config.semanticWeight +
        r.keywordScore * this.config.keywordWeight,
      source: "hybrid",
    }));

    return results;
  }

  /**
   * Temporal search - find memories by time
   * @private
   */
  async _temporalSearch(query, options) {
    const { limit, types, timeRange } = options;
    const results = [];

    if (!this.memoryHierarchy?.archival?.db) {
      return results;
    }

    try {
      const db = this.memoryHierarchy.archival.db;
      let sql = `
        SELECT * FROM long_term_memories
        WHERE 1=1
      `;
      const params = [];

      // Add time constraints
      if (timeRange?.start) {
        sql += " AND created_at >= ?";
        params.push(timeRange.start);
      }
      if (timeRange?.end) {
        sql += " AND created_at <= ?";
        params.push(timeRange.end);
      }

      // Add type filter
      if (types && types.length > 0) {
        sql += ` AND type IN (${types.map(() => "?").join(",")})`;
        params.push(...types);
      }

      // Add keyword search if query provided
      if (query) {
        sql += " AND content LIKE ?";
        params.push(`%${query}%`);
      }

      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const rows = await db.all(sql, params);

      for (const row of rows) {
        results.push({
          id: row.id,
          content: JSON.parse(row.content || "{}"),
          type: row.type,
          relevance: row.importance || 0.5,
          source: "temporal",
          createdAt: row.created_at,
          metadata: JSON.parse(row.metadata || "{}"),
        });
      }
    } catch (error) {
      logger.error("[MemorySearch] Temporal search failed:", error);
    }

    return results;
  }

  /**
   * Find related memories
   * @param {string} memoryId - Source memory ID
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Related memories
   */
  async findRelated(memoryId, limit = 5) {
    if (!this.memoryHierarchy) {
      return [];
    }

    // Get the source memory
    const sourceMemory = await this.memoryHierarchy.archival.get(memoryId);
    if (!sourceMemory) {
      return [];
    }

    // Search for similar content
    const content =
      typeof sourceMemory.content === "string"
        ? sourceMemory.content
        : JSON.stringify(sourceMemory.content);

    const results = await this.search(content, {
      mode: SearchMode.SEMANTIC,
      limit: limit + 1, // +1 to exclude self
    });

    // Exclude the source memory
    return results.filter((r) => r.id !== memoryId).slice(0, limit);
  }

  /**
   * Get context-relevant memories for conversation
   * @param {string} context - Current conversation context
   * @param {Object} options - Options
   * @returns {Promise<Array>} Relevant memories
   */
  async getContextualMemories(context, options = {}) {
    const {
      limit = 5,
      includeUserFacts = true,
      includeConversations = true,
      includePatterns = false,
    } = options;

    const types = [];
    if (includeUserFacts) {
      types.push("fact");
    }
    if (includeConversations) {
      types.push("conversation");
    }
    if (includePatterns) {
      types.push("pattern");
    }

    // Extract key concepts from context
    const keywords = this._extractKeywords(context);
    const query = keywords.join(" ");

    const results = await this.search(query, {
      mode: SearchMode.HYBRID,
      limit,
      types: types.length > 0 ? types : null,
    });

    return results;
  }

  /**
   * Calculate keyword relevance score
   * @private
   */
  _calculateKeywordRelevance(query, content) {
    const queryLower = query.toLowerCase();
    const contentStr =
      typeof content === "string"
        ? content.toLowerCase()
        : JSON.stringify(content).toLowerCase();

    // Calculate match ratio
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 2);
    let matchCount = 0;

    for (const word of queryWords) {
      if (contentStr.includes(word)) {
        matchCount++;
      }
    }

    const baseScore =
      queryWords.length > 0 ? matchCount / queryWords.length : 0;

    // Boost for exact phrase match
    const exactMatch = contentStr.includes(queryLower) ? 0.3 : 0;

    return Math.min(baseScore + exactMatch, 1.0);
  }

  /**
   * Extract keywords from text
   * @private
   */
  _extractKeywords(text) {
    // Simple keyword extraction
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);

    // Remove common stop words
    const stopWords = new Set([
      "this",
      "that",
      "with",
      "from",
      "have",
      "been",
      "will",
      "would",
      "could",
      "should",
      "what",
      "when",
      "where",
      "which",
      "there",
      "their",
      "about",
      "into",
    ]);

    const keywords = words.filter((w) => !stopWords.has(w));

    // Return unique keywords
    return [...new Set(keywords)].slice(0, 10);
  }

  /**
   * Get cache key
   * @private
   */
  _getCacheKey(query, options) {
    return `${query}::${JSON.stringify(options)}`;
  }

  /**
   * Get from cache
   * @private
   */
  _getFromCache(key) {
    if (!this.config.enableCaching) {
      return null;
    }

    const timestamp = this.cacheTimestamps.get(key);
    if (!timestamp || Date.now() - timestamp > this.config.cacheTTL) {
      this.cache.delete(key);
      this.cacheTimestamps.delete(key);
      return null;
    }

    return this.cache.get(key);
  }

  /**
   * Add to cache
   * @private
   */
  _addToCache(key, results) {
    if (!this.config.enableCaching) {
      return;
    }

    // Evict old entries if over size
    if (this.cache.size >= this.config.cacheMaxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.cacheTimestamps.delete(oldestKey);
    }

    this.cache.set(key, results);
    this.cacheTimestamps.set(key, Date.now());
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheTimestamps.clear();
  }

  /**
   * Get statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      cacheMaxSize: this.config.cacheMaxSize,
      cacheEnabled: this.config.enableCaching,
      defaultMode: this.config.defaultMode,
      hasRagManager: !!this.ragManager,
      hasMemoryHierarchy: !!this.memoryHierarchy,
    };
  }
}

module.exports = {
  SearchMode,
  MemorySearchEngine,
};
