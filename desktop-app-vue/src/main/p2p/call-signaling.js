/**
 * Call Signaling Manager
 *
 * Handles SDP offer/answer exchange and ICE candidate relay over the P2P network
 * for establishing WebRTC peer connections during voice/video calls.
 *
 * Protocol: /chainlesschain/call-signaling/1.0.0
 *
 * Features:
 * - SDP offer/answer exchange
 * - ICE candidate relay
 * - Incoming signal handling with protocol versioning
 * - Integration with P2PManager for message transport
 * - Signal queuing for offline/unreachable peers
 *
 * @module p2p/call-signaling
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * Signaling message types
 */
const SignalType = {
  OFFER: "offer",
  ANSWER: "answer",
  ICE_CANDIDATE: "ice-candidate",
  RENEGOTIATE: "renegotiate",
  HANGUP: "hangup",
};

/**
 * Protocol identifier for call signaling
 */
const PROTOCOL_CALL_SIGNALING = "/chainlesschain/call-signaling/1.0.0";

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  signalTimeoutMs: 15000,
  maxQueueSize: 100,
  retryAttempts: 3,
  retryDelayMs: 1000,
};

/**
 * Call Signaling class
 * Manages WebRTC signaling over P2P network
 */
class CallSignaling extends EventEmitter {
  constructor(p2pManager, config = {}) {
    super();

    this.p2pManager = p2pManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Pending signal queues per target DID
    this.signalQueues = new Map();

    // Active signaling sessions: sessionId -> { targetDid, state, createdAt }
    this.sessions = new Map();

    // Signal timeout timers
    this.timeoutTimers = new Map();

    this.initialized = false;
  }

  /**
   * Initialize the signaling manager
   * Sets up P2P protocol handlers for incoming signals
   */
  async initialize() {
    if (this.initialized) {
      logger.warn("[CallSignaling] Already initialized");
      return;
    }

    this._setupP2PListeners();
    this.initialized = true;
    logger.info("[CallSignaling] Initialized successfully");
  }

  /**
   * Set up P2P message listeners for signaling protocol
   */
  _setupP2PListeners() {
    if (!this.p2pManager) {
      logger.warn(
        "[CallSignaling] P2P manager not available, deferring listener setup",
      );
      return;
    }

    // Listen for incoming signaling messages
    this.p2pManager.on("message:call-signaling", (data) => {
      try {
        this.handleIncomingSignal(data.senderDid || data.peerId, data);
      } catch (error) {
        logger.error("[CallSignaling] Error processing incoming signal:", error);
      }
    });

    // If p2pManager supports protocol handling directly
    if (this.p2pManager.node && typeof this.p2pManager.node.handle === "function") {
      this.p2pManager.node
        .handle(PROTOCOL_CALL_SIGNALING, async ({ stream, connection }) => {
          try {
            const peerId = connection.remotePeer.toString();
            const chunks = [];

            for await (const chunk of stream.source) {
              chunks.push(chunk.subarray());
            }

            const rawData = Buffer.concat(chunks);
            const data = JSON.parse(new TextDecoder().decode(rawData));

            this.handleIncomingSignal(peerId, data);
          } catch (error) {
            logger.error(
              "[CallSignaling] Error handling protocol stream:",
              error,
            );
          }
        })
        .catch((err) => {
          logger.warn(
            "[CallSignaling] Could not register protocol handler:",
            err.message,
          );
        });
    }

    logger.info("[CallSignaling] P2P listeners configured");
  }

