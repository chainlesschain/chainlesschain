const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');

/**
 * 数据库管理类
 * 使用 sql.js 管理本地 SQLite 数据库
 */
class DatabaseManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.SQL = null;
  }

  /**
   * 初始化数据库
   */
  async initialize() {
    try {
      // 初始化 sql.js
      this.SQL = await initSqlJs({
        // sql.js 使用 WebAssembly，需要加载 .wasm 文件
        locateFile: file => {
          // Monorepo workspace：sql.js安装在父目录的node_modules中
          return path.join(process.cwd(), '../node_modules/sql.js/dist', file);
        }
      });

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

      // 加载或创建数据库
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new this.SQL.Database(buffer);
      } else {
        this.db = new this.SQL.Database();
      }

      // 启用外键约束
      this.db.run('PRAGMA foreign_keys = ON');

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
   * 保存数据库到文件
   */
  saveToFile() {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  /**
   * 创建数据库表
   */
  createTables() {
    // 知识库项表
    this.db.run(`
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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // 知识库项-标签关联表
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON knowledge_items(created_at DESC);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_updated_at ON knowledge_items(updated_at DESC);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_sync_status ON knowledge_items(sync_status);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    `);

    // sql.js 不支持 FTS5，我们将使用常规表来实现搜索功能
    // 创建搜索索引表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS knowledge_search (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY (id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      )
    `);

    // 保存更改
    this.saveToFile();
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
    stmt.bind([limit, offset]);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * 根据ID获取知识库项
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItemById(id) {
    const stmt = this.db.prepare('SELECT * FROM knowledge_items WHERE id = ?');
    stmt.bind([id]);

    const result = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return result;
  }

  /**
   * 添加知识库项
   * @param {Object} item - 知识库项数据
   * @returns {Object} 创建的项目
   */
  addKnowledgeItem(item) {
    const id = item.id || uuidv4();
    const now = Date.now();

    this.db.run(`
      INSERT INTO knowledge_items (
        id, title, type, content, content_path, embedding_path,
        created_at, updated_at, git_commit_hash, device_id, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
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
    ]);

    // 更新全文搜索索引
    this.updateSearchIndex(id, item.title, item.content || '');

    // 保存到文件
    this.saveToFile();

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

    this.db.run(`
      UPDATE knowledge_items
      SET ${fields.join(', ')}
      WHERE id = ?
    `, values);

    // 更新全文搜索索引
    const item = this.getKnowledgeItemById(id);
    if (item) {
      this.updateSearchIndex(id, item.title, item.content || '');
    }

    // 保存到文件
    this.saveToFile();

    return item;
  }

  /**
   * 删除知识库项
   * @param {string} id - 项目ID
   * @returns {boolean} 是否删除成功
   */
  deleteKnowledgeItem(id) {
    // 删除搜索索引
    this.db.run('DELETE FROM knowledge_search WHERE id = ?', [id]);

    // 删除知识库项
    this.db.run('DELETE FROM knowledge_items WHERE id = ?', [id]);

    // 保存到文件
    this.saveToFile();

    return true;
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

    // 使用 LIKE 搜索（sql.js 不支持 FTS5）
    const pattern = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_items
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY updated_at DESC
      LIMIT 50
    `);
    stmt.bind([pattern, pattern]);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  /**
   * 更新搜索索引
   * @param {string} id - 项目ID
   * @param {string} title - 标题
   * @param {string} content - 内容
   */
  updateSearchIndex(id, title, content) {
    // 先删除旧索引
    this.db.run('DELETE FROM knowledge_search WHERE id = ?', [id]);

    // 插入新索引
    this.db.run(`
      INSERT INTO knowledge_search (id, title, content)
      VALUES (?, ?, ?)
    `, [id, title, content]);
  }

  // ==================== 标签操作 ====================

  /**
   * 获取所有标签
   * @returns {Array} 标签列表
   */
  getAllTags() {
    const stmt = this.db.prepare('SELECT * FROM tags ORDER BY name');
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
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

    try {
      this.db.run(`
        INSERT INTO tags (id, name, color, created_at)
        VALUES (?, ?, ?, ?)
      `, [id, name, color, now]);

      this.saveToFile();
      return { id, name, color, created_at: now };
    } catch (error) {
      if (error.message.includes('UNIQUE')) {
        // 标签已存在，返回现有标签
        const stmt = this.db.prepare('SELECT * FROM tags WHERE name = ?');
        stmt.bind([name]);
        const result = stmt.step() ? stmt.getAsObject() : null;
        stmt.free();
        return result;
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
    this.db.run(`
      INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag_id, created_at)
      VALUES (?, ?, ?)
    `, [knowledgeId, tagId, Date.now()]);
    this.saveToFile();
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
    stmt.bind([knowledgeId]);

    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }

  // ==================== 统计功能 ====================

  /**
   * 获取统计数据
   * @returns {Object} 统计信息
   */
  getStatistics() {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_items');
    totalStmt.step();
    const total = totalStmt.getAsObject();
    totalStmt.free();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const todayStmt = this.db.prepare(
      'SELECT COUNT(*) as count FROM knowledge_items WHERE created_at >= ?'
    );
    todayStmt.bind([todayTimestamp]);
    todayStmt.step();
    const todayCount = todayStmt.getAsObject();
    todayStmt.free();

    const byTypeStmt = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM knowledge_items
      GROUP BY type
    `);

    const byType = [];
    while (byTypeStmt.step()) {
      byType.push(byTypeStmt.getAsObject());
    }
    byTypeStmt.free();

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
    try {
      this.db.run('BEGIN TRANSACTION');
      callback();
      this.db.run('COMMIT');
      this.saveToFile();
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.saveToFile();
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

    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(backupPath, buffer);
  }
}

module.exports = DatabaseManager;
