/**
 * Browser IPC handlers — system group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-system
 */

function registerSystemHandlers(ctx) {
  const { _ipcMain, withErrorHandler, getBrowserEngine } = ctx;

  // ============================================
  // Phase 11: ClipboardManager IPC Handlers
  // ============================================

  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @param {Object} options - Copy options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyText",
    withErrorHandler(async (event, text, options = {}) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return clipboard.copyText(text, options);
    }),
  );

  /**
   * Copy HTML to clipboard
   * @param {string} html - HTML content
   * @param {string} fallbackText - Fallback text
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyHTML",
    withErrorHandler(async (event, html, fallbackText = "") => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return clipboard.copyHTML(html, fallbackText);
    }),
  );

  /**
   * Copy image to clipboard
   * @param {string|Buffer} imageData - Image data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyImage",
    withErrorHandler(async (event, imageData) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return clipboard.copyImage(imageData);
    }),
  );

  /**
   * Copy from page element
   * @param {string} targetId - Tab ID
   * @param {string} selector - Element selector
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:copyFromElement",
    withErrorHandler(async (event, targetId, selector, options = {}) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return await clipboard.copyFromElement(targetId, selector, options);
    }),
  );

  /**
   * Read clipboard content
   * @param {string} type - Content type
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:read",
    withErrorHandler(async (event, type = null) => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.read(type);
    }),
  );

  /**
   * Paste to page element
   * @param {string} targetId - Tab ID
   * @param {string} selector - Element selector
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:pasteToElement",
    withErrorHandler(async (event, targetId, selector, options = {}) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return await clipboard.pasteToElement(targetId, selector, options);
    }),
  );

  /**
   * Simulate keyboard paste
   * @param {string} targetId - Tab ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:simulatePaste",
    withErrorHandler(async (event, targetId) => {
      const engine = getBrowserEngine();
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager(engine);
      return await clipboard.simulatePaste(targetId);
    }),
  );

  /**
   * Clear clipboard
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:clear",
    withErrorHandler(async () => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.clear();
    }),
  );

  /**
   * Get clipboard history
   * @param {number} limit - Maximum items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:clipboard:history",
    withErrorHandler(async (event, limit = 20) => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.getHistory(limit);
    }),
  );

  /**
   * Get clipboard stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:clipboard:stats",
    withErrorHandler(async () => {
      const { getClipboardManager } = require("./actions");
      const clipboard = getClipboardManager();
      return clipboard.getStats();
    }),
  );

  // ============================================
  // Phase 11: FileHandler IPC Handlers
  // ============================================

  /**
   * Start a download
   * @param {string} targetId - Tab ID
   * @param {string} url - Download URL
   * @param {Object} options - Download options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:download",
    withErrorHandler(async (event, targetId, url, options = {}) => {
      const engine = getBrowserEngine();
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler(engine);
      return await handler.startDownload(targetId, url, options);
    }),
  );

  /**
   * Cancel a download
   * @param {string} downloadId - Download ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:cancelDownload",
    withErrorHandler(async (event, downloadId) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.cancelDownload(downloadId);
    }),
  );

  /**
   * Get download status
   * @param {string} downloadId - Download ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:getDownload",
    withErrorHandler(async (event, downloadId) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getDownload(downloadId);
    }),
  );

  /**
   * List downloads
   * @param {Object} filter - Filter options
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:file:listDownloads",
    withErrorHandler(async (event, filter = {}) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.listDownloads(filter);
    }),
  );

  /**
   * Record an upload
   * @param {string} targetId - Tab ID
   * @param {string} selector - Upload element selector
   * @param {Array} files - File info list
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:recordUpload",
    withErrorHandler(async (event, targetId, selector, files) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.recordUpload(targetId, selector, files);
    }),
  );

  /**
   * Get upload history
   * @param {number} limit - Maximum items
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:file:getUploads",
    withErrorHandler(async (event, limit = 20) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getUploads(limit);
    }),
  );

  /**
   * Validate a file
   * @param {string} filePath - File path
   * @param {Object} rules - Validation rules
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:validate",
    withErrorHandler(async (event, filePath, rules = {}) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.validateFile(filePath, rules);
    }),
  );

  /**
   * Get file info
   * @param {string} filePath - File path
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:info",
    withErrorHandler(async (event, filePath) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getFileInfo(filePath);
    }),
  );

  /**
   * Get file handler stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:stats",
    withErrorHandler(async () => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.getStats();
    }),
  );

  /**
   * Set download directory
   * @param {string} dir - Directory path
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:file:setDownloadDir",
    withErrorHandler(async (event, dir) => {
      const { getFileHandler } = require("./actions");
      const handler = getFileHandler();
      return handler.setDownloadDir(dir);
    }),
  );

  // ============================================
  // Phase 11: NotificationManager IPC Handlers
  // ============================================

  /**
   * Send a notification
   * @param {Object} options - Notification options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:notify",
    withErrorHandler(async (event, options) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.notify(options);
    }),
  );

  /**
   * Send notification from template
   * @param {string} templateId - Template ID
   * @param {Object} data - Data for template
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:fromTemplate",
    withErrorHandler(async (event, templateId, data = {}) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.notifyFromTemplate(templateId, data);
    }),
  );

  /**
   * Dismiss a notification
   * @param {string} notificationId - Notification ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:dismiss",
    withErrorHandler(async (event, notificationId) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.dismiss(notificationId);
    }),
  );

  /**
   * Dismiss all notifications
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:dismissAll",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.dismissAll();
    }),
  );

  /**
   * Mark notification as read
   * @param {string} notificationId - Notification ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:markRead",
    withErrorHandler(async (event, notificationId) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.markAsRead(notificationId);
    }),
  );

  /**
   * Mark all notifications as read
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:markAllRead",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.markAllAsRead();
    }),
  );

  /**
   * Get notification history
   * @param {Object} filter - Filter options
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:notification:history",
    withErrorHandler(async (event, filter = {}) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getHistory(filter);
    }),
  );

  /**
   * Get unread count
   * @returns {Promise<number>}
   */
  _ipcMain.handle(
    "browser:notification:unreadCount",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getUnreadCount();
    }),
  );

  /**
   * Get notification templates
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:templates",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getTemplates();
    }),
  );

  /**
   * Register a notification template
   * @param {string} templateId - Template ID
   * @param {Object} template - Template config
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:registerTemplate",
    withErrorHandler(async (event, templateId, template) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.registerTemplate(templateId, template);
    }),
  );

  /**
   * Set quiet hours
   * @param {number} start - Start hour
   * @param {number} end - End hour
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:setQuietHours",
    withErrorHandler(async (event, start, end) => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.setQuietHours(start, end);
    }),
  );

  /**
   * Get notification stats
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:notification:stats",
    withErrorHandler(async () => {
      const { getNotificationManager } = require("./actions");
      const manager = getNotificationManager();
      return manager.getStats();
    }),
  );
}

module.exports = { registerSystemHandlers };
