/**
 * 托管管理器
 *
 * 负责交易托管的管理，包括：
 * - 创建托管
 * - 锁定资金
 * - 释放资金
 * - 退款处理
 * - 争议处理
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 托管状态
 */
const EscrowStatus = {
  CREATED: 'created',     // 已创建
  LOCKED: 'locked',       // 已锁定
  RELEASED: 'released',   // 已释放
  REFUNDED: 'refunded',   // 已退款
  DISPUTED: 'disputed',   // 有争议
  CANCELLED: 'cancelled', // 已取消
};

/**
 * 托管管理器类
 */
class EscrowManager extends EventEmitter {
  constructor(database, didManager, assetManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.assetManager = assetManager;

    this.initialized = false;
  }

  /**
   * 初始化托管管理器
   */
  async initialize() {
    logger.info('[EscrowManager] 初始化托管管理器...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      this.initialized = true;
      logger.info('[EscrowManager] 托管管理器初始化成功');
    } catch (error) {
      logger.error('[EscrowManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 托管表
    db.exec(`
      CREATE TABLE IF NOT EXISTS escrows (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL,
        buyer_did TEXT NOT NULL,
        seller_did TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'created',
        created_at INTEGER NOT NULL,
        locked_at INTEGER,
        released_at INTEGER,
        refunded_at INTEGER,
        metadata TEXT
      )
    `);

    // 托管历史表（记录状态变更）
    db.exec(`
      CREATE TABLE IF NOT EXISTS escrow_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        escrow_id TEXT NOT NULL,
        from_status TEXT NOT NULL,
        to_status TEXT NOT NULL,
        operated_by TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_escrows_transaction ON escrows(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_escrows_buyer ON escrows(buyer_did);
      CREATE INDEX IF NOT EXISTS idx_escrows_seller ON escrows(seller_did);
      CREATE INDEX IF NOT EXISTS idx_escrows_status ON escrows(status);
      CREATE INDEX IF NOT EXISTS idx_escrow_history_escrow ON escrow_history(escrow_id);
    `);

    logger.info('[EscrowManager] 数据库表初始化完成');
  }

  /**
   * 创建托管
   * @param {Object} options - 托管选项
   */
  async createEscrow({
    transactionId,
    buyerDid,
    sellerDid,
    assetId,
    amount,
    metadata = {},
  }) {
    try {
      if (!transactionId) {
        throw new Error('交易 ID 不能为空');
      }

      if (!buyerDid || !sellerDid) {
        throw new Error('买家和卖家 DID 不能为空');
      }

      if (!assetId) {
        throw new Error('资产 ID 不能为空');
      }

      if (amount <= 0) {
        throw new Error('托管金额必须大于 0');
      }

      // 检查买家余额
      const balance = await this.assetManager.getBalance(buyerDid, assetId);
      if (balance < amount) {
        throw new Error('买家余额不足');
      }

      const escrowId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // 创建托管记录
      db.prepare(`
        INSERT INTO escrows
        (id, transaction_id, buyer_did, seller_did, asset_id, amount, status, created_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        escrowId,
        transactionId,
        buyerDid,
        sellerDid,
        assetId,
        amount,
        EscrowStatus.CREATED,
        now,
        JSON.stringify(metadata)
      );

      // 自动锁定资金
      await this.lockEscrow(escrowId);

      const escrow = {
        id: escrowId,
        transaction_id: transactionId,
        buyer_did: buyerDid,
        seller_did: sellerDid,
        asset_id: assetId,
        amount,
        status: EscrowStatus.LOCKED,
        created_at: now,
        metadata,
      };

      logger.info('[EscrowManager] 已创建托管:', escrowId);

      this.emit('escrow:created', { escrow });

      return escrow;
    } catch (error) {
      logger.error('[EscrowManager] 创建托管失败:', error);
      throw error;
    }
  }

  /**
   * 锁定托管资金
   * @param {string} escrowId - 托管 ID
   */
  async lockEscrow(escrowId) {
    try {
      const db = this.database.db;

      // 查询托管
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId);

      if (!escrow) {
        throw new Error('托管不存在');
      }

      if (escrow.status !== EscrowStatus.CREATED) {
        throw new Error('托管状态不正确，无法锁定');
      }

      // 检查买家余额
      const balance = await this.assetManager.getBalance(escrow.buyer_did, escrow.asset_id);
      if (balance < escrow.amount) {
        throw new Error('买家余额不足');
      }

      // 从买家账户扣除资金（转到系统托管账户）
      await this.assetManager.transferAsset(
        escrow.asset_id,
        'ESCROW_SYSTEM', // 系统托管账户
        escrow.amount,
        `托管 ${escrowId} - 锁定资金`
      );

      const now = Date.now();

      // 更新托管状态
      db.prepare('UPDATE escrows SET status = ?, locked_at = ? WHERE id = ?')
        .run(EscrowStatus.LOCKED, now, escrowId);

      // 记录历史
      this.recordHistory(escrowId, EscrowStatus.CREATED, EscrowStatus.LOCKED, escrow.buyer_did, '资金已锁定');

      logger.info('[EscrowManager] 托管资金已锁定:', escrowId);

      this.emit('escrow:locked', { escrowId });

      return { success: true };
    } catch (error) {
      logger.error('[EscrowManager] 锁定托管资金失败:', error);
      throw error;
    }
  }

  /**
   * 释放托管资金给卖家
   * @param {string} escrowId - 托管 ID
   * @param {string} recipientDid - 接收者 DID（通常是卖家）
   */
  async releaseEscrow(escrowId, recipientDid) {
    try {
      const db = this.database.db;

      // 查询托管
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId);

      if (!escrow) {
        throw new Error('托管不存在');
      }

      if (escrow.status !== EscrowStatus.LOCKED) {
        throw new Error('托管状态不正确，无法释放');
      }

      if (recipientDid !== escrow.seller_did) {
        throw new Error('只能释放给卖家');
      }

      // 从系统托管账户转账给卖家
      await this.assetManager.transferAsset(
        escrow.asset_id,
        escrow.seller_did,
        escrow.amount,
        `托管 ${escrowId} - 释放资金`
      );

      const now = Date.now();

      // 更新托管状态
      db.prepare('UPDATE escrows SET status = ?, released_at = ? WHERE id = ?')
        .run(EscrowStatus.RELEASED, now, escrowId);

      // 记录历史
      this.recordHistory(escrowId, EscrowStatus.LOCKED, EscrowStatus.RELEASED, recipientDid, '资金已释放给卖家');

      logger.info('[EscrowManager] 托管资金已释放:', escrowId);

      this.emit('escrow:released', { escrowId, recipientDid });

      return { success: true };
    } catch (error) {
      logger.error('[EscrowManager] 释放托管资金失败:', error);
      throw error;
    }
  }

  /**
   * 退款给买家
   * @param {string} escrowId - 托管 ID
   * @param {string} reason - 退款原因
   */
  async refundEscrow(escrowId, reason = '') {
    try {
      const db = this.database.db;

      // 查询托管
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId);

      if (!escrow) {
        throw new Error('托管不存在');
      }

      if (escrow.status !== EscrowStatus.LOCKED && escrow.status !== EscrowStatus.DISPUTED) {
        throw new Error('托管状态不正确，无法退款');
      }

      // 从系统托管账户退款给买家
      await this.assetManager.transferAsset(
        escrow.asset_id,
        escrow.buyer_did,
        escrow.amount,
        `托管 ${escrowId} - 退款`
      );

      const now = Date.now();

      // 更新托管状态
      db.prepare('UPDATE escrows SET status = ?, refunded_at = ? WHERE id = ?')
        .run(EscrowStatus.REFUNDED, now, escrowId);

      // 记录历史
      this.recordHistory(escrowId, escrow.status, EscrowStatus.REFUNDED, escrow.buyer_did, reason || '资金已退款给买家');

      logger.info('[EscrowManager] 托管资金已退款:', escrowId);

      this.emit('escrow:refunded', { escrowId, reason });

      return { success: true };
    } catch (error) {
      logger.error('[EscrowManager] 退款失败:', error);
      throw error;
    }
  }

  /**
   * 标记托管为争议状态
   * @param {string} escrowId - 托管 ID
   * @param {string} reason - 争议原因
   */
  async disputeEscrow(escrowId, reason) {
    try {
      const db = this.database.db;

      // 查询托管
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId);

      if (!escrow) {
        throw new Error('托管不存在');
      }

      if (escrow.status !== EscrowStatus.LOCKED) {
        throw new Error('只能对已锁定的托管发起争议');
      }

      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      // 更新托管状态
      db.prepare('UPDATE escrows SET status = ? WHERE id = ?')
        .run(EscrowStatus.DISPUTED, escrowId);

      // 记录历史
      this.recordHistory(escrowId, EscrowStatus.LOCKED, EscrowStatus.DISPUTED, currentDid, reason);

      logger.info('[EscrowManager] 托管已标记为争议:', escrowId);

      this.emit('escrow:disputed', { escrowId, reason });

      return { success: true };
    } catch (error) {
      logger.error('[EscrowManager] 标记争议失败:', error);
      throw error;
    }
  }

  /**
   * 取消托管（仅在 CREATED 状态）
   * @param {string} escrowId - 托管 ID
   */
  async cancelEscrow(escrowId) {
    try {
      const db = this.database.db;

      // 查询托管
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId);

      if (!escrow) {
        throw new Error('托管不存在');
      }

      if (escrow.status !== EscrowStatus.CREATED) {
        throw new Error('只能取消尚未锁定的托管');
      }

      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      // 更新托管状态
      db.prepare('UPDATE escrows SET status = ? WHERE id = ?')
        .run(EscrowStatus.CANCELLED, escrowId);

      // 记录历史
      this.recordHistory(escrowId, EscrowStatus.CREATED, EscrowStatus.CANCELLED, currentDid, '托管已取消');

      logger.info('[EscrowManager] 托管已取消:', escrowId);

      this.emit('escrow:cancelled', { escrowId });

      return { success: true };
    } catch (error) {
      logger.error('[EscrowManager] 取消托管失败:', error);
      throw error;
    }
  }

  /**
   * 获取托管详情
   * @param {string} escrowId - 托管 ID
   */
  async getEscrow(escrowId) {
    try {
      const db = this.database.db;
      const escrow = db.prepare('SELECT * FROM escrows WHERE id = ?').get(escrowId);

      if (!escrow) {
        return null;
      }

      return {
        ...escrow,
        metadata: escrow.metadata ? JSON.parse(escrow.metadata) : {},
      };
    } catch (error) {
      logger.error('[EscrowManager] 获取托管详情失败:', error);
      throw error;
    }
  }

  /**
   * 获取托管列表
   * @param {Object} filters - 筛选条件
   */
  async getEscrows(filters = {}) {
    try {
      const db = this.database.db;

      let query = 'SELECT * FROM escrows WHERE 1=1';
      const params = [];

      if (filters.transactionId) {
        query += ' AND transaction_id = ?';
        params.push(filters.transactionId);
      }

      if (filters.buyerDid) {
        query += ' AND buyer_did = ?';
        params.push(filters.buyerDid);
      }

      if (filters.sellerDid) {
        query += ' AND seller_did = ?';
        params.push(filters.sellerDid);
      }

      if (filters.status) {
        query += ' AND status = ?';
        params.push(filters.status);
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const escrows = db.prepare(query).all(...params);

      return escrows.map(e => ({
        ...e,
        metadata: e.metadata ? JSON.parse(e.metadata) : {},
      }));
    } catch (error) {
      logger.error('[EscrowManager] 获取托管列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取托管历史
   * @param {string} escrowId - 托管 ID
   */
  async getEscrowHistory(escrowId) {
    try {
      const db = this.database.db;

      const history = db.prepare(`
        SELECT * FROM escrow_history
        WHERE escrow_id = ?
        ORDER BY created_at DESC
      `).all(escrowId);

      return history;
    } catch (error) {
      logger.error('[EscrowManager] 获取托管历史失败:', error);
      throw error;
    }
  }

  /**
   * 记录托管历史
   * @param {string} escrowId - 托管 ID
   * @param {string} fromStatus - 原状态
   * @param {string} toStatus - 新状态
   * @param {string} operatedBy - 操作者 DID
   * @param {string} reason - 原因
   */
  recordHistory(escrowId, fromStatus, toStatus, operatedBy, reason) {
    try {
      const db = this.database.db;
      const now = Date.now();

      db.prepare(`
        INSERT INTO escrow_history
        (escrow_id, from_status, to_status, operated_by, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(escrowId, fromStatus, toStatus, operatedBy || null, reason || null, now);
    } catch (error) {
      logger.error('[EscrowManager] 记录托管历史失败:', error);
      // 不抛出错误，避免影响主流程
    }
  }

  /**
   * 获取统计信息
   */
  async getStatistics() {
    try {
      const db = this.database.db;

      const stats = {
        total: 0,
        locked: 0,
        released: 0,
        refunded: 0,
        disputed: 0,
      };

      const rows = db.prepare('SELECT status, COUNT(*) as count FROM escrows GROUP BY status').all();

      rows.forEach(row => {
        stats.total += row.count;
        if (row.status === EscrowStatus.LOCKED) {
          stats.locked = row.count;
        } else if (row.status === EscrowStatus.RELEASED) {
          stats.released = row.count;
        } else if (row.status === EscrowStatus.REFUNDED) {
          stats.refunded = row.count;
        } else if (row.status === EscrowStatus.DISPUTED) {
          stats.disputed = row.count;
        }
      });

      return stats;
    } catch (error) {
      logger.error('[EscrowManager] 获取统计信息失败:', error);
      throw error;
    }
  }

  /**
   * 关闭托管管理器
   */
  async close() {
    logger.info('[EscrowManager] 关闭托管管理器');

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  EscrowManager,
  EscrowStatus,
};
