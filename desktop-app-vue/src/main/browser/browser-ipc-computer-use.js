/**
 * Browser IPC handlers — computer-use group.
 * Split verbatim from browser-ipc.js registerBrowserIPC(); see that file for
 * the shared ctx ({ _ipcMain, _getBrowserEngine, _getAutomationAgent,
 * withErrorHandler, getBrowserEngine }).
 *
 * @module browser/browser-ipc-computer-use
 */
const {
  authorizeDesktopBrowserVisionObservation,
} = require("../evolution/desktop-browser-vision-observation");
const {
  authorizeDesktopBrowserVisionAction,
} = require("../evolution/desktop-browser-vision-action");

const READ_ONLY_VISION_TASKS = new Set([
  "analyze",
  "locate",
  "compare",
  "describe",
  "ocr",
]);

function stripObservationAuthorization(options) {
  const visionOptions = { ...options };
  delete visionOptions.observationAuthorization;
  delete visionOptions.actionAuthorization;
  return visionOptions;
}

async function authorizeVisionObservation(
  host,
  event,
  targetId,
  operation,
  options,
) {
  return await authorizeDesktopBrowserVisionObservation(host, {
    targetId,
    operation,
    options,
    senderId: event?.sender?.id,
    frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
    authorization: options.observationAuthorization ?? null,
  });
}

async function authorizeVisualClick(
  observationHost,
  actionHost,
  event,
  targetId,
  options,
) {
  const observationGrant = await authorizeVisionObservation(
    observationHost,
    event,
    targetId,
    "locate",
    options,
  );
  const actionGrant = await authorizeDesktopBrowserVisionAction(actionHost, {
    targetId,
    operation: "visual-click",
    options,
    observationGrant,
    senderId: event?.sender?.id,
    frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
    authorization: options.actionAuthorization ?? null,
  });
  return Object.freeze({ observationGrant, actionGrant });
}

async function authorizeVisualType(
  observationHost,
  actionHost,
  event,
  targetId,
  options,
) {
  const observationGrant = await authorizeVisionObservation(
    observationHost,
    event,
    targetId,
    "locate",
    options,
  );
  const actionGrant = await authorizeDesktopBrowserVisionAction(actionHost, {
    targetId,
    operation: "visual-type",
    options,
    observationGrant,
    senderId: event?.sender?.id,
    frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
    authorization: options.actionAuthorization ?? null,
  });
  return Object.freeze({ observationGrant, actionGrant });
}

function registerComputerUseHandlers(ctx) {
  const {
    _ipcMain,
    _getBrowserEngine,
    _getGovernedVisionModelClient,
    _getBrowserVisionObservationHost,
    _getBrowserVisionActionHost,
    withErrorHandler,
  } = ctx;

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
      const operation = options.task;
      let observationGrant = null;
      let actionGrant = null;
      if (READ_ONLY_VISION_TASKS.has(operation)) {
        observationGrant = await authorizeVisionObservation(
          _getBrowserVisionObservationHost?.() ?? null,
          event,
          targetId,
          operation,
          options,
        );
      } else if (operation === "click") {
        ({ observationGrant, actionGrant } = await authorizeVisualClick(
          _getBrowserVisionObservationHost?.() ?? null,
          _getBrowserVisionActionHost?.() ?? null,
          event,
          targetId,
          options,
        ));
      } else if (operation === "type") {
        ({ observationGrant, actionGrant } = await authorizeVisualType(
          _getBrowserVisionObservationHost?.() ?? null,
          _getBrowserVisionActionHost?.() ?? null,
          event,
          targetId,
          options,
        ));
      }
      const engine = _getBrowserEngine();

      const visionAction = new VisionAction(
        engine,
        _getGovernedVisionModelClient?.() ?? null,
        observationGrant,
        actionGrant,
      );
      return visionAction.execute(
        targetId,
        stripObservationAuthorization(options),
      );
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
      const visionOptions = { ...options, description };
      const { observationGrant, actionGrant } = await authorizeVisualClick(
        _getBrowserVisionObservationHost?.() ?? null,
        _getBrowserVisionActionHost?.() ?? null,
        event,
        targetId,
        visionOptions,
      );
      const engine = _getBrowserEngine();

      const visionAction = new VisionAction(
        engine,
        _getGovernedVisionModelClient?.() ?? null,
        observationGrant,
        actionGrant,
      );
      return visionAction.visualClick(
        targetId,
        description,
        stripObservationAuthorization(options),
      );
    }),
  );

  /**
   * Visual type - locate one text input and type a single authorized value.
   */
  _ipcMain.handle(
    "browser:visualType",
    withErrorHandler(
      async (event, targetId, description, text, options = {}) => {
        const { VisionAction } = require("./actions");
        const visionOptions = { ...options, description, text };
        const { observationGrant, actionGrant } = await authorizeVisualType(
          _getBrowserVisionObservationHost?.() ?? null,
          _getBrowserVisionActionHost?.() ?? null,
          event,
          targetId,
          visionOptions,
        );
        const engine = _getBrowserEngine();
        const visionAction = new VisionAction(
          engine,
          _getGovernedVisionModelClient?.() ?? null,
          observationGrant,
          actionGrant,
        );
        return visionAction.visualType(
          targetId,
          description,
          text,
          stripObservationAuthorization(options),
        );
      },
    ),
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
