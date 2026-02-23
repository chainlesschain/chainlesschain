/**
 * Insurance Pool Manager - 保险池管理器
 *
 * 支持保险池创建、质押、理赔申请/投票/裁决
 * DAO式去中心化保险
 *
 * @module defi/insurance-pool-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

const InsurancePoolStatus = {
  ACTIVE: "active",
  PAUSED: "paused",
  CLOSED: "closed",
};

const ClaimStatus = {
  PENDING: "pending",
  VOTING: "voting",
  APPROVED: "approved",
  REJECTED: "rejected",
  PAID: "paid",
};

class InsurancePoolManager extends EventEmitter {
  constructor(database, assetManager) {
    super();

    this.database = database;
    this.assetManager = assetManager;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[InsurancePoolManager] 初始化保险池管理器...");

    try {
      await this._initializeTables();
      this.initialized = true;
      logger.info("[InsurancePoolManager] 保险池管理器初始化成功");
    } catch (error) {
      logger.error("[InsurancePoolManager] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) return;

    db.exec(`
      CREATE TABLE IF NOT EXISTS insurance_pools (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        coverage_type TEXT NOT NULL,
        premium_rate REAL NOT NULL,
        max_coverage REAL NOT NULL,
        total_staked REAL DEFAULT 0,
        participant_count INTEGER DEFAULT 0,
        claims_paid REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS insurance_stakes (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        amount REAL NOT NULL,
        lock_until INTEGER,
        joined_at INTEGER DEFAULT (strftime('%s','now')),
        status TEXT DEFAULT 'active',
        FOREIGN KEY (pool_id) REFERENCES insurance_pools(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS insurance_claims (
        id TEXT PRIMARY KEY,
        pool_id TEXT NOT NULL,
        claimant TEXT NOT NULL,
        amount REAL NOT NULL,
        evidence TEXT,
        votes_for INTEGER DEFAULT 0,
        votes_against INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        resolved_at INTEGER,
        FOREIGN KEY (pool_id) REFERENCES insurance_pools(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS insurance_votes (
        id TEXT PRIMARY KEY,
        claim_id TEXT NOT NULL,
        voter_id TEXT NOT NULL,
        approve INTEGER NOT NULL,
        voted_at INTEGER DEFAULT (strftime('%s','now')),
        UNIQUE(claim_id, voter_id),
        FOREIGN KEY (claim_id) REFERENCES insurance_claims(id)
      )
    `);
  }

  async createPool(params) {
    const { name, coverageType, premiumRate, maxCoverage } = params;

    if (!name || !coverageType || premiumRate == null || !maxCoverage) {
      throw new Error(
        "Missing required fields: name, coverageType, premiumRate, maxCoverage",
      );
    }

    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO insurance_pools (id, name, coverage_type, premium_rate, max_coverage, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(id, name, coverageType, premiumRate, maxCoverage, now, now);

    this.emit("pool-created", { id, name, coverageType });
    logger.info(`[InsurancePoolManager] 保险池创建成功: ${id}`);

    return this.getPool(id);
  }

  async joinPool(poolId, userId, contribution) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const pool = this.getPool(poolId);
    if (!pool) throw new Error("Insurance pool not found");
    if (pool.status !== InsurancePoolStatus.ACTIVE)
      throw new Error("Pool is not active");
    if (contribution <= 0) throw new Error("Contribution must be positive");

    const existing = db
      .prepare(
        "SELECT id FROM insurance_stakes WHERE pool_id = ? AND user_id = ? AND status = 'active'",
      )
      .get(poolId, userId);
    if (existing) throw new Error("Already staked in this pool");

    const stakeId = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const lockUntil = now + 30 * 86400;

    db.prepare(
      `INSERT INTO insurance_stakes (id, pool_id, user_id, amount, lock_until, joined_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    ).run(stakeId, poolId, userId, contribution, lockUntil, now);

    db.prepare(
      "UPDATE insurance_pools SET total_staked = total_staked + ?, participant_count = participant_count + 1, updated_at = ? WHERE id = ?",
    ).run(contribution, now, poolId);

    this.emit("stake-added", {
      poolId,
      userId,
      stakeId,
      amount: contribution,
    });
    return { stakeId, poolId, userId, amount: contribution, lockUntil };
  }

  async leavePool(poolId, userId) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const stake = db
      .prepare(
        "SELECT * FROM insurance_stakes WHERE pool_id = ? AND user_id = ? AND status = 'active'",
      )
      .get(poolId, userId);

    if (!stake) throw new Error("No active stake found");

    const now = Math.floor(Date.now() / 1000);
    if (stake.lock_until && now < stake.lock_until) {
      throw new Error("Stake is still locked");
    }

    db.prepare(
      "UPDATE insurance_stakes SET status = 'withdrawn' WHERE id = ?",
    ).run(stake.id);

    db.prepare(
      "UPDATE insurance_pools SET total_staked = MAX(0, total_staked - ?), participant_count = MAX(0, participant_count - 1), updated_at = ? WHERE id = ?",
    ).run(stake.amount, now, poolId);

    this.emit("stake-withdrawn", { poolId, userId, amount: stake.amount });
    return { poolId, userId, amount: stake.amount, status: "withdrawn" };
  }

  async submitClaim(params) {
    const { poolId, claimant, amount, evidence } = params;

    if (!poolId || !claimant || !amount) {
      throw new Error("Missing required fields: poolId, claimant, amount");
    }

    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const pool = this.getPool(poolId);
    if (!pool) throw new Error("Insurance pool not found");
    if (amount > pool.max_coverage)
      throw new Error("Claim exceeds maximum coverage");
    if (amount > pool.total_staked)
      throw new Error("Insufficient pool funds");

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO insurance_claims (id, pool_id, claimant, amount, evidence, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'voting', ?)`,
    ).run(id, poolId, claimant, amount, evidence || null, now);

    this.emit("claim-submitted", { id, poolId, claimant, amount });
    logger.info(`[InsurancePoolManager] 理赔申请提交: ${id}`);

    return { id, poolId, claimant, amount, status: ClaimStatus.VOTING };
  }

  async voteClaim(claimId, voterId, approve) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const claim = db
      .prepare("SELECT * FROM insurance_claims WHERE id = ?")
      .get(claimId);
    if (!claim) throw new Error("Claim not found");
    if (claim.status !== ClaimStatus.VOTING)
      throw new Error("Claim is not in voting phase");
    if (claim.claimant === voterId)
      throw new Error("Claimant cannot vote on own claim");

    const stake = db
      .prepare(
        "SELECT id FROM insurance_stakes WHERE pool_id = ? AND user_id = ? AND status = 'active'",
      )
      .get(claim.pool_id, voterId);
    if (!stake) throw new Error("Only pool participants can vote");

    const voteId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    try {
      db.prepare(
        `INSERT INTO insurance_votes (id, claim_id, voter_id, approve, voted_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(voteId, claimId, voterId, approve ? 1 : 0, now);
    } catch (err) {
      if (err.message.includes("UNIQUE")) {
        throw new Error("Already voted on this claim");
      }
      throw err;
    }

    const field = approve ? "votes_for" : "votes_against";
    db.prepare(
      `UPDATE insurance_claims SET ${field} = ${field} + 1 WHERE id = ?`,
    ).run(claimId);

    this.emit("claim-voted", { claimId, voterId, approve });
    return { claimId, voterId, approve, voteId };
  }

  async resolveClaim(claimId) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const claim = db
      .prepare("SELECT * FROM insurance_claims WHERE id = ?")
      .get(claimId);
    if (!claim) throw new Error("Claim not found");
    if (claim.status !== ClaimStatus.VOTING)
      throw new Error("Claim is not in voting phase");

    const now = Math.floor(Date.now() / 1000);
    const approved = claim.votes_for > claim.votes_against;
    const newStatus = approved ? ClaimStatus.APPROVED : ClaimStatus.REJECTED;

    db.prepare(
      "UPDATE insurance_claims SET status = ?, resolved_at = ? WHERE id = ?",
    ).run(newStatus, now, claimId);

    if (approved) {
      db.prepare(
        "UPDATE insurance_pools SET total_staked = MAX(0, total_staked - ?), claims_paid = claims_paid + ?, updated_at = ? WHERE id = ?",
      ).run(claim.amount, claim.amount, now, claim.pool_id);

      db.prepare(
        "UPDATE insurance_claims SET status = 'paid' WHERE id = ?",
      ).run(claimId);
    }

    this.emit("claim-resolved", {
      claimId,
      approved,
      amount: approved ? claim.amount : 0,
    });
    logger.info(
      `[InsurancePoolManager] 理赔裁决: ${claimId} → ${approved ? "paid" : "rejected"}`,
    );

    return {
      claimId,
      status: approved ? ClaimStatus.PAID : ClaimStatus.REJECTED,
      amount: claim.amount,
    };
  }

  getPool(poolId) {
    const db = this.database?.db;
    if (!db) return null;

    const pool = db
      .prepare("SELECT * FROM insurance_pools WHERE id = ?")
      .get(poolId);
    if (!pool) return null;

    const participants = db
      .prepare(
        "SELECT COUNT(*) as count FROM insurance_stakes WHERE pool_id = ? AND status = 'active'",
      )
      .get(poolId);

    return { ...pool, actual_participants: participants?.count || 0 };
  }

  async listPools(filters = {}) {
    const db = this.database?.db;
    if (!db) return { pools: [], total: 0 };

    const { status, limit = 20, offset = 0 } = filters;
    let query = "SELECT * FROM insurance_pools";
    let countQuery = "SELECT COUNT(*) as total FROM insurance_pools";
    const params = [];

    if (status) {
      query += " WHERE status = ?";
      countQuery += " WHERE status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const pools = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { pools, total };
  }

  async listClaims(poolId, { status, limit = 20, offset = 0 } = {}) {
    const db = this.database?.db;
    if (!db) return { claims: [], total: 0 };

    let query = "SELECT * FROM insurance_claims WHERE pool_id = ?";
    let countQuery =
      "SELECT COUNT(*) as total FROM insurance_claims WHERE pool_id = ?";
    const params = [poolId];

    if (status) {
      query += " AND status = ?";
      countQuery += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const claims = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { claims, total };
  }

  async getPoolYield(poolId) {
    const pool = this.getPool(poolId);
    if (!pool) return null;

    return {
      totalStaked: pool.total_staked,
      claimsPaid: pool.claims_paid,
      premiumRate: pool.premium_rate,
      netValue: pool.total_staked - pool.claims_paid,
      yieldRate:
        pool.total_staked > 0
          ? (pool.premium_rate * pool.total_staked - pool.claims_paid) /
            pool.total_staked
          : 0,
    };
  }
}

module.exports = { InsurancePoolManager, InsurancePoolStatus, ClaimStatus };
