"use strict";

const { ipcMain: electronIpcMain } = require("electron");
const { logger } = require("../../utils/logger.js");

const AGENTS_IPC_CHANNELS = [
  "agents:list-templates",
  "agents:get-template",
  "agents:create-template",
  "agents:update-template",
  "agents:delete-template",
  "agents:deploy-agent",
  "agents:terminate-agent",
  "agents:list-instances",
  "agents:get-status",
  "agents:assign-task",
  "agents:get-task-status",
  "agents:cancel-task",
  "agents:orchestrate",
  "agents:get-plan",
  "agents:get-performance",
  "agents:get-statistics",
];

/* v8 ignore start */
function createDefaultTemplateManager({ database }) {
  const { AgentTemplateManager } = require("./agent-templates");
  return new AgentTemplateManager({ database });
}

function createDefaultAgentRegistry({ database, templateManager }) {
  const { AgentRegistry } = require("./agent-registry");
  return new AgentRegistry({ database, templateManager });
}

function createDefaultAgentCoordinator({
  database,
  agentRegistry,
  templateManager,
}) {
  const { AgentCoordinator } = require("./agent-coordinator");
  return new AgentCoordinator({
    database,
    agentRegistry,
    templateManager,
  });
}
/* v8 ignore stop */

function removeExistingHandlers(ipc) {
  if (typeof ipc.removeHandler !== "function") {
    return;
  }

  AGENTS_IPC_CHANNELS.forEach((channel) => {
    try {
      ipc.removeHandler(channel);
    } catch (_error) {
      // Ignore missing handlers.
    }
  });
}

