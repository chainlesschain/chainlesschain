/**
 * 交易市场管理器
 *
 * 负责交易市场的管理，包括：
 * - 订单创建和管理
 * - 交易匹配
 * - 交易流程管理
 * - 托管集成
 */

const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * 订单类型
 */
const OrderType = {
  BUY: "buy", // 购买
  SELL: "sell", // 出售
  SERVICE: "service", // 服务
  BARTER: "barter", // 以物换物
};

/**
 * 订单状态
 */
const OrderStatus = {
  OPEN: "open", // 开放
  MATCHED: "matched", // 已匹配
  ESCROW: "escrow", // 托管中
  COMPLETED: "completed", // 已完成
  CANCELLED: "cancelled", // 已取消
  DISPUTED: "disputed", // 有争议
};

/**
 * 交易状态
 */
const TransactionStatus = {
  PENDING: "pending", // 待处理
  ESCROWED: "escrowed", // 已托管
  DELIVERED: "delivered", // 已交付
  COMPLETED: "completed", // 已完成
  REFUNDED: "refunded", // 已退款
  DISPUTED: "disputed", // 有争议
};

/**
 * 交易市场管理器类
 */
class MarketplaceManager extends EventEmitter {
  constructor(database, didManager, assetManager, escrowManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.assetManager = assetManager;
    this.escrowManager = escrowManager;

    this.initialized = false;
  }

  /**
   * 初始化交易市场管理器
   */
  async initialize() {
    console.log("[MarketplaceManager] 初始化交易市场管理器...");

    try {
      // 初始化数据库表
      await this.initializeTables();

      this.initialized = true;
      console.log("[MarketplaceManager] 交易市场管理器初始化成功");
    } catch (error) {
      console.error("[MarketplaceManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 订单表
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        order_type TEXT NOT NULL,
        creator_did TEXT NOT NULL,
        asset_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        price_asset_id TEXT,
        price_amount INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // 交易表
    db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        buyer_did TEXT NOT NULL,
        seller_did TEXT NOT NULL,
        asset_id TEXT,
        payment_asset_id TEXT NOT NULL,
        payment_amount INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        escrow_id TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    // 创建基础索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_creator ON orders(creator_did);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(order_type);
      CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions(order_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_buyer ON transactions(buyer_did);
      CREATE INDEX IF NOT EXISTS idx_transactions_seller ON transactions(seller_did);
    `);

    // 创建高级索引用于搜索优化
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_price ON orders(price_amount);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_orders_composite ON orders(status, order_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    `);

    // 创建 FTS5 全文搜索虚拟表
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS orders_fts USING fts5(
          id,
          title,
          description,
          content='orders',
          content_rowid='rowid'
        )
      `);

      // 创建触发器保持 FTS 索引同步
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS orders_fts_insert AFTER INSERT ON orders BEGIN
          INSERT INTO orders_fts(rowid, id, title, description)
          VALUES (NEW.rowid, NEW.id, NEW.title, NEW.description);
        END
      `);

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS orders_fts_delete AFTER DELETE ON orders BEGIN
          INSERT INTO orders_fts(orders_fts, rowid, id, title, description)
          VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.description);
        END
      `);

      db.exec(`
        CREATE TRIGGER IF NOT EXISTS orders_fts_update AFTER UPDATE ON orders BEGIN
          INSERT INTO orders_fts(orders_fts, rowid, id, title, description)
          VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.description);
          INSERT INTO orders_fts(rowid, id, title, description)
          VALUES (NEW.rowid, NEW.id, NEW.title, NEW.description);
        END
      `);

      // 重建 FTS 索引（如果表已存在但没有数据）
      const ftsCount = db
        .prepare("SELECT COUNT(*) as count FROM orders_fts")
        .get();
      const ordersCount = db
        .prepare("SELECT COUNT(*) as count FROM orders")
        .get();
      if (ftsCount.count === 0 && ordersCount.count > 0) {
        db.exec(`INSERT INTO orders_fts(orders_fts) VALUES('rebuild')`);
      }

      console.log("[MarketplaceManager] FTS5 全文搜索已启用");
    } catch (ftsError) {
      console.warn(
        "[MarketplaceManager] FTS5 不可用，将使用 LIKE 搜索:",
        ftsError.message,
      );
      this.ftsAvailable = false;
    }

    console.log("[MarketplaceManager] 数据库表初始化完成");
  }

  /**
   * 创建订单
   * @param {Object} options - 订单选项
   */
  async createOrder({
    type,
    assetId,
    title,
    description,
    priceAssetId,
    priceAmount,
    quantity,
    metadata = {},
  }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("未登录，无法创建订单");
      }

      if (!Object.values(OrderType).includes(type)) {
        throw new Error("无效的订单类型");
      }

      if (!title || title.trim().length === 0) {
        throw new Error("订单标题不能为空");
      }

      if (priceAmount <= 0) {
        throw new Error("价格必须大于 0");
      }

      if (quantity <= 0) {
        throw new Error("数量必须大于 0");
      }

      // 如果是出售订单，检查资产余额
      if (type === OrderType.SELL && assetId) {
        const balance = await this.assetManager.getBalance(currentDid, assetId);
        if (balance < quantity) {
          throw new Error("资产余额不足");
        }
      }

      const orderId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // 插入订单记录
      db.prepare(
        `
        INSERT INTO orders
        (id, order_type, creator_did, asset_id, title, description, price_asset_id, price_amount, quantity, status, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        orderId,
        type,
        currentDid,
        assetId || null,
        title.trim(),
        description || null,
        priceAssetId || null,
        priceAmount,
        quantity,
        OrderStatus.OPEN,
        JSON.stringify(metadata),
        now,
        now,
      );

