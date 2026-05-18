/**
 * Protocol Fusion IPC Handlers
 * 5 IPC handlers
 * @module social/protocol-fusion-ipc
 * @version 3.3.0
 */
import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";
import ipcGuardModule from "../ipc/ipc-guard.js";

const CHANNELS = [
  "protocol-fusion:get-unified-feed",
  "protocol-fusion:send-message",
  "protocol-fusion:map-identity",
  "protocol-fusion:get-identity-map",
  "protocol-fusion:get-protocol-status",
];

function registerProtocolFusionIPC({
  protocolFusionBridge,
  ipcMain: injectedIpcMain,
  ipcGuard: injectedIpcGuard,
} = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;
  const ipcGuard = injectedIpcGuard || ipcGuardModule;
  if (
    ipcGuard.isModuleRegistered &&
    ipcGuard.isModuleRegistered("protocol-fusion-ipc")
  ) {
    logger.info("[ProtocolFusion IPC] Module already registered, skipping...");
    return { handlerCount: CHANNELS.length };
  }
  logger.info("[ProtocolFusion IPC] Registering handlers...");

  ipcMain.handle("protocol-fusion:get-unified-feed", async (_event, filter) => {
    try {
      if (!protocolFusionBridge) {
        throw new Error("ProtocolFusionBridge not initialized");
      }
      const feed = await protocolFusionBridge.getUnifiedFeed(filter || {});
      return { success: true, feed };
    } catch (error) {
      logger.error("[ProtocolFusion IPC] Get feed failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("protocol-fusion:send-message", async (_event, params) => {
    try {
      if (!protocolFusionBridge) {
        throw new Error("ProtocolFusionBridge not initialized");
      }
      const message = await protocolFusionBridge.sendMessage(params);
      return { success: true, message };
    } catch (error) {
      logger.error("[ProtocolFusion IPC] Send message failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("protocol-fusion:map-identity", async (_event, params) => {
    try {
      if (!protocolFusionBridge) {
        throw new Error("ProtocolFusionBridge not initialized");
      }
      const mapping = await protocolFusionBridge.mapIdentity(params);
      return { success: true, mapping };
    } catch (error) {
      logger.error("[ProtocolFusion IPC] Map identity failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("protocol-fusion:get-identity-map", async (_event, didId) => {
    try {
      if (!protocolFusionBridge) {
        throw new Error("ProtocolFusionBridge not initialized");
      }
      const map = await protocolFusionBridge.getIdentityMap(didId);
      return { success: true, map };
    } catch (error) {
      logger.error("[ProtocolFusion IPC] Get identity map failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("protocol-fusion:get-protocol-status", async () => {
    try {
      if (!protocolFusionBridge) {
        throw new Error("ProtocolFusionBridge not initialized");
      }
      const status = await protocolFusionBridge.getProtocolStatus();
      return { success: true, status };
    } catch (error) {
      logger.error("[ProtocolFusion IPC] Get protocol status failed:", error);
      return { success: false, error: error.message };
    }
  });

  if (ipcGuard.registerModule) {
    ipcGuard.registerModule("protocol-fusion-ipc", CHANNELS);
  }
  logger.info(`[ProtocolFusion IPC] Registered ${CHANNELS.length} handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterProtocolFusionIPC({
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
    ipcGuard.unregisterModule("protocol-fusion-ipc");
  }
  logger.info("[ProtocolFusion IPC] All handlers unregistered");
}

export { registerProtocolFusionIPC, unregisterProtocolFusionIPC, CHANNELS };
