/**
 * 移动端市场交易管理系统
 * Mobile Marketplace Management System
 *
 * 核心功能:
 * - 订单创建与管理
 * - 订单匹配与交易
 * - 交易流程管理
 * - 订单搜索与过滤
 * - 统计分析
 *
 * 订单类型:
 * - buy: 购买订单
 * - sell: 出售订单
 * - service: 服务订单
 * - barter: 以物换物
 *
 * @module marketplace-manager
 * @version 2.4.0
 * @since 2024-01-02
 */

/**
 * 订单类型枚举
 */
const OrderType = {
  BUY: 'buy',           // 购买
  SELL: 'sell',         // 出售
  SERVICE: 'service',   // 服务
  BARTER: 'barter'      // 以物换物
}

/**
 * 订单状态枚举
 */
const OrderStatus = {
  OPEN: 'open',           // 开放
  MATCHED: 'matched',     // 已匹配
  COMPLETED: 'completed', // 已完成
  CANCELLED: 'cancelled', // 已取消
  EXPIRED: 'expired'      // 已过期
}

/**
 * 交易状态枚举
 */
const TransactionStatus = {
  PENDING: 'pending',       // 待处理
  CONFIRMED: 'confirmed',   // 已确认
  DELIVERING: 'delivering', // 配送中
  DELIVERED: 'delivered',   // 已交付
  COMPLETED: 'completed',   // 已完成
  REFUNDED: 'refunded',     // 已退款
  DISPUTED: 'disputed'      // 有争议
}

/**
 * 市场交易管理器类
 */
class MarketplaceManager {
  /**
   * 构造函数
   * @param {Object} db - 数据库实例
   * @param {Object} didManager - DID管理器实例
   * @param {Object} assetManager - 资产管理器实例
   */
  constructor(db, didManager, assetManager) {
    if (!db) {
      throw new Error('数据库实例不能为空')
    }

    this.db = db
    this.didManager = didManager
    this.assetManager = assetManager
    this.initialized = false

    // 缓存系统
    this.orderCache = new Map()  // 订单缓存
    this.transactionCache = new Map()  // 交易缓存
    this.statsCache = null  // 统计缓存
    this.cacheTTL = 5 * 60 * 1000  // 5分钟缓存过期

    console.log('[MarketplaceManager] 实例已创建')
  }

