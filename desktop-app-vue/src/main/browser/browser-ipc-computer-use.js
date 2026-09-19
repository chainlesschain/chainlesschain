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
const {
  authorizeDesktopBrowserNavigationAction,
  consumeDesktopBrowserHistoryActionGrant,
  consumeDesktopBrowserNavigationActionGrant,
  recordDesktopBrowserNavigationActionOutcome,
} = require("../evolution/desktop-browser-navigation-action");
const {
  authorizeDesktopBrowserKeyboardAction,
  consumeDesktopBrowserKeyboardActionGrant,
  recordDesktopBrowserKeyboardActionOutcome,
} = require("../evolution/desktop-browser-keyboard-action");
const {
  authorizeDesktopBrowserTabOpenAction,
  consumeDesktopBrowserTabOpenActionGrant,
  recordDesktopBrowserTabOpenActionOutcome,
} = require("../evolution/desktop-browser-tab-open-action");
const {
  authorizeDesktopBrowserDownloadAction,
  executeDesktopBrowserDownloadActionGrant,
  recordDesktopBrowserDownloadActionOutcome,
} = require("../evolution/desktop-browser-download-action");
const {
  authorizeDesktopBrowserDownloadArtifactDisposal,
  executeDesktopBrowserDownloadArtifactDisposal,
} = require("../evolution/desktop-browser-download-artifact-disposal");

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

