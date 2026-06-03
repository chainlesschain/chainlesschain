/**
 * Screen Recorder — Screen Capture & Keyframe Extraction (v3.2)
 *
 * Captures screen content for multimodal context:
 * - Screenshot via Electron desktopCapturer
 * - Keyframe extraction from screen recordings
 * - OCR text extraction from captured frames
 * - Screen change detection for smart capture
 *
 * @module ai-engine/cowork/screen-recorder
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const CAPTURE_MODE = {
  SCREENSHOT: "screenshot",
  RECORDING: "recording",
  SMART: "smart",
};

const CAPTURE_STATUS = {
  IDLE: "idle",
  CAPTURING: "capturing",
  PROCESSING: "processing",
  READY: "ready",
  ERROR: "error",
};

const DEFAULT_CONFIG = {
  defaultMode: CAPTURE_MODE.SCREENSHOT,
  maxFrames: 30,
  keyframeInterval: 3000,
  captureWidth: 1920,
  captureHeight: 1080,
  imageFormat: "png",
  imageQuality: 90,
  enableOCR: true,
  ocrLanguage: "eng+chi_sim",
  changeThreshold: 0.1,
};

// ============================================================
// ScreenRecorder Class
// ============================================================

class ScreenRecorder extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.config = { ...DEFAULT_CONFIG };
    this.captures = new Map();
    this.recording = false;
    this.stats = {
      totalCaptures: 0,
      totalFrames: 0,
      ocrExtractions: 0,
      averageCaptureTimeMs: 0,
    };
    this._captureTimes = [];
  }

  /**
   * Initialize
   * @param {Object} deps
   */
  async initialize(deps = {}) {
    if (this.initialized) {
      return;
    }
    logger.info("[ScreenRecorder] Initialized");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Capture a screenshot
   * @param {Object} [options]
   * @param {string} [options.sourceId] - Specific source (window/screen) ID
   * @param {boolean} [options.enableOCR] - Run OCR on capture
   * @returns {Object} Capture result
   */
  async captureScreen(options = {}) {
    if (!this.initialized) {
      throw new Error("ScreenRecorder not initialized");
    }

    const startTime = Date.now();
    const captureId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    this.stats.totalCaptures++;

    try {
      // Use Electron desktopCapturer
      let imageData = null;
      let metadata = {};

      try {
        const { desktopCapturer } = require("electron");
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: {
            width: this.config.captureWidth,
            height: this.config.captureHeight,
          },
        });

        const source = options.sourceId
          ? sources.find((s) => s.id === options.sourceId)
          : sources[0];

        if (source?.thumbnail) {
          imageData = source.thumbnail.toPNG();
          metadata = {
            sourceId: source.id,
            sourceName: source.name,
            width: source.thumbnail.getSize().width,
            height: source.thumbnail.getSize().height,
          };
        }
      } catch (electronError) {
        // Fallback when not in Electron context
        logger.warn(
          `[ScreenRecorder] Electron capture unavailable: ${electronError.message}`,
        );
        metadata = { simulated: true, reason: "electron-unavailable" };
      }

      // OCR if enabled
      let ocrText = "";
      if (options.enableOCR !== false && this.config.enableOCR && imageData) {
        ocrText = await this._performOCR(imageData);
        this.stats.ocrExtractions++;
      }

      const elapsed = Date.now() - startTime;
      this._captureTimes.push(elapsed);
      if (this._captureTimes.length > 100) {
        this._captureTimes.shift();
      }
      this.stats.averageCaptureTimeMs = Math.round(
        this._captureTimes.reduce((a, b) => a + b, 0) /
          this._captureTimes.length,
      );
      this.stats.totalFrames++;

      const result = {
        captureId,
        mode: CAPTURE_MODE.SCREENSHOT,
        status: CAPTURE_STATUS.READY,
        imageData: imageData ? imageData.toString("base64") : null,
        ocrText,
        metadata,
        capturedAt: new Date().toISOString(),
        duration: elapsed,
      };

      this.captures.set(captureId, result);
      this.emit("capture:completed", { captureId, hasOCR: ocrText.length > 0 });

      return result;
    } catch (error) {
      logger.error(`[ScreenRecorder] Capture error: ${error.message}`);
      return {
        captureId,
        status: CAPTURE_STATUS.ERROR,
        error: error.message,
      };
    }
  }

  /**
   * Start recording screen (keyframe extraction mode)
   * @param {Object} [options]
   * @returns {Object} Recording session info
   */
  startRecording(options = {}) {
    if (this.recording) {
      return { error: "Already recording" };
    }

    const sessionId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.recording = true;

    const session = {
      id: sessionId,
      frames: [],
      startTime: Date.now(),
      interval: options.interval || this.config.keyframeInterval,
      maxFrames: options.maxFrames || this.config.maxFrames,
    };

    // Capture keyframes at interval
    session._timer = setInterval(async () => {
      if (session.frames.length >= session.maxFrames) {
        this.stopRecording(sessionId);
        return;
      }

      const frame = await this.captureScreen({ enableOCR: false });
      session.frames.push({
        captureId: frame.captureId,
        timestamp: Date.now() - session.startTime,
      });
    }, session.interval);

    this.captures.set(sessionId, session);
    this.emit("recording:started", { sessionId });

    logger.info(`[ScreenRecorder] Recording started: ${sessionId}`);
    return { sessionId, status: "recording" };
  }

  /**
   * Stop recording
   * @param {string} sessionId
   * @returns {Object} Recording result with keyframes
   */
  stopRecording(sessionId) {
    const session = this.captures.get(sessionId);
    if (!session?._timer) {
      return null;
    }

    clearInterval(session._timer);
    this.recording = false;

    const result = {
      sessionId,
      frameCount: session.frames.length,
      duration: Date.now() - session.startTime,
      frames: session.frames,
    };

    this.emit("recording:stopped", result);
    logger.info(
      `[ScreenRecorder] Recording stopped: ${sessionId} (${result.frameCount} frames)`,
    );

    return result;
  }

  /**
   * Get available screen sources
   */
  async getSources() {
    try {
      const { desktopCapturer } = require("electron");
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.id.startsWith("screen:") ? "screen" : "window",
      }));
    } catch {
      return [
        {
          id: "screen:0",
          name: "Main Screen",
          type: "screen",
          simulated: true,
        },
      ];
    }
  }

  getStats() {
    return { ...this.stats, recording: this.recording };
  }

  getConfig() {
    return { ...this.config };
  }

  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // OCR
  // ============================================================

  async _performOCR(imageBuffer) {
    try {
      const Tesseract = require("tesseract.js");
      const {
        data: { text },
      } = await Tesseract.recognize(imageBuffer, this.config.ocrLanguage);
      return text.trim();
    } catch (error) {
      logger.warn(`[ScreenRecorder] OCR failed: ${error.message}`);
      return "";
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getScreenRecorder() {
  if (!instance) {
    instance = new ScreenRecorder();
  }
  return instance;
}

module.exports = {
  ScreenRecorder,
  getScreenRecorder,
  CAPTURE_MODE,
  CAPTURE_STATUS,
};
