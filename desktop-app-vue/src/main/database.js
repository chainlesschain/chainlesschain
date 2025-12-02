const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');

/**
 * 数据库管理类
 * 使用 better-sqlite3 管理本地 SQLite 数据库
 */
class DatabaseManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
  }

  /**
   * 初始化数据库
   */
  initialize() {
    try {
      // 获取用户数据目录
      const userDataPath = app.getPath('userData');
      const dbDir = path.join(userDataPath, 'data');

      // 确保数据目录存在
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // 数据库文件路径
      this.dbPath = path.join(dbDir, 'chainlesschain.db');
      console.log('数据库路径:', this.dbPath);

      // 打开数据库连接
      this.db = new Database(this.dbPath);

      // 启用外键约束
      this.db.pragma('foreign_keys = ON');

      // 创建表
      this.createTables();

      console.log('数据库初始化成功');
      return true;
    } catch (error) {
      console.error('数据库初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建数据库表
   */
  createTables() {
    // 知识库项表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('note', 'document', 'conversation', 'web_clip')),
        content TEXT,
        content_path TEXT,
        embedding_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        git_commit_hash TEXT,
        device_id TEXT,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict'))
      )
    `);

    // 标签表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // 知识库项-标签关联表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_tags (
        knowledge_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (knowledge_id, tag_id),
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

    // 对话表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        knowledge_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE SET NULL
      )
    `);

    // 消息表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    // 创建索引以提高查询性能
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON knowledge_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_updated_at ON knowledge_items(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_sync_status ON knowledge_items(sync_status);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    `);

    // 全文搜索虚拟表
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search
      USING fts5(id, title, content, tokenize='porter unicode61');
    `);

    console.log('数据库表创建完成');
  }

  // ==================== 知识库项操作 ====================

  /**
   * 获取所有知识库项
   * @param {number} limit - 限制数量
   * @param {number} offset - 偏移量
   * @returns {Array} 知识库项列表
   */
  getKnowledgeItems(limit = 100, offset = 0) {
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_items
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset);
  }

  /**
   * 根据ID获取知识库项
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItemById(id) {
    const stmt = this.db.prepare('SELECT * FROM knowledge_items WHERE id = ?');
    return stmt.get(id);
  }

  /**
   * 添加知识库项
   * @param {Object} item - 知识库项数据
   * @returns {Object} 创建的项目
   */
  addKnowledgeItem(item) {
    const id = item.id || uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO knowledge_items (
        id, title, type, content, content_path, embedding_path,
        created_at, updated_at, git_commit_hash, device_id, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      item.title,
      item.type,
      item.content || null,
      item.content_path || null,
      item.embedding_path || null,
      now,
      now,
      item.git_commit_hash || null,
      item.device_id || null,
      item.sync_status || 'pending'
    );

    // 更新全文搜索索引
    this.updateSearchIndex(id, item.title, item.content || '');

    return this.getKnowledgeItemById(id);
  }

  /**
   * 更新知识库项
   * @param {string} id - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的项目
   */
  updateKnowledgeItem(id, updates) {
    const now = Date.now();
    const fields = [];
    const values = [];

    // 动态构建更新字段
    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
    }
    if (updates.content !== undefined) {
      fields.push('content = ?');
      values.push(updates.content);
    }
    if (updates.content_path !== undefined) {
      fields.push('content_path = ?');
      values.push(updates.content_path);
    }
    if (updates.sync_status !== undefined) {
      fields.push('sync_status = ?');
      values.push(updates.sync_status);
    }

    // 总是更新 updated_at
    fields.push('updated_at = ?');
    values.push(now);

    // 添加 WHERE 条件的 ID
    values.push(id);

    if (fields.length === 1) {
      // 只有 updated_at，不需要更新
      return this.getKnowledgeItemById(id);
    }

    const stmt = this.db.prepare(`
      UPDATE knowledge_items
      SET ${fields.join(', ')}
      WHERE id = ?
    `);

    stmt.run(...values);

    // 更新全文搜索索引
    const item = this.getKnowledgeItemById(id);
    if (item) {
      this.updateSearchIndex(id, item.title, item.content || '');
    }

    return item;
  }

  /**
   * 删除知识库项
   * @param {string} id - 项目ID
   * @returns {boolean} 是否删除成功
   */
  deleteKnowledgeItem(id) {
    // 删除搜索索引
    this.db.prepare('DELETE FROM knowledge_search WHERE id = ?').run(id);

    // 删除知识库项
    const stmt = this.db.prepare('DELETE FROM knowledge_items WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  // ==================== 搜索功能 ====================

  /**
   * 搜索知识库项
   * @param {string} query - 搜索关键词
   * @returns {Array} 搜索结果
   */
  searchKnowledge(query) {
    if (!query || !query.trim()) {
      return this.getKnowledgeItems();
    }

    // 使用全文搜索
    const stmt = this.db.prepare(`
      SELECT k.*,
             s.rank
      FROM knowledge_items k
      JOIN knowledge_search s ON k.id = s.id
      WHERE knowledge_search MATCH ?
      ORDER BY s.rank
      LIMIT 50
    `);

    try {
      return stmt.all(query);
    } catch (error) {
      // 如果全文搜索失败，使用简单的 LIKE 搜索
      console.warn('全文搜索失败，使用LIKE搜索:', error);
      const fallbackStmt = this.db.prepare(`
        SELECT * FROM knowledge_items
        WHERE title LIKE ? OR content LIKE ?
        ORDER BY updated_at DESC
        LIMIT 50
      `);
      const pattern = `%${query}%`;
      return fallbackStmt.all(pattern, pattern);
    }
  }

  /**
   * 更新搜索索引
   * @param {string} id - 项目ID
   * @param {string} title - 标题
   * @param {string} content - 内容
   */
  updateSearchIndex(id, title, content) {
    // 先删除旧索引
    this.db.prepare('DELETE FROM knowledge_search WHERE id = ?').run(id);

    // 插入新索引
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_search (id, title, content)
      VALUES (?, ?, ?)
    `);
    stmt.run(id, title, content);
  }

  // ==================== 标签操作 ====================

  /**
   * 获取所有标签
   * @returns {Array} 标签列表
   */
  getAllTags() {
    return this.db.prepare('SELECT * FROM tags ORDER BY name').all();
  }

  /**
   * 创建标签
   * @param {string} name - 标签名
   * @param {string} color - 颜色
   * @returns {Object} 创建的标签
   */
  createTag(name, color = '#1890ff') {
    const id = uuidv4();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO tags (id, name, color, created_at)
      VALUES (?, ?, ?, ?)
    `);

    try {
      stmt.run(id, name, color, now);
      return { id, name, color, created_at: now };
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        // 标签已存在，返回现有标签
        return this.db.prepare('SELECT * FROM tags WHERE name = ?').get(name);
      }
      throw error;
    }
  }

  /**
   * 为知识库项添加标签
   * @param {string} knowledgeId - 知识库项ID
   * @param {string} tagId - 标签ID
   */
  addTagToKnowledge(knowledgeId, tagId) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag_id, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(knowledgeId, tagId, Date.now());
  }

  /**
   * 获取知识库项的标签
   * @param {string} knowledgeId - 知识库项ID
   * @returns {Array} 标签列表
   */
  getKnowledgeTags(knowledgeId) {
    const stmt = this.db.prepare(`
      SELECT t.* FROM tags t
      JOIN knowledge_tags kt ON t.id = kt.tag_id
      WHERE kt.knowledge_id = ?
    `);
    return stmt.all(knowledgeId);
  }

  // ==================== 统计功能 ====================

  /**
   * 获取统计数据
   * @returns {Object} 统计信息
   */
  getStatistics() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_items').get();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const todayCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM knowledge_items WHERE created_at >= ?'
    ).get(todayTimestamp);

    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM knowledge_items
      GROUP BY type
    `).all();

    return {
      total: total.count,
      today: todayCount.count,
      byType: byType.reduce((acc, item) => {
        acc[item.type] = item.count;
        return acc;
      }, {}),
    };
  }

  // ==================== 工具方法 ====================

  /**
   * 执行事务
   * @param {Function} callback - 事务回调
   */
  transaction(callback) {
    const txn = this.db.transaction(callback);
    return txn();
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close();
      console.log('数据库连接已关闭');
    }
  }

  /**
   * 获取数据库路径
   * @returns {string} 数据库文件路径
   */
  getDatabasePath() {
    return this.dbPath;
  }

  /**
   * 备份数据库
   * @param {string} backupPath - 备份路径
   */
  backup(backupPath) {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }

    const backup = this.db.backup(backupPath);

    return new Promise((resolve, reject) => {
      backup.step(-1, (err) => {
        if (err) {
          reject(err);
        } else {
          backup.finish();
          resolve();
        }
      });
    });
  }
}

module.exports = DatabaseManager;
