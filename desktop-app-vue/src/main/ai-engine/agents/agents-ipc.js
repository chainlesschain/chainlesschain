/**
 * Specialized Agents IPC Handlers
 *
 * Provides 16 IPC handlers for the specialized multi-agent system:
 * - Template management (5): list, get, create, update, delete
 * - Agent deployment (4): deploy, terminate, list instances, get status
 * - Task management (3): assign, get status, cancel
 * - Coordination (2): orchestrate, get plan
 * - Analytics (2): get performance, get statistics
 *
 * @module ai-engine/agents/agents-ipc
 */

const { ipcMain } = require('electron');
const { logger } = require('../../utils/logger.js');

/**
 * Register all Agents IPC handlers
 *
 * Uses lazy initialization to avoid circular dependencies and
 * defer component creation until first use.
 *
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.database - Database instance (better-sqlite3)
 */
function registerAgentsIPC(dependencies) {
  const { database } = dependencies;

  // Lazy-initialized singletons
  let templateManager = null;
  let agentRegistry = null;
  let agentCoordinator = null;

  /**
   * Get or create the AgentTemplateManager singleton
   * @returns {Object} AgentTemplateManager instance
   */
  function getTemplateManager() {
    if (!templateManager) {
      const { AgentTemplateManager } = require('./agent-templates');
      templateManager = new AgentTemplateManager({ database });
      logger.info('[AgentsIPC] AgentTemplateManager initialized');
    }
    return templateManager;
  }

  /**
   * Get or create the AgentRegistry singleton
   * @returns {Object} AgentRegistry instance
   */
  function getAgentRegistry() {
    if (!agentRegistry) {
      const { AgentRegistry } = require('./agent-registry');
      agentRegistry = new AgentRegistry({ database, templateManager: getTemplateManager() });
      logger.info('[AgentsIPC] AgentRegistry initialized');
    }
    return agentRegistry;
  }

  /**
   * Get or create the AgentCoordinator singleton
   * @returns {Object} AgentCoordinator instance
   */
  function getAgentCoordinator() {
    if (!agentCoordinator) {
      const { AgentCoordinator } = require('./agent-coordinator');
      agentCoordinator = new AgentCoordinator({
        database,
        agentRegistry: getAgentRegistry(),
        templateManager: getTemplateManager(),
      });
      logger.info('[AgentsIPC] AgentCoordinator initialized');
    }
    return agentCoordinator;
  }

  logger.info('[AgentsIPC] Registering IPC handlers...');

  // ==========================================
  // Template Management (5 handlers)
  // ==========================================

  /**
   * List all agent templates
   * Returns all registered templates with optional filtering
   */
  ipcMain.handle('agents:list-templates', async (event, { filters = {} } = {}) => {
    try {
      const tm = getTemplateManager();
      const templates = tm.listTemplates(filters);
      return {
        success: true,
        data: templates,
        total: templates.length,
      };
    } catch (error) {
      logger.error(`[AgentsIPC] List templates error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get a specific template by ID
   */
  ipcMain.handle('agents:get-template', async (event, { templateId }) => {
    try {
      if (!templateId) {
        return { success: false, error: 'Template ID is required' };
      }

      const tm = getTemplateManager();
      const template = tm.getTemplate(templateId);

      if (!template) {
        return { success: false, error: `Template not found: ${templateId}` };
      }

      return { success: true, data: template };
    } catch (error) {
      logger.error(`[AgentsIPC] Get template error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Create a new agent template
   */
  ipcMain.handle('agents:create-template', async (event, { template }) => {
    try {
      if (!template || !template.name || !template.type) {
        return { success: false, error: 'Template name and type are required' };
      }

      const tm = getTemplateManager();
      const created = tm.createTemplate(template);

      logger.info(`[AgentsIPC] Template created: ${created.id} (${created.name})`);

      return { success: true, data: created };
    } catch (error) {
      logger.error(`[AgentsIPC] Create template error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Update an existing template
   */
  ipcMain.handle('agents:update-template', async (event, { templateId, updates }) => {
    try {
      if (!templateId) {
        return { success: false, error: 'Template ID is required' };
      }

      if (!updates || Object.keys(updates).length === 0) {
        return { success: false, error: 'No updates provided' };
      }

      const tm = getTemplateManager();
      const updated = tm.updateTemplate(templateId, updates);

      if (!updated) {
        return { success: false, error: `Template not found: ${templateId}` };
      }

      logger.info(`[AgentsIPC] Template updated: ${templateId}`);

      return { success: true, data: updated };
    } catch (error) {
      logger.error(`[AgentsIPC] Update template error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Delete a template
   */
  ipcMain.handle('agents:delete-template', async (event, { templateId }) => {
    try {
      if (!templateId) {
        return { success: false, error: 'Template ID is required' };
      }

      const tm = getTemplateManager();
      const deleted = tm.deleteTemplate(templateId);

      if (!deleted) {
        return { success: false, error: `Template not found: ${templateId}` };
      }

      logger.info(`[AgentsIPC] Template deleted: ${templateId}`);

      return { success: true, data: { templateId, deleted: true } };
    } catch (error) {
      logger.error(`[AgentsIPC] Delete template error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Agent Deployment (4 handlers)
  // ==========================================

  /**
   * Deploy an agent instance from a template
   */
  ipcMain.handle('agents:deploy-agent', async (event, { templateId, config = {} }) => {
    try {
      if (!templateId) {
        return { success: false, error: 'Template ID is required' };
      }

      const registry = getAgentRegistry();
      const instance = await registry.deploy(templateId, config);

      logger.info(`[AgentsIPC] Agent deployed: ${instance.id} from template ${templateId}`);

      return { success: true, data: instance };
    } catch (error) {
      logger.error(`[AgentsIPC] Deploy agent error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Terminate a running agent instance
   */
  ipcMain.handle('agents:terminate-agent', async (event, { agentId, reason = '' }) => {
    try {
      if (!agentId) {
        return { success: false, error: 'Agent ID is required' };
      }

      const registry = getAgentRegistry();
      const result = registry.terminate(agentId, reason);

      logger.info(`[AgentsIPC] Agent terminated: ${agentId}, reason: ${reason || 'none'}`);

      return { success: true, data: result };
    } catch (error) {
      logger.error(`[AgentsIPC] Terminate agent error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * List all active agent instances
   */
  ipcMain.handle('agents:list-instances', async (event, { filters = {} } = {}) => {
    try {
      const registry = getAgentRegistry();
      const instances = registry.listInstances(filters);

      return {
        success: true,
        data: instances,
        total: instances.length,
      };
    } catch (error) {
      logger.error(`[AgentsIPC] List instances error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get detailed status of an agent instance
   */
  ipcMain.handle('agents:get-status', async (event, { agentId }) => {
    try {
      if (!agentId) {
        return { success: false, error: 'Agent ID is required' };
      }

      const registry = getAgentRegistry();
      const status = registry.getStatus(agentId);

      if (!status) {
        return { success: false, error: `Agent not found: ${agentId}` };
      }

      return { success: true, data: status };
    } catch (error) {
      logger.error(`[AgentsIPC] Get status error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Task Management (3 handlers)
  // ==========================================

  /**
   * Assign a task to a specific agent
   */
  ipcMain.handle('agents:assign-task', async (event, { agentId, taskDescription, options = {} }) => {
    try {
      if (!agentId) {
        return { success: false, error: 'Agent ID is required' };
      }

      if (!taskDescription) {
        return { success: false, error: 'Task description is required' };
      }

      const coordinator = getAgentCoordinator();
      const result = await coordinator.assignTask(agentId, taskDescription, options);

      return result;
    } catch (error) {
      logger.error(`[AgentsIPC] Assign task error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get the status of a specific task
   */
  ipcMain.handle('agents:get-task-status', async (event, { taskId }) => {
    try {
      if (!taskId) {
        return { success: false, error: 'Task ID is required' };
      }

      const coordinator = getAgentCoordinator();
      const status = coordinator.getTaskStatus(taskId);

      return status;
    } catch (error) {
      logger.error(`[AgentsIPC] Get task status error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Cancel a running task
   */
  ipcMain.handle('agents:cancel-task', async (event, { taskId, reason = '' }) => {
    try {
      if (!taskId) {
        return { success: false, error: 'Task ID is required' };
      }

      const coordinator = getAgentCoordinator();
      const result = coordinator.cancelTask(taskId, reason);

      if (result.success) {
        logger.info(`[AgentsIPC] Task cancelled: ${taskId}`);
      }

      return result;
    } catch (error) {
      logger.error(`[AgentsIPC] Cancel task error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Coordination (2 handlers)
  // ==========================================

  /**
   * Orchestrate a complex task through multiple agents
   * Decomposes, assigns, executes, and aggregates results
   */
  ipcMain.handle('agents:orchestrate', async (event, { taskDescription, options = {} }) => {
    try {
      if (!taskDescription) {
        return { success: false, error: 'Task description is required' };
      }

      logger.info(`[AgentsIPC] Orchestrating: ${taskDescription.substring(0, 100)}...`);

      const coordinator = getAgentCoordinator();
      const result = await coordinator.orchestrate(taskDescription, options);

      return result;
    } catch (error) {
      logger.error(`[AgentsIPC] Orchestrate error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Generate an execution plan without running it
   * Returns proposed agent assignments and execution order
   */
  ipcMain.handle('agents:get-plan', async (event, { taskDescription, options = {} }) => {
    try {
      if (!taskDescription) {
        return { success: false, error: 'Task description is required' };
      }

      const coordinator = getAgentCoordinator();
      const plan = coordinator.getPlan(taskDescription, options);

      return { success: true, data: plan };
    } catch (error) {
      logger.error(`[AgentsIPC] Get plan error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // ==========================================
  // Analytics (2 handlers)
  // ==========================================

  /**
   * Get agent performance metrics from task history
   */
  ipcMain.handle('agents:get-performance', async (event, { options = {} } = {}) => {
    try {
      const coordinator = getAgentCoordinator();
      const performance = coordinator.getPerformance(options);

      return performance;
    } catch (error) {
      logger.error(`[AgentsIPC] Get performance error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get overall system statistics
   */
  ipcMain.handle('agents:get-statistics', async (event) => {
    try {
      const coordinator = getAgentCoordinator();
      const stats = coordinator.getSystemStatistics();

      return { success: true, data: stats };
    } catch (error) {
      logger.error(`[AgentsIPC] Get statistics error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  logger.info('[AgentsIPC] Registered 16 IPC handlers');
  logger.info('[AgentsIPC]   - Templates: 5 handlers (list, get, create, update, delete)');
  logger.info('[AgentsIPC]   - Deploy: 4 handlers (deploy, terminate, list-instances, get-status)');
  logger.info('[AgentsIPC]   - Tasks: 3 handlers (assign, get-task-status, cancel)');
  logger.info('[AgentsIPC]   - Coordination: 2 handlers (orchestrate, get-plan)');
  logger.info('[AgentsIPC]   - Analytics: 2 handlers (get-performance, get-statistics)');
}

/**
 * Unregister all Agents IPC handlers
 * Used for cleanup during app shutdown or hot reload
 */
function unregisterAgentsIPC() {
  const channels = [
    // Templates
    'agents:list-templates',
    'agents:get-template',
    'agents:create-template',
    'agents:update-template',
    'agents:delete-template',
    // Deploy
    'agents:deploy-agent',
    'agents:terminate-agent',
    'agents:list-instances',
    'agents:get-status',
    // Tasks
    'agents:assign-task',
    'agents:get-task-status',
    'agents:cancel-task',
    // Coordination
    'agents:orchestrate',
    'agents:get-plan',
    // Analytics
    'agents:get-performance',
    'agents:get-statistics',
  ];

  channels.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  logger.info('[AgentsIPC] Unregistered all IPC handlers');
}

module.exports = { registerAgentsIPC, unregisterAgentsIPC };
