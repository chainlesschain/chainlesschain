/**
 * PQC Ecosystem IPC Handlers
 * 4 IPC handlers for PQC full migration
 * @module ukey/pqc-ecosystem-ipc
 * @version 3.2.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "pqc-ecosystem:get-coverage",
  "pqc-ecosystem:migrate-subsystem",
  "pqc-ecosystem:update-firmware-pqc",
  "pqc-ecosystem:verify-migration",
];

function registerPQCEcosystemIPC({
  pqcEcosystemManager,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("pqc-ecosystem-ipc")
  ) {
    logger.info("[PQCEcosystem IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[PQCEcosystem IPC] Registering handlers...");

  ipcMain.handle("pqc-ecosystem:get-coverage", async () => {
    try {
      if (!pqcEcosystemManager) {
        throw new Error("PQCEcosystemManager not initialized");
      }
      const coverage = await pqcEcosystemManager.getCoverage();
      return { success: true, coverage };
    } catch (error) {
      logger.error("[PQCEcosystem IPC] Get coverage failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("pqc-ecosystem:migrate-subsystem", async (_event, params) => {
    try {
      if (!pqcEcosystemManager) {
        throw new Error("PQCEcosystemManager not initialized");
      }
      const migration = await pqcEcosystemManager.migrateSubsystem(params);
      return { success: true, migration };
    } catch (error) {
      logger.error("[PQCEcosystem IPC] Migrate subsystem failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "pqc-ecosystem:update-firmware-pqc",
    async (_event, firmwareVersion) => {
      try {
        if (!pqcEcosystemManager) {
          throw new Error("PQCEcosystemManager not initialized");
        }
        const result =
          await pqcEcosystemManager.updateFirmwarePQC(firmwareVersion);
        return { success: true, result };
      } catch (error) {
        logger.error("[PQCEcosystem IPC] Update firmware PQC failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("pqc-ecosystem:verify-migration", async () => {
    try {
      if (!pqcEcosystemManager) {
        throw new Error("PQCEcosystemManager not initialized");
      }
      const result = await pqcEcosystemManager.verifyMigration();
      return { success: true, ...result };
    } catch (error) {
      logger.error("[PQCEcosystem IPC] Verify migration failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("pqc-ecosystem-ipc", CHANNELS);
  }
  logger.info(`[PQCEcosystem IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterPQCEcosystemIPC({
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  for (const channel of CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      /* Intentionally empty */
    }
  }
  if (ipcGuard.unregisterModule) {
    ipcGuard.unregisterModule("pqc-ecosystem-ipc");
  }
  logger.info("[PQCEcosystem IPC] All handlers unregistered");
}

export { registerPQCEcosystemIPC, unregisterPQCEcosystemIPC, CHANNELS };
