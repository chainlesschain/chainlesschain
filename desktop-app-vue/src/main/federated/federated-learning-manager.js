/**
 * Federated Learning Manager
 *
 * Core orchestrator for privacy-preserving federated learning across
 * the ChainlessChain P2P network. Manages training rounds, participant
 * enrollment, gradient collection, differential privacy, and model
 * aggregation.
 *
 * @module federated/federated-learning-manager
 * @version 1.0.0
 */

"use strict";

const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const { GradientAggregator } = require("./gradient-aggregator.js");
const { DifferentialPrivacy } = require("./differential-privacy.js");
const { ModelParameterSync } = require("./model-parameter-sync.js");

const FEDERATED_PROTOCOL = "/chainlesschain/federated/1.0.0";

class FederatedLearningManager extends EventEmitter {
  /**
   * @param {Object} options
   * @param {Object} options.database - Database manager instance
   * @param {Object} options.p2pManager - P2P network manager instance
   */
  constructor({ database, p2pManager }) {
    super();
    this.database = database;
    this.p2pManager = p2pManager;
    this.initialized = false;
    this.aggregator = new GradientAggregator();
    this.modelSync = null;
    this.dpInstances = new Map(); // roundId -> DifferentialPrivacy
    this.gradientStore = new Map(); // roundId -> Map<peerId, gradients>
    this.protocol = FEDERATED_PROTOCOL;

    logger.info("[FederatedLearning] Manager created");
  }

  /**
   * Initialize the federated learning system.
   * Creates database tables and sets up P2P protocol handlers.
   *
   * @param {Object} [database] - Optional database override
   */
  async initialize(database) {
    if (this.initialized) {
      logger.warn("[FederatedLearning] Already initialized");
      return;
    }

    if (database) {
      this.database = database;
    }

    this._ensureTables();

    // Initialize model parameter sync if P2P is available
    if (this.p2pManager) {
      this.modelSync = new ModelParameterSync({
        p2pManager: this.p2pManager,
      });

      this.modelSync.onMessage(async ({ peerId, message }) => {
        await this._handleP2PMessage(peerId, message);
      });
    }

    this.initialized = true;
    logger.info("[FederatedLearning] Initialized successfully");
    this.emit("initialized");
  }

