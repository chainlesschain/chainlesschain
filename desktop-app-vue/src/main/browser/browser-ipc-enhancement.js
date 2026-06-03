/**
 * Browser IPC handlers — enhancement group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-enhancement
 */

function registerEnhancementHandlers(ctx) {
  const { _ipcMain, _getBrowserEngine, withErrorHandler } = ctx;

  // ==================== Phase 8: Element Highlighter (v0.33.0) ====================

  /**
   * Highlight element by bounds
   * @param {string} targetId - Tab ID
   * @param {Object} bounds - Element bounds { x, y, width, height }
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:bounds",
    withErrorHandler(async (event, targetId, bounds, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.highlightBounds(targetId, bounds, options);
    }),
  );

  /**
   * Highlight element by selector
   * @param {string} targetId - Tab ID
   * @param {string} selector - CSS selector
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:selector",
    withErrorHandler(async (event, targetId, selector, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.highlightSelector(targetId, selector, options);
    }),
  );

  /**
   * Highlight element by ref
   * @param {string} targetId - Tab ID
   * @param {string} ref - Element ref
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:ref",
    withErrorHandler(async (event, targetId, ref, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.highlightRef(targetId, ref, options);
    }),
  );

  /**
   * Show click highlight
   * @param {string} targetId - Tab ID
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} options - Highlight options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:click",
    withErrorHandler(async (event, targetId, x, y, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.showClickHighlight(targetId, x, y, options);
    }),
  );

  /**
   * Draw path on page
   * @param {string} targetId - Tab ID
   * @param {Array} points - Path points [{ x, y }, ...]
   * @param {Object} options - Draw options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:path",
    withErrorHandler(async (event, targetId, points, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.drawPath(targetId, points, options);
    }),
  );

  /**
   * Show annotation
   * @param {string} targetId - Tab ID
   * @param {string} text - Annotation text
   * @param {Object} position - Position { x, y }
   * @param {Object} options - Annotation options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:annotate",
    withErrorHandler(async (event, targetId, text, position, options = {}) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.showAnnotation(targetId, text, position, options);
    }),
  );

  /**
   * Clear all highlights
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:highlight:clear",
    withErrorHandler(async (event, targetId) => {
      const { getElementHighlighter } = require("./actions");
      const engine = _getBrowserEngine();
      const highlighter = getElementHighlighter(engine);
      return highlighter.clearHighlights(targetId);
    }),
  );

  /**
   * Get active highlights
   * @param {string} targetId - Tab ID
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:highlight:list",
    withErrorHandler(async (event, targetId) => {
      const { getElementHighlighter } = require("./actions");
      const highlighter = getElementHighlighter();
      return highlighter.getActiveHighlights(targetId);
    }),
  );

  // ==================== Phase 8: Template Actions (v0.33.0) ====================

  /**
   * List available templates
   * @param {string} category - Template category (optional)
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:template:list",
    withErrorHandler(async (event, category = null) => {
      const { getTemplateActions } = require("./actions");
      const engine = _getBrowserEngine();
      const templates = getTemplateActions(engine);
      return templates.listTemplates(category);
    }),
  );

  /**
   * Get template details
   * @param {string} templateId - Template ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:get",
    withErrorHandler(async (event, templateId) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.getTemplate(templateId);
    }),
  );

  /**
   * Execute template
   * @param {string} targetId - Tab ID
   * @param {string} templateId - Template ID
   * @param {Object} params - Template parameters
   * @param {Object} options - Execution options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:execute",
    withErrorHandler(
      async (event, targetId, templateId, params = {}, options = {}) => {
        const { getTemplateActions } = require("./actions");
        const engine = _getBrowserEngine();
        const templates = getTemplateActions(engine);
        return templates.executeTemplate(targetId, templateId, params, options);
      },
    ),
  );

  /**
   * Register custom template
   * @param {Object} template - Template definition
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:register",
    withErrorHandler(async (event, template) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.registerTemplate(template);
    }),
  );

  /**
   * Unregister template
   * @param {string} templateId - Template ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:unregister",
    withErrorHandler(async (event, templateId) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.unregisterTemplate(templateId);
    }),
  );

  /**
   * Validate template parameters
   * @param {string} templateId - Template ID
   * @param {Object} params - Parameters to validate
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:template:validate",
    withErrorHandler(async (event, templateId, params) => {
      const { getTemplateActions } = require("./actions");
      const templates = getTemplateActions();
      return templates.validateParams(templateId, params);
    }),
  );

  /**
   * Get template categories
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:template:categories",
    withErrorHandler(async (event) => {
      const { getTemplateActions, TemplateCategory } = require("./actions");
      return Object.values(TemplateCategory);
    }),
  );

  // ==================== Phase 8: Metrics Collection (v0.33.0) ====================

  /**
   * Record operation metric
   * @param {Object} data - Operation data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:record",
    withErrorHandler(async (event, data) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.recordOperation(data);
    }),
  );

  /**
   * Get session statistics
   * @param {string} sessionId - Session ID (optional)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:sessionStats",
    withErrorHandler(async (event, sessionId = null) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getSessionStats(sessionId);
    }),
  );

  /**
   * Get operation type statistics
   * @param {string} timeRange - Time range (hour/day/week/month/all)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:typeStats",
    withErrorHandler(async (event, timeRange = "day") => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getTypeStats(timeRange);
    }),
  );

  /**
   * Get error statistics
   * @param {string} timeRange - Time range
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:errorStats",
    withErrorHandler(async (event, timeRange = "day") => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getErrorStats(timeRange);
    }),
  );

  /**
   * Get performance metrics
   * @param {string} timeRange - Time range
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:performance",
    withErrorHandler(async (event, timeRange = "day") => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getPerformanceMetrics(timeRange);
    }),
  );

  /**
   * Get time series data
   * @param {string} metricName - Metric name
   * @param {string} timeRange - Time range
   * @param {string} granularity - Data granularity (minute/hour/day)
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:metrics:timeSeries",
    withErrorHandler(
      async (event, metricName, timeRange = "day", granularity = "hour") => {
        const { getComputerUseMetrics } = require("./actions");
        const metrics = getComputerUseMetrics();
        return metrics.getTimeSeries(metricName, timeRange, granularity);
      },
    ),
  );

  /**
   * Get overall summary
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:summary",
    withErrorHandler(async (event) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.getSummary();
    }),
  );

  /**
   * Export metrics
   * @param {string} format - Export format (json/csv)
   * @param {Object} options - Export options
   * @returns {Promise<string>}
   */
  _ipcMain.handle(
    "browser:metrics:export",
    withErrorHandler(async (event, format = "json", options = {}) => {
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.export(format, options);
    }),
  );

  /**
   * Reset metrics
   * @param {boolean} confirm - Confirmation flag
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:metrics:reset",
    withErrorHandler(async (event, confirm = false) => {
      if (!confirm) {
        return {
          success: false,
          message: "Confirmation required to reset metrics",
        };
      }
      const { getComputerUseMetrics } = require("./actions");
      const metrics = getComputerUseMetrics();
      return metrics.reset();
    }),
  );

  // ==================== Phase 9: Smart Element Detection (v0.33.0) ====================

  /**
   * Detect element using smart strategies
   * @param {string} targetId - Tab ID
   * @param {Object} query - Element query
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:element",
    withErrorHandler(async (event, targetId, query) => {
      const { getSmartElementDetector } = require("./actions");
      const engine = _getBrowserEngine();
      const detector = getSmartElementDetector(engine);
      return detector.detect(targetId, query);
    }),
  );

  /**
   * Detect multiple elements
   * @param {string} targetId - Tab ID
   * @param {Array} queries - Element queries
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:multiple",
    withErrorHandler(async (event, targetId, queries) => {
      const { getSmartElementDetector } = require("./actions");
      const engine = _getBrowserEngine();
      const detector = getSmartElementDetector(engine);
      return detector.detectMultiple(targetId, queries);
    }),
  );

  /**
   * Wait for element to appear
   * @param {string} targetId - Tab ID
   * @param {Object} query - Element query
   * @param {Object} options - Wait options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:waitFor",
    withErrorHandler(async (event, targetId, query, options = {}) => {
      const { getSmartElementDetector } = require("./actions");
      const engine = _getBrowserEngine();
      const detector = getSmartElementDetector(engine);
      return detector.waitFor(targetId, query, options);
    }),
  );

  /**
   * Get detector statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:stats",
    withErrorHandler(async (event) => {
      const { getSmartElementDetector } = require("./actions");
      const detector = getSmartElementDetector();
      return detector.getStats();
    }),
  );

  /**
   * Clear detector cache
   * @param {string} targetId - Tab ID (optional)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:detect:clearCache",
    withErrorHandler(async (event, targetId = null) => {
      const { getSmartElementDetector } = require("./actions");
      const detector = getSmartElementDetector();
      detector.clearCache(targetId);
      return { success: true };
    }),
  );

  // ==================== Phase 9: Error Recovery (v0.33.0) ====================

  /**
   * Execute operation with auto recovery
   * @param {string} targetId - Tab ID
   * @param {Object} operation - Operation config
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:execute",
    withErrorHandler(async (event, targetId, operation) => {
      const { getErrorRecoveryManager } = require("./actions");
      const engine = _getBrowserEngine();
      const recovery = getErrorRecoveryManager(engine);

      // Create operation function based on config
      const operationFn = async () => {
        // This would be replaced with actual operation logic
        return engine.act(
          targetId,
          operation.action,
          operation.ref,
          operation.options,
        );
      };

      return recovery.executeWithRecovery(operationFn, [], {
        targetId,
        ...operation,
      });
    }),
  );

  /**
   * Manual recovery action
   * @param {string} targetId - Tab ID
   * @param {string} strategy - Recovery strategy
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:manual",
    withErrorHandler(async (event, targetId, strategy, context = {}) => {
      const { getErrorRecoveryManager } = require("./actions");
      const engine = _getBrowserEngine();
      const recovery = getErrorRecoveryManager(engine);
      return recovery.manualRecover(targetId, strategy, context);
    }),
  );

  /**
   * Get recovery statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:stats",
    withErrorHandler(async (event) => {
      const { getErrorRecoveryManager } = require("./actions");
      const recovery = getErrorRecoveryManager();
      return recovery.getStats();
    }),
  );

  /**
   * Get recovery history
   * @param {number} limit - History limit
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:recovery:history",
    withErrorHandler(async (event, limit = 50) => {
      const { getErrorRecoveryManager } = require("./actions");
      const recovery = getErrorRecoveryManager();
      return recovery.getHistory(limit);
    }),
  );

  /**
   * Set recovery strategies for error type
   * @param {string} errorType - Error type
   * @param {Array} strategies - Strategies
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:recovery:setStrategies",
    withErrorHandler(async (event, errorType, strategies) => {
      const { getErrorRecoveryManager } = require("./actions");
      const recovery = getErrorRecoveryManager();
      recovery.setStrategies(errorType, strategies);
      return { success: true };
    }),
  );

  // ==================== Phase 9: Context Memory (v0.33.0) ====================

  /**
   * Save page state
   * @param {string} url - Page URL
   * @param {Object} state - Page state
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:savePageState",
    withErrorHandler(async (event, url, state, options = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.savePageState(url, state, options);
    }),
  );

  /**
   * Get page state
   * @param {string} key - Page key
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:getPageState",
    withErrorHandler(async (event, key) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getPageState(key);
    }),
  );

  /**
   * Save element location
   * @param {Object} query - Element query
   * @param {Object} location - Location info
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:saveElement",
    withErrorHandler(async (event, query, location, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.saveElementLocation(query, location, context);
    }),
  );

  /**
   * Get element location
   * @param {Object} query - Element query
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:getElement",
    withErrorHandler(async (event, query, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getElementLocation(query, context);
    }),
  );

  /**
   * Record operation
   * @param {string} contextKey - Context key
   * @param {Object} operation - Operation
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:recordOperation",
    withErrorHandler(async (event, contextKey, operation) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.recordOperation(contextKey, operation);
    }),
  );

  /**
   * Get operation sequence
   * @param {string} contextKey - Context key
   * @param {Object} options - Options
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:memory:getOperations",
    withErrorHandler(async (event, contextKey, options = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getOperationSequence(contextKey, options);
    }),
  );

  /**
   * Save form data
   * @param {string} formId - Form ID
   * @param {Object} data - Form data
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:saveForm",
    withErrorHandler(async (event, formId, data, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.saveFormData(formId, data, context);
    }),
  );

  /**
   * Get form data
   * @param {string} formId - Form ID
   * @param {Object} context - Context
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:getForm",
    withErrorHandler(async (event, formId, context = {}) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getFormData(formId, context);
    }),
  );

  /**
   * Get memory statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:stats",
    withErrorHandler(async (event) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.getStats();
    }),
  );

  /**
   * Cleanup expired entries
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:cleanup",
    withErrorHandler(async (event) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.cleanup();
    }),
  );

  /**
   * Clear all memory
   * @param {boolean} confirm - Confirmation flag
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:clear",
    withErrorHandler(async (event, confirm = false) => {
      if (!confirm) {
        return {
          success: false,
          message: "Confirmation required to clear memory",
        };
      }
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      memory.clear();
      return { success: true };
    }),
  );

  /**
   * Export memory data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:export",
    withErrorHandler(async (event) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      return memory.export();
    }),
  );

  /**
   * Import memory data
   * @param {Object} data - Data to import
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:memory:import",
    withErrorHandler(async (event, data) => {
      const { getContextMemory } = require("./actions");
      const memory = getContextMemory();
      memory.import(data);
      return { success: true };
    }),
  );
}

module.exports = { registerEnhancementHandlers };
