"use strict";

const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");
const {
  SocialCollabBoundaryError,
  createSocialCollabBoundaries,
  assertSocialPeerId,
  serializeSocialCollabMessage,
  parseSocialCollabMessage,
} = require("./social-collab-boundaries");

const PROTOCOL_SOCIAL_COLLAB = "/chainlesschain/social-collab/1.0.0";

class SocialCollabTransport extends EventEmitter {
  constructor({ p2pManager, boundaries = {}, now = Date.now, onMessage }) {
    super();
    this.p2pManager = p2pManager;
    this.boundaries = createSocialCollabBoundaries(boundaries);
    this._now = typeof now === "function" ? now : Date.now;
    this._onMessage = typeof onMessage === "function" ? onMessage : null;
    this._activeInbound = 0;
    this._activeOutbound = 0;
    this._activeStreams = new Set();
    this._abortedStreams = new WeakSet();
    this._eventReadCancels = new Set();
    this._readAbortPromise = new Promise((_, reject) => {
      this._abortPendingReads = reject;
    });
    this._readAbortPromise.catch(() => {});
    this._generation = 0;
    this._initialized = false;
    this._destroyed = false;
    this._protocolHandler = null;
    this._handlerRegistration = null;
    this._peerConnectedHandler = null;
    this._peerDisconnectedHandler = null;
  }

  async initialize() {
    if (this._destroyed) {
      throw this._destroyedError();
    }
    if (this._initialized) {
      return;
    }
    const node = this.p2pManager?.node;
    if (node && typeof node.handle === "function") {
      const generation = this._generation;
      this._protocolHandler = async ({ stream, connection }) => {
        await this._handleProtocolStream(stream, connection, generation);
      };
      const registration = node.handle(
        PROTOCOL_SOCIAL_COLLAB,
        this._protocolHandler,
      );
      if (registration?.then) {
        const deadlineAt = this._newDeadline();
        this._handlerRegistration = this._withDeadline(
          registration,
          "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
          this._remainingBefore(deadlineAt),
        );
        await this._handlerRegistration;
      }
      if (generation !== this._generation || this._destroyed) {
        await Promise.resolve(node.unhandle?.(PROTOCOL_SOCIAL_COLLAB));
        throw this._destroyedError();
      }
    } else {
      logger.warn(
        "[SocialCollabTransport] P2P protocol handler unavailable; receive disabled",
      );
    }

    if (typeof this.p2pManager?.on === "function") {
      this._peerConnectedHandler = ({ peerId } = {}) => {
        if (!this._destroyed) {
          this.emit("peer:connected", peerId);
        }
      };
      this._peerDisconnectedHandler = ({ peerId } = {}) => {
        if (!this._destroyed) {
          this.emit("peer:disconnected", peerId);
        }
      };
      this.p2pManager.on("peer:connected", this._peerConnectedHandler);
      this.p2pManager.on("peer:disconnected", this._peerDisconnectedHandler);
    }
    this._initialized = true;
  }

