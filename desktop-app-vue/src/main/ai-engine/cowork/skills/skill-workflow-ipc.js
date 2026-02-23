/**
 * Skill Workflow IPC Handlers
 *
 * 12 IPC handlers for visual workflow management.
 * Includes step event forwarding and orchestrate template import.
 *
 * @module skill-workflow-ipc
 * @version 1.2.0
 */

const { ipcMain, BrowserWindow } = require("electron");
const { logger } = require("../../../utils/logger.js");

let workflowEngine = null;

/**
 * Forward workflow step events to the renderer process
 * @param {Object} engine - SkillWorkflowEngine instance
 */
function setupStepEventForwarding(engine) {
  const sendToRenderer = (channel, data) => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  engine.on("step:started", (data) => {
    sendToRenderer("workflow:step:started", data);
  });

  engine.on("step:completed", (data) => {
    sendToRenderer("workflow:step:completed", data);
  });

  engine.on("step:failed", (data) => {
    sendToRenderer("workflow:step:failed", data);
  });
}

/**
 * Register skill workflow IPC handlers
 * @param {Object} options
 * @param {Object} options.workflowEngine - SkillWorkflowEngine instance
 */
function registerSkillWorkflowIPC(options = {}) {
  workflowEngine = options.workflowEngine || null;

  logger.info("[SkillWorkflowIPC] Registering 12 handlers...");

  // Setup step event forwarding to renderer
  if (workflowEngine) {
    setupStepEventForwarding(workflowEngine);
  }

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

  // 11. Import orchestrate template as visual workflow
  ipcMain.handle(
    "workflow:import-orchestrate",
    async (_event, { templateName }) => {
      try {
        const {
          getWorkflowTemplate,
        } = require("./builtin/orchestrate/handler");

        const template = getWorkflowTemplate(templateName);
        if (!template) {
          return {
            success: false,
            error: `Unknown orchestrate template: ${templateName}`,
          };
        }

        // Convert orchestrate template agents to visual nodes/edges
        const nodes = [];
        const edges = [];
        const startX = 250;
        let y = 50;
        const yStep = 120;

        // Start node
        const startId = "start-1";
        nodes.push({
          id: startId,
          type: "start",
          position: { x: startX, y },
          data: { label: "Start" },
        });
        y += yStep;

        let prevNodeId = startId;

        for (let i = 0; i < template.agents.length; i++) {
          const agent = template.agents[i];
          const nodeId = `agent-${i + 1}`;

          nodes.push({
            id: nodeId,
            type: "skill",
            position: { x: startX, y },
            data: {
              label: agent.label || agent.role,
              skillId: agent.agentType || agent.role,
              role: agent.role,
              prompt: agent.prompt,
            },
          });

          edges.push({
            id: `edge-${prevNodeId}-${nodeId}`,
            source: prevNodeId,
            target: nodeId,
            type: "default",
          });

          prevNodeId = nodeId;
          y += yStep;
        }

        // End node
        const endId = "end-1";
        nodes.push({
          id: endId,
          type: "end",
          position: { x: startX, y },
          data: { label: "End" },
        });
        edges.push({
          id: `edge-${prevNodeId}-${endId}`,
          source: prevNodeId,
          target: endId,
          type: "default",
        });

        return {
          success: true,
          data: {
            name: `[Orchestrate] ${template.name}`,
            templateName,
            nodes,
            edges,
          },
        };
      } catch (error) {
        logger.error(
          "[SkillWorkflowIPC] workflow:import-orchestrate error:",
          error.message,
        );
        return { success: false, error: error.message };
      }
    },
  );

  // 12. Get available orchestrate templates
  ipcMain.handle("workflow:get-orchestrate-templates", async () => {
    try {
      const {
        getWorkflowTemplate,
      } = require("./builtin/orchestrate/handler");

      const templateNames = ["feature", "bugfix", "refactor", "security-audit"];
      const templates = templateNames
        .map((name) => {
          const t = getWorkflowTemplate(name);
          return t ? { name, label: t.name, agentCount: t.agents.length } : null;
        })
        .filter(Boolean);

      return { success: true, data: templates };
    } catch (error) {
      logger.error(
        "[SkillWorkflowIPC] workflow:get-orchestrate-templates error:",
        error.message,
      );
      return { success: false, error: error.message };
    }
  });

  logger.info("[SkillWorkflowIPC] ✓ 12 handlers registered");
}

module.exports = { registerSkillWorkflowIPC };
