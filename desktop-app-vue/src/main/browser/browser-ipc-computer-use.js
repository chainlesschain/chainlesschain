/**
 * Browser IPC handlers — computer-use group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-computer-use
 */
const { logger } = require("../utils/logger");

function registerComputerUseHandlers(ctx) {
  const { _ipcMain, _getBrowserEngine, withErrorHandler } = ctx;

  // ==================== Phase 6: Computer Use Capabilities (v0.33.0) ====================

  /**
   * Execute coordinate-level mouse action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Coordinate action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:coordinate",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { CoordinateAction } = require("./actions");
      const engine = _getBrowserEngine();
      const coordinateAction = new CoordinateAction(engine);
      return coordinateAction.execute(targetId, options);
    }),
  );

  /**
   * Execute vision AI action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Vision action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:action:vision",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { VisionAction } = require("./actions");
      const engine = _getBrowserEngine();

      // 获取 LLM 服务
      let llmService = null;
      try {
        const { getLLMService } = require("../llm/llm-service");
        llmService = getLLMService();
      } catch (e) {
        logger.warn("[Browser IPC] LLM Service not available for vision");
      }

      const visionAction = new VisionAction(engine, llmService);
      return visionAction.execute(targetId, options);
    }),
  );

  /**
   * Visual click - find element by description and click
   * @param {string} targetId - Tab ID
   * @param {string} description - Element description
   * @param {Object} options - Click options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:visualClick",
    withErrorHandler(async (event, targetId, description, options = {}) => {
      const { VisionAction } = require("./actions");
      const engine = _getBrowserEngine();

      let llmService = null;
      try {
        const { getLLMService } = require("../llm/llm-service");
        llmService = getLLMService();
      } catch (e) {
        throw new Error("LLM Service required for visual click");
      }

      const visionAction = new VisionAction(engine, llmService);
      return visionAction.visualClick(targetId, description, options);
    }),
  );

  /**
   * Execute network interceptor action
   * @param {string} targetId - Tab ID
   * @param {Object} options - Network action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:network",
    withErrorHandler(async (event, targetId, options = {}) => {
      const { NetworkInterceptor } = require("./actions");
      const engine = _getBrowserEngine();

      // 使用单例模式
      if (!engine._networkInterceptor) {
        engine._networkInterceptor = new NetworkInterceptor(engine);
      }

      return engine._networkInterceptor.execute(targetId, options);
    }),
  );

  /**
   * Execute desktop-level action
   * @param {Object} options - Desktop action options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop",
    withErrorHandler(async (event, options = {}) => {
      const { DesktopAction } = require("./actions");

      // 使用单例
      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.execute(options);
    }),
  );

  /**
   * Capture desktop screen
   * @param {Object} options - Capture options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:capture",
    withErrorHandler(async (event, options = {}) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.captureScreen(options);
    }),
  );

  /**
   * Desktop click at coordinates
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {Object} options - Click options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:click",
    withErrorHandler(async (event, x, y, options = {}) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.click(x, y, options);
    }),
  );

  /**
   * Desktop type text
   * @param {string} text - Text to type
   * @param {Object} options - Type options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:type",
    withErrorHandler(async (event, text, options = {}) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.typeText(text, options);
    }),
  );

  /**
   * Desktop press key
   * @param {string} key - Key to press
   * @param {Array<string>} modifiers - Modifier keys
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:desktop:key",
    withErrorHandler(async (event, key, modifiers = []) => {
      const { DesktopAction } = require("./actions");

      if (!global._desktopAction) {
        global._desktopAction = new DesktopAction();
      }

      return global._desktopAction.pressKey(key, modifiers);
    }),
  );

  // ==================== Phase 6: Audit Logging (v0.33.0) ====================

  /**
   * Log operation to audit log
   * @param {Object} data - Operation data
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:audit:log",
    withErrorHandler(async (event, data) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.log(data);
    }),
  );

  /**
   * Query audit logs
   * @param {Object} filter - Query filter
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:audit:query",
    withErrorHandler(async (event, filter = {}) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.query(filter);
    }),
  );

  /**
   * Get audit statistics
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser:audit:stats",
    withErrorHandler(async (event) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.getStats();
    }),
  );

  /**
   * Get high risk operations
   * @param {number} limit - Limit count
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser:audit:highRisk",
    withErrorHandler(async (event, limit = 50) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.getHighRiskOperations(limit);
    }),
  );

  /**
   * Export audit logs
   * @param {string} format - Export format (json/csv)
   * @param {Object} filter - Query filter
   * @returns {Promise<string>}
   */
  _ipcMain.handle(
    "browser:audit:export",
    withErrorHandler(async (event, format = "json", filter = {}) => {
      const { getAuditLogger } = require("./actions");
      const auditLogger = getAuditLogger();
      return auditLogger.export(format, filter);
    }),
  );

  // ==================== Phase 6: Screen Recording (v0.33.0) ====================

  /**
   * Start screen recording
   * @param {string} targetId - Tab ID (null for desktop)
   * @param {Object} options - Recording options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:start",
    withErrorHandler(async (event, targetId = null, options = {}) => {
      const { getScreenRecorder } = require("./actions");
      const engine = _getBrowserEngine();
      const recorder = getScreenRecorder(engine, options);
      return recorder.startRecording(targetId, options);
    }),
  );

  /**
   * Pause screen recording
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:pause",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.pauseRecording();
    }),
  );

  /**
   * Resume screen recording
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:resume",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.resumeRecording();
    }),
  );

  /**
   * Stop screen recording
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:stop",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.stopRecording();
    }),
  );

  /**
   * Get recording status
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:status",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.getStatus();
    }),
  );

  /**
   * List all recordings
   * @returns {Promise<Array>}
   */
  _ipcMain.handle(
    "browser-inline:recording:list",
    withErrorHandler(async (event) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.listRecordings();
    }),
  );

  /**
   * Get recording details
   * @param {string} recordingId - Recording ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:get",
    withErrorHandler(async (event, recordingId) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.getRecording(recordingId);
    }),
  );

  /**
   * Delete recording
   * @param {string} recordingId - Recording ID
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:delete",
    withErrorHandler(async (event, recordingId) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.deleteRecording(recordingId);
    }),
  );

  /**
   * Export recording as GIF data
   * @param {string} recordingId - Recording ID
   * @param {Object} options - Export options
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:exportGif",
    withErrorHandler(async (event, recordingId, options = {}) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.exportToGif(recordingId, options);
    }),
  );

  /**
   * Get single frame from recording
   * @param {string} recordingId - Recording ID
   * @param {number} frameIndex - Frame index
   * @returns {Promise<Object>}
   */
  _ipcMain.handle(
    "browser-inline:recording:frame",
    withErrorHandler(async (event, recordingId, frameIndex) => {
      const { getScreenRecorder } = require("./actions");
      const recorder = getScreenRecorder();
      return recorder.getFrame(recordingId, frameIndex);
    }),
  );
}

module.exports = { registerComputerUseHandlers };
