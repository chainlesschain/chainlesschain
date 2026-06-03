"use strict";

/**
 * Secure Multi-Party Computation Manager
 *
 * Simulated MPC primitives (Shamir Secret Sharing, DKG, Garbled Circuits,
 * Oblivious Transfer, SPDZ, Threshold Signatures) using Node.js built-in
 * crypto and the existing shamir-split.js module.
 *
 * Provides social recovery, sealed auctions, federated learning aggregation,
 * compliance-safe data sharing, and joint authentication.
 *
 * All cryptographic operations are SIMULATED for development/testing.
 * Replace with real MPC libraries (e.g. mp-spdz, threshold-sig) for production.
 *
 * @module crypto/mpc-manager
 * @version 1.0.0
 */

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");
const { EventEmitter } = require("events");
const { logger } = require("../utils/logger.js");
const { splitSecret, reconstructSecret } = require("../ukey/shamir-split.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_TYPES = {
  SHAMIR_SPLIT: "shamir-split",
  SHAMIR_RECONSTRUCT: "shamir-reconstruct",
  SOCIAL_RECOVERY_SETUP: "social-recovery-setup",
  SOCIAL_RECOVERY_RECOVER: "social-recovery-recover",
  DKG: "distributed-key-generation",
  GARBLED_CIRCUIT: "garbled-circuit",
  OBLIVIOUS_TRANSFER: "oblivious-transfer",
  SPDZ: "spdz-compute",
  THRESHOLD_SIGN: "threshold-sign",
  JOINT_AUTH: "joint-authentication",
  MPC_CHANNEL: "mpc-channel",
  SEALED_AUCTION: "sealed-auction",
  FEDERATED_LEARNING: "federated-learning",
  COMPLIANCE_SHARING: "compliance-data-sharing",
};

const SESSION_STATUS = {
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
  EXPIRED: "expired",
};

// ---------------------------------------------------------------------------
// MPCManager
// ---------------------------------------------------------------------------

