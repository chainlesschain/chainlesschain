/**
 * @module crypto/privacy-computing-ipc
 * Phase 91: Privacy Computing IPC handlers
 */
const { ipcMain } = require("electron");
const { logger } = require("../utils/logger.js");

function registerPrivacyComputingIPC(deps) {
  const { privacyComputing } = deps;

  ipcMain.handle("privacy:federated-train", async (event, args) => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const { modelId, options } = args;
      const result = await privacyComputing.federatedTrain(modelId, options);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PrivacyComputingIPC] federated-train error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("privacy:mpc-compute", async (event, args) => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const { operation, parties, inputs } = args;
      const result = await privacyComputing.mpcCompute(
        operation,
        parties,
        inputs,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PrivacyComputingIPC] mpc-compute error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("privacy:dp-publish", async (event, args) => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const { data, options } = args;
      const result = await privacyComputing.dpPublish(data, options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PrivacyComputingIPC] dp-publish error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("privacy:he-query", async (event, args) => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const { encryptedData, query } = args;
      const result = await privacyComputing.heQuery(encryptedData, query);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PrivacyComputingIPC] he-query error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("privacy:get-privacy-report", async () => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const result = privacyComputing.getPrivacyReport();
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PrivacyComputingIPC] get-privacy-report error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("privacy:configure", async (event, args) => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const { config } = args;
      const result = privacyComputing.configure(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PrivacyComputingIPC] configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("privacy:get-model-status", async (event, args) => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const { modelId } = args;
      const result = privacyComputing.getModelStatus(modelId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PrivacyComputingIPC] get-model-status error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("privacy:export-model", async (event, args) => {
    try {
      if (!privacyComputing) {
        return { success: false, error: "Privacy Computing not available" };
      }
      const { modelId } = args;
      const result = privacyComputing.exportModel(modelId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PrivacyComputingIPC] export-model error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[PrivacyComputingIPC] Registered 8 handlers");
}

module.exports = { registerPrivacyComputingIPC };
