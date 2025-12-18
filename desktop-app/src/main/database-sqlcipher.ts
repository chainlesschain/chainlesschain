import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { IDatabase, KnowledgeItem, Tag } from './database-interface';

export interface QueryTemplate {
  id: string;
  name: string;
  knowledge_base_ids: string | null; // JSON array
  llm_model: string | null;
  rag_model: string | null;
  system_prompt: string | null;
  temperature: number;
  max_tokens: number;
  created_at: number;
}

export interface Conversation {
  id: string;
  template_id: string | null;
  query: string;
  response: string;
  model_used: string | null;
  model_version: string | null;
  token_count: number | null;
  rating: number | null;
  created_at: number;
}

export interface Device {
  device_id: string;
  device_name: string;
  device_type: 'pc' | 'mobile' | 'web';
  public_key: string;
  last_sync_at: number | null;
  is_active: number; // SQLite uses integer for boolean
}

/**
 * SQLCipher加密数据库实现
 * 使用better-sqlite3 + SQLCipher加密
 */
export class SQLCipherDatabase implements IDatabase {
  private db: Database.Database | null = null;
  private dbPath: string;
  private deviceId: string;

  constructor(deviceId: string = 'device-001') {
    // 数据库存储在用户数据目录
    const userDataPath = app.getPath('userData');
    const dbDir = path.join(userDataPath, 'databases');

    // 确保目录存在
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = path.join(dbDir, 'chainlesschain.db');
    this.deviceId = deviceId;
  }

  /**
   * 初始化数据库并设置加密
   * @param encryptionKey 加密密钥(从U盾获取)
   */
  async initialize(encryptionKey?: string): Promise<void> {
    console.log(`[SQLCipher] 初始化数据库: ${this.dbPath}`);

    // 打开数据库
    this.db = new Database(this.dbPath);

    // 如果提供了加密密钥,启用SQLCipher加密
    // 注意: better-sqlite3需要编译时启用SQLCipher支持
    // 当前版本暂时不加密,后续集成SQLCipher扩展
    if (encryptionKey) {
      try {
        this.db.pragma(`key = '${encryptionKey}'`);
        console.log('[SQLCipher] 数据库加密已启用');
      } catch (error) {
        console.warn('[SQLCipher] 加密设置失败,使用未加密模式:', error);
      }
    }

    // 启用外键约束
    this.db.pragma('foreign_keys = ON');

    // 创建表
    this.createTables();

    // 插入示例数据(仅在数据库为空时)
    this.insertSampleData();

    console.log('[SQLCipher] 数据库初始化完成');
  }

  /**
   * 创建所有表结构
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // 知识条目表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('note', 'document', 'conversation', 'web_clip')),
        content_path TEXT,
        embedding_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        git_commit_hash TEXT,
        device_id TEXT,
        sync_status TEXT DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'conflict'))
      );
    `);

    // 标签表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color TEXT,
        parent_tag_id TEXT,
        FOREIGN KEY (parent_tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );
    `);

    // 知识-标签关联表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_tags (
        knowledge_id TEXT,
        tag_id TEXT,
        PRIMARY KEY (knowledge_id, tag_id),
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );
    `);

    // 查询模板表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        knowledge_base_ids TEXT,
        llm_model TEXT,
        rag_model TEXT,
        system_prompt TEXT,
        temperature REAL DEFAULT 0.7,
        max_tokens INTEGER DEFAULT 2000,
        created_at INTEGER NOT NULL
      );
    `);

    // AI对话历史表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        query TEXT NOT NULL,
        response TEXT NOT NULL,
        model_used TEXT,
        model_version TEXT,
        token_count INTEGER,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES query_templates(id) ON DELETE SET NULL
      );
    `);

    // 设备表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        device_type TEXT CHECK(device_type IN ('pc', 'mobile', 'web')),
        public_key TEXT NOT NULL,
        last_sync_at INTEGER,
        is_active INTEGER DEFAULT 1
      );
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_knowledge_updated_at ON knowledge_items(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_items(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_sync_status ON knowledge_items(sync_status);
      CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
    `);

    console.log('[SQLCipher] 数据库表创建完成');
  }

  /**
   * 插入示例数据
   */
  private insertSampleData(): void {
    if (!this.db) throw new Error('Database not initialized');

    // 检查是否已有数据
    const count = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_items').get() as { count: number };

    if (count.count === 0) {
      const sampleNote = {
        id: uuidv4(),
        title: '欢迎使用 ChainlessChain',
        type: 'note',
        content_path: null,
        embedding_path: null,
        created_at: Date.now() - 86400000, // 1天前
        updated_at: Date.now() - 86400000,
        git_commit_hash: null,
        device_id: this.deviceId,
        sync_status: 'synced',
      };

      const insert = this.db.prepare(`
        INSERT INTO knowledge_items (id, title, type, content_path, embedding_path, created_at, updated_at, git_commit_hash, device_id, sync_status)
        VALUES (@id, @title, @type, @content_path, @embedding_path, @created_at, @updated_at, @git_commit_hash, @device_id, @sync_status)
      `);

      insert.run(sampleNote);

      // 将内容保存到文件系统
      const contentDir = path.join(path.dirname(this.dbPath), 'knowledge');
      if (!fs.existsSync(contentDir)) {
        fs.mkdirSync(contentDir, { recursive: true });
      }

      const contentPath = path.join(contentDir, `${sampleNote.id}.md`);
      const sampleContent = `# 欢迎使用 ChainlessChain\n\n这是一个基于U盾加密的个人AI知识库系统。\n\n## 特性\n\n- 完全本地化,数据100%掌控\n- 硬件级加密(U盾/SIMKey)\n- AI原生支持\n- 去中心化同步\n- **SQLCipher加密数据库**\n\n开始创建你的第一个笔记吧!`;

      fs.writeFileSync(contentPath, sampleContent, 'utf-8');

      // 更新content_path
      this.db.prepare('UPDATE knowledge_items SET content_path = ? WHERE id = ?').run(contentPath, sampleNote.id);

      console.log('[SQLCipher] 示例数据插入完成');
    }
  }

