/**
 * 移动端资产管理系统
 * Mobile Asset Management System
 *
 * 支持资产类型:
 * - Token: 可替代通证（如积分、代币）
 * - NFT: 非同质化代币（如证书、艺术品）
 * - Knowledge: 知识产品（如课程、文章）
 * - Service: 服务凭证（如会员、权益）
 *
 * 核心功能:
 * - 资产创建与管理
 * - 资产铸造（增发）
 * - 资产转账
 * - 资产销毁
 * - 余额查询
 * - 交易历史
 * - 统计分析
 *
 * @module asset-manager
 * @version 2.3.0
 * @since 2024-01-02
 */

/**
 * 资产类型枚举
 */
const AssetType = {
  TOKEN: 'token',           // 可替代通证
  NFT: 'nft',              // 非同质化代币
  KNOWLEDGE: 'knowledge',   // 知识产品
  SERVICE: 'service'        // 服务凭证
}

/**
 * 交易类型枚举
 */
const TransactionType = {
  TRANSFER: 'transfer',     // 转账
  MINT: 'mint',            // 铸造
  BURN: 'burn',            // 销毁
  TRADE: 'trade'           // 交易
}

/**
 * 资产状态枚举
 */
const AssetStatus = {
  ACTIVE: 'active',         // 活跃
  PAUSED: 'paused',        // 暂停
  DEPRECATED: 'deprecated'  // 已弃用
}

/**
 * 资产管理器类
 */
class AssetManager {
  /**
   * 构造函数
   * @param {Object} db - 数据库实例
   * @param {Object} didManager - DID管理器实例
   */
  constructor(db, didManager) {
    if (!db) {
      throw new Error('数据库实例不能为空')
    }

    this.db = db
    this.didManager = didManager
    this.initialized = false

    // 缓存系统
    this.assetCache = new Map()  // 资产缓存
    this.balanceCache = new Map()  // 余额缓存
    this.statsCache = null  // 统计缓存
    this.cacheTTL = 5 * 60 * 1000  // 5分钟缓存过期

    console.log('[AssetManager] 实例已创建')
  }

