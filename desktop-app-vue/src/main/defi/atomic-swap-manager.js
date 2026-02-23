/**
 * Atomic Swap Manager - 跨链原子互换管理器
 *
 * 使用HTLC（哈希时间锁合约）实现跨链原子互换
 * 支持互换发起、接受、索取、退款
 *
 * @module defi/atomic-swap-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");

const SwapStatus = {
  INITIATED: "initiated",
  ACCEPTED: "accepted",
  CLAIMED: "claimed",
  REFUNDED: "refunded",
  EXPIRED: "expired",
};

class AtomicSwapManager extends EventEmitter {
  constructor(database, bridgeManager) {
    super();

    this.database = database;
    this.bridgeManager = bridgeManager;
    this.initialized = false;
    this.defaultTimelock = 86400;
  }

  async initialize() {
    logger.info("[AtomicSwapManager] 初始化跨链原子互换管理器...");

    try {
      await this._initializeTables();
      this.initialized = true;
      logger.info("[AtomicSwapManager] 跨链原子互换管理器初始化成功");
    } catch (error) {
      logger.error("[AtomicSwapManager] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) {
      return;
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS atomic_swaps (
        id TEXT PRIMARY KEY,
        initiator TEXT NOT NULL,
        counterparty TEXT NOT NULL,
        send_asset TEXT NOT NULL,
        send_amount REAL NOT NULL,
        receive_asset TEXT NOT NULL,
        receive_amount REAL NOT NULL,
        hash_lock TEXT NOT NULL,
        secret TEXT,
        timelock INTEGER NOT NULL,
        status TEXT DEFAULT 'initiated',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);
  }

  async initiateSwap(params) {
    const {
      initiator,
      counterparty,
      sendAsset,
      sendAmount,
      receiveAsset,
      receiveAmount,
      timelock,
    } = params;

    if (
      !initiator ||
      !counterparty ||
      !sendAsset ||
      !sendAmount ||
      !receiveAsset ||
      !receiveAmount
    ) {
      throw new Error("Missing required fields");
    }
    if (initiator === counterparty) {
      throw new Error("Cannot swap with self");
    }
    if (sendAsset === receiveAsset) {
      throw new Error("Cannot swap same assets");
    }

    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const secret = crypto.randomBytes(32).toString("hex");
    const hashLock = this._generateHTLC(secret);

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const timelockValue = now + (timelock || this.defaultTimelock);

    db.prepare(
      `INSERT INTO atomic_swaps (id, initiator, counterparty, send_asset, send_amount,
       receive_asset, receive_amount, hash_lock, secret, timelock, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?)`,
    ).run(
      id,
      initiator,
      counterparty,
      sendAsset,
      sendAmount,
      receiveAsset,
      receiveAmount,
      hashLock,
      secret,
      timelockValue,
      now,
      now,
    );

    this.emit("swap-initiated", {
      id,
      initiator,
      counterparty,
      sendAsset,
      receiveAsset,
    });
    logger.info(`[AtomicSwapManager] 互换发起: ${id}`);

    return {
      id,
      initiator,
      counterparty,
      sendAsset,
      sendAmount,
      receiveAsset,
      receiveAmount,
      hashLock,
      timelock: timelockValue,
      status: SwapStatus.INITIATED,
    };
  }

  async acceptSwap(swapId, counterpartyId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const swap = this.getSwap(swapId);
    if (!swap) {
      throw new Error("Swap not found");
    }
    if (swap.status !== SwapStatus.INITIATED) {
      throw new Error("Swap is not in initiated state");
    }
    if (swap.counterparty !== counterpartyId) {
      throw new Error("Only designated counterparty can accept");
    }

    if (!this._checkTimelock(swap)) {
      throw new Error("Swap has expired");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE atomic_swaps SET status = 'accepted', updated_at = ? WHERE id = ?",
    ).run(now, swapId);

    this.emit("swap-accepted", { swapId, counterpartyId });
    return this.getSwap(swapId);
  }

  async claimSwap(swapId, secret) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const swap = db
      .prepare("SELECT * FROM atomic_swaps WHERE id = ?")
      .get(swapId);
    if (!swap) {
      throw new Error("Swap not found");
    }
    if (swap.status !== SwapStatus.ACCEPTED) {
      throw new Error("Swap is not accepted");
    }

    if (!this._checkTimelock(swap)) {
      throw new Error("Swap has expired");
    }

    const hashLock = this._generateHTLC(secret);
    if (hashLock !== swap.hash_lock) {
      throw new Error("Invalid secret");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE atomic_swaps SET status = 'claimed', updated_at = ? WHERE id = ?",
    ).run(now, swapId);

    this.emit("swap-claimed", { swapId });
    logger.info(`[AtomicSwapManager] 互换完成: ${swapId}`);

    return this.getSwap(swapId);
  }

  async refundSwap(swapId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const swap = db
      .prepare("SELECT * FROM atomic_swaps WHERE id = ?")
      .get(swapId);
    if (!swap) {
      throw new Error("Swap not found");
    }
    if (swap.status === SwapStatus.CLAIMED) {
      throw new Error("Swap already claimed");
    }
    if (swap.status === SwapStatus.REFUNDED) {
      throw new Error("Swap already refunded");
    }

    if (this._checkTimelock(swap)) {
      throw new Error("Swap has not expired yet");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE atomic_swaps SET status = 'refunded', updated_at = ? WHERE id = ?",
    ).run(now, swapId);

    this.emit("swap-refunded", { swapId });
    return this.getSwap(swapId);
  }

  getSwap(swapId) {
    const db = this.database?.db;
    if (!db) {
      return null;
    }

    const swap = db
      .prepare("SELECT * FROM atomic_swaps WHERE id = ?")
      .get(swapId);
    if (!swap) {
      return null;
    }

    return { ...swap, secret: undefined };
  }

  async listSwaps(userId, filters = {}) {
    const db = this.database?.db;
    if (!db) {
      return { swaps: [], total: 0 };
    }

    const { status, limit = 20, offset = 0 } = filters;

    let query =
      "SELECT * FROM atomic_swaps WHERE (initiator = ? OR counterparty = ?)";
    let countQuery =
      "SELECT COUNT(*) as total FROM atomic_swaps WHERE (initiator = ? OR counterparty = ?)";
    const params = [userId, userId];

    if (status) {
      query += " AND status = ?";
      countQuery += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const swaps = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    const sanitized = swaps.map((s) => ({ ...s, secret: undefined }));

    return { swaps: sanitized, total };
  }

  async matchSwapOrder(params) {
    const { sendAsset, receiveAsset, amount } = params;

    const db = this.database?.db;
    if (!db) {
      return [];
    }

    const matches = db
      .prepare(
        `SELECT * FROM atomic_swaps
         WHERE send_asset = ? AND receive_asset = ? AND status = 'initiated'
         AND send_amount >= ? ORDER BY send_amount ASC LIMIT 5`,
      )
      .all(receiveAsset, sendAsset, amount);

    return matches.map((s) => ({
      id: s.id,
      sendAsset: s.send_asset,
      sendAmount: s.send_amount,
      receiveAsset: s.receive_asset,
      receiveAmount: s.receive_amount,
    }));
  }

  async getSwapRates() {
    const db = this.database?.db;
    if (!db) {
      return {};
    }

    const recentSwaps = db
      .prepare(
        "SELECT send_asset, receive_asset, send_amount, receive_amount FROM atomic_swaps WHERE status = 'claimed' ORDER BY updated_at DESC LIMIT 50",
      )
      .all();

    const rates = {};
    for (const swap of recentSwaps) {
      const pair = `${swap.send_asset}/${swap.receive_asset}`;
      if (!rates[pair]) {
        rates[pair] = {
          pair,
          rate: swap.receive_amount / swap.send_amount,
          volume: 0,
          trades: 0,
        };
      }
      rates[pair].volume += swap.send_amount;
      rates[pair].trades += 1;
    }

    return rates;
  }

  _generateHTLC(secret) {
    return crypto.createHash("sha256").update(secret).digest("hex");
  }

  _checkTimelock(swap) {
    const now = Math.floor(Date.now() / 1000);
    return now < swap.timelock;
  }
}

module.exports = { AtomicSwapManager, SwapStatus };