      const order = {
        id: orderId,
        order_type: type,
        creator_did: currentDid,
        asset_id: assetId,
        title: title.trim(),
        description,
        price_asset_id: priceAssetId,
        price_amount: priceAmount,
        quantity,
        status: OrderStatus.OPEN,
        metadata,
        created_at: now,
        updated_at: now,
      };

      console.log("[MarketplaceManager] 已创建订单:", orderId);

      this.emit("order:created", { order });

      return order;
    } catch (error) {
      console.error("[MarketplaceManager] 创建订单失败:", error);
      throw error;
    }
  }

  /**
   * 取消订单
   * @param {string} orderId - 订单 ID
   */
  async cancelOrder(orderId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 查询订单
      const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId);

      if (!order) {
        throw new Error("订单不存在");
      }

      if (order.creator_did !== currentDid) {
        throw new Error("只有订单创建者才能取消订单");
      }

      if (order.status !== OrderStatus.OPEN) {
        throw new Error("只能取消开放状态的订单");
      }

      const now = Date.now();

      // 更新订单状态
      db.prepare(
        "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
      ).run(OrderStatus.CANCELLED, now, orderId);

      console.log("[MarketplaceManager] 已取消订单:", orderId);

      this.emit("order:cancelled", { orderId });

      return { success: true };
    } catch (error) {
      console.error("[MarketplaceManager] 取消订单失败:", error);
      throw error;
    }
  }

  /**
   * 获取订单列表（支持高级筛选和分页）
   * @param {Object} filters - 筛选条件
   * @param {string} [filters.type] - 订单类型
   * @param {string} [filters.status] - 订单状态
   * @param {string} [filters.creatorDid] - 创建者 DID
   * @param {string} [filters.assetId] - 资产 ID
   * @param {string} [filters.search] - 搜索关键词（全文搜索）
   * @param {number} [filters.priceMin] - 最低价格
   * @param {number} [filters.priceMax] - 最高价格
   * @param {number} [filters.createdAfter] - 创建时间起始（时间戳）
   * @param {number} [filters.createdBefore] - 创建时间结束（时间戳）
   * @param {string} [filters.sortBy='created_at'] - 排序字段
   * @param {string} [filters.sortOrder='desc'] - 排序方向
   * @param {number} [filters.page=1] - 页码（从 1 开始）
   * @param {number} [filters.pageSize=20] - 每页数量
   * @param {number} [filters.limit] - 限制数量（向后兼容）
   * @returns {Promise<Object>} 分页结果 { items, total, page, pageSize, totalPages }
   */
  async getOrders(filters = {}) {
    try {
      const db = this.database.db;

      // 分页参数
      const page = Math.max(1, parseInt(filters.page) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, parseInt(filters.pageSize) || 20),
      );
      const offset = (page - 1) * pageSize;

      // 排序参数
      const allowedSortFields = [
        "created_at",
        "price_amount",
        "quantity",
        "updated_at",
      ];
      const sortBy = allowedSortFields.includes(filters.sortBy)
        ? filters.sortBy
        : "created_at";
      const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";

      // 构建查询
      let baseQuery = "SELECT * FROM orders WHERE 1=1";
      let countQuery = "SELECT COUNT(*) as total FROM orders WHERE 1=1";
      const params = [];
      const countParams = [];

      // 搜索条件（全文搜索或 LIKE）
      if (filters.search && filters.search.trim()) {
        const searchTerm = filters.search.trim();
        if (this.ftsAvailable !== false) {
          // 使用 FTS5 全文搜索
          baseQuery = `
            SELECT orders.* FROM orders
            INNER JOIN orders_fts ON orders.id = orders_fts.id
            WHERE orders_fts MATCH ? AND 1=1
          `;
          countQuery = `
            SELECT COUNT(*) as total FROM orders
            INNER JOIN orders_fts ON orders.id = orders_fts.id
            WHERE orders_fts MATCH ? AND 1=1
          `;
          // FTS5 查询语法
          const ftsQuery = searchTerm
            .split(/\s+/)
            .map((w) => `"${w}"*`)
            .join(" OR ");
          params.push(ftsQuery);
          countParams.push(ftsQuery);
        } else {
          // 降级到 LIKE 搜索
          baseQuery += " AND (title LIKE ? OR description LIKE ?)";
          countQuery += " AND (title LIKE ? OR description LIKE ?)";
          const likePattern = `%${searchTerm}%`;
          params.push(likePattern, likePattern);
          countParams.push(likePattern, likePattern);
        }
      }

      // 类型筛选
      if (filters.type) {
        baseQuery += " AND order_type = ?";
        countQuery += " AND order_type = ?";
        params.push(filters.type);
        countParams.push(filters.type);
      }

      // 状态筛选
      if (filters.status) {
        baseQuery += " AND status = ?";
        countQuery += " AND status = ?";
        params.push(filters.status);
        countParams.push(filters.status);
      }

      // 创建者筛选
      if (filters.creatorDid) {
        baseQuery += " AND creator_did = ?";
        countQuery += " AND creator_did = ?";
        params.push(filters.creatorDid);
        countParams.push(filters.creatorDid);
      }

      // 资产筛选
      if (filters.assetId) {
        baseQuery += " AND asset_id = ?";
        countQuery += " AND asset_id = ?";
        params.push(filters.assetId);
        countParams.push(filters.assetId);
      }

      // 价格范围筛选
      if (filters.priceMin !== undefined && filters.priceMin !== null) {
        baseQuery += " AND price_amount >= ?";
        countQuery += " AND price_amount >= ?";
        params.push(filters.priceMin);
        countParams.push(filters.priceMin);
      }

      if (filters.priceMax !== undefined && filters.priceMax !== null) {
        baseQuery += " AND price_amount <= ?";
        countQuery += " AND price_amount <= ?";
        params.push(filters.priceMax);
        countParams.push(filters.priceMax);
      }

      // 时间范围筛选
      if (filters.createdAfter) {
        baseQuery += " AND created_at >= ?";
        countQuery += " AND created_at >= ?";
        params.push(filters.createdAfter);
        countParams.push(filters.createdAfter);
      }

      if (filters.createdBefore) {
        baseQuery += " AND created_at <= ?";
        countQuery += " AND created_at <= ?";
        params.push(filters.createdBefore);
        countParams.push(filters.createdBefore);
      }

      // 排序和分页
      baseQuery += ` ORDER BY ${sortBy} ${sortOrder}`;

      // 向后兼容：如果提供了 limit 但没有分页参数，使用 limit
      if (filters.limit && !filters.page && !filters.pageSize) {
        baseQuery += " LIMIT ?";
        params.push(filters.limit);

        const orders = db.prepare(baseQuery).all(...params);
        return orders.map((o) => ({
          ...o,
          metadata: o.metadata ? JSON.parse(o.metadata) : {},
        }));
      }

      // 分页查询
      baseQuery += " LIMIT ? OFFSET ?";
      params.push(pageSize, offset);

      // 执行查询
      const [orders, countResult] = await Promise.all([
        db.prepare(baseQuery).all(...params),
        db.prepare(countQuery).get(...countParams),
      ]);

      const total = countResult?.total || 0;
      const totalPages = Math.ceil(total / pageSize);

      return {
        items: orders.map((o) => ({
          ...o,
          metadata: o.metadata ? JSON.parse(o.metadata) : {},
        })),
        total,
        page,
        pageSize,
        totalPages,
      };
    } catch (error) {
      console.error("[MarketplaceManager] 获取订单列表失败:", error);
      throw error;
    }
  }

  /**
   * 搜索订单（便捷方法）
   * @param {string} keyword - 搜索关键词
   * @param {Object} options - 其他选项
   * @returns {Promise<Object>} 搜索结果
   */
  async searchOrders(keyword, options = {}) {
    return this.getOrders({
      search: keyword,
      status: "open",
      ...options,
    });
  }

  /**
   * 获取搜索建议（自动补全）
   * @param {string} prefix - 搜索前缀
   * @param {number} limit - 返回数量限制
   * @returns {Promise<Array>} 建议列表
   */
  async getSearchSuggestions(prefix, limit = 10) {
    try {
      if (!prefix || prefix.length < 2) {
        return [];
      }

      const db = this.database.db;
      const likePattern = `${prefix}%`;

      // 从标题中获取建议
      const titleSuggestions = db
        .prepare(
          `
        SELECT DISTINCT title as suggestion, 'title' as source
        FROM orders
        WHERE title LIKE ? AND status = 'open'
        LIMIT ?
      `,
        )
        .all(likePattern, Math.ceil(limit / 2));

      // 从订单类型获取建议
      const typeSuggestions = [
        { value: "buy", label: "求购" },
        { value: "sell", label: "出售" },
        { value: "service", label: "服务" },
        { value: "barter", label: "以物换物" },
      ]
        .filter(
          (t) =>
            t.label.includes(prefix) || t.value.includes(prefix.toLowerCase()),
        )
        .map((t) => ({ suggestion: t.label, source: "type", value: t.value }));

      return [...typeSuggestions, ...titleSuggestions].slice(0, limit);
    } catch (error) {
      console.error("[MarketplaceManager] 获取搜索建议失败:", error);
      return [];
    }
  }

  /**
   * 获取订单详情
   * @param {string} orderId - 订单 ID
   */
  async getOrder(orderId) {
    try {
      const db = this.database.db;
      const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId);

      if (!order) {
        return null;
      }

      return {
        ...order,
        metadata: order.metadata ? JSON.parse(order.metadata) : {},
      };
    } catch (error) {
      console.error("[MarketplaceManager] 获取订单详情失败:", error);
      throw error;
    }
  }

  /**
   * 匹配订单（购买）
   * @param {string} orderId - 订单 ID
   * @param {number} quantity - 数量（可选，默认全部）
   */
  async matchOrder(orderId, quantity = null) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 查询订单
      const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId);

      if (!order) {
        throw new Error("订单不存在");
      }

      if (order.status !== OrderStatus.OPEN) {
        throw new Error("订单不可用");
      }

      if (order.creator_did === currentDid) {
        throw new Error("不能购买自己的订单");
      }

      // 确定购买数量
      const buyQuantity = quantity || order.quantity;

      if (buyQuantity > order.quantity) {
        throw new Error("购买数量超过订单数量");
      }

      // 创建交易
      const transaction = await this.createTransaction({
        orderId,
        buyerDid: currentDid,
        sellerDid: order.creator_did,
        assetId: order.asset_id,
        paymentAssetId: order.price_asset_id,
        paymentAmount: order.price_amount,
        quantity: buyQuantity,
      });

      // 如果购买全部，更新订单状态
      if (buyQuantity === order.quantity) {
        const now = Date.now();
        db.prepare(
          "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
        ).run(OrderStatus.MATCHED, now, orderId);
      }

      console.log("[MarketplaceManager] 订单已匹配:", orderId);

      this.emit("order:matched", { orderId, transactionId: transaction.id });

      return transaction;
    } catch (error) {
      console.error("[MarketplaceManager] 匹配订单失败:", error);
      throw error;
    }
  }

  /**
   * 创建交易
   * @param {Object} options - 交易选项
   */
  async createTransaction({
    orderId,
    buyerDid,
    sellerDid,
    assetId,
    paymentAssetId,
    paymentAmount,
    quantity,
  }) {
    try {
      const transactionId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // 插入交易记录
      db.prepare(
        `
        INSERT INTO transactions
        (id, order_id, buyer_did, seller_did, asset_id, payment_asset_id, payment_amount, quantity, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        transactionId,
        orderId,
        buyerDid,
        sellerDid,
        assetId || null,
        paymentAssetId || null,
        paymentAmount,
        quantity,
        TransactionStatus.PENDING,
        now,
      );

      // 创建托管
      if (this.escrowManager && paymentAssetId) {
        const escrow = await this.escrowManager.createEscrow({
          transactionId,
          buyerDid,
          sellerDid,
          amount: paymentAmount * quantity,
          assetId: paymentAssetId,
        });

        // 更新交易记录
        db.prepare(
          "UPDATE transactions SET escrow_id = ?, status = ? WHERE id = ?",
        ).run(escrow.id, TransactionStatus.ESCROWED, transactionId);
      }

      const transaction = {
        id: transactionId,
        order_id: orderId,
        buyer_did: buyerDid,
        seller_did: sellerDid,
        asset_id: assetId,
        payment_asset_id: paymentAssetId,
        payment_amount: paymentAmount,
        quantity,
        status: this.escrowManager
          ? TransactionStatus.ESCROWED
          : TransactionStatus.PENDING,
        created_at: now,
      };

      console.log("[MarketplaceManager] 已创建交易:", transactionId);

      this.emit("transaction:created", { transaction });

      return transaction;
    } catch (error) {
      console.error("[MarketplaceManager] 创建交易失败:", error);
      throw error;
    }
  }

  /**
   * 确认交付
   * @param {string} transactionId - 交易 ID
   */
  async confirmDelivery(transactionId) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 查询交易
      const transaction = db
        .prepare("SELECT * FROM transactions WHERE id = ?")
        .get(transactionId);

      if (!transaction) {
        throw new Error("交易不存在");
      }

      if (transaction.buyer_did !== currentDid) {
        throw new Error("只有买家才能确认交付");
      }

      if (
        transaction.status !== TransactionStatus.ESCROWED &&
        transaction.status !== TransactionStatus.DELIVERED
      ) {
        throw new Error("交易状态不正确");
      }

      const now = Date.now();

      // 更新交易状态
      db.prepare(
        "UPDATE transactions SET status = ?, completed_at = ? WHERE id = ?",
      ).run(TransactionStatus.COMPLETED, now, transactionId);

      // 释放托管资金给卖家
      if (this.escrowManager && transaction.escrow_id) {
        await this.escrowManager.releaseEscrow(
          transaction.escrow_id,
          transaction.seller_did,
        );
      }

      // 如果有资产，转账给买家
      if (transaction.asset_id && this.assetManager) {
        await this.assetManager.transferAsset(
          transaction.asset_id,
          transaction.buyer_did,
          transaction.quantity,
          `交易 ${transactionId} 完成`,
        );
      }

      console.log("[MarketplaceManager] 交易已完成:", transactionId);

      this.emit("transaction:completed", { transactionId });

      return { success: true };
    } catch (error) {
      console.error("[MarketplaceManager] 确认交付失败:", error);
      throw error;
    }
  }

  /**
   * 申请退款
   * @param {string} transactionId - 交易 ID
   * @param {string} reason - 退款原因
   */
  async requestRefund(transactionId, reason) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 查询交易
      const transaction = db
        .prepare("SELECT * FROM transactions WHERE id = ?")
        .get(transactionId);

      if (!transaction) {
        throw new Error("交易不存在");
      }

      if (transaction.buyer_did !== currentDid) {
        throw new Error("只有买家才能申请退款");
      }

      const now = Date.now();

      // 更新交易状态
      db.prepare("UPDATE transactions SET status = ? WHERE id = ?").run(
        TransactionStatus.DISPUTED,
        transactionId,
      );

      console.log("[MarketplaceManager] 已申请退款:", transactionId);

      this.emit("transaction:refund-requested", { transactionId, reason });

      return { success: true };
    } catch (error) {
      console.error("[MarketplaceManager] 申请退款失败:", error);
      throw error;
    }
  }

  /**
   * 获取交易列表
   * @param {Object} filters - 筛选条件
   */
  async getTransactions(filters = {}) {
    try {
      const db = this.database.db;

      let query = "SELECT * FROM transactions WHERE 1=1";
      const params = [];

      if (filters.orderId) {
        query += " AND order_id = ?";
        params.push(filters.orderId);
      }

      if (filters.buyerDid) {
        query += " AND buyer_did = ?";
        params.push(filters.buyerDid);
      }

      if (filters.sellerDid) {
        query += " AND seller_did = ?";
        params.push(filters.sellerDid);
      }

      if (filters.status) {
        query += " AND status = ?";
        params.push(filters.status);
      }

      query += " ORDER BY created_at DESC";

      if (filters.limit) {
        query += " LIMIT ?";
        params.push(filters.limit);
      }

      return db.prepare(query).all(...params);
    } catch (error) {
      console.error("[MarketplaceManager] 获取交易列表失败:", error);
      throw error;
    }
  }

  /**
   * 获取我的订单（买家或卖家）
   * @param {string} userDid - 用户 DID
   */
  async getMyOrders(userDid) {
    try {
      const db = this.database.db;

      // 获取我创建的订单
      const myOrders = await this.getOrders({ creatorDid: userDid });

      // 获取我参与的交易
      const myTransactions = await this.getTransactions({ buyerDid: userDid });

      return {
        createdOrders: myOrders,
        purchasedOrders: myTransactions,
      };
    } catch (error) {
      console.error("[MarketplaceManager] 获取我的订单失败:", error);
      throw error;
    }
  }

  /**
   * 更新订单
   * @param {string} orderId - 订单 ID
   * @param {Object} updates - 更新内容
   */
  async updateOrder(orderId, updates) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error("未登录");
      }

      const db = this.database.db;

      // 查询订单
      const order = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId);

      if (!order) {
        throw new Error("订单不存在");
      }

      if (order.creator_did !== currentDid) {
        throw new Error("只有订单创建者才能编辑订单");
      }

      if (order.status !== OrderStatus.OPEN) {
        throw new Error("只能编辑开放状态的订单");
      }

      const now = Date.now();
      const allowedFields = [
        "price_amount",
        "quantity",
        "description",
        "contact_info",
        "location",
        "valid_until",
      ];

      // 构建更新语句
      const updateFields = [];
      const params = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key) && value !== undefined) {
          updateFields.push(`${key} = ?`);
          params.push(value);
        }
      }

      if (updateFields.length === 0) {
        throw new Error("没有可更新的字段");
      }

      // 添加 updated_at
      updateFields.push("updated_at = ?");
      params.push(now);

      // 添加 orderId 到参数末尾
      params.push(orderId);

      const updateQuery = `UPDATE orders SET ${updateFields.join(", ")} WHERE id = ?`;
      db.prepare(updateQuery).run(...params);

      // 获取更新后的订单
      const updatedOrder = db
        .prepare("SELECT * FROM orders WHERE id = ?")
        .get(orderId);

      // 解析 metadata
      if (updatedOrder.metadata) {
        try {
          updatedOrder.metadata = JSON.parse(updatedOrder.metadata);
        } catch (e) {
          updatedOrder.metadata = {};
        }
      }

      console.log("[MarketplaceManager] 已更新订单:", orderId);

      this.emit("order:updated", { order: updatedOrder });

      return updatedOrder;
    } catch (error) {
      console.error("[MarketplaceManager] 更新订单失败:", error);
      throw error;
    }
  }

  /**
   * 关闭交易市场管理器
   */
  async close() {
    console.log("[MarketplaceManager] 关闭交易市场管理器");

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  MarketplaceManager,
  OrderType,
  OrderStatus,
  TransactionStatus,
};
