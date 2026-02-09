/**
 * Embedded Signaling Server
 *
 * WebSocket-based signaling server for WebRTC connections.
 * Runs within the Electron desktop app to enable mobile-to-desktop
 * WebRTC connections without requiring an external signaling service.
 *
 * Features:
 * - WebRTC signaling (Offer/Answer/ICE candidates)
 * - Peer registration and discovery
 * - Offline message queue with TTL
 * - Heartbeat/keepalive for connection health
 * - Graceful shutdown
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

const SignalingPeerRegistry = require("./signaling-peer-registry");
const SignalingMessageQueue = require("./signaling-message-queue");
const handlers = require("./signaling-handlers");

class SignalingServer extends EventEmitter {
  constructor(options = {}) {
    super();

    // Configuration
    this.port = options.port || 9001;
    this.host = options.host || "0.0.0.0";
    this.maxConnections = options.maxConnections || 100;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.messageQueueSize = options.messageQueueSize || 100;
    this.messageTTL = options.messageTTL || 24 * 60 * 60 * 1000; // 24 hours

    // WebSocket server
    this.wss = null;
    this.heartbeatTimer = null;

    // Components
    this.registry = new SignalingPeerRegistry({
      staleTimeout: this.heartbeatInterval * 3,
    });

    this.messageQueue = new SignalingMessageQueue({
      maxQueueSize: this.messageQueueSize,
      messageTTL: this.messageTTL,
    });

    // Server state
    this.isRunning = false;
    this.startTime = null;

    // Statistics
    this.stats = {
      totalConnections: 0,
      messagesForwarded: 0,
      errors: 0,
    };
  }

  /**
   * Start the signaling server
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      logger.warn("[SignalingServer] Server already running");
      return;
    }

    try {
      const WebSocket = require("ws");

      // Create WebSocket server
      this.wss = new WebSocket.Server({
        port: this.port,
        host: this.host,
        maxPayload: 1024 * 1024, // 1MB max message size
      });

      // Initialize components
      this.registry.initialize();
      this.messageQueue.initialize();

      // Handle new connections
      this.wss.on("connection", (socket, req) => {
        this.handleConnection(socket, req);
      });

      // Handle server errors
      this.wss.on("error", (error) => {
        logger.error("[SignalingServer] Server error:", error);
        this.stats.errors++;
        this.emit("error", error);
      });

      // Start heartbeat
      this.startHeartbeat();

      this.isRunning = true;
      this.startTime = Date.now();

      logger.info(`[SignalingServer] Started on ${this.host}:${this.port}`);
      this.emit("started", { port: this.port, host: this.host });
    } catch (error) {
      logger.error("[SignalingServer] Failed to start:", error);
      throw error;
    }
  }

  /**
   * Stop the signaling server gracefully
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      logger.warn("[SignalingServer] Server not running");
      return;
    }

    logger.info("[SignalingServer] Stopping server...");

    // Stop heartbeat
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Notify all connected clients
    const WebSocket = require("ws");
    if (this.wss) {
      // Send shutdown notification to all clients
      const shutdownMessage = JSON.stringify({
        type: "server-shutdown",
        message: "Signaling server is shutting down",
        timestamp: Date.now(),
      });

      this.wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(shutdownMessage);
            client.close(1001, "Server shutting down");
          } catch (error) {
            // Ignore errors during shutdown
          }
        }
      });

      // Close the server
      await new Promise((resolve) => {
        this.wss.close(() => {
          resolve();
        });
      });
    }

    // Stop components
    this.registry.stop();
    this.messageQueue.stop();

    this.isRunning = false;

    logger.info("[SignalingServer] Stopped");
    this.emit("stopped");
  }

  /**
   * Handle a new WebSocket connection
   * @param {WebSocket} socket - WebSocket client
   * @param {http.IncomingMessage} req - HTTP request
   */
  handleConnection(socket, req) {
    const WebSocket = require("ws");

    // Check connection limit
    if (this.wss.clients.size > this.maxConnections) {
      logger.warn("[SignalingServer] Connection limit reached");
      socket.close(1013, "Server at capacity");
      return;
    }

    // Generate connection ID
    const connectionId = uuidv4();
    socket.connectionId = connectionId;
    socket.isAlive = true;
    socket.peerId = null;

    const clientIP = req.socket.remoteAddress;
    logger.info(
      `[SignalingServer] New connection: ${connectionId} from ${clientIP}`,
    );

    this.stats.totalConnections++;

    // Handle pong (heartbeat response)
    socket.on("pong", () => {
      socket.isAlive = true;
      if (socket.peerId) {
        this.registry.updateLastSeen(socket.peerId);
      }
    });

    // Handle messages
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(socket, message);
      } catch (error) {
        logger.error(
          "[SignalingServer] Invalid message format:",
          error.message,
        );
        this.sendMessage(socket, {
          type: "error",
          error: "Invalid message format",
          timestamp: Date.now(),
        });
        this.stats.errors++;
      }
    });

    // Handle connection close
    socket.on("close", (code, reason) => {
      this.handleDisconnection(socket, code, reason);
    });

    // Handle connection errors
    socket.on("error", (error) => {
      logger.error(
        `[SignalingServer] Socket error (${socket.peerId || connectionId}):`,
        error.message,
      );
      this.stats.errors++;
    });

    this.emit("connection", { connectionId, clientIP });
  }

  /**
   * Handle incoming messages
   * @param {WebSocket} socket - WebSocket client
   * @param {Object} message - Parsed message
   */
  handleMessage(socket, message) {
    const { type } = message;

    logger.info(
      `[SignalingServer] 收到消息: type=${type}, from=${socket.peerId || "unknown"}, to=${message.to || "N/A"}`,
    );

    // Update last seen
    if (socket.peerId) {
      this.registry.updateLastSeen(socket.peerId);
    }

    switch (type) {
      case "register":
        handlers.handleRegister(
          socket,
          message,
          this.registry,
          this.messageQueue,
          this.sendMessage.bind(this),
          this.broadcastPeerStatus.bind(this),
        );
        break;

      case "offer":
        handlers.handleOffer(
          socket,
          message,
          this.registry,
          this.messageQueue,
          this.sendMessage.bind(this),
        );
        this.stats.messagesForwarded++;
        break;

      case "answer":
        handlers.handleAnswer(
          socket,
          message,
          this.registry,
          this.messageQueue,
          this.sendMessage.bind(this),
        );
        this.stats.messagesForwarded++;
        break;

      case "ice-candidate":
        handlers.handleIceCandidate(
          socket,
          message,
          this.registry,
          this.messageQueue,
          this.sendMessage.bind(this),
        );
        this.stats.messagesForwarded++;
        break;

      case "ice-candidates":
        handlers.handleIceCandidates(
          socket,
          message,
          this.registry,
          this.messageQueue,
          this.sendMessage.bind(this),
        );
        this.stats.messagesForwarded++;
        break;

      case "message":
        handlers.handleMessage(
          socket,
          message,
          this.registry,
          this.messageQueue,
          this.sendMessage.bind(this),
        );
        this.stats.messagesForwarded++;
        break;

      case "pairing:request":
      case "pairing:confirmation":
      case "pairing:reject":
        handlers.handlePairing(
          socket,
          message,
          this.registry,
          this.messageQueue,
          this.sendMessage.bind(this),
        );
        this.stats.messagesForwarded++;
        break;

      case "get-peers":
        handlers.handleGetPeers(
          socket,
          this.registry,
          this.sendMessage.bind(this),
        );
        break;

      case "peer-status":
        handlers.handlePeerStatusRequest(
          socket,
          message,
          this.registry,
          this.sendMessage.bind(this),
        );
        break;

      case "ping":
        handlers.handlePing(socket, this.sendMessage.bind(this));
        break;

      default:
        logger.warn(`[SignalingServer] Unknown message type: ${type}`);
        this.sendMessage(socket, {
          type: "error",
          error: `Unknown message type: ${type}`,
          timestamp: Date.now(),
        });
    }

    this.emit("message", { type, from: socket.peerId });
  }

  /**
   * Handle client disconnection
   * @param {WebSocket} socket - WebSocket client
   * @param {number} code - Close code
   * @param {string} reason - Close reason
   */
  handleDisconnection(socket, code, reason) {
    const peerId = socket.peerId;
    const connectionId = socket.connectionId;

    if (peerId) {
      // Unregister the peer
      this.registry.unregister(peerId);

      // Broadcast offline status
      this.broadcastPeerStatus(peerId, "offline");

      logger.info(
        `[SignalingServer] Peer disconnected: ${peerId} (code: ${code})`,
      );
    } else {
      // Unregistered connection closed
      this.registry.unregisterByConnectionId(connectionId);
      logger.info(
        `[SignalingServer] Connection closed: ${connectionId} (code: ${code})`,
      );
    }

    this.emit("disconnection", { peerId, connectionId, code, reason });
  }

  /**
   * Send a message to a WebSocket client
   * @param {WebSocket} socket - Target socket
   * @param {Object} message - Message to send
   */
  sendMessage(socket, message) {
    const WebSocket = require("ws");

    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        logger.error(
          "[SignalingServer] Failed to send message:",
          error.message,
        );
        this.stats.errors++;
      }
    }
  }

  /**
   * Broadcast peer status to all connected peers
   * @param {string} peerId - Peer that changed status
   * @param {string} status - 'online' | 'offline'
   * @param {Object} metadata - Additional metadata
   */
  broadcastPeerStatus(peerId, status, metadata = {}) {
    const WebSocket = require("ws");

    const message = {
      type: "peer-status",
      peerId,
      status,
      ...metadata,
      timestamp: Date.now(),
    };

    const onlinePeers = this.registry.getOnlinePeers();

    for (const peer of onlinePeers) {
      if (peer.peerId !== peerId) {
        const peerData = this.registry.getPeer(peer.peerId);
        if (
          peerData &&
          peerData.socket &&
          peerData.socket.readyState === WebSocket.OPEN
        ) {
          this.sendMessage(peerData.socket, message);
        }
      }
    }
  }

  /**
   * Start heartbeat timer
   */
  startHeartbeat() {
    const WebSocket = require("ws");

    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((socket) => {
        if (socket.isAlive === false) {
          logger.info(
            `[SignalingServer] Heartbeat timeout: ${socket.peerId || socket.connectionId}`,
          );
          return socket.terminate();
        }

        socket.isAlive = false;
        socket.ping();
      });

      // Also check for stale connections in registry
      this.registry.checkStaleConnections();
    }, this.heartbeatInterval);
  }

  /**
   * Get server statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const uptime = this.startTime
      ? Math.floor((Date.now() - this.startTime) / 1000)
      : 0;

    return {
      isRunning: this.isRunning,
      uptime,
      port: this.port,
      host: this.host,
      ...this.stats,
      currentConnections: this.wss ? this.wss.clients.size : 0,
      registry: this.registry.getStats(),
      messageQueue: this.messageQueue.getStats(),
    };
  }

  /**
   * Get list of connected peers
   * @returns {Array} List of peer objects
   */
  getPeers() {
    return this.registry.getOnlinePeers();
  }

  /**
   * Kick (disconnect) a specific peer
   * @param {string} peerId - Peer to kick
   * @param {string} reason - Reason for kicking
   * @returns {boolean} True if peer was found and kicked
   */
  kickPeer(peerId, reason = "Kicked by server") {
    const peer = this.registry.getPeer(peerId);

    if (!peer) {
      return false;
    }

    // Send kick notification
    this.sendMessage(peer.socket, {
      type: "kicked",
      reason,
      timestamp: Date.now(),
    });

    // Close the connection
    try {
      peer.socket.close(1000, reason);
    } catch (error) {
      peer.socket.terminate();
    }

    return true;
  }

  /**
   * Broadcast a message to all connected peers
   * @param {Object} message - Message to broadcast
   * @param {string} excludePeerId - Peer ID to exclude (optional)
   */
  broadcast(message, excludePeerId = null) {
    const WebSocket = require("ws");

    const broadcastMessage = {
      ...message,
      timestamp: Date.now(),
    };

    this.wss.clients.forEach((socket) => {
      if (socket.readyState === WebSocket.OPEN) {
        if (!excludePeerId || socket.peerId !== excludePeerId) {
          this.sendMessage(socket, broadcastMessage);
        }
      }
    });
  }

  /**
   * Update server configuration
   * @param {Object} config - New configuration options
   */
  setConfig(config) {
    if (config.maxConnections !== undefined) {
      this.maxConnections = config.maxConnections;
    }

    if (config.heartbeatInterval !== undefined) {
      this.heartbeatInterval = config.heartbeatInterval;

      // Restart heartbeat with new interval
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.startHeartbeat();
      }
    }

    if (config.messageQueueSize !== undefined) {
      this.messageQueue.setMaxQueueSize(config.messageQueueSize);
    }

    if (config.messageTTL !== undefined) {
      this.messageQueue.setMessageTTL(config.messageTTL);
    }

    logger.info("[SignalingServer] Configuration updated");
  }

  /**
   * Check if the server is running
   * @returns {boolean} True if running
   */
  isServerRunning() {
    return this.isRunning;
  }
}

module.exports = SignalingServer;
