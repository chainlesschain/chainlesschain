/**
 * 测试数据库管理工具
 *
 * 提供测试数据库的创建、管理和清理功能：
 * 1. 数据库隔离 - 为每个测试创建独立数据库
 * 2. 数据库快照 - 保存和恢复数据库状态
 * 3. Seed数据 - 预填充测试数据
 * 4. 自动清理 - 测试结束后清理资源
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { randomData } from './test-helpers.js';
import { dataGenerators } from './mock-factories.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 测试数据库管理器
 */
export class TestDatabaseManager {
  constructor(options = {}) {
    this.testDbDir = options.testDbDir || path.join(__dirname, '..', '.tmp', 'test-dbs');
    this.databases = new Map();
    this.snapshots = new Map();
  }

  /**
   * 初始化测试数据库目录
   */
  async initialize() {
    await fs.mkdir(this.testDbDir, { recursive: true });
  }

  /**
   * 创建测试数据库
   */
  async createTestDatabase(name = null) {
    const dbName = name || `test-${Date.now()}-${randomData.string(8)}`;
    const dbPath = path.join(this.testDbDir, `${dbName}.db`);

    // 确保数据库不存在
    try {
      await fs.unlink(dbPath);
    } catch (error) {
      // 忽略文件不存在的错误
    }

    // 创建数据库
    const db = new Database(dbPath);

    // 启用外键约束
    db.pragma('foreign_keys = ON');

    // 初始化schema
    await this.initializeSchema(db);

    this.databases.set(dbName, { db, path: dbPath });

    return { db, name: dbName, path: dbPath };
  }