  /**
   * Send an SDP offer to a target peer
   * @param {string} targetDid - Target peer's DID
   * @param {Object} sdp - SDP offer object
   * @param {Object} [options] - Additional options
   * @param {string} [options.roomId] - Associated room ID
   * @param {string} [options.sessionId] - Signaling session ID
   * @returns {Object} Send result
   */
  async sendOffer(targetDid, sdp, options = {}) {
    try {
      if (!targetDid) {
        throw new Error("Target DID is required");
      }

      if (!sdp || !sdp.type || !sdp.sdp) {
        throw new Error("Valid SDP offer is required (must have type and sdp fields)");
      }

      const sessionId = options.sessionId || uuidv4();

      // Track the signaling session
      this.sessions.set(sessionId, {
        targetDid,
        state: "offer-sent",
        roomId: options.roomId || null,
        createdAt: Date.now(),
      });

      const signal = {
        type: SignalType.OFFER,
        sessionId,
        roomId: options.roomId || null,
        sdp: {
          type: sdp.type,
          sdp: sdp.sdp,
        },
        timestamp: Date.now(),
        protocol: PROTOCOL_CALL_SIGNALING,
      };

      await this._sendSignal(targetDid, signal);

      // Set answer timeout
      this._setSignalTimeout(sessionId, targetDid, "answer");

      logger.info(
        `[CallSignaling] SDP offer sent to ${targetDid} (session: ${sessionId})`,
      );

      return { success: true, sessionId };
    } catch (error) {
      logger.error("[CallSignaling] Error sending offer:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send an SDP answer to a target peer
   * @param {string} targetDid - Target peer's DID
   * @param {Object} sdp - SDP answer object
   * @param {Object} [options] - Additional options
   * @param {string} [options.sessionId] - Signaling session ID
   * @returns {Object} Send result
   */
  async sendAnswer(targetDid, sdp, options = {}) {
    try {
      if (!targetDid) {
        throw new Error("Target DID is required");
      }

      if (!sdp || !sdp.type || !sdp.sdp) {
        throw new Error("Valid SDP answer is required (must have type and sdp fields)");
      }

      const sessionId = options.sessionId || null;

      // Update session state if tracked
      if (sessionId && this.sessions.has(sessionId)) {
        this.sessions.get(sessionId).state = "answer-sent";
      }

      const signal = {
        type: SignalType.ANSWER,
        sessionId,
        sdp: {
          type: sdp.type,
          sdp: sdp.sdp,
        },
        timestamp: Date.now(),
        protocol: PROTOCOL_CALL_SIGNALING,
      };

      await this._sendSignal(targetDid, signal);

      // Clear any pending timeout for this session
      if (sessionId) {
        this._clearSignalTimeout(sessionId);
      }

      logger.info(
        `[CallSignaling] SDP answer sent to ${targetDid} (session: ${sessionId})`,
      );

      return { success: true, sessionId };
    } catch (error) {
      logger.error("[CallSignaling] Error sending answer:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send an ICE candidate to a target peer
   * @param {string} targetDid - Target peer's DID
   * @param {Object} candidate - ICE candidate object
   * @param {Object} [options] - Additional options
   * @param {string} [options.sessionId] - Signaling session ID
   * @returns {Object} Send result
   */
  async sendIceCandidate(targetDid, candidate, options = {}) {
    try {
      if (!targetDid) {
        throw new Error("Target DID is required");
      }

      if (!candidate) {
        throw new Error("ICE candidate is required");
      }

      const signal = {
        type: SignalType.ICE_CANDIDATE,
        sessionId: options.sessionId || null,
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment || null,
        },
        timestamp: Date.now(),
        protocol: PROTOCOL_CALL_SIGNALING,
      };

      await this._sendSignal(targetDid, signal);

      logger.debug(
        `[CallSignaling] ICE candidate sent to ${targetDid}` +
          ` (mid: ${candidate.sdpMid})`,
      );

      return { success: true };
    } catch (error) {
      logger.error("[CallSignaling] Error sending ICE candidate:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle an incoming signaling message from a peer
   * @param {string} peerId - Sender peer ID / DID
   * @param {Object} data - Signaling message data
   */
  handleIncomingSignal(peerId, data) {
    try {
      if (!data || !data.type) {
        logger.warn(
          `[CallSignaling] Received invalid signal from ${peerId}:`,
          data,
        );
        return;
      }

      const signalType = data.type;

      switch (signalType) {
        case SignalType.OFFER:
          this._handleOffer(peerId, data);
          break;

        case SignalType.ANSWER:
          this._handleAnswer(peerId, data);
          break;

        case SignalType.ICE_CANDIDATE:
          this._handleIceCandidate(peerId, data);
          break;

        case SignalType.RENEGOTIATE:
          this._handleRenegotiate(peerId, data);
          break;

        case SignalType.HANGUP:
          this._handleHangup(peerId, data);
          break;

        default:
          logger.warn(
            `[CallSignaling] Unknown signal type "${signalType}" from ${peerId}`,
          );
      }
    } catch (error) {
      logger.error("[CallSignaling] Error handling incoming signal:", error);
    }
  }

  /**
   * Send a hangup signal to a target peer
   * @param {string} targetDid - Target peer's DID
   * @param {string} [sessionId] - Signaling session ID
   * @returns {Object} Send result
   */
  async sendHangup(targetDid, sessionId) {
    try {
      const signal = {
        type: SignalType.HANGUP,
        sessionId: sessionId || null,
        timestamp: Date.now(),
        protocol: PROTOCOL_CALL_SIGNALING,
      };

      await this._sendSignal(targetDid, signal);

      // Clean up session
      if (sessionId) {
        this.sessions.delete(sessionId);
        this._clearSignalTimeout(sessionId);
      }

      logger.info(`[CallSignaling] Hangup sent to ${targetDid}`);

      return { success: true };
    } catch (error) {
      logger.error("[CallSignaling] Error sending hangup:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active signaling sessions
   * @returns {Array} Active sessions
   */
  getActiveSessions() {
    const sessions = [];
    for (const [sessionId, session] of this.sessions.entries()) {
      sessions.push({
        sessionId,
        ...session,
      });
    }
    return sessions;
  }

  // ============================================================
  // Private Signal Handlers
  // ============================================================

  /**
   * Handle incoming SDP offer
   */
  _handleOffer(peerId, data) {
    const { sessionId, sdp, roomId } = data;

    // Track session from remote peer
    if (sessionId) {
      this.sessions.set(sessionId, {
        targetDid: peerId,
        state: "offer-received",
        roomId: roomId || null,
        createdAt: Date.now(),
      });
    }

    this.emit("signal:offer", {
      peerId,
      sessionId,
      roomId,
      sdp,
      timestamp: data.timestamp,
    });

    logger.info(
      `[CallSignaling] Received SDP offer from ${peerId} (session: ${sessionId})`,
    );
  }

  /**
   * Handle incoming SDP answer
   */
  _handleAnswer(peerId, data) {
    const { sessionId, sdp } = data;

    // Update session state
    if (sessionId && this.sessions.has(sessionId)) {
      this.sessions.get(sessionId).state = "answer-received";
      this._clearSignalTimeout(sessionId);
    }

    this.emit("signal:answer", {
      peerId,
      sessionId,
      sdp,
      timestamp: data.timestamp,
    });

    logger.info(
      `[CallSignaling] Received SDP answer from ${peerId} (session: ${sessionId})`,
    );
  }

  /**
   * Handle incoming ICE candidate
   */
  _handleIceCandidate(peerId, data) {
    const { sessionId, candidate } = data;

    this.emit("signal:ice-candidate", {
      peerId,
      sessionId,
      candidate,
      timestamp: data.timestamp,
    });

    logger.debug(
      `[CallSignaling] Received ICE candidate from ${peerId}` +
        ` (mid: ${candidate?.sdpMid})`,
    );
  }

  /**
   * Handle incoming renegotiation request
   */
  _handleRenegotiate(peerId, data) {
    const { sessionId } = data;

    this.emit("signal:renegotiate", {
      peerId,
      sessionId,
      timestamp: data.timestamp,
    });

    logger.info(
      `[CallSignaling] Received renegotiation request from ${peerId}`,
    );
  }

  /**
   * Handle incoming hangup signal
   */
  _handleHangup(peerId, data) {
    const { sessionId } = data;

    // Clean up session
    if (sessionId) {
      this.sessions.delete(sessionId);
      this._clearSignalTimeout(sessionId);
    }

    this.emit("signal:hangup", {
      peerId,
      sessionId,
      timestamp: data.timestamp,
    });

    logger.info(`[CallSignaling] Received hangup from ${peerId}`);
  }

  // ============================================================
  // Private Transport Methods
  // ============================================================

  /**
   * Send a signaling message to a target DID via P2P
   * Includes retry logic for transient failures
   */
  async _sendSignal(targetDid, signal) {
    if (!this.p2pManager) {
      throw new Error("P2P manager not available");
    }

    let lastError = null;

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        await this.p2pManager.sendMessage(targetDid, {
          type: "call-signaling",
          ...signal,
        });
        return;
      } catch (error) {
        lastError = error;
        logger.warn(
          `[CallSignaling] Send attempt ${attempt + 1}/${this.config.retryAttempts} failed for ${targetDid}:`,
          error.message,
        );

        if (attempt < this.config.retryAttempts - 1) {
          await this._delay(
            this.config.retryDelayMs * Math.pow(2, attempt),
          );
        }
      }
    }

    // Queue the signal if all retries failed
    this._queueSignal(targetDid, signal);

    throw new Error(
      `Failed to send signal to ${targetDid} after ${this.config.retryAttempts} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Queue a signal for later delivery
   */
  _queueSignal(targetDid, signal) {
    if (!this.signalQueues.has(targetDid)) {
      this.signalQueues.set(targetDid, []);
    }

    const queue = this.signalQueues.get(targetDid);

    if (queue.length >= this.config.maxQueueSize) {
      // Remove oldest signal
      queue.shift();
      logger.warn(
        `[CallSignaling] Signal queue overflow for ${targetDid}, dropping oldest`,
      );
    }

    queue.push({
      signal,
      queuedAt: Date.now(),
    });

    logger.info(
      `[CallSignaling] Signal queued for ${targetDid} (queue size: ${queue.length})`,
    );
  }

  /**
   * Flush queued signals for a target DID (called when peer reconnects)
   * @param {string} targetDid - Target peer's DID
   */
  async flushQueue(targetDid) {
    const queue = this.signalQueues.get(targetDid);
    if (!queue || queue.length === 0) {
      return;
    }

    logger.info(
      `[CallSignaling] Flushing ${queue.length} queued signals for ${targetDid}`,
    );

    const signals = [...queue];
    this.signalQueues.delete(targetDid);

    for (const { signal } of signals) {
      try {
        await this.p2pManager.sendMessage(targetDid, {
          type: "call-signaling",
          ...signal,
        });
      } catch (error) {
        logger.warn(
          `[CallSignaling] Failed to flush signal to ${targetDid}:`,
          error.message,
        );
      }
    }
  }

  /**
   * Set a timeout for expected signal response
   */
  _setSignalTimeout(sessionId, targetDid, expectedType) {
    this._clearSignalTimeout(sessionId);

    const timer = setTimeout(() => {
      this.timeoutTimers.delete(sessionId);

      logger.warn(
        `[CallSignaling] Signal timeout waiting for ${expectedType} from ${targetDid} (session: ${sessionId})`,
      );

      this.emit("signal:timeout", {
        sessionId,
        targetDid,
        expectedType,
      });

      // Clean up session
      this.sessions.delete(sessionId);
    }, this.config.signalTimeoutMs);

    this.timeoutTimers.set(sessionId, timer);
  }

  /**
   * Clear a signal timeout
   */
  _clearSignalTimeout(sessionId) {
    const timer = this.timeoutTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(sessionId);
    }
  }

  /**
   * Promise-based delay
   */
  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clean up all resources
   */
  async destroy() {
    // Clear all timeouts
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();

    this.sessions.clear();
    this.signalQueues.clear();
    this.removeAllListeners();
    this.initialized = false;

    logger.info("[CallSignaling] Destroyed");
  }
}

module.exports = { CallSignaling, SignalType, PROTOCOL_CALL_SIGNALING };