class MPCManager extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize the manager with a database instance.
   * Idempotent — calling multiple times is safe.
   * @param {object} db - Database wrapper (must expose `.db` for raw access)
   */
  async initialize(db) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    await this._ensureTables();
    this.initialized = true;
    logger.info("[MPCManager] Initialized");
    this.emit("initialized");
  }

  // -----------------------------------------------------------------------
  // Database setup
  // -----------------------------------------------------------------------

  async _ensureTables() {
    const raw = this.db?.db;
    if (!raw) {
      logger.warn("[MPCManager] No database — running in memory-only mode");
      return;
    }

    raw.exec(`
      CREATE TABLE IF NOT EXISTS mpc_sessions (
        id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        participant_count INTEGER DEFAULT 0,
        threshold INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed', 'expired')),
        result_hash TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      )
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_mpc_sessions_type ON mpc_sessions(session_type)
    `);

    raw.exec(`
      CREATE INDEX IF NOT EXISTS idx_mpc_sessions_status ON mpc_sessions(status)
    `);

    logger.info("[MPCManager] Database tables ensured");
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Persist a session record to the database.
   * @param {object} session
   */
  _saveSession(session) {
    const raw = this.db?.db;
    if (!raw) {
      return;
    }

    const stmt = raw.prepare(`
      INSERT OR REPLACE INTO mpc_sessions
        (id, session_type, participant_count, threshold, status, result_hash, metadata, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.id,
      session.sessionType,
      session.participantCount || 0,
      session.threshold || 0,
      session.status || SESSION_STATUS.ACTIVE,
      session.resultHash || null,
      JSON.stringify(session.metadata || {}),
      session.createdAt || new Date().toISOString(),
      session.completedAt || null,
    );
  }

  /**
   * Generate a SHA-256 hash of arbitrary data.
   * @param {string|Buffer} data
   * @returns {string} hex digest
   */
  _hash(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  // -----------------------------------------------------------------------
  // 1. Shamir Split
  // -----------------------------------------------------------------------

  /**
   * Split a secret into shares using Shamir Secret Sharing.
   * Delegates to shamir-split.js splitSecret().
   *
   * @param {string|Buffer} secret
   * @param {number} totalShares
   * @param {number} threshold
   * @returns {{ sessionId: string, shares: string[], threshold: number, totalShares: number }}
   */
  async shamirSplit(secret, totalShares, threshold) {
    const sessionId = uuidv4();
    logger.info("[MPCManager] shamirSplit", {
      sessionId,
      totalShares,
      threshold,
    });

    const buf = Buffer.isBuffer(secret) ? secret : Buffer.from(secret);
    const shares = splitSecret(buf, totalShares, threshold);

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.SHAMIR_SPLIT,
      participantCount: totalShares,
      threshold,
      status: SESSION_STATUS.COMPLETED,
      resultHash: this._hash(buf),
      completedAt: new Date().toISOString(),
    });

    this.emit("shamirSplit", { sessionId, totalShares, threshold });
    return { sessionId, shares, threshold, totalShares };
  }

  // -----------------------------------------------------------------------
  // 2. Shamir Reconstruct
  // -----------------------------------------------------------------------

  /**
   * Reconstruct a secret from Shamir shares.
   * Delegates to shamir-split.js reconstructSecret().
   *
   * @param {string[]} shares - array of "index:hexData" strings
   * @returns {{ secret: string, sharesUsed: number }}
   */
  async shamirReconstruct(shares) {
    logger.info("[MPCManager] shamirReconstruct", {
      sharesCount: shares.length,
    });

    const secretBuf = reconstructSecret(shares);
    const secret = secretBuf.toString();

    this.emit("shamirReconstruct", { sharesUsed: shares.length });
    return { secret, sharesUsed: shares.length };
  }

  // -----------------------------------------------------------------------
  // 3. Social Recovery Setup
  // -----------------------------------------------------------------------

  /**
   * Set up social recovery by splitting a recovery key among guardians.
   *
   * @param {string} userId
   * @param {string[]} guardians - array of guardian identifiers
   * @param {number} threshold
   * @returns {{ sessionId: string, guardianShares: Array<{guardianId: string, share: string}>, threshold: number, totalGuardians: number }}
   */
  async socialRecoverySetup(userId, guardians, threshold) {
    const sessionId = uuidv4();
    const totalGuardians = guardians.length;
    logger.info("[MPCManager] socialRecoverySetup", {
      sessionId,
      userId,
      totalGuardians,
      threshold,
    });

    if (threshold > totalGuardians) {
      throw new Error("Threshold cannot exceed total guardians");
    }
    if (threshold < 2) {
      throw new Error("Threshold must be at least 2");
    }

    // Generate a random recovery key
    const recoveryKey = crypto.randomBytes(32);
    const shares = splitSecret(recoveryKey, totalGuardians, threshold);

    const guardianShares = guardians.map((guardianId, i) => ({
      guardianId,
      share: shares[i],
    }));

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.SOCIAL_RECOVERY_SETUP,
      participantCount: totalGuardians,
      threshold,
      status: SESSION_STATUS.COMPLETED,
      resultHash: this._hash(recoveryKey),
      metadata: { userId, guardianIds: guardians },
      completedAt: new Date().toISOString(),
    });

    this.emit("socialRecoverySetup", {
      sessionId,
      userId,
      totalGuardians,
      threshold,
    });
    return { sessionId, guardianShares, threshold, totalGuardians };
  }

  // -----------------------------------------------------------------------
  // 4. Social Recovery Recover
  // -----------------------------------------------------------------------

  /**
   * Recover using guardian shares.
   *
   * @param {Array<{guardianId: string, share: string}>} guardianShares
   * @returns {{ recovered: boolean, recoveryKey: string }}
   */
  async socialRecoveryRecover(guardianShares) {
    logger.info("[MPCManager] socialRecoveryRecover", {
      sharesProvided: guardianShares.length,
    });

    const shares = guardianShares.map((gs) => gs.share);
    const recoveryKeyBuf = reconstructSecret(shares);
    const recoveryKey = recoveryKeyBuf.toString("hex");

    this.emit("socialRecoveryRecover", { recovered: true });
    return { recovered: true, recoveryKey };
  }

  // -----------------------------------------------------------------------
  // 5. Distributed Key Generation (simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate a Distributed Key Generation protocol.
   * Each participant generates a share of a joint key.
   *
   * @param {string[]} participants - participant identifiers
   * @param {number} threshold
   * @returns {{ sessionId: string, publicKey: string, participantShares: Array<{participantId: string, share: string}>, threshold: number }}
   */
  async distributedKeyGeneration(participants, threshold) {
    const sessionId = uuidv4();
    const startTime = Date.now();
    logger.info("[MPCManager] distributedKeyGeneration", {
      sessionId,
      participants: participants.length,
      threshold,
    });

    if (threshold > participants.length) {
      throw new Error("Threshold cannot exceed participant count");
    }

    // Simulate: generate an ECDH key pair as the "joint" public key
    const ecdh = crypto.createECDH("secp256k1");
    ecdh.generateKeys();
    const publicKey = ecdh.getPublicKey("hex");

    // Split the private key among participants via Shamir
    const privateKeyBuf = ecdh.getPrivateKey();
    const shares = splitSecret(privateKeyBuf, participants.length, threshold);

    const participantShares = participants.map((participantId, i) => ({
      participantId,
      share: shares[i],
    }));

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.DKG,
      participantCount: participants.length,
      threshold,
      status: SESSION_STATUS.COMPLETED,
      resultHash: this._hash(publicKey),
      metadata: { publicKey, durationMs: Date.now() - startTime },
      completedAt: new Date().toISOString(),
    });

    this.emit("dkg", {
      sessionId,
      participants: participants.length,
      threshold,
    });
    return { sessionId, publicKey, participantShares, threshold };
  }

  // -----------------------------------------------------------------------
  // 6. Garbled Circuit (simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate garbled circuit evaluation.
   *
   * @param {object} circuit - { gates: number, description: string }
   * @param {Array<{participantId: string, value: *}>} inputs
   * @returns {{ sessionId: string, result: string, gateCount: number, evaluationTimeMs: number }}
   */
  async garbledCircuit(circuit, inputs) {
    const sessionId = uuidv4();
    const startTime = Date.now();
    const gateCount = circuit?.gates || inputs.length * 4;
    logger.info("[MPCManager] garbledCircuit", {
      sessionId,
      gateCount,
      inputCount: inputs.length,
    });

    // Simulate: hash all inputs together to produce a deterministic result
    const inputData = inputs.map((inp) => JSON.stringify(inp)).join("|");
    const garbledResult = this._hash(inputData + sessionId);

    // Simulate evaluation time proportional to gate count
    const simulatedDelay = Math.min(gateCount * 0.05, 50);
    await new Promise((resolve) => setTimeout(resolve, simulatedDelay));

    const evaluationTimeMs = Date.now() - startTime;

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.GARBLED_CIRCUIT,
      participantCount: inputs.length,
      status: SESSION_STATUS.COMPLETED,
      resultHash: garbledResult,
      metadata: {
        gateCount,
        evaluationTimeMs,
        description: circuit?.description || "",
      },
      completedAt: new Date().toISOString(),
    });

    this.emit("garbledCircuit", { sessionId, gateCount, evaluationTimeMs });
    return { sessionId, result: garbledResult, gateCount, evaluationTimeMs };
  }

  // -----------------------------------------------------------------------
  // 7. Oblivious Transfer (simulated 1-of-N)
  // -----------------------------------------------------------------------

  /**
   * Simulate 1-of-N Oblivious Transfer.
   * Sender provides N values, receiver selects one without the sender learning the choice.
   *
   * @param {string[]} senderInputs - array of N values
   * @param {number} receiverChoice - 0-based index
   * @returns {{ sessionId: string, selectedValue: string, transferTimeMs: number }}
   */
  async obliviousTransfer(senderInputs, receiverChoice) {
    const sessionId = uuidv4();
    const startTime = Date.now();
    logger.info("[MPCManager] obliviousTransfer", {
      sessionId,
      inputCount: senderInputs.length,
      choice: receiverChoice,
    });

    if (receiverChoice < 0 || receiverChoice >= senderInputs.length) {
      throw new Error(
        `Invalid receiver choice: ${receiverChoice}. Must be 0..${senderInputs.length - 1}`,
      );
    }

    // Simulate OT: receiver gets the chosen value, sender learns nothing about the choice
    const selectedValue = senderInputs[receiverChoice];
    const transferTimeMs = Date.now() - startTime;

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.OBLIVIOUS_TRANSFER,
      participantCount: 2,
      status: SESSION_STATUS.COMPLETED,
      resultHash: this._hash(selectedValue),
      metadata: { inputCount: senderInputs.length, transferTimeMs },
      completedAt: new Date().toISOString(),
    });

    this.emit("obliviousTransfer", { sessionId, transferTimeMs });
    return { sessionId, selectedValue, transferTimeMs };
  }

  // -----------------------------------------------------------------------
  // 8. SPDZ Compute (simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate SPDZ protocol computation on participant values.
   *
   * @param {string} expression - e.g. "sum", "average", "max", "min", "product"
   * @param {Array<{participantId: string, value: number}>} participantValues
   * @returns {{ sessionId: string, result: number, participants: number, roundsCompleted: number }}
   */
  async spdzCompute(expression, participantValues) {
    const sessionId = uuidv4();
    logger.info("[MPCManager] spdzCompute", {
      sessionId,
      expression,
      participants: participantValues.length,
    });

    const values = participantValues.map((pv) => pv.value);
    let result;

    switch (expression.toLowerCase()) {
      case "sum":
        result = values.reduce((a, b) => a + b, 0);
        break;
      case "average":
        result = values.reduce((a, b) => a + b, 0) / values.length;
        break;
      case "max":
        result = Math.max(...values);
        break;
      case "min":
        result = Math.min(...values);
        break;
      case "product":
        result = values.reduce((a, b) => a * b, 1);
        break;
      default:
        // Fallback: treat as sum
        result = values.reduce((a, b) => a + b, 0);
        break;
    }

    // Simulate multiple rounds proportional to participant count
    const roundsCompleted = Math.max(3, participantValues.length * 2);

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.SPDZ,
      participantCount: participantValues.length,
      status: SESSION_STATUS.COMPLETED,
      resultHash: this._hash(String(result)),
      metadata: { expression, result, roundsCompleted },
      completedAt: new Date().toISOString(),
    });

    this.emit("spdzCompute", {
      sessionId,
      expression,
      result,
      roundsCompleted,
    });
    return {
      sessionId,
      result,
      participants: participantValues.length,
      roundsCompleted,
    };
  }

  // -----------------------------------------------------------------------
  // 9. Threshold Signature (simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate threshold signature generation.
   *
   * @param {string} message
   * @param {string[]} shares - signer key shares
   * @param {number} threshold
   * @returns {{ signature: string, signerCount: number, threshold: number }}
   */
  async thresholdSign(message, shares, threshold) {
    logger.info("[MPCManager] thresholdSign", {
      messageLen: message.length,
      signers: shares.length,
      threshold,
    });

    if (shares.length < threshold) {
      throw new Error(
        `Not enough shares: have ${shares.length}, need ${threshold}`,
      );
    }

    // Simulate: HMAC-SHA256 with a key derived from the combined shares
    const combinedKey = this._hash(shares.join(":"));
    const signature = crypto
      .createHmac("sha256", combinedKey)
      .update(message)
      .digest("hex");

    this.emit("thresholdSign", { signerCount: shares.length, threshold });
    return { signature, signerCount: shares.length, threshold };
  }

  // -----------------------------------------------------------------------
  // 10. Joint Authentication (simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate joint authentication where multiple participants must
   * collaborate to authenticate a challenge.
   *
   * @param {string[]} participants - participant identifiers
   * @param {string} challenge
   * @returns {{ sessionId: string, authenticated: boolean, participantCount: number }}
   */
  async jointAuthentication(participants, challenge) {
    const sessionId = uuidv4();
    logger.info("[MPCManager] jointAuthentication", {
      sessionId,
      participants: participants.length,
    });

    // Simulate: each participant contributes a partial response
    const partials = participants.map((pid) =>
      crypto.createHmac("sha256", pid).update(challenge).digest("hex"),
    );
    const combined = this._hash(partials.join(":"));
    const authenticated = combined.length > 0; // always true in simulation

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.JOINT_AUTH,
      participantCount: participants.length,
      status: SESSION_STATUS.COMPLETED,
      resultHash: combined,
      metadata: { challenge: this._hash(challenge) },
      completedAt: new Date().toISOString(),
    });

    this.emit("jointAuthentication", {
      sessionId,
      authenticated,
      participantCount: participants.length,
    });
    return { sessionId, authenticated, participantCount: participants.length };
  }

  // -----------------------------------------------------------------------
  // 11. MPC Channel
  // -----------------------------------------------------------------------

  /**
   * Create an MPC communication channel for a set of participants.
   *
   * @param {string[]} participants
   * @param {string} protocol - e.g. "garbled-circuit", "spdz", "ot"
   * @returns {{ channelId: string, participants: string[], protocol: string, status: string }}
   */
  async createMPCChannel(participants, protocol) {
    const channelId = uuidv4();
    logger.info("[MPCManager] createMPCChannel", {
      channelId,
      participants: participants.length,
      protocol,
    });

    this._saveSession({
      id: channelId,
      sessionType: SESSION_TYPES.MPC_CHANNEL,
      participantCount: participants.length,
      status: SESSION_STATUS.ACTIVE,
      metadata: { protocol, participantIds: participants },
    });

    this.emit("channelCreated", { channelId, protocol });
    return { channelId, participants, protocol, status: "ready" };
  }

  // -----------------------------------------------------------------------
  // 12. Sealed Auction (via Garbled Circuit)
  // -----------------------------------------------------------------------

  /**
   * Simulate a sealed-bid auction via MPC.
   * Bids are compared without revealing individual amounts.
   *
   * @param {Array<{bidderId: string, amount: number}>} bids
   * @returns {{ sessionId: string, winnerId: string, winningBid: number, totalBids: number, protocol: string }}
   */
  async sealedAuction(bids) {
    const sessionId = uuidv4();
    logger.info("[MPCManager] sealedAuction", {
      sessionId,
      totalBids: bids.length,
    });

    if (!bids || bids.length === 0) {
      throw new Error("At least one bid is required");
    }

    // Determine the winner (highest bid) without "revealing" individual bids
    let winnerId = bids[0].bidderId;
    let winningBid = bids[0].amount;

    for (let i = 1; i < bids.length; i++) {
      if (bids[i].amount > winningBid) {
        winningBid = bids[i].amount;
        winnerId = bids[i].bidderId;
      }
    }

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.SEALED_AUCTION,
      participantCount: bids.length,
      status: SESSION_STATUS.COMPLETED,
      resultHash: this._hash(`${winnerId}:${winningBid}`),
      metadata: { winnerId, winningBid, totalBids: bids.length },
      completedAt: new Date().toISOString(),
    });

    this.emit("sealedAuction", { sessionId, winnerId, totalBids: bids.length });
    return {
      sessionId,
      winnerId,
      winningBid,
      totalBids: bids.length,
      protocol: "garbled-circuit",
    };
  }

  // -----------------------------------------------------------------------
  // 13. Federated Learning Aggregation (simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate federated learning aggregation.
   * Aggregates model updates from participants without accessing raw data.
   *
   * @param {string} modelId
   * @param {Array<{participantId: string, weights: number[], sampleCount: number}>} participantUpdates
   * @returns {{ sessionId: string, aggregatedUpdate: number[], participantCount: number, roundId: string }}
   */
  async federatedLearning(modelId, participantUpdates) {
    const sessionId = uuidv4();
    const roundId = uuidv4();
    logger.info("[MPCManager] federatedLearning", {
      sessionId,
      modelId,
      participants: participantUpdates.length,
    });

    if (!participantUpdates || participantUpdates.length === 0) {
      throw new Error("At least one participant update is required");
    }

    // Weighted average of model updates (FedAvg algorithm simulation)
    const totalSamples = participantUpdates.reduce(
      (sum, pu) => sum + (pu.sampleCount || 1),
      0,
    );
    const weightLength = participantUpdates[0].weights?.length || 0;
    const aggregatedUpdate = new Array(weightLength).fill(0);

    for (const update of participantUpdates) {
      const weight = (update.sampleCount || 1) / totalSamples;
      for (let i = 0; i < weightLength; i++) {
        aggregatedUpdate[i] += (update.weights?.[i] || 0) * weight;
      }
    }

    // Round to reasonable precision
    for (let i = 0; i < aggregatedUpdate.length; i++) {
      aggregatedUpdate[i] = Math.round(aggregatedUpdate[i] * 1e6) / 1e6;
    }

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.FEDERATED_LEARNING,
      participantCount: participantUpdates.length,
      status: SESSION_STATUS.COMPLETED,
      resultHash: this._hash(JSON.stringify(aggregatedUpdate)),
      metadata: { modelId, roundId, weightLength, totalSamples },
      completedAt: new Date().toISOString(),
    });

    this.emit("federatedLearning", {
      sessionId,
      modelId,
      participantCount: participantUpdates.length,
    });
    return {
      sessionId,
      aggregatedUpdate,
      participantCount: participantUpdates.length,
      roundId,
    };
  }

  // -----------------------------------------------------------------------
  // 14. Compliance Data Sharing (simulated)
  // -----------------------------------------------------------------------

  /**
   * Simulate compliance-safe data sharing.
   * Multiple data owners provide encrypted inputs; the query result is
   * computed without any party seeing the others' raw data.
   *
   * @param {string[]} dataOwners - owner identifiers
   * @param {string} query - the computation query
   * @param {{ maxAge?: number, allowedFields?: string[], auditRequired?: boolean }} policy
   * @returns {{ sessionId: string, resultHash: string, dataOwnersCount: number, policyCompliant: boolean }}
   */
  async complianceDataSharing(dataOwners, query, policy) {
    const sessionId = uuidv4();
    logger.info("[MPCManager] complianceDataSharing", {
      sessionId,
      owners: dataOwners.length,
      query,
    });

    if (!dataOwners || dataOwners.length === 0) {
      throw new Error("At least one data owner is required");
    }

    // Simulate: compute a hash representing the query result
    const inputData = dataOwners.join("|") + ":" + query;
    const resultHash = this._hash(inputData + sessionId);

    // Policy compliance check (simulated — always passes)
    const policyCompliant = true;

    this._saveSession({
      id: sessionId,
      sessionType: SESSION_TYPES.COMPLIANCE_SHARING,
      participantCount: dataOwners.length,
      status: SESSION_STATUS.COMPLETED,
      resultHash,
      metadata: {
        query,
        policy: policy || {},
        policyCompliant,
        auditRequired: policy?.auditRequired || false,
      },
      completedAt: new Date().toISOString(),
    });

    this.emit("complianceDataSharing", {
      sessionId,
      dataOwnersCount: dataOwners.length,
      policyCompliant,
    });
    return {
      sessionId,
      resultHash,
      dataOwnersCount: dataOwners.length,
      policyCompliant,
    };
  }

  // -----------------------------------------------------------------------
  // 15. Statistics
  // -----------------------------------------------------------------------

  /**
   * Return aggregate counts from the mpc_sessions table.
   * @returns {object} stats
   */
  async getStats() {
    const raw = this.db?.db;
    if (!raw) {
      return {
        totalSessions: 0,
        byType: {},
        byStatus: {},
        avgParticipants: 0,
      };
    }

    const totalRow = raw
      .prepare("SELECT COUNT(*) AS cnt FROM mpc_sessions")
      .get();
    const totalSessions = totalRow?.cnt || 0;

    const typeRows = raw
      .prepare(
        "SELECT session_type, COUNT(*) AS cnt FROM mpc_sessions GROUP BY session_type",
      )
      .all();
    const byType = {};
    for (const row of typeRows) {
      byType[row.session_type] = row.cnt;
    }

    const statusRows = raw
      .prepare(
        "SELECT status, COUNT(*) AS cnt FROM mpc_sessions GROUP BY status",
      )
      .all();
    const byStatus = {};
    for (const row of statusRows) {
      byStatus[row.status] = row.cnt;
    }

    const avgRow = raw
      .prepare("SELECT AVG(participant_count) AS avg_p FROM mpc_sessions")
      .get();
    const avgParticipants = Math.round((avgRow?.avg_p || 0) * 100) / 100;

    return { totalSessions, byType, byStatus, avgParticipants };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance = null;

/**
 * Get or create the MPCManager singleton.
 * @returns {MPCManager}
 */
function getMPCManager() {
  if (!instance) {
    instance = new MPCManager();
  }
  return instance;
}

module.exports = { MPCManager, getMPCManager };