  /**
   * Create database tables for federated learning.
   * @private
   */
  _ensureTables() {
    const db = this._getDb();
    if (!db) {
      logger.warn("[FederatedLearning] No database available, skipping table creation");
      return;
    }

    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS federated_rounds (
          id TEXT PRIMARY KEY,
          coordinator_peer_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created','recruiting','training','aggregating','completed','failed','cancelled')),
          round_number INTEGER DEFAULT 0,
          aggregation_method TEXT DEFAULT 'fedavg' CHECK(aggregation_method IN ('fedavg','fedprox')),
          config TEXT,
          dp_config TEXT,
          global_model_hash TEXT,
          min_participants INTEGER DEFAULT 2,
          max_participants INTEGER DEFAULT 10,
          round_timeout_ms INTEGER DEFAULT 600000,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_federated_rounds_status ON federated_rounds(status)
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS federated_peers (
          id TEXT PRIMARY KEY,
          round_id TEXT NOT NULL,
          peer_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'joined' CHECK(status IN ('joined','training','submitted','aggregated','failed','left')),
          gradient_hash TEXT,
          local_samples INTEGER DEFAULT 0,
          contribution_score REAL DEFAULT 0,
          joined_at INTEGER NOT NULL,
          submitted_at INTEGER,
          FOREIGN KEY (round_id) REFERENCES federated_rounds(id) ON DELETE CASCADE,
          UNIQUE(round_id, peer_id)
        )
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_federated_peers_round ON federated_peers(round_id)
      `);

      logger.info("[FederatedLearning] Database tables ensured");
    } catch (error) {
      logger.error(
        `[FederatedLearning] Failed to create tables: ${error.message}`
      );
    }
  }

  /**
   * Get the underlying database connection.
   * @private
   * @returns {Object|null}
   */
  _getDb() {
    if (!this.database) return null;
    return this.database.db || this.database;
  }

  /**
   * Handle incoming P2P messages for the federated protocol.
   * @private
   * @param {string} peerId - Sender peer ID
   * @param {Object} message - Message payload
   */
  async _handleP2PMessage(peerId, message) {
    try {
      switch (message.type) {
        case "federated:submit-gradients":
          await this.submitGradients(
            message.roundId,
            peerId,
            message.gradients
          );
          break;

        case "federated:join-request":
          await this.joinRound(message.roundId, peerId);
          break;

        case "federated:leave-request":
          await this.leaveRound(message.roundId, peerId);
          break;

        default:
          logger.debug(
            `[FederatedLearning] Unhandled P2P message type: ${message.type}`
          );
      }
    } catch (error) {
      logger.error(
        `[FederatedLearning] Error handling P2P message from ${peerId}: ${error.message}`
      );
    }
  }

  /**
   * Create a new federated learning round as coordinator.
   *
   * @param {Object} config - Round configuration
   * @param {string} config.modelId - Model identifier
   * @param {number} [config.minParticipants=2] - Minimum participants
   * @param {number} [config.maxParticipants=10] - Maximum participants
   * @param {string} [config.aggregationMethod='fedavg'] - Aggregation method
   * @param {Object} [config.dpConfig] - Differential privacy configuration
   * @param {number} [config.roundTimeout=600000] - Round timeout in ms
   * @returns {Object} Created round object
   */
  async createRound(config) {
    if (!config || !config.modelId) {
      throw new Error("modelId is required to create a round");
    }

    const db = this._getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const roundId = uuidv4();
    const now = Date.now();

    const coordinatorPeerId =
      this.p2pManager && this.p2pManager.peerId
        ? this.p2pManager.peerId.toString()
        : "local";

    const aggregationMethod = config.aggregationMethod || "fedavg";
    const minParticipants =
      config.minParticipants !== undefined ? config.minParticipants : 2;
    const maxParticipants =
      config.maxParticipants !== undefined ? config.maxParticipants : 10;
    const roundTimeout =
      config.roundTimeout !== undefined ? config.roundTimeout : 600000;

    const dpConfig = config.dpConfig || null;

    // If DP is configured, create a DifferentialPrivacy instance for this round
    if (dpConfig) {
      this.dpInstances.set(roundId, new DifferentialPrivacy(dpConfig));
    }

    const roundObj = {
      id: roundId,
      coordinator_peer_id: coordinatorPeerId,
      model_id: config.modelId,
      status: "recruiting",
      round_number: 0,
      aggregation_method: aggregationMethod,
      config: JSON.stringify(config),
      dp_config: dpConfig ? JSON.stringify(dpConfig) : null,
      global_model_hash: null,
      min_participants: minParticipants,
      max_participants: maxParticipants,
      round_timeout_ms: roundTimeout,
      created_at: now,
      updated_at: now,
    };

    try {
      const stmt = db.prepare(`
        INSERT INTO federated_rounds
          (id, coordinator_peer_id, model_id, status, round_number, aggregation_method,
           config, dp_config, global_model_hash, min_participants, max_participants,
           round_timeout_ms, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        roundObj.id,
        roundObj.coordinator_peer_id,
        roundObj.model_id,
        roundObj.status,
        roundObj.round_number,
        roundObj.aggregation_method,
        roundObj.config,
        roundObj.dp_config,
        roundObj.global_model_hash,
        roundObj.min_participants,
        roundObj.max_participants,
        roundObj.round_timeout_ms,
        roundObj.created_at,
        roundObj.updated_at
      );
    } catch (error) {
      logger.error(
        `[FederatedLearning] Failed to insert round: ${error.message}`
      );
      throw error;
    }

    // Initialize gradient store for this round
    this.gradientStore.set(roundId, new Map());

    // Broadcast round creation via P2P
    if (this.modelSync) {
      try {
        await this.modelSync.broadcastRound(roundObj);
      } catch (error) {
        logger.warn(
          `[FederatedLearning] Failed to broadcast round: ${error.message}`
        );
      }
    }

    logger.info(
      `[FederatedLearning] Created round ${roundId} for model ${config.modelId}, method=${aggregationMethod}`
    );

    this.emit("round-created", roundObj);
    return roundObj;
  }

