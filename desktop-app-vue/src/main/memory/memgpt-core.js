/**
 * MemGPT Core - Self-Editing Memory System
 *
 * Implements MemGPT-style memory management:
 * - Autonomous memory management via function calls
 * - Working/Recall/Archival memory hierarchy
 * - Self-editing capabilities
 * - Context window optimization
 *
 * @module memgpt-core
 * @version 1.0.0
 */

const EventEmitter = require('events');
const { logger } = require('../utils/logger.js');
const { MemoryHierarchy, MemoryType, MemoryImportance } = require('./memory-hierarchy.js');
const { MemorySearchEngine, SearchMode } = require('./memory-search.js');

/**
 * MemGPT Memory Tools - Functions exposed to LLM
 */
const MEMGPT_TOOLS = {
  // Core memory operations
  core_memory_append: {
    name: 'core_memory_append',
    description: 'Append to core memory (persona or human section). Use this to add new information about yourself or the human.',
    parameters: {
      section: {
        type: 'string',
        description: 'Memory section: "persona" (about AI) or "human" (about user)',
        enum: ['persona', 'human'],
        required: true,
      },
      content: {
        type: 'string',
        description: 'Content to append',
        required: true,
      },
    },
  },

  core_memory_replace: {
    name: 'core_memory_replace',
    description: 'Replace content in core memory. Use this to update existing information.',
    parameters: {
      section: {
        type: 'string',
        description: 'Memory section: "persona" or "human"',
        enum: ['persona', 'human'],
        required: true,
      },
      old_content: {
        type: 'string',
        description: 'Content to replace',
        required: true,
      },
      new_content: {
        type: 'string',
        description: 'New content',
        required: true,
      },
    },
  },

  // Recall memory operations
  recall_memory_search: {
    name: 'recall_memory_search',
    description: 'Search recent conversation memory. Use this to find something said recently.',
    parameters: {
      query: {
        type: 'string',
        description: 'Search query',
        required: true,
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 5)',
        default: 5,
      },
    },
  },

  // Archival memory operations
  archival_memory_insert: {
    name: 'archival_memory_insert',
    description: 'Insert into archival memory. Use this to save important information for long-term.',
    parameters: {
      content: {
        type: 'string',
        description: 'Content to archive',
        required: true,
      },
      importance: {
        type: 'number',
        description: 'Importance score 0-1 (default: 0.5)',
        default: 0.5,
      },
      type: {
        type: 'string',
        description: 'Memory type: fact, conversation, task, pattern',
        enum: ['fact', 'conversation', 'task', 'pattern'],
        default: 'fact',
      },
    },
  },

  archival_memory_search: {
    name: 'archival_memory_search',
    description: 'Search archival memory. Use this to find information from long-term storage.',
    parameters: {
      query: {
        type: 'string',
        description: 'Search query',
        required: true,
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 10)',
        default: 10,
      },
    },
  },

  // Memory management
  conversation_search: {
    name: 'conversation_search',
    description: 'Search through past conversations by date range or keywords.',
    parameters: {
      query: {
        type: 'string',
        description: 'Search query',
        required: true,
      },
      start_date: {
        type: 'string',
        description: 'Start date (ISO format)',
        required: false,
      },
      end_date: {
        type: 'string',
        description: 'End date (ISO format)',
        required: false,
      },
    },
  },
};

/**
 * MemGPT Core - Main class
 */