  /**
   * 初始化市场管理器
   */
  async initialize() {
    if (this.initialized) {
      console.log('[MarketplaceManager] 已经初始化过，跳过')
      return
    }

    try {
      console.log('[MarketplaceManager] 开始初始化...')

      // 创建数据库表
      await this._createTables()

      this.initialized = true
      console.log('[MarketplaceManager] ✓ 初始化完成')
    } catch (error) {
      console.error('[MarketplaceManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建数据库表
   * @private
   */
  async _createTables() {
    // 订单表
    await this.db.executeSql(`
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
        remaining_quantity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        metadata TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `)

    // 交易表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        buyer_did TEXT NOT NULL,
        seller_did TEXT NOT NULL,
        asset_id TEXT,
        payment_asset_id TEXT,
        payment_amount INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        review_rating INTEGER,
        review_comment TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        deleted INTEGER DEFAULT 0
      )
    `)

    // 创建索引
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_orders_creator
      ON orders(creator_did) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_orders_status
      ON orders(status) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_orders_type
      ON orders(order_type) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_transactions_order
      ON transactions(order_id) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_transactions_buyer
      ON transactions(buyer_did) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_transactions_seller
      ON transactions(seller_did) WHERE deleted = 0
    `)

    console.log('[MarketplaceManager] ✓ 数据库表创建完成')
  }

  // ============================================================
  // 订单管理
  // ============================================================

  /**
   * 创建订单
   * @param {Object} options - 订单选项
   * @param {string} options.type - 订单类型
   * @param {string} options.title - 标题
   * @param {string} [options.description] - 描述
   * @param {string} [options.assetId] - 资产ID
   * @param {string} [options.priceAssetId] - 价格资产ID
   * @param {number} options.priceAmount - 价格数量
   * @param {number} options.quantity - 数量
   * @param {Object} [options.metadata] - 元数据
   * @param {number} [options.expiresIn] - 过期时间（毫秒）
   * @returns {Promise<Object>} 创建的订单
   */
  async createOrder(options) {
    const {
      type,
      title,
      description,
      assetId,
      priceAssetId,
      priceAmount,
      quantity,
      metadata = {},
      expiresIn
    } = options

    try {
      // 1. 获取当前用户
      const currentDid = this._getCurrentDid()

      // 2. 验证参数
      this._validateOrderParams({ type, title, priceAmount, quantity })

      // 3. 如果是出售订单，检查资产余额
      if (type === OrderType.SELL && assetId) {
        const balance = await this.assetManager.getBalance(currentDid, assetId)
        if (balance < quantity) {
          throw new Error(`资产余额不足（当前: ${balance}, 需要: ${quantity}）`)
        }
      }

      // 4. 生成订单ID
      const orderId = this._generateId()
      const now = Date.now()
      const expiresAt = expiresIn ? now + expiresIn : null

      // 5. 插入订单记录
      const order = {
        id: orderId,
        order_type: type,
        creator_did: currentDid,
        asset_id: assetId || null,
        title: title.trim(),
        description: description || null,
        price_asset_id: priceAssetId || null,
        price_amount: priceAmount,
        quantity,
        remaining_quantity: quantity,
        status: OrderStatus.OPEN,
        metadata: JSON.stringify(metadata),
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
        deleted: 0
      }

      await this._insertOrder(order)

      // 6. 清除缓存
      this._clearCache()

      console.log(`[MarketplaceManager] ✓ 订单已创建: ${orderId} (${title})`)

      return {
        ...order,
        metadata: JSON.parse(order.metadata)
      }
    } catch (error) {
      console.error('[MarketplaceManager] 创建订单失败:', error)
      throw error
    }
  }

  /**
   * 验证订单参数
   * @private
   */
  _validateOrderParams({ type, title, priceAmount, quantity }) {
    if (!Object.values(OrderType).includes(type)) {
      throw new Error(`无效的订单类型: ${type}`)
    }

    if (!title || title.trim().length === 0) {
      throw new Error('订单标题不能为空')
    }

    if (title.trim().length > 200) {
      throw new Error('订单标题过长（最多200字符）')
    }

    if (priceAmount < 0) {
      throw new Error('价格不能为负数')
    }

    if (quantity <= 0) {
      throw new Error('数量必须大于0')
    }
  }

  /**
   * 插入订单到数据库
   * @private
   */
  async _insertOrder(order) {
    const sql = `
      INSERT INTO orders (
        id, order_type, creator_did, asset_id, title, description,
        price_asset_id, price_amount, quantity, remaining_quantity,
        status, metadata, expires_at, created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      order.id,
      order.order_type,
      order.creator_did,
      order.asset_id,
      order.title,
      order.description,
      order.price_asset_id,
      order.price_amount,
      order.quantity,
      order.remaining_quantity,
      order.status,
      order.metadata,
      order.expires_at,
      order.created_at,
      order.updated_at,
      order.deleted
    ]

    await this.db.executeSql(sql, params)
  }

  /**
   * 获取订单
   * @param {string} orderId - 订单ID
   * @returns {Promise<Object|null>} 订单信息
   */
  async getOrder(orderId) {
    // 检查缓存
    const cached = this.orderCache.get(orderId)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    try {
      const sql = 'SELECT * FROM orders WHERE id = ? AND deleted = 0'
      const rows = await this.db.executeSql(sql, [orderId])

      if (rows.length === 0) {
        return null
      }

      const order = this._parseOrder(rows[0])

      // 缓存
      this.orderCache.set(orderId, {
        data: order,
        timestamp: Date.now()
      })

      return order
    } catch (error) {
      console.error('[MarketplaceManager] 获取订单失败:', error)
      throw error
    }
  }

  /**
   * 获取所有订单
   * @param {Object} [filters] - 过滤条件
   * @param {string} [filters.type] - 订单类型
   * @param {string} [filters.status] - 订单状态
   * @param {string} [filters.creatorDid] - 创建者DID
   * @param {string} [filters.assetId] - 资产ID
   * @param {number} [filters.minPrice] - 最小价格
   * @param {number} [filters.maxPrice] - 最大价格
   * @param {number} [filters.limit] - 数量限制
   * @returns {Promise<Array>} 订单列表
   */
  async getOrders(filters = {}) {
    try {
      let sql = 'SELECT * FROM orders WHERE deleted = 0'
      const params = []

      // 类型过滤
      if (filters.type) {
        sql += ' AND order_type = ?'
        params.push(filters.type)
      }

      // 状态过滤
      if (filters.status) {
        sql += ' AND status = ?'
        params.push(filters.status)
      }

      // 创建者过滤
      if (filters.creatorDid) {
        sql += ' AND creator_did = ?'
        params.push(filters.creatorDid)
      }

      // 资产过滤
      if (filters.assetId) {
        sql += ' AND asset_id = ?'
        params.push(filters.assetId)
      }

      // 价格范围过滤
      if (filters.minPrice) {
        sql += ' AND price_amount >= ?'
        params.push(filters.minPrice)
      }

      if (filters.maxPrice) {
        sql += ' AND price_amount <= ?'
        params.push(filters.maxPrice)
      }

      sql += ' ORDER BY created_at DESC'

      // 限制数量
      if (filters.limit) {
        sql += ' LIMIT ?'
        params.push(filters.limit)
      }

      const rows = await this.db.executeSql(sql, params)
      return rows.map(row => this._parseOrder(row))
    } catch (error) {
      console.error('[MarketplaceManager] 获取订单列表失败:', error)
      throw error
    }
  }

  /**
   * 搜索订单
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>} 匹配的订单列表
   */
  async searchOrders(query) {
    if (!query || query.trim() === '') {
      return []
    }

    try {
      const sql = `
        SELECT * FROM orders
        WHERE deleted = 0 AND status = 'open'
        AND (title LIKE ? OR description LIKE ?)
        ORDER BY created_at DESC
        LIMIT 50
      `

      const searchPattern = `%${query}%`
      const rows = await this.db.executeSql(sql, [searchPattern, searchPattern])

      return rows.map(row => this._parseOrder(row))
    } catch (error) {
      console.error('[MarketplaceManager] 搜索订单失败:', error)
      throw error
    }
  }

  /**
   * 更新订单
   * @param {string} orderId - 订单ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<Object>} 更新后的订单
   */
  async updateOrder(orderId, updates) {
    try {
      // 获取订单
      const order = await this.getOrder(orderId)
      if (!order) {
        throw new Error('订单不存在')
      }

      // 检查权限
      const currentDid = this._getCurrentDid()
      if (order.creator_did !== currentDid) {
        throw new Error('只有创建者可以更新订单')
      }

      // 只有开放状态可以更新
      if (order.status !== OrderStatus.OPEN) {
        throw new Error('只有开放状态的订单可以更新')
      }

      const allowedFields = ['title', 'description', 'price_amount', 'metadata']
      const fields = []
      const params = []

      for (const key of allowedFields) {
        if (updates[key] !== undefined) {
          if (key === 'metadata') {
            fields.push('metadata = ?')
            params.push(JSON.stringify(updates.metadata))
          } else {
            fields.push(`${key} = ?`)
            params.push(updates[key])
          }
        }
      }

      if (fields.length === 0) {
        throw new Error('没有可更新的字段')
      }

      fields.push('updated_at = ?')
      params.push(Date.now())
      params.push(orderId)

      const sql = `UPDATE orders SET ${fields.join(', ')} WHERE id = ? AND deleted = 0`

      await this.db.executeSql(sql, params)

      // 清除缓存
      this.orderCache.delete(orderId)
      this._clearStatsCache()

      // 返回更新后的订单
      return await this.getOrder(orderId)
    } catch (error) {
      console.error('[MarketplaceManager] 更新订单失败:', error)
      throw error
    }
  }

  /**
   * 取消订单
   * @param {string} orderId - 订单ID
   * @returns {Promise<void>}
   */
  async cancelOrder(orderId) {
    try {
      // 获取订单
      const order = await this.getOrder(orderId)
      if (!order) {
        throw new Error('订单不存在')
      }

      // 检查权限
      const currentDid = this._getCurrentDid()
      if (order.creator_did !== currentDid) {
        throw new Error('只有创建者可以取消订单')
      }

      // 只有开放状态可以取消
      if (order.status !== OrderStatus.OPEN) {
        throw new Error('只有开放状态的订单可以取消')
      }

      const sql = `
        UPDATE orders
        SET status = ?, updated_at = ?
        WHERE id = ? AND deleted = 0
      `

      await this.db.executeSql(sql, [OrderStatus.CANCELLED, Date.now(), orderId])

      // 清除缓存
      this.orderCache.delete(orderId)
      this._clearCache()

      console.log(`[MarketplaceManager] ✓ 订单已取消: ${orderId}`)
    } catch (error) {
      console.error('[MarketplaceManager] 取消订单失败:', error)
      throw error
    }
  }

  /**
   * 删除订单（软删除）
   * @param {string} orderId - 订单ID
   * @returns {Promise<void>}
   */
  async deleteOrder(orderId) {
    try {
      // 获取订单
      const order = await this.getOrder(orderId)
      if (!order) {
        throw new Error('订单不存在')
      }

      // 检查权限
      const currentDid = this._getCurrentDid()
      if (order.creator_did !== currentDid) {
        throw new Error('只有创建者可以删除订单')
      }

      const sql = `
        UPDATE orders
        SET deleted = 1, updated_at = ?
        WHERE id = ? AND deleted = 0
      `

      await this.db.executeSql(sql, [Date.now(), orderId])

      // 清除缓存
      this.orderCache.delete(orderId)
      this._clearCache()

      console.log(`[MarketplaceManager] ✓ 订单已删除: ${orderId}`)
    } catch (error) {
      console.error('[MarketplaceManager] 删除订单失败:', error)
      throw error
    }
  }

  // ============================================================
  // 交易管理
  // ============================================================

  /**
   * 匹配订单（购买）
   * @param {string} orderId - 订单ID
   * @param {number} [quantity] - 购买数量（默认全部）
   * @returns {Promise<Object>} 交易信息
   */
  async matchOrder(orderId, quantity = null) {
    try {
      // 1. 获取订单
      const order = await this.getOrder(orderId)
      if (!order) {
        throw new Error('订单不存在')
      }

      // 2. 检查订单状态
      if (order.status !== OrderStatus.OPEN) {
        throw new Error('订单不可用')
      }

      // 3. 检查是否过期
      if (order.expires_at && Date.now() > order.expires_at) {
        await this.db.executeSql(
          'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?',
          [OrderStatus.EXPIRED, Date.now(), orderId]
        )
        throw new Error('订单已过期')
      }

      // 4. 验证购买者
      const currentDid = this._getCurrentDid()
      if (order.creator_did === currentDid) {
        throw new Error('不能购买自己的订单')
      }

      // 5. 确定购买数量
      const buyQuantity = quantity || order.remaining_quantity

      if (buyQuantity > order.remaining_quantity) {
        throw new Error(`购买数量超过剩余数量（剩余: ${order.remaining_quantity}）`)
      }

      // 6. 检查买家支付资产余额
      if (order.price_asset_id) {
        const totalAmount = order.price_amount * buyQuantity
        const balance = await this.assetManager.getBalance(currentDid, order.price_asset_id)
        if (balance < totalAmount) {
          throw new Error(`支付资产余额不足（当前: ${balance}, 需要: ${totalAmount}）`)
        }
      }

      // 7. 创建交易
      const transaction = await this._createTransaction({
        orderId,
        buyerDid: currentDid,
        sellerDid: order.creator_did,
        assetId: order.asset_id,
        paymentAssetId: order.price_asset_id,
        paymentAmount: order.price_amount,
        quantity: buyQuantity
      })

      // 8. 更新订单剩余数量
      const newRemainingQuantity = order.remaining_quantity - buyQuantity
      const newStatus = newRemainingQuantity === 0 ? OrderStatus.MATCHED : OrderStatus.OPEN

      await this.db.executeSql(
        'UPDATE orders SET remaining_quantity = ?, status = ?, updated_at = ? WHERE id = ?',
        [newRemainingQuantity, newStatus, Date.now(), orderId]
      )

      // 9. 清除缓存
      this.orderCache.delete(orderId)
      this._clearCache()

      console.log(`[MarketplaceManager] ✓ 订单已匹配: ${orderId} (数量: ${buyQuantity})`)

      return transaction
    } catch (error) {
      console.error('[MarketplaceManager] 匹配订单失败:', error)
      throw error
    }
  }

  /**
   * 创建交易
   * @private
   */
  async _createTransaction(options) {
    const {
      orderId,
      buyerDid,
      sellerDid,
      assetId,
      paymentAssetId,
      paymentAmount,
      quantity
    } = options

    const transactionId = this._generateId()
    const now = Date.now()

    const transaction = {
      id: transactionId,
      order_id: orderId,
      buyer_did: buyerDid,
      seller_did: sellerDid,
      asset_id: assetId || null,
      payment_asset_id: paymentAssetId || null,
      payment_amount: paymentAmount,
      quantity,
      status: TransactionStatus.PENDING,
      review_rating: null,
      review_comment: null,
      created_at: now,
      completed_at: null,
      deleted: 0
    }

    const sql = `
      INSERT INTO transactions (
        id, order_id, buyer_did, seller_did, asset_id, payment_asset_id,
        payment_amount, quantity, status, review_rating, review_comment,
        created_at, completed_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      transaction.id,
      transaction.order_id,
      transaction.buyer_did,
      transaction.seller_did,
      transaction.asset_id,
      transaction.payment_asset_id,
      transaction.payment_amount,
      transaction.quantity,
      transaction.status,
      transaction.review_rating,
      transaction.review_comment,
      transaction.created_at,
      transaction.completed_at,
      transaction.deleted
    ]

    await this.db.executeSql(sql, params)

    return transaction
  }

  /**
   * 确认交易完成
   * @param {string} transactionId - 交易ID
   * @param {Object} [review] - 评价（可选）
   * @param {number} [review.rating] - 评分（1-5）
   * @param {string} [review.comment] - 评论
   * @returns {Promise<void>}
   */
  async confirmTransaction(transactionId, review = null) {
    try {
      // 1. 获取交易
      const transaction = await this.getTransaction(transactionId)
      if (!transaction) {
        throw new Error('交易不存在')
      }

      // 2. 检查权限（买家确认）
      const currentDid = this._getCurrentDid()
      if (transaction.buyer_did !== currentDid) {
        throw new Error('只有买家可以确认交易')
      }

      // 3. 检查状态
      if (transaction.status === TransactionStatus.COMPLETED) {
        throw new Error('交易已完成')
      }

      const now = Date.now()

      // 4. 转移支付资产
      if (transaction.payment_asset_id) {
        const totalAmount = transaction.payment_amount * transaction.quantity
        await this.assetManager.transferAsset(
          transaction.payment_asset_id,
          transaction.seller_did,
          totalAmount,
          `交易 ${transactionId} 付款`
        )
      }

      // 5. 转移商品资产
      if (transaction.asset_id) {
        await this.assetManager.transferAsset(
          transaction.asset_id,
          transaction.buyer_did,
          transaction.quantity,
          `交易 ${transactionId} 商品`
        )
      }

      // 6. 更新交易状态
      const fields = ['status = ?', 'completed_at = ?']
      const params = [TransactionStatus.COMPLETED, now]

      if (review && review.rating) {
        fields.push('review_rating = ?', 'review_comment = ?')
        params.push(review.rating, review.comment || null)
      }

      params.push(transactionId)

      const sql = `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`
      await this.db.executeSql(sql, params)

      // 7. 清除缓存
      this.transactionCache.delete(transactionId)
      this._clearCache()

      console.log(`[MarketplaceManager] ✓ 交易已完成: ${transactionId}`)
    } catch (error) {
      console.error('[MarketplaceManager] 确认交易失败:', error)
      throw error
    }
  }

  /**
   * 获取交易
   * @param {string} transactionId - 交易ID
   * @returns {Promise<Object|null>} 交易信息
   */
  async getTransaction(transactionId) {
    // 检查缓存
    const cached = this.transactionCache.get(transactionId)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    try {
      const sql = 'SELECT * FROM transactions WHERE id = ? AND deleted = 0'
      const rows = await this.db.executeSql(sql, [transactionId])

      if (rows.length === 0) {
        return null
      }

      const transaction = rows[0]

      // 缓存
      this.transactionCache.set(transactionId, {
        data: transaction,
        timestamp: Date.now()
      })

      return transaction
    } catch (error) {
      console.error('[MarketplaceManager] 获取交易失败:', error)
      throw error
    }
  }

  /**
   * 获取所有交易
   * @param {Object} [filters] - 过滤条件
   * @param {string} [filters.orderId] - 订单ID
   * @param {string} [filters.buyerDid] - 买家DID
   * @param {string} [filters.sellerDid] - 卖家DID
   * @param {string} [filters.status] - 交易状态
   * @param {number} [filters.limit] - 数量限制
   * @returns {Promise<Array>} 交易列表
   */
  async getTransactions(filters = {}) {
    try {
      let sql = 'SELECT * FROM transactions WHERE deleted = 0'
      const params = []

      if (filters.orderId) {
        sql += ' AND order_id = ?'
        params.push(filters.orderId)
      }

      if (filters.buyerDid) {
        sql += ' AND buyer_did = ?'
        params.push(filters.buyerDid)
      }

      if (filters.sellerDid) {
        sql += ' AND seller_did = ?'
        params.push(filters.sellerDid)
      }

      if (filters.status) {
        sql += ' AND status = ?'
        params.push(filters.status)
      }

      sql += ' ORDER BY created_at DESC'

      if (filters.limit) {
        sql += ' LIMIT ?'
        params.push(filters.limit)
      }

      return await this.db.executeSql(sql, params)
    } catch (error) {
      console.error('[MarketplaceManager] 获取交易列表失败:', error)
      throw error
    }
  }

  /**
   * 获取我的订单和交易
   * @param {string} [userDid] - 用户DID（默认当前用户）
   * @returns {Promise<Object>} 我的订单和交易
   */
  async getMyMarketplace(userDid = null) {
    try {
      const did = userDid || this._getCurrentDid()

      // 我创建的订单
      const myOrders = await this.getOrders({ creatorDid: did })

      // 我作为买家的交易
      const myPurchases = await this.getTransactions({ buyerDid: did })

      // 我作为卖家的交易
      const mySales = await this.getTransactions({ sellerDid: did })

      return {
        myOrders,
        myPurchases,
        mySales
      }
    } catch (error) {
      console.error('[MarketplaceManager] 获取我的市场失败:', error)
      throw error
    }
  }

  // ============================================================
  // 统计信息
  // ============================================================

  /**
   * 获取统计信息
   * @returns {Promise<Object>} 统计信息
   */
  async getStatistics() {
    // 检查缓存
    if (this.statsCache && (Date.now() - this.statsCache.timestamp < this.cacheTTL)) {
      return this.statsCache.data
    }

    try {
      // 总订单数
      const totalOrdersRows = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM orders WHERE deleted = 0'
      )
      const totalOrders = totalOrdersRows[0].count

      // 按状态统计订单
      const orderStatusRows = await this.db.executeSql(`
        SELECT status, COUNT(*) as count
        FROM orders
        WHERE deleted = 0
        GROUP BY status
      `)

      const ordersByStatus = {}
      orderStatusRows.forEach(row => {
        ordersByStatus[row.status] = row.count
      })

      // 总交易数
      const totalTransactionsRows = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM transactions WHERE deleted = 0'
      )
      const totalTransactions = totalTransactionsRows[0].count

      // 按状态统计交易
      const transactionStatusRows = await this.db.executeSql(`
        SELECT status, COUNT(*) as count
        FROM transactions
        WHERE deleted = 0
        GROUP BY status
      `)

      const transactionsByStatus = {}
      transactionStatusRows.forEach(row => {
        transactionsByStatus[row.status] = row.count
      })

      // 平均评分
      const ratingRows = await this.db.executeSql(`
        SELECT AVG(review_rating) as avg_rating, COUNT(review_rating) as review_count
        FROM transactions
        WHERE deleted = 0 AND review_rating IS NOT NULL
      `)

      const avgRating = ratingRows[0].avg_rating || 0
      const reviewCount = ratingRows[0].review_count || 0

      const stats = {
        totalOrders,
        totalTransactions,
        ordersByStatus,
        transactionsByStatus,
        avgRating: parseFloat(avgRating.toFixed(2)),
        reviewCount,
        openOrders: ordersByStatus.open || 0,
        completedOrders: ordersByStatus.completed || 0,
        completedTransactions: transactionsByStatus.completed || 0
      }

      // 缓存
      this.statsCache = {
        data: stats,
        timestamp: Date.now()
      }

      return stats
    } catch (error) {
      console.error('[MarketplaceManager] 获取统计信息失败:', error)
      throw error
    }
  }

  /**
   * 获取热门订单
   * @param {number} [limit=10] - 数量限制
   * @returns {Promise<Array>} 热门订单列表
   */
  async getPopularOrders(limit = 10) {
    try {
      // 根据交易数量排序
      const sql = `
        SELECT o.*, COUNT(t.id) as transaction_count
        FROM orders o
        LEFT JOIN transactions t ON o.id = t.order_id
        WHERE o.deleted = 0 AND o.status = 'open'
        GROUP BY o.id
        ORDER BY transaction_count DESC, o.created_at DESC
        LIMIT ?
      `

      const rows = await this.db.executeSql(sql, [limit])
      return rows.map(row => this._parseOrder(row))
    } catch (error) {
      console.error('[MarketplaceManager] 获取热门订单失败:', error)
      throw error
    }
  }

  /**
   * 获取最新订单
   * @param {number} [limit=10] - 数量限制
   * @returns {Promise<Array>} 最新订单列表
   */
  async getRecentOrders(limit = 10) {
    try {
      const sql = `
        SELECT * FROM orders
        WHERE deleted = 0 AND status = 'open'
        ORDER BY created_at DESC
        LIMIT ?
      `

      const rows = await this.db.executeSql(sql, [limit])
      return rows.map(row => this._parseOrder(row))
    } catch (error) {
      console.error('[MarketplaceManager] 获取最新订单失败:', error)
      throw error
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 解析订单对象
   * @private
   */
  _parseOrder(row) {
    return {
      id: row.id,
      order_type: row.order_type,
      creator_did: row.creator_did,
      asset_id: row.asset_id,
      title: row.title,
      description: row.description,
      price_asset_id: row.price_asset_id,
      price_amount: row.price_amount,
      quantity: row.quantity,
      remaining_quantity: row.remaining_quantity,
      status: row.status,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }

  /**
   * 生成唯一ID
   * @private
   */
  _generateId() {
    return `market_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取当前用户DID
   * @private
   */
  _getCurrentDid() {
    if (!this.didManager) {
      throw new Error('DID管理器未初始化')
    }

    const identity = this.didManager.getCurrentIdentity()
    if (!identity) {
      throw new Error('未登录，请先登录')
    }

    return identity.did
  }

  /**
   * 清除所有缓存
   * @private
   */
  _clearCache() {
    this.orderCache.clear()
    this.transactionCache.clear()
    this._clearStatsCache()
  }

  /**
   * 清除统计缓存
   * @private
   */
  _clearStatsCache() {
    this.statsCache = null
  }
}

// ============================================================
// 导出
// ============================================================

let marketplaceManagerInstance = null

/**
 * 创建或获取市场管理器实例（单例模式）
 * @param {Object} db - 数据库实例
 * @param {Object} didManager - DID管理器实例
 * @param {Object} assetManager - 资产管理器实例
 * @returns {MarketplaceManager} 市场管理器实例
 */
export function createMarketplaceManager(db, didManager, assetManager) {
  if (!marketplaceManagerInstance) {
    marketplaceManagerInstance = new MarketplaceManager(db, didManager, assetManager)
  }
  return marketplaceManagerInstance
}

/**
 * 获取当前市场管理器实例
 * @returns {MarketplaceManager|null} 市场管理器实例
 */
export function getMarketplaceManager() {
  return marketplaceManagerInstance
}

export { MarketplaceManager, OrderType, OrderStatus, TransactionStatus }
export default { createMarketplaceManager, getMarketplaceManager, MarketplaceManager, OrderType, OrderStatus, TransactionStatus }
