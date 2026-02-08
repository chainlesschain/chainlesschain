/**
 * Workflow IPC - IPC handlers for browser workflow system
 *
 * @module browser/workflow/workflow-ipc
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { ipcMain } = require("electron");
const { logger } = require("../../utils/logger");
const { createIPCErrorHandler } = require("../../utils/ipc-error-handler");
const { WorkflowEngine } = require("./workflow-engine");
const { WorkflowStorage } = require("./workflow-storage");
const {
  createWorkflow,
  condition,
  and,
  or,
  not,
} = require("./workflow-builder");

// Singleton instances
let workflowEngine = null;
let workflowStorage = null;

/**
 * Initialize workflow system
 * @param {Object} browserEngine - Browser engine instance
 * @param {Object} db - Database instance
 */
function initializeWorkflowSystem(browserEngine, db) {
  if (!workflowStorage && db) {
    workflowStorage = new WorkflowStorage(db);
    logger.info("[WorkflowIPC] WorkflowStorage initialized");
  }

  if (!workflowEngine && browserEngine) {
    workflowEngine = new WorkflowEngine(browserEngine, {
      storage: workflowStorage,
    });

    // Register engine events
    workflowEngine.on("workflow:started", (data) => {
      logger.info("[WorkflowIPC] Workflow started", data);
    });

    workflowEngine.on("workflow:completed", (data) => {
      logger.info("[WorkflowIPC] Workflow completed", data);
    });

    workflowEngine.on("workflow:failed", (data) => {
      logger.error("[WorkflowIPC] Workflow failed", data);
    });

    workflowEngine.on("workflow:paused", (data) => {
      logger.info("[WorkflowIPC] Workflow paused", data);
    });

    workflowEngine.on("workflow:step:completed", (data) => {
      logger.debug("[WorkflowIPC] Step completed", data);
    });

    logger.info("[WorkflowIPC] WorkflowEngine initialized");
  }
}

/**
 * Get workflow engine instance
 * @returns {WorkflowEngine}
 */
function getWorkflowEngine() {
  if (!workflowEngine) {
    throw new Error(
      "Workflow engine not initialized. Call initializeWorkflowSystem first.",
    );
  }
  return workflowEngine;
}

/**
 * Get workflow storage instance
 * @returns {WorkflowStorage}
 */
function getWorkflowStorage() {
  if (!workflowStorage) {
    throw new Error(
      "Workflow storage not initialized. Call initializeWorkflowSystem first.",
    );
  }
  return workflowStorage;
}

/**
 * Register all Workflow IPC handlers
 */
