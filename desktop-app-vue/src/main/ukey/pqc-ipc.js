/**
 * PQC Migration IPC Handlers
 *
 * 4 IPC handlers for Post-Quantum Cryptography migration:
 * - List PQC keys
 * - Generate PQC key
 * - Get migration status
 * - Execute migration plan
 *
 * @module ukey/pqc-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "pqc:list-keys",
  "pqc:generate-key",
  "pqc:get-migration-status",
  "pqc:execute-migration",
];

/**
 * Register all PQC IPC handlers.
 * @param {Object} dependencies
 * @param {Object} dependencies.pqcManager - PQCMigrationManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main (injectable for tests)
 * @param {Object} [dependencies.ipcGuard] - IPC guard (injectable for tests)
 * @returns {Object} { handlerCount }
 */
function registerPQCIPC({
  pqcManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;

  if (ipcGuard.isModuleRegistered && ipcGuard.isModuleRegistered("pqc-ipc")) {
    logger.info("[PQC IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }

  logger.info("[PQC IPC] Registering PQC IPC handlers...");

  // ============================================================
  // Key Management
  // ============================================================

  ipcMain.handle("pqc:list-keys", async (_event, filter) => {
    try {
      if (!pqcManager) {
        throw new Error("PQC Manager not initialized");
      }
      const keys = await pqcManager.listKeys(filter || {});
      return { success: true, keys };
    } catch (error) {
      logger.error("[PQC IPC] List keys failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pqc:generate-key", async (_event, params) => {
    try {
      if (!pqcManager) {
        throw new Error("PQC Manager not initialized");
      }
      const key = await pqcManager.generateKey(params);
      return { success: true, key };
    } catch (error) {
      logger.error("[PQC IPC] Generate key failed:", error);
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Migration Management
  // ============================================================

  ipcMain.handle("pqc:get-migration-status", async () => {
    try {
      if (!pqcManager) {
        throw new Error("PQC Manager not initialized");
      }
      const plans = await pqcManager.getMigrationStatus();
      return { success: true, plans };
    } catch (error) {
      logger.error("[PQC IPC] Get migration status failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pqc:execute-migration", async (_event, params) => {
    try {
      if (!pqcManager) {
        throw new Error("PQC Manager not initialized");
      }
      const result = await pqcManager.executeMigration(params);
      return { success: true, migration: result };
    } catch (error) {
      logger.error("[PQC IPC] Execute migration failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("pqc-ipc", CHANNELS);
  }

  logger.info(`[PQC IPC] Registered ${CHANNELS.length} PQC IPC handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterPQCIPC({
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
    ipcGuard.unregisterModule("pqc-ipc");
  }
  logger.info("[PQC IPC] All handlers unregistered");
}

export { registerPQCIPC, unregisterPQCIPC, CHANNELS };
