/**
 * Dual Model IPC Handlers -- v1.0.0
 *
 * Registers 7 IPC channels for the Dual Model (Architect + Editor) system:
 *   - dual-model:start          Start a new session
 *   - dual-model:next-turn      Advance session by one turn
 *   - dual-model:get-state      Get current session state
 *   - dual-model:end            Force-end a session
 *   - dual-model:configure-roles Update role configurations
 *   - dual-model:list-sessions  List sessions with pagination/filter
 *   - dual-model:get-history    Get full conversation history
 *
 * @module ai-engine/dual-model/dual-model-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

/**
 * Register all dual-model IPC handlers.
 * @param {Object} deps
 * @param {import('./dual-model-manager').DualModelManager} deps.dualModelManager
 */
function registerDualModelIPC({ dualModelManager }) {
  // ─────────────────────────────────────────────────────────
  // dual-model:start
  // ─────────────────────────────────────────────────────────
  ipcMain.handle("dual-model:start", async (event, { task, config } = {}) => {
    try {
      logger.info("[DualModelIPC] dual-model:start", { task });
      const session = await dualModelManager.startSession(task, config);
      return { success: true, data: session };
    } catch (error) {
      logger.error("[DualModelIPC] dual-model:start error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────
  // dual-model:next-turn
  // ─────────────────────────────────────────────────────────
  ipcMain.handle("dual-model:next-turn", async (event, { sessionId } = {}) => {
    try {
      logger.info("[DualModelIPC] dual-model:next-turn", { sessionId });
      const session = await dualModelManager.nextTurn(sessionId);
      return { success: true, data: session };
    } catch (error) {
      logger.error("[DualModelIPC] dual-model:next-turn error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────
  // dual-model:get-state
  // ─────────────────────────────────────────────────────────
  ipcMain.handle("dual-model:get-state", async (event, { sessionId } = {}) => {
    try {
      logger.info("[DualModelIPC] dual-model:get-state", { sessionId });
      const state = dualModelManager.getState(sessionId);
      if (!state) {
        return { success: false, error: `Session not found: ${sessionId}` };
      }
      return { success: true, data: state };
    } catch (error) {
      logger.error("[DualModelIPC] dual-model:get-state error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────
  // dual-model:end
  // ─────────────────────────────────────────────────────────
  ipcMain.handle("dual-model:end", async (event, { sessionId } = {}) => {
    try {
      logger.info("[DualModelIPC] dual-model:end", { sessionId });
      const session = dualModelManager.endSession(sessionId);
      return { success: true, data: session };
    } catch (error) {
      logger.error("[DualModelIPC] dual-model:end error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────
  // dual-model:configure-roles
  // ─────────────────────────────────────────────────────────
  ipcMain.handle("dual-model:configure-roles", async (event, { config } = {}) => {
    try {
      logger.info("[DualModelIPC] dual-model:configure-roles");
      const updatedConfig = dualModelManager.configureRoles(config);
      return { success: true, data: updatedConfig };
    } catch (error) {
      logger.error("[DualModelIPC] dual-model:configure-roles error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────
  // dual-model:list-sessions
  // ─────────────────────────────────────────────────────────
  ipcMain.handle("dual-model:list-sessions", async (event, { options } = {}) => {
    try {
      logger.info("[DualModelIPC] dual-model:list-sessions", { options });
      const result = dualModelManager.listSessions(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DualModelIPC] dual-model:list-sessions error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // ─────────────────────────────────────────────────────────
  // dual-model:get-history
  // ─────────────────────────────────────────────────────────
  ipcMain.handle("dual-model:get-history", async (event, { sessionId } = {}) => {
    try {
      logger.info("[DualModelIPC] dual-model:get-history", { sessionId });
      const history = dualModelManager.getHistory(sessionId);
      return { success: true, data: history };
    } catch (error) {
      logger.error("[DualModelIPC] dual-model:get-history error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[DualModelIPC] Registered 7 IPC handlers");
}

module.exports = { registerDualModelIPC };