function registerAgentsIPC(dependencies = {}) {
  const ipc = dependencies.ipcMain || electronIpcMain;
  const { database } = dependencies;

  const createTemplateManager =
    dependencies.createTemplateManager || createDefaultTemplateManager;
  const createAgentRegistry =
    dependencies.createAgentRegistry || createDefaultAgentRegistry;
  const createAgentCoordinator =
    dependencies.createAgentCoordinator || createDefaultAgentCoordinator;

  let templateManager = null;
  let agentRegistry = null;
  let agentCoordinator = null;

  const getTemplateManager = () => {
    if (!templateManager) {
      templateManager = createTemplateManager({ database });
      logger.info("[AgentsIPC] AgentTemplateManager initialized");
    }
    return templateManager;
  };

  const getAgentRegistry = () => {
    if (!agentRegistry) {
      agentRegistry = createAgentRegistry({
        database,
        templateManager: getTemplateManager(),
      });
      logger.info("[AgentsIPC] AgentRegistry initialized");
    }
    return agentRegistry;
  };

  const getAgentCoordinator = () => {
    if (!agentCoordinator) {
      agentCoordinator = createAgentCoordinator({
        database,
        agentRegistry: getAgentRegistry(),
        templateManager: getTemplateManager(),
      });
      logger.info("[AgentsIPC] AgentCoordinator initialized");
    }
    return agentCoordinator;
  };

  const safeHandle = (channel, label, handler) => {
    ipc.handle(channel, async (...args) => {
      try {
        return await handler(...args);
      } catch (error) {
        logger.error(`[AgentsIPC] ${label} error: ${error.message}`);
        return { success: false, error: error.message };
      }
    });
  };

  logger.info("[AgentsIPC] Registering IPC handlers...");
  removeExistingHandlers(ipc);

  safeHandle(
    "agents:list-templates",
    "List templates",
    async (_event, payload = {}) => {
      const templates = getTemplateManager().listTemplates(payload.filters || {});
      return {
        success: true,
        data: templates,
        total: templates.length,
      };
    },
  );

  safeHandle(
    "agents:get-template",
    "Get template",
    async (_event, { templateId } = {}) => {
      if (!templateId) {
        return { success: false, error: "Template ID is required" };
      }

      const template = getTemplateManager().getTemplate(templateId);
      if (!template) {
        return { success: false, error: `Template not found: ${templateId}` };
      }

      return { success: true, data: template };
    },
  );

  safeHandle(
    "agents:create-template",
    "Create template",
    async (_event, { template } = {}) => {
      if (!template || !template.name || !template.type) {
        return { success: false, error: "Template name and type are required" };
      }

      const created = getTemplateManager().createTemplate(template);
      logger.info(`[AgentsIPC] Template created: ${created.id} (${created.name})`);
      return { success: true, data: created };
    },
  );

  safeHandle(
    "agents:update-template",
    "Update template",
    async (_event, { templateId, updates } = {}) => {
      if (!templateId) {
        return { success: false, error: "Template ID is required" };
      }

      if (!updates || Object.keys(updates).length === 0) {
        return { success: false, error: "No updates provided" };
      }

      const updated = getTemplateManager().updateTemplate(templateId, updates);
      if (!updated) {
        return { success: false, error: `Template not found: ${templateId}` };
      }

      logger.info(`[AgentsIPC] Template updated: ${templateId}`);
      return { success: true, data: updated };
    },
  );

  safeHandle(
    "agents:delete-template",
    "Delete template",
    async (_event, { templateId } = {}) => {
      if (!templateId) {
        return { success: false, error: "Template ID is required" };
      }

      const deleted = getTemplateManager().deleteTemplate(templateId);
      if (!deleted) {
        return { success: false, error: `Template not found: ${templateId}` };
      }

      logger.info(`[AgentsIPC] Template deleted: ${templateId}`);
      return { success: true, data: { templateId, deleted: true } };
    },
  );

  safeHandle(
    "agents:deploy-agent",
    "Deploy agent",
    async (_event, { templateId, config = {} } = {}) => {
      if (!templateId) {
        return { success: false, error: "Template ID is required" };
      }

      const instance = await getAgentRegistry().deploy(templateId, config);
      logger.info(`[AgentsIPC] Agent deployed: ${instance.id} from template ${templateId}`);
      return { success: true, data: instance };
    },
  );

  safeHandle(
    "agents:terminate-agent",
    "Terminate agent",
    async (_event, { agentId, reason = "" } = {}) => {
      if (!agentId) {
        return { success: false, error: "Agent ID is required" };
      }

      const result = await getAgentRegistry().terminate(agentId, reason);
      logger.info(
        `[AgentsIPC] Agent terminated: ${agentId}, reason: ${reason || "none"}`,
      );
      return { success: true, data: result };
    },
  );

  safeHandle(
    "agents:list-instances",
    "List instances",
    async (_event, payload = {}) => {
      const instances = getAgentRegistry().listInstances(payload.filters || {});
      return {
        success: true,
        data: instances,
        total: instances.length,
      };
    },
  );

  safeHandle(
    "agents:get-status",
    "Get status",
    async (_event, { agentId } = {}) => {
      if (!agentId) {
        return { success: false, error: "Agent ID is required" };
      }

      const status = getAgentRegistry().getStatus(agentId);
      if (!status) {
        return { success: false, error: `Agent not found: ${agentId}` };
      }

      return { success: true, data: status };
    },
  );

  safeHandle(
    "agents:assign-task",
    "Assign task",
    async (_event, { agentId, taskDescription, options = {} } = {}) => {
      if (!agentId) {
        return { success: false, error: "Agent ID is required" };
      }

      if (!taskDescription) {
        return { success: false, error: "Task description is required" };
      }

      return getAgentCoordinator().assignTask(agentId, taskDescription, options);
    },
  );

  safeHandle(
    "agents:get-task-status",
    "Get task status",
    async (_event, { taskId } = {}) => {
      if (!taskId) {
        return { success: false, error: "Task ID is required" };
      }

      return getAgentCoordinator().getTaskStatus(taskId);
    },
  );

  safeHandle(
    "agents:cancel-task",
    "Cancel task",
    async (_event, { taskId, reason = "" } = {}) => {
      if (!taskId) {
        return { success: false, error: "Task ID is required" };
      }

      const result = getAgentCoordinator().cancelTask(taskId, reason);
      if (result.success) {
        logger.info(`[AgentsIPC] Task cancelled: ${taskId}`);
      }
      return result;
    },
  );

  safeHandle(
    "agents:orchestrate",
    "Orchestrate",
    async (_event, { taskDescription, options = {} } = {}) => {
      if (!taskDescription) {
        return { success: false, error: "Task description is required" };
      }

      logger.info(`[AgentsIPC] Orchestrating: ${taskDescription.substring(0, 100)}...`);
      return getAgentCoordinator().orchestrate(taskDescription, options);
    },
  );

  safeHandle(
    "agents:get-plan",
    "Get plan",
    async (_event, { taskDescription, options = {} } = {}) => {
      if (!taskDescription) {
        return { success: false, error: "Task description is required" };
      }

      const plan = getAgentCoordinator().getPlan(taskDescription, options);
      return { success: true, data: plan };
    },
  );

  safeHandle(
    "agents:get-performance",
    "Get performance",
    async (_event, { options = {} } = {}) => {
      return getAgentCoordinator().getPerformance(options);
    },
  );

  safeHandle("agents:get-statistics", "Get statistics", async () => {
    const stats = getAgentCoordinator().getSystemStatistics();
    return { success: true, data: stats };
  });

  logger.info(`[AgentsIPC] Registered ${AGENTS_IPC_CHANNELS.length} IPC handlers`);
  return { handlerCount: AGENTS_IPC_CHANNELS.length };
}

function unregisterAgentsIPC({ ipcMain: injectedIpcMain } = {}) {
  const ipc = injectedIpcMain || electronIpcMain;
  if (typeof ipc.removeHandler === "function") {
    AGENTS_IPC_CHANNELS.forEach((channel) => {
      ipc.removeHandler(channel);
    });
  }

  logger.info("[AgentsIPC] Unregistered all IPC handlers");
}

module.exports = {
  AGENTS_IPC_CHANNELS,
  registerAgentsIPC,
  unregisterAgentsIPC,
};
