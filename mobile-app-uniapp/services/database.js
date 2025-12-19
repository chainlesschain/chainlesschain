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

    // 检测运行平台
    // #ifdef H5
    this.isH5 = true
    this.h5Data = {} // H5模式下的内存数据存储
    // #endif
    // #ifndef H5
    this.isH5 = false
    // #endif

    // 如果条件编译不生效，使用运行时检测
    if (this.isH5 === undefined) {
      this.isH5 = typeof plus === 'undefined'
    }
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
    console.log('数据库初始化 (H5模式)')

    try {
      // 从localStorage加载数据
      const stored = uni.getStorageSync('chainlesschain_db')
      if (stored) {
        this.h5Data = JSON.parse(stored)
      } else {
        // 初始化空数据结构
        this.h5Data = {
          knowledge_items: [],
          tags: [],
          knowledge_tags: [],
          conversations: [],
          messages: [],
          friendships: [],
          posts: [],
          post_comments: []
        }
        this.saveH5Data()
      }

      this.isOpen = true
      console.log('数据库打开成功 (H5模式)')
      return Promise.resolve()
    } catch (error) {
      console.error('数据库初始化失败 (H5模式):', error)
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
    if (this.isH5) {
      try {
        uni.setStorageSync('chainlesschain_db', JSON.stringify(this.h5Data))
      } catch (error) {
        console.error('保存H5数据失败:', error)
      }
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
      created_at: now,
      updated_at: now,
      device_id: item.deviceId || uni.getSystemInfoSync().deviceId,
      sync_status: 'pending'
    }

    if (this.isH5) {
      // H5模式：添加到内存数组
      this.h5Data.knowledge_items.push(newItem)
      this.saveH5Data()
      return newItem
    }

    // App模式：插入SQLite
    const sql = `INSERT INTO knowledge_items
      (id, title, type, content, created_at, updated_at, device_id, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

    const params = [
      newItem.id,
      newItem.title,
      newItem.type,
      newItem.content,
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
    const { limit = 20, offset = 0, type = null, searchQuery = '' } = options

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
      this.h5Data.knowledge_items = this.h5Data.knowledge_items.filter(item => item.id !== id)
      this.saveH5Data()
      return { id }
    }

    // App模式：从SQLite删除
    const sql = 'DELETE FROM knowledge_items WHERE id = ?'
    await this.executeSql(sql, [id])
    return { id }
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
      this.h5Data.conversations.push(newConversation)
      this.saveH5Data()
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
}

// 导出单例
export const db = new DatabaseService()
export default DatabaseService
