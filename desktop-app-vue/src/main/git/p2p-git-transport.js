/**
 * P2P Git Transport
 * Implements Git Smart HTTP transport over WebRTC DataChannel
 * Conforms to isomorphic-git's `http` plugin interface
 *
 * @module git/p2p-git-transport
 * @version 1.0.0
 */

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");

// Length-prefixed binary framing constants
const FRAME_HEADER_SIZE = 8; // 4 bytes length + 4 bytes type
const FRAME_TYPE_REQUEST = 0x01;
const FRAME_TYPE_RESPONSE = 0x02;
const FRAME_TYPE_DATA = 0x03;
const FRAME_TYPE_END = 0x04;
const FRAME_TYPE_ERROR = 0x05;

// Adaptive chunk sizes
const MIN_CHUNK_SIZE = 16 * 1024; // 16KB
const MAX_CHUNK_SIZE = 256 * 1024; // 256KB
const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64KB

/**
 * Bandwidth measurement tracker
 */
class BandwidthTracker {
  constructor(windowSize = 10) {
    this.samples = [];
    this.windowSize = windowSize;
    this.currentChunkSize = DEFAULT_CHUNK_SIZE;
  }

  /**
   * Record a transfer sample
   * @param {number} bytes - Bytes transferred
   * @param {number} durationMs - Duration in milliseconds
   */
  recordSample(bytes, durationMs) {
    if (durationMs <= 0) {
      return;
    }

    const bytesPerSecond = (bytes / durationMs) * 1000;
    this.samples.push({
      bytesPerSecond,
      timestamp: Date.now(),
    });

    // Keep only recent samples
    if (this.samples.length > this.windowSize) {
      this.samples.shift();
    }

    this._updateChunkSize();
  }

  /**
   * Get average bandwidth in bytes/second
   */
  getAverageBandwidth() {
    if (this.samples.length === 0) {
      return 0;
    }
    const sum = this.samples.reduce((acc, s) => acc + s.bytesPerSecond, 0);
    return sum / this.samples.length;
  }

  /**
   * Get optimal chunk size based on bandwidth
   */
  getOptimalChunkSize() {
    return this.currentChunkSize;
  }

  /**
   * Update chunk size based on measured bandwidth
   */
  _updateChunkSize() {
    const avgBandwidth = this.getAverageBandwidth();
    if (avgBandwidth <= 0) {
      return;
    }

    // Target ~100ms per chunk for responsive feedback
    let targetChunkSize = Math.floor(avgBandwidth * 0.1);

    // Clamp to bounds
    targetChunkSize = Math.max(
      MIN_CHUNK_SIZE,
      Math.min(MAX_CHUNK_SIZE, targetChunkSize),
    );

    // Smooth transition (move 25% toward target)
    this.currentChunkSize = Math.floor(
      this.currentChunkSize * 0.75 + targetChunkSize * 0.25,
    );
  }

  /**
   * Get bandwidth stats
   */
  getStats() {
    return {
      averageBandwidth: this.getAverageBandwidth(),
      currentChunkSize: this.currentChunkSize,
      sampleCount: this.samples.length,
    };
  }
}

/**
 * Frame encoder/decoder for binary framing over DataChannel
 */
class FrameCodec {
  /**
   * Encode a frame with length prefix and type
   * @param {number} type - Frame type
   * @param {Buffer|Uint8Array} payload - Frame payload
   * @returns {Buffer}
   */
  static encode(type, payload) {
    const payloadBuf = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(payload || []);
    const frame = Buffer.alloc(FRAME_HEADER_SIZE + payloadBuf.length);
    frame.writeUInt32BE(payloadBuf.length, 0);
    frame.writeUInt32BE(type, 4);
    if (payloadBuf.length > 0) {
      payloadBuf.copy(frame, FRAME_HEADER_SIZE);
    }
    return frame;
  }

  /**
   * Decode frames from a buffer (handles partial frames)
   * @param {Buffer} buffer - Input buffer
   * @returns {{ frames: Array<{type: number, payload: Buffer}>, remaining: Buffer }}
   */
  static decode(buffer) {
    const frames = [];
    let offset = 0;

    while (offset + FRAME_HEADER_SIZE <= buffer.length) {
      const payloadLength = buffer.readUInt32BE(offset);
      const type = buffer.readUInt32BE(offset + 4);

      if (offset + FRAME_HEADER_SIZE + payloadLength > buffer.length) {
        break; // Incomplete frame
      }

      const payload = buffer.slice(
        offset + FRAME_HEADER_SIZE,
        offset + FRAME_HEADER_SIZE + payloadLength,
      );
      frames.push({ type, payload });
      offset += FRAME_HEADER_SIZE + payloadLength;
    }

    const remaining = buffer.slice(offset);
    return { frames, remaining };
  }
}