function stripNavigationAuthorization(options) {
  const navigationOptions = { ...options };
  delete navigationOptions.actionAuthorization;
  return navigationOptions;
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
    _getBrowserNavigationActionHost,
    _getBrowserKeyboardActionHost,
    _getBrowserTabOpenActionHost,
    _getBrowserDownloadActionHost,
    _getBrowserDownloadArtifactDisposalHost,
    withErrorHandler,
  } = ctx;

  // ==================== Phase 6: Computer Use Capabilities (v0.33.0) ====================

  /**
   * Open one explicitly governed Agent tab. The ordinary browser:openTab UI
   * channel remains a separate compatibility path.
   */
  _ipcMain.handle(
    "browser:action:open-tab",
    withErrorHandler(
      async (event, profileName, destinationUrl, options = {}) => {
        const grant = await authorizeDesktopBrowserTabOpenAction(
          _getBrowserTabOpenActionHost?.() ?? null,
          {
            profileName,
            destinationUrl,
            options,
            senderId: event?.sender?.id,
            frameUrl:
              event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
          },
        );
        const engine = _getBrowserEngine();
        const actionEvidence = consumeDesktopBrowserTabOpenActionGrant(
          grant,
          profileName,
          destinationUrl,
          options,
        );
        let result = null;
        let mutationError = null;
        try {
          result = await engine.openTab(
            actionEvidence.profileName,
            actionEvidence.destinationUrl,
            {
              allowedRedirectOrigins: actionEvidence.allowedRedirectOrigins,
              waitUntil: actionEvidence.waitUntil,
              timeout: actionEvidence.timeout,
            },
          );
        } catch (error) {
          mutationError = error;
        }
        const actionAudit = await recordDesktopBrowserTabOpenActionOutcome(
          grant,
          {
            status: mutationError === null ? "succeeded" : "failed",
            targetId: mutationError === null ? result.targetId : null,
            finalUrl: mutationError === null ? result.url : null,
            failureClass:
              mutationError === null ? null : "browser-tab-open-action-failed",
          },
        );
        const evidence = {
          authorizationReceiptDigest: actionEvidence.receiptDigest,
          auditEventDigest: actionAudit.auditEventDigest,
          durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
        };
        if (mutationError !== null) {
          return {
            success: false,
            error: `Tab open failed: ${mutationError.message}`,
            ...evidence,
          };
        }
        return { ...result, ...evidence };
      },
    ),
  );

  /**
   * Execute one explicitly governed download through the signed quarantine and
   * malware-scanning provider. No filesystem path or response URL crosses IPC.
   */
  _ipcMain.handle(
    "browser:action:download-url",
    withErrorHandler(async (event, targetId, destinationUrl, options = {}) => {
      const grant = await authorizeDesktopBrowserDownloadAction(
        _getBrowserDownloadActionHost?.() ?? null,
        {
          targetId,
          destinationUrl,
          options,
          senderId: event?.sender?.id,
          frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
          authorization: options.actionAuthorization ?? null,
        },
      );
      const engine = _getBrowserEngine();
      engine.getPage(targetId);
      const execution = await executeDesktopBrowserDownloadActionGrant(
        grant,
        targetId,
        destinationUrl,
        options,
      );
      const actionAudit =
        await recordDesktopBrowserDownloadActionOutcome(grant);
      const evidence = {
        authorizationReceiptDigest: actionAudit.actionReceiptDigest,
        requestDigest: actionAudit.requestDigest,
        resultDigest: actionAudit.resultDigest,
        auditEventDigest: actionAudit.auditEventDigest,
        durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
      };
      if (execution.status === "failed") {
        return {
          success: false,
          error: `Download failed: ${execution.failureClass}`,
          failureClass: execution.failureClass,
          ...evidence,
        };
      }
      return {
        success: true,
        artifactRef: execution.artifactRef,
        artifactDigest: execution.artifactDigest,
        sizeBytes: execution.sizeBytes,
        contentType: execution.contentType,
        finalUrlDigest: execution.finalUrlDigest,
        redirectOriginsDigest: execution.redirectOriginsDigest,
        scanEvidenceDigest: execution.scanEvidenceDigest,
        quarantineReceiptDigest: execution.quarantineReceiptDigest,
        completionReceiptDigest: execution.completionReceiptDigest,
        completedAt: execution.completedAt,
        ...evidence,
      };
    }),
  );

  /**
   * Irreversibly discard one exact quarantined artifact. The custody provider
   * must durably prove that the bytes are no longer available before return.
   */
  _ipcMain.handle(
    "browser:action:discard-download-artifact",
    withErrorHandler(
      async (
        event,
        artifactRef,
        artifactDigest,
        sourceActionReceiptDigest,
        options = {},
      ) => {
        const grant = await authorizeDesktopBrowserDownloadArtifactDisposal(
          _getBrowserDownloadArtifactDisposalHost?.() ?? null,
          {
            artifactRef,
            artifactDigest,
            sourceActionReceiptDigest,
            options,
            senderId: event?.sender?.id,
            frameUrl:
              event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
            authorization: options.actionAuthorization ?? null,
          },
        );
        const result = await executeDesktopBrowserDownloadArtifactDisposal(
          grant,
          artifactRef,
          artifactDigest,
          sourceActionReceiptDigest,
          options,
        );
        return {
          success: true,
          artifactRefDigest: result.artifactRefDigest,
          artifactDigest: result.artifactDigest,
          sourceActionReceiptDigest: result.sourceActionReceiptDigest,
          reason: result.reason,
          discardedAt: result.discardedAt,
          deletionReceiptDigest: result.deletionReceiptDigest,
          resultDigest: result.resultDigest,
        };
      },
    ),
  );

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
   * Execute one explicitly governed Agent navigation. The ordinary
   * browser:navigate UI channel remains a separate compatibility path.
   */
  _ipcMain.handle(
    "browser:action:navigate",
    withErrorHandler(async (event, targetId, destinationUrl, options = {}) => {
      const grant = await authorizeDesktopBrowserNavigationAction(
        _getBrowserNavigationActionHost?.() ?? null,
        {
          targetId,
          destinationUrl,
          options,
          senderId: event?.sender?.id,
          frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
          authorization: options.actionAuthorization ?? null,
        },
      );
      const engine = _getBrowserEngine();
      const actionEvidence = consumeDesktopBrowserNavigationActionGrant(
        grant,
        targetId,
        destinationUrl,
        options,
      );
      let result = null;
      let mutationError = null;
      try {
        result = await engine.navigate(targetId, destinationUrl, {
          ...stripNavigationAuthorization(options),
          allowedRedirectOrigins: actionEvidence.allowedRedirectOrigins,
        });
      } catch (error) {
        mutationError = error;
      }
      const actionAudit = await recordDesktopBrowserNavigationActionOutcome(
        grant,
        {
          status: mutationError === null ? "succeeded" : "failed",
          finalUrl: result?.url ?? null,
          failureClass:
            mutationError === null ? null : "browser-navigation-failed",
        },
      );
      const evidence = {
        authorizationReceiptDigest: actionEvidence.receiptDigest,
        auditEventDigest: actionAudit.auditEventDigest,
        durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
      };
      if (mutationError !== null) {
        return {
          success: false,
          error: `Navigation failed: ${mutationError.message}`,
          ...evidence,
        };
      }
      return { ...result, ...evidence };
    }),
  );

  /**
   * Execute one explicitly governed back, forward, or refresh operation. The
   * grant binds the operation and approved origin set before BrowserEngine is
   * accessed; BrowserEngine resolves history targets internally.
   */
  _ipcMain.handle(
    "browser:action:history",
    withErrorHandler(async (event, targetId, operation, options = {}) => {
      const grant = await authorizeDesktopBrowserNavigationAction(
        _getBrowserNavigationActionHost?.() ?? null,
        {
          targetId,
          operation,
          destinationUrl: null,
          options,
          senderId: event?.sender?.id,
          frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
          authorization: options.actionAuthorization ?? null,
        },
      );
      const engine = _getBrowserEngine();
      const actionEvidence = consumeDesktopBrowserHistoryActionGrant(
        grant,
        targetId,
        operation,
        options,
      );
      let result = null;
      let mutationError = null;
      try {
        result = await engine.navigateHistory(targetId, operation, {
          ...stripNavigationAuthorization(options),
          allowedRedirectOrigins: actionEvidence.allowedRedirectOrigins,
        });
      } catch (error) {
        mutationError = error;
      }
      const actionAudit = await recordDesktopBrowserNavigationActionOutcome(
        grant,
        {
          status: mutationError === null ? "succeeded" : "failed",
          finalUrl: result?.url ?? null,
          failureClass:
            mutationError === null ? null : "browser-history-navigation-failed",
        },
      );
      const evidence = {
        authorizationReceiptDigest: actionEvidence.receiptDigest,
        auditEventDigest: actionAudit.auditEventDigest,
        durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
      };
      if (mutationError !== null) {
        return {
          success: false,
          error: `History navigation failed: ${mutationError.message}`,
          ...evidence,
        };
      }
      return { ...result, ...evidence };
    }),
  );

  /**
   * Execute one governed key press. Arbitrary text, presets, element lookup,
   * sequences and held-key callbacks are intentionally outside this channel.
   */
  _ipcMain.handle(
    "browser:action:key-press",
    withErrorHandler(async (event, targetId, options = {}) => {
      const grant = await authorizeDesktopBrowserKeyboardAction(
        _getBrowserKeyboardActionHost?.() ?? null,
        {
          targetId,
          options,
          senderId: event?.sender?.id,
          frameUrl: event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? "",
        },
      );
      const engine = _getBrowserEngine();
      const actionEvidence = consumeDesktopBrowserKeyboardActionGrant(
        grant,
        targetId,
        options,
      );
      const { KeyboardAction } = require("./actions");
      const keyboardAction = new KeyboardAction(engine);
      let result = null;
      let mutationError = null;
      try {
        result = await keyboardAction.execute(targetId, {
          keys: actionEvidence.key,
          modifiers: actionEvidence.modifiers,
          delay: actionEvidence.delay,
        });
      } catch (error) {
        mutationError = error;
      }
      const actionAudit = await recordDesktopBrowserKeyboardActionOutcome(
        grant,
        {
          status: mutationError === null ? "succeeded" : "failed",
          failureClass:
            mutationError === null ? null : "browser-keyboard-action-failed",
        },
      );
      const evidence = {
        authorizationReceiptDigest: actionEvidence.receiptDigest,
        auditEventDigest: actionAudit.auditEventDigest,
        durabilityReceiptDigest: actionAudit.durabilityReceiptDigest,
      };
      if (mutationError !== null) {
        return {
          success: false,
          error: `Key press failed: ${mutationError.message}`,
          ...evidence,
        };
      }
      return { ...result, ...evidence };
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