  /**
   * Join an existing round as a participant.
   *
   * @param {string} roundId - Round ID to join
   * @param {string} peerId - Peer ID of the participant
   * @returns {Object} Enrollment status
   */
  async joinRound(roundId, peerId) {
    if (!roundId || !peerId) {
      throw new Error("roundId and peerId are required");
    }

    const db = this._getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    // Verify round exists and is in recruiting status
    const roundStmt = db.prepare(
      "SELECT * FROM federated_rounds WHERE id = ?"
    );
    const round = roundStmt.get(roundId);

    if (!round) {
      throw new Error(`Round ${roundId} not found`);
    }

    if (round.status !== "recruiting" && round.status !== "created") {
      throw new Error(
        `Round ${roundId} is not accepting participants (status: ${round.status})`
      );
    }

    // Check max participants
    const countStmt = db.prepare(
      "SELECT COUNT(*) as count FROM federated_peers WHERE round_id = ? AND status != 'left'"
    );
    const { count } = countStmt.get(roundId);

    if (count >= round.max_participants) {
      throw new Error(
        `Round ${roundId} has reached maximum participants (${round.max_participants})`
      );
    }

    const peersId = uuidv4();
    const now = Date.now();

    try {
      const insertStmt = db.prepare(`
        INSERT INTO federated_peers (id, round_id, peer_id, status, joined_at)
        VALUES (?, ?, ?, 'joined', ?)
      `);

      insertStmt.run(peersId, roundId, peerId, now);
    } catch (error) {
      // Handle unique constraint violation (peer already joined)
      if (
        error.message &&
        error.message.includes("UNIQUE constraint failed")
      ) {
        throw new Error(`Peer ${peerId} has already joined round ${roundId}`);
      }
      throw error;
    }

    // Update round status to 'training' if min participants reached
    const newCountStmt = db.prepare(
      "SELECT COUNT(*) as count FROM federated_peers WHERE round_id = ? AND status != 'left'"
    );
    const { count: newCount } = newCountStmt.get(roundId);

    if (newCount >= round.min_participants && round.status === "recruiting") {
      const updateStmt = db.prepare(
        "UPDATE federated_rounds SET status = 'training', updated_at = ? WHERE id = ?"
      );
      updateStmt.run(Date.now(), roundId);
    }

    const enrollment = {
      id: peersId,
      roundId: roundId,
      peerId: peerId,
      status: "joined",
      joinedAt: now,
      currentParticipants: newCount,
      minParticipants: round.min_participants,
      maxParticipants: round.max_participants,
    };

    logger.info(
      `[FederatedLearning] Peer ${peerId} joined round ${roundId} (${newCount}/${round.max_participants})`
    );

    this.emit("peer-joined", enrollment);
    return enrollment;
  }

  /**
   * Leave a federated learning round.
   *
   * @param {string} roundId - Round ID
   * @param {string} peerId - Peer ID of the participant
   * @returns {Object} Leave confirmation
   */
  async leaveRound(roundId, peerId) {
    if (!roundId || !peerId) {
      throw new Error("roundId and peerId are required");
    }

    const db = this._getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const stmt = db.prepare(
      "UPDATE federated_peers SET status = 'left' WHERE round_id = ? AND peer_id = ?"
    );
    const result = stmt.run(roundId, peerId);

    if (result.changes === 0) {
      throw new Error(
        `Peer ${peerId} not found in round ${roundId}`
      );
    }

    // Remove from gradient store
    const roundGradients = this.gradientStore.get(roundId);
    if (roundGradients) {
      roundGradients.delete(peerId);
    }

    logger.info(
      `[FederatedLearning] Peer ${peerId} left round ${roundId}`
    );

    const leaveInfo = { roundId, peerId, status: "left" };
    this.emit("peer-left", leaveInfo);
    return leaveInfo;
  }

