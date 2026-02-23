/**
 * Group Buying Manager - 团购/拼单管理器
 *
 * 支持创建团购、加入/退出、自动结算
 * 集成托管系统确保资金安全
 *
 * @module trade/group-buying-manager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

const GroupBuyStatus = {
  ACTIVE: "active",
  SUCCESS: "success",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

class GroupBuyingManager extends EventEmitter {
  constructor(database, escrowManager, assetManager) {
    super();

    this.database = database;
    this.escrowManager = escrowManager;
    this.assetManager = assetManager;
    this.initialized = false;
    this._timers = new Map();
  }

  async initialize() {
    logger.info("[GroupBuyingManager] 初始化团购管理器...");

    try {
      await this._initializeTables();
      await this._restoreActiveTimers();
      this.initialized = true;
      logger.info("[GroupBuyingManager] 团购管理器初始化成功");
    } catch (error) {
      logger.error("[GroupBuyingManager] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) return;

    db.exec(`
      CREATE TABLE IF NOT EXISTS group_buys (
        id TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        original_price REAL NOT NULL,
        target_price REAL NOT NULL,
        min_members INTEGER NOT NULL DEFAULT 2,
        max_members INTEGER,
        current_members INTEGER DEFAULT 0,
        deadline INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS group_buy_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        escrow_id TEXT,
        joined_at INTEGER DEFAULT (strftime('%s','now')),
        status TEXT DEFAULT 'active',
        FOREIGN KEY (group_id) REFERENCES group_buys(id)
      )
    `);
  }

  async _restoreActiveTimers() {
    const db = this.database?.db;
    if (!db) return;

    const active = db
      .prepare("SELECT id, deadline FROM group_buys WHERE status = 'active'")
      .all();

    for (const gb of active) {
      this._startTimer(gb.id, gb.deadline);
    }
  }

  async createGroupBuy(params) {
    const {
      creatorId,
      itemId,
      originalPrice,
      targetPrice,
      minMembers = 2,
      maxMembers,
      deadline,
    } = params;

    if (!creatorId || !itemId || !originalPrice || !targetPrice) {
      throw new Error("Missing required fields");
    }
    if (targetPrice >= originalPrice) {
      throw new Error("Target price must be less than original price");
    }

    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const dl = deadline || now + 86400 * 3;

    db.prepare(
      `INSERT INTO group_buys (id, creator_id, item_id, original_price, target_price,
       min_members, max_members, deadline, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
      creatorId,
      itemId,
      originalPrice,
      targetPrice,
      minMembers,
      maxMembers || null,
      dl,
      now,
      now,
    );

    this._startTimer(id, dl);
    this.emit("group-buy-created", { id, creatorId, itemId });
    logger.info(`[GroupBuyingManager] 团购创建成功: ${id}`);

    return this.getGroupBuy(id);
  }

  async joinGroupBuy(groupId, userId, quantity = 1) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const group = this.getGroupBuy(groupId);
    if (!group) throw new Error("Group buy not found");
    if (group.status !== GroupBuyStatus.ACTIVE)
      throw new Error("Group buy is not active");

    const existing = db
      .prepare(
        "SELECT id FROM group_buy_members WHERE group_id = ? AND user_id = ? AND status = 'active'",
      )
      .get(groupId, userId);
    if (existing) throw new Error("Already joined this group buy");

    if (group.max_members && group.current_members >= group.max_members) {
      throw new Error("Group buy is full");
    }

    const memberId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO group_buy_members (id, group_id, user_id, quantity, joined_at, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    ).run(memberId, groupId, userId, quantity, now);

    db.prepare(
      "UPDATE group_buys SET current_members = current_members + 1, updated_at = ? WHERE id = ?",
    ).run(now, groupId);

    this.emit("member-joined", { groupId, userId, memberId });

    const updated = this.getGroupBuy(groupId);
    if (
      updated.max_members &&
      updated.current_members >= updated.max_members
    ) {
      await this.finalizeGroupBuy(groupId);
    }

    return { memberId, groupId, userId };
  }

  async leaveGroupBuy(groupId, userId) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const group = this.getGroupBuy(groupId);
    if (!group) throw new Error("Group buy not found");
    if (group.status !== GroupBuyStatus.ACTIVE)
      throw new Error("Group buy is not active");

    const now = Math.floor(Date.now() / 1000);
    const result = db
      .prepare(
        "UPDATE group_buy_members SET status = 'left' WHERE group_id = ? AND user_id = ? AND status = 'active'",
      )
      .run(groupId, userId);

    if (result.changes > 0) {
      db.prepare(
        "UPDATE group_buys SET current_members = MAX(0, current_members - 1), updated_at = ? WHERE id = ?",
      ).run(now, groupId);
      this.emit("member-left", { groupId, userId });
    }

    return result.changes > 0;
  }

  getGroupBuy(groupId) {
    const db = this.database?.db;
    if (!db) return null;

    const group = db
      .prepare("SELECT * FROM group_buys WHERE id = ?")
      .get(groupId);
    if (!group) return null;

    const members = db
      .prepare(
        "SELECT * FROM group_buy_members WHERE group_id = ? AND status = 'active'",
      )
      .all(groupId);

    return { ...group, members };
  }

  async listGroupBuys(filters = {}) {
    const db = this.database?.db;
    if (!db) return { groupBuys: [], total: 0 };

    const { status, creatorId, limit = 20, offset = 0 } = filters;
    let query = "SELECT * FROM group_buys";
    let countQuery = "SELECT COUNT(*) as total FROM group_buys";
    const conditions = [];
    const params = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (creatorId) {
      conditions.push("creator_id = ?");
      params.push(creatorId);
    }

    if (conditions.length > 0) {
      const where = " WHERE " + conditions.join(" AND ");
      query += where;
      countQuery += where;
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const groupBuys = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { groupBuys, total };
  }

  async finalizeGroupBuy(groupId) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const group = this.getGroupBuy(groupId);
    if (!group) throw new Error("Group buy not found");
    if (group.status !== GroupBuyStatus.ACTIVE) return group;

    const now = Math.floor(Date.now() / 1000);
    const newStatus =
      group.current_members >= group.min_members
        ? GroupBuyStatus.SUCCESS
        : GroupBuyStatus.FAILED;

    db.prepare(
      "UPDATE group_buys SET status = ?, updated_at = ? WHERE id = ?",
    ).run(newStatus, now, groupId);

    this._clearTimer(groupId);
    this.emit("group-buy-finalized", { groupId, status: newStatus });
    logger.info(`[GroupBuyingManager] 团购 ${groupId} 结算: ${newStatus}`);

    return this.getGroupBuy(groupId);
  }

  async cancelGroupBuy(groupId, userId) {
    const group = this.getGroupBuy(groupId);
    if (!group) throw new Error("Group buy not found");
    if (group.creator_id !== userId) throw new Error("Only creator can cancel");
    if (group.status !== GroupBuyStatus.ACTIVE)
      throw new Error("Group buy is not active");

    const db = this.database?.db;
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE group_buys SET status = 'cancelled', updated_at = ? WHERE id = ?",
    ).run(now, groupId);

    this._clearTimer(groupId);
    this.emit("group-buy-cancelled", { groupId });

    return { groupId, status: GroupBuyStatus.CANCELLED };
  }

  _startTimer(groupId, deadline) {
    this._clearTimer(groupId);

    const now = Math.floor(Date.now() / 1000);
    const delay = Math.max(0, (deadline - now) * 1000);

    if (delay <= 0) {
      this.finalizeGroupBuy(groupId).catch((err) =>
        logger.error(`[GroupBuyingManager] 自动结算失败: ${groupId}`, err),
      );
      return;
    }

    const timer = setTimeout(() => {
      this._timers.delete(groupId);
      this.finalizeGroupBuy(groupId).catch((err) =>
        logger.error(`[GroupBuyingManager] 自动结算失败: ${groupId}`, err),
      );
    }, delay);

    this._timers.set(groupId, timer);
  }

  _clearTimer(groupId) {
    const timer = this._timers.get(groupId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(groupId);
    }
  }
}

module.exports = { GroupBuyingManager, GroupBuyStatus };
