/**
 * @module ai-engine/evolution/evolution-ipc
 * Phase 100: Self-Evolving AI IPC handlers (8 handlers)
 */
const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

function registerEvolutionIPC(deps) {
  const { selfEvolvingSystem } = deps;

  ipcMain.handle(
    "evolution:assess-capability",
    async (event, { name, score, category }) => {
      try {
        if (!selfEvolvingSystem) {
          return { success: false, error: "SelfEvolvingSystem not available" };
        }
        const result = selfEvolvingSystem.assessCapability(
          name,
          score,
          category,
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[EvolutionIPC] assess-capability error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    "evolution:train-incremental",
    async (event, { modelId, data, options }) => {
      try {
        if (!selfEvolvingSystem) {
          return { success: false, error: "SelfEvolvingSystem not available" };
        }
        const result = await selfEvolvingSystem.trainIncremental(
          modelId,
          data,
          options || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error("[EvolutionIPC] train-incremental error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("evolution:self-diagnose", async () => {
    try {
      if (!selfEvolvingSystem) {
        return { success: false, error: "SelfEvolvingSystem not available" };
      }
      return { success: true, data: selfEvolvingSystem.selfDiagnose() };
    } catch (error) {
      logger.error("[EvolutionIPC] self-diagnose error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evolution:self-repair", async (event, issue) => {
    try {
      if (!selfEvolvingSystem) {
        return { success: false, error: "SelfEvolvingSystem not available" };
      }
      const result = await selfEvolvingSystem.selfRepair(issue);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] self-repair error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "evolution:predict-behavior",
    async (event, { userId, options }) => {
      try {
        if (!selfEvolvingSystem) {
          return { success: false, error: "SelfEvolvingSystem not available" };
        }
        return {
          success: true,
          data: selfEvolvingSystem.predictBehavior(userId, options || {}),
        };
      } catch (error) {
        logger.error("[EvolutionIPC] predict-behavior error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle("evolution:get-growth-log", async (event, options) => {
    try {
      if (!selfEvolvingSystem) {
        return { success: false, error: "SelfEvolvingSystem not available" };
      }
      return {
        success: true,
        data: selfEvolvingSystem.getGrowthLog(options || {}),
      };
    } catch (error) {
      logger.error("[EvolutionIPC] get-growth-log error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evolution:configure", async (event, config) => {
    try {
      if (!selfEvolvingSystem) {
        return { success: false, error: "SelfEvolvingSystem not available" };
      }
      const result = selfEvolvingSystem.configure(config);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] configure error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("evolution:export-model", async (event, modelId) => {
    try {
      if (!selfEvolvingSystem) {
        return { success: false, error: "SelfEvolvingSystem not available" };
      }
      const result = selfEvolvingSystem.exportModel(modelId);
      if (!result) {
        return { success: false, error: "Model not found" };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[EvolutionIPC] export-model error:", error.message);
      return { success: false, error: error.message };
    }
  });

  logger.info("[EvolutionIPC] Registered 8 evolution handlers");
}

module.exports = { registerEvolutionIPC };
