/**
 * ChainlessChain standalone WebSocket signaling server.
 *
 * All remotely influenced retained state is bounded. Overload is explicit and
 * retryable; no queue silently evicts an older message to admit a new one.
 */

"use strict";

const defaultHttpModule = require("http");
const defaultWebSocketModule = require("ws");
const { v4: uuidv4 } = require("uuid");
const { frameBytes, resolveLimits, serializedBytes } = require("./boundaries");
const OfflineMessageStore = require("./offline-message-store");

class SignalingServer {
  constructor(options = {}) {
    this.port = options.port || 9001;
    this.healthPort = options.healthPort || 9002;
    this.WebSocket = options.websocketModule || defaultWebSocketModule;
    this.httpModule = options.httpModule || defaultHttpModule;
    this.limits = resolveLimits(options);

    this.wss = null;
    this.healthServer = null;
    this.heartbeatTimer = null;
    this.cleanupTimer = null;
    this.statsTimer = null;
    this.clients = new Map();
    this.connections = new Set();
    this.offlineStore = new OfflineMessageStore(this.limits);
    // Compatibility view for existing health probes and diagnostics.
    this.offlineMessages = this.offlineStore.queues;
    this.stats = {
      totalConnections: 0,
      currentConnections: 0,
      messagesForwarded: 0,
      offlineMessagesStored: 0,
      overloads: 0,
      errors: 0,
      startTime: Date.now(),
    };
  }

  startHealthServer() {
    this.healthServer = this.httpModule.createServer((req, res) => {
      if (req.url === "/health" || req.url === "/") {
        const health = {
          status: "healthy",
          service: "signaling-server",
          version: "0.2.0",
          uptime: Math.floor((Date.now() - this.stats.startTime) / 1000),
          connections: {
            current: this.connections.size,
            total: this.stats.totalConnections,
          },
          messages: {
            forwarded: this.stats.messagesForwarded,
            offlineQueued: this.offlineStore.totalMessages,
          },
          timestamp: new Date().toISOString(),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
        return;
      }
      if (req.url === "/stats") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(this.getStats()));
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });
    this.healthServer.on("error", (error) => {
      this.stats.errors++;
      console.error("[SignalingServer] HTTP server error:", error);
    });
    this.healthServer.listen(this.healthPort, () => {
      console.log(
        `[SignalingServer] Health server listening on ${this.healthPort}`,
      );
    });
  }