  /**
   * Submit local training gradients for a round.
   *
   * Validates the gradient format, applies differential privacy if
   * configured, stores the gradient hash, and triggers aggregation
   * if all participants have submitted.
   *
   * @param {string} roundId - Round ID
   * @param {string} peerId - Peer ID of the submitter
   * @param {number[]} gradients - Local training gradients
   * @returns {Object} Submission result
   */
  async submitGradients(roundId, peerId, gradients) {
    if (!roundId || !peerId) {
      throw new Error("roundId and peerId are required");
    }

    if (!Array.isArray(gradients) || gradients.length === 0) {
      throw new Error("Gradients must be a non-empty array");
    }

    const db = this._getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    // Verify round exists
    const roundStmt = db.prepare(
      "SELECT * FROM federated_rounds WHERE id = ?"
    );
    const round = roundStmt.get(roundId);

    if (!round) {
      throw new Error(`Round ${roundId} not found`);
    }

    if (
      round.status !== "training" &&
      round.status !== "recruiting" &&
      round.status !== "created"
    ) {
      throw new Error(
        `Round ${roundId} is not accepting gradients (status: ${round.status})`
      );
    }

    // Verify peer is enrolled
    const peerStmt = db.prepare(
      "SELECT * FROM federated_peers WHERE round_id = ? AND peer_id = ? AND status != 'left'"
    );
    const peer = peerStmt.get(roundId, peerId);

    if (!peer) {
      throw new Error(`Peer ${peerId} is not enrolled in round ${roundId}`);
    }

    // Apply differential privacy if configured
    let processedGradients = gradients;
    const dpInstance = this.dpInstances.get(roundId);
    if (dpInstance) {
      processedGradients = dpInstance.applyDP(gradients);
      logger.info(
        `[FederatedLearning] Applied DP to gradients from peer ${peerId}`
      );
    }

    // Compute gradient hash for verification
    const gradientHash = this._computeHash(processedGradients);

    // Store gradients in memory
    if (!this.gradientStore.has(roundId)) {
      this.gradientStore.set(roundId, new Map());
    }
    this.gradientStore.get(roundId).set(peerId, processedGradients);

    // Update peer record
    const now = Date.now();
    const updateStmt = db.prepare(`
      UPDATE federated_peers
      SET status = 'submitted', gradient_hash = ?, local_samples = ?, submitted_at = ?
      WHERE round_id = ? AND peer_id = ?
    `);
    updateStmt.run(
      gradientHash,
      gradients.length,
      now,
      roundId,
      peerId
    );

    logger.info(
      `[FederatedLearning] Peer ${peerId} submitted gradients for round ${roundId}: ${gradients.length} parameters`
    );

    const submission = {
      roundId: roundId,
      peerId: peerId,
      gradientHash: gradientHash,
      parameterCount: gradients.length,
      dpApplied: !!dpInstance,
      submittedAt: now,
    };

    this.emit("gradients-submitted", submission);

    // Check if all active participants have submitted
    const activePeersStmt = db.prepare(
      "SELECT COUNT(*) as count FROM federated_peers WHERE round_id = ? AND status != 'left'"
    );
    const { count: activePeers } = activePeersStmt.get(roundId);

    const submittedStmt = db.prepare(
      "SELECT COUNT(*) as count FROM federated_peers WHERE round_id = ? AND status = 'submitted'"
    );
    const { count: submittedCount } = submittedStmt.get(roundId);

    if (submittedCount >= activePeers && activePeers >= round.min_participants) {
      logger.info(
        `[FederatedLearning] All ${submittedCount} participants submitted for round ${roundId}, triggering aggregation`
      );

      try {
        await this.aggregate(roundId);
      } catch (error) {
        logger.error(
          `[FederatedLearning] Auto-aggregation failed for round ${roundId}: ${error.message}`
        );
      }
    }

    return submission;
  }