function registerWorkflowIPC() {
  const withErrorHandler = createIPCErrorHandler("workflow");

  // ==================== Workflow CRUD ====================

  /**
   * Create a new workflow
   * @param {Object} workflow - Workflow data
   * @returns {Promise<Object>} Created workflow
   */
  ipcMain.handle(
    "browser:workflow:create",
    withErrorHandler(async (event, workflow) => {
      const storage = getWorkflowStorage();
      const result = await storage.createWorkflow(workflow);

      logger.info("[WorkflowIPC] Workflow created", {
        id: result.id,
        name: result.name,
      });

      return result;
    }),
  );

  /**
   * Get workflow by ID
   * @param {string} id - Workflow ID
   * @returns {Promise<Object|null>} Workflow
   */
  ipcMain.handle(
    "browser:workflow:get",
    withErrorHandler(async (event, id) => {
      const storage = getWorkflowStorage();
      const workflow = await storage.getWorkflow(id);

      if (!workflow) {
        throw new Error(`Workflow ${id} not found`);
      }

      return workflow;
    }),
  );

  /**
   * List workflows
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Workflow list
   */
  ipcMain.handle(
    "browser:workflow:list",
    withErrorHandler(async (event, options = {}) => {
      const storage = getWorkflowStorage();
      const workflows = await storage.listWorkflows(options);

      logger.debug("[WorkflowIPC] Listed workflows", {
        count: workflows.length,
        options,
      });

      return workflows;
    }),
  );

  /**
   * Update workflow
   * @param {string} id - Workflow ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated workflow
   */
  ipcMain.handle(
    "browser:workflow:update",
    withErrorHandler(async (event, id, updates) => {
      const storage = getWorkflowStorage();
      const result = await storage.updateWorkflow(id, updates);

      logger.info("[WorkflowIPC] Workflow updated", { id });

      return result;
    }),
  );

  /**
   * Delete workflow
   * @param {string} id - Workflow ID
   * @returns {Promise<boolean>} Success
   */
  ipcMain.handle(
    "browser:workflow:delete",
    withErrorHandler(async (event, id) => {
      const storage = getWorkflowStorage();
      const result = await storage.deleteWorkflow(id);

      logger.info("[WorkflowIPC] Workflow deleted", { id });

      return result;
    }),
  );

  /**
   * Duplicate workflow
   * @param {string} id - Source workflow ID
   * @param {string} newName - Name for the duplicate
   * @returns {Promise<Object>} New workflow
   */
  ipcMain.handle(
    "browser:workflow:duplicate",
    withErrorHandler(async (event, id, newName) => {
      const storage = getWorkflowStorage();
      const result = await storage.duplicateWorkflow(id, newName);

      logger.info("[WorkflowIPC] Workflow duplicated", {
        sourceId: id,
        newId: result.id,
      });

      return result;
    }),
  );

  // ==================== Workflow Execution ====================

  /**
   * Execute a workflow
   * @param {string} workflowId - Workflow ID
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  ipcMain.handle(
    "browser:workflow:execute",
    withErrorHandler(async (event, workflowId, options = {}) => {
      const storage = getWorkflowStorage();
      const engine = getWorkflowEngine();

      const workflow = await storage.getWorkflow(workflowId);
      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found`);
      }

      if (!workflow.isEnabled) {
        throw new Error(`Workflow ${workflowId} is disabled`);
      }

      logger.info("[WorkflowIPC] Executing workflow", {
        workflowId,
        targetId: options.targetId,
      });

      const result = await engine.executeWorkflow(workflow, options);

      return result;
    }),
  );

  /**
   * Execute workflow inline (without saving)
   * @param {Object} workflow - Workflow definition
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   */
  ipcMain.handle(
    "browser:workflow:executeInline",
    withErrorHandler(async (event, workflow, options = {}) => {
      const engine = getWorkflowEngine();

      logger.info("[WorkflowIPC] Executing inline workflow", {
        name: workflow.name,
        targetId: options.targetId,
      });

      const result = await engine.executeWorkflow(workflow, options);

      return result;
    }),
  );

  /**
   * Pause workflow execution
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} Success
   */
  ipcMain.handle(
    "browser:workflow:pause",
    withErrorHandler(async (event, executionId) => {
      const engine = getWorkflowEngine();
      const result = engine.pause(executionId);

      logger.info("[WorkflowIPC] Workflow paused", {
        executionId,
        success: result,
      });

      return result;
    }),
  );

  /**
   * Resume workflow execution
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} Success
   */
  ipcMain.handle(
    "browser:workflow:resume",
    withErrorHandler(async (event, executionId) => {
      const engine = getWorkflowEngine();
      const result = engine.resume(executionId);

      logger.info("[WorkflowIPC] Workflow resumed", {
        executionId,
        success: result,
      });

      return result;
    }),
  );

  /**
   * Cancel workflow execution
   * @param {string} executionId - Execution ID
   * @returns {Promise<boolean>} Success
   */
  ipcMain.handle(
    "browser:workflow:cancel",
    withErrorHandler(async (event, executionId) => {
      const engine = getWorkflowEngine();
      const result = engine.cancel(executionId);

      logger.info("[WorkflowIPC] Workflow cancelled", {
        executionId,
        success: result,
      });

      return result;
    }),
  );

  /**
   * Get workflow execution status
   * @param {string} executionId - Execution ID
   * @returns {Promise<Object|null>} Status
   */
  ipcMain.handle(
    "browser:workflow:getStatus",
    withErrorHandler(async (event, executionId) => {
      const engine = getWorkflowEngine();
      return engine.getStatus(executionId);
    }),
  );

  /**
   * List active executions
   * @returns {Promise<Array>} Active executions
   */
  ipcMain.handle(
    "browser:workflow:listActive",
    withErrorHandler(async (event) => {
      const engine = getWorkflowEngine();
      return engine.listActiveExecutions();
    }),
  );

  // ==================== Execution History ====================

  /**
   * Get execution by ID
   * @param {string} executionId - Execution ID
   * @returns {Promise<Object>} Execution record
   */
  ipcMain.handle(
    "browser:workflow:getExecution",
    withErrorHandler(async (event, executionId) => {
      const storage = getWorkflowStorage();
      const execution = await storage.getExecution(executionId);

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      return execution;
    }),
  );

  /**
   * List workflow executions
   * @param {Object} options - Filter options
   * @returns {Promise<Array>} Execution list
   */
  ipcMain.handle(
    "browser:workflow:listExecutions",
    withErrorHandler(async (event, options = {}) => {
      const storage = getWorkflowStorage();
      return storage.listExecutions(options);
    }),
  );

  /**
   * Get workflow statistics
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>} Statistics
   */
  ipcMain.handle(
    "browser:workflow:getStats",
    withErrorHandler(async (event, workflowId) => {
      const storage = getWorkflowStorage();
      return storage.getWorkflowStats(workflowId);
    }),
  );

  // ==================== Variables ====================

  /**
   * Set workflow variable during execution
   * @param {string} executionId - Execution ID
   * @param {string} name - Variable name
   * @param {any} value - Variable value
   * @returns {Promise<boolean>} Success
   */
  ipcMain.handle(
    "browser:workflow:setVariable",
    withErrorHandler(async (event, executionId, name, value) => {
      const engine = getWorkflowEngine();
      const context = engine.executions.get(executionId);

      if (!context) {
        throw new Error(`Execution ${executionId} not found or not active`);
      }

      context.variables.set(name, value);

      logger.debug("[WorkflowIPC] Variable set", { executionId, name });

      return true;
    }),
  );

  /**
   * Get workflow variables
   * @param {string} executionId - Execution ID
   * @returns {Promise<Object>} Variables
   */
  ipcMain.handle(
    "browser:workflow:getVariables",
    withErrorHandler(async (event, executionId) => {
      const engine = getWorkflowEngine();
      const context = engine.executions.get(executionId);

      if (!context) {
        throw new Error(`Execution ${executionId} not found or not active`);
      }

      return context.variables.getAll();
    }),
  );

  // ==================== Import/Export ====================

  /**
   * Export workflow to JSON
   * @param {string} id - Workflow ID
   * @returns {Promise<Object>} Exportable data
   */
  ipcMain.handle(
    "browser:workflow:export",
    withErrorHandler(async (event, id) => {
      const storage = getWorkflowStorage();
      const data = await storage.exportWorkflow(id);

      logger.info("[WorkflowIPC] Workflow exported", { id });

      return data;
    }),
  );

  /**
   * Import workflow from JSON
   * @param {Object} data - Imported data
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Imported workflow
   */
  ipcMain.handle(
    "browser:workflow:import",
    withErrorHandler(async (event, data, options = {}) => {
      const storage = getWorkflowStorage();
      const result = await storage.importWorkflow(data, options);

      logger.info("[WorkflowIPC] Workflow imported", { id: result.id });

      return result;
    }),
  );

  // ==================== Workflow Builder Helpers ====================

  /**
   * Build workflow from steps (helper for frontend)
   * @param {string} name - Workflow name
   * @param {Array} steps - Step definitions
   * @param {Object} options - Build options
   * @returns {Promise<Object>} Built workflow
   */
  ipcMain.handle(
    "browser:workflow:build",
    withErrorHandler(async (event, name, steps, options = {}) => {
      const builder = createWorkflow(name);

      if (options.description) {
        builder.description(options.description);
      }
      if (options.tags) {
        builder.tags(...options.tags);
      }
      if (options.variables) {
        builder.variables(options.variables);
      }
      if (options.isTemplate) {
        builder.template();
      }

      // Add steps
      for (const step of steps) {
        builder.step(step);
      }

      return builder.build();
    }),
  );

  logger.info(
    "[WorkflowIPC] All Workflow IPC handlers registered (20 handlers)",
  );
}

/**
 * Cleanup workflow system
 */
function cleanupWorkflowSystem() {
  if (workflowEngine) {
    // Cancel all active executions
    for (const executionId of workflowEngine.executions.keys()) {
      workflowEngine.cancel(executionId);
    }
    workflowEngine = null;
  }
  workflowStorage = null;
  logger.info("[WorkflowIPC] Workflow system cleaned up");
}

module.exports = {
  registerWorkflowIPC,
  initializeWorkflowSystem,
  getWorkflowEngine,
  getWorkflowStorage,
  cleanupWorkflowSystem,
};