  start() {
    if (this.wss) return;
    try {
      this.stats.startTime = Date.now();
      this.startHealthServer();
      this.wss = new this.WebSocket.Server({
        port: this.port,
        maxPayload: this.limits.maxMessageBytes,
        perMessageDeflate: false,
      });
      this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
      this.wss.on("error", (error) => {
        this.stats.errors++;
        console.error("[SignalingServer] WebSocket server error:", error);
      });
      this.startHeartbeat();
      this.startCleanupTimer();
      console.log(
        `[SignalingServer] WebSocket server listening on ${this.port}`,
      );
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  handleConnection(ws, req) {
    if (this.connections.size >= this.limits.maxConnections) {
      this.stats.overloads++;
      this.sendOverload(ws, "CONNECTION_LIMIT");
      ws.close(1013, "Server at capacity");
      return;
    }

    ws.connectionId = uuidv4();
    ws.isAlive = true;
    ws.peerId = null;
    ws.signalingRate = {
      windowStartedAt: Date.now(),
      messages: 0,
      bytes: 0,
    };
    this.connections.add(ws);
    this.syncConnectionStats();
    this.stats.totalConnections++;
    console.log(
      `[SignalingServer] New connection ${ws.connectionId} from ${req?.socket?.remoteAddress || "unknown"}`,
    );

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", (data) => this.handleRawMessage(ws, data));
    ws.on("close", () => this.handleDisconnection(ws));
    ws.on("error", (error) => {
      this.stats.errors++;
      console.error("[SignalingServer] WebSocket error:", error);
    });
  }

  handleRawMessage(ws, data) {
    try {
      const byteLength = frameBytes(data);
      if (byteLength > this.limits.maxMessageBytes) {
        this.sendError(ws, "Signaling message exceeds the byte limit", {
          code: "MESSAGE_TOO_LARGE",
        });
        ws.close(1009, "Message too large");
        return;
      }
      if (!this.recordInbound(ws, byteLength)) return;
      this.handleMessage(ws, JSON.parse(data.toString("utf8")));
    } catch (error) {
      this.stats.errors++;
      this.sendError(ws, "Invalid message format", {
        code: "INVALID_MESSAGE",
      });
    }
  }

  recordInbound(ws, byteLength) {
    const now = Date.now();
    const rate = ws.signalingRate;
    if (now - rate.windowStartedAt >= this.limits.rateWindowMs) {
      rate.windowStartedAt = now;
      rate.messages = 0;
      rate.bytes = 0;
    }
    rate.messages++;
    rate.bytes += byteLength;
    if (
      rate.messages <= this.limits.maxMessagesPerWindow &&
      rate.bytes <= this.limits.maxBytesPerWindow
    ) {
      return true;
    }
    this.stats.overloads++;
    this.sendOverload(ws, "RATE_LIMIT");
    ws.close(1013, "Rate limit exceeded");
    return false;
  }

  handleMessage(ws, message) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      this.sendError(ws, "Signaling message must be an object", {
        code: "INVALID_MESSAGE",
      });
      return;
    }
    if (message.type === "register") {
      this.handleRegister(ws, message);
      return;
    }
    if (message.type === "ping") {
      this.sendMessage(ws, { type: "pong", timestamp: Date.now() });
      return;
    }
    if (!ws.peerId) {
      this.sendError(ws, "Register before sending signaling messages", {
        code: "REGISTRATION_REQUIRED",
      });
      return;
    }
    if (
      message.to !== undefined &&
      (typeof message.to !== "string" ||
        Buffer.byteLength(message.to, "utf8") > this.limits.maxPeerIdBytes)
    ) {
      this.sendError(ws, "Target peerId is invalid or exceeds the byte limit", {
        code: "INVALID_MESSAGE",
      });
      return;
    }

    switch (message.type) {
      case "offer":
      case "answer":
      case "ice-candidate":
      case "ice-candidates":
      case "pairing:request":
      case "pairing:confirmation":
      case "pairing:reject":
        this.handleSignaling(ws, message);
        break;
      case "message":
        this.handleP2PMessage(ws, message);
        break;
      case "get-peers":
        this.handleGetPeers(ws, message);
        break;
      default:
        this.sendError(ws, `Unknown message type: ${message.type}`, {
          code: "UNKNOWN_MESSAGE_TYPE",
        });
    }
  }

  handleRegister(ws, message) {
    const { peerId, deviceInfo = {}, deviceType = "unknown" } = message;
    if (typeof peerId !== "string" || peerId.length === 0) {
      this.sendError(ws, "peerId is required", {
        code: "INVALID_REGISTRATION",
      });
      return;
    }
    if (Buffer.byteLength(peerId, "utf8") > this.limits.maxPeerIdBytes) {
      this.sendError(ws, "peerId exceeds the byte limit", {
        code: "INVALID_REGISTRATION",
      });
      return;
    }
    try {
      if (typeof deviceType !== "string") {
        this.sendError(ws, "deviceType must be a string", {
          code: "INVALID_REGISTRATION",
        });
        return;
      }
      if (
        serializedBytes({ deviceInfo, deviceType }) >
        this.limits.maxDeviceInfoBytes
      ) {
        this.sendError(ws, "device metadata exceeds the byte limit", {
          code: "INVALID_REGISTRATION",
        });
        return;
      }
    } catch {
      this.sendError(ws, "device metadata must be JSON serializable", {
        code: "INVALID_REGISTRATION",
      });
      return;
    }
    if (ws.peerId && ws.peerId !== peerId) {
      this.sendError(ws, "A connection cannot change peerId", {
        code: "INVALID_REGISTRATION",
      });
      return;
    }

    const previous = this.clients.get(peerId);
    ws.peerId = peerId;
    this.clients.set(peerId, {
      ws,
      deviceInfo,
      deviceType,
      connectedAt: Date.now(),
    });
    if (previous?.ws && previous.ws !== ws) {
      previous.ws.close(1000, "Replaced by reconnect");
    }

    this.sendMessage(ws, {
      type: "registered",
      peerId,
      serverTime: Date.now(),
      isReconnect: Boolean(previous),
    });
    this.deliverOfflineMessages(peerId);
    this.broadcastPeerStatus(peerId, "online", { deviceType, deviceInfo });
  }

