/**
 * @module crypto/zkp-ipc
 * Phase 88: ZKP Engine IPC handlers
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerZKPIPC(deps) {
  const { zkpEngine } = deps;

  ipcMain.handle("zkp:compile-circuit", async (event, args) => {
    try {
      if (!zkpEngine) {
        return { success: false, error: "ZKP Engine not available" };
      }
      const { name, definition } = args;
      const result = zkpEngine.compileCircuit(name, definition);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKPIPC] compile-circuit error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:generate-proof", async (event, args) => {
    try {
      if (!zkpEngine) {
        return { success: false, error: "ZKP Engine not available" };
      }
      const { circuitId, privateInputs, publicInputs } = args;
      const result = await zkpEngine.generateProof(
        circuitId,
        privateInputs,
        publicInputs,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKPIPC] generate-proof error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:verify-proof", async (event, args) => {
    try {
      if (!zkpEngine) {
        return { success: false, error: "ZKP Engine not available" };
      }
      const { proofId } = args;
      const result = zkpEngine.verifyProof(proofId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKPIPC] verify-proof error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:create-identity-proof", async (event, args) => {
    try {
      if (!zkpEngine) {
        return { success: false, error: "ZKP Engine not available" };
      }
      const { claims, disclosedFields } = args;
      const result = zkpEngine.createIdentityProof(claims, disclosedFields);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKPIPC] create-identity-proof error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:selective-disclose", async (event, args) => {
    try {
      if (!zkpEngine) {
        return { success: false, error: "ZKP Engine not available" };
      }
      const { proofId, additionalFields } = args;
      const result = zkpEngine.selectiveDisclose(proofId, additionalFields);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKPIPC] selective-disclose error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("zkp:get-stats", async () => {
    try {
      if (!zkpEngine) {
        return { success: false, error: "ZKP Engine not available" };
      }
      const result = zkpEngine.getStats();
      return { success: true, data: result };
    } catch (error) {
      logger.error("[ZKPIPC] get-stats error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[ZKPIPC] Registered 6 handlers");
}

module.exports = { registerZKPIPC };
