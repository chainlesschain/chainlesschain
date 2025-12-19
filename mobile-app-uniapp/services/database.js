/**
 * ChainlessChain Mobile - SQLite 数据库服务
 * 参考 desktop-app-vue 的数据库设计
 */

class DatabaseService {
  constructor() {
    this.dbName = 'chainlesschain.db'
    this.dbPath = '_doc/chainlesschain.db'
    this.isOpen = false
    this.encryptionKey = null // PIN码派生的加密密钥
  }

  /**
   * 初始化数据库
   * @param {string} pin PIN码（用于派生加密密钥）
   */
  async init(pin) {
    return new Promise((resolve, reject) => {
      try {
        // 派生加密密钥
        this.encryptionKey = this.deriveKey(pin)

        // 打开数据库
        plus.sqlite.openDatabase({
          name: this.dbName,
          path: this.dbPath,
          success: (e) => {
            console.log('数据库打开成功')
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

    const sql = `INSERT INTO knowledge_items
      (id, title, type, content, created_at, updated_at, device_id, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

    const params = [
      id,
      item.title,
      item.type || 'note',
      item.content || '',
      now,
      now,
      item.deviceId || uni.getSystemInfoSync().deviceId,
      'pending'
    ]

    await this.executeSql(sql, params)

    return { id, ...item, created_at: now, updated_at: now }
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

    const sql = `INSERT INTO conversations
      (id, title, knowledge_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`

    await this.executeSql(sql, [id, title, knowledgeId, now, now])

    return { id, title, knowledge_id: knowledgeId, created_at: now, updated_at: now }
  }

  /**
   * 添加消息
   */
  async addMessage(conversationId, role, content, tokens = 0) {
    const id = this.generateId()
    const now = this.now()

    const sql = `INSERT INTO messages
      (id, conversation_id, role, content, timestamp, tokens)
      VALUES (?, ?, ?, ?, ?, ?)`

    await this.executeSql(sql, [id, conversationId, role, content, now, tokens])

    return { id, conversation_id: conversationId, role, content, timestamp: now, tokens }
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