  handleSignaling(ws, message) {
    if (typeof message.to !== "string" || message.to.length === 0) {
      this.sendError(ws, 'Missing "to" field', { code: "INVALID_MESSAGE" });
      return;
    }
    const forwarded = { ...message, from: ws.peerId, timestamp: Date.now() };
    this.forwardOrQueue(ws, message.to, forwarded);
  }

  handleP2PMessage(ws, message) {
    if (
      typeof message.to !== "string" ||
      message.to.length === 0 ||
      message.payload === undefined
    ) {
      this.sendError(ws, 'Missing "to" or "payload" field', {
        code: "INVALID_MESSAGE",
      });
      return;
    }
    this.forwardOrQueue(ws, message.to, {
      type: "message",
      from: ws.peerId,
      payload: message.payload,
      timestamp: Date.now(),
    });
  }

  forwardOrQueue(sender, targetPeerId, message) {
    const target = this.clients.get(targetPeerId);
    if (target && target.ws.readyState === this.WebSocket.OPEN) {
      if (this.sendMessage(target.ws, message)) {
        this.stats.messagesForwarded++;
      }
      return;
    }

    const result = this.offlineStore.enqueue(targetPeerId, message);
    if (!result.success) {
      if (result.code === "OVERLOADED") {
        this.stats.overloads++;
        this.sendOverload(sender, result.reason, result.retryAfterMs);
      } else {
        this.sendError(sender, "Invalid signaling message", {
          code: result.code,
          reason: result.reason,
        });
      }
      return;
    }
    this.stats.offlineMessagesStored++;
    this.sendMessage(sender, {
      type: "peer-offline",
      peerId: targetPeerId,
      messageId: result.messageId,
      timestamp: Date.now(),
    });
  }

