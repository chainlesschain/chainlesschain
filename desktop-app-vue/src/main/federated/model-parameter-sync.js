/**
 * Model Parameter Sync
 *
 * Handles P2P synchronization of model parameters and gradients
 * between federated learning participants. Uses a custom libp2p
 * protocol for communication.
 *
 * @module federated/model-parameter-sync
 * @version 1.0.0
 */

"use strict";

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const {
  FederatedTransportBoundaryError,
  createFederatedTransportBoundaries,
  assertPeerId,
  serializeFederatedMessage,
} = require("./federated-transport-boundaries");

const FEDERATED_PROTOCOL = "/chainlesschain/federated/1.0.0";

class ModelParameterSync extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.p2pManager - P2P network manager instance
   */
  constructor({ p2pManager, boundaries = {}, now = Date.now }) {
    super();
    this.p2pManager = p2pManager;
    this.protocol = FEDERATED_PROTOCOL;
    this.boundaries = createFederatedTransportBoundaries(boundaries);
    this._now = typeof now === "function" ? now : Date.now;
    this.messageHandlers = new Set();
    this._activeInbound = 0;
    this._activeOutbound = 0;
    this._activeStreams = new Set();
    this._generation = 0;
    this._destroyed = false;
    this._protocolHandler = null;
    this._handlerRegistration = null;

    this._initializeProtocolHandler();
  }

  /**
   * Initialize the P2P protocol handler for federated learning messages.
   * Listens for incoming messages on the federated protocol.
   * @private
   */
  _initializeProtocolHandler() {
    if (!this.p2pManager || !this.p2pManager.node) {
      logger.warn(
        "[ModelParameterSync] P2P manager not ready, protocol handler deferred",
      );
      return;
    }

    try {
      this._protocolHandler = async ({ stream, connection }) => {
        if (this._destroyed) {
          const error = this._destroyedError();
          this._abortStream(stream, error);
          return;
        }
        if (this._activeInbound >= this.boundaries.maxConcurrentInbound) {
          const error = this._inboundCapacityError();
          this._abortStream(stream, error);
          this.emit("boundary-error", error);
          return;
        }

        const generation = this._generation;
        const deadlineAt = this._newDeadline();
        this._activeInbound += 1;
        this._activeStreams.add(stream);
        try {
          const peerId = assertPeerId(
            connection.remotePeer.toString(),
            this.boundaries,
          );
          const rawData = await this._readIncomingStream(stream, deadlineAt);
          let message;
          try {
            message = JSON.parse(rawData.toString("utf8"));
            serializeFederatedMessage(message, this.boundaries);
          } catch (error) {
            if (error instanceof FederatedTransportBoundaryError) {
              throw error;
            }
            throw new FederatedTransportBoundaryError(
              "ERR_FEDERATED_MESSAGE_INVALID",
              "Federated message is not valid JSON",
            );
          }

          if (generation !== this._generation || this._destroyed) {
            return;
          }
          logger.debug(
            `[ModelParameterSync] Received message type=${message.type} from ${peerId}`,
          );
          this.emit("message", { peerId, message });

          for (const handler of [...this.messageHandlers]) {
            if (generation !== this._generation || this._destroyed) {
              break;
            }
            try {
              await this._withDeadline(
                Promise.resolve().then(() => handler({ peerId, message })),
                "ERR_FEDERATED_HANDLER_TIMEOUT",
                this._remainingBefore(deadlineAt),
              );
            } catch (err) {
              if (err instanceof FederatedTransportBoundaryError) {
                throw err;
              }
              logger.error(
                `[ModelParameterSync] Handler error: ${err.message}`,
              );
            }
          }
        } catch (error) {
          this._abortStream(stream, error);
          if (error instanceof FederatedTransportBoundaryError) {
            this.emit("boundary-error", error);
          }
          logger.error(
            `[ModelParameterSync] Error processing incoming stream: ${error.message}`,
          );
        } finally {
          this._activeStreams.delete(stream);
          this._activeInbound -= 1;
        }
      };
      const protocolNode = this.p2pManager.node;
      const registration = protocolNode.handle(
        this.protocol,
        this._protocolHandler,
      );
      if (registration?.then) {
        this._handlerRegistration = Promise.resolve(registration)
          .then(() => {
            if (this._destroyed) {
              return protocolNode.unhandle?.(this.protocol);
            }
            return undefined;
          })
          .catch((error) => {
            logger.error(
              `[ModelParameterSync] Failed to register protocol handler: ${error.message}`,
            );
          });
      }

      logger.info(
        `[ModelParameterSync] Protocol handler registered: ${this.protocol}`,
      );
    } catch (error) {
      logger.error(
        `[ModelParameterSync] Failed to register protocol handler: ${error.message}`,
      );
    }
  }

  /**
   * Send a message to a specific peer via the federated protocol.
   *
   * @param {string} peerId - Target peer ID
   * @param {Object} message - Message payload
   * @returns {Promise<boolean>} Whether the send was successful
   * @private
   */
  async _sendMessage(peerId, message, deadlineAt = this._newDeadline()) {
    if (this._destroyed) {
      throw this._destroyedError();
    }
    if (!this.p2pManager || !this.p2pManager.node) {
      logger.warn("[ModelParameterSync] P2P manager not available");
      return false;
    }

    assertPeerId(peerId, this.boundaries);
    const data = serializeFederatedMessage(message, this.boundaries);
    if (this._activeOutbound >= this.boundaries.maxConcurrentOutbound) {
      throw new FederatedTransportBoundaryError(
        "ERR_FEDERATED_OUTBOUND_CAPACITY",
        `Federated transport already has ${this.boundaries.maxConcurrentOutbound} outbound operations`,
        { limit: this.boundaries.maxConcurrentOutbound },
      );
    }

    const generation = this._generation;
    const node = this.p2pManager.node;
    this._activeOutbound += 1;
    let stream = null;
    try {
      stream = await this._withDeadline(
        Promise.resolve().then(() => node.dialProtocol(peerId, this.protocol)),
        "ERR_FEDERATED_STREAM_TIMEOUT",
        this._remainingBefore(deadlineAt),
      );
      this._activeStreams.add(stream);
      if (generation !== this._generation || this._destroyed) {
        throw this._destroyedError();
      }

      await this._withDeadline(
        Promise.resolve().then(() => stream.sink([data])),
        "ERR_FEDERATED_STREAM_TIMEOUT",
        this._remainingBefore(deadlineAt),
      );
      if (generation !== this._generation || this._destroyed) {
        throw this._destroyedError();
      }

      logger.debug(
        `[ModelParameterSync] Sent message type=${message.type} to ${peerId}`,
      );
      return true;
    } catch (error) {
      if (error instanceof FederatedTransportBoundaryError) {
        this._abortStream(stream, error);
        throw error;
      }
      logger.error(
        `[ModelParameterSync] Failed to send message to ${peerId}: ${error.message}`,
      );
      return false;
    } finally {
      if (stream) {
        this._activeStreams.delete(stream);
      }
      this._activeOutbound -= 1;
    }
  }

  /**
   * Broadcast a message to all connected peers.
   *
   * @param {Object} message - Message payload
   * @returns {Promise<{ sent: number, failed: number }>} Broadcast result
   * @private
   */
  async _broadcastMessage(message) {
    if (!this.p2pManager || !this.p2pManager.node) {
      logger.warn(
        "[ModelParameterSync] P2P manager not available for broadcast",
      );
      return { sent: 0, failed: 0 };
    }

    const peers = this.p2pManager.peers || new Map();
    if (peers.size > this.boundaries.maxBroadcastPeers) {
      throw new FederatedTransportBoundaryError(
        "ERR_FEDERATED_BROADCAST_CAPACITY",
        `Federated broadcast exceeds ${this.boundaries.maxBroadcastPeers} peers`,
        { peerCount: peers.size, limit: this.boundaries.maxBroadcastPeers },
      );
    }
    let sent = 0;
    let failed = 0;
    const deadlineAt = this._newDeadline();

    for (const [peerId] of peers) {
      const success = await this._sendMessage(peerId, message, deadlineAt);
      if (success) {
        sent++;
      } else {
        failed++;
      }
    }

    logger.info(
      `[ModelParameterSync] Broadcast message type=${message.type}: sent=${sent}, failed=${failed}`,
    );

    return { sent, failed };
  }

  /**
   * Broadcast round creation to the P2P network.
   * Informs all connected peers that a new federated learning round
   * is available to join.
   *
   * @param {Object} roundInfo - Round information to broadcast
   * @param {string} roundInfo.id - Round ID
   * @param {string} roundInfo.modelId - Model identifier
   * @param {number} roundInfo.minParticipants - Minimum participants required
   * @param {number} roundInfo.maxParticipants - Maximum participants allowed
   * @param {string} roundInfo.aggregationMethod - Aggregation method (fedavg/fedprox)
   * @returns {Promise<{ sent: number, failed: number }>} Broadcast result
   */
  async broadcastRound(roundInfo) {
    logger.info(
      `[ModelParameterSync] Broadcasting round creation: ${roundInfo.id}`,
    );

    const message = {
      type: "federated:round-created",
      roundId: roundInfo.id,
      modelId: roundInfo.modelId,
      minParticipants: roundInfo.minParticipants,
      maxParticipants: roundInfo.maxParticipants,
      aggregationMethod: roundInfo.aggregationMethod,
      timestamp: Date.now(),
    };

    const result = await this._broadcastMessage(message);
    this.emit("round-broadcast", { roundInfo, result });
    return result;
  }

  /**
   * Broadcast aggregation results to all peers.
   *
   * @param {string} roundId - Round ID
   * @param {string} globalModelHash - Hash of the updated global model
   * @returns {Promise<{ sent: number, failed: number }>} Broadcast result
   */
  async broadcastAggregation(roundId, globalModelHash) {
    logger.info(
      `[ModelParameterSync] Broadcasting aggregation result for round ${roundId}`,
    );

    const message = {
      type: "federated:aggregation-complete",
      roundId: roundId,
      globalModelHash: globalModelHash,
      timestamp: Date.now(),
    };

    const result = await this._broadcastMessage(message);
    this.emit("aggregation-broadcast", { roundId, globalModelHash, result });
    return result;
  }

  /**
   * Request gradients from a specific peer.
   *
   * @param {string} roundId - Round ID
   * @param {string} peerId - Peer to request gradients from
   * @returns {Promise<boolean>} Whether the request was sent successfully
   */
  async requestGradients(roundId, peerId) {
    logger.info(
      `[ModelParameterSync] Requesting gradients from ${peerId} for round ${roundId}`,
    );

    const message = {
      type: "federated:request-gradients",
      roundId: roundId,
      timestamp: Date.now(),
    };

    const success = await this._sendMessage(peerId, message);
    if (success) {
      this.emit("gradients-requested", { roundId, peerId });
    }
    return success;
  }

  /**
   * Send gradients to the coordinator peer.
   *
   * @param {string} roundId - Round ID
   * @param {string} peerId - Coordinator peer ID to send gradients to
   * @param {number[]} gradients - Local training gradients
   * @returns {Promise<boolean>} Whether the send was successful
   */
  async sendGradients(roundId, peerId, gradients) {
    logger.info(
      `[ModelParameterSync] Sending gradients to ${peerId} for round ${roundId}: ${gradients.length} parameters`,
    );

    const message = {
      type: "federated:submit-gradients",
      roundId: roundId,
      gradients: gradients,
      timestamp: Date.now(),
    };

    const success = await this._sendMessage(peerId, message);
    if (success) {
      this.emit("gradients-sent", {
        roundId,
        peerId,
        paramCount: gradients.length,
      });
    }
    return success;
  }

  /**
   * Sync the global model to all peers in the round.
   *
   * @param {string} roundId - Round ID
   * @param {Object} modelData - Global model data to sync
   * @param {number[]} modelData.parameters - Model parameter values
   * @param {string} modelData.hash - Model parameter hash
   * @param {number} modelData.roundNumber - Current round number
   * @returns {Promise<{ sent: number, failed: number }>} Sync result
   */
  async syncGlobalModel(roundId, modelData) {
    logger.info(
      `[ModelParameterSync] Syncing global model for round ${roundId}, roundNumber=${modelData.roundNumber}`,
    );

    const message = {
      type: "federated:global-model-sync",
      roundId: roundId,
      modelHash: modelData.hash,
      parameters: modelData.parameters,
      roundNumber: modelData.roundNumber,
      timestamp: Date.now(),
    };

    const result = await this._broadcastMessage(message);
    this.emit("global-model-synced", { roundId, result });
    return result;
  }

  /**
   * Register a handler for federated protocol messages.
   *
   * @param {Function} handler - Async function called with { peerId, message }
   */
  onMessage(handler) {
    if (this._destroyed) {
      throw this._destroyedError();
    }
    if (typeof handler !== "function") {
      throw new Error("Handler must be a function");
    }
    if (
      !this.messageHandlers.has(handler) &&
      this.messageHandlers.size >= this.boundaries.maxMessageHandlers
    ) {
      throw new FederatedTransportBoundaryError(
        "ERR_FEDERATED_HANDLER_CAPACITY",
        `Federated transport already has ${this.boundaries.maxMessageHandlers} message handlers`,
        { limit: this.boundaries.maxMessageHandlers },
      );
    }
    this.messageHandlers.add(handler);
    logger.debug(
      `[ModelParameterSync] Registered message handler (total: ${this.messageHandlers.size})`,
    );
    return () => this.messageHandlers.delete(handler);
  }

  async _readIncomingStream(stream, deadlineAt = this._newDeadline()) {
    const source = stream?.source;
    if (!source || typeof source[Symbol.asyncIterator] !== "function") {
      throw new FederatedTransportBoundaryError(
        "ERR_FEDERATED_STREAM_INVALID",
        "Federated stream source must be async iterable",
      );
    }

    const iterator = source[Symbol.asyncIterator]();
    const chunks = [];
    let chunkCount = 0;
    let totalBytes = 0;
    try {
      while (true) {
        const next = await this._nextWithDeadline(iterator, deadlineAt);
        if (next.done) {
          break;
        }
        let chunk;
        try {
          const value = next.value?.subarray
            ? next.value.subarray()
            : next.value;
          chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        } catch (_error) {
          throw new FederatedTransportBoundaryError(
            "ERR_FEDERATED_STREAM_INVALID",
            "Federated stream emitted a non-binary chunk",
          );
        }
        chunkCount += 1;
        totalBytes += chunk.byteLength;
        if (chunkCount > this.boundaries.maxStreamChunks) {
          throw new FederatedTransportBoundaryError(
            "ERR_FEDERATED_STREAM_CHUNKS_EXCEEDED",
            `Federated stream exceeds ${this.boundaries.maxStreamChunks} chunks`,
            { chunkCount, limitChunks: this.boundaries.maxStreamChunks },
          );
        }
        if (totalBytes > this.boundaries.maxMessageBytes) {
          throw new FederatedTransportBoundaryError(
            "ERR_FEDERATED_MESSAGE_TOO_LARGE",
            `Federated stream exceeds ${this.boundaries.maxMessageBytes} bytes`,
            { totalBytes, limitBytes: this.boundaries.maxMessageBytes },
          );
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, totalBytes);
    } catch (error) {
      try {
        Promise.resolve(iterator.return?.()).catch(() => {});
      } catch (_returnError) {
        // The boundary error remains authoritative.
      }
      throw error;
    }
  }

  _nextWithDeadline(iterator, deadlineAt) {
    return this._withDeadline(
      iterator.next(),
      "ERR_FEDERATED_STREAM_TIMEOUT",
      this._remainingBefore(deadlineAt),
    );
  }

  _newDeadline() {
    return this._now() + this.boundaries.streamDeadlineMs;
  }

  _remainingBefore(deadlineAt) {
    const remaining = deadlineAt - this._now();
    if (remaining <= 0) {
      throw new FederatedTransportBoundaryError(
        "ERR_FEDERATED_STREAM_TIMEOUT",
        `Federated transport operation exceeded ${this.boundaries.streamDeadlineMs} ms`,
        { timeoutMs: this.boundaries.streamDeadlineMs },
      );
    }
    return remaining;
  }

  _destroyedError() {
    return new FederatedTransportBoundaryError(
      "ERR_FEDERATED_DESTROYED",
      "Federated transport has been destroyed",
    );
  }

  _inboundCapacityError() {
    return new FederatedTransportBoundaryError(
      "ERR_FEDERATED_INBOUND_CAPACITY",
      `Federated transport already has ${this.boundaries.maxConcurrentInbound} inbound operations`,
      { limit: this.boundaries.maxConcurrentInbound },
    );
  }

  _withDeadline(promise, code, timeoutMs = this.boundaries.streamDeadlineMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new FederatedTransportBoundaryError(
            code,
            `Federated transport operation exceeded ${timeoutMs} ms`,
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

  _abortStream(stream, error) {
    try {
      const pendingAbort = stream?.abort?.(error);
      pendingAbort?.catch?.(() => {});
    } catch (_abortError) {
      // The original error remains authoritative.
    }
  }

  destroy() {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;
    this._generation += 1;
    const error = this._destroyedError();
    for (const stream of this._activeStreams) {
      this._abortStream(stream, error);
    }
    this._activeStreams.clear();
    this.messageHandlers.clear();
    try {
      const pending = this.p2pManager?.node?.unhandle?.(this.protocol);
      pending?.catch?.(() => {});
    } catch (_error) {
      // Best-effort detach for libp2p variants with synchronous unhandle.
    }
    this._protocolHandler = null;
    this._handlerRegistration = null;
    this.p2pManager = null;
    this.removeAllListeners();
  }
}

module.exports = { ModelParameterSync, FEDERATED_PROTOCOL };
