/**
 * MemGPT Memory Tools Integration
 *
 * Registers MemGPT memory tools with the function caller:
 * - Core memory operations (append, replace)
 * - Recall memory search
 * - Archival memory operations
 * - Conversation search
 *
 * @module extended-tools-memgpt
 * @version 1.0.0
 */

const { logger } = require('../utils/logger.js');

/**
 * MemGPT Tools Handler
 */
class MemGPTToolsHandler {
  constructor() {
    this.memgptCore = null;
  }

  /**
   * Set MemGPTCore reference
   * @param {Object} memgptCore - MemGPTCore instance
   */
  setMemGPTCore(memgptCore) {
    this.memgptCore = memgptCore;
    logger.info('[MemGPTTools] MemGPTCore reference set');
  }

  /**
   * Register all MemGPT tools
   * @param {FunctionCaller} functionCaller - Function caller instance
   */
  register(functionCaller) {
    const self = this;

    // ====== Core Memory Tools ======

    functionCaller.registerTool(
      'memory_core_append',
      async (params, context) => {
        if (!self.memgptCore) {
          throw new Error('MemGPT not initialized');
        }

        const { section, content } = params;

        if (!section || !['persona', 'human'].includes(section)) {
          throw new Error('Invalid section. Use "persona" or "human".');
        }

        if (!content || typeof content !== 'string') {
          throw new Error('Please provide content to append');
        }

        return await self.memgptCore.executeTool('core_memory_append', {
          section,
          content,
        });
      },
      {
        name: 'memory_core_append',
        description: 'Append information to core memory. Use "persona" section for AI self-description, "human" section for user information.',
        parameters: {
          section: {
            type: 'string',
            description: 'Memory section: "persona" (about AI) or "human" (about user)',
            enum: ['persona', 'human'],
            required: true,
          },
          content: {
            type: 'string',
            description: 'Content to append to memory',
            required: true,
          },
        },
      }
    );

    functionCaller.registerTool(
      'memory_core_replace',
      async (params, context) => {
        if (!self.memgptCore) {
          throw new Error('MemGPT not initialized');
        }

        const { section, old_content, new_content } = params;

        if (!section || !['persona', 'human'].includes(section)) {
          throw new Error('Invalid section. Use "persona" or "human".');
        }

        return await self.memgptCore.executeTool('core_memory_replace', {
          section,
          old_content,
          new_content,
        });
      },
      {
        name: 'memory_core_replace',
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
      }
    );

    // ====== Recall Memory Tools ======

    functionCaller.registerTool(
      'memory_recall_search',
      async (params, context) => {
        if (!self.memgptCore) {
          throw new Error('MemGPT not initialized');
        }

        const { query, limit = 5 } = params;

        if (!query || typeof query !== 'string') {
          throw new Error('Please provide a search query');
        }

        return await self.memgptCore.executeTool('recall_memory_search', {
          query,
          limit,
        });
      },
      {
        name: 'memory_recall_search',
        description: 'Search recent conversation memory. Use this to find something discussed recently.',
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
      }
    );

    // ====== Archival Memory Tools ======

    functionCaller.registerTool(
      'memory_archival_insert',
      async (params, context) => {
        if (!self.memgptCore) {
          throw new Error('MemGPT not initialized');
        }

        const { content, importance = 0.5, type = 'fact' } = params;

        if (!content || typeof content !== 'string') {
          throw new Error('Please provide content to archive');
        }

        return await self.memgptCore.executeTool('archival_memory_insert', {
          content,
          importance,
          type,
        });
      },
      {
        name: 'memory_archival_insert',
        description: 'Save important information to long-term archival memory. This persists across sessions.',
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
      }
    );

    functionCaller.registerTool(
      'memory_archival_search',
      async (params, context) => {
        if (!self.memgptCore) {
          throw new Error('MemGPT not initialized');
        }

        const { query, limit = 10 } = params;

        if (!query || typeof query !== 'string') {
          throw new Error('Please provide a search query');
        }

        return await self.memgptCore.executeTool('archival_memory_search', {
          query,
          limit,
        });
      },
      {
        name: 'memory_archival_search',
        description: 'Search long-term archival memory. Use this to recall information from past sessions.',
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
      }
    );

    // ====== Conversation Tools ======

    functionCaller.registerTool(
      'memory_conversation_search',
      async (params, context) => {
        if (!self.memgptCore) {
          throw new Error('MemGPT not initialized');
        }

        const { query, start_date, end_date } = params;

        if (!query || typeof query !== 'string') {
          throw new Error('Please provide a search query');
        }

        return await self.memgptCore.executeTool('conversation_search', {
          query,
          start_date,
          end_date,
        });
      },
      {
        name: 'memory_conversation_search',
        description: 'Search past conversations by keywords and date range.',
        parameters: {
          query: {
            type: 'string',
            description: 'Search query',
            required: true,
          },
          start_date: {
            type: 'string',
            description: 'Start date (ISO format, e.g. "2024-01-01")',
            required: false,
          },
          end_date: {
            type: 'string',
            description: 'End date (ISO format)',
            required: false,
          },
        },
      }
    );

    // ====== Memory Status Tool ======

    functionCaller.registerTool(
      'memory_status',
      async (params, context) => {
        if (!self.memgptCore) {
          return {
            available: false,
            error: 'MemGPT not initialized',
          };
        }

        const stats = await self.memgptCore.getStats();
        return {
          available: true,
          initialized: self.memgptCore.initialized,
          ...stats,
        };
      },
      {
        name: 'memory_status',
        description: 'Check long-term memory system status and statistics.',
        parameters: {},
      }
    );

    // ====== Learn User Fact Tool ======

    functionCaller.registerTool(
      'memory_learn_fact',
      async (params, context) => {
        if (!self.memgptCore) {
          throw new Error('MemGPT not initialized');
        }

        const { fact, importance = 0.7 } = params;

        if (!fact || typeof fact !== 'string') {
          throw new Error('Please provide a fact to learn');
        }

        await self.memgptCore.learnUserFact(fact, importance);

        return {
          success: true,
          message: `Learned user fact: ${fact}`,
        };
      },
      {
        name: 'memory_learn_fact',
        description: 'Learn and remember a fact about the user. This will be stored in both core and archival memory.',
        parameters: {
          fact: {
            type: 'string',
            description: 'Fact about the user to remember',
            required: true,
          },
          importance: {
            type: 'number',
            description: 'Importance score 0-1 (default: 0.7)',
            default: 0.7,
          },
        },
      }
    );

    logger.info('[MemGPTTools] 8 memory tools registered');
  }
}

// Singleton instance
let memgptToolsInstance = null;

/**
 * Get MemGPT Tools Handler singleton
 * @returns {MemGPTToolsHandler}
 */
function getMemGPTTools() {
  if (!memgptToolsInstance) {
    memgptToolsInstance = new MemGPTToolsHandler();
  }
  return memgptToolsInstance;
}

module.exports = {
  MemGPTToolsHandler,
  getMemGPTTools,
};
