/**
 * Media Stream Engine
 *
 * Manages local media streams (audio, video, screen share) for call sessions.
 * Handles media device enumeration, stream acquisition/release, and track toggling.
 * Runs in the main Electron process; actual getUserMedia calls happen in renderer,
 * but this module coordinates state and quality monitoring via RTCPeerConnection stats.
 *
 * Features:
 * - Acquire and release media streams with configurable constraints
 * - Toggle audio/video tracks independently
 * - Screen sharing start/stop
 * - Stream quality metrics via RTCPeerConnection stats
 * - EventEmitter for stream lifecycle events
 *
 * @module p2p/media-engine
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

/**
 * Default media constraints
 */
const DEFAULT_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1,
};

const DEFAULT_VIDEO_CONSTRAINTS = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 30, max: 60 },
  facingMode: "user",
};

const DEFAULT_SCREEN_CONSTRAINTS = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 15, max: 30 },
};

/**
 * Quality thresholds for categorizing connection quality
 */
const QUALITY_THRESHOLDS = {
  excellent: { packetLoss: 0.01, rtt: 50, jitter: 10 },
  good: { packetLoss: 0.03, rtt: 100, jitter: 30 },
  fair: { packetLoss: 0.08, rtt: 200, jitter: 50 },
  // anything worse is 'poor'
};

/**
 * Media Engine class
 * Manages media stream lifecycle and quality monitoring
 */
class MediaEngine extends EventEmitter {
  constructor() {
    super();

    // Active media streams by session ID
    this.streams = new Map();

    // Screen share stream (only one active at a time)
    this.screenStream = null;

    // Track enabled states per session
    this.trackStates = new Map();

    // Quality metrics cache per session
    this.qualityMetrics = new Map();

    // Quality monitoring interval timers
    this.qualityTimers = new Map();

    // Quality monitoring interval in ms
    this.qualityMonitorInterval = 3000;
  }

