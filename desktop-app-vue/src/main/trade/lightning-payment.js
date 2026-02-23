/**
 * Lightning Payment Manager - 闪电网络支付管理器
 *
 * 支持支付通道创建、闪电支付、发票管理
 * 实现链下即时微支付
 *
 * @module trade/lightning-payment
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

const ChannelStatus = {
  OPEN: "open",
  CLOSING: "closing",
  CLOSED: "closed",
  FORCE_CLOSED: "force_closed",
};

const PaymentStatus = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  EXPIRED: "expired",
};

class LightningPaymentManager extends EventEmitter {
  constructor(database, assetManager) {
    super();

    this.database = database;
    this.assetManager = assetManager;
    this.initialized = false;
  }

  async initialize() {
    logger.info("[LightningPayment] 初始化闪电网络支付管理器...");

    try {
      await this._initializeTables();
      this.initialized = true;
      logger.info("[LightningPayment] 闪电网络支付管理器初始化成功");
    } catch (error) {
      logger.error("[LightningPayment] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) return;

    db.exec(`
      CREATE TABLE IF NOT EXISTS lightning_channels (
        id TEXT PRIMARY KEY,
        user_a TEXT NOT NULL,
        user_b TEXT NOT NULL,
        capacity REAL NOT NULL,
        balance_a REAL NOT NULL,
        balance_b REAL NOT NULL,
        status TEXT DEFAULT 'open',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS lightning_payments (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        receiver TEXT NOT NULL,
        amount REAL NOT NULL,
        memo TEXT,
        invoice_id TEXT,
        status TEXT DEFAULT 'completed',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (channel_id) REFERENCES lightning_channels(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS lightning_invoices (
        id TEXT PRIMARY KEY,
        creator TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        expiry INTEGER NOT NULL,
        payment_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);
  }

  async createChannel(params) {
    const { userId, peerId, capacity, pushAmount = 0 } = params;

    if (!userId || !peerId || !capacity) {
      throw new Error("Missing required fields: userId, peerId, capacity");
    }
    if (capacity <= 0) throw new Error("Capacity must be positive");
    if (pushAmount > capacity) throw new Error("Push amount exceeds capacity");

    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `INSERT INTO lightning_channels (id, user_a, user_b, capacity, balance_a, balance_b, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, userId, peerId, capacity, capacity - pushAmount, pushAmount, now, now);

    this.emit("channel-opened", { id, userId, peerId, capacity });
    logger.info(`[LightningPayment] 通道创建成功: ${id}`);

    return this.getChannel(id);
  }

  async closeChannel(channelId) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("Channel not found");
    if (channel.status !== ChannelStatus.OPEN)
      throw new Error("Channel is not open");

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "UPDATE lightning_channels SET status = 'closed', updated_at = ? WHERE id = ?",
    ).run(now, channelId);

    this.emit("channel-closed", {
      channelId,
      finalBalanceA: channel.balance_a,
      finalBalanceB: channel.balance_b,
    });
    return this.getChannel(channelId);
  }

  async sendPayment(params) {
    const { channelId, senderId, amount, memo } = params;

    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const channel = this.getChannel(channelId);
    if (!channel) throw new Error("Channel not found");
    if (channel.status !== ChannelStatus.OPEN)
      throw new Error("Channel is not open");

    let receiver, senderField, receiverField, senderBalance;
    if (senderId === channel.user_a) {
      senderBalance = channel.balance_a;
      receiver = channel.user_b;
      senderField = "balance_a";
      receiverField = "balance_b";
    } else if (senderId === channel.user_b) {
      senderBalance = channel.balance_b;
      receiver = channel.user_a;
      senderField = "balance_b";
      receiverField = "balance_a";
    } else {
      throw new Error("Sender is not a participant in this channel");
    }

    if (amount > senderBalance) {
      throw new Error("Insufficient channel balance");
    }

    const paymentId = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    db.prepare(
      `UPDATE lightning_channels SET ${senderField} = ${senderField} - ?,
       ${receiverField} = ${receiverField} + ?, updated_at = ? WHERE id = ?`,
    ).run(amount, amount, now, channelId);

    db.prepare(
      `INSERT INTO lightning_payments (id, channel_id, sender, receiver, amount, memo, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`,
    ).run(paymentId, channelId, senderId, receiver, amount, memo || null, now);

    this.emit("payment-sent", {
      paymentId,
      channelId,
      senderId,
      receiver,
      amount,
    });
    return {
      paymentId,
      channelId,
      senderId,
      receiver,
      amount,
      status: PaymentStatus.COMPLETED,
    };
  }

  async createInvoice(params) {
    const { creatorId, amount, description, expiry = 3600 } = params;

    if (!creatorId || !amount) {
      throw new Error("Missing required fields: creatorId, amount");
    }

    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);
    const expiryTime = now + expiry;

    db.prepare(
      `INSERT INTO lightning_invoices (id, creator, amount, description, expiry, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    ).run(id, creatorId, amount, description || null, expiryTime, now);

    this.emit("invoice-created", { id, creatorId, amount });
    return {
      id,
      creatorId,
      amount,
      description,
      expiry: expiryTime,
      status: PaymentStatus.PENDING,
    };
  }

  async payInvoice(invoiceId, payerId, channelId) {
    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const invoice = db
      .prepare("SELECT * FROM lightning_invoices WHERE id = ?")
      .get(invoiceId);
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "pending") throw new Error("Invoice already processed");

    const now = Math.floor(Date.now() / 1000);
    if (now > invoice.expiry) {
      db.prepare(
        "UPDATE lightning_invoices SET status = 'expired' WHERE id = ?",
      ).run(invoiceId);
      throw new Error("Invoice expired");
    }

    const payment = await this.sendPayment({
      channelId,
      senderId: payerId,
      amount: invoice.amount,
      memo: `Invoice: ${invoice.description || invoiceId}`,
    });

    db.prepare(
      "UPDATE lightning_invoices SET status = 'paid', payment_id = ? WHERE id = ?",
    ).run(payment.paymentId, invoiceId);

    this.emit("invoice-paid", { invoiceId, paymentId: payment.paymentId });
    return { invoiceId, ...payment };
  }

  getChannel(channelId) {
    const db = this.database?.db;
    if (!db) return null;
    return db
      .prepare("SELECT * FROM lightning_channels WHERE id = ?")
      .get(channelId);
  }

  async getChannelBalance(channelId) {
    const channel = this.getChannel(channelId);
    if (!channel) return null;
    return {
      capacity: channel.capacity,
      balanceA: channel.balance_a,
      balanceB: channel.balance_b,
    };
  }

  async listChannels(userId, { status, limit = 20, offset = 0 } = {}) {
    const db = this.database?.db;
    if (!db) return { channels: [], total: 0 };

    let query =
      "SELECT * FROM lightning_channels WHERE (user_a = ? OR user_b = ?)";
    let countQuery =
      "SELECT COUNT(*) as total FROM lightning_channels WHERE (user_a = ? OR user_b = ?)";
    const params = [userId, userId];

    if (status) {
      query += " AND status = ?";
      countQuery += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const channels = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return { channels, total };
  }

  async listPayments(userId, filters = {}) {
    const db = this.database?.db;
    if (!db) return { payments: [], total: 0 };

    const { limit = 20, offset = 0 } = filters;

    const payments = db
      .prepare(
        `SELECT * FROM lightning_payments WHERE sender = ? OR receiver = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(userId, userId, limit, offset);

    const { total } = db
      .prepare(
        "SELECT COUNT(*) as total FROM lightning_payments WHERE sender = ? OR receiver = ?",
      )
      .get(userId, userId);

    return { payments, total };
  }

  async routePayment(params) {
    const { senderId, receiverId, amount } = params;

    const db = this.database?.db;
    if (!db) throw new Error("Database not available");

    const directChannel = db
      .prepare(
        `SELECT * FROM lightning_channels
         WHERE ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))
         AND status = 'open'`,
      )
      .get(senderId, receiverId, receiverId, senderId);

    if (directChannel) {
      return this.sendPayment({
        channelId: directChannel.id,
        senderId,
        amount,
        memo: `Routed payment to ${receiverId}`,
      });
    }

    throw new Error("No route found to recipient");
  }
}

module.exports = { LightningPaymentManager, ChannelStatus, PaymentStatus };