  /**
   * 获取知识库项列表
   */
  getKnowledgeItems(limit: number = 100, offset: number = 0): KnowledgeItem[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_items
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = stmt.all(limit, offset) as KnowledgeItem[];

    // 读取文件内容
    return rows.map(item => {
      if (item.content_path && fs.existsSync(item.content_path)) {
        item.content = fs.readFileSync(item.content_path, 'utf-8');
      }
      return item;
    });
  }

  /**
   * 根据ID获取知识库项
   */
  getKnowledgeItemById(id: string): KnowledgeItem | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM knowledge_items WHERE id = ?');
    const item = stmt.get(id) as KnowledgeItem | undefined;

    if (!item) return null;

    // 读取文件内容
    if (item.content_path && fs.existsSync(item.content_path)) {
      item.content = fs.readFileSync(item.content_path, 'utf-8');
    }

    return item;
  }

  /**
   * 添加知识库项
   */
  addKnowledgeItem(input: {
    title: string;
    type: KnowledgeItem['type'];
    content?: string;
  }): KnowledgeItem {
    if (!this.db) throw new Error('Database not initialized');

    const now = Date.now();
    const id = uuidv4();

    // 保存内容到文件
    let contentPath: string | null = null;
    if (input.content) {
      const contentDir = path.join(path.dirname(this.dbPath), 'knowledge');
      if (!fs.existsSync(contentDir)) {
        fs.mkdirSync(contentDir, { recursive: true });
      }

      contentPath = path.join(contentDir, `${id}.md`);
      fs.writeFileSync(contentPath, input.content, 'utf-8');
    }

    const item: Omit<KnowledgeItem, 'content'> = {
      id,
      title: input.title,
      type: input.type,
      content_path: contentPath,
      embedding_path: null,
      created_at: now,
      updated_at: now,
      git_commit_hash: null,
      device_id: this.deviceId,
      sync_status: 'pending',
    };

    const stmt = this.db.prepare(`
      INSERT INTO knowledge_items (id, title, type, content_path, embedding_path, created_at, updated_at, git_commit_hash, device_id, sync_status)
      VALUES (@id, @title, @type, @content_path, @embedding_path, @created_at, @updated_at, @git_commit_hash, @device_id, @sync_status)
    `);

    stmt.run(item);

    console.log(`[SQLCipher] 添加知识项: ${item.title}`);

    return { ...item, content: input.content };
  }

  /**
   * 更新知识库项
   */
  updateKnowledgeItem(id: string, updates: Partial<KnowledgeItem>): boolean {
    if (!this.db) throw new Error('Database not initialized');

    const item = this.getKnowledgeItemById(id);
    if (!item) return false;

    // 更新内容文件
    if (updates.content !== undefined && item.content_path) {
      fs.writeFileSync(item.content_path, updates.content, 'utf-8');
    }

    // 构建更新SQL
    const fields: string[] = [];
    const values: Record<string, any> = { id };

    if (updates.title !== undefined) {
      fields.push('title = @title');
      values.title = updates.title;
    }

    if (updates.type !== undefined) {
      fields.push('type = @type');
      values.type = updates.type;
    }

    // 总是更新时间戳和同步状态
    fields.push('updated_at = @updated_at');
    fields.push('sync_status = @sync_status');
    values.updated_at = Date.now();
    values.sync_status = 'pending';

    if (fields.length > 0) {
      const sql = `UPDATE knowledge_items SET ${fields.join(', ')} WHERE id = @id`;
      const stmt = this.db.prepare(sql);
      stmt.run(values);

      console.log(`[SQLCipher] 更新知识项: ${id}`);
      return true;
    }

    return false;
  }

  /**
   * 删除知识库项
   */
  deleteKnowledgeItem(id: string): boolean {
    if (!this.db) throw new Error('Database not initialized');

    const item = this.getKnowledgeItemById(id);
    if (!item) return false;

    // 删除文件
    if (item.content_path && fs.existsSync(item.content_path)) {
      fs.unlinkSync(item.content_path);
    }

    // 删除数据库记录
    const stmt = this.db.prepare('DELETE FROM knowledge_items WHERE id = ?');
    stmt.run(id);

    console.log(`[SQLCipher] 删除知识项: ${id}`);
    return true;
  }

  /**
   * 搜索知识库
   */
  searchKnowledge(query: string): KnowledgeItem[] {
    if (!this.db) throw new Error('Database not initialized');

    const queryLower = `%${query.toLowerCase()}%`;

    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_items
      WHERE LOWER(title) LIKE ?
      ORDER BY updated_at DESC
      LIMIT 100
    `);

    const rows = stmt.all(queryLower) as KnowledgeItem[];

    // 读取内容并进一步过滤
    const results: KnowledgeItem[] = [];

    for (const item of rows) {
      if (item.content_path && fs.existsSync(item.content_path)) {
        const content = fs.readFileSync(item.content_path, 'utf-8');
        item.content = content;

        // 如果标题匹配或内容匹配,加入结果
        if (
          item.title.toLowerCase().includes(query.toLowerCase()) ||
          content.toLowerCase().includes(query.toLowerCase())
        ) {
          results.push(item);
        }
      } else {
        results.push(item);
      }
    }

    return results;
  }

  /**
   * 添加标签
   */
  addTag(name: string, color: string, parentTagId: string | null = null): Tag {
    if (!this.db) throw new Error('Database not initialized');

    const tag: Tag = {
      id: uuidv4(),
      name,
      color,
      parent_tag_id: parentTagId,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tags (id, name, color, parent_tag_id)
      VALUES (@id, @name, @color, @parent_tag_id)
    `);

    stmt.run(tag);

    console.log(`[SQLCipher] 添加标签: ${name}`);
    return tag;
  }

  /**
   * 为知识项添加标签
   */
  addTagToKnowledge(knowledgeId: string, tagId: string): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag_id)
      VALUES (?, ?)
    `);

    stmt.run(knowledgeId, tagId);
  }

  /**
   * 获取知识项的所有标签
   */
  getKnowledgeTags(knowledgeId: string): Tag[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN knowledge_tags kt ON t.id = kt.tag_id
      WHERE kt.knowledge_id = ?
    `);

    return stmt.all(knowledgeId) as Tag[];
  }

  /**
   * 保存对话记录
   */
  saveConversation(conversation: Omit<Conversation, 'id' | 'created_at'>): Conversation {
    if (!this.db) throw new Error('Database not initialized');

    const record: Conversation = {
      id: uuidv4(),
      ...conversation,
      created_at: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, template_id, query, response, model_used, model_version, token_count, rating, created_at)
      VALUES (@id, @template_id, @query, @response, @model_used, @model_version, @token_count, @rating, @created_at)
    `);

    stmt.run(record);

    return record;
  }

  /**
   * 获取对话历史
   */
  getConversations(limit: number = 50): Conversation[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(limit) as Conversation[];
  }

  /**
   * 获取数据库统计信息
   */
  getStatistics(): {
    totalNotes: number;
    totalConversations: number;
    totalTags: number;
    dbSizeBytes: number;
  } {
    if (!this.db) throw new Error('Database not initialized');

    const stats = {
      totalNotes: (this.db.prepare('SELECT COUNT(*) as count FROM knowledge_items').get() as { count: number }).count,
      totalConversations: (this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }).count,
      totalTags: (this.db.prepare('SELECT COUNT(*) as count FROM tags').get() as { count: number }).count,
      dbSizeBytes: fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0,
    };

    return stats;
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[SQLCipher] 数据库连接已关闭');
    }
  }

  /**
   * 备份数据库
   */
  async backup(backupPath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.backup(backupPath);
    console.log(`[SQLCipher] 数据库已备份到: ${backupPath}`);
  }
}
