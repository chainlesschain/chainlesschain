/**
 * @module ai-engine/memory/memory-v2-ipc
 * Phase 83: Memory v2 IPC handlers (8 handlers)
 */
const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

function registerMemoryV2IPC(deps) {
  const { hierarchicalMemory } = deps;

  ipcMain.handle("memory:store", async (event, { content, options }) => {
    try {
      if (!hierarchicalMemory) {
        return { success: false, error: "HierarchicalMemory not available" };
      }
      const result = hierarchicalMemory.store(content, options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MemoryV2IPC] store error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("memory:recall", async (event, { query, options }) => {
    try {
      if (!hierarchicalMemory) {
        return { success: false, error: "HierarchicalMemory not available" };
      }
      const results = hierarchicalMemory.recall(query, options || {});
      return { success: true, data: results };
    } catch (error) {
      logger.error("[MemoryV2IPC] recall error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("memory:consolidate", async () => {
    try {
      if (!hierarchicalMemory) {
        return { success: false, error: "HierarchicalMemory not available" };
      }
      const result = hierarchicalMemory.consolidate();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MemoryV2IPC] consolidate error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "memory:share",
    async (event, { memoryId, targetAgentId, privacyLevel }) => {
      try {
        if (!hierarchicalMemory) {
          return { success: false, error: "HierarchicalMemory not available" };
        }
        const result = hierarchicalMemory.shareMemory(
          memoryId,
          targetAgentId,
          privacyLevel,
        );
        if (!result) {
          return { success: false, error: "Memory not found" };
        }
        return { success: true, data: result };
      } catch (error) {
        logger.error("[MemoryV2IPC] share error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("memory:get-stats", async () => {
    try {
      if (!hierarchicalMemory) {
        return { success: false, error: "HierarchicalMemory not available" };
      }
      return { success: true, data: hierarchicalMemory.getStats() };
    } catch (error) {
      logger.error("[MemoryV2IPC] get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("memory:prune", async (event, options) => {
    try {
      if (!hierarchicalMemory) {
        return { success: false, error: "HierarchicalMemory not available" };
      }
      const result = hierarchicalMemory.prune(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[MemoryV2IPC] prune error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "memory:search-episodic",
    async (event, { query, options }) => {
      try {
        if (!hierarchicalMemory) {
          return { success: false, error: "HierarchicalMemory not available" };
        }
        const results = hierarchicalMemory.searchEpisodic(query, options || {});
        return { success: true, data: results };
      } catch (error) {
        logger.error("[MemoryV2IPC] search-episodic error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "memory:search-semantic",
    async (event, { query, options }) => {
      try {
        if (!hierarchicalMemory) {
          return { success: false, error: "HierarchicalMemory not available" };
        }
        const results = hierarchicalMemory.searchSemantic(query, options || {});
        return { success: true, data: results };
      } catch (error) {
        logger.error("[MemoryV2IPC] search-semantic error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  logger.info("[MemoryV2IPC] Registered 8 memory v2 handlers");
}

module.exports = { registerMemoryV2IPC };