  handleGetPeers(ws, message) {
    const requestedCursor = Number(message.cursor || 0);
    const cursor =
      Number.isSafeInteger(requestedCursor) && requestedCursor >= 0
        ? requestedCursor
        : 0;
    const requestedLimit = Number(
      message.limit || this.limits.peerListPageSize,
    );
    const pageLimit =
      Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, this.limits.peerListMaxPageSize)
        : this.limits.peerListPageSize;
    const available = [...this.clients.entries()]
      .filter(([peerId]) => peerId !== ws.peerId)
      .map(([peerId, client]) => ({
        peerId,
        deviceType: client.deviceType,
        deviceInfo: client.deviceInfo,
        connectedAt: client.connectedAt,
      }));
    const peers = [];
    for (
      let index = cursor;
      index < available.length && peers.length < pageLimit;
      index++
    ) {
      const candidate = [...peers, available[index]];
      if (
        serializedBytes({ type: "peers-list", peers: candidate }) >
        this.limits.maxMessageBytes
      ) {
        break;
      }
      peers.push(available[index]);
    }
    const nextCursor =
      cursor + peers.length < available.length ? cursor + peers.length : null;
    this.sendMessage(ws, {
      type: "peers-list",
      peers,
      count: peers.length,
      total: available.length,
      cursor,
      nextCursor,
      timestamp: Date.now(),
    });
  }

  storeOfflineMessage(targetPeerId, message) {
    const result = this.offlineStore.enqueue(targetPeerId, message);
    if (result.success) this.stats.offlineMessagesStored++;
    return result;
  }

  deliverOfflineMessages(peerId) {
    const client = this.clients.get(peerId);
    if (!client || client.ws.readyState !== this.WebSocket.OPEN) return;
    for (const item of this.offlineStore.peek(peerId)) {
      const delivered = this.sendMessage(client.ws, {
        type: "offline-message",
        originalMessage: item.message,
        storedAt: item.storedAt,
        deliveredAt: Date.now(),
      });
      if (!delivered) break;
      this.offlineStore.acknowledge(peerId, item.messageId);
    }
  }

  broadcastPeerStatus(peerId, status, metadata = {}) {
    const message = {
      type: "peer-status",
      peerId,
      status,
      ...metadata,
      timestamp: Date.now(),
    };
    for (const [clientPeerId, client] of this.clients.entries()) {
      if (clientPeerId !== peerId) this.sendMessage(client.ws, message);
    }
  }

  handleDisconnection(ws) {
    if (!this.connections.delete(ws)) return;
    if (ws.peerId && this.clients.get(ws.peerId)?.ws === ws) {
      this.clients.delete(ws.peerId);
      this.broadcastPeerStatus(ws.peerId, "offline");
    }
    this.syncConnectionStats();
  }

  syncConnectionStats() {
    this.stats.currentConnections = this.connections.size;
  }

  sendMessage(ws, message) {
    if (!ws || ws.readyState !== this.WebSocket.OPEN) return false;
    if (Number(ws.bufferedAmount || 0) > this.limits.maxBufferedAmount) {
      this.stats.overloads++;
      ws.close(1013, "Slow consumer");
      return false;
    }
    try {
      const payload = JSON.stringify(message);
      if (Buffer.byteLength(payload, "utf8") > this.limits.maxMessageBytes) {
        this.stats.errors++;
        return false;
      }
      ws.send(payload);
      return true;
    } catch (error) {
      this.stats.errors++;
      console.error("[SignalingServer] Failed to send message:", error);
      return false;
    }
  }

  sendError(ws, error, details = {}) {
    return this.sendMessage(ws, {
      type: "error",
      error,
      ...details,
      timestamp: Date.now(),
    });
  }

  sendOverload(ws, reason, retryAfterMs = this.limits.retryAfterMs) {
    return this.sendError(ws, "Signaling server is overloaded", {
      code: "OVERLOADED",
      reason,
      retryAfterMs,
    });
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (!this.wss) return;
      for (const ws of this.wss.clients) {
        if (ws.isAlive === false) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, this.limits.heartbeatIntervalMs);
  }

  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.offlineStore.cleanup();
    }, this.limits.cleanupIntervalMs);
  }

  startStatsLogging(intervalMs = 5 * 60 * 1000) {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = setInterval(() => {
      console.log("[SignalingServer] Stats", this.getStats());
    }, intervalMs);
  }

  getStats() {
    return {
      ...this.stats,
      currentConnections: this.connections.size,
      offlineMessagesQueued: this.offlineStore.totalMessages,
      offlineQueue: this.offlineStore.getStats(),
      limits: this.limits,
    };
  }

  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.heartbeatTimer = null;
    this.cleanupTimer = null;
    this.statsTimer = null;

    if (this.wss) {
      for (const ws of [...this.wss.clients]) ws.close(1001, "Server shutdown");
      this.wss.close();
      this.wss = null;
    }
    if (this.healthServer) {
      this.healthServer.close();
      this.healthServer = null;
    }
    this.connections.clear();
    this.clients.clear();
    this.offlineStore.clear();
    this.syncConnectionStats();
  }
}

if (require.main === module) {
  const server = new SignalingServer({ port: 9001 });
  server.start();
  server.startStatsLogging();

  const shutdown = () => {
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

module.exports = SignalingServer;