  /**
   * Acquire a media stream with the given constraints
   * In Electron main process, this returns configuration for the renderer to use.
   * The actual MediaStream is managed renderer-side; this tracks state.
   *
   * @param {string} sessionId - Unique session identifier
   * @param {Object} constraints - Media constraints
   * @param {boolean|Object} [constraints.audio=true] - Audio constraints
   * @param {boolean|Object} [constraints.video=false] - Video constraints
   * @returns {Object} Stream configuration and session info
   */
  async acquireMediaStream(sessionId, constraints = {}) {
    try {
      if (this.streams.has(sessionId)) {
        logger.warn(
          `[MediaEngine] Session ${sessionId} already has an active stream`,
        );
        return {
          success: true,
          sessionId,
          alreadyActive: true,
          trackStates: this.trackStates.get(sessionId),
        };
      }

      // Build normalized constraints
      const audioConstraints = this._normalizeAudioConstraints(
        constraints.audio,
      );
      const videoConstraints = this._normalizeVideoConstraints(
        constraints.video,
      );

      const normalizedConstraints = {
        audio: audioConstraints,
        video: videoConstraints,
      };

      // Track stream state
      const streamState = {
        sessionId,
        constraints: normalizedConstraints,
        createdAt: Date.now(),
        active: true,
      };

      this.streams.set(sessionId, streamState);

      // Initialize track states
      const trackState = {
        audioEnabled: audioConstraints !== false,
        videoEnabled: videoConstraints !== false,
        screenSharing: false,
      };
      this.trackStates.set(sessionId, trackState);

      this.emit("stream:acquired", {
        sessionId,
        constraints: normalizedConstraints,
        trackStates: trackState,
      });

      logger.info(
        `[MediaEngine] Media stream acquired for session ${sessionId}` +
          ` (audio: ${trackState.audioEnabled}, video: ${trackState.videoEnabled})`,
      );

      return {
        success: true,
        sessionId,
        constraints: normalizedConstraints,
        trackStates: trackState,
      };
    } catch (error) {
      logger.error("[MediaEngine] Error acquiring media stream:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Release a media stream for a session
   * @param {string} sessionId - Session ID to release
   * @returns {Object} Result
   */
  async releaseMediaStream(sessionId) {
    try {
      const streamState = this.streams.get(sessionId);
      if (!streamState) {
        return { success: true, message: "No active stream for session" };
      }

      // Mark as inactive
      streamState.active = false;
      streamState.releasedAt = Date.now();

      // Clean up state
      this.streams.delete(sessionId);
      this.trackStates.delete(sessionId);

      // Stop quality monitoring
      this._stopQualityMonitor(sessionId);
      this.qualityMetrics.delete(sessionId);

      // Stop screen share if active for this session
      if (
        this.screenStream &&
        this.screenStream.sessionId === sessionId
      ) {
        this.screenStream = null;
      }

      this.emit("stream:released", { sessionId });

      logger.info(
        `[MediaEngine] Media stream released for session ${sessionId}`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[MediaEngine] Error releasing media stream:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Toggle audio track for a session
   * @param {string} sessionId - Session ID
   * @param {boolean} enabled - Whether audio should be enabled
   * @returns {Object} Updated track state
   */
  async toggleAudio(sessionId, enabled) {
    try {
      const trackState = this.trackStates.get(sessionId);
      if (!trackState) {
        throw new Error(`No active session: ${sessionId}`);
      }

      trackState.audioEnabled = enabled;

      this.emit("track:toggled", {
        sessionId,
        track: "audio",
        enabled,
      });

      logger.info(
        `[MediaEngine] Audio ${enabled ? "enabled" : "disabled"} for session ${sessionId}`,
      );

      return {
        success: true,
        audioEnabled: enabled,
      };
    } catch (error) {
      logger.error("[MediaEngine] Error toggling audio:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Toggle video track for a session
   * @param {string} sessionId - Session ID
   * @param {boolean} enabled - Whether video should be enabled
   * @returns {Object} Updated track state
   */
  async toggleVideo(sessionId, enabled) {
    try {
      const trackState = this.trackStates.get(sessionId);
      if (!trackState) {
        throw new Error(`No active session: ${sessionId}`);
      }

      trackState.videoEnabled = enabled;

      this.emit("track:toggled", {
        sessionId,
        track: "video",
        enabled,
      });

      logger.info(
        `[MediaEngine] Video ${enabled ? "enabled" : "disabled"} for session ${sessionId}`,
      );

      return {
        success: true,
        videoEnabled: enabled,
      };
    } catch (error) {
      logger.error("[MediaEngine] Error toggling video:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start screen sharing for a session
   * @param {string} sessionId - Session ID
   * @param {Object} [options] - Screen share options
   * @param {string} [options.sourceId] - Specific screen/window source ID
   * @returns {Object} Screen share configuration
   */
  async startScreenShare(sessionId, options = {}) {
    try {
      if (!this.streams.has(sessionId)) {
        throw new Error(`No active session: ${sessionId}`);
      }

      if (this.screenStream) {
        throw new Error(
          "Screen sharing is already active. Stop the current share first.",
        );
      }

      const screenConstraints = {
        ...DEFAULT_SCREEN_CONSTRAINTS,
        ...(options.constraints || {}),
      };

      // Build the screen share configuration for the renderer
      const screenConfig = {
        sessionId,
        sourceId: options.sourceId || null,
        constraints: {
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              ...(options.sourceId
                ? { chromeMediaSourceId: options.sourceId }
                : {}),
              maxWidth: screenConstraints.width.ideal || 1920,
              maxHeight: screenConstraints.height.ideal || 1080,
              maxFrameRate: screenConstraints.frameRate.ideal || 15,
            },
          },
          audio: false,
        },
        startedAt: Date.now(),
      };

      this.screenStream = screenConfig;

      // Update track state
      const trackState = this.trackStates.get(sessionId);
      if (trackState) {
        trackState.screenSharing = true;
      }

      this.emit("track:toggled", {
        sessionId,
        track: "screen",
        enabled: true,
      });

      logger.info(
        `[MediaEngine] Screen sharing started for session ${sessionId}`,
      );

      return {
        success: true,
        screenConfig,
      };
    } catch (error) {
      logger.error("[MediaEngine] Error starting screen share:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop screen sharing
   * @param {string} sessionId - Session ID
   * @returns {Object} Result
   */
  async stopScreenShare(sessionId) {
    try {
      if (
        !this.screenStream ||
        this.screenStream.sessionId !== sessionId
      ) {
        return { success: true, message: "No active screen share" };
      }

      this.screenStream = null;

      // Update track state
      const trackState = this.trackStates.get(sessionId);
      if (trackState) {
        trackState.screenSharing = false;
      }

      this.emit("track:toggled", {
        sessionId,
        track: "screen",
        enabled: false,
      });

      logger.info(
        `[MediaEngine] Screen sharing stopped for session ${sessionId}`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[MediaEngine] Error stopping screen share:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get stream quality statistics for a session
   * @param {string} sessionId - Session ID
   * @returns {Object} Quality statistics
   */
  async getStreamStats(sessionId) {
    try {
      if (!this.streams.has(sessionId)) {
        return { success: false, error: "No active session" };
      }

      const cachedMetrics = this.qualityMetrics.get(sessionId);
      if (cachedMetrics) {
        return {
          success: true,
          stats: cachedMetrics,
          quality: this._categorizeQuality(cachedMetrics),
        };
      }

      // Return default stats if no metrics collected yet
      const defaultStats = {
        bytesReceived: 0,
        bytesSent: 0,
        packetsReceived: 0,
        packetsSent: 0,
        packetsLost: 0,
        packetLossRate: 0,
        roundTripTime: 0,
        jitter: 0,
        timestamp: Date.now(),
      };

      return {
        success: true,
        stats: defaultStats,
        quality: "unknown",
      };
    } catch (error) {
      logger.error("[MediaEngine] Error getting stream stats:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update quality metrics for a session (called by signaling layer with RTCPeerConnection stats)
   * @param {string} sessionId - Session ID
   * @param {Object} stats - Raw RTCPeerConnection stats
   */
  updateQualityMetrics(sessionId, stats) {
    try {
      const metrics = {
        bytesReceived: stats.bytesReceived || 0,
        bytesSent: stats.bytesSent || 0,
        packetsReceived: stats.packetsReceived || 0,
        packetsSent: stats.packetsSent || 0,
        packetsLost: stats.packetsLost || 0,
        packetLossRate:
          stats.packetsSent > 0
            ? stats.packetsLost / stats.packetsSent
            : 0,
        roundTripTime: stats.roundTripTime || 0,
        jitter: stats.jitter || 0,
        framesPerSecond: stats.framesPerSecond || 0,
        frameWidth: stats.frameWidth || 0,
        frameHeight: stats.frameHeight || 0,
        timestamp: Date.now(),
      };

      const previousMetrics = this.qualityMetrics.get(sessionId);
      this.qualityMetrics.set(sessionId, metrics);

      // Check for quality changes
      if (previousMetrics) {
        const prevQuality = this._categorizeQuality(previousMetrics);
        const newQuality = this._categorizeQuality(metrics);

        if (prevQuality !== newQuality) {
          this.emit("quality:changed", {
            sessionId,
            previousQuality: prevQuality,
            currentQuality: newQuality,
            metrics,
          });
        }
      }
    } catch (error) {
      logger.error("[MediaEngine] Error updating quality metrics:", error);
    }
  }

  /**
   * Start quality monitoring for a session
   * @param {string} sessionId - Session ID
   */
  startQualityMonitor(sessionId) {
    this._stopQualityMonitor(sessionId);

    const timer = setInterval(() => {
      // Emit a request for stats from the renderer
      this.emit("quality:request-stats", { sessionId });
    }, this.qualityMonitorInterval);

    this.qualityTimers.set(sessionId, timer);
    logger.info(
      `[MediaEngine] Quality monitor started for session ${sessionId}`,
    );
  }

  /**
   * Get current track states for a session
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Track states
   */
  getTrackStates(sessionId) {
    return this.trackStates.get(sessionId) || null;
  }

  /**
   * Get all active sessions
   * @returns {Array} Active session IDs
   */
  getActiveSessions() {
    return Array.from(this.streams.keys());
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  /**
   * Normalize audio constraints
   */
  _normalizeAudioConstraints(audio) {
    if (audio === false) {
      return false;
    }

    if (audio === true || audio === undefined) {
      return { ...DEFAULT_AUDIO_CONSTRAINTS };
    }

    if (typeof audio === "object") {
      return { ...DEFAULT_AUDIO_CONSTRAINTS, ...audio };
    }

    return { ...DEFAULT_AUDIO_CONSTRAINTS };
  }

  /**
   * Normalize video constraints
   */
  _normalizeVideoConstraints(video) {
    if (video === false || video === undefined) {
      return false;
    }

    if (video === true) {
      return { ...DEFAULT_VIDEO_CONSTRAINTS };
    }

    if (typeof video === "object") {
      return { ...DEFAULT_VIDEO_CONSTRAINTS, ...video };
    }

    return false;
  }

  /**
   * Categorize quality based on metrics
   * @param {Object} metrics - Quality metrics
   * @returns {string} Quality category
   */
  _categorizeQuality(metrics) {
    const { packetLossRate, roundTripTime, jitter } = metrics;

    if (
      packetLossRate <= QUALITY_THRESHOLDS.excellent.packetLoss &&
      roundTripTime <= QUALITY_THRESHOLDS.excellent.rtt &&
      jitter <= QUALITY_THRESHOLDS.excellent.jitter
    ) {
      return "excellent";
    }

    if (
      packetLossRate <= QUALITY_THRESHOLDS.good.packetLoss &&
      roundTripTime <= QUALITY_THRESHOLDS.good.rtt &&
      jitter <= QUALITY_THRESHOLDS.good.jitter
    ) {
      return "good";
    }

    if (
      packetLossRate <= QUALITY_THRESHOLDS.fair.packetLoss &&
      roundTripTime <= QUALITY_THRESHOLDS.fair.rtt &&
      jitter <= QUALITY_THRESHOLDS.fair.jitter
    ) {
      return "fair";
    }

    return "poor";
  }

  /**
   * Stop quality monitoring for a session
   */
  _stopQualityMonitor(sessionId) {
    const timer = this.qualityTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.qualityTimers.delete(sessionId);
    }
  }

  /**
   * Clean up all resources
   */
  async destroy() {
    // Release all streams
    for (const sessionId of this.streams.keys()) {
      await this.releaseMediaStream(sessionId);
    }

    // Clear all quality timers
    for (const timer of this.qualityTimers.values()) {
      clearInterval(timer);
    }
    this.qualityTimers.clear();

    this.streams.clear();
    this.trackStates.clear();
    this.qualityMetrics.clear();
    this.screenStream = null;
    this.removeAllListeners();

    logger.info("[MediaEngine] Destroyed");
  }
}

module.exports = { MediaEngine };