  /**
   * Run aggregation on collected gradients for a round.
   *
   * Delegates to the GradientAggregator using the configured method
   * (FedAvg or FedProx). Updates the global model hash and advances
   * the round number.
   *
   * @param {string} roundId - Round ID
   * @returns {Object} Aggregation result
   */
  async aggregate(roundId) {
    if (!roundId) {
      throw new Error("roundId is required");
    }

    const db = this._getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    // Get round info
    const roundStmt = db.prepare(
      "SELECT * FROM federated_rounds WHERE id = ?"
    );
    const round = roundStmt.get(roundId);

    if (!round) {
      throw new Error(`Round ${roundId} not found`);
    }

    // Update status to aggregating
    const updateStatusStmt = db.prepare(
      "UPDATE federated_rounds SET status = 'aggregating', updated_at = ? WHERE id = ?"
    );
    updateStatusStmt.run(Date.now(), roundId);

    // Collect gradients from memory store
    const roundGradients = this.gradientStore.get(roundId);
    if (!roundGradients || roundGradients.size === 0) {
      throw new Error(`No gradients available for round ${roundId}`);
    }

    const peerIds = [];
    const gradientArrays = [];
    const weights = [];

    // Get peer info for weights
    const peersStmt = db.prepare(
      "SELECT * FROM federated_peers WHERE round_id = ? AND status = 'submitted'"
    );
    const peers = peersStmt.all(roundId);

    for (const peer of peers) {
      const peerGradients = roundGradients.get(peer.peer_id);
      if (peerGradients) {
        peerIds.push(peer.peer_id);
        gradientArrays.push(peerGradients);
        // Weight by local sample count; default to 1 if not specified
        weights.push(peer.local_samples > 0 ? peer.local_samples : 1);
      }
    }

    if (gradientArrays.length === 0) {
      const failStmt = db.prepare(
        "UPDATE federated_rounds SET status = 'failed', updated_at = ? WHERE id = ?"
      );
      failStmt.run(Date.now(), roundId);
      throw new Error(
        `No valid gradients to aggregate for round ${roundId}`
      );
    }

    // Validate gradients
    const validation = this.aggregator.validateGradients(gradientArrays);
    if (!validation.valid) {
      const failStmt = db.prepare(
        "UPDATE federated_rounds SET status = 'failed', updated_at = ? WHERE id = ?"
      );
      failStmt.run(Date.now(), roundId);
      throw new Error(
        `Gradient validation failed: ${validation.errors.join("; ")}`
      );
    }

    // Run aggregation
    let aggregated;
    const method = round.aggregation_method || "fedavg";

    if (method === "fedprox") {
      // For FedProx, use the current global model (or zeros if first round)
      const dim = gradientArrays[0].length;
      const globalModel = new Array(dim).fill(0);
      const config = round.config ? JSON.parse(round.config) : {};
      const mu = config.mu || 0.01;
      aggregated = this.aggregator.aggregateFedProx(
        gradientArrays,
        weights,
        globalModel,
        mu
      );
    } else {
      aggregated = this.aggregator.aggregateFedAvg(gradientArrays, weights);
    }

    // Compute contribution scores
    const scores = this.aggregator.computeContributionScores(
      gradientArrays,
      aggregated
    );

    // Update peer contribution scores
    for (let i = 0; i < peerIds.length; i++) {
      const scoreStmt = db.prepare(
        "UPDATE federated_peers SET contribution_score = ?, status = 'aggregated' WHERE round_id = ? AND peer_id = ?"
      );
      scoreStmt.run(scores[i], roundId, peerIds[i]);
    }

    // Compute global model hash
    const globalModelHash = this._computeHash(aggregated);
    const newRoundNumber = (round.round_number || 0) + 1;
    const now = Date.now();

    // Update round record
    const completeStmt = db.prepare(`
      UPDATE federated_rounds
      SET status = 'completed', global_model_hash = ?, round_number = ?, updated_at = ?
      WHERE id = ?
    `);
    completeStmt.run(globalModelHash, newRoundNumber, now, roundId);

    // Broadcast aggregation result via P2P
    if (this.modelSync) {
      try {
        await this.modelSync.broadcastAggregation(roundId, globalModelHash);
      } catch (error) {
        logger.warn(
          `[FederatedLearning] Failed to broadcast aggregation: ${error.message}`
        );
      }
    }

    const result = {
      roundId: roundId,
      method: method,
      participantCount: gradientArrays.length,
      parameterCount: aggregated.length,
      globalModelHash: globalModelHash,
      roundNumber: newRoundNumber,
      contributionScores: Object.fromEntries(
        peerIds.map((id, i) => [id, scores[i]])
      ),
      aggregatedAt: now,
    };

    // Clean up gradient store for this round
    this.gradientStore.delete(roundId);

    logger.info(
      `[FederatedLearning] Aggregation complete for round ${roundId}: ${gradientArrays.length} participants, round #${newRoundNumber}`
    );

    this.emit("aggregation-complete", result);
    return result;
  }

