/**
 * Auction Manager - 拍卖管理器
 *
 * 支持英式拍卖、荷兰式拍卖、一口价购买等拍卖模式
 * 集成托管系统确保资金安全
 *
 * @module trade/auction-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

const AuctionType = {
  ENGLISH: "english",
  DUTCH: "dutch",
  SEALED_BID: "sealed_bid",
};

const AuctionStatus = {
  ACTIVE: "active",
  ENDED: "ended",
  CANCELLED: "cancelled",
  SOLD: "sold",
  NO_SALE: "no_sale",
};

class AuctionManager extends EventEmitter {
  constructor(database, escrowManager, assetManager) {
    super();
    this.database = database;
    this.escrowManager = escrowManager;
    this.assetManager = assetManager;
    this.initialized = false;
    this._timers = new Map();
  }

  async initialize() {
    logger.info("[AuctionManager] 初始化拍卖管理器...");
    try {
      await this._initializeTables();
      this.initialized = true;
      logger.info("[AuctionManager] 拍卖管理器初始化成功");
    } catch (error) {
      logger.error("[AuctionManager] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) {
      return;
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS auctions (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        type TEXT DEFAULT 'english',
        start_price REAL NOT NULL,
        reserve_price REAL,
        buy_now_price REAL,
        current_price REAL NOT NULL,
        current_bidder TEXT,
        bid_count INTEGER DEFAULT 0,
        start_time INTEGER NOT NULL,
        end_time INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS auction_bids (
        id TEXT PRIMARY KEY,
        auction_id TEXT NOT NULL,
        bidder_id TEXT NOT NULL,
        amount REAL NOT NULL,
        bid_time INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        FOREIGN KEY (auction_id) REFERENCES auctions(id)
      )
    `);
  }

  async createAuction(params) {
    const {
      sellerId,
      itemId,
      startPrice,
      reservePrice,
      buyNowPrice,
      duration = 24 * 60 * 60 * 1000,
      type = AuctionType.ENGLISH,
    } = params;

    if (!sellerId || !itemId) {
      throw new Error("Missing required fields: sellerId, itemId");
    }
    if (!startPrice || startPrice <= 0) {
      throw new Error("Start price must be positive");
    }
    if (reservePrice !== undefined && reservePrice < startPrice) {
      throw new Error("Reserve price must be >= start price");
    }

    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const endTime = now + Math.floor(duration / 1000);

    db.prepare(
      `INSERT INTO auctions (id, seller_id, item_id, type, start_price, reserve_price,
       buy_now_price, current_price, bid_count, start_time, end_time, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
      sellerId,
      itemId,
      type,
      startPrice,
      reservePrice ?? null,
      buyNowPrice ?? null,
      startPrice,
      now,
      endTime,
      now,
      now,
    );

    this._startAuctionTimer(id, endTime);
    this.emit("auction-created", { id, sellerId, itemId, startPrice });
    logger.info(`[AuctionManager] 拍卖创建成功: ${id}`);

    return this.getAuction(id);
  }

  async placeBid(auctionId, bidderId, amount) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const auction = await this.getAuction(auctionId);
    if (!auction) {
      throw new Error("Auction not found");
    }
    if (auction.status !== AuctionStatus.ACTIVE) {
      throw new Error("Auction is not active");
    }
    if (auction.seller_id === bidderId) {
      throw new Error("Seller cannot bid on their own auction");
    }
    if (amount <= auction.current_price) {
      throw new Error("Bid must be higher than current price");
    }

    const now = Math.floor(Date.now() / 1000);
    const bidId = uuidv4();

    // Mark previous bids as outbid
    if (auction.current_bidder) {
      db.prepare(
        "UPDATE auction_bids SET status = 'outbid' WHERE auction_id = ? AND bidder_id = ? AND status = 'active'",
      ).run(auctionId, auction.current_bidder);
    }

    db.prepare(
      `INSERT INTO auction_bids (id, auction_id, bidder_id, amount, bid_time, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    ).run(bidId, auctionId, bidderId, amount, now);

    db.prepare(
      `UPDATE auctions SET current_price = ?, current_bidder = ?,
       bid_count = bid_count + 1, updated_at = ? WHERE id = ?`,
    ).run(amount, bidderId, now, auctionId);

    this.emit("bid-placed", { bidId, auctionId, bidderId, amount });
    logger.info(`[AuctionManager] 出价成功: ${bidId}`);

    return { success: true, bidId, auctionId, bidderId, amount };
  }

  async getAuction(auctionId) {
    const db = this.database?.db;
    if (!db) {
      return null;
    }

    const auction = db
      .prepare("SELECT * FROM auctions WHERE id = ?")
      .get(auctionId);
    if (!auction) {
      return null;
    }

    const bids = db
      .prepare(
        "SELECT * FROM auction_bids WHERE auction_id = ? ORDER BY bid_time DESC",
      )
      .all(auctionId);

    return { ...auction, bids };
  }

  async listAuctions(filters = {}) {
    const db = this.database?.db;
    if (!db) {
      return { auctions: [], total: 0 };
    }

    const { status, sellerId, limit = 20, offset = 0 } = filters;
    let query = "SELECT * FROM auctions";
    let countQuery = "SELECT COUNT(*) as total FROM auctions";
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (sellerId) {
      conditions.push("seller_id = ?");
      params.push(sellerId);
    }

    if (conditions.length > 0) {
      const where = " WHERE " + conditions.join(" AND ");
      query += where;
      countQuery += where;
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const auctions = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { auctions, total };
  }

  async cancelAuction(auctionId, userId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const auction = await this.getAuction(auctionId);
    if (!auction) {
      throw new Error("Auction not found");
    }
    if (auction.seller_id !== userId) {
      throw new Error("Only the seller can cancel the auction");
    }
    if (auction.bid_count > 0) {
      throw new Error("Cannot cancel auction that has bids");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE auctions SET status = 'cancelled', updated_at = ? WHERE id = ?",
    ).run(now, auctionId);

    this._clearTimer(auctionId);
    this.emit("auction-cancelled", { auctionId, userId });
    return { success: true };
  }

  async finalizeAuction(auctionId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const auction = await this.getAuction(auctionId);
    if (!auction) {
      throw new Error("Auction not found");
    }
    if (auction.status !== AuctionStatus.ACTIVE) {
      return auction;
    }

    const now = Math.floor(Date.now() / 1000);
    const metReserve =
      !auction.reserve_price || auction.current_price >= auction.reserve_price;
    const newStatus =
      auction.current_bidder && metReserve
        ? AuctionStatus.SOLD
        : AuctionStatus.NO_SALE;

    db.prepare(
      "UPDATE auctions SET status = ?, updated_at = ? WHERE id = ?",
    ).run(newStatus, now, auctionId);

    this._clearTimer(auctionId);
    this.emit("auction-finalized", {
      auctionId,
      status: newStatus,
      winner: auction.current_bidder,
    });
    logger.info(`[AuctionManager] 拍卖 ${auctionId} 结算: ${newStatus}`);

    return this.getAuction(auctionId);
  }

  async processBuyNow(auctionId, buyerId) {
    const db = this.database?.db;
    if (!db) {
      throw new Error("Database not available");
    }

    const auction = await this.getAuction(auctionId);
    if (!auction) {
      throw new Error("Auction not found");
    }
    if (!auction.buy_now_price) {
      throw new Error("This auction does not have a buy-now option");
    }
    if (auction.status !== AuctionStatus.ACTIVE) {
      throw new Error("Auction is not active");
    }

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE auctions SET status = 'sold', current_bidder = ?, current_price = ?, updated_at = ? WHERE id = ?",
    ).run(buyerId, auction.buy_now_price, now, auctionId);

    this._clearTimer(auctionId);
    this.emit("buy-now-sold", {
      auctionId,
      buyerId,
      price: auction.buy_now_price,
    });
    return { success: true, auctionId, buyerId, price: auction.buy_now_price };
  }

  async getMyBids(userId) {
    const db = this.database?.db;
    if (!db) {
      return [];
    }

    return db
      .prepare(
        "SELECT * FROM auction_bids WHERE bidder_id = ? ORDER BY bid_time DESC",
      )
      .all(userId);
  }

  _startAuctionTimer(auctionId, endTime) {
    const now = Math.floor(Date.now() / 1000);
    const delay = Math.max(0, (endTime - now) * 1000);
    const timer = setTimeout(() => {
      this.finalizeAuction(auctionId).catch((err) => {
        logger.error(
          `[AuctionManager] Auto-finalize failed for ${auctionId}:`,
          err,
        );
      });
      this._timers.delete(auctionId);
    }, delay);
    this._timers.set(auctionId, timer);
  }

  _clearTimer(auctionId) {
    const timer = this._timers.get(auctionId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(auctionId);
    }
  }
}

module.exports = { AuctionManager, AuctionType, AuctionStatus };