  /**
   * 初始化资产管理器
   */
  async initialize() {
    if (this.initialized) {
      console.log('[AssetManager] 已经初始化过，跳过')
      return
    }

    try {
      console.log('[AssetManager] 开始初始化...')

      // 创建数据库表
      await this._createTables()

      this.initialized = true
      console.log('[AssetManager] ✓ 初始化完成')
    } catch (error) {
      console.error('[AssetManager] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建数据库表
   * @private
   */
  async _createTables() {
    // 资产定义表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        asset_type TEXT NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT,
        description TEXT,
        metadata TEXT,
        creator_did TEXT NOT NULL,
        total_supply INTEGER DEFAULT 0,
        decimals INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `)

    // 资产持有表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS asset_holdings (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        owner_did TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        acquired_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `)

    // 资产转账记录表
    await this.db.executeSql(`
      CREATE TABLE IF NOT EXISTS asset_transfers (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        from_did TEXT NOT NULL,
        to_did TEXT NOT NULL,
        amount INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        memo TEXT,
        created_at INTEGER NOT NULL
      )
    `)

    // 创建索引
    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_assets_creator
      ON assets(creator_did) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_assets_type
      ON assets(asset_type) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_holdings_owner
      ON asset_holdings(owner_did) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_holdings_asset
      ON asset_holdings(asset_id) WHERE deleted = 0
    `)

    await this.db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_transfers_asset
      ON asset_transfers(asset_id)
    `)

    console.log('[AssetManager] ✓ 数据库表创建完成')
  }

  // ============================================================
  // 资产创建与管理
  // ============================================================

  /**
   * 创建资产
   * @param {Object} options - 资产选项
   * @param {string} options.type - 资产类型
   * @param {string} options.name - 资产名称
   * @param {string} [options.symbol] - 资产符号
   * @param {string} [options.description] - 描述
   * @param {Object} [options.metadata] - 元数据
   * @param {number} [options.totalSupply=0] - 总供应量
   * @param {number} [options.decimals=0] - 小数位数
   * @returns {Promise<Object>} 创建的资产
   */
  async createAsset(options) {
    const {
      type,
      name,
      symbol,
      description,
      metadata = {},
      totalSupply = 0,
      decimals = 0
    } = options

    try {
      // 1. 获取当前用户
      const currentDid = this._getCurrentDid()

      // 2. 验证参数
      this._validateAssetParams({ type, name, symbol, totalSupply, decimals })

      // 3. 生成资产ID
      const assetId = this._generateId()
      const now = Date.now()

      // 4. 确定最终供应量（NFT固定为1）
      const finalSupply = type === AssetType.NFT ? 1 : totalSupply

      // 5. 插入资产记录
      const asset = {
        id: assetId,
        asset_type: type,
        name: name.trim(),
        symbol: symbol ? symbol.toUpperCase() : null,
        description: description || null,
        metadata: JSON.stringify(metadata),
        creator_did: currentDid,
        total_supply: finalSupply,
        decimals,
        status: AssetStatus.ACTIVE,
        created_at: now,
        updated_at: now,
        deleted: 0
      }

      await this._insertAsset(asset)

      // 6. 如果有初始供应量，铸造给创建者
      if (finalSupply > 0) {
        await this.mintAsset(assetId, currentDid, finalSupply)
      }

      // 7. 清除缓存
      this._clearCache()

      console.log(`[AssetManager] ✓ 资产已创建: ${assetId} (${name})`)

      return {
        ...asset,
        metadata: JSON.parse(asset.metadata)
      }
    } catch (error) {
      console.error('[AssetManager] 创建资产失败:', error)
      throw error
    }
  }

  /**
   * 验证资产参数
   * @private
   */
  _validateAssetParams({ type, name, symbol, totalSupply, decimals }) {
    if (!Object.values(AssetType).includes(type)) {
      throw new Error(`无效的资产类型: ${type}`)
    }

    if (!name || name.trim().length === 0) {
      throw new Error('资产名称不能为空')
    }

    if (name.trim().length > 100) {
      throw new Error('资产名称过长（最多100字符）')
    }

    // Token类型需要symbol
    if (type === AssetType.TOKEN && !symbol) {
      throw new Error('Token资产必须指定symbol')
    }

    if (symbol && symbol.length > 10) {
      throw new Error('Symbol过长（最多10字符）')
    }

    if (totalSupply < 0) {
      throw new Error('总供应量不能为负数')
    }

    if (decimals < 0 || decimals > 18) {
      throw new Error('小数位数必须在0-18之间')
    }
  }

  /**
   * 插入资产到数据库
   * @private
   */
  async _insertAsset(asset) {
    const sql = `
      INSERT INTO assets (
        id, asset_type, name, symbol, description, metadata,
        creator_did, total_supply, decimals, status,
        created_at, updated_at, deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      asset.id,
      asset.asset_type,
      asset.name,
      asset.symbol,
      asset.description,
      asset.metadata,
      asset.creator_did,
      asset.total_supply,
      asset.decimals,
      asset.status,
      asset.created_at,
      asset.updated_at,
      asset.deleted
    ]

    await this.db.executeSql(sql, params)
  }

  /**
   * 获取资产信息
   * @param {string} assetId - 资产ID
   * @returns {Promise<Object|null>} 资产信息
   */
  async getAsset(assetId) {
    // 检查缓存
    const cached = this.assetCache.get(assetId)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    try {
      const sql = 'SELECT * FROM assets WHERE id = ? AND deleted = 0'
      const rows = await this.db.executeSql(sql, [assetId])

      if (rows.length === 0) {
        return null
      }

      const asset = this._parseAsset(rows[0])

      // 缓存
      this.assetCache.set(assetId, {
        data: asset,
        timestamp: Date.now()
      })

      return asset
    } catch (error) {
      console.error('[AssetManager] 获取资产失败:', error)
      throw error
    }
  }

  /**
   * 获取所有资产
   * @param {Object} [filters] - 过滤条件
   * @param {string} [filters.type] - 资产类型
   * @param {string} [filters.creatorDid] - 创建者DID
   * @param {string} [filters.status] - 资产状态
   * @param {number} [filters.limit] - 数量限制
   * @returns {Promise<Array>} 资产列表
   */
  async getAllAssets(filters = {}) {
    try {
      let sql = 'SELECT * FROM assets WHERE deleted = 0'
      const params = []

      // 类型过滤
      if (filters.type) {
        sql += ' AND asset_type = ?'
        params.push(filters.type)
      }

      // 创建者过滤
      if (filters.creatorDid) {
        sql += ' AND creator_did = ?'
        params.push(filters.creatorDid)
      }

      // 状态过滤
      if (filters.status) {
        sql += ' AND status = ?'
        params.push(filters.status)
      }

      sql += ' ORDER BY created_at DESC'

      // 限制数量
      if (filters.limit) {
        sql += ' LIMIT ?'
        params.push(filters.limit)
      }

      const rows = await this.db.executeSql(sql, params)
      return rows.map(row => this._parseAsset(row))
    } catch (error) {
      console.error('[AssetManager] 获取资产列表失败:', error)
      throw error
    }
  }

  /**
   * 更新资产信息
   * @param {string} assetId - 资产ID
   * @param {Object} updates - 更新的字段
   * @returns {Promise<Object>} 更新后的资产
   */
  async updateAsset(assetId, updates) {
    try {
      // 获取资产
      const asset = await this.getAsset(assetId)
      if (!asset) {
        throw new Error('资产不存在')
      }

      // 检查权限
      const currentDid = this._getCurrentDid()
      if (asset.creator_did !== currentDid) {
        throw new Error('只有创建者可以更新资产')
      }

      const allowedFields = ['name', 'description', 'metadata', 'status']
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
      params.push(assetId)

      const sql = `UPDATE assets SET ${fields.join(', ')} WHERE id = ? AND deleted = 0`

      await this.db.executeSql(sql, params)

      // 清除缓存
      this.assetCache.delete(assetId)
      this._clearStatsCache()

      // 返回更新后的资产
      return await this.getAsset(assetId)
    } catch (error) {
      console.error('[AssetManager] 更新资产失败:', error)
      throw error
    }
  }

  /**
   * 删除资产（软删除）
   * @param {string} assetId - 资产ID
   * @returns {Promise<void>}
   */
  async deleteAsset(assetId) {
    try {
      // 获取资产
      const asset = await this.getAsset(assetId)
      if (!asset) {
        throw new Error('资产不存在')
      }

      // 检查权限
      const currentDid = this._getCurrentDid()
      if (asset.creator_did !== currentDid) {
        throw new Error('只有创建者可以删除资产')
      }

      const sql = `
        UPDATE assets
        SET deleted = 1, updated_at = ?
        WHERE id = ? AND deleted = 0
      `

      await this.db.executeSql(sql, [Date.now(), assetId])

      // 清除缓存
      this.assetCache.delete(assetId)
      this._clearCache()

      console.log(`[AssetManager] ✓ 资产已删除: ${assetId}`)
    } catch (error) {
      console.error('[AssetManager] 删除资产失败:', error)
      throw error
    }
  }

  // ============================================================
  // 资产操作（铸造、转账、销毁）
  // ============================================================

  /**
   * 铸造资产（增发）
   * @param {string} assetId - 资产ID
   * @param {string} toDid - 接收者DID
   * @param {number} amount - 数量
   * @returns {Promise<Object>} 交易结果
   */
  async mintAsset(assetId, toDid, amount) {
    try {
      // 1. 验证
      if (amount <= 0) {
        throw new Error('铸造数量必须大于0')
      }

      // 2. 获取资产
      const asset = await this.getAsset(assetId)
      if (!asset) {
        throw new Error('资产不存在')
      }

      // 3. NFT不能铸造
      if (asset.asset_type === AssetType.NFT) {
        throw new Error('NFT资产不能铸造')
      }

      // 4. 检查权限（仅限创建者或系统）
      const currentDid = this._getCurrentDid()
      if (currentDid !== 'SYSTEM' && asset.creator_did !== currentDid) {
        throw new Error('只有创建者可以铸造资产')
      }

      const now = Date.now()
      const transferId = this._generateId()

      // 5. 更新总供应量
      await this.db.executeSql(
        'UPDATE assets SET total_supply = total_supply + ?, updated_at = ? WHERE id = ?',
        [amount, now, assetId]
      )

      // 6. 更新持有记录
      await this._updateHolding(assetId, toDid, amount, now)

      // 7. 记录转账
      await this._recordTransfer({
        id: transferId,
        asset_id: assetId,
        from_did: 'SYSTEM',
        to_did: toDid,
        amount,
        transaction_type: TransactionType.MINT,
        memo: null,
        created_at: now
      })

      // 8. 清除缓存
      this._clearBalanceCache(toDid, assetId)
      this.assetCache.delete(assetId)

      console.log(`[AssetManager] ✓ 资产已铸造: ${assetId} +${amount} -> ${toDid}`)

      return { success: true, transferId }
    } catch (error) {
      console.error('[AssetManager] 铸造资产失败:', error)
      throw error
    }
  }

  /**
   * 转账资产
   * @param {string} assetId - 资产ID
   * @param {string} toDid - 接收者DID
   * @param {number} amount - 数量
   * @param {string} [memo] - 备注
   * @returns {Promise<Object>} 交易结果
   */
  async transferAsset(assetId, toDid, amount, memo = '') {
    try {
      // 1. 验证
      const currentDid = this._getCurrentDid()

      if (currentDid === toDid) {
        throw new Error('不能转账给自己')
      }

      if (amount <= 0) {
        throw new Error('转账数量必须大于0')
      }

      // 2. 获取资产
      const asset = await this.getAsset(assetId)
      if (!asset) {
        throw new Error('资产不存在')
      }

      // 3. 检查余额
      const balance = await this.getBalance(currentDid, assetId)
      if (balance < amount) {
        throw new Error(`余额不足（当前: ${balance}, 需要: ${amount}）`)
      }

      const now = Date.now()
      const transferId = this._generateId()

      // 4. 扣除发送者余额
      await this._updateHolding(assetId, currentDid, -amount, now)

      // 5. 增加接收者余额
      await this._updateHolding(assetId, toDid, amount, now)

      // 6. 记录转账
      await this._recordTransfer({
        id: transferId,
        asset_id: assetId,
        from_did: currentDid,
        to_did: toDid,
        amount,
        transaction_type: TransactionType.TRANSFER,
        memo,
        created_at: now
      })

      // 7. 清除缓存
      this._clearBalanceCache(currentDid, assetId)
      this._clearBalanceCache(toDid, assetId)

      console.log(`[AssetManager] ✓ 资产已转账: ${assetId} ${currentDid} -> ${toDid} (${amount})`)

      return { success: true, transferId }
    } catch (error) {
      console.error('[AssetManager] 转账失败:', error)
      throw error
    }
  }

  /**
   * 销毁资产
   * @param {string} assetId - 资产ID
   * @param {number} amount - 数量
   * @returns {Promise<Object>} 交易结果
   */
  async burnAsset(assetId, amount) {
    try {
      // 1. 验证
      const currentDid = this._getCurrentDid()

      if (amount <= 0) {
        throw new Error('销毁数量必须大于0')
      }

      // 2. 获取资产
      const asset = await this.getAsset(assetId)
      if (!asset) {
        throw new Error('资产不存在')
      }

      // 3. 检查余额
      const balance = await this.getBalance(currentDid, assetId)
      if (balance < amount) {
        throw new Error(`余额不足（当前: ${balance}, 需要: ${amount}）`)
      }

      const now = Date.now()
      const transferId = this._generateId()

      // 4. 扣除余额
      await this._updateHolding(assetId, currentDid, -amount, now)

      // 5. 更新总供应量
      await this.db.executeSql(
        'UPDATE assets SET total_supply = total_supply - ?, updated_at = ? WHERE id = ?',
        [amount, now, assetId]
      )

      // 6. 记录转账
      await this._recordTransfer({
        id: transferId,
        asset_id: assetId,
        from_did: currentDid,
        to_did: 'BURNED',
        amount,
        transaction_type: TransactionType.BURN,
        memo: null,
        created_at: now
      })

      // 7. 清除缓存
      this._clearBalanceCache(currentDid, assetId)
      this.assetCache.delete(assetId)

      console.log(`[AssetManager] ✓ 资产已销毁: ${assetId} -${amount}`)

      return { success: true, transferId }
    } catch (error) {
      console.error('[AssetManager] 销毁资产失败:', error)
      throw error
    }
  }

  /**
   * 更新持有记录
   * @private
   */
  async _updateHolding(assetId, ownerDid, amount, timestamp) {
    // 检查是否已有持有记录
    const existingHolding = await this.db.executeSql(
      'SELECT * FROM asset_holdings WHERE asset_id = ? AND owner_did = ? AND deleted = 0',
      [assetId, ownerDid]
    )

    if (existingHolding.length > 0) {
      // 更新现有记录
      const newAmount = existingHolding[0].amount + amount

      if (newAmount < 0) {
        throw new Error('余额不足')
      }

      await this.db.executeSql(
        'UPDATE asset_holdings SET amount = ?, updated_at = ? WHERE asset_id = ? AND owner_did = ?',
        [newAmount, timestamp, assetId, ownerDid]
      )
    } else {
      // 创建新记录
      if (amount < 0) {
        throw new Error('余额不足')
      }

      const holdingId = this._generateId()
      await this.db.executeSql(`
        INSERT INTO asset_holdings (
          id, asset_id, owner_did, amount, metadata,
          acquired_at, updated_at, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [holdingId, assetId, ownerDid, amount, '{}', timestamp, timestamp, 0])
    }
  }

