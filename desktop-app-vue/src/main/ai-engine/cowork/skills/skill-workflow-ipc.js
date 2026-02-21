/**
 * Skill Workflow IPC Handlers
 *
 * 10 IPC handlers for visual workflow management.
 *
 * @module skill-workflow-ipc
 * @version 1.1.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../../../utils/logger.js");

let workflowEngine = null;

/**
 * Register skill workflow IPC handlers
 * @param {Object} options
 * @param {Object} options.workflowEngine - SkillWorkflowEngine instance
 */
function registerSkillWorkflowIPC(options = {}) {
  workflowEngine = options.workflowEngine || null;

  logger.info("[SkillWorkflowIPC] Registering 10 handlers...");

  // 1. Create workflow
  ipcMain.handle("workflow:create", async (_event, definition) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      const id = workflowEngine.createWorkflow(definition || {});
      return { success: true, data: { id } };
    } catch (error) {
      logger.error("[SkillWorkflowIPC] workflow:create error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 2. Update workflow (nodes, edges, etc.)
  ipcMain.handle("workflow:update", async (_event, { workflowId, updates }) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      workflowEngine.saveWorkflow(workflowId, updates);
      return { success: true };
    } catch (error) {
      logger.error("[SkillWorkflowIPC] workflow:update error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 3. Execute workflow
  ipcMain.handle(
    "workflow:execute",
    async (_event, { workflowId, context }) => {
      try {
        if (!workflowEngine) {
          return { success: false, error: "WorkflowEngine not initialized" };
        }
        const result = await workflowEngine.executeWorkflow(
          workflowId,
          context || {},
        );
        return { success: true, data: result };
      } catch (error) {
        logger.error(
          "[SkillWorkflowIPC] workflow:execute error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 4. Get workflow
  ipcMain.handle("workflow:get", async (_event, workflowId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      const workflow = workflowEngine.getWorkflow(workflowId);
      if (!workflow) {
        return { success: false, error: "Workflow not found" };
      }
      return { success: true, data: workflow };
    } catch (error) {
      logger.error("[SkillWorkflowIPC] workflow:get error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 5. List workflows
  ipcMain.handle("workflow:list", async () => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      const workflows = workflowEngine.listWorkflows();
      return { success: true, data: workflows, count: workflows.length };
    } catch (error) {
      logger.error("[SkillWorkflowIPC] workflow:list error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 6. Delete workflow
  ipcMain.handle("workflow:delete", async (_event, workflowId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      workflowEngine.deleteWorkflow(workflowId);
      return { success: true };
    } catch (error) {
      logger.error("[SkillWorkflowIPC] workflow:delete error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 7. Save workflow
  ipcMain.handle("workflow:save", async (_event, { workflowId, updates }) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      workflowEngine.saveWorkflow(workflowId, updates);
      return { success: true };
    } catch (error) {
      logger.error("[SkillWorkflowIPC] workflow:save error:", error.message);
      return { success: false, error: error.message };
    }
  });

  // 8. Import pipeline as workflow
  ipcMain.handle("workflow:import-pipeline", async (_event, pipelineId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      const workflowId = workflowEngine.importFromPipeline(pipelineId);
      return { success: true, data: { workflowId } };
    } catch (error) {
      logger.error(
        "[SkillWorkflowIPC] workflow:import-pipeline error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 9. Export workflow as pipeline
  ipcMain.handle("workflow:export-pipeline", async (_event, workflowId) => {
    try {
      if (!workflowEngine) {
        return { success: false, error: "WorkflowEngine not initialized" };
      }
      const pipelineDef = workflowEngine.exportToPipeline(workflowId);
      return { success: true, data: pipelineDef };
    } catch (error) {
      logger.error(
        "[SkillWorkflowIPC] workflow:export-pipeline error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  // 10. Get workflow templates (from pipeline templates with visual metadata)
  ipcMain.handle("workflow:get-templates", async () => {
    try {
      const { getTemplates } = require("./pipeline-templates");
      const templates = getTemplates().map((t) => ({
        ...t,
        isWorkflowTemplate: true,
      }));
      return { success: true, data: templates };
    } catch (error) {
      logger.error(
        "[SkillWorkflowIPC] workflow:get-templates error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info("[SkillWorkflowIPC] ✓ 10 handlers registered");
}

module.exports = { registerSkillWorkflowIPC };
