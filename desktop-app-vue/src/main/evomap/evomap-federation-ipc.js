/**
 * EvoMap Federation IPC Handlers
 * 5 IPC handlers
 * @module evomap/evomap-federation-ipc
 * @version 3.4.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "evomap-federation:list-hubs",
  "evomap-federation:sync-genes",
  "evomap-federation:get-pressure-report",
  "evomap-federation:recombine-genes",
  "evomap-federation:get-lineage",
];

function registerEvoMapFederationIPC({
  evoMapFederation,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("evomap-federation-ipc")
  ) {
    logger.info(
      "[EvoMapFederation IPC] Module already registered, skipping...",
    );
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[EvoMapFederation IPC] Registering handlers...");

  ipcMain.handle("evomap-federation:list-hubs", async (_event, filter) => {
    try {
      if (!evoMapFederation) {
        throw new Error("EvoMapFederation not initialized");
      }
      const hubs = await evoMapFederation.listHubs(filter || {});
      return { success: true, hubs };
    } catch (error) {
      logger.error("[EvoMapFederation IPC] List hubs failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap-federation:sync-genes", async (_event, params) => {
    try {
      if (!evoMapFederation) {
        throw new Error("EvoMapFederation not initialized");
      }
      const result = await evoMapFederation.syncGenes(params);
      return { success: true, result };
    } catch (error) {
      logger.error("[EvoMapFederation IPC] Sync genes failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evomap-federation:get-pressure-report", async () => {
    try {
      if (!evoMapFederation) {
        throw new Error("EvoMapFederation not initialized");
      }
      const report = await evoMapFederation.getPressureReport();
      return { success: true, report };
    } catch (error) {
      logger.error("[EvoMapFederation IPC] Get pressure report failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "evomap-federation:recombine-genes",
    async (_event, params) => {
      try {
        if (!evoMapFederation) {
          throw new Error("EvoMapFederation not initialized");
        }
        const result = await evoMapFederation.recombineGenes(params);
        return { success: true, result };
      } catch (error) {
        logger.error("[EvoMapFederation IPC] Recombine genes failed:", error);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("evomap-federation:get-lineage", async (_event, geneId) => {
    try {
      if (!evoMapFederation) {
        throw new Error("EvoMapFederation not initialized");
      }
      const lineage = await evoMapFederation.getLineage(geneId);
      return { success: true, lineage };
    } catch (error) {
      logger.error("[EvoMapFederation IPC] Get lineage failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("evomap-federation-ipc", CHANNELS);
  }
  logger.info(`[EvoMapFederation IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterEvoMapFederationIPC({
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
    ipcGuard.unregisterModule("evomap-federation-ipc");
  }
  logger.info("[EvoMapFederation IPC] All handlers unregistered");
}

export { registerEvoMapFederationIPC, unregisterEvoMapFederationIPC, CHANNELS };