  /**
   * 初始化数据库schema
   */
  async initializeSchema(db) {
    // 笔记表
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        tags TEXT DEFAULT '[]',
        category TEXT DEFAULT 'general',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        is_favorite INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0
      )
    `);

    // 项目表
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT,
        project_type TEXT,
        status TEXT DEFAULT 'draft',
        folder_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `);

    // 模板表
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        project_type TEXT,
        prompt_template TEXT,
        variables_schema TEXT DEFAULT '[]',
        file_structure TEXT DEFAULT '{}',
        default_files TEXT DEFAULT '[]',
        is_builtin INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `);

    // 对话表
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        messages TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `);

    // DID身份表
    db.exec(`
      CREATE TABLE IF NOT EXISTS did_identities (
        id TEXT PRIMARY KEY,
        did TEXT UNIQUE NOT NULL,
        display_name TEXT,
        public_key TEXT,
        private_key TEXT,
        created_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `);

    // 文件表
    db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER,
        mime_type TEXT,
        hash TEXT,
        created_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0
      )
    `);
  }

  /**
   * 获取数据库
   */
  getDatabase(name) {
    const dbInfo = this.databases.get(name);
    if (!dbInfo) {
      throw new Error(`数据库不存在: ${name}`);
    }
    return dbInfo.db;
  }

  /**
   * 关闭数据库
   */
  async closeDatabase(name) {
    const dbInfo = this.databases.get(name);
    if (dbInfo) {
      dbInfo.db.close();
      this.databases.delete(name);
    }
  }

  /**
   * 删除测试数据库
   */
  async deleteDatabase(name) {
    await this.closeDatabase(name);

    const dbPath = path.join(this.testDbDir, `${name}.db`);
    try {
      await fs.unlink(dbPath);
    } catch (error) {
      // 忽略文件不存在的错误
    }
  }

  /**
   * 创建数据库快照
   */
  async createSnapshot(dbName, snapshotName = null) {
    const snapshotId = snapshotName || `${dbName}-snapshot-${Date.now()}`;
    const dbInfo = this.databases.get(dbName);

    if (!dbInfo) {
      throw new Error(`数据库不存在: ${dbName}`);
    }

    // 导出数据库内容
    const snapshot = {};
    const tables = this.getTables(dbInfo.db);

    for (const table of tables) {
      const stmt = dbInfo.db.prepare(`SELECT * FROM ${table}`);
      snapshot[table] = stmt.all();
    }

    this.snapshots.set(snapshotId, {
      dbName,
      data: snapshot,
      timestamp: Date.now()
    });

    return snapshotId;
  }

  /**
   * 恢复数据库快照
   */
  async restoreSnapshot(snapshotId) {
    const snapshot = this.snapshots.get(snapshotId);

    if (!snapshot) {
      throw new Error(`快照不存在: ${snapshotId}`);
    }

    const dbInfo = this.databases.get(snapshot.dbName);
    if (!dbInfo) {
      throw new Error(`数据库不存在: ${snapshot.dbName}`);
    }

    const db = dbInfo.db;

    // 清空所有表
    const tables = this.getTables(db);
    for (const table of tables) {
      db.exec(`DELETE FROM ${table}`);
    }

    // 恢复数据
    for (const [table, rows] of Object.entries(snapshot.data)) {
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const insertStmt = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`
      );

      for (const row of rows) {
        const values = columns.map(col => row[col]);
        insertStmt.run(values);
      }
    }
  }

  /**
   * 获取数据库中的所有表
   */
  getTables(db) {
    const stmt = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `);
    const tables = stmt.all();
    return tables.map(t => t.name);
  }

  /**
   * Seed测试数据
   */
  async seedData(dbName, options = {}) {
    const db = this.getDatabase(dbName);
    const {
      notes = 10,
      projects = 5,
      templates = 5,
      conversations = 3,
      users = 5
    } = options;

    // Seed笔记
    if (notes > 0) {
      const noteData = dataGenerators.generateNotes(notes);
      const insertNote = db.prepare(`
        INSERT INTO notes (id, title, content, tags, category, created_at, updated_at, is_favorite, is_archived, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const note of noteData) {
        insertNote.run(
          note.id,
          note.title,
          note.content,
          JSON.stringify(note.tags),
          note.category,
          note.created_at,
          note.updated_at,
          note.is_favorite ? 1 : 0,
          note.is_archived ? 1 : 0,
          0
        );
      }
    }

    // Seed项目
    if (projects > 0) {
      const projectData = Array.from({ length: projects }, () =>
        dataGenerators.generateProject()
      );
      const insertProject = db.prepare(`
        INSERT INTO projects (id, user_id, name, description, type, project_type, status, folder_path, created_at, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const project of projectData) {
        insertProject.run(
          project.id,
          project.user_id,
          project.name,
          project.description,
          project.type,
          project.project_type,
          project.status,
          project.folder_path,
          project.created_at,
          project.updated_at,
          0
        );
      }
    }

    // Seed模板
    if (templates > 0) {
      const templateData = Array.from({ length: templates }, () =>
        dataGenerators.generateTemplate()
      );
      const insertTemplate = db.prepare(`
        INSERT INTO project_templates (id, name, display_name, description, category, project_type, prompt_template, variables_schema, is_builtin, usage_count, rating, rating_count, created_at, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const template of templateData) {
        insertTemplate.run(
          template.id,
          template.name,
          template.display_name,
          template.description,
          template.category,
          template.project_type,
          template.prompt_template,
          JSON.stringify(template.variables_schema),
          template.is_builtin ? 1 : 0,
          template.usage_count,
          template.rating,
          0,
          template.created_at,
          template.updated_at,
          0
        );
      }
    }

    // Seed对话
    if (conversations > 0) {
      const conversationData = Array.from({ length: conversations }, () =>
        dataGenerators.generateConversation()
      );
      const insertConversation = db.prepare(`
        INSERT INTO chat_conversations (id, title, messages, created_at, updated_at, deleted)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const conv of conversationData) {
        insertConversation.run(
          conv.id,
          conv.title,
          JSON.stringify(conv.messages),
          conv.created_at,
          conv.updated_at,
          0
        );
      }
    }
  }

  /**
   * 清空数据库
   */
  async clearDatabase(dbName) {
    const db = this.getDatabase(dbName);
    const tables = this.getTables(db);

    for (const table of tables) {
      db.exec(`DELETE FROM ${table}`);
    }
  }

  /**
   * 清理所有测试数据库
   */
  async cleanup() {
    // 关闭所有数据库连接
    for (const [name] of this.databases) {
      await this.closeDatabase(name);
    }

    // 删除测试数据库目录
    try {
      await fs.rm(this.testDbDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('清理测试数据库目录失败:', error.message);
    }

    // 清空快照
    this.snapshots.clear();
  }

  /**
   * 获取数据库统计信息
   */
  async getDatabaseStats(dbName) {
    const db = this.getDatabase(dbName);
    const tables = this.getTables(db);
    const stats = {};

    for (const table of tables) {
      const stmt = db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
      const result = stmt.get();
      stats[table] = result.count;
    }

    return stats;
  }
}

/**
 * 创建默认实例
 */
let defaultManager = null;

export function getTestDatabaseManager() {
  if (!defaultManager) {
    defaultManager = new TestDatabaseManager();
  }
  return defaultManager;
}

/**
 * 便捷函数
 */
export async function createTestDb(name) {
  const manager = getTestDatabaseManager();
  await manager.initialize();
  return await manager.createTestDatabase(name);
}

export async function deleteTestDb(name) {
  const manager = getTestDatabaseManager();
  await manager.deleteDatabase(name);
}

export async function cleanupAllTestDbs() {
  const manager = getTestDatabaseManager();
  await manager.cleanup();
}

export default TestDatabaseManager;