/**
 * Request/response context for tracking in-flight requests
 */
class RequestContext {
  constructor(requestId) {
    this.requestId = requestId;
    this.responseChunks = [];
    this.headers = {};
    this.statusCode = 200;
    this.resolve = null;
    this.reject = null;
    this.timeout = null;
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  addChunk(chunk) {
    this.responseChunks.push(chunk);
  }

  complete() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    const body = Buffer.concat(this.responseChunks);
    this.resolve({
      url: "",
      method: "POST",
      statusCode: this.statusCode,
      statusMessage: this.statusCode === 200 ? "OK" : "Error",
      headers: this.headers,
      body: [body],
    });
  }

  fail(error) {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.reject(error);
  }
}

/**
 * P2P Git Transport - isomorphic-git http plugin interface over WebRTC
 *
 * Implements the { request({ url, method, headers, body }) } interface
 * that isomorphic-git expects for its http plugin.
 */
class P2PGitTransport extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.webrtcManager - WebRTCDataChannelManager instance
   * @param {string} options.peerId - Remote peer identifier
   * @param {number} [options.timeout=30000] - Request timeout in ms
   */
  constructor(options = {}) {
    super();
    this.webrtcManager = options.webrtcManager || null;
    this.peerId = options.peerId || null;
    this.timeout = options.timeout || 30000;
    this.bandwidthTracker = new BandwidthTracker();

    // In-flight requests
    this._requests = new Map();
    this._requestCounter = 0;

    // Receive buffer for frame reassembly
    this._receiveBuffer = Buffer.alloc(0);

    // Stats
    this._stats = {
      requestsSent: 0,
      responsesReceived: 0,
      bytesSent: 0,
      bytesReceived: 0,
      errors: 0,
    };

    // Server-side handler (when acting as git server)
    this._serverHandler = null;
  }

  /**
   * Initialize transport, set up message handlers
   */
  async initialize() {
    if (!this.webrtcManager) {
      logger.warn(
        "[P2PGitTransport] No WebRTC manager provided, using mock mode",
      );
      return;
    }

    // Listen for incoming data from peer
    this.webrtcManager.on("data", (peerId, data) => {
      if (peerId === this.peerId || !this.peerId) {
        this._handleIncomingData(peerId, data);
      }
    });

    logger.info("[P2PGitTransport] Initialized for peer:", this.peerId);
  }

  /**
   * Set peer ID for this transport
   * @param {string} peerId
   */
  setPeerId(peerId) {
    this.peerId = peerId;
  }

  /**
   * Register a server-side handler for incoming Git requests
   * @param {Function} handler - async (url, method, headers, body) => { statusCode, headers, body }
   */
  setServerHandler(handler) {
    this._serverHandler = handler;
  }

  /**
   * isomorphic-git http plugin interface
   * Called by isomorphic-git for fetch/push operations
   *
   * @param {Object} params
   * @param {string} params.url - Git endpoint URL (e.g., /info/refs, /git-upload-pack)
   * @param {string} params.method - HTTP method (GET or POST)
   * @param {Object} params.headers - HTTP headers
   * @param {AsyncIterableIterator<Uint8Array>} params.body - Request body
   * @returns {Promise<Object>} Response with { url, method, statusCode, statusMessage, headers, body }
   */
  async request({ url, method, headers, body }) {
    const requestId = ++this._requestCounter;
    const startTime = Date.now();

    logger.info(`[P2PGitTransport] Request #${requestId}: ${method} ${url}`);

    try {
      // Collect body chunks
      let bodyBuffer = Buffer.alloc(0);
      if (body) {
        const chunks = [];
        for await (const chunk of body) {
          chunks.push(Buffer.from(chunk));
        }
        bodyBuffer = Buffer.concat(chunks);
      }

      // Create request context
      const ctx = new RequestContext(requestId);

      // Set timeout
      ctx.timeout = setTimeout(() => {
        this._requests.delete(requestId);
        ctx.fail(new Error(`P2P Git request timeout after ${this.timeout}ms`));
      }, this.timeout);

      this._requests.set(requestId, ctx);

      // Build request frame payload
      const requestPayload = JSON.stringify({
        requestId,
        url,
        method,
        headers: headers || {},
        bodyLength: bodyBuffer.length,
      });

      // Send request header frame
      const headerFrame = FrameCodec.encode(
        FRAME_TYPE_REQUEST,
        Buffer.from(requestPayload),
      );
      await this._sendToPeer(headerFrame);

      // Send body in adaptive chunks
      const chunkSize = this.bandwidthTracker.getOptimalChunkSize();
      let offset = 0;
      while (offset < bodyBuffer.length) {
        const end = Math.min(offset + chunkSize, bodyBuffer.length);
        const chunk = bodyBuffer.slice(offset, end);

        const dataPayload = Buffer.alloc(4 + chunk.length);
        dataPayload.writeUInt32BE(requestId, 0);
        chunk.copy(dataPayload, 4);

        const dataFrame = FrameCodec.encode(FRAME_TYPE_DATA, dataPayload);
        const chunkStart = Date.now();
        await this._sendToPeer(dataFrame);
        this.bandwidthTracker.recordSample(
          chunk.length,
          Date.now() - chunkStart,
        );

        offset = end;
      }

      // Send end-of-request frame
      const endPayload = Buffer.alloc(4);
      endPayload.writeUInt32BE(requestId, 0);
      await this._sendToPeer(FrameCodec.encode(FRAME_TYPE_END, endPayload));

      this._stats.requestsSent++;
      this._stats.bytesSent += bodyBuffer.length;

      // Wait for response
      const response = await ctx.promise;

      this._stats.responsesReceived++;
      const duration = Date.now() - startTime;
      logger.info(
        `[P2PGitTransport] Request #${requestId} completed in ${duration}ms`,
      );

      this.emit("request-complete", {
        requestId,
        url,
        method,
        duration,
        bytesSent: bodyBuffer.length,
      });

      return response;
    } catch (error) {
      this._stats.errors++;
      logger.error(
        `[P2PGitTransport] Request #${requestId} failed:`,
        error.message,
      );
      throw error;
    } finally {
      this._requests.delete(requestId);
    }
  }

  /**
   * Handle incoming data from WebRTC DataChannel
   * @param {string} peerId
   * @param {Buffer|Uint8Array} data
   */
  _handleIncomingData(peerId, data) {
    this._receiveBuffer = Buffer.concat([
      this._receiveBuffer,
      Buffer.from(data),
    ]);

    const { frames, remaining } = FrameCodec.decode(this._receiveBuffer);
    this._receiveBuffer = remaining;

    for (const frame of frames) {
      this._processFrame(peerId, frame);
    }
  }

  /**
   * Process a decoded frame
   * @param {string} peerId
   * @param {{ type: number, payload: Buffer }} frame
   */
  async _processFrame(peerId, frame) {
    switch (frame.type) {
      case FRAME_TYPE_REQUEST:
        // Incoming request (we are the server)
        await this._handleServerRequest(peerId, frame.payload);
        break;

      case FRAME_TYPE_RESPONSE: {
        // Response header to our request
        const responseInfo = JSON.parse(frame.payload.toString());
        const ctx = this._requests.get(responseInfo.requestId);
        if (ctx) {
          ctx.statusCode = responseInfo.statusCode || 200;
          ctx.headers = responseInfo.headers || {};
        }
        break;
      }

      case FRAME_TYPE_DATA: {
        // Data chunk (could be request body or response body)
        const reqId = frame.payload.readUInt32BE(0);
        const chunk = frame.payload.slice(4);
        const dataCtx = this._requests.get(reqId);
        if (dataCtx) {
          dataCtx.addChunk(chunk);
          this._stats.bytesReceived += chunk.length;
        }
        break;
      }

      case FRAME_TYPE_END: {
        // End of stream
        const endReqId = frame.payload.readUInt32BE(0);
        const endCtx = this._requests.get(endReqId);
        if (endCtx) {
          endCtx.complete();
        }
        break;
      }

      case FRAME_TYPE_ERROR: {
        // Error response
        const errorData = JSON.parse(frame.payload.toString());
        const errorCtx = this._requests.get(errorData.requestId);
        if (errorCtx) {
          errorCtx.fail(new Error(errorData.message || "Remote error"));
        }
        break;
      }

      default:
        logger.warn(`[P2PGitTransport] Unknown frame type: ${frame.type}`);
    }
  }

  /**
   * Handle incoming Git request (server side)
   * @param {string} peerId
   * @param {Buffer} payload
   */
  async _handleServerRequest(peerId, payload) {
    let requestInfo;
    try {
      requestInfo = JSON.parse(payload.toString());
    } catch (e) {
      logger.error("[P2PGitTransport] Invalid request payload");
      return;
    }

    const { requestId, url, method, headers } = requestInfo;

    // Collect request body chunks (simplified - in practice would wait for DATA+END frames)
    if (!this._serverHandler) {
      // Send error response
      const errorPayload = JSON.stringify({
        requestId,
        message: "No server handler registered",
      });
      await this._sendToPeer(
        FrameCodec.encode(FRAME_TYPE_ERROR, Buffer.from(errorPayload)),
      );
      return;
    }

    try {
      const result = await this._serverHandler(
        url,
        method,
        headers,
        Buffer.alloc(0),
      );

      // Send response header
      const responsePayload = JSON.stringify({
        requestId,
        statusCode: result.statusCode || 200,
        headers: result.headers || {},
      });
      await this._sendToPeer(
        FrameCodec.encode(FRAME_TYPE_RESPONSE, Buffer.from(responsePayload)),
      );

      // Send response body in chunks
      const responseBody = Buffer.from(result.body || []);
      const chunkSize = this.bandwidthTracker.getOptimalChunkSize();
      let offset = 0;
      while (offset < responseBody.length) {
        const end = Math.min(offset + chunkSize, responseBody.length);
        const chunk = responseBody.slice(offset, end);
        const dataPayload = Buffer.alloc(4 + chunk.length);
        dataPayload.writeUInt32BE(requestId, 0);
        chunk.copy(dataPayload, 4);
        await this._sendToPeer(FrameCodec.encode(FRAME_TYPE_DATA, dataPayload));
        offset = end;
      }

      // Send end frame
      const endPayload = Buffer.alloc(4);
      endPayload.writeUInt32BE(requestId, 0);
      await this._sendToPeer(FrameCodec.encode(FRAME_TYPE_END, endPayload));
    } catch (error) {
      const errorPayload = JSON.stringify({
        requestId,
        message: error.message,
      });
      await this._sendToPeer(
        FrameCodec.encode(FRAME_TYPE_ERROR, Buffer.from(errorPayload)),
      );
    }
  }

  /**
   * Send data to peer via WebRTC DataChannel
   * @param {Buffer} data
   */
  async _sendToPeer(data) {
    if (!this.webrtcManager || !this.peerId) {
      throw new Error("WebRTC transport not configured");
    }

    try {
      await this.webrtcManager.sendMessage(this.peerId, data);
    } catch (error) {
      logger.error("[P2PGitTransport] Failed to send to peer:", error.message);
      throw error;
    }
  }

  /**
   * Create an isomorphic-git compatible http plugin object
   * @returns {Object} Plugin with request() method
   */
  toHttpPlugin() {
    return {
      request: this.request.bind(this),
    };
  }

  /**
   * Get transport statistics
   */
  getStats() {
    return {
      ...this._stats,
      bandwidth: this.bandwidthTracker.getStats(),
      pendingRequests: this._requests.size,
    };
  }

  /**
   * Get bandwidth statistics (convenience wrapper)
   * @returns {{ averageBandwidth, currentChunkSize, sampleCount }}
   */
  getBandwidthStats() {
    return this.bandwidthTracker.getStats();
  }

  /**
   * Destroy transport and clean up
   */
  destroy() {
    for (const [, ctx] of this._requests) {
      ctx.fail(new Error("Transport destroyed"));
    }
    this._requests.clear();
    this._receiveBuffer = Buffer.alloc(0);
    this.removeAllListeners();
    logger.info("[P2PGitTransport] Transport destroyed");
  }
}

module.exports = {
  P2PGitTransport,
  BandwidthTracker,
  FrameCodec,
  // Constants
  FRAME_TYPE_REQUEST,
  FRAME_TYPE_RESPONSE,
  FRAME_TYPE_DATA,
  FRAME_TYPE_END,
  FRAME_TYPE_ERROR,
  MIN_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  DEFAULT_CHUNK_SIZE,
};
