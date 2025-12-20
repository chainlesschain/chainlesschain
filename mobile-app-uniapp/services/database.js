/**
 * ChainlessChain Mobile - SQLite 数据库服务
 * 参考 desktop-app-vue 的数据库设计
 * 支持 H5 (localStorage) 和 App (SQLite) 双模式
 */

class DatabaseService {
  constructor() {
    this.dbName = 'chainlesschain.db'
    this.dbPath = '_doc/chainlesschain.db'
    this.isOpen = false
    this.encryptionKey = null // PIN码派生的加密密钥
    this.h5Data = null // H5模式下的内存数据存储

    // 检测运行平台
    // #ifdef H5
    this.isH5 = true
    // #endif
    // #ifndef H5
    this.isH5 = false
    // #endif

    // 如果条件编译不生效，使用运行时检测
    if (this.isH5 === undefined) {
      this.isH5 = typeof plus === 'undefined'
    }

    console.log('[Database] 平台检测:', this.isH5 ? 'H5' : 'App')
  }

  /**
   * 初始化数据库
   * @param {string} pin PIN码（用于派生加密密钥）
   */
  async init(pin) {
    // 派生加密密钥
    this.encryptionKey = this.deriveKey(pin)

    if (this.isH5) {
      return this.initH5()
    } else {
      return this.initApp()
    }
  }

  /**
   * H5模式初始化（使用localStorage）
   */
  async initH5() {
    console.log('[Database] 数据库初始化 (H5模式)')

    try {
      // 从localStorage加载数据
      const stored = uni.getStorageSync('chainlesschain_db')
      if (stored) {
        try {
          this.h5Data = JSON.parse(stored)
          console.log('[Database] 从 localStorage 加载数据')
        } catch (parseError) {
          console.warn('[Database] 解析存储数据失败，使用空数据结构')
          this.h5Data = null
        }
      }

      // 确保数据结构存在
      if (!this.h5Data || typeof this.h5Data !== 'object') {
        // 初始化空数据结构
        this.h5Data = {
          knowledge_items: [],
          tags: [],
          knowledge_tags: [],
          conversations: [],
          messages: [],
          friendships: [],
          posts: [],
          post_comments: [],
          market_listings: [],
          orders: [],
          user_assets: [],
          transactions: []
        }
        this.saveH5Data()
        console.log('[Database] 初始化空数据结构')
      }

      this.isOpen = true
      console.log('[Database] 数据库打开成功 (H5模式)', {
        knowledge_items: this.h5Data.knowledge_items?.length || 0,
        conversations: this.h5Data.conversations?.length || 0
      })
      return Promise.resolve()
    } catch (error) {
      console.error('[Database] 数据库初始化失败 (H5模式):', error)
      return Promise.reject(error)
    }
  }