  async send(peerId, message, deadlineAt = this._newDeadline()) {
    if (this._destroyed) {
      throw this._destroyedError();
    }
    const node = this.p2pManager?.node;
    if (!node || typeof node.dialProtocol !== "function") {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_TRANSPORT_UNAVAILABLE",
        "P2P collaboration transport is unavailable",
      );
    }
    const normalizedPeerId = assertSocialPeerId(peerId, this.boundaries);
    const payload = serializeSocialCollabMessage(message, this.boundaries);
    if (this._activeOutbound >= this.boundaries.maxConcurrentOutbound) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_OUTBOUND_CAPACITY",
        `Social collaboration transport already has ${this.boundaries.maxConcurrentOutbound} outbound operations`,
        { limit: this.boundaries.maxConcurrentOutbound },
      );
    }

    const generation = this._generation;
    this._activeOutbound += 1;
    let stream = null;
    try {
      stream = await this._withDeadline(
        Promise.resolve().then(() =>
          node.dialProtocol(normalizedPeerId, PROTOCOL_SOCIAL_COLLAB),
        ),
        "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
        this._remainingBefore(deadlineAt),
      );
      this._activeStreams.add(stream);
      this._assertGeneration(generation);
      await this._writeStream(stream, payload, deadlineAt);
      this._assertGeneration(generation);
      return true;
    } catch (error) {
      this._abortStream(stream, error);
      throw error;
    } finally {
      if (stream) {
        this._activeStreams.delete(stream);
      }
      this._activeOutbound -= 1;
    }
  }

  createDeadline() {
    return this._newDeadline();
  }

  async _handleProtocolStream(stream, connection, registrationGeneration) {
    if (this._destroyed || registrationGeneration !== this._generation) {
      this._abortStream(stream, this._destroyedError());
      return;
    }
    if (this._activeInbound >= this.boundaries.maxConcurrentInbound) {
      const error = new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_INBOUND_CAPACITY",
        `Social collaboration transport already has ${this.boundaries.maxConcurrentInbound} inbound operations`,
        { limit: this.boundaries.maxConcurrentInbound },
      );
      this._abortStream(stream, error);
      this.emit("boundary-error", error);
      return;
    }

    const generation = this._generation;
    const deadlineAt = this._newDeadline();
    this._activeInbound += 1;
    this._activeStreams.add(stream);
    try {
      const peerId = assertSocialPeerId(
        connection?.remotePeer?.toString?.(),
        this.boundaries,
      );
      const payload = await this._readStream(stream, deadlineAt);
      const message = parseSocialCollabMessage(payload, this.boundaries);
      this._assertGeneration(generation);
      if (this._onMessage) {
        await this._withDeadline(
          Promise.resolve().then(() => this._onMessage(peerId, message)),
          "ERR_SOCIAL_COLLAB_HANDLER_TIMEOUT",
          this._remainingBefore(deadlineAt),
        );
      }
    } catch (error) {
      this._abortStream(stream, error);
      if (error instanceof SocialCollabBoundaryError) {
        this.emit("boundary-error", error);
      }
      logger.error(
        "[SocialCollabTransport] Error processing incoming stream:",
        error,
      );
    } finally {
      this._activeStreams.delete(stream);
      this._activeInbound -= 1;
    }
  }

  async _readStream(stream, deadlineAt) {
    if (stream?.source?.[Symbol.asyncIterator]) {
      return this._readAsyncIterable(stream.source, deadlineAt);
    }
    if (typeof stream?.on === "function") {
      return this._readEventStream(stream, deadlineAt);
    }
    throw new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_STREAM_INVALID",
      "Social collaboration stream is not readable",
    );
  }

  async _readAsyncIterable(source, deadlineAt) {
    const iterator = source[Symbol.asyncIterator]();
    const chunks = [];
    let chunkCount = 0;
    let totalBytes = 0;
    try {
      while (true) {
        const next = await Promise.race([
          this._withDeadline(
            iterator.next(),
            "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
            this._remainingBefore(deadlineAt),
          ),
          this._readAbortPromise,
        ]);
        if (next.done) {
          break;
        }
        const chunk = this._normalizeChunk(next.value);
        chunkCount += 1;
        totalBytes += chunk.byteLength;
        this._assertStreamBudget(chunkCount, totalBytes);
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, totalBytes);
    } catch (error) {
      try {
        Promise.resolve(iterator.return?.()).catch(() => {});
      } catch (_returnError) {
        // The original boundary remains authoritative.
      }
      throw error;
    }
  }

  _readEventStream(stream, deadlineAt) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let chunkCount = 0;
      let totalBytes = 0;
      let settled = false;
      let cancelRead = null;
      const cleanup = () => {
        clearTimeout(timer);
        if (cancelRead) {
          this._eventReadCancels.delete(cancelRead);
        }
        const remove =
          stream.off?.bind(stream) || stream.removeListener?.bind(stream);
        remove?.("data", onData);
        remove?.("end", onEnd);
        remove?.("error", onError);
      };
      const finish = (error, value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      const onData = (value) => {
        try {
          const chunk = this._normalizeChunk(value);
          chunkCount += 1;
          totalBytes += chunk.byteLength;
          this._assertStreamBudget(chunkCount, totalBytes);
          chunks.push(chunk);
        } catch (error) {
          finish(error);
        }
      };
      const onEnd = () => finish(null, Buffer.concat(chunks, totalBytes));
      const onError = (error) => finish(error);
      cancelRead = (error) => finish(error || this._destroyedError());
      this._eventReadCancels.add(cancelRead);
      const timeoutMs = this._remainingBefore(deadlineAt);
      const timer = setTimeout(() => {
        finish(
          new SocialCollabBoundaryError(
            "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
            `Social collaboration stream exceeded ${this.boundaries.streamDeadlineMs} ms`,
            { timeoutMs: this.boundaries.streamDeadlineMs },
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
    });
  }

  _normalizeChunk(value) {
    try {
      const chunk = value?.subarray ? value.subarray() : value;
      return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    } catch (_error) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_STREAM_INVALID",
        "Social collaboration stream emitted a non-binary chunk",
      );
    }
  }

  _assertStreamBudget(chunkCount, totalBytes) {
    if (chunkCount > this.boundaries.maxStreamChunks) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_STREAM_CHUNKS_EXCEEDED",
        `Social collaboration stream exceeds ${this.boundaries.maxStreamChunks} chunks`,
        { chunkCount, limitChunks: this.boundaries.maxStreamChunks },
      );
    }
    if (totalBytes > this.boundaries.maxMessageBytes) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_MESSAGE_TOO_LARGE",
        `Social collaboration stream exceeds ${this.boundaries.maxMessageBytes} bytes`,
        { totalBytes, limitBytes: this.boundaries.maxMessageBytes },
      );
    }
  }

  async _writeStream(stream, payload, deadlineAt) {
    if (typeof stream?.sink === "function") {
      await this._withDeadline(
        Promise.resolve().then(() => stream.sink([payload])),
        "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
        this._remainingBefore(deadlineAt),
      );
    } else if (typeof stream?.write === "function") {
      await this._withDeadline(
        new Promise((resolve, reject) => {
          stream.write(payload, (error) => (error ? reject(error) : resolve()));
        }),
        "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
        this._remainingBefore(deadlineAt),
      );
    } else {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_STREAM_INVALID",
        "Social collaboration stream is not writable",
      );
    }
    if (typeof stream.close === "function") {
      await this._withDeadline(
        Promise.resolve().then(() => stream.close()),
        "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
        this._remainingBefore(deadlineAt),
      );
    }
  }

  _newDeadline() {
    return this._now() + this.boundaries.streamDeadlineMs;
  }

  _remainingBefore(deadlineAt) {
    const remaining = deadlineAt - this._now();
    if (remaining <= 0) {
      throw new SocialCollabBoundaryError(
        "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
        `Social collaboration operation exceeded ${this.boundaries.streamDeadlineMs} ms`,
        { timeoutMs: this.boundaries.streamDeadlineMs },
      );
    }
    return remaining;
  }

  _withDeadline(promise, code, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new SocialCollabBoundaryError(
            code,
            `Social collaboration operation exceeded ${timeoutMs} ms`,
            { timeoutMs },
          ),
        );
      }, timeoutMs);
      timer.unref?.();
      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  _assertGeneration(generation) {
    if (generation !== this._generation || this._destroyed) {
      throw this._destroyedError();
    }
  }

  _destroyedError() {
    return new SocialCollabBoundaryError(
      "ERR_SOCIAL_COLLAB_DESTROYED",
      "Social collaboration transport has been destroyed",
    );
  }

  _abortStream(stream, error) {
    if (
      !stream ||
      (typeof stream !== "object" && typeof stream !== "function") ||
      this._abortedStreams.has(stream)
    ) {
      return;
    }
    this._abortedStreams.add(stream);
    try {
      const pending = stream?.abort?.(error);
      pending?.catch?.(() => {});
    } catch (_abortError) {
      // Best effort; the original error remains authoritative.
    }
  }

  async destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._generation += 1;
    const p2pManager = this.p2pManager;
    const node = p2pManager?.node;
    const error = this._destroyedError();
    this._abortPendingReads?.(error);
    this._abortPendingReads = null;
    for (const cancelRead of this._eventReadCancels) {
      cancelRead(error);
    }
    this._eventReadCancels.clear();
    for (const stream of this._activeStreams) {
      this._abortStream(stream, error);
    }
    this._activeStreams.clear();

    const remove =
      p2pManager?.off?.bind(p2pManager) ||
      p2pManager?.removeListener?.bind(p2pManager);
    if (this._peerConnectedHandler) {
      remove?.("peer:connected", this._peerConnectedHandler);
    }
    if (this._peerDisconnectedHandler) {
      remove?.("peer:disconnected", this._peerDisconnectedHandler);
    }
    try {
      await this._withDeadline(
        Promise.resolve().then(() => node?.unhandle?.(PROTOCOL_SOCIAL_COLLAB)),
        "ERR_SOCIAL_COLLAB_STREAM_TIMEOUT",
        this.boundaries.streamDeadlineMs,
      );
    } catch (unhandleError) {
      logger.warn(
        "[SocialCollabTransport] Failed to detach protocol handler:",
        unhandleError,
      );
    }
    this._protocolHandler = null;
    this._handlerRegistration = null;
    this._peerConnectedHandler = null;
    this._peerDisconnectedHandler = null;
    this._onMessage = null;
    this.p2pManager = null;
    this._initialized = false;
    this.removeAllListeners();
  }
}

module.exports = { SocialCollabTransport, PROTOCOL_SOCIAL_COLLAB };
