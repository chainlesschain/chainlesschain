/**
 * Token Ledger
 *
 * Local token accounting:
 * - Token balance management
 * - Reward calculation
 * - Reputation-weighted pricing
 * - Transaction history
 *
 * @module marketplace/token-ledger
 * @version 3.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

const TX_TYPE = {
  REWARD: "reward",
  PAYMENT: "payment",
  TRANSFER: "transfer",
  PENALTY: "penalty",
};

class TokenLedger extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._balance = 0;
    this._transactions = [];
    this._rewardMultiplier = 1.0;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }
    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS token_transactions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        balance_after REAL,
        description TEXT,
        from_did TEXT,
        to_did TEXT,
        skill_id TEXT,
        reputation_weight REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_token_tx_type ON token_transactions(type);
      CREATE INDEX IF NOT EXISTS idx_token_tx_created ON token_transactions(created_at);

      CREATE TABLE IF NOT EXISTS contributions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        contributor_did TEXT,
        resource_id TEXT,
        quality_score REAL DEFAULT 0.0,
        tokens_earned REAL DEFAULT 0.0,
        description TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_contributions_type ON contributions(type);
      CREATE INDEX IF NOT EXISTS idx_contributions_contributor ON contributions(contributor_did);
    `);
  }

  async initialize() {
    logger.info("[TokenLedger] Initializing...");
    this._ensureTables();
    if (this.database && this.database.db) {
      try {
        const txs = this.database.db
          .prepare(
            "SELECT * FROM token_transactions ORDER BY created_at DESC LIMIT 100",
          )
          .all();
        this._transactions = txs;
        // Calculate current balance from last tx
        if (txs.length > 0) {
          this._balance = txs[0].balance_after || 0;
        }
        logger.info(
          `[TokenLedger] Loaded ${txs.length} transactions, balance: ${this._balance}`,
        );
      } catch (err) {
        logger.error("[TokenLedger] Failed to load transactions:", err);
      }
    }
    this.initialized = true;
    logger.info("[TokenLedger] Initialized");
  }

  async getBalance() {
    return { balance: this._balance, currency: "CCT", updatedAt: Date.now() };
  }

  async getTransactions(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM token_transactions WHERE 1=1";
        const params = [];
        if (filter.type) {
          sql += " AND type = ?";
          params.push(filter.type);
        }
        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);
        return this.database.db.prepare(sql).all(...params);
      } catch (err) {
        logger.error("[TokenLedger] Failed to get transactions:", err);
      }
    }
    return this._transactions.slice(0, filter.limit || 50);
  }

  async submitContribution({
    type,
    contributorDid,
    resourceId,
    qualityScore,
    description,
  } = {}) {
    if (!type) {
      throw new Error("Contribution type is required");
    }
    const id = uuidv4();
    const tokensEarned = (qualityScore || 0.5) * this._rewardMultiplier * 10;
    const contribution = {
      id,
      type,
      contributor_did: contributorDid || "self",
      resource_id: resourceId || null,
      quality_score: qualityScore || 0.5,
      tokens_earned: tokensEarned,
      description: description || "",
      created_at: Date.now(),
    };
    // Add reward transaction
    this._balance += tokensEarned;
    const txId = uuidv4();
    const tx = {
      id: txId,
      type: TX_TYPE.REWARD,
      amount: tokensEarned,
      balance_after: this._balance,
      description: `Reward for ${type} contribution`,
      from_did: "system",
      to_did: contributorDid || "self",
      skill_id: resourceId,
      reputation_weight: 1.0,
      created_at: Date.now(),
    };
    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `INSERT INTO contributions (id,type,contributor_did,resource_id,quality_score,tokens_earned,description,created_at) VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          type,
          contribution.contributor_did,
          contribution.resource_id,
          contribution.quality_score,
          tokensEarned,
          contribution.description,
          contribution.created_at,
        );
      this.database.db
        .prepare(
          `INSERT INTO token_transactions (id,type,amount,balance_after,description,from_did,to_did,skill_id,reputation_weight,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          txId,
          tx.type,
          tx.amount,
          tx.balance_after,
          tx.description,
          tx.from_did,
          tx.to_did,
          tx.skill_id,
          tx.reputation_weight,
          tx.created_at,
        );
    }
    this._transactions.unshift(tx);
    this.emit("contribution-submitted", contribution);
    logger.info(
      `[TokenLedger] Contribution: ${type}, earned ${tokensEarned.toFixed(2)} CCT`,
    );
    return contribution;
  }

  async getPricing({ skillId, callerReputation } = {}) {
    const basePrice = 1.0;
    const reputationDiscount = callerReputation
      ? Math.min(callerReputation * 0.1, 0.5)
      : 0;
    return {
      skillId,
      basePrice,
      reputationDiscount,
      finalPrice: basePrice * (1 - reputationDiscount),
      currency: "CCT",
    };
  }

  async getRewardsSummary() {
    const rewards = this._transactions.filter((t) => t.type === TX_TYPE.REWARD);
    return {
      totalRewards: rewards.reduce((sum, r) => sum + r.amount, 0),
      rewardCount: rewards.length,
      currentBalance: this._balance,
      rewardMultiplier: this._rewardMultiplier,
    };
  }

  async close() {
    this.removeAllListeners();
    this._transactions = [];
    this.initialized = false;
    logger.info("[TokenLedger] Closed");
  }
}

let _instance = null;
function getTokenLedger(database) {
  if (!_instance) {
    _instance = new TokenLedger(database);
  }
  return _instance;
}

export { TokenLedger, getTokenLedger, TX_TYPE };
export default TokenLedger;