  /**
   * App模式初始化（使用SQLite）
   */
  async initApp() {
    return new Promise((resolve, reject) => {
      try {
        // 打开数据库
        plus.sqlite.openDatabase({
          name: this.dbName,
          path: this.dbPath,
          success: (e) => {
            console.log('数据库打开成功 (App模式)')
            this.isOpen = true
            // 创建表
            this.createTables()
              .then(() => resolve())
              .catch((error) => reject(error))
          },
          fail: (e) => {
            console.error('数据库打开失败:', e)
            reject(e)
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 保存H5数据到localStorage
   */
  saveH5Data() {
    if (this.isH5 && this.h5Data) {
      try {
        uni.setStorageSync('chainlesschain_db', JSON.stringify(this.h5Data))
      } catch (error) {
        console.error('[Database] 保存H5数据失败:', error)
      }
    }
  }

  /**
   * 确保H5数据结构存在
   */
  ensureH5Data(tableName) {
    if (!this.h5Data) {
      console.warn('[Database] h5Data 未初始化，尝试初始化')
      this.h5Data = {
        knowledge_items: [],
        tags: [],
        knowledge_tags: [],
        conversations: [],
        messages: [],
        friendships: [],
        posts: [],
        post_comments: [],
        market_listings: [],
        orders: [],
        user_assets: [],
        transactions: []
      }
    }

    if (!Array.isArray(this.h5Data[tableName])) {
      console.warn(`[Database] 表 ${tableName} 不存在，创建空数组`)
      this.h5Data[tableName] = []
    }
  }

  /**
   * 从PIN码派生加密密钥（简化版本，生产环境需使用 PBKDF2）
   * @param {string} pin PIN码
   * @returns {string} 加密密钥
   */
  deriveKey(pin) {
    // TODO: 实际应使用 PBKDF2 或其他密钥派生函数
    return `key_${pin}_salt`
  }

  /**
   * 创建数据库表
   */
  async createTables() {
    const tables = [
      // 知识库项表
      `CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT CHECK(type IN ('note', 'document', 'conversation', 'web_clip', 'image')),
        content TEXT,
        encrypted_content TEXT,
        is_favorite INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        device_id TEXT,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'local'))
      )`,

      // 标签表
      `CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,

      // 知识库-标签关联表
      `CREATE TABLE IF NOT EXISTS knowledge_tags (
        knowledge_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        PRIMARY KEY (knowledge_id, tag_id),
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )`,

      // 对话表
      `CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        knowledge_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE SET NULL
      )`,

      // 消息表
      `CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )`,

      // 好友表
      `CREATE TABLE IF NOT EXISTS friendships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_did TEXT NOT NULL,
        friend_did TEXT NOT NULL,
        nickname TEXT,
        group_name TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'blocked')),
        created_at INTEGER NOT NULL
      )`,

      // 动态表
      `CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        images TEXT,
        visibility TEXT NOT NULL CHECK(visibility IN ('public', 'friends')),
        like_count INTEGER DEFAULT 0,
        comment_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,

      // 评论表
      `CREATE TABLE IF NOT EXISTS post_comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        parent_id TEXT,
        created_at INTEGER NOT NULL
      )`,

      // 市场商品表
      `CREATE TABLE IF NOT EXISTS market_listings (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        seller_did TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('on_sale', 'sold', 'removed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      )`,

      // 订单表
      `CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        knowledge_id TEXT NOT NULL,
        buyer_did TEXT NOT NULL,
        seller_did TEXT NOT NULL,
        price REAL NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'cancelled')),
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )`,

      // 用户资产表
      `CREATE TABLE IF NOT EXISTS user_assets (
        user_did TEXT PRIMARY KEY,
        balance REAL DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,

      // 交易记录表
      `CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('buy', 'sell', 'deposit', 'withdraw')),
        amount REAL NOT NULL,
        knowledge_id TEXT,
        order_id TEXT,
        created_at INTEGER NOT NULL
      )`
    ]

    for (const sql of tables) {
      await this.executeSql(sql)
    }

    console.log('数据库表创建完成')
  }

  /**
   * 执行 SQL 语句
   * @param {string} sql SQL语句
   * @param {Array} params 参数
   * @returns {Promise} 执行结果
   */
  async executeSql(sql, params = []) {
    if (this.isH5) {
      // H5模式：直接返回成功（表创建等操作在H5中不需要）
      return Promise.resolve({ code: 0 })
    }

    return new Promise((resolve, reject) => {
      plus.sqlite.executeSql({
        name: this.dbName,
        sql: sql,
        params: params,
        success: (e) => {
          resolve(e)
        },
        fail: (e) => {
          console.error('SQL执行失败:', sql, e)
          reject(e)
        }
      })
    })
  }

  /**
   * 查询数据
   * @param {string} sql SQL语句
   * @param {Array} params 参数
   * @returns {Promise<Array>} 查询结果
   */
  async selectSql(sql, params = []) {
    if (this.isH5) {
      // H5模式：解析SQL并从内存数据中查询
      return this.selectH5(sql, params)
    }

    return new Promise((resolve, reject) => {
      plus.sqlite.selectSql({
        name: this.dbName,
        sql: sql,
        params: params,
        success: (e) => {
          resolve(e)
        },
        fail: (e) => {
          console.error('SQL查询失败:', sql, e)
          reject(e)
        }
      })
    })
  }

  /**
   * H5模式：简化的SQL查询解析
   */
  selectH5(sql, params = []) {
    // 解析表名
    const tableMatch = sql.match(/FROM\s+(\w+)/i)
    if (!tableMatch) {
      return Promise.resolve([])
    }

    const tableName = tableMatch[1]

    // 确保数据结构存在
    this.ensureH5Data(tableName)

    let data = [...(this.h5Data[tableName] || [])]

    // 简单的参数替换（用于WHERE条件）
    // 这是一个简化实现，生产环境应使用更完善的SQL解析器
    let processedSql = sql
    params.forEach((param) => {
      processedSql = processedSql.replace('?', `'${param}'`)
    })

    // 步骤1: WHERE条件过滤
    // 简单的WHERE处理（仅支持LIKE查询）
    const likeMatch = processedSql.match(/\((\w+)\s+LIKE\s+'([^']+)'\s+OR\s+(\w+)\s+LIKE\s+'([^']+)'\)/i)
    if (likeMatch) {
      const field1 = likeMatch[1]
      const value1 = likeMatch[2].replace(/%/g, '')
      const field2 = likeMatch[3]
      const value2 = likeMatch[4].replace(/%/g, '')

      data = data.filter(item =>
        (item[field1] && item[field1].includes(value1)) ||
        (item[field2] && item[field2].includes(value2))
      )
    }

    // 简单的WHERE = 处理
    const whereMatch = processedSql.match(/WHERE\s+(\w+)\s*=\s*'([^']+)'/i)
    if (whereMatch && !likeMatch) {
      const field = whereMatch[1]
      const value = whereMatch[2]
      data = data.filter(item => item[field] === value)
    }

    // 步骤2: ORDER BY排序
    const orderMatch = processedSql.match(/ORDER\s+BY\s+(\w+)\s+(ASC|DESC)/i)
    if (orderMatch) {
      const field = orderMatch[1]
      const order = orderMatch[2].toUpperCase()
      data = data.sort((a, b) => {
        if (order === 'DESC') {
          return b[field] - a[field]
        }
        return a[field] - b[field]
      })
    }

    // 步骤3: LIMIT和OFFSET（必须在最后）
    const limitMatch = processedSql.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i)
    if (limitMatch) {
      const limit = parseInt(limitMatch[1])
      const offset = limitMatch[2] ? parseInt(limitMatch[2]) : 0
      data = data.slice(offset, offset + limit)
    }

    return Promise.resolve(data)
  }

  /**
   * 关闭数据库
   */
  async close() {
    return new Promise((resolve, reject) => {
      plus.sqlite.closeDatabase({
        name: this.dbName,
        success: () => {
          this.isOpen = false
          resolve()
        },
        fail: (e) => {
          reject(e)
        }
      })
    })
  }

  /**
   * 生成UUID
   */
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  /**
   * 获取当前时间戳
   */
  now() {
    return Date.now()
  }

  // ==================== 知识库 CRUD ====================

  /**
   * 添加知识库项
   */
  async addKnowledgeItem(item) {
    const id = item.id || this.generateId()
    const now = this.now()

    const newItem = {
      id,
      title: item.title,
      type: item.type || 'note',
      content: item.content || '',
      is_favorite: item.is_favorite || 0,
      created_at: now,
      updated_at: now,
      device_id: item.deviceId || uni.getSystemInfoSync().deviceId,
      sync_status: 'pending'
    }

    if (this.isH5) {
      // H5模式：添加到内存数组
      this.ensureH5Data('knowledge_items')
      this.h5Data.knowledge_items.push(newItem)
      this.saveH5Data()
      console.log('[Database] 添加知识条目:', newItem.id)
      return newItem
    }

    // App模式：插入SQLite
    const sql = `INSERT INTO knowledge_items
      (id, title, type, content, is_favorite, created_at, updated_at, device_id, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

    const params = [
      newItem.id,
      newItem.title,
      newItem.type,
      newItem.content,
      newItem.is_favorite,
      newItem.created_at,
      newItem.updated_at,
      newItem.device_id,
      newItem.sync_status
    ]

    await this.executeSql(sql, params)

    return newItem
  }

  /**
   * 获取知识库项列表
   */
  async getKnowledgeItems(options = {}) {
    const { limit = 20, offset = 0, type = null, searchQuery = '', tagId = null, favoriteOnly = false } = options

    let sql = 'SELECT * FROM knowledge_items WHERE 1=1'
    const params = []

    if (type) {
      sql += ' AND type = ?'
      params.push(type)
    }

    if (searchQuery) {
      sql += ' AND (title LIKE ? OR content LIKE ?)'
      const searchParam = `%${searchQuery}%`
      params.push(searchParam, searchParam)
    }

    if (favoriteOnly) {
      sql += ' AND is_favorite = 1'
    }

    if (tagId) {
      sql += ' AND id IN (SELECT knowledge_id FROM knowledge_tags WHERE tag_id = ?)'
      params.push(tagId)
    }

    sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const result = await this.selectSql(sql, params)
    return result
  }

  /**
   * 获取单个知识库项
   */
  async getKnowledgeItem(id) {
    const sql = 'SELECT * FROM knowledge_items WHERE id = ?'
    const result = await this.selectSql(sql, [id])
    return result && result.length > 0 ? result[0] : null
  }

  /**
   * 更新知识库项
   */
  async updateKnowledgeItem(id, updates) {
    const now = this.now()

    if (this.isH5) {
      // H5模式：更新内存数组
      this.ensureH5Data('knowledge_items')
      const index = this.h5Data.knowledge_items.findIndex(item => item.id === id)
      if (index !== -1) {
        Object.assign(this.h5Data.knowledge_items[index], updates, {
          updated_at: now,
          sync_status: 'pending'
        })
        this.saveH5Data()
      }
      return { id, ...updates, updated_at: now }
    }

    // App模式：更新SQLite
    const fields = []
    const params = []

    if (updates.title !== undefined) {
      fields.push('title = ?')
      params.push(updates.title)
    }

    if (updates.content !== undefined) {
      fields.push('content = ?')
      params.push(updates.content)
    }

    if (updates.type !== undefined) {
      fields.push('type = ?')
      params.push(updates.type)
    }

    fields.push('updated_at = ?', 'sync_status = ?')
    params.push(now, 'pending')

    params.push(id)

    const sql = `UPDATE knowledge_items SET ${fields.join(', ')} WHERE id = ?`

    await this.executeSql(sql, params)

    return { id, ...updates, updated_at: now }
  }

  /**
   * 删除知识库项
   */
  async deleteKnowledgeItem(id) {
    if (this.isH5) {
      // H5模式：从内存数组删除
      this.ensureH5Data('knowledge_items')
      this.h5Data.knowledge_items = this.h5Data.knowledge_items.filter(item => item.id !== id)
      // 同时删除关联的标签
      this.ensureH5Data('knowledge_tags')
      this.h5Data.knowledge_tags = this.h5Data.knowledge_tags.filter(kt => kt.knowledge_id !== id)
      this.saveH5Data()
      return { id }
    }

    // App模式：从SQLite删除
    const sql = 'DELETE FROM knowledge_items WHERE id = ?'
    await this.executeSql(sql, [id])
    // 标签关联会通过外键自动删除
    return { id }
  }

  /**
   * 切换知识库项收藏状态
   */
  async toggleKnowledgeFavorite(id) {
    const item = await this.getKnowledgeItem(id)
    if (!item) {
      throw new Error('知识条目不存在')
    }

    const is_favorite = item.is_favorite ? 0 : 1

    if (this.isH5) {
      this.ensureH5Data('knowledge_items')
      const index = this.h5Data.knowledge_items.findIndex(item => item.id === id)
      if (index !== -1) {
        this.h5Data.knowledge_items[index].is_favorite = is_favorite
        this.h5Data.knowledge_items[index].updated_at = this.now()
        this.saveH5Data()
      }
      return { id, is_favorite }
    }

    const sql = 'UPDATE knowledge_items SET is_favorite = ?, updated_at = ? WHERE id = ?'
    await this.executeSql(sql, [is_favorite, this.now(), id])
    return { id, is_favorite }
  }

  // ==================== 标签管理 ====================

  /**
   * 获取所有标签
   */
  async getTags() {
    if (this.isH5) {
      this.ensureH5Data('tags')
      // 统计每个标签的使用次数
      this.ensureH5Data('knowledge_tags')
      return this.h5Data.tags.map(tag => ({
        ...tag,
        count: this.h5Data.knowledge_tags.filter(kt => kt.tag_id === tag.id).length
      }))
    }

    const sql = `
      SELECT t.*, COUNT(kt.knowledge_id) as count
      FROM tags t
      LEFT JOIN knowledge_tags kt ON t.id = kt.tag_id
      GROUP BY t.id
      ORDER BY count DESC, t.name ASC
    `
    const result = await this.selectSql(sql, [])
    return result || []
  }

  /**
   * 创建标签
   */
  async createTag(name, color = '#3cc51f') {
    const id = this.generateId()
    const now = this.now()

    const newTag = {
      id,
      name,
      color,
      created_at: now
    }

    if (this.isH5) {
      this.ensureH5Data('tags')
      // 检查是否已存在同名标签
      const existing = this.h5Data.tags.find(t => t.name === name)
      if (existing) {
        return existing
      }
      this.h5Data.tags.push(newTag)
      this.saveH5Data()
      return newTag
    }

    // App模式：插入SQLite
    const checkSql = 'SELECT * FROM tags WHERE name = ?'
    const existing = await this.selectSql(checkSql, [name])
    if (existing && existing.length > 0) {
      return existing[0]
    }

    const sql = 'INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)'
    await this.executeSql(sql, [id, name, color, now])
    return newTag
  }

  /**
   * 删除标签
   */
  async deleteTag(id) {
    if (this.isH5) {
      this.ensureH5Data('tags')
      this.h5Data.tags = this.h5Data.tags.filter(tag => tag.id !== id)
      // 删除关联
      this.ensureH5Data('knowledge_tags')
      this.h5Data.knowledge_tags = this.h5Data.knowledge_tags.filter(kt => kt.tag_id !== id)
      this.saveH5Data()
      return { id }
    }

    const sql = 'DELETE FROM tags WHERE id = ?'
    await this.executeSql(sql, [id])
    return { id }
  }

  /**
   * 获取知识库项的标签
   */
  async getKnowledgeTags(knowledgeId) {
    if (this.isH5) {
      this.ensureH5Data('knowledge_tags')
      this.ensureH5Data('tags')

      const tagIds = this.h5Data.knowledge_tags
        .filter(kt => kt.knowledge_id === knowledgeId)
        .map(kt => kt.tag_id)

      return this.h5Data.tags.filter(tag => tagIds.includes(tag.id))
    }

    const sql = `
      SELECT t.*
      FROM tags t
      INNER JOIN knowledge_tags kt ON t.id = kt.tag_id
      WHERE kt.knowledge_id = ?
      ORDER BY t.name ASC
    `
    const result = await this.selectSql(sql, [knowledgeId])
    return result || []
  }

  /**
   * 为知识库项添加标签
   */
  async addKnowledgeTag(knowledgeId, tagId) {
    const id = this.generateId()

    if (this.isH5) {
      this.ensureH5Data('knowledge_tags')
      // 检查是否已存在
      const existing = this.h5Data.knowledge_tags.find(
        kt => kt.knowledge_id === knowledgeId && kt.tag_id === tagId
      )
      if (existing) {
        return existing
      }

      const newKnowledgeTag = { id, knowledge_id: knowledgeId, tag_id: tagId }
      this.h5Data.knowledge_tags.push(newKnowledgeTag)
      this.saveH5Data()
      return newKnowledgeTag
    }

    // 检查是否已存在
    const checkSql = 'SELECT * FROM knowledge_tags WHERE knowledge_id = ? AND tag_id = ?'
    const existing = await this.selectSql(checkSql, [knowledgeId, tagId])
    if (existing && existing.length > 0) {
      return existing[0]
    }

    const sql = 'INSERT INTO knowledge_tags (id, knowledge_id, tag_id) VALUES (?, ?, ?)'
    await this.executeSql(sql, [id, knowledgeId, tagId])
    return { id, knowledge_id: knowledgeId, tag_id: tagId }
  }

  /**
   * 移除知识库项的标签
   */
  async removeKnowledgeTag(knowledgeId, tagId) {
    if (this.isH5) {
      this.ensureH5Data('knowledge_tags')
      this.h5Data.knowledge_tags = this.h5Data.knowledge_tags.filter(
        kt => !(kt.knowledge_id === knowledgeId && kt.tag_id === tagId)
      )
      this.saveH5Data()
      return { knowledgeId, tagId }
    }

    const sql = 'DELETE FROM knowledge_tags WHERE knowledge_id = ? AND tag_id = ?'
    await this.executeSql(sql, [knowledgeId, tagId])
    return { knowledgeId, tagId }
  }

  /**
   * 设置知识库项的标签（覆盖式）
   */
  async setKnowledgeTags(knowledgeId, tagIds) {
    if (this.isH5) {
      this.ensureH5Data('knowledge_tags')
      // 删除旧的标签关联
      this.h5Data.knowledge_tags = this.h5Data.knowledge_tags.filter(
        kt => kt.knowledge_id !== knowledgeId
      )
      // 添加新的标签关联
      for (const tagId of tagIds) {
        await this.addKnowledgeTag(knowledgeId, tagId)
      }
      return { knowledgeId, tagIds }
    }

    // 删除旧的标签关联
    await this.executeSql('DELETE FROM knowledge_tags WHERE knowledge_id = ?', [knowledgeId])

    // 添加新的标签关联
    for (const tagId of tagIds) {
      await this.addKnowledgeTag(knowledgeId, tagId)
    }

    return { knowledgeId, tagIds }
  }

  /**
   * 按标签获取知识库项
   */
  async getKnowledgeItemsByTag(tagId, options = {}) {
    const { limit = 20, offset = 0 } = options

    if (this.isH5) {
      this.ensureH5Data('knowledge_tags')
      this.ensureH5Data('knowledge_items')

      const knowledgeIds = this.h5Data.knowledge_tags
        .filter(kt => kt.tag_id === tagId)
        .map(kt => kt.knowledge_id)

      return this.h5Data.knowledge_items
        .filter(item => knowledgeIds.includes(item.id))
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(offset, offset + limit)
    }

    const sql = `
      SELECT k.*
      FROM knowledge_items k
      INNER JOIN knowledge_tags kt ON k.id = kt.knowledge_id
      WHERE kt.tag_id = ?
      ORDER BY k.updated_at DESC
      LIMIT ? OFFSET ?
    `
    const result = await this.selectSql(sql, [tagId, limit, offset])
    return result || []
  }

  // ==================== 对话 CRUD ====================

  /**
   * 创建新对话
   */
  async createConversation(title, knowledgeId = null) {
    const id = this.generateId()
    const now = this.now()

    const newConversation = {
      id,
      title,
      knowledge_id: knowledgeId,
      created_at: now,
      updated_at: now
    }

    if (this.isH5) {
      // H5模式：添加到内存数组
      this.ensureH5Data('conversations')
      this.h5Data.conversations.push(newConversation)
      this.saveH5Data()
      console.log('[Database] 创建对话:', newConversation.id)
      return newConversation
    }

    // App模式：插入SQLite
    const sql = `INSERT INTO conversations
      (id, title, knowledge_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`

    await this.executeSql(sql, [id, title, knowledgeId, now, now])

    return newConversation
  }

  /**
   * 添加消息
   */
  async addMessage(conversationId, role, content, tokens = 0) {
    const id = this.generateId()
    const now = this.now()

    const newMessage = {
      id,
      conversation_id: conversationId,
      role,
      content,
      timestamp: now,
      tokens
    }

    if (this.isH5) {
      // H5模式：添加到内存数组
      this.ensureH5Data('messages')
      this.h5Data.messages.push(newMessage)
      this.saveH5Data()
      return newMessage
    }

    // App模式：插入SQLite
    const sql = `INSERT INTO messages
      (id, conversation_id, role, content, timestamp, tokens)
      VALUES (?, ?, ?, ?, ?, ?)`

    await this.executeSql(sql, [id, conversationId, role, content, now, tokens])

    return newMessage
  }

  /**
   * 获取对话消息
   */
  async getMessages(conversationId, limit = 50) {
    const sql = `SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
      LIMIT ?`

    const result = await this.selectSql(sql, [conversationId, limit])
    return result || []
  }

  /**
   * 更新对话时间
   */
  async updateConversationTime(conversationId) {
    const now = this.now()

    if (this.isH5) {
      // H5模式：更新内存中的数据
      this.ensureH5Data('conversations')
      const conversation = this.h5Data.conversations.find(c => c.id === conversationId)
      if (conversation) {
        conversation.updated_at = now
        this.saveH5Data()
      }
      return
    }

    // App模式：更新SQLite
    const sql = `UPDATE conversations SET updated_at = ? WHERE id = ?`
    await this.executeSql(sql, [now, conversationId])
  }

  // ==================== 好友消息 ====================

  /**
   * 创建或获取好友对话
   * @param {string} friendDid 好友的DID
   * @param {string} nickname 好友昵称
   * @returns {Promise<Object>} 对话对象
   */
  async getOrCreateFriendConversation(friendDid, nickname) {
    // 标题格式：FRIEND:{friendDid}:{nickname}
    const titlePrefix = `FRIEND:${friendDid}`

    // 查找是否已存在
    const sql = `SELECT * FROM conversations WHERE title LIKE ?`
    const existing = await this.selectSql(sql, [`${titlePrefix}%`])

    if (existing && existing.length > 0) {
      // 更新昵称（如果改变了）
      const conversation = existing[0]
      const newTitle = `FRIEND:${friendDid}:${nickname}`
      if (conversation.title !== newTitle) {
        await this.updateConversationTitle(conversation.id, newTitle)
        conversation.title = newTitle
      }
      return conversation
    }

    // 创建新对话
    return await this.createConversation(`FRIEND:${friendDid}:${nickname}`, null)
  }

  /**
   * 获取所有好友对话列表
   * @returns {Promise<Array>} 对话列表，包含最后一条消息和未读数
   */
  async getFriendConversations() {
    const sql = `SELECT * FROM conversations WHERE title LIKE 'FRIEND:%' ORDER BY updated_at DESC`
    const conversations = await this.selectSql(sql, [])

    if (!conversations || conversations.length === 0) {
      return []
    }

    // 为每个对话获取最后一条消息
    const result = []
    for (const conv of conversations) {
      // 解析好友信息
      const parts = conv.title.split(':')
      const friendDid = parts[1] || ''
      const nickname = parts[2] || friendDid.substring(0, 12) + '...'

      // 获取最后一条消息
      const lastMsgSql = `SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 1`
      const lastMessages = await this.selectSql(lastMsgSql, [conv.id])
      const lastMessage = lastMessages && lastMessages.length > 0 ? lastMessages[0] : null

      // 获取未读消息数（这里简化处理，实际应该有read_status字段）
      // 暂时设为0，后续可以扩展
      const unreadCount = 0

      result.push({
        ...conv,
        friendDid,
        nickname,
        lastMessage: lastMessage ? {
          content: lastMessage.content,
          timestamp: lastMessage.timestamp,
          isSent: lastMessage.role === 'user'
        } : null,
        unreadCount
      })
    }

    return result
  }

  /**
   * 更新对话标题
   */
  async updateConversationTitle(conversationId, newTitle) {
    if (this.isH5) {
      this.ensureH5Data('conversations')
      const conversation = this.h5Data.conversations.find(c => c.id === conversationId)
      if (conversation) {
        conversation.title = newTitle
        this.saveH5Data()
      }
      return
    }

    const sql = `UPDATE conversations SET title = ? WHERE id = ?`
    await this.executeSql(sql, [newTitle, conversationId])
  }

  /**
   * 发送好友消息
   * @param {string} friendDid 好友DID
   * @param {string} nickname 好友昵称
   * @param {string} content 消息内容
   * @returns {Promise<Object>} 消息对象
   */
  async sendFriendMessage(friendDid, nickname, content) {
    // 获取或创建对话
    const conversation = await this.getOrCreateFriendConversation(friendDid, nickname)

    // 添加消息（role='user'表示自己发送）
    const message = await this.addMessage(conversation.id, 'user', content, 0)

    // 更新对话时间
    await this.updateConversationTime(conversation.id)

    return message
  }

  /**
   * 接收好友消息（模拟）
   * @param {string} friendDid 好友DID
   * @param {string} nickname 好友昵称
   * @param {string} content 消息内容
   * @returns {Promise<Object>} 消息对象
   */
  async receiveFriendMessage(friendDid, nickname, content) {
    // 获取或创建对话
    const conversation = await this.getOrCreateFriendConversation(friendDid, nickname)

    // 添加消息（role='assistant'表示好友发送）
    const message = await this.addMessage(conversation.id, 'assistant', content, 0)

    // 更新对话时间
    await this.updateConversationTime(conversation.id)

    return message
  }

  // ==================== 好友管理 ====================

  /**
   * 获取所有好友
   * @param {string} status 状态筛选 'all', 'accepted', 'pending', 'blocked'
   * @returns {Promise<Array>} 好友列表
   */
  async getFriends(status = 'all') {
    let sql = 'SELECT * FROM friendships'
    const params = []

    if (status !== 'all') {
      sql += ' WHERE status = ?'
      params.push(status)
    }

    sql += ' ORDER BY created_at DESC'

    const result = await this.selectSql(sql, params)
    return result || []
  }

  /**
   * 添加好友
   * @param {string} userDid 当前用户DID
   * @param {string} friendDid 好友DID
   * @param {string} nickname 昵称
   * @param {string} groupName 分组名称
   * @returns {Promise<Object>} 好友对象
   */
  async addFriend(userDid, friendDid, nickname = '', groupName = '') {
    // 检查是否已存在
    const existing = await this.selectSql(
      'SELECT * FROM friendships WHERE user_did = ? AND friend_did = ?',
      [userDid, friendDid]
    )

    if (existing && existing.length > 0) {
      throw new Error('好友已存在')
    }

    // 插入新好友
    const now = this.now()
    const sql = `INSERT INTO friendships (user_did, friend_did, nickname, group_name, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`

    await this.executeSql(sql, [userDid, friendDid, nickname, groupName, 'pending', now])

    return {
      user_did: userDid,
      friend_did: friendDid,
      nickname,
      group_name: groupName,
      status: 'pending',
      created_at: now
    }
  }

  /**
   * 更新好友状态
   * @param {string} userDid 当前用户DID
   * @param {string} friendDid 好友DID
   * @param {string} status 新状态
   * @returns {Promise<void>}
   */
  async updateFriendStatus(userDid, friendDid, status) {
    if (this.isH5) {
      this.ensureH5Data('friendships')
      const friend = this.h5Data.friendships.find(
        f => f.user_did === userDid && f.friend_did === friendDid
      )
      if (friend) {
        friend.status = status
        this.saveH5Data()
      }
      return
    }

    const sql = 'UPDATE friendships SET status = ? WHERE user_did = ? AND friend_did = ?'
    await this.executeSql(sql, [status, userDid, friendDid])
  }

  /**
   * 删除好友
   * @param {string} userDid 当前用户DID
   * @param {string} friendDid 好友DID
   * @returns {Promise<void>}
   */
  async deleteFriend(userDid, friendDid) {
    if (this.isH5) {
      this.ensureH5Data('friendships')
      this.h5Data.friendships = this.h5Data.friendships.filter(
        f => !(f.user_did === userDid && f.friend_did === friendDid)
      )
      this.saveH5Data()
      return
    }

    const sql = 'DELETE FROM friendships WHERE user_did = ? AND friend_did = ?'
    await this.executeSql(sql, [userDid, friendDid])
  }

  /**
   * 更新好友信息
   * @param {string} userDid 当前用户DID
   * @param {string} friendDid 好友DID
   * @param {Object} updates 更新的字段
   * @returns {Promise<void>}
   */
  async updateFriend(userDid, friendDid, updates) {
    if (this.isH5) {
      this.ensureH5Data('friendships')
      const friend = this.h5Data.friendships.find(
        f => f.user_did === userDid && f.friend_did === friendDid
      )
      if (friend) {
        Object.assign(friend, updates)
        this.saveH5Data()
      }
      return
    }

    const fields = []
    const params = []

    if (updates.nickname !== undefined) {
      fields.push('nickname = ?')
      params.push(updates.nickname)
    }
    if (updates.group_name !== undefined) {
      fields.push('group_name = ?')
      params.push(updates.group_name)
    }

    if (fields.length === 0) return

    params.push(userDid, friendDid)
    const sql = `UPDATE friendships SET ${fields.join(', ')} WHERE user_did = ? AND friend_did = ?`
    await this.executeSql(sql, params)
  }

  // ==================== 社交动态 ====================

  /**
   * 创建动态
   * @param {string} authorDid 作者DID
   * @param {string} content 动态内容
   * @param {string} visibility 可见性 'public' 或 'friends'
   * @returns {Promise<Object>} 动态对象
   */
  async createPost(authorDid, content, visibility = 'public') {
    const id = this.generateId()
    const now = this.now()

    const newPost = {
      id,
      author_did: authorDid,
      content,
      images: null,
      visibility,
      like_count: 0,
      comment_count: 0,
      created_at: now
    }

    if (this.isH5) {
      this.ensureH5Data('posts')
      this.h5Data.posts.push(newPost)
      this.saveH5Data()
      return newPost
    }

    const sql = `INSERT INTO posts (id, author_did, content, images, visibility, like_count, comment_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    await this.executeSql(sql, [id, authorDid, content, null, visibility, 0, 0, now])

    return newPost
  }

  /**
   * 获取动态列表
   * @param {string} visibility 可见性筛选 'all', 'public', 'friends'
   * @param {number} limit 限制数量
   * @returns {Promise<Array>} 动态列表
   */
  async getPosts(visibility = 'all', limit = 50) {
    let sql = 'SELECT * FROM posts'
    const params = []

    if (visibility !== 'all') {
      sql += ' WHERE visibility = ?'
      params.push(visibility)
    }

    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const result = await this.selectSql(sql, params)
    return result || []
  }

  /**
   * 获取单个动态
   * @param {string} postId 动态ID
   * @returns {Promise<Object>} 动态对象
   */
  async getPost(postId) {
    const sql = 'SELECT * FROM posts WHERE id = ?'
    const result = await this.selectSql(sql, [postId])
    return result && result.length > 0 ? result[0] : null
  }

  /**
   * 删除动态
   * @param {string} postId 动态ID
   * @returns {Promise<void>}
   */
  async deletePost(postId) {
    if (this.isH5) {
      this.ensureH5Data('posts')
      this.h5Data.posts = this.h5Data.posts.filter(p => p.id !== postId)
      this.saveH5Data()
      return
    }

    const sql = 'DELETE FROM posts WHERE id = ?'
    await this.executeSql(sql, [postId])
  }

  /**
   * 点赞动态
   * @param {string} postId 动态ID
   * @returns {Promise<void>}
   */
  async likePost(postId) {
    if (this.isH5) {
      this.ensureH5Data('posts')
      const post = this.h5Data.posts.find(p => p.id === postId)
      if (post) {
        post.like_count = (post.like_count || 0) + 1
        this.saveH5Data()
      }
      return
    }

    const sql = 'UPDATE posts SET like_count = like_count + 1 WHERE id = ?'
    await this.executeSql(sql, [postId])
  }

  /**
   * 取消点赞动态
   * @param {string} postId 动态ID
   * @returns {Promise<void>}
   */
  async unlikePost(postId) {
    if (this.isH5) {
      this.ensureH5Data('posts')
      const post = this.h5Data.posts.find(p => p.id === postId)
      if (post && post.like_count > 0) {
        post.like_count = post.like_count - 1
        this.saveH5Data()
      }
      return
    }

    const sql = 'UPDATE posts SET like_count = like_count - 1 WHERE id = ? AND like_count > 0'
    await this.executeSql(sql, [postId])
  }

  /**
   * 添加评论
   * @param {string} postId 动态ID
   * @param {string} authorDid 评论者DID
   * @param {string} content 评论内容
   * @param {string} parentId 父评论ID（回复评论时使用）
   * @returns {Promise<Object>} 评论对象
   */
  async addComment(postId, authorDid, content, parentId = null) {
    const id = this.generateId()
    const now = this.now()

    const newComment = {
      id,
      post_id: postId,
      author_did: authorDid,
      content,
      parent_id: parentId,
      created_at: now
    }

    if (this.isH5) {
      this.ensureH5Data('post_comments')
      this.h5Data.post_comments.push(newComment)

      // 更新动态的评论数
      this.ensureH5Data('posts')
      const post = this.h5Data.posts.find(p => p.id === postId)
      if (post) {
        post.comment_count = (post.comment_count || 0) + 1
      }

      this.saveH5Data()
      return newComment
    }

    // 添加评论
    const sql = `INSERT INTO post_comments (id, post_id, author_did, content, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    await this.executeSql(sql, [id, postId, authorDid, content, parentId, now])

    // 更新动态的评论数
    const updateSql = 'UPDATE posts SET comment_count = comment_count + 1 WHERE id = ?'
    await this.executeSql(updateSql, [postId])

    return newComment
  }

  /**
   * 获取动态的评论列表
   * @param {string} postId 动态ID
   * @returns {Promise<Array>} 评论列表
   */
  async getComments(postId) {
    const sql = 'SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC'
    const result = await this.selectSql(sql, [postId])
    return result || []
  }

  /**
   * 删除评论
   * @param {string} commentId 评论ID
   * @param {string} postId 动态ID
   * @returns {Promise<void>}
   */
  async deleteComment(commentId, postId) {
    if (this.isH5) {
      this.ensureH5Data('post_comments')
      this.h5Data.post_comments = this.h5Data.post_comments.filter(c => c.id !== commentId)

      // 更新动态的评论数
      this.ensureH5Data('posts')
      const post = this.h5Data.posts.find(p => p.id === postId)
      if (post && post.comment_count > 0) {
        post.comment_count = post.comment_count - 1
      }

      this.saveH5Data()
      return
    }

    // 删除评论
    const sql = 'DELETE FROM post_comments WHERE id = ?'
    await this.executeSql(sql, [commentId])

    // 更新动态的评论数
    const updateSql = 'UPDATE posts SET comment_count = comment_count - 1 WHERE id = ? AND comment_count > 0'
    await this.executeSql(updateSql, [postId])
  }

  // ==================== 交易市场 ====================

  /**
   * 创建市场商品（上架知识）
   * @param {string} knowledgeId 知识ID
   * @param {string} sellerDid 卖家DID
   * @param {string} title 标题
   * @param {string} description 描述
   * @param {number} price 价格
   * @returns {Promise<Object>} 商品对象
   */
  async createListing(knowledgeId, sellerDid, title, description, price) {
    const id = this.generateId()
    const now = this.now()

    const newListing = {
      id,
      knowledge_id: knowledgeId,
      seller_did: sellerDid,
      title,
      description: description || '',
      price,
      status: 'on_sale',
      created_at: now,
      updated_at: now
    }

    if (this.isH5) {
      this.ensureH5Data('market_listings')
      this.h5Data.market_listings.push(newListing)
      this.saveH5Data()
      return newListing
    }

    const sql = `INSERT INTO market_listings (id, knowledge_id, seller_did, title, description, price, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    await this.executeSql(sql, [id, knowledgeId, sellerDid, title, description, price, 'on_sale', now, now])

    return newListing
  }

  /**
   * 获取市场商品列表
   * @param {Object} options 筛选选项
   * @returns {Promise<Array>} 商品列表
   */
  async getListings(options = {}) {
    const { status = 'on_sale', limit = 50, searchQuery = '' } = options

    let sql = 'SELECT * FROM market_listings WHERE 1=1'
    const params = []

    if (status !== 'all') {
      sql += ' AND status = ?'
      params.push(status)
    }

    if (searchQuery) {
      sql += ' AND (title LIKE ? OR description LIKE ?)'
      const searchParam = `%${searchQuery}%`
      params.push(searchParam, searchParam)
    }

    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const result = await this.selectSql(sql, params)
    return result || []
  }

  /**
   * 获取单个商品
   * @param {string} listingId 商品ID
   * @returns {Promise<Object>} 商品对象
   */
  async getListing(listingId) {
    const sql = 'SELECT * FROM market_listings WHERE id = ?'
    const result = await this.selectSql(sql, [listingId])
    return result && result.length > 0 ? result[0] : null
  }

  /**
   * 获取用户的上架商品
   * @param {string} sellerDid 卖家DID
   * @returns {Promise<Array>} 商品列表
   */
  async getMyListings(sellerDid) {
    const sql = 'SELECT * FROM market_listings WHERE seller_did = ? ORDER BY created_at DESC'
    const result = await this.selectSql(sql, [sellerDid])
    return result || []
  }

  /**
   * 更新商品状态
   * @param {string} listingId 商品ID
   * @param {string} status 新状态
   * @returns {Promise<void>}
   */
  async updateListingStatus(listingId, status) {
    const now = this.now()

    if (this.isH5) {
      this.ensureH5Data('market_listings')
      const listing = this.h5Data.market_listings.find(l => l.id === listingId)
      if (listing) {
        listing.status = status
        listing.updated_at = now
        this.saveH5Data()
      }
      return
    }

    const sql = 'UPDATE market_listings SET status = ?, updated_at = ? WHERE id = ?'
    await this.executeSql(sql, [status, now, listingId])
  }

  /**
   * 下架商品
   * @param {string} listingId 商品ID
   * @returns {Promise<void>}
   */
  async removeListing(listingId) {
    await this.updateListingStatus(listingId, 'removed')
  }

  // ==================== 订单管理 ====================

  /**
   * 创建订单
   * @param {string} listingId 商品ID
   * @param {string} knowledgeId 知识ID
   * @param {string} buyerDid 买家DID
   * @param {string} sellerDid 卖家DID
   * @param {number} price 价格
   * @returns {Promise<Object>} 订单对象
   */
  async createOrder(listingId, knowledgeId, buyerDid, sellerDid, price) {
    const id = this.generateId()
    const now = this.now()

    const newOrder = {
      id,
      listing_id: listingId,
      knowledge_id: knowledgeId,
      buyer_did: buyerDid,
      seller_did: sellerDid,
      price,
      status: 'pending',
      created_at: now,
      completed_at: null
    }

    if (this.isH5) {
      this.ensureH5Data('orders')
      this.h5Data.orders.push(newOrder)
      this.saveH5Data()
      return newOrder
    }

    const sql = `INSERT INTO orders (id, listing_id, knowledge_id, buyer_did, seller_did, price, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    await this.executeSql(sql, [id, listingId, knowledgeId, buyerDid, sellerDid, price, 'pending', now])

    return newOrder
  }

  /**
   * 获取订单列表
   * @param {string} userDid 用户DID
   * @param {string} type 订单类型 'buy'(购买) 或 'sell'(出售) 或 'all'
   * @returns {Promise<Array>} 订单列表
   */
  async getOrders(userDid, type = 'all') {
    let sql = 'SELECT * FROM orders WHERE 1=1'
    const params = []

    if (type === 'buy') {
      sql += ' AND buyer_did = ?'
      params.push(userDid)
    } else if (type === 'sell') {
      sql += ' AND seller_did = ?'
      params.push(userDid)
    } else {
      sql += ' AND (buyer_did = ? OR seller_did = ?)'
      params.push(userDid, userDid)
    }

    sql += ' ORDER BY created_at DESC'

    const result = await this.selectSql(sql, params)
    return result || []
  }

  /**
   * 更新订单状态
   * @param {string} orderId 订单ID
   * @param {string} status 新状态
   * @returns {Promise<void>}
   */
  async updateOrderStatus(orderId, status) {
    const now = this.now()

    if (this.isH5) {
      this.ensureH5Data('orders')
      const order = this.h5Data.orders.find(o => o.id === orderId)
      if (order) {
        order.status = status
        if (status === 'completed') {
          order.completed_at = now
        }
        this.saveH5Data()
      }
      return
    }

    let sql = 'UPDATE orders SET status = ?'
    const params = [status]

    if (status === 'completed') {
      sql += ', completed_at = ?'
      params.push(now)
    }

    sql += ' WHERE id = ?'
    params.push(orderId)

    await this.executeSql(sql, params)
  }

  // ==================== 用户资产 ====================

  /**
   * 获取用户余额
   * @param {string} userDid 用户DID
   * @returns {Promise<number>} 余额
   */
  async getBalance(userDid) {
    if (this.isH5) {
      this.ensureH5Data('user_assets')
      const asset = this.h5Data.user_assets.find(a => a.user_did === userDid)
      return asset ? asset.balance : 0
    }

    const sql = 'SELECT balance FROM user_assets WHERE user_did = ?'
    const result = await this.selectSql(sql, [userDid])
    return result && result.length > 0 ? result[0].balance : 0
  }

  /**
   * 更新用户余额
   * @param {string} userDid 用户DID
   * @param {number} amount 金额变动（正数增加，负数减少）
   * @returns {Promise<number>} 新余额
   */
  async updateBalance(userDid, amount) {
    const now = this.now()
    const currentBalance = await this.getBalance(userDid)
    const newBalance = currentBalance + amount

    if (newBalance < 0) {
      throw new Error('余额不足')
    }

    if (this.isH5) {
      this.ensureH5Data('user_assets')
      let asset = this.h5Data.user_assets.find(a => a.user_did === userDid)

      if (asset) {
        asset.balance = newBalance
        asset.updated_at = now
      } else {
        asset = {
          user_did: userDid,
          balance: newBalance,
          updated_at: now
        }
        this.h5Data.user_assets.push(asset)
      }

      this.saveH5Data()
      return newBalance
    }

    // 检查是否已有记录
    const existing = await this.selectSql('SELECT * FROM user_assets WHERE user_did = ?', [userDid])

    if (existing && existing.length > 0) {
      const sql = 'UPDATE user_assets SET balance = ?, updated_at = ? WHERE user_did = ?'
      await this.executeSql(sql, [newBalance, now, userDid])
    } else {
      const sql = 'INSERT INTO user_assets (user_did, balance, updated_at) VALUES (?, ?, ?)'
      await this.executeSql(sql, [userDid, newBalance, now])
    }

    return newBalance
  }

  /**
   * 添加交易记录
   * @param {string} userDid 用户DID
   * @param {string} type 交易类型
   * @param {number} amount 金额
   * @param {string} knowledgeId 知识ID（可选）
   * @param {string} orderId 订单ID（可选）
   * @returns {Promise<Object>} 交易记录
   */
  async addTransaction(userDid, type, amount, knowledgeId = null, orderId = null) {
    const id = this.generateId()
    const now = this.now()

    const transaction = {
      id,
      user_did: userDid,
      type,
      amount,
      knowledge_id: knowledgeId,
      order_id: orderId,
      created_at: now
    }

    if (this.isH5) {
      this.ensureH5Data('transactions')
      this.h5Data.transactions.push(transaction)
      this.saveH5Data()
      return transaction
    }

    const sql = `INSERT INTO transactions (id, user_did, type, amount, knowledge_id, order_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    await this.executeSql(sql, [id, userDid, type, amount, knowledgeId, orderId, now])

    return transaction
  }

  /**
   * 获取交易记录
   * @param {string} userDid 用户DID
   * @param {number} limit 限制数量
   * @returns {Promise<Array>} 交易记录列表
   */
  async getTransactions(userDid, limit = 50) {
    const sql = 'SELECT * FROM transactions WHERE user_did = ? ORDER BY created_at DESC LIMIT ?'
    const result = await this.selectSql(sql, [userDid, limit])
    return result || []
  }

  /**
   * 购买知识（完整流程）
   * @param {string} listingId 商品ID
   * @param {string} buyerDid 买家DID
   * @returns {Promise<Object>} 订单对象
   */
  async buyKnowledge(listingId, buyerDid) {
    // 获取商品信息
    const listing = await this.getListing(listingId)
    if (!listing) {
      throw new Error('商品不存在')
    }

    if (listing.status !== 'on_sale') {
      throw new Error('商品已下架')
    }

    if (listing.seller_did === buyerDid) {
      throw new Error('不能购买自己的商品')
    }

    // 检查买家余额
    const balance = await this.getBalance(buyerDid)
    if (balance < listing.price) {
      throw new Error('余额不足')
    }

    // 创建订单
    const order = await this.createOrder(
      listingId,
      listing.knowledge_id,
      buyerDid,
      listing.seller_did,
      listing.price
    )

    // 扣除买家余额
    await this.updateBalance(buyerDid, -listing.price)
    await this.addTransaction(buyerDid, 'buy', -listing.price, listing.knowledge_id, order.id)

    // 增加卖家余额
    await this.updateBalance(listing.seller_did, listing.price)
    await this.addTransaction(listing.seller_did, 'sell', listing.price, listing.knowledge_id, order.id)

    // 更新商品状态
    await this.updateListingStatus(listingId, 'sold')

    // 更新订单状态
    await this.updateOrderStatus(order.id, 'completed')

    // 复制知识到买家（创建新的知识副本）
    const knowledge = await this.getKnowledgeItem(listing.knowledge_id)
    if (knowledge) {
      await this.addKnowledgeItem({
        title: `[已购] ${knowledge.title}`,
        type: knowledge.type,
        content: knowledge.content,
        deviceId: buyerDid
      })
    }

    return order
  }

  // ==================== 统计分析方法 ====================

  /**
   * 获取知识库统计数据
   * @returns {Promise<Object>} 统计对象
   */
  async getKnowledgeStatistics() {
    try {
      const stats = {
        total: 0,
        favorites: 0,
        byType: {},
        byTag: [],
        recentActivity: [],
        creationTrend: []
      }

      if (this.isH5) {
        this.ensureH5Data('knowledge_items')
        const items = this.h5Data.knowledge_items || []

        // 总数统计
        stats.total = items.length
        stats.favorites = items.filter(item => item.is_favorite).length

        // 按类型统计
        items.forEach(item => {
          const type = item.type || 'note'
          stats.byType[type] = (stats.byType[type] || 0) + 1
        })

        // 按标签统计
        const tags = await this.getTags()
        stats.byTag = tags.map(tag => ({
          id: tag.id,
          name: tag.name,
          color: tag.color,
          count: tag.count || 0
        }))

        // 最近活动（最近7天更新的知识）
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        stats.recentActivity = items
          .filter(item => item.updated_at >= sevenDaysAgo)
          .sort((a, b) => b.updated_at - a.updated_at)
          .slice(0, 10)
          .map(item => ({
            id: item.id,
            title: item.title,
            type: item.type,
            updated_at: item.updated_at
          }))

        // 创建趋势（按月统计）
        const trendMap = {}
        items.forEach(item => {
          const date = new Date(item.created_at)
          const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          trendMap[monthKey] = (trendMap[monthKey] || 0) + 1
        })

        // 获取最近6个月的趋势数据
        const now = new Date()
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          stats.creationTrend.push({
            month: monthKey,
            count: trendMap[monthKey] || 0
          })
        }

        return stats
      }

      // App (SQLite) 模式
      // 总数和收藏数
      let result = await this.selectSql('SELECT COUNT(*) as total FROM knowledge_items')
      stats.total = result[0]?.total || 0

      result = await this.selectSql('SELECT COUNT(*) as favorites FROM knowledge_items WHERE is_favorite = 1')
      stats.favorites = result[0]?.favorites || 0

      // 按类型统计
      result = await this.selectSql(`
        SELECT type, COUNT(*) as count
        FROM knowledge_items
        GROUP BY type
      `)
      result.forEach(row => {
        stats.byType[row.type] = row.count
      })

      // 按标签统计
      const tags = await this.getTags()
      stats.byTag = tags.map(tag => ({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        count: tag.count || 0
      }))

      // 最近活动
      result = await this.selectSql(`
        SELECT id, title, type, updated_at
        FROM knowledge_items
        WHERE updated_at >= ?
        ORDER BY updated_at DESC
        LIMIT 10
      `, [Date.now() - 7 * 24 * 60 * 60 * 1000])
      stats.recentActivity = result || []

      // 创建趋势
      result = await this.selectSql(`
        SELECT
          strftime('%Y-%m', datetime(created_at/1000, 'unixepoch')) as month,
          COUNT(*) as count
        FROM knowledge_items
        WHERE created_at >= ?
        GROUP BY month
        ORDER BY month
      `, [Date.now() - 6 * 30 * 24 * 60 * 60 * 1000])

      const trendMap = {}
      result.forEach(row => {
        trendMap[row.month] = row.count
      })

      const now = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        stats.creationTrend.push({
          month: monthKey,
          count: trendMap[monthKey] || 0
        })
      }

      return stats
    } catch (error) {
      console.error('获取统计数据失败:', error)
      throw error
    }
  }

  /**
   * 获取每日创建统计（最近30天）
   * @returns {Promise<Array>} 每日统计数组
   */
  async getDailyCreationStats() {
    try {
      const stats = []
      const now = Date.now()
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000

      if (this.isH5) {
        this.ensureH5Data('knowledge_items')
        const items = this.h5Data.knowledge_items || []

        // 统计每天的创建数量
        const dailyMap = {}
        items.forEach(item => {
          if (item.created_at >= thirtyDaysAgo) {
            const date = new Date(item.created_at)
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
            dailyMap[dateKey] = (dailyMap[dateKey] || 0) + 1
          }
        })

        // 生成最近30天的完整数据
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now - i * 24 * 60 * 60 * 1000)
          const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          stats.push({
            date: dateKey,
            count: dailyMap[dateKey] || 0
          })
        }

        return stats
      }

      // App (SQLite) 模式
      const result = await this.selectSql(`
        SELECT
          strftime('%Y-%m-%d', datetime(created_at/1000, 'unixepoch')) as date,
          COUNT(*) as count
        FROM knowledge_items
        WHERE created_at >= ?
        GROUP BY date
        ORDER BY date
      `, [thirtyDaysAgo])

      const dailyMap = {}
      result.forEach(row => {
        dailyMap[row.date] = row.count
      })

      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * 24 * 60 * 60 * 1000)
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        stats.push({
          date: dateKey,
          count: dailyMap[dateKey] || 0
        })
      }

      return stats
    } catch (error) {
      console.error('获取每日统计失败:', error)
      return []
    }
  }
}

// 导出单例
export const db = new DatabaseService()
export default DatabaseService