  /**
   * Get the current status of a federated learning round.
   *
   * @param {string} roundId - Round ID
   * @returns {Object|null} Round status object
   */
  async getStatus(roundId) {
    if (!roundId) {
      throw new Error("roundId is required");
    }

    const db = this._getDb();
    if (!db) {
      return null;
    }

    const roundStmt = db.prepare(
      "SELECT * FROM federated_rounds WHERE id = ?"
    );
    const round = roundStmt.get(roundId);

    if (!round) {
      return null;
    }

    // Get participant counts
    const totalStmt = db.prepare(
      "SELECT COUNT(*) as count FROM federated_peers WHERE round_id = ? AND status != 'left'"
    );
    const { count: totalPeers } = totalStmt.get(roundId);

    const submittedStmt = db.prepare(
      "SELECT COUNT(*) as count FROM federated_peers WHERE round_id = ? AND status = 'submitted'"
    );
    const { count: submittedPeers } = submittedStmt.get(roundId);

    return {
      id: round.id,
      coordinatorPeerId: round.coordinator_peer_id,
      modelId: round.model_id,
      status: round.status,
      roundNumber: round.round_number,
      aggregationMethod: round.aggregation_method,
      globalModelHash: round.global_model_hash,
      minParticipants: round.min_participants,
      maxParticipants: round.max_participants,
      roundTimeoutMs: round.round_timeout_ms,
      totalPeers: totalPeers,
      submittedPeers: submittedPeers,
      dpConfig: round.dp_config ? JSON.parse(round.dp_config) : null,
      config: round.config ? JSON.parse(round.config) : null,
      createdAt: round.created_at,
      updatedAt: round.updated_at,
    };
  }

