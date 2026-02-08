const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");
const EventEmitter = require("events");
const crypto = require("crypto");

/**
 * 知识付费管理器
 * 负责付费内容创建、购买、访问控制和加密保护
 */
class KnowledgePaymentManager extends EventEmitter {
  constructor(db, assetManager, p2pManager) {
    super();
    this.db = db;
    this.assetManager = assetManager;
    this.p2pManager = p2pManager;
    this.currentUserDid = null;

    this.initDatabase();
  }

  /**
   * 初始化知识付费管理器
   */
  async initialize() {
    logger.info("[KnowledgePayment] 初始化知识付费管理器...");

    try {
      // 数据库表已在构造函数中初始化
      logger.info("[KnowledgePayment] 知识付费管理器初始化成功");
      return true;
    } catch (error) {
      logger.error("[KnowledgePayment] 初始化失败:", error);
      return false;
    }
  }

  /**
   * 初始化数据库表
   */
  initDatabase() {
    // 付费内容表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS paid_contents (
        id TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,      -- 'article', 'video', 'audio', 'course', 'consulting'
        title TEXT NOT NULL,
        description TEXT,
        creator_did TEXT NOT NULL,
        price_asset_id TEXT NOT NULL,    -- 定价资产
        price_amount INTEGER NOT NULL,   -- 价格
        pricing_model TEXT NOT NULL,     -- 'one_time', 'subscription', 'donation'
        content_data TEXT NOT NULL,      -- 加密内容 (JSON)
        preview_data TEXT,               -- 预览内容 (JSON)
        encryption_key TEXT NOT NULL,    -- 加密密钥（加密存储）
        access_control TEXT NOT NULL,    -- 访问控制规则 (JSON)
        metadata TEXT,                   -- 元数据 (JSON)
        view_count INTEGER DEFAULT 0,
        purchase_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        status TEXT DEFAULT 'active',    -- 'active', 'inactive', 'deleted'
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // 内容购买记录表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS content_purchases (
        id TEXT PRIMARY KEY,
        content_id TEXT NOT NULL,
        buyer_did TEXT NOT NULL,
        price_paid INTEGER NOT NULL,
        asset_id TEXT NOT NULL,
        access_key TEXT NOT NULL,        -- 解密密钥（用买方公钥加密）
        purchase_type TEXT NOT NULL,     -- 'purchase', 'subscription', 'donation'
        expires_at INTEGER,              -- 订阅过期时间
        status TEXT DEFAULT 'active',    -- 'active', 'expired', 'refunded'
        created_at INTEGER NOT NULL,
        UNIQUE(content_id, buyer_did)
      )
    `);

    // 订阅计划表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS subscription_plans (
        id TEXT PRIMARY KEY,
        creator_did TEXT NOT NULL,
        plan_name TEXT NOT NULL,
        description TEXT,
        price_asset_id TEXT NOT NULL,
        monthly_price INTEGER NOT NULL,
        duration_months INTEGER NOT NULL, -- 订阅时长
        benefits TEXT,                    -- 订阅权益 (JSON)
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL
      )
    `);

    // 用户订阅表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_subscriptions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        subscriber_did TEXT NOT NULL,
        creator_did TEXT NOT NULL,
        start_date INTEGER NOT NULL,
        end_date INTEGER NOT NULL,
        auto_renew INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',     -- 'active', 'expired', 'cancelled'
        created_at INTEGER NOT NULL,
        UNIQUE(plan_id, subscriber_did)
      )
    `);

    // 内容访问日志表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS content_access_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        access_type TEXT NOT NULL,       -- 'view', 'download', 'share'
        device_id TEXT,
        ip_address TEXT,
        accessed_at INTEGER NOT NULL
      )
    `);

    logger.info("[KnowledgePayment] 数据库表初始化完成");
  }

  /**
   * 设置当前用户
   */
  setCurrentUser(did) {
    this.currentUserDid = did;
  }

  /**
   * 创建付费内容
   */
  async createPaidContent(options) {
    const {
      contentType,
      title,
      description,
      content,
      preview,
      priceAssetId,
      priceAmount,
      pricingModel = "one_time",
      accessControl = {},
      metadata = {},
    } = options;

    if (!this.currentUserDid) {
      throw new Error("用户未登录");
    }

    // 生成加密密钥
    const encryptionKey = crypto.randomBytes(32).toString("hex");

    // 加密内容
    const encryptedContent = this.encryptContent(content, encryptionKey);

    const contentId = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO paid_contents (
        id, content_type, title, description, creator_did,
        price_asset_id, price_amount, pricing_model,
        content_data, preview_data, encryption_key, access_control,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      contentId,
      contentType,
      title,
      description || null,
      this.currentUserDid,
      priceAssetId,
      priceAmount,
      pricingModel,
      encryptedContent,
      preview ? JSON.stringify(preview) : null,
      encryptionKey, // 实际应用中应该加密存储
      JSON.stringify(accessControl),
      JSON.stringify(metadata),
      now,
      now,
    );

    const contentData = {
      id: contentId,
      contentType,
      title,
      description,
      creatorDid: this.currentUserDid,
      priceAssetId,
      priceAmount,
      pricingModel,
      preview,
      accessControl,
      metadata,
      createdAt: now,
    };

    // 触发事件
    this.emit("content:created", contentData);

    // P2P 广播（如果是公开内容）
    if (accessControl.visibility === "public") {
      this.p2pManager.broadcast("knowledge:new-content", contentData);
    }

    logger.info("[KnowledgePayment] 付费内容已创建:", contentId);
    return contentData;
  }

  /**
   * 购买内容
   */
  async purchaseContent(contentId, buyerDid) {
    if (!buyerDid) {
      buyerDid = this.currentUserDid;
    }

    if (!buyerDid) {
      throw new Error("用户未登录");
    }

    // 检查是否已购买
    const existing = this.db
      .prepare(
        `
      SELECT * FROM content_purchases
      WHERE content_id = ? AND buyer_did = ? AND status = 'active'
    `,
      )
      .get(contentId, buyerDid);

    if (existing) {
      throw new Error("您已购买过此内容");
    }

    // 获取内容信息
    const content = this.db
      .prepare(
        `
      SELECT * FROM paid_contents WHERE id = ? AND status = 'active'
    `,
      )
      .get(contentId);

    if (!content) {
      throw new Error("内容不存在或已下架");
    }

    // 检查余额并扣款
    const balance = await this.assetManager.getBalance(
      buyerDid,
      content.price_asset_id,
    );

    if (balance < content.price_amount) {
      throw new Error("余额不足");
    }

    // 转账给创作者
    await this.assetManager.transferAsset(
      content.price_asset_id,
      buyerDid,
      content.creator_did,
      content.price_amount,
    );

    // 创建购买记录
    const purchaseId = uuidv4();
    const now = Date.now();

    // 生成访问密钥（使用买方公钥加密原始密钥）
    const accessKey = content.encryption_key; // 简化处理，实际应加密

    const stmt = this.db.prepare(`
      INSERT INTO content_purchases (
        id, content_id, buyer_did, price_paid, asset_id,
        access_key, purchase_type, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      purchaseId,
      contentId,
      buyerDid,
      content.price_amount,
      content.price_asset_id,
      accessKey,
      "purchase",
      "active",
      now,
    );

    // 更新购买计数
    this.db
      .prepare(
        `
      UPDATE paid_contents SET purchase_count = purchase_count + 1
      WHERE id = ?
    `,
      )
      .run(contentId);

    // 触发事件
    this.emit("content:purchased", {
      contentId,
      buyerDid,
      creatorDid: content.creator_did,
      amount: content.price_amount,
      assetId: content.price_asset_id,
    });

    // 通知创作者
    this.p2pManager.sendMessage(content.creator_did, {
      type: "knowledge:purchase-notification",
      contentId,
      contentTitle: content.title,
      buyerDid,
      amount: content.price_amount,
    });

    logger.info("[KnowledgePayment] 内容购买成功:", contentId);
    return { purchaseId, contentId };
  }

  /**
   * 验证访问权限
   */
  async verifyAccess(contentId, userDid) {
    if (!userDid) {
      userDid = this.currentUserDid;
    }

    if (!userDid) {
      return false;
    }

    // 获取内容信息
    const content = this.db
      .prepare(
        `
      SELECT * FROM paid_contents WHERE id = ?
    `,
      )
      .get(contentId);

    if (!content) {
      return false;
    }

    // 创作者总是有访问权限
    if (content.creator_did === userDid) {
      return true;
    }

    // 免费内容
    if (content.price_amount === 0) {
      return true;
    }

    // 检查购买记录
    const purchase = this.db
      .prepare(
        `
      SELECT * FROM content_purchases
      WHERE content_id = ? AND buyer_did = ? AND status = 'active'
    `,
      )
      .get(contentId, userDid);

    if (!purchase) {
      return false;
    }

    // 检查订阅是否过期
    if (purchase.expires_at && purchase.expires_at < Date.now()) {
      // 更新状态为过期
      this.db
        .prepare(
          `
        UPDATE content_purchases SET status = 'expired' WHERE id = ?
      `,
        )
        .run(purchase.id);
      return false;
    }

    return true;
  }

  /**
   * 获取解密内容
   */
  async getDecryptedContent(contentId, userDid) {
    if (!userDid) {
      userDid = this.currentUserDid;
    }

    // 验证访问权限
    const hasAccess = await this.verifyAccess(contentId, userDid);
    if (!hasAccess) {
      throw new Error("无访问权限");
    }

    // 获取内容和解密密钥
    const content = this.db
      .prepare(
        `
      SELECT * FROM paid_contents WHERE id = ?
    `,
      )
      .get(contentId);

    if (!content) {
      throw new Error("内容不存在");
    }

    let decryptionKey = content.encryption_key;

    // 如果不是创作者，从购买记录获取访问密钥
    if (content.creator_did !== userDid) {
      const purchase = this.db
        .prepare(
          `
        SELECT access_key FROM content_purchases
        WHERE content_id = ? AND buyer_did = ? AND status = 'active'
      `,
        )
        .get(contentId, userDid);

      if (purchase) {
        decryptionKey = purchase.access_key;
      }
    }

    // 解密内容
    const decryptedContent = this.decryptContent(
      content.content_data,
      decryptionKey,
    );

    // 记录访问日志
    this.logAccess(contentId, userDid, "view");

    // 更新浏览计数
    this.db
      .prepare(
        `
      UPDATE paid_contents SET view_count = view_count + 1 WHERE id = ?
    `,
      )
      .run(contentId);

    return {
      id: content.id,
      contentType: content.content_type,
      title: content.title,
      description: content.description,
      content: decryptedContent,
      metadata: JSON.parse(content.metadata || "{}"),
      creatorDid: content.creator_did,
      createdAt: content.created_at,
    };
  }

  /**
   * 创建订阅计划
   */
  async createSubscriptionPlan(options) {
    const {
      planName,
      description,
      priceAssetId,
      monthlyPrice,
      durationMonths = 1,
      benefits = [],
    } = options;

    if (!this.currentUserDid) {
      throw new Error("用户未登录");
    }

    const planId = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO subscription_plans (
        id, creator_did, plan_name, description,
        price_asset_id, monthly_price, duration_months,
        benefits, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      planId,
      this.currentUserDid,
      planName,
      description || null,
      priceAssetId,
      monthlyPrice,
      durationMonths,
      JSON.stringify(benefits),
      now,
    );

    logger.info("[KnowledgePayment] 订阅计划已创建:", planId);
    return { planId, planName };
  }

  /**
   * 订阅计划
   */
  async subscribe(planId, subscriberDid, autoRenew = false) {
    if (!subscriberDid) {
      subscriberDid = this.currentUserDid;
    }

    if (!subscriberDid) {
      throw new Error("用户未登录");
    }

    // 获取计划信息
    const plan = this.db
      .prepare(
        `
      SELECT * FROM subscription_plans WHERE id = ? AND status = 'active'
    `,
      )
      .get(planId);

    if (!plan) {
      throw new Error("订阅计划不存在");
    }

    // 检查是否已订阅
    const existing = this.db
      .prepare(
        `
      SELECT * FROM user_subscriptions
      WHERE plan_id = ? AND subscriber_did = ? AND status = 'active'
    `,
      )
      .get(planId, subscriberDid);

    if (existing) {
      throw new Error("已经订阅了此计划");
    }

    // 计算总价
    const totalPrice = plan.monthly_price * plan.duration_months;

    // 检查余额并扣款
    const balance = await this.assetManager.getBalance(
      subscriberDid,
      plan.price_asset_id,
    );

    if (balance < totalPrice) {
      throw new Error("余额不足");
    }

    // 转账给创作者
    await this.assetManager.transferAsset(
      plan.price_asset_id,
      subscriberDid,
      plan.creator_did,
      totalPrice,
    );

    // 创建订阅记录
    const subscriptionId = uuidv4();
    const now = Date.now();
    const endDate = now + plan.duration_months * 30 * 24 * 60 * 60 * 1000;

    const stmt = this.db.prepare(`
      INSERT INTO user_subscriptions (
        id, plan_id, subscriber_did, creator_did,
        start_date, end_date, auto_renew, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      subscriptionId,
      planId,
      subscriberDid,
      plan.creator_did,
      now,
      endDate,
      autoRenew ? 1 : 0,
      now,
    );

    // 触发事件
    this.emit("subscription:created", {
      subscriptionId,
      planId,
      subscriberDid,
      creatorDid: plan.creator_did,
    });

    logger.info("[KnowledgePayment] 订阅成功:", subscriptionId);
    return { subscriptionId, endDate };
  }

  /**
   * 取消订阅
   */
  async cancelSubscription(subscriptionId) {
    const subscription = this.db
      .prepare(
        `
      SELECT * FROM user_subscriptions WHERE id = ?
    `,
      )
      .get(subscriptionId);

    if (!subscription) {
      throw new Error("订阅不存在");
    }

    if (subscription.subscriber_did !== this.currentUserDid) {
      throw new Error("无权限取消此订阅");
    }

    // 更新状态
    this.db
      .prepare(
        `
      UPDATE user_subscriptions
      SET status = 'cancelled', auto_renew = 0
      WHERE id = ?
    `,
      )
      .run(subscriptionId);

    this.emit("subscription:cancelled", { subscriptionId });
    logger.info("[KnowledgePayment] 订阅已取消:", subscriptionId);
  }

  /**
   * 获取我的内容列表
   */
  getMyContents(filters = {}) {
    const { contentType, status = "active" } = filters;

    let query = `
      SELECT * FROM paid_contents
      WHERE creator_did = ? AND status = ?
    `;
    const params = [this.currentUserDid, status];

    if (contentType) {
      query += ` AND content_type = ?`;
      params.push(contentType);
    }

    query += ` ORDER BY created_at DESC`;

    const rows = this.db.prepare(query).all(...params);

    return rows.map((row) => ({
      id: row.id,
      contentType: row.content_type,
      title: row.title,
      description: row.description,
      priceAssetId: row.price_asset_id,
      priceAmount: row.price_amount,
      pricingModel: row.pricing_model,
      viewCount: row.view_count,
      purchaseCount: row.purchase_count,
      rating: row.rating,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  /**
   * 获取我的购买列表
   */
  getMyPurchases() {
    const rows = this.db
      .prepare(
        `
      SELECT cp.*, pc.title, pc.content_type, pc.creator_did
      FROM content_purchases cp
      JOIN paid_contents pc ON cp.content_id = pc.id
      WHERE cp.buyer_did = ?
      ORDER BY cp.created_at DESC
    `,
      )
      .all(this.currentUserDid);

    return rows.map((row) => ({
      id: row.id,
      contentId: row.content_id,
      title: row.title,
      contentType: row.content_type,
      creatorDid: row.creator_did,
      pricePaid: row.price_paid,
      assetId: row.asset_id,
      purchaseType: row.purchase_type,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * 获取订阅列表
   */
  getMySubscriptions() {
    const rows = this.db
      .prepare(
        `
      SELECT us.*, sp.plan_name, sp.creator_did
      FROM user_subscriptions us
      JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE us.subscriber_did = ?
      ORDER BY us.created_at DESC
    `,
      )
      .all(this.currentUserDid);

    return rows.map((row) => ({
      id: row.id,
      planId: row.plan_id,
      planName: row.plan_name,
      creatorDid: row.creator_did,
      startDate: row.start_date,
      endDate: row.end_date,
      autoRenew: row.auto_renew === 1,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  /**
   * 搜索内容
   */
  searchContents(keyword, filters = {}) {
    const { contentType, priceRange, sortBy = "created_at" } = filters;

    let query = `
      SELECT * FROM paid_contents
      WHERE status = 'active'
      AND (title LIKE ? OR description LIKE ?)
    `;
    const params = [`%${keyword}%`, `%${keyword}%`];

    if (contentType) {
      query += ` AND content_type = ?`;
      params.push(contentType);
    }

    if (priceRange) {
      query += ` AND price_amount BETWEEN ? AND ?`;
      params.push(priceRange.min, priceRange.max);
    }

    query += ` ORDER BY ${sortBy} DESC LIMIT 50`;

    const rows = this.db.prepare(query).all(...params);

    return rows.map((row) => ({
      id: row.id,
      contentType: row.content_type,
      title: row.title,
      description: row.description,
      creatorDid: row.creator_did,
      priceAssetId: row.price_asset_id,
      priceAmount: row.price_amount,
      pricingModel: row.pricing_model,
      preview: row.preview_data ? JSON.parse(row.preview_data) : null,
      viewCount: row.view_count,
      purchaseCount: row.purchase_count,
      rating: row.rating,
      createdAt: row.created_at,
    }));
  }

  /**
   * 记录访问日志
   */
  logAccess(contentId, userDid, accessType) {
    const now = Date.now();

    this.db
      .prepare(
        `
      INSERT INTO content_access_logs (
        content_id, user_did, access_type, accessed_at
      ) VALUES (?, ?, ?, ?)
    `,
      )
      .run(contentId, userDid, accessType, now);
  }

  /**
   * 加密内容
   */
  encryptContent(content, key) {
    const algorithm = "aes-256-cbc";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      algorithm,
      Buffer.from(key, "hex"),
      iv,
    );

    let encrypted = cipher.update(
      typeof content === "string" ? content : JSON.stringify(content),
      "utf8",
      "hex",
    );
    encrypted += cipher.final("hex");

    return JSON.stringify({
      iv: iv.toString("hex"),
      data: encrypted,
    });
  }

  /**
   * 解密内容
   */
  decryptContent(encryptedData, key) {
    const algorithm = "aes-256-cbc";
    const { iv, data } = JSON.parse(encryptedData);

    const decipher = crypto.createDecipheriv(
      algorithm,
      Buffer.from(key, "hex"),
      Buffer.from(iv, "hex"),
    );

    let decrypted = decipher.update(data, "hex", "utf8");
    decrypted += decipher.final("utf8");

    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  }

  /**
   * 列出付费内容
   * @param {Object} filters - 筛选条件
   * @param {string} filters.contentType - 内容类型
   * @param {string} filters.status - 状态
   * @param {number} filters.limit - 限制数量
   * @param {number} filters.offset - 偏移量
   * @returns {Array} 内容列表
   */
  listContents(filters = {}) {
    const { contentType, status = "active", limit = 50, offset = 0 } = filters;

    let query = `
      SELECT
        id,
        content_type,
        title,
        description,
        creator_did,
        price_asset_id,
        price_amount,
        pricing_model,
        preview_data,
        view_count,
        purchase_count,
        rating,
        status,
        created_at,
        updated_at
      FROM paid_contents
      WHERE status = ?
    `;
    const params = [status];

    if (contentType) {
      query += ` AND content_type = ?`;
      params.push(contentType);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params);

    return rows.map((row) => ({
      id: row.id,
      contentType: row.content_type,
      title: row.title,
      description: row.description,
      creatorDid: row.creator_did,
      priceAssetId: row.price_asset_id,
      priceAmount: row.price_amount,
      pricingModel: row.pricing_model,
      previewData: row.preview_data ? JSON.parse(row.preview_data) : null,
      viewCount: row.view_count,
      purchaseCount: row.purchase_count,
      rating: row.rating,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * 获取统计信息
   */
  getStatistics(creatorDid) {
    if (!creatorDid) {
      creatorDid = this.currentUserDid;
    }

    const stats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total_contents,
        SUM(view_count) as total_views,
        SUM(purchase_count) as total_purchases,
        AVG(rating) as avg_rating
      FROM paid_contents
      WHERE creator_did = ? AND status = 'active'
    `,
      )
      .get(creatorDid);

    const revenue = this.db
      .prepare(
        `
      SELECT
        SUM(cp.price_paid) as total_revenue
      FROM content_purchases cp
      JOIN paid_contents pc ON cp.content_id = pc.id
      WHERE pc.creator_did = ? AND cp.status = 'active'
    `,
      )
      .get(creatorDid);

    return {
      totalContents: stats.total_contents || 0,
      totalViews: stats.total_views || 0,
      totalPurchases: stats.total_purchases || 0,
      avgRating: stats.avg_rating || 0,
      totalRevenue: revenue.total_revenue || 0,
    };
  }
}

module.exports = KnowledgePaymentManager;
