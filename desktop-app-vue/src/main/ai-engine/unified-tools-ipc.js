/**
 * Unified Tools IPC Handlers
 *
 * Provides 6 IPC handlers for the UnifiedToolRegistry, enabling the
 * frontend to browse, search, and inspect tools with Agent Skills metadata.
 *
 * @module unified-tools-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

/**
 * Wait for registry initialization (max 10s).
 * Returns true if ready, false if timed out.
 */
async function _waitForInit(registry, timeoutMs = 10000) {
  if (registry._initialized) {
    return true;
  }
  const start = Date.now();
  while (!registry._initialized && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return registry._initialized;
}

/**
 * Register unified tools IPC handlers
 * @param {Object} options
 * @param {Object} options.unifiedToolRegistry - UnifiedToolRegistry instance
 */
function registerUnifiedToolsIPC({ unifiedToolRegistry }) {
  logger.info("[UnifiedToolsIPC] Registering 8 handlers...");

  // 1. Get all tools with skill metadata
  ipcMain.handle("tools:get-all-with-skills", async () => {
    try {
      if (!unifiedToolRegistry || !(await _waitForInit(unifiedToolRegistry))) {
        return { success: false, error: "UnifiedToolRegistry not initialized" };
      }
      const tools = unifiedToolRegistry.getAllTools();
      return {
        success: true,
        data: tools,
        count: tools.length,
      };
    } catch (error) {
      logger.error(
        "[UnifiedToolsIPC] tools:get-all-with-skills error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 2. Get skill manifest
  ipcMain.handle("tools:get-skill-manifest", async () => {
    try {
      if (!unifiedToolRegistry || !(await _waitForInit(unifiedToolRegistry))) {
        return { success: false, error: "UnifiedToolRegistry not initialized" };
      }
      const skills = unifiedToolRegistry.getSkillManifest();
      return {
        success: true,
        data: skills,
        count: skills.length,
      };
    } catch (error) {
      logger.error(
        "[UnifiedToolsIPC] tools:get-skill-manifest error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 3. Get tools by skill name
  ipcMain.handle("tools:get-by-skill", async (_event, skillName) => {
    try {
      if (!unifiedToolRegistry || !(await _waitForInit(unifiedToolRegistry))) {
        return { success: false, error: "UnifiedToolRegistry not initialized" };
      }
      const tools = unifiedToolRegistry.getToolsBySkill(skillName);
      return {
        success: true,
        data: tools,
        skillName,
        count: tools.length,
      };
    } catch (error) {
      logger.error(
        "[UnifiedToolsIPC] tools:get-by-skill error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 4. Search tools
  ipcMain.handle("tools:search-unified", async (_event, keyword) => {
    try {
      if (!unifiedToolRegistry || !(await _waitForInit(unifiedToolRegistry))) {
        return { success: false, error: "UnifiedToolRegistry not initialized" };
      }
      const tools = unifiedToolRegistry.searchTools(keyword);
      return {
        success: true,
        data: tools,
        keyword,
        count: tools.length,
      };
    } catch (error) {
      logger.error(
        "[UnifiedToolsIPC] tools:search-unified error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 5. Get tool context (skill instructions/examples for a single tool)
  ipcMain.handle("tools:get-tool-context", async (_event, toolName) => {
    try {
      if (!unifiedToolRegistry || !(await _waitForInit(unifiedToolRegistry))) {
        return { success: false, error: "UnifiedToolRegistry not initialized" };
      }
      const context = unifiedToolRegistry.getToolContext(toolName);
      if (!context) {
        return { success: false, error: `Tool not found: ${toolName}` };
      }
      return {
        success: true,
        data: context,
      };
    } catch (error) {
      logger.error(
        "[UnifiedToolsIPC] tools:get-tool-context error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 6. Refresh unified registry
  ipcMain.handle("tools:refresh-unified", async () => {
    try {
      if (!unifiedToolRegistry) {
        return { success: false, error: "UnifiedToolRegistry not initialized" };
      }
      await unifiedToolRegistry.initialize();
      const stats = unifiedToolRegistry.getStats();
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      logger.error(
        "[UnifiedToolsIPC] tools:refresh-unified error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 7. Execute tool by name (v1.1.0)
  ipcMain.handle(
    "tools:execute-by-name",
    async (_event, { toolName, params, context }) => {
      try {
        if (
          !unifiedToolRegistry ||
          !(await _waitForInit(unifiedToolRegistry))
        ) {
          return {
            success: false,
            error: "UnifiedToolRegistry not initialized",
          };
        }
        const result = await unifiedToolRegistry.executeToolByName(
          toolName,
          params || {},
          context || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[UnifiedToolsIPC] tools:execute-by-name error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 8. Get tool executors info (v1.1.0)
  ipcMain.handle("tools:get-executors", async () => {
    try {
      if (!unifiedToolRegistry || !(await _waitForInit(unifiedToolRegistry))) {
        return { success: false, error: "UnifiedToolRegistry not initialized" };
      }
      const tools = unifiedToolRegistry.getAllTools();
      const executors = tools.map((t) => ({
        name: t.name,
        source: t.source,
        available: t.available,
        hasExecutor: !!unifiedToolRegistry.getToolExecutor(t.name),
        skillName: t.skillName,
      }));
      return { success: true, data: executors, count: executors.length };
    } catch (error) {
      logger.error(
        "[UnifiedToolsIPC] tools:get-executors error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info("[UnifiedToolsIPC] ✓ 8 handlers registered");
}

module.exports = { registerUnifiedToolsIPC };