  /**
   * 记录转账
   * @private
   */
  async _recordTransfer(transfer) {
    const sql = `
      INSERT INTO asset_transfers (
        id, asset_id, from_did, to_did, amount,
        transaction_type, memo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `

    const params = [
      transfer.id,
      transfer.asset_id,
      transfer.from_did,
      transfer.to_did,
      transfer.amount,
      transfer.transaction_type,
      transfer.memo,
      transfer.created_at
    ]

    await this.db.executeSql(sql, params)
  }

  // ============================================================
  // 查询功能
  // ============================================================

  /**
   * 获取用户的所有资产
   * @param {string} ownerDid - 所有者DID
   * @returns {Promise<Array>} 资产列表
   */
  async getAssetsByOwner(ownerDid) {
    try {
      // 由于uni-app的SQLite不支持JOIN，需要分步查询
      const holdings = await this.db.executeSql(`
        SELECT * FROM asset_holdings
        WHERE owner_did = ? AND amount > 0 AND deleted = 0
        ORDER BY updated_at DESC
      `, [ownerDid])

      // 获取每个持有的资产信息
      const assets = []
      for (const holding of holdings) {
        const asset = await this.getAsset(holding.asset_id)
        if (asset) {
          assets.push({
            ...holding,
            asset_type: asset.asset_type,
            name: asset.name,
            symbol: asset.symbol,
            description: asset.description,
            decimals: asset.decimals,
            metadata: holding.metadata ? JSON.parse(holding.metadata) : {}
          })
        }
      }

      return assets
    } catch (error) {
      console.error('[AssetManager] 获取用户资产失败:', error)
      throw error
    }
  }

