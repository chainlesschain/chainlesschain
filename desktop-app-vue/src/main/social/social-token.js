/**
 * Social Token Manager
 *
 * Community governance tokens for decentralized social communities.
 * Enables community creators to issue tokens for governance, rewards,
 * and incentive alignment.
 *
 * Features:
 * - Create community tokens with configurable supply and decimals
 * - Mint, transfer, and burn tokens
 * - Reward community members for contributions
 * - Query balances, transactions, and top holders
 *
 * @module social/social-token
 * @version 0.45.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

// ============================================================
// Constants
// ============================================================

const TX_TYPES = {
  MINT: "mint",
  TRANSFER: "transfer",
  BURN: "burn",
  REWARD: "reward",
};

const DEFAULT_DECIMALS = 0;
const DEFAULT_TX_LIMIT = 50;
const DEFAULT_TOP_HOLDERS_LIMIT = 10;

// ============================================================
// SocialTokenManager
// ============================================================

class SocialTokenManager extends EventEmitter {
  constructor(database) {
    super();

    this.database = database;
    this.initialized = false;
  }

  /**
   * Initialize social token manager
   */
  async initialize() {
    logger.info("[SocialToken] Initializing social token manager...");

    try {
      await this.initializeTables();

      this.initialized = true;
      logger.info("[SocialToken] Social token manager initialized successfully");
    } catch (error) {
      logger.error("[SocialToken] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const db = this.database.db;

    // Community tokens table
    db.exec(`
      CREATE TABLE IF NOT EXISTS community_tokens (
        id TEXT PRIMARY KEY,
        community_id TEXT NOT NULL UNIQUE,
        token_name TEXT NOT NULL,
        token_symbol TEXT NOT NULL,
        total_supply INTEGER NOT NULL,
        decimals INTEGER DEFAULT 0,
        creator_did TEXT NOT NULL,
        created_at INTEGER
      )
    `);

    // Token balances table
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_balances (
        id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        holder_did TEXT NOT NULL,
        balance INTEGER DEFAULT 0,
        updated_at INTEGER,
        UNIQUE(token_id, holder_did)
      )
    `);

    // Token transactions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_transactions (
        id TEXT PRIMARY KEY,
        token_id TEXT NOT NULL,
        from_did TEXT,
        to_did TEXT NOT NULL,
        amount INTEGER NOT NULL,
        tx_type TEXT CHECK(tx_type IN ('mint', 'transfer', 'burn', 'reward')),
        memo TEXT,
        created_at INTEGER
      )
    `);

    // Indexes
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_token_balances_token ON token_balances(token_id);
      CREATE INDEX IF NOT EXISTS idx_token_balances_holder ON token_balances(holder_did);
      CREATE INDEX IF NOT EXISTS idx_token_tx_token ON token_transactions(token_id);
      CREATE INDEX IF NOT EXISTS idx_token_tx_type ON token_transactions(tx_type);
    `);

    logger.info("[SocialToken] Database tables initialized");
  }

  /**
   * Create a new community token.
   *
   * @param {string} communityId - The community ID to bind the token to
   * @param {string} name - The token name
   * @param {string} symbol - The token symbol (e.g., "GOV")
   * @param {number} supply - The total supply
   * @param {Object} [options] - Additional options
   * @param {number} [options.decimals] - Number of decimal places
   * @param {string} [options.creatorDid] - The creator DID
   * @returns {Object} The created token
   */
  async createToken(communityId, name, symbol, supply, options = {}) {
    try {
      if (!communityId) {
        throw new Error("Community ID is required");
      }

      if (!name || name.trim().length === 0) {
        throw new Error("Token name is required");
      }

      if (!symbol || symbol.trim().length === 0) {
        throw new Error("Token symbol is required");
      }

      if (!supply || supply <= 0) {
        throw new Error("Total supply must be a positive integer");
      }

      const creatorDid = options.creatorDid || "system";
      const decimals = options.decimals != null ? options.decimals : DEFAULT_DECIMALS;

      const db = this.database.db;

      // Check if community already has a token
      const existing = db
        .prepare("SELECT id FROM community_tokens WHERE community_id = ?")
        .get(communityId);

      if (existing) {
        throw new Error("Community already has a token");
      }

      const tokenId = uuidv4();
      const now = Date.now();

      const stmt = db.prepare(`
        INSERT INTO community_tokens
        (id, community_id, token_name, token_symbol, total_supply, decimals, creator_did, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        tokenId,
        communityId,
        name.trim(),
        symbol.trim().toUpperCase(),
        supply,
        decimals,
        creatorDid,
        now,
      );

      // Assign initial supply to the creator
      this._setBalance(db, tokenId, creatorDid, supply, now);

      // Record mint transaction
      this._recordTransaction(db, {
        tokenId,
        fromDid: null,
        toDid: creatorDid,
        amount: supply,
        txType: TX_TYPES.MINT,
        memo: "Initial token creation",
        createdAt: now,
      });

      const token = {
        id: tokenId,
        community_id: communityId,
        token_name: name.trim(),
        token_symbol: symbol.trim().toUpperCase(),
        total_supply: supply,
        decimals,
        creator_did: creatorDid,
        created_at: now,
      };

      logger.info("[SocialToken] Created token:", tokenId, symbol);

      this.emit("token:created", { token });

      return token;
    } catch (error) {
      logger.error("[SocialToken] Failed to create token:", error);
      throw error;
    }
  }

  /**
   * Mint additional tokens to a recipient.
   *
   * @param {string} tokenId - The token ID
   * @param {string} toDid - The recipient DID
   * @param {number} amount - Amount to mint
   * @returns {Object} Transaction result
   */
  async mint(tokenId, toDid, amount) {
    try {
      this._validatePositiveAmount(amount);

      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      if (!toDid) {
        throw new Error("Recipient DID is required");
      }

      const db = this.database.db;
      const token = this._getToken(db, tokenId);
      const now = Date.now();

      // Update total supply
      db.prepare(
        "UPDATE community_tokens SET total_supply = total_supply + ? WHERE id = ?",
      ).run(amount, tokenId);

      // Update recipient balance
      const currentBalance = this._getBalanceValue(db, tokenId, toDid);
      this._setBalance(db, tokenId, toDid, currentBalance + amount, now);

      // Record transaction
      const txId = this._recordTransaction(db, {
        tokenId,
        fromDid: null,
        toDid,
        amount,
        txType: TX_TYPES.MINT,
        memo: null,
        createdAt: now,
      });

      logger.info("[SocialToken] Minted", amount, token.token_symbol, "to", toDid);

      this.emit("token:minted", { tokenId, toDid, amount });

      return { success: true, transactionId: txId };
    } catch (error) {
      logger.error("[SocialToken] Failed to mint tokens:", error);
      throw error;
    }
  }

  /**
   * Transfer tokens between users.
   *
   * @param {string} tokenId - The token ID
   * @param {string} fromDid - The sender DID
   * @param {string} toDid - The recipient DID
   * @param {number} amount - Amount to transfer
   * @returns {Object} Transaction result
   */
  async transfer(tokenId, fromDid, toDid, amount) {
    try {
      this._validatePositiveAmount(amount);

      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      if (!fromDid) {
        throw new Error("Sender DID is required");
      }

      if (!toDid) {
        throw new Error("Recipient DID is required");
      }

      if (fromDid === toDid) {
        throw new Error("Cannot transfer to yourself");
      }

      const db = this.database.db;
      const token = this._getToken(db, tokenId);
      const now = Date.now();

      // Check sender balance
      const senderBalance = this._getBalanceValue(db, tokenId, fromDid);
      if (senderBalance < amount) {
        throw new Error(
          `Insufficient balance: have ${senderBalance}, need ${amount}`,
        );
      }

      // Update balances
      this._setBalance(db, tokenId, fromDid, senderBalance - amount, now);

      const recipientBalance = this._getBalanceValue(db, tokenId, toDid);
      this._setBalance(db, tokenId, toDid, recipientBalance + amount, now);

      // Record transaction
      const txId = this._recordTransaction(db, {
        tokenId,
        fromDid,
        toDid,
        amount,
        txType: TX_TYPES.TRANSFER,
        memo: null,
        createdAt: now,
      });

      logger.info(
        "[SocialToken] Transferred",
        amount,
        token.token_symbol,
        "from",
        fromDid,
        "to",
        toDid,
      );

      this.emit("token:transferred", { tokenId, fromDid, toDid, amount });

      return { success: true, transactionId: txId };
    } catch (error) {
      logger.error("[SocialToken] Failed to transfer tokens:", error);
      throw error;
    }
  }

  /**
   * Burn tokens from a holder's balance.
   *
   * @param {string} tokenId - The token ID
   * @param {string} fromDid - The DID whose tokens to burn
   * @param {number} amount - Amount to burn
   * @returns {Object} Transaction result
   */
  async burn(tokenId, fromDid, amount) {
    try {
      this._validatePositiveAmount(amount);

      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      if (!fromDid) {
        throw new Error("Holder DID is required");
      }

      const db = this.database.db;
      const token = this._getToken(db, tokenId);
      const now = Date.now();

      // Check balance
      const balance = this._getBalanceValue(db, tokenId, fromDid);
      if (balance < amount) {
        throw new Error(
          `Insufficient balance: have ${balance}, need ${amount}`,
        );
      }

      // Update balance
      this._setBalance(db, tokenId, fromDid, balance - amount, now);

      // Update total supply
      db.prepare(
        "UPDATE community_tokens SET total_supply = total_supply - ? WHERE id = ?",
      ).run(amount, tokenId);

      // Record transaction
      const txId = this._recordTransaction(db, {
        tokenId,
        fromDid,
        toDid: "burn",
        amount,
        txType: TX_TYPES.BURN,
        memo: null,
        createdAt: now,
      });

      logger.info("[SocialToken] Burned", amount, token.token_symbol, "from", fromDid);

      this.emit("token:burned", { tokenId, fromDid, amount });

      return { success: true, transactionId: txId };
    } catch (error) {
      logger.error("[SocialToken] Failed to burn tokens:", error);
      throw error;
    }
  }

  /**
   * Get the balance of a token holder.
   *
   * @param {string} tokenId - The token ID
   * @param {string} holderDid - The holder DID
   * @returns {Object} Balance information
   */
  async getBalance(tokenId, holderDid) {
    try {
      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      if (!holderDid) {
        throw new Error("Holder DID is required");
      }

      const db = this.database.db;
      const token = this._getToken(db, tokenId);

      const balanceRow = db
        .prepare(
          "SELECT * FROM token_balances WHERE token_id = ? AND holder_did = ?",
        )
        .get(tokenId, holderDid);

      return {
        tokenId,
        holderDid,
        balance: balanceRow ? balanceRow.balance : 0,
        tokenSymbol: token.token_symbol,
        updatedAt: balanceRow ? balanceRow.updated_at : null,
      };
    } catch (error) {
      logger.error("[SocialToken] Failed to get balance:", error);
      throw error;
    }
  }

  /**
   * Get transaction history for a token.
   *
   * @param {string} tokenId - The token ID
   * @param {number} [limit] - Maximum number of transactions to return
   * @returns {Array} List of transactions
   */
  async getTransactions(tokenId, limit = DEFAULT_TX_LIMIT) {
    try {
      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      const db = this.database.db;
      return db
        .prepare(
          "SELECT * FROM token_transactions WHERE token_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(tokenId, limit);
    } catch (error) {
      logger.error("[SocialToken] Failed to get transactions:", error);
      throw error;
    }
  }

  /**
   * Reward a community member with tokens.
   *
   * @param {string} tokenId - The token ID
   * @param {string} toDid - The recipient DID
   * @param {number} amount - Amount to reward
   * @param {string} [reason] - Reason for the reward
   * @returns {Object} Transaction result
   */
  async reward(tokenId, toDid, amount, reason = "") {
    try {
      this._validatePositiveAmount(amount);

      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      if (!toDid) {
        throw new Error("Recipient DID is required");
      }

      const db = this.database.db;
      const token = this._getToken(db, tokenId);
      const now = Date.now();

      // Rewards are minted from the community pool (increase supply)
      db.prepare(
        "UPDATE community_tokens SET total_supply = total_supply + ? WHERE id = ?",
      ).run(amount, tokenId);

      // Update recipient balance
      const currentBalance = this._getBalanceValue(db, tokenId, toDid);
      this._setBalance(db, tokenId, toDid, currentBalance + amount, now);

      // Record transaction
      const txId = this._recordTransaction(db, {
        tokenId,
        fromDid: "community",
        toDid,
        amount,
        txType: TX_TYPES.REWARD,
        memo: reason || null,
        createdAt: now,
      });

      logger.info(
        "[SocialToken] Rewarded",
        amount,
        token.token_symbol,
        "to",
        toDid,
        reason ? `(${reason})` : "",
      );

      this.emit("token:rewarded", { tokenId, toDid, amount, reason });

      return { success: true, transactionId: txId };
    } catch (error) {
      logger.error("[SocialToken] Failed to reward tokens:", error);
      throw error;
    }
  }

  /**
   * Get token information.
   *
   * @param {string} tokenId - The token ID
   * @returns {Object} Token information
   */
  async getTokenInfo(tokenId) {
    try {
      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      const db = this.database.db;
      const token = this._getToken(db, tokenId);

      // Get holder count
      const holderCount = db
        .prepare(
          "SELECT COUNT(*) as count FROM token_balances WHERE token_id = ? AND balance > 0",
        )
        .get(tokenId);

      // Get transaction count
      const txCount = db
        .prepare(
          "SELECT COUNT(*) as count FROM token_transactions WHERE token_id = ?",
        )
        .get(tokenId);

      return {
        ...token,
        holder_count: holderCount ? holderCount.count : 0,
        transaction_count: txCount ? txCount.count : 0,
      };
    } catch (error) {
      logger.error("[SocialToken] Failed to get token info:", error);
      throw error;
    }
  }

  /**
   * Get the top token holders by balance.
   *
   * @param {string} tokenId - The token ID
   * @param {number} [limit] - Maximum number of holders to return
   * @returns {Array} List of top holders
   */
  async getTopHolders(tokenId, limit = DEFAULT_TOP_HOLDERS_LIMIT) {
    try {
      if (!tokenId) {
        throw new Error("Token ID is required");
      }

      const db = this.database.db;

      // Verify token exists
      this._getToken(db, tokenId);

      return db
        .prepare(
          "SELECT * FROM token_balances WHERE token_id = ? AND balance > 0 ORDER BY balance DESC LIMIT ?",
        )
        .all(tokenId, limit);
    } catch (error) {
      logger.error("[SocialToken] Failed to get top holders:", error);
      throw error;
    }
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /**
   * Get a token by ID, throwing if not found.
   * @private
   */
  _getToken(db, tokenId) {
    const token = db
      .prepare("SELECT * FROM community_tokens WHERE id = ?")
      .get(tokenId);

    if (!token) {
      throw new Error("Token not found");
    }

    return token;
  }

  /**
   * Get the raw balance value for a holder.
   * @private
   */
  _getBalanceValue(db, tokenId, holderDid) {
    const row = db
      .prepare(
        "SELECT balance FROM token_balances WHERE token_id = ? AND holder_did = ?",
      )
      .get(tokenId, holderDid);

    return row ? row.balance : 0;
  }

  /**
   * Set the balance for a holder (insert or update).
   * @private
   */
  _setBalance(db, tokenId, holderDid, balance, updatedAt) {
    const existing = db
      .prepare(
        "SELECT id FROM token_balances WHERE token_id = ? AND holder_did = ?",
      )
      .get(tokenId, holderDid);

    if (existing) {
      db.prepare(
        "UPDATE token_balances SET balance = ?, updated_at = ? WHERE token_id = ? AND holder_did = ?",
      ).run(balance, updatedAt, tokenId, holderDid);
    } else {
      db.prepare(
        "INSERT INTO token_balances (id, token_id, holder_did, balance, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(uuidv4(), tokenId, holderDid, balance, updatedAt);
    }
  }

  /**
   * Record a token transaction.
   * @private
   * @returns {string} The transaction ID
   */
  _recordTransaction(db, { tokenId, fromDid, toDid, amount, txType, memo, createdAt }) {
    const txId = uuidv4();

    db.prepare(`
      INSERT INTO token_transactions
      (id, token_id, from_did, to_did, amount, tx_type, memo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(txId, tokenId, fromDid, toDid, amount, txType, memo, createdAt);

    return txId;
  }

  /**
   * Validate that an amount is a positive integer.
   * @private
   */
  _validatePositiveAmount(amount) {
    if (amount == null || amount <= 0) {
      throw new Error("Amount must be a positive number");
    }

    if (!Number.isInteger(amount)) {
      throw new Error("Amount must be an integer");
    }
  }

  /**
   * Close the social token manager
   */
  async close() {
    logger.info("[SocialToken] Closing social token manager");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  SocialTokenManager,
  TX_TYPES,
};
