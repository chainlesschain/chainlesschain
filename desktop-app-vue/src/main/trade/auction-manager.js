/**
 * Auction Manager - 拍卖管理器
 *
 * 支持英式拍卖、一口价购买等拍卖模式
 * 集成托管系统确保资金安全
 *
 * @module trade/auction-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * 拍卖类型
 */
const AuctionType = {
  ENGLISH: "english",
  DUTCH: "dutch",
  SEALED_BID: "sealed_bid",
};

/**
 * 拍卖状态
 */
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
}

module.exports = { AuctionManager, AuctionType, AuctionStatus };