  /**
   * 获取余额
   * @param {string} ownerDid - 所有者DID
   * @param {string} assetId - 资产ID
   * @returns {Promise<number>} 余额
   */
  async getBalance(ownerDid, assetId) {
    // 检查缓存
    const cacheKey = `${ownerDid}:${assetId}`
    const cached = this.balanceCache.get(cacheKey)
    if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
      return cached.data
    }

    try {
      const rows = await this.db.executeSql(`
        SELECT amount FROM asset_holdings
        WHERE owner_did = ? AND asset_id = ? AND deleted = 0
      `, [ownerDid, assetId])

      const balance = rows.length > 0 ? rows[0].amount : 0

      // 缓存
      this.balanceCache.set(cacheKey, {
        data: balance,
        timestamp: Date.now()
      })

      return balance
    } catch (error) {
      console.error('[AssetManager] 获取余额失败:', error)
      return 0
    }
  }

  /**
   * 获取资产历史记录
   * @param {string} assetId - 资产ID
   * @param {number} [limit=100] - 限制数量
   * @returns {Promise<Array>} 交易历史
   */
  async getAssetHistory(assetId, limit = 100) {
    try {
      const sql = `
        SELECT * FROM asset_transfers
        WHERE asset_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `

      return await this.db.executeSql(sql, [assetId, limit])
    } catch (error) {
      console.error('[AssetManager] 获取资产历史失败:', error)
      throw error
    }
  }

  /**
   * 获取用户的交易历史
   * @param {string} userDid - 用户DID
   * @param {number} [limit=100] - 限制数量
   * @returns {Promise<Array>} 交易历史
   */
  async getUserHistory(userDid, limit = 100) {
    try {
      const sql = `
        SELECT * FROM asset_transfers
        WHERE from_did = ? OR to_did = ?
        ORDER BY created_at DESC
        LIMIT ?
      `

      return await this.db.executeSql(sql, [userDid, userDid, limit])
    } catch (error) {
      console.error('[AssetManager] 获取用户历史失败:', error)
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
      // 总资产数
      const totalRows = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM assets WHERE deleted = 0'
      )
      const total = totalRows[0].count

      // 按类型统计
      const typeRows = await this.db.executeSql(`
        SELECT asset_type, COUNT(*) as count, SUM(total_supply) as total_supply
        FROM assets
        WHERE deleted = 0
        GROUP BY asset_type
      `)

      const byType = {}
      typeRows.forEach(row => {
        byType[row.asset_type] = {
          count: row.count,
          totalSupply: row.total_supply || 0
        }
      })

      // 按状态统计
      const statusRows = await this.db.executeSql(`
        SELECT status, COUNT(*) as count
        FROM assets
        WHERE deleted = 0
        GROUP BY status
      `)

      const byStatus = {}
      statusRows.forEach(row => {
        byStatus[row.status] = row.count
      })

      // 总交易数
      const transferRows = await this.db.executeSql(
        'SELECT COUNT(*) as count FROM asset_transfers'
      )
      const totalTransfers = transferRows[0].count

      const stats = {
        total,
        byType,
        byStatus,
        totalTransfers,
        token: byType.token?.count || 0,
        nft: byType.nft?.count || 0,
        knowledge: byType.knowledge?.count || 0,
        service: byType.service?.count || 0,
        active: byStatus.active || 0,
        paused: byStatus.paused || 0,
        deprecated: byStatus.deprecated || 0
      }

      // 缓存
      this.statsCache = {
        data: stats,
        timestamp: Date.now()
      }

      return stats
    } catch (error) {
      console.error('[AssetManager] 获取统计信息失败:', error)
      throw error
    }
  }

  /**
   * 获取最近创建的资产
   * @param {number} [limit=10] - 数量限制
   * @returns {Promise<Array>} 资产列表
   */
  async getRecentAssets(limit = 10) {
    try {
      const sql = `
        SELECT * FROM assets
        WHERE deleted = 0
        ORDER BY created_at DESC
        LIMIT ?
      `

      const rows = await this.db.executeSql(sql, [limit])
      return rows.map(row => this._parseAsset(row))
    } catch (error) {
      console.error('[AssetManager] 获取最近资产失败:', error)
      throw error
    }
  }

  /**
   * 获取最活跃的资产
   * @param {number} [limit=10] - 数量限制
   * @returns {Promise<Array>} 资产列表
   */
  async getMostActiveAssets(limit = 10) {
    try {
      // 统计每个资产的交易次数
      const sql = `
        SELECT asset_id, COUNT(*) as transfer_count
        FROM asset_transfers
        GROUP BY asset_id
        ORDER BY transfer_count DESC
        LIMIT ?
      `

      const rows = await this.db.executeSql(sql, [limit])

      // 获取资产详情
      const assets = []
      for (const row of rows) {
        const asset = await this.getAsset(row.asset_id)
        if (asset) {
          assets.push({
            ...asset,
            transfer_count: row.transfer_count
          })
        }
      }

      return assets
    } catch (error) {
      console.error('[AssetManager] 获取活跃资产失败:', error)
      throw error
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 解析资产对象
   * @private
   */
  _parseAsset(row) {
    return {
      id: row.id,
      asset_type: row.asset_type,
      name: row.name,
      symbol: row.symbol,
      description: row.description,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      creator_did: row.creator_did,
      total_supply: row.total_supply,
      decimals: row.decimals,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at
    }
  }

  /**
   * 生成唯一ID
   * @private
   */
  _generateId() {
    return `asset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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
    this.assetCache.clear()
    this.balanceCache.clear()
    this._clearStatsCache()
  }

  /**
   * 清除统计缓存
   * @private
   */
  _clearStatsCache() {
    this.statsCache = null
  }

  /**
   * 清除余额缓存
   * @private
   */
  _clearBalanceCache(ownerDid, assetId) {
    const cacheKey = `${ownerDid}:${assetId}`
    this.balanceCache.delete(cacheKey)
  }

  /**
   * 格式化资产数量
   * @param {number} amount - 原始数量
   * @param {number} decimals - 小数位数
   * @returns {string} 格式化后的数量
   */
  static formatAmount(amount, decimals) {
    if (decimals === 0) {
      return amount.toString()
    }

    const divisor = Math.pow(10, decimals)
    return (amount / divisor).toFixed(decimals)
  }

  /**
   * 解析资产数量
   * @param {string} formattedAmount - 格式化的数量
   * @param {number} decimals - 小数位数
   * @returns {number} 原始数量
   */
  static parseAmount(formattedAmount, decimals) {
    if (decimals === 0) {
      return parseInt(formattedAmount)
    }

    const multiplier = Math.pow(10, decimals)
    return Math.floor(parseFloat(formattedAmount) * multiplier)
  }
}

// ============================================================
// 导出
// ============================================================

let assetManagerInstance = null

/**
 * 创建或获取资产管理器实例（单例模式）
 * @param {Object} db - 数据库实例
 * @param {Object} didManager - DID管理器实例
 * @returns {AssetManager} 资产管理器实例
 */
export function createAssetManager(db, didManager) {
  if (!assetManagerInstance) {
    assetManagerInstance = new AssetManager(db, didManager)
  }
  return assetManagerInstance
}

/**
 * 获取当前资产管理器实例
 * @returns {AssetManager|null} 资产管理器实例
 */
export function getAssetManager() {
  return assetManagerInstance
}

export { AssetManager, AssetType, TransactionType, AssetStatus }
export default { createAssetManager, getAssetManager, AssetManager, AssetType, TransactionType, AssetStatus }
