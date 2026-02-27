/**
 * SCIM IPC Handlers
 *
 * 8 IPC handlers for SCIM 2.0 configuration, sync, and status.
 *
 * @module enterprise/scim-ipc
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { ipcMain as electronIpcMain } from "electron";

const CHANNELS = [
  "scim:list-users",
  "scim:create-user",
  "scim:get-user",
  "scim:delete-user",
  "scim:register-connector",
  "scim:get-connectors",
  "scim:sync-provider",
  "scim:get-status",
];

function registerSCIMIPC({ scimServer, scimSync, ipcMain: injectedIpcMain } = {}) {
  const ipcMain = injectedIpcMain || electronIpcMain;

  logger.info("[SCIM IPC] Registering SCIM IPC handlers...");

  ipcMain.handle("scim:list-users", async (_event, options) => {
    try {
      if (!scimServer) throw new Error("SCIM Server not initialized");
      return { success: true, ...(await scimServer.listUsers(options)) };
    } catch (error) {
      logger.error("[SCIM IPC] List users failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("scim:create-user", async (_event, userData) => {
    try {
      if (!scimServer) throw new Error("SCIM Server not initialized");
      const user = await scimServer.createUser(userData);
      return { success: true, user };
    } catch (error) {
      logger.error("[SCIM IPC] Create user failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("scim:get-user", async (_event, { userId }) => {
    try {
      if (!scimServer) throw new Error("SCIM Server not initialized");
      const user = await scimServer.getUser(userId);
      return { success: true, user };
    } catch (error) {
      logger.error("[SCIM IPC] Get user failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("scim:delete-user", async (_event, { userId }) => {
    try {
      if (!scimServer) throw new Error("SCIM Server not initialized");
      return await scimServer.deleteUser(userId);
    } catch (error) {
      logger.error("[SCIM IPC] Delete user failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("scim:register-connector", async (_event, { provider, config }) => {
    try {
      if (!scimSync) throw new Error("SCIM Sync not initialized");
      return scimSync.registerConnector(provider, config);
    } catch (error) {
      logger.error("[SCIM IPC] Register connector failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("scim:get-connectors", async () => {
    try {
      if (!scimSync) throw new Error("SCIM Sync not initialized");
      return { success: true, connectors: scimSync.getConnectors() };
    } catch (error) {
      logger.error("[SCIM IPC] Get connectors failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("scim:sync-provider", async (_event, { provider }) => {
    try {
      if (!scimSync) throw new Error("SCIM Sync not initialized");
      const result = await scimSync.syncProvider(provider);
      return { success: true, result };
    } catch (error) {
      logger.error("[SCIM IPC] Sync provider failed:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("scim:get-status", async () => {
    try {
      if (!scimSync) throw new Error("SCIM Sync not initialized");
      const status = scimSync.getStatus();
      const history = await scimSync.getSyncHistory({ limit: 10 });
      return { success: true, ...status, recentHistory: history };
    } catch (error) {
      logger.error("[SCIM IPC] Get status failed:", error);
      return { success: false, error: error.message };
    }
  });

  logger.info(`[SCIM IPC] ✓ Registered ${CHANNELS.length} SCIM IPC handlers`);
  return { handlerCount: CHANNELS.length };
}

function unregisterSCIMIPC() {
  for (const channel of CHANNELS) {
    electronIpcMain.removeHandler(channel);
  }
}

export { registerSCIMIPC, unregisterSCIMIPC, CHANNELS };
