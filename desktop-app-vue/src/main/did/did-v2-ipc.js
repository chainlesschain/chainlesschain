/**
 * @module did/did-v2-ipc
 * Phase 90: DID v2 Manager IPC handlers
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerDIDv2IPC(deps) {
  const { didV2Manager } = deps;

  ipcMain.handle("did-v2:create", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const options = args || {};
      const result = didV2Manager.create(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] create error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("did-v2:resolve", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const { didId } = args;
      const result = didV2Manager.resolve(didId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] resolve error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("did-v2:present", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const { didId, credentials, verifier } = args;
      const result = didV2Manager.present(didId, credentials, verifier);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] present error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("did-v2:verify", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const { presentationId } = args;
      const result = didV2Manager.verify(presentationId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] verify error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("did-v2:recover", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const { didId, recoveryProof } = args;
      const result = didV2Manager.recover(didId, recoveryProof);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] recover error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("did-v2:roam", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const { didId, targetPlatform } = args;
      const result = didV2Manager.roam(didId, targetPlatform);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] roam error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("did-v2:aggregate-reputation", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const { didId, sources } = args;
      const result = didV2Manager.aggregateReputation(didId, sources);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] aggregate-reputation error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("did-v2:export", async (event, args) => {
    try {
      if (!didV2Manager) {
        return { success: false, error: "DID v2 Manager not available" };
      }
      const { didId } = args;
      const result = didV2Manager.exportDID(didId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[DIDv2IPC] export error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[DIDv2IPC] Registered 8 handlers");
}

module.exports = { registerDIDv2IPC };
