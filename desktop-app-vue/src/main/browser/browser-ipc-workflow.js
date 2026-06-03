/**
 * Browser IPC handlers — workflow group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-workflow
 */

function registerWorkflowHandlers(ctx) {
  const { _ipcMain, _getBrowserEngine, withErrorHandler } = ctx;

  // ==================== Phase 7: Action Replay (v0.33.0) ====================

  /**
   * Load actions for replay
   * @param {Array} actions - Actions to load
   * @param {Object} options - Load options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:load",
    withErrorHandler(async (event, actions, options = {}) => {
      const { getActionReplay } = require("./actions");
      const engine = _getBrowserEngine();
      const replay = getActionReplay(engine);
      return replay.load(actions, options);
    }),
  );

  /**
   * Start action replay
   * @param {Object} options - Replay options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:play",
    withErrorHandler(async (event, options = {}) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.play(options);
    }),
  );

  /**
   * Pause action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:pause",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.pause();
    }),
  );

  /**
   * Resume action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:resume",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.resume();
    }),
  );

  /**
   * Step through action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:step",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.step();
    }),
  );

  /**
   * Stop action replay
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:stop",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.stop();
    }),
  );

  /**
   * Get replay status
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:status",
    withErrorHandler(async (event) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      return replay.getStatus();
    }),
  );

  /**
   * Set replay speed
   * @param {number} speed - Speed multiplier
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:replay:setSpeed",
    withErrorHandler(async (event, speed) => {
      const { getActionReplay } = require("./actions");
      const replay = getActionReplay();
      replay.setSpeed(speed);
      return { success: true, speed };
    }),
  );

  // ==================== Phase 7: Safe Mode (v0.33.0) ====================

  /**
   * Check permission for action
   * @param {string} actionType - Action type
   * @param {Object} params - Action params
   * @param {Object} context - Context info
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:checkPermission",
    withErrorHandler(async (event, actionType, params = {}, context = {}) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.checkPermission(actionType, params, context);
    }),
  );

  /**
   * Set safe mode level
   * @param {string} level - Safety level
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:setLevel",
    withErrorHandler(async (event, level) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      safeMode.setLevel(level);
      return { success: true, level };
    }),
  );

  /**
   * Enable/disable safe mode
   * @param {boolean} enabled
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:setEnabled",
    withErrorHandler(async (event, enabled) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      safeMode.setEnabled(enabled);
      return { success: true, enabled };
    }),
  );

  /**
   * Get safe mode config
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:getConfig",
    withErrorHandler(async (event) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.getConfig();
    }),
  );

  /**
   * Update safe mode config
   * @param {Object} updates - Config updates
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:updateConfig",
    withErrorHandler(async (event, updates) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      safeMode.updateConfig(updates);
      return safeMode.getConfig();
    }),
  );

  /**
   * Respond to confirmation request
   * @param {string} confirmationId - Confirmation ID
   * @param {boolean} approved - Whether approved
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:safeMode:respond",
    withErrorHandler(async (event, confirmationId, approved) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.respondToConfirmation(confirmationId, approved);
    }),
  );

  /**
   * Get pending confirmations
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:safeMode:getPending",
    withErrorHandler(async (event) => {
      const { getSafeMode } = require("./actions");
      const safeMode = getSafeMode();
      return safeMode.getPendingConfirmations();
    }),
  );

  // ==================== Phase 7: Workflow Engine (v0.33.0) ====================

  /**
   * Create workflow
   * @param {Object} definition - Workflow definition
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:create",
    withErrorHandler(async (event, definition) => {
      const { getWorkflowEngine } = require("./actions");
      const engine = _getBrowserEngine();
      const workflow = getWorkflowEngine(engine);
      return workflow.createWorkflow(definition);
    }),
  );

  /**
   * Execute workflow
   * @param {string} workflowId - Workflow ID
   * @param {Object} options - Execution options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:execute",
    withErrorHandler(async (event, workflowId, options = {}) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.execute(workflowId, options);
    }),
  );

  /**
   * Pause workflow
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:pause",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.pause();
    }),
  );

  /**
   * Resume workflow
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:resume",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.resume();
    }),
  );

  /**
   * Cancel workflow
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:cancel",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.cancel();
    }),
  );

  /**
   * Get workflow status
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:status",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.getStatus();
    }),
  );

  /**
   * List workflows
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:list",
    withErrorHandler(async (event) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.listWorkflows();
    }),
  );

  /**
   * Get workflow details
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:get",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.getWorkflow(workflowId);
    }),
  );

  /**
   * Delete workflow
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:delete",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.deleteWorkflow(workflowId);
    }),
  );

  /**
   * Save workflow to file
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:save",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.saveWorkflow(workflowId);
    }),
  );

  /**
   * Load workflow from file
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:workflow:load",
    withErrorHandler(async (event, workflowId) => {
      const { getWorkflowEngine } = require("./actions");
      const workflow = getWorkflowEngine();
      return workflow.loadWorkflow(workflowId);
    }),
  );
}

module.exports = { registerWorkflowHandlers };
