/**
 * MemGPT IPC Handlers
 *
 * Provides IPC interface for MemGPT memory system:
 * - Memory search and retrieval
 * - Memory management operations
 * - Statistics and status
 *
 * @module memgpt-ipc
 * @version 1.0.0
 */

const { ipcMain } = require('electron');
const { logger } = require('../utils/logger.js');

/**
 * Register MemGPT IPC handlers
 * @param {Object} options - Options
 * @param {MemGPTCore} options.memgptCore - MemGPT Core instance
 * @param {Object} [options.ipcMain] - Custom IPC main (for testing)
 * @returns {Object} Handler update functions
 */
function registerMemGPTIPC(options = {}) {
  const { memgptCore, ipcMain: customIpcMain } = options;
  const ipc = customIpcMain || ipcMain;

  let currentMemGPT = memgptCore;

  logger.info('[MemGPTIPC] Registering IPC handlers...');

  // ====== Status & Stats ======

  /**
   * Check MemGPT status
   */
  ipc.handle('memgpt:check-status', async () => {
    if (!currentMemGPT) {
      return {
        available: false,
        error: 'MemGPT not initialized',
      };
    }

    try {
      const stats = await currentMemGPT.getStats();
      return {
        available: true,
        initialized: currentMemGPT.initialized,
        enabled: currentMemGPT.config.enabled,
        stats,
      };
    } catch (error) {
      logger.error('[MemGPTIPC] Status check failed:', error);
      return {
        available: false,
        error: error.message,
      };
    }
  });

  /**
   * Get memory statistics
   */
  ipc.handle('memgpt:get-stats', async () => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const stats = await currentMemGPT.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error('[MemGPTIPC] Get stats failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Core Memory Operations ======

  /**
   * Get core memory content
   */
  ipc.handle('memgpt:get-core-memory', async () => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    return {
      success: true,
      persona: currentMemGPT.coreMemory.persona,
      human: currentMemGPT.coreMemory.human,
    };
  });

  /**
   * Update core memory
   */
  ipc.handle('memgpt:update-core-memory', async (event, { section, content }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const result = await currentMemGPT.executeTool('core_memory_append', {
        section,
        content,
      });
      return result;
    } catch (error) {
      logger.error('[MemGPTIPC] Update core memory failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Replace core memory content
   */
  ipc.handle('memgpt:replace-core-memory', async (event, { section, oldContent, newContent }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const result = await currentMemGPT.executeTool('core_memory_replace', {
        section,
        old_content: oldContent,
        new_content: newContent,
      });
      return result;
    } catch (error) {
      logger.error('[MemGPTIPC] Replace core memory failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Memory Search ======

  /**
   * Search memories
   */
  ipc.handle('memgpt:search', async (event, { query, options = {} }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const results = await currentMemGPT.retrieveRelevantMemories(query, options);
      return {
        success: true,
        count: results.length,
        results,
      };
    } catch (error) {
      logger.error('[MemGPTIPC] Search failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Search recall memory
   */
  ipc.handle('memgpt:search-recall', async (event, { query, limit = 10 }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const result = await currentMemGPT.executeTool('recall_memory_search', {
        query,
        limit,
      });
      return result;
    } catch (error) {
      logger.error('[MemGPTIPC] Search recall failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Search archival memory
   */
  ipc.handle('memgpt:search-archival', async (event, { query, limit = 10 }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const result = await currentMemGPT.executeTool('archival_memory_search', {
        query,
        limit,
      });
      return result;
    } catch (error) {
      logger.error('[MemGPTIPC] Search archival failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Search conversations
   */
  ipc.handle('memgpt:search-conversations', async (event, { query, startDate, endDate }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const result = await currentMemGPT.executeTool('conversation_search', {
        query,
        start_date: startDate,
        end_date: endDate,
      });
      return result;
    } catch (error) {
      logger.error('[MemGPTIPC] Search conversations failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Memory Management ======

  /**
   * Archive memory
   */
  ipc.handle('memgpt:archive', async (event, { content, importance, type }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const result = await currentMemGPT.executeTool('archival_memory_insert', {
        content,
        importance: importance || 0.5,
        type: type || 'fact',
      });
      return result;
    } catch (error) {
      logger.error('[MemGPTIPC] Archive failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Learn user fact
   */
  ipc.handle('memgpt:learn-fact', async (event, { fact, importance }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      await currentMemGPT.learnUserFact(fact, importance);
      return { success: true, message: 'Fact learned successfully' };
    } catch (error) {
      logger.error('[MemGPTIPC] Learn fact failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Process message (add to conversation memory)
   */
  ipc.handle('memgpt:process-message', async (event, { role, content }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      await currentMemGPT.processMessage({ role, content });
      return { success: true };
    } catch (error) {
      logger.error('[MemGPTIPC] Process message failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get memory context for LLM
   */
  ipc.handle('memgpt:get-context', async () => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const context = currentMemGPT.getMemoryContext();
      return { success: true, context };
    } catch (error) {
      logger.error('[MemGPTIPC] Get context failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Clear session memory
   */
  ipc.handle('memgpt:clear-session', async () => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      currentMemGPT.clearSession();
      return { success: true, message: 'Session memory cleared' };
    } catch (error) {
      logger.error('[MemGPTIPC] Clear session failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Memory Hierarchy ======

  /**
   * Get working memory
   */
  ipc.handle('memgpt:get-working-memory', async () => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const memories = currentMemGPT.memoryHierarchy.working.getAll();
      const stats = currentMemGPT.memoryHierarchy.working.getStats();
      return {
        success: true,
        memories,
        stats,
      };
    } catch (error) {
      logger.error('[MemGPTIPC] Get working memory failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get recall memory
   */
  ipc.handle('memgpt:get-recall-memory', async (event, { limit = 20 }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const memories = currentMemGPT.memoryHierarchy.recall.getRecent(limit);
      const stats = currentMemGPT.memoryHierarchy.recall.getStats();
      return {
        success: true,
        memories,
        stats,
      };
    } catch (error) {
      logger.error('[MemGPTIPC] Get recall memory failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get archival memory stats
   */
  ipc.handle('memgpt:get-archival-stats', async () => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const stats = await currentMemGPT.memoryHierarchy.archival.getStats();
      return { success: true, stats };
    } catch (error) {
      logger.error('[MemGPTIPC] Get archival stats failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get important memories
   */
  ipc.handle('memgpt:get-important-memories', async (event, { limit = 20 }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const memories = await currentMemGPT.memoryHierarchy.archival.getMostImportant(limit);
      return { success: true, memories };
    } catch (error) {
      logger.error('[MemGPTIPC] Get important memories failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get memories by type
   */
  ipc.handle('memgpt:get-memories-by-type', async (event, { type, limit = 50 }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const memories = await currentMemGPT.memoryHierarchy.archival.getByType(type, limit);
      return { success: true, memories };
    } catch (error) {
      logger.error('[MemGPTIPC] Get memories by type failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update memory importance
   */
  ipc.handle('memgpt:update-importance', async (event, { memoryId, importance }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      await currentMemGPT.memoryHierarchy.archival.updateImportance(memoryId, importance);
      return { success: true };
    } catch (error) {
      logger.error('[MemGPTIPC] Update importance failed:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete memory
   */
  ipc.handle('memgpt:delete-memory', async (event, { memoryId }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const success = await currentMemGPT.memoryHierarchy.archival.delete(memoryId);
      return { success };
    } catch (error) {
      logger.error('[MemGPTIPC] Delete memory failed:', error);
      return { success: false, error: error.message };
    }
  });

  // ====== Tool Interface ======

  /**
   * Get memory tools for function calling
   */
  ipc.handle('memgpt:get-tools', async () => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized', tools: [] };
    }

    const tools = currentMemGPT.getTools();
    return { success: true, tools };
  });

  /**
   * Execute memory tool
   */
  ipc.handle('memgpt:execute-tool', async (event, { toolName, params }) => {
    if (!currentMemGPT) {
      return { success: false, error: 'MemGPT not initialized' };
    }

    try {
      const result = await currentMemGPT.executeTool(toolName, params);
      return result;
    } catch (error) {
      logger.error('[MemGPTIPC] Execute tool failed:', error);
      return { success: false, error: error.message };
    }
  });

  logger.info('[MemGPTIPC] IPC handlers registered (24 channels)');

  // Return update function for hot-reload
  return {
    updateMemGPT: (newMemGPT) => {
      currentMemGPT = newMemGPT;
      logger.info('[MemGPTIPC] MemGPT instance updated');
    },
  };
}

module.exports = {
  registerMemGPTIPC,
};
