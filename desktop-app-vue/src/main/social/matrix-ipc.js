/**
 * Matrix Bridge IPC Handlers
 *
 * 5 IPC handlers for Matrix protocol integration:
 * - Login to Matrix homeserver
 * - List joined rooms
 * - Send message to room
 * - Get messages from room
 * - Join a room
 *
 * @module social/matrix-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "matrix:login",
  "matrix:list-rooms",
  "matrix:send-message",
  "matrix:get-messages",
  "matrix:join-room",
];

/**
 * Register all Matrix IPC handlers.
 * @param {Object} dependencies
 * @param {Object} dependencies.matrixBridge - MatrixBridge instance
 * @param {Object} [dependencies.ipcMain] - IPC main (injectable for tests)
 * @param {Object} [dependencies.ipcGuard] - IPC guard (injectable for tests)
 * @returns {Object} { handlerCount }
 */
function registerMatrixIPC({
  matrixBridge,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("matrix-ipc")
  ) {
    logger.info("[Matrix IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[Matrix IPC] Registering Matrix IPC handlers...");

  // ============================================================
  // Authentication
  // ============================================================

  ipcMain.handle("matrix:login", async (_event, params) => {
    try {
      if (!matrixBridge) {
        throw new Error("Matrix Bridge not initialized");
      }
      const result = await matrixBridge.login(params);
      return result;
    } catch (error) {
      logger.error("[Matrix IPC] Login failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Room Management
  // ============================================================

  ipcMain.handle("matrix:list-rooms", async () => {
    try {
      if (!matrixBridge) {
        throw new Error("Matrix Bridge not initialized");
      }
      const rooms = await matrixBridge.listRooms();
      return { success: true, rooms };
    } catch (error) {
      logger.error("[Matrix IPC] List rooms failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("matrix:join-room", async (_event, params) => {
    try {
      if (!matrixBridge) {
        throw new Error("Matrix Bridge not initialized");
      }
      const result = await matrixBridge.joinRoom(params);
      return result;
    } catch (error) {
      logger.error("[Matrix IPC] Join room failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Messaging
  // ============================================================

  ipcMain.handle("matrix:send-message", async (_event, params) => {
    try {
      if (!matrixBridge) {
        throw new Error("Matrix Bridge not initialized");
      }
      const result = await matrixBridge.sendMessage(params);
      return result;
    } catch (error) {
      logger.error("[Matrix IPC] Send message failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("matrix:get-messages", async (_event, params) => {
    try {
      if (!matrixBridge) {
        throw new Error("Matrix Bridge not initialized");
      }
      const messages = await matrixBridge.getMessages(params);
      return { success: true, messages };
    } catch (error) {
      logger.error("[Matrix IPC] Get messages failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("matrix-ipc", CHANNELS);
  }

  logger.info(`[Matrix IPC] Registered ${CHANNELS.length} Matrix IPC handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterMatrixIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // Intentionally empty - handler may not exist
    }
  }
  if (ipcGuard.unregisterModule) {
    ipcGuard.unregisterModule("matrix-ipc");
  }
  logger.info("[Matrix IPC] All handlers unregistered");
}

export { registerMatrixIPC, unregisterMatrixIPC, CHANNELS };
