/**
 * Pipeline IPC Handlers — Dev Pipeline Orchestration (v3.0)
 *
 * Registers IPC handlers for pipeline lifecycle management:
 * Phase A: 8 handlers (create, start, pause, resume, cancel, get-status, get-all, get-config)
 * Phase B: +7 handlers (approve-gate, reject-gate, get-artifacts, get-stage-detail, get-metrics, get-templates, configure)
 *
 * @module ai-engine/cowork/pipeline-ipc
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const PIPELINE_CHANNELS = [
  // Pipeline Orchestrator (8 — Phase A)
  "dev-pipeline:create",
  "dev-pipeline:start",
  "dev-pipeline:pause",
  "dev-pipeline:resume",
  "dev-pipeline:cancel",
  "dev-pipeline:get-status",
  "dev-pipeline:get-all",
  "dev-pipeline:get-config",

  // Agent Integration (7 — Phase B)
  "dev-pipeline:approve-gate",
  "dev-pipeline:reject-gate",
  "dev-pipeline:get-artifacts",
  "dev-pipeline:get-stage-detail",
  "dev-pipeline:get-metrics",
  "dev-pipeline:get-templates",
  "dev-pipeline:configure",
];

/**
 * Register all pipeline IPC handlers
 * @param {Object} deps - Dependencies
 * @param {Object} deps.pipelineOrchestrator - PipelineOrchestrator instance
 * @param {Object} [deps.requirementParser] - RequirementParser instance
 * @returns {Object} Registration metadata
 */
function registerPipelineIPC(deps) {
  const { pipelineOrchestrator, requirementParser } = deps;

  // ============================================================
  // Pipeline Orchestrator (8 handlers)
  // ============================================================

  ipcMain.handle("dev-pipeline:create", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const result = await pipelineOrchestrator.createPipeline(options);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PipelineIPC] dev-pipeline:create error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:start", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId } = options || {};
      const result = await pipelineOrchestrator.startPipeline(pipelineId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PipelineIPC] dev-pipeline:start error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:pause", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId } = options || {};
      const result = await pipelineOrchestrator.pausePipeline(pipelineId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PipelineIPC] dev-pipeline:pause error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:resume", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId } = options || {};
      const result = await pipelineOrchestrator.resumePipeline(pipelineId);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PipelineIPC] dev-pipeline:resume error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:cancel", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId, reason } = options || {};
      const result = await pipelineOrchestrator.cancelPipeline(
        pipelineId,
        reason,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PipelineIPC] dev-pipeline:cancel error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:get-status", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId } = options || {};
      const result = pipelineOrchestrator.getStatus(pipelineId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:get-status error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:get-all", async (_event, filter) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const result = pipelineOrchestrator.getAllPipelines(filter || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error("[PipelineIPC] dev-pipeline:get-all error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:get-config", async () => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const config = pipelineOrchestrator.getConfig();
      const templates = pipelineOrchestrator.getTemplates();
      return { success: true, data: { config, templates } };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:get-config error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // ============================================================
  // Agent Integration (7 handlers — Phase B)
  // ============================================================

  ipcMain.handle("dev-pipeline:approve-gate", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId, stageIndex, comment, approvedBy } = options || {};
      const result = await pipelineOrchestrator.approveGate(
        pipelineId,
        stageIndex,
        {
          comment,
          approvedBy,
        },
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:approve-gate error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:reject-gate", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId, stageIndex, reason, rejectedBy } = options || {};
      const result = await pipelineOrchestrator.rejectGate(
        pipelineId,
        stageIndex,
        {
          reason,
          rejectedBy,
        },
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:reject-gate error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:get-artifacts", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId, stageIndex } = options || {};
      const result = pipelineOrchestrator.getArtifacts(pipelineId, stageIndex);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:get-artifacts error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:get-stage-detail", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId, stageIndex } = options || {};
      const result = pipelineOrchestrator.getStageDetail(
        pipelineId,
        stageIndex,
      );
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:get-stage-detail error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:get-metrics", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const { pipelineId } = options || {};
      const result = pipelineOrchestrator.getMetrics(pipelineId);
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:get-metrics error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:get-templates", async () => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const result = pipelineOrchestrator.getTemplates();
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:get-templates error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("dev-pipeline:configure", async (_event, options) => {
    try {
      if (!pipelineOrchestrator?.initialized) {
        return {
          success: false,
          error: "PipelineOrchestrator not initialized",
        };
      }
      const result = pipelineOrchestrator.configure(options || {});
      return { success: true, data: result };
    } catch (error) {
      logger.error(
        "[PipelineIPC] dev-pipeline:configure error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info(`[PipelineIPC] Registered ${PIPELINE_CHANNELS.length} handlers`);

  return { handlerCount: PIPELINE_CHANNELS.length };
}

/**
 * Unregister all pipeline IPC handlers
 */
function unregisterPipelineIPC() {
  for (const channel of PIPELINE_CHANNELS) {
    try {
      ipcMain.removeHandler(channel);
    } catch {
      // ignore
    }
  }
  logger.info("[PipelineIPC] Unregistered all handlers");
}

module.exports = {
  registerPipelineIPC,
  unregisterPipelineIPC,
  PIPELINE_CHANNELS,
};
