/**
 * Browser IPC handlers — session-console group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-session-console
 */

function registerSessionConsoleHandlers(ctx) {
  const { _ipcMain, _getBrowserEngine, withErrorHandler } = ctx;

  // ============================================
  // Phase 13: SessionManager IPC Handlers
  // ============================================

  /**
   * Get cookies
   * @param {string} targetId - Tab ID
   * @param {Object} filter - Filter options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:getCookies",
    withErrorHandler(async (event, targetId, filter = {}) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.getCookies(targetId, filter);
    }),
  );

  /**
   * Set cookie
   * @param {string} targetId - Tab ID
   * @param {Object} cookie - Cookie data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:setCookie",
    withErrorHandler(async (event, targetId, cookie) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.setCookie(targetId, cookie);
    }),
  );

  /**
   * Delete cookies
   * @param {string} targetId - Tab ID
   * @param {Object} filter - Filter options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:deleteCookies",
    withErrorHandler(async (event, targetId, filter = {}) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.deleteCookies(targetId, filter);
    }),
  );

  /**
   * Clear all cookies
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:clearCookies",
    withErrorHandler(async (event, targetId) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.clearAllCookies(targetId);
    }),
  );

  /**
   * Get localStorage
   * @param {string} targetId - Tab ID
   * @param {string} key - Optional key
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:getLocalStorage",
    withErrorHandler(async (event, targetId, key = null) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.getLocalStorage(targetId, key);
    }),
  );

  /**
   * Set localStorage
   * @param {string} targetId - Tab ID
   * @param {string} key - Key
   * @param {string} value - Value
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:setLocalStorage",
    withErrorHandler(async (event, targetId, key, value) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.setLocalStorage(targetId, key, value);
    }),
  );

  /**
   * Remove localStorage
   * @param {string} targetId - Tab ID
   * @param {string} key - Optional key
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:removeLocalStorage",
    withErrorHandler(async (event, targetId, key = null) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.removeLocalStorage(targetId, key);
    }),
  );

  /**
   * Get sessionStorage
   * @param {string} targetId - Tab ID
   * @param {string} key - Optional key
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:getSessionStorage",
    withErrorHandler(async (event, targetId, key = null) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.getSessionStorage(targetId, key);
    }),
  );

  /**
   * Set sessionStorage
   * @param {string} targetId - Tab ID
   * @param {string} key - Key
   * @param {string} value - Value
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:setSessionStorage",
    withErrorHandler(async (event, targetId, key, value) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.setSessionStorage(targetId, key, value);
    }),
  );

  /**
   * Save session snapshot
   * @param {string} targetId - Tab ID
   * @param {string} sessionId - Optional session ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:save",
    withErrorHandler(async (event, targetId, sessionId = null) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.saveSession(targetId, sessionId);
    }),
  );

  /**
   * Restore session
   * @param {string} targetId - Tab ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:restore",
    withErrorHandler(async (event, targetId, sessionId) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.restoreSession(targetId, sessionId);
    }),
  );

  /**
   * Delete session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:delete",
    withErrorHandler(async (event, sessionId) => {
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager();
      return manager.deleteSession(sessionId);
    }),
  );

  /**
   * List sessions
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:session:list",
    withErrorHandler(async () => {
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager();
      return manager.listSessions();
    }),
  );

  /**
   * Detect auth state
   * @param {string} targetId - Tab ID
   * @param {Object} indicators - Auth indicators
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:detectAuth",
    withErrorHandler(async (event, targetId, indicators = {}) => {
      const engine = _getBrowserEngine();
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager(engine);
      return manager.detectAuthState(targetId, indicators);
    }),
  );

  /**
   * Get session stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:session:stats",
    withErrorHandler(async () => {
      const { getSessionManager } = require("./actions");
      const manager = getSessionManager();
      return manager.getStats();
    }),
  );

  // ============================================
  // Phase 13: ConsoleCapture IPC Handlers
  // ============================================

  /**
   * Start console capture
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:console:start",
    withErrorHandler(async (event, targetId) => {
      const engine = _getBrowserEngine();
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture(engine);
      return capture.startCapture(targetId);
    }),
  );

  /**
   * Stop console capture
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:console:stop",
    withErrorHandler(async (event, targetId) => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.stopCapture(targetId);
    }),
  );

  /**
   * Get console logs
   * @param {string} targetId - Tab ID
   * @param {Object} filter - Filter options
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:console:logs",
    withErrorHandler(async (event, targetId, filter = {}) => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.getLogs(targetId, filter);
    }),
  );

  /**
   * Get console errors
   * @param {string} targetId - Tab ID
   * @param {number} limit - Max items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:console:errors",
    withErrorHandler(async (event, targetId, limit = 50) => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.getErrors(targetId, limit);
    }),
  );

  /**
   * Get network errors
   * @param {string} targetId - Tab ID
   * @param {number} limit - Max items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:console:networkErrors",
    withErrorHandler(async (event, targetId, limit = 50) => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.getNetworkErrors(targetId, limit);
    }),
  );

  /**
   * Get error count
   * @param {string} targetId - Tab ID
   * @returns {Promise<number>}
   */
  _ipcMain.handle(
    "browser:console:errorCount",
    withErrorHandler(async (event, targetId) => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.getErrorCount(targetId);
    }),
  );

  /**
   * Clear logs
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:console:clear",
    withErrorHandler(async (event, targetId) => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.clearLogs(targetId);
    }),
  );

  /**
   * Export logs
   * @param {string} targetId - Tab ID
   * @param {string} format - Export format (json/text)
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:console:export",
    withErrorHandler(async (event, targetId, format = "json") => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.exportLogs(targetId, format);
    }),
  );

  /**
   * Check if capturing
   * @param {string} targetId - Tab ID
   * @returns {Promise<boolean>}
   */
  _ipcMain.handle(
    "browser:console:isCapturing",
    withErrorHandler(async (event, targetId) => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.isCapturing(targetId);
    }),
  );

  /**
   * Get console stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:console:stats",
    withErrorHandler(async () => {
      const { getConsoleCapture } = require("./actions");
      const capture = getConsoleCapture();
      return capture.getStats();
    }),
  );
}

module.exports = { registerSessionConsoleHandlers };