  /**
   * List federated learning rounds with optional filters.
   *
   * @param {Object} [options] - Filter options
   * @param {string} [options.status] - Filter by status
   * @param {string} [options.modelId] - Filter by model ID
   * @param {number} [options.limit=50] - Maximum results
   * @param {number} [options.offset=0] - Offset for pagination
   * @returns {Object[]} Array of round objects
   */
  async listRounds(options = {}) {
    const db = this._getDb();
    if (!db) {
      return [];
    }

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    let query = "SELECT * FROM federated_rounds";
    const params = [];
    const conditions = [];

    if (options.status) {
      conditions.push("status = ?");
      params.push(options.status);
    }

    if (options.modelId) {
      conditions.push("model_id = ?");
      params.push(options.modelId);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params);

    return rows.map((row) => ({
      id: row.id,
      coordinatorPeerId: row.coordinator_peer_id,
      modelId: row.model_id,
      status: row.status,
      roundNumber: row.round_number,
      aggregationMethod: row.aggregation_method,
      globalModelHash: row.global_model_hash,
      minParticipants: row.min_participants,
      maxParticipants: row.max_participants,
      roundTimeoutMs: row.round_timeout_ms,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Set the differential privacy configuration for a specific round
   * or as default for new rounds.
   *
   * @param {Object} config - DP configuration
   * @param {number} [config.epsilon=1.0] - Privacy budget
   * @param {number} [config.delta=1e-5] - Failure probability
   * @param {string} [config.mechanism='gaussian'] - Noise mechanism
   * @param {number} [config.clipNorm=1.0] - Gradient clipping norm
   * @param {string} [config.roundId] - Optional round ID to apply to
   * @returns {Object} Applied configuration
   */
  async setDPConfig(config) {
    if (!config) {
      throw new Error("DP configuration is required");
    }

    const dpConfig = {
      epsilon: config.epsilon !== undefined ? config.epsilon : 1.0,
      delta: config.delta !== undefined ? config.delta : 1e-5,
      mechanism: config.mechanism || "gaussian",
      clipNorm: config.clipNorm !== undefined ? config.clipNorm : 1.0,
    };

    // Validate by creating an instance (will throw if invalid)
    const dpInstance = new DifferentialPrivacy(dpConfig);

    if (config.roundId) {
      // Apply to specific round
      this.dpInstances.set(config.roundId, dpInstance);

      // Update round record
      const db = this._getDb();
      if (db) {
        const stmt = db.prepare(
          "UPDATE federated_rounds SET dp_config = ?, updated_at = ? WHERE id = ?"
        );
        stmt.run(JSON.stringify(dpConfig), Date.now(), config.roundId);
      }

      logger.info(
        `[FederatedLearning] DP config applied to round ${config.roundId}: epsilon=${dpConfig.epsilon}`
      );
    } else {
      // Store as default config
      this.defaultDPConfig = dpConfig;
      logger.info(
        `[FederatedLearning] Default DP config set: epsilon=${dpConfig.epsilon}`
      );
    }

    return dpConfig;
  }

  /**
   * Get all peers for a round.
   *
   * @param {string} roundId - Round ID
   * @returns {Object[]} Array of peer objects
   */
  async getPeers(roundId) {
    if (!roundId) {
      throw new Error("roundId is required");
    }

    const db = this._getDb();
    if (!db) {
      return [];
    }

    const stmt = db.prepare(
      "SELECT * FROM federated_peers WHERE round_id = ? ORDER BY joined_at ASC"
    );
    const rows = stmt.all(roundId);

    return rows.map((row) => ({
      id: row.id,
      roundId: row.round_id,
      peerId: row.peer_id,
      status: row.status,
      gradientHash: row.gradient_hash,
      localSamples: row.local_samples,
      contributionScore: row.contribution_score,
      joinedAt: row.joined_at,
      submittedAt: row.submitted_at,
    }));
  }

  /**
   * Get the current global model parameters for a round.
   *
   * @param {string} roundId - Round ID
   * @returns {Object} Global model info
   */
  async getGlobalModel(roundId) {
    if (!roundId) {
      throw new Error("roundId is required");
    }

    const db = this._getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    const stmt = db.prepare(
      "SELECT id, model_id, global_model_hash, round_number, aggregation_method, status FROM federated_rounds WHERE id = ?"
    );
    const round = stmt.get(roundId);

    if (!round) {
      throw new Error(`Round ${roundId} not found`);
    }

    return {
      roundId: round.id,
      modelId: round.model_id,
      globalModelHash: round.global_model_hash,
      roundNumber: round.round_number,
      aggregationMethod: round.aggregation_method,
      status: round.status,
    };
  }

  /**
   * Compute a simple hash of a numeric array for verification purposes.
   * Uses a deterministic approach to create a hex string digest.
   *
   * @param {number[]} data - Array of numbers to hash
   * @returns {string} Hex hash string
   * @private
   */
  _computeHash(data) {
    // Simple FNV-1a-inspired hash for arrays of numbers
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      // Convert float to integer bits for consistent hashing
      const bits = Math.round(data[i] * 1e10);
      hash ^= bits & 0xff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= (bits >> 8) & 0xff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= (bits >> 16) & 0xff;
      hash = Math.imul(hash, 0x01000193);
      hash ^= (bits >> 24) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }

    // Convert to unsigned 32-bit and then to hex
    const unsigned = hash >>> 0;
    return unsigned.toString(16).padStart(8, "0");
  }
}

module.exports = { FederatedLearningManager };