class MemGPTCore extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      enabled: config.enabled !== false,
      workingMemoryTokens: config.workingMemoryTokens || 4000,
      archivalSearchTopK: config.archivalSearchTopK || 10,
      autoArchiveThreshold: config.autoArchiveThreshold || 20,
      importanceThreshold: config.importanceThreshold || 0.7,
      enableAutoSummarize: config.enableAutoSummarize !== false,
      summarizeThreshold: config.summarizeThreshold || 2000, // tokens
      ...config,
    };

    // Core components
    this.memoryHierarchy = new MemoryHierarchy({
      workingMemoryTokens: this.config.workingMemoryTokens,
      recallMemorySize: 100,
      autoArchiveThreshold: this.config.autoArchiveThreshold,
      importanceThreshold: this.config.importanceThreshold,
    });

    this.searchEngine = new MemorySearchEngine({
      maxResults: this.config.archivalSearchTopK,
    });
    this.searchEngine.setMemoryHierarchy(this.memoryHierarchy);

    // Core memory sections
    this.coreMemory = {
      persona: '', // AI's self-description
      human: '',   // Information about the user
    };

    // Dependencies
    this.db = null;
    this.llmManager = null;
    this.ragManager = null;

    // State
    this.initialized = false;
    this.conversationBuffer = [];
    this.stats = {
      memoryOperations: 0,
      archivalInserts: 0,
      searches: 0,
      summarizations: 0,
    };

    logger.info('[MemGPTCore] Initialized with config:', {
      workingMemoryTokens: this.config.workingMemoryTokens,
      archivalSearchTopK: this.config.archivalSearchTopK,
    });
  }

  /**
   * Initialize the memory system
   * @param {Object} options - Initialization options
   */
  async initialize(options = {}) {
    const { database, llmManager, ragManager, userId } = options;

    if (database) {
      this.setDatabase(database);
    }
    if (llmManager) {
      this.setLLMManager(llmManager);
    }
    if (ragManager) {
      this.setRagManager(ragManager);
    }

    this.userId = userId || 'default';

    // Ensure database table exists
    await this._ensureTable();

    // Load core memory from database
    await this._loadCoreMemory();

    this.initialized = true;
    logger.info('[MemGPTCore] Initialization complete');
  }

  /**
   * Set database instance
   * @param {Object} db - Database instance
   */
  setDatabase(db) {
    this.db = db;
    this.memoryHierarchy.setDatabase(db);
  }

  /**
   * Set LLM manager for summarization
   * @param {Object} llmManager - LLM manager instance
   */
  setLLMManager(llmManager) {
    this.llmManager = llmManager;
  }

  /**
   * Set RAG manager for vector search
   * @param {Object} ragManager - RAG manager instance
   */
  setRagManager(ragManager) {
    this.ragManager = ragManager;
    this.memoryHierarchy.setRagManager(ragManager);
    this.searchEngine.setRagManager(ragManager);
  }

  /**
   * Get memory tools for function calling
   * @returns {Array} Tool definitions
   */
  getTools() {
    if (!this.config.enabled) {
      return [];
    }
    return Object.values(MEMGPT_TOOLS);
  }

  /**
   * Execute a memory tool
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool result
   */
  async executeTool(toolName, params) {
    this.stats.memoryOperations++;

    switch (toolName) {
      case 'core_memory_append':
        return await this._coreMemoryAppend(params);

      case 'core_memory_replace':
        return await this._coreMemoryReplace(params);

      case 'recall_memory_search':
        return await this._recallMemorySearch(params);

      case 'archival_memory_insert':
        return await this._archivalMemoryInsert(params);

      case 'archival_memory_search':
        return await this._archivalMemorySearch(params);

      case 'conversation_search':
        return await this._conversationSearch(params);

      default:
        throw new Error(`Unknown memory tool: ${toolName}`);
    }
  }

  /**
   * Process a conversation turn
   * @param {Object} message - User or assistant message
   */
  async processMessage(message) {
    const { role, content } = message;

    // Add to conversation buffer
    this.conversationBuffer.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // Add to recall memory
    const recallId = await this.memoryHierarchy.addMemory({
      type: MemoryType.CONVERSATION,
      content: { role, content },
      importance: MemoryImportance.MEDIUM,
    }, 'recall');

    // Check if we need to summarize
    if (this.config.enableAutoSummarize) {
      await this._checkAndSummarize();
    }

    // Auto-manage memory hierarchy
    await this.memoryHierarchy.autoManage();

    this.emit('message-processed', { role, recallId });
  }

  /**
   * Get context for LLM prompt
   * @returns {string} Memory context
   */
  getMemoryContext() {
    let context = '';

    // Core memory
    if (this.coreMemory.persona) {
      context += `[AI Persona]\n${this.coreMemory.persona}\n\n`;
    }
    if (this.coreMemory.human) {
      context += `[User Info]\n${this.coreMemory.human}\n\n`;
    }

    // Working memory
    const workingContext = this.memoryHierarchy.working.getContext();
    if (workingContext) {
      context += workingContext + '\n';
    }

    return context;
  }

  /**
   * Retrieve relevant memories for a query
   * @param {string} query - Query string
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Relevant memories
   */
  async retrieveRelevantMemories(query, options = {}) {
    this.stats.searches++;

    const results = await this.searchEngine.search(query, {
      mode: SearchMode.HYBRID,
      limit: options.limit || this.config.archivalSearchTopK,
      types: options.types,
    });

    // Optionally promote to working memory
    if (options.promoteToWorking && results.length > 0) {
      for (const result of results.slice(0, 3)) {
        this.memoryHierarchy.promoteToWorking(result.id);
      }
    }

    return results;
  }

  /**
   * Learn a fact about the user
   * @param {string} fact - Fact to learn
   * @param {number} importance - Importance score
   */
  async learnUserFact(fact, importance = MemoryImportance.HIGH) {
    // Add to core memory (human section)
    if (!this.coreMemory.human.includes(fact)) {
      this.coreMemory.human += `\n- ${fact}`;
      await this._saveCoreMemory();
    }

    // Also archive it
    await this._archivalMemoryInsert({
      content: fact,
      type: MemoryType.FACT,
      importance,
    });

    this.emit('fact-learned', { fact, importance });
  }

  /**
   * Get memory statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    const hierarchyStats = await this.memoryHierarchy.getStats();
    const searchStats = this.searchEngine.getStats();

    return {
      ...this.stats,
      hierarchy: hierarchyStats,
      search: searchStats,
      coreMemory: {
        personaLength: this.coreMemory.persona.length,
        humanLength: this.coreMemory.human.length,
      },
      conversationBufferSize: this.conversationBuffer.length,
    };
  }

  /**
   * Clear session memory (keep archival)
   */
  clearSession() {
    this.memoryHierarchy.clear(['working', 'recall']);
    this.conversationBuffer = [];
    logger.info('[MemGPTCore] Session memory cleared');
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.clearSession();
    this.searchEngine.clearCache();
    this.initialized = false;
  }

  // ========== Private Methods ==========

  /**
   * Ensure database table exists
   * @private
   */
  async _ensureTable() {
    if (!this.db) return;

    try {
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS long_term_memories (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          importance REAL DEFAULT 0.5,
          metadata TEXT DEFAULT '{}',
          embedding BLOB,
          created_at INTEGER NOT NULL,
          accessed_at INTEGER NOT NULL,
          access_count INTEGER DEFAULT 0
        )
      `);

      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_memories_user ON long_term_memories(user_id)
      `);

      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_memories_type ON long_term_memories(type)
      `);

      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON long_term_memories(importance)
      `);

      // Core memory table
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS core_memory (
          user_id TEXT PRIMARY KEY,
          persona TEXT DEFAULT '',
          human TEXT DEFAULT '',
          updated_at INTEGER NOT NULL
        )
      `);

      logger.info('[MemGPTCore] Database tables ensured');
    } catch (error) {
      logger.error('[MemGPTCore] Failed to ensure tables:', error);
    }
  }

  /**
   * Load core memory from database
   * @private
   */
  async _loadCoreMemory() {
    if (!this.db) return;

    try {
      const row = await this.db.get(`
        SELECT persona, human FROM core_memory WHERE user_id = ?
      `, [this.userId]);

      if (row) {
        this.coreMemory.persona = row.persona || '';
        this.coreMemory.human = row.human || '';
        logger.info('[MemGPTCore] Core memory loaded');
      }
    } catch (error) {
      logger.warn('[MemGPTCore] Failed to load core memory:', error.message);
    }
  }

  /**
   * Save core memory to database
   * @private
   */
  async _saveCoreMemory() {
    if (!this.db) return;

    try {
      await this.db.run(`
        INSERT OR REPLACE INTO core_memory (user_id, persona, human, updated_at)
        VALUES (?, ?, ?, ?)
      `, [
        this.userId,
        this.coreMemory.persona,
        this.coreMemory.human,
        Date.now(),
      ]);
    } catch (error) {
      logger.error('[MemGPTCore] Failed to save core memory:', error);
    }
  }

  /**
   * Core memory append implementation
   * @private
   */
  async _coreMemoryAppend(params) {
    const { section, content } = params;

    if (!['persona', 'human'].includes(section)) {
      throw new Error('Invalid section. Use "persona" or "human".');
    }

    this.coreMemory[section] += `\n${content}`;
    await this._saveCoreMemory();

    this.emit('core-memory-updated', { section, action: 'append' });

    return {
      success: true,
      message: `Appended to ${section} memory`,
      newContent: this.coreMemory[section],
    };
  }

  /**
   * Core memory replace implementation
   * @private
   */
  async _coreMemoryReplace(params) {
    const { section, old_content, new_content } = params;

    if (!['persona', 'human'].includes(section)) {
      throw new Error('Invalid section. Use "persona" or "human".');
    }

    if (!this.coreMemory[section].includes(old_content)) {
      return {
        success: false,
        message: `Content not found in ${section} memory`,
      };
    }

    this.coreMemory[section] = this.coreMemory[section].replace(old_content, new_content);
    await this._saveCoreMemory();

    this.emit('core-memory-updated', { section, action: 'replace' });

    return {
      success: true,
      message: `Replaced content in ${section} memory`,
      newContent: this.coreMemory[section],
    };
  }

  /**
   * Recall memory search implementation
   * @private
   */
  async _recallMemorySearch(params) {
    const { query, limit = 5 } = params;

    const results = this.memoryHierarchy.recall.search(query, limit);

    return {
      success: true,
      count: results.length,
      memories: results.map(m => ({
        content: m.content,
        timestamp: m.storedAt,
        type: m.type,
      })),
    };
  }

  /**
   * Archival memory insert implementation
   * @private
   */
  async _archivalMemoryInsert(params) {
    const { content, importance = 0.5, type = 'fact' } = params;

    this.stats.archivalInserts++;

    const id = await this.memoryHierarchy.archival.store({
      userId: this.userId,
      type,
      content,
      importance,
      metadata: { source: 'memgpt' },
    });

    this.emit('memory-archived', { id, type });

    return {
      success: true,
      message: 'Memory archived successfully',
      memoryId: id,
    };
  }

  /**
   * Archival memory search implementation
   * @private
   */
  async _archivalMemorySearch(params) {
    const { query, limit = 10 } = params;

    this.stats.searches++;

    const results = await this.memoryHierarchy.archival.search(query, { limit });

    return {
      success: true,
      count: results.length,
      memories: results.map(m => ({
        id: m.id,
        content: m.content,
        type: m.type,
        importance: m.importance,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Conversation search implementation
   * @private
   */
  async _conversationSearch(params) {
    const { query, start_date, end_date } = params;

    const timeRange = {};
    if (start_date) {
      timeRange.start = new Date(start_date).getTime();
    }
    if (end_date) {
      timeRange.end = new Date(end_date).getTime();
    }

    const results = await this.searchEngine.search(query, {
      mode: SearchMode.TEMPORAL,
      timeRange: Object.keys(timeRange).length > 0 ? timeRange : null,
      types: ['conversation'],
      limit: 20,
    });

    return {
      success: true,
      count: results.length,
      conversations: results,
    };
  }

  /**
   * Check and summarize if needed
   * @private
   */
  async _checkAndSummarize() {
    const workingStats = this.memoryHierarchy.working.getStats();

    if (workingStats.currentTokens > this.config.summarizeThreshold) {
      await this._summarizeWorkingMemory();
    }
  }

  /**
   * Summarize working memory
   * @private
   */
  async _summarizeWorkingMemory() {
    if (!this.llmManager) {
      logger.warn('[MemGPTCore] No LLM manager for summarization');
      return;
    }

    const memories = this.memoryHierarchy.working.getAll();
    if (memories.length < 3) return;

    try {
      // Build content to summarize
      const content = memories.map(m => `[${m.type}] ${JSON.stringify(m.content)}`).join('\n');

      // Request summarization from LLM
      const response = await this.llmManager.chat({
        messages: [
          {
            role: 'system',
            content: 'Summarize the following conversation memories into key points. Be concise.',
          },
          {
            role: 'user',
            content,
          },
        ],
        maxTokens: 500,
      });

      const summary = response?.content || response?.message?.content;
      if (summary) {
        // Archive the summary
        await this._archivalMemoryInsert({
          content: summary,
          type: MemoryType.CONVERSATION,
          importance: MemoryImportance.HIGH,
        });

        // Clear old memories from working
        this.memoryHierarchy.working.clear();

        // Add summary to working
        this.memoryHierarchy.working.add({
          type: MemoryType.CONVERSATION,
          content: `[Previous Summary]: ${summary}`,
          importance: MemoryImportance.HIGH,
        });

        this.stats.summarizations++;
        logger.info('[MemGPTCore] Working memory summarized');
      }
    } catch (error) {
      logger.error('[MemGPTCore] Summarization failed:', error);
    }
  }
}

// Singleton instance
let memgptInstance = null;

/**
 * Get MemGPT Core singleton
 * @param {Object} config - Configuration
 * @returns {MemGPTCore}
 */
function getMemGPTCore(config) {
  if (!memgptInstance) {
    memgptInstance = new MemGPTCore(config);
  }
  return memgptInstance;
}

module.exports = {
  MemGPTCore,
  getMemGPTCore,
  MEMGPT_TOOLS,
};
