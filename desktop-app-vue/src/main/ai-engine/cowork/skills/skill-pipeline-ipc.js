/**
 * Skill Pipeline IPC Handlers
 *
 * 12 IPC handlers for pipeline management.
 *
 * @module skill-pipeline-ipc
 * @version 1.1.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../../../utils/logger.js");

let pipelineEngine = null;

/**
 * Register skill pipeline IPC handlers
 * @param {Object} options
 * @param {Object} options.pipelineEngine - SkillPipelineEngine instance
 */
function registerSkillPipelineIPC(options = {}) {
  pipelineEngine = options.pipelineEngine || null;

  logger.info("[SkillPipelineIPC] Registering 12 handlers...");

  // 1. Create pipeline
  ipcMain.handle("pipeline:create", async (_event, definition) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      const id = pipelineEngine.createPipeline(definition);
      return { success: true, data: { id } };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:create error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 2. Execute pipeline
  ipcMain.handle(
    "pipeline:execute",
    async (_event, { pipelineId, context }) => {
      try {
        if (!pipelineEngine) {
          return { success: false, error: "PipelineEngine not initialized" };
        }
        const result = await pipelineEngine.executePipeline(
          pipelineId,
          context || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[SkillPipelineIPC] pipeline:execute error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 3. Get pipeline status
  ipcMain.handle("pipeline:get-status", async (_event, executionId) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      const status = pipelineEngine.getPipelineStatus(executionId);
      if (!status) {
        return { success: false, error: "Execution not found" };
      }
      return { success: true, data: status };
    } catch (error) {
      logger.error(
        "[SkillPipelineIPC] pipeline:get-status error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 4. Pause pipeline
  ipcMain.handle("pipeline:pause", async (_event, executionId) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      pipelineEngine.pausePipeline(executionId);
      return { success: true };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:pause error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 5. Resume pipeline
  ipcMain.handle("pipeline:resume", async (_event, executionId) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      pipelineEngine.resumePipeline(executionId);
      return { success: true };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:resume error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 6. Cancel pipeline
  ipcMain.handle("pipeline:cancel", async (_event, executionId) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      pipelineEngine.cancelPipeline(executionId);
      return { success: true };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:cancel error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 7. List pipelines
  ipcMain.handle("pipeline:list", async () => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      const pipelines = pipelineEngine.listPipelines();
      return { success: true, data: pipelines, count: pipelines.length };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:list error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 8. Get pipeline
  ipcMain.handle("pipeline:get", async (_event, pipelineId) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      const pipeline = pipelineEngine.getPipeline(pipelineId);
      if (!pipeline) {
        return { success: false, error: "Pipeline not found" };
      }
      return { success: true, data: pipeline };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:get error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 9. Save pipeline
  ipcMain.handle("pipeline:save", async (_event, { pipelineId, updates }) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      pipelineEngine.savePipeline(pipelineId, updates);
      return { success: true };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:save error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 10. Delete pipeline
  ipcMain.handle("pipeline:delete", async (_event, pipelineId) => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      pipelineEngine.deletePipeline(pipelineId);
      return { success: true };
    } catch (error) {
      logger.error("[SkillPipelineIPC] pipeline:delete error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 11. Get templates
  ipcMain.handle("pipeline:get-templates", async () => {
    try {
      const { getTemplates } = require("./pipeline-templates");
      return { success: true, data: getTemplates() };
    } catch (error) {
      logger.error(
        "[SkillPipelineIPC] pipeline:get-templates error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 12. Get pipeline stats
  ipcMain.handle("pipeline:get-stats", async () => {
    try {
      if (!pipelineEngine) {
        return { success: false, error: "PipelineEngine not initialized" };
      }
      const pipelines = pipelineEngine.listPipelines();
      const totalExecutions = pipelines.reduce(
        (sum, p) => sum + p.executionCount,
        0,
      );
      return {
        success: true,
        data: {
          totalPipelines: pipelines.length,
          totalExecutions,
          templates: pipelines.filter((p) => p.isTemplate).length,
          custom: pipelines.filter((p) => !p.isTemplate).length,
        },
      };
    } catch (error) {
      logger.error(
        "[SkillPipelineIPC] pipeline:get-stats error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info("[SkillPipelineIPC] ✓ 12 handlers registered");
}

module.exports = { registerSkillPipelineIPC };
