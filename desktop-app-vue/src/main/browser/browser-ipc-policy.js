/**
 * Browser IPC handlers — policy group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-policy
 */

function registerPolicyHandlers(ctx) {
  const { _ipcMain, withErrorHandler, getBrowserEngine } = ctx;

  // ============================================
  // Phase 10: AutomationPolicy IPC Handlers
  // ============================================

  /**
   * Check if action is allowed by policy
   * @param {Object} context - Action context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:check",
    withErrorHandler(async (event, context) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return await policy.check(context);
    }),
  );

  /**
   * Add a policy
   * @param {Object} policyConfig - Policy configuration
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:add",
    withErrorHandler(async (event, policyConfig) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.addPolicy(policyConfig);
    }),
  );

  /**
   * Remove a policy
   * @param {string} policyId - Policy ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:remove",
    withErrorHandler(async (event, policyId) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.removePolicy(policyId);
    }),
  );

  /**
   * Update a policy
   * @param {string} policyId - Policy ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:update",
    withErrorHandler(async (event, policyId, updates) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.updatePolicy(policyId, updates);
    }),
  );

  /**
   * List all policies
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:policy:list",
    withErrorHandler(async () => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.list();
    }),
  );

  /**
   * Get policy by ID
   * @param {string} policyId - Policy ID
   * @returns {Promise<Object|null>}
   */
  _ipcMain.handle(
    "browser:policy:get",
    withErrorHandler(async (event, policyId) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.get(policyId);
    }),
  );

  /**
   * Get policy violations
   * @param {number} limit - Maximum number of violations
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:policy:violations",
    withErrorHandler(async (event, limit = 50) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.getViolations(limit);
    }),
  );

  /**
   * Get policy stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:stats",
    withErrorHandler(async () => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.getStats();
    }),
  );

  /**
   * Export policies
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:export",
    withErrorHandler(async () => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.export();
    }),
  );

  /**
   * Import policies
   * @param {Object} data - Import data
   * @param {boolean} merge - Whether to merge with existing
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:policy:import",
    withErrorHandler(async (event, data, merge = false) => {
      const { getAutomationPolicy } = require("./actions");
      const policy = getAutomationPolicy();
      return policy.import(data, merge);
    }),
  );

  // ============================================
  // Phase 10: ScreenAnalyzer IPC Handlers
  // ============================================

  /**
   * Analyze screen
   * @param {string} targetId - Tab ID
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:analyze",
    withErrorHandler(async (event, targetId, options = {}) => {
      const engine = getBrowserEngine();
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer(engine);
      return await analyzer.analyze(targetId, options);
    }),
  );

  /**
   * Find regions matching criteria
   * @param {string} targetId - Tab ID
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:findRegions",
    withErrorHandler(async (event, targetId, criteria = {}) => {
      const engine = getBrowserEngine();
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer(engine);
      return await analyzer.findRegions(targetId, criteria);
    }),
  );

  /**
   * Capture a region screenshot
   * @param {string} targetId - Tab ID
   * @param {Object} bounds - Region bounds
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:captureRegion",
    withErrorHandler(async (event, targetId, bounds) => {
      const engine = getBrowserEngine();
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer(engine);
      return await analyzer.captureRegion(targetId, bounds);
    }),
  );

  /**
   * Compare two analyses
   * @param {Object} before - Previous analysis
   * @param {Object} after - Current analysis
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:compare",
    withErrorHandler(async (event, before, after) => {
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer();
      return analyzer.compare(before, after);
    }),
  );

  /**
   * Clear analyzer cache
   * @param {string} targetId - Tab ID (optional)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:clearCache",
    withErrorHandler(async (event, targetId = null) => {
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer();
      analyzer.clearCache(targetId);
      return { success: true };
    }),
  );

  /**
   * Get analyzer stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:analyzer:stats",
    withErrorHandler(async () => {
      const { getScreenAnalyzer } = require("./actions");
      const analyzer = getScreenAnalyzer();
      return analyzer.getStats();
    }),
  );

  // ============================================
  // Phase 10: ActionSuggestion IPC Handlers
  // ============================================

  /**
   * Get action suggestions
   * @param {Object} context - Current context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:suggest",
    withErrorHandler(async (event, context) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return await suggestion.suggest(context);
    }),
  );

  /**
   * Record an action
   * @param {Object} action - Action to record
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:recordAction",
    withErrorHandler(async (event, action) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.recordAction(action);
      return { success: true };
    }),
  );

  /**
   * Provide feedback on a suggestion
   * @param {Object} suggestionData - Suggestion that was used
   * @param {boolean} accepted - Whether it was accepted
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:feedback",
    withErrorHandler(async (event, suggestionData, accepted) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.feedback(suggestionData, accepted);
      return { success: true };
    }),
  );

  /**
   * Get suggestion history
   * @param {number} limit - Maximum items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:suggestion:history",
    withErrorHandler(async (event, limit = 20) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.getHistory(limit);
    }),
  );

  /**
   * Get suggestion stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:stats",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.getStats();
    }),
  );

  /**
   * Clear suggestion history
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:clearHistory",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.clearHistory();
      return { success: true };
    }),
  );

  /**
   * Clear learned patterns
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:clearPatterns",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      suggestion.clearLearnedPatterns();
      return { success: true };
    }),
  );

  /**
   * Export suggestion data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:export",
    withErrorHandler(async () => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.export();
    }),
  );

  /**
   * Import suggestion data
   * @param {Object} data - Data to import
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:suggestion:import",
    withErrorHandler(async (event, data) => {
      const { getActionSuggestion } = require("./actions");
      const suggestion = getActionSuggestion();
      return suggestion.import(data);
    }),
  );
}

module.exports = { registerPolicyHandlers };
