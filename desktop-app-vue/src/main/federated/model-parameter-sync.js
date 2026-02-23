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

const FEDERATED_PROTOCOL = "/chainlesschain/federated/1.0.0";

class ModelParameterSync extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.p2pManager - P2P network manager instance
   */
  constructor({ p2pManager }) {
    super();
    this.p2pManager = p2pManager;
    this.protocol = FEDERATED_PROTOCOL;
    this.messageHandlers = [];

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
        "[ModelParameterSync] P2P manager not ready, protocol handler deferred"
      );
      return;
    }

    try {
      this.p2pManager.node.handle(
        this.protocol,
        async ({ stream, connection }) => {
          try {
            const peerId = connection.remotePeer.toString();
            const chunks = [];

            for await (const chunk of stream.source) {
              chunks.push(chunk);
            }

            const rawData = Buffer.concat(
              chunks.map((c) => (c.subarray ? c.subarray() : Buffer.from(c)))
            );
            const message = JSON.parse(rawData.toString("utf-8"));

            logger.debug(
              `[ModelParameterSync] Received message type=${message.type} from ${peerId}`
            );

            // Emit message for internal handling
            this.emit("message", { peerId, message });

            // Call registered handlers
            for (const handler of this.messageHandlers) {
              try {
                await handler({ peerId, message });
              } catch (err) {
                logger.error(
                  `[ModelParameterSync] Handler error: ${err.message}`
                );
              }
            }
          } catch (error) {
            logger.error(
              `[ModelParameterSync] Error processing incoming stream: ${error.message}`
            );
          }
        }
      );

      logger.info(
        `[ModelParameterSync] Protocol handler registered: ${this.protocol}`
      );
    } catch (error) {
      logger.error(
        `[ModelParameterSync] Failed to register protocol handler: ${error.message}`
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
  async _sendMessage(peerId, message) {
    if (!this.p2pManager || !this.p2pManager.node) {
      logger.warn("[ModelParameterSync] P2P manager not available");
      return false;
    }

    try {
      const stream = await this.p2pManager.node.dialProtocol(
        peerId,
        this.protocol
      );

      const data = Buffer.from(JSON.stringify(message), "utf-8");
      await stream.sink([data]);

      logger.debug(
        `[ModelParameterSync] Sent message type=${message.type} to ${peerId}`
      );
      return true;
    } catch (error) {
      logger.error(
        `[ModelParameterSync] Failed to send message to ${peerId}: ${error.message}`
      );
      return false;
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
      logger.warn("[ModelParameterSync] P2P manager not available for broadcast");
      return { sent: 0, failed: 0 };
    }

    const peers = this.p2pManager.peers || new Map();
    let sent = 0;
    let failed = 0;

    for (const [peerId] of peers) {
      const success = await this._sendMessage(peerId, message);
      if (success) {
        sent++;
      } else {
        failed++;
      }
    }

    logger.info(
      `[ModelParameterSync] Broadcast message type=${message.type}: sent=${sent}, failed=${failed}`
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
      `[ModelParameterSync] Broadcasting round creation: ${roundInfo.id}`
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
      `[ModelParameterSync] Broadcasting aggregation result for round ${roundId}`
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
      `[ModelParameterSync] Requesting gradients from ${peerId} for round ${roundId}`
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
      `[ModelParameterSync] Sending gradients to ${peerId} for round ${roundId}: ${gradients.length} parameters`
    );

    const message = {
      type: "federated:submit-gradients",
      roundId: roundId,
      gradients: gradients,
      timestamp: Date.now(),
    };

    const success = await this._sendMessage(peerId, message);
    if (success) {
      this.emit("gradients-sent", { roundId, peerId, paramCount: gradients.length });
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
      `[ModelParameterSync] Syncing global model for round ${roundId}, roundNumber=${modelData.roundNumber}`
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
    if (typeof handler !== "function") {
      throw new Error("Handler must be a function");
    }
    this.messageHandlers.push(handler);
    logger.debug(
      `[ModelParameterSync] Registered message handler (total: ${this.messageHandlers.length})`
    );
  }
}

module.exports = { ModelParameterSync, FEDERATED_PROTOCOL };
