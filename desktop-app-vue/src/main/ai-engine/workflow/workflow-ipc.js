/**
 * @module ai-engine/workflow/workflow-ipc
 * Phase 82: Workflow Engine IPC handlers (10 handlers)
 */
const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

function registerWorkflowIPC(deps) {
  const { workflowEngine } = deps;

  ipcMain.handle("workflow:create", async (event, definition) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const result = workflowEngine.createWorkflow(definition);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WorkflowIPC] create error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:execute", async (event, { workflowId, input }) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const result = await workflowEngine.executeWorkflow(workflowId, input);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WorkflowIPC] execute error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:pause", async (event, executionId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const result = workflowEngine.pauseExecution(executionId);
      return { success: result !== null, data: result };
    } catch (error) {
      logger.error("[WorkflowIPC] pause error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:resume", async (event, executionId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const result = workflowEngine.resumeExecution(executionId);
      return { success: result !== null, data: result };
    } catch (error) {
      logger.error("[WorkflowIPC] resume error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:rollback", async (event, executionId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const result = workflowEngine.rollbackExecution(executionId);
      return { success: result !== null, data: result };
    } catch (error) {
      logger.error("[WorkflowIPC] rollback error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:list-templates", async () => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      return { success: true, data: workflowEngine.getTemplates() };
    } catch (error) {
      logger.error("[WorkflowIPC] list-templates error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:import", async (event, workflowData) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const result = workflowEngine.importWorkflow(workflowData);
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WorkflowIPC] import error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:export", async (event, workflowId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const result = workflowEngine.exportWorkflow(workflowId);
      if (!result) {
        return { success: false, error: "Workflow not found" };
      }
      return { success: true, data: result };
    } catch (error) {
      logger.error("[WorkflowIPC] export error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("workflow:get-execution-log", async (event, executionId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not available" };
      }
      const log = workflowEngine.getExecutionLog(executionId);
      if (!log) {
        return { success: false, error: "Execution not found" };
      }
      return { success: true, data: log };
    } catch (error) {
      logger.error("[WorkflowIPC] get-execution-log error:", error.message);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "workflow:set-breakpoint",
    async (event, { workflowId, stageId }) => {
      try {
        if (!workflowEngine) {
          return { success: false, error: "WorkflowEngine not available" };
        }
        workflowEngine.setBreakpoint(workflowId, stageId);
        return { success: true };
      } catch (error) {
        logger.error("[WorkflowIPC] set-breakpoint error:", error.message);
        return { success: false, error: error.message };
      }
    },
  );

  logger.info("[WorkflowIPC] Registered 10 workflow handlers");
}

module.exports = { registerWorkflowIPC };
