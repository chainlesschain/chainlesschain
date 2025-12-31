/**
 * 身份上下文管理器
 *
 * 功能:
 * - 管理多个身份上下文(个人、多个组织)
 * - 身份切换
 * - 数据库文件隔离
 * - 上下文数据加载/卸载
 *
 * @author ChainlessChain Enterprise
 * @version 1.0.0
 */

const path = require('path');
const fs = require('fs');
const SQLite = require('better-sqlite3');
const EventEmitter = require('events');

class IdentityContextManager extends EventEmitter {
  constructor(dataDir) {
    super();

    this.dataDir = dataDir;
    this.identityDbPath = path.join(dataDir, 'identity-contexts.db');
    this.identityDb = null;

    // 当前激活的上下文
    this.activeContext = null;

    // 上下文数据库连接池
    this.contextDatabases = new Map();

    this.initialized = false;
  }

  /**
   * 初始化身份上下文管理器
   */
  async initialize() {
    try {
      console.log('初始化身份上下文管理器...');

      // 1. 创建数据目录
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      // 2. 打开身份上下文数据库
      this.identityDb = new SQLite(this.identityDbPath);
      this.identityDb.pragma('journal_mode = WAL');

      // 3. 创建表结构
      this.createTables();

      // 4. 迁移现有数据(如果是首次升级到企业版)
      await this.migrateIfNeeded();

      // 5. 加载默认上下文
      await this.loadDefaultContext();

      this.initialized = true;
      console.log('✓ 身份上下文管理器初始化成功');

      return { success: true };
    } catch (error) {
      console.error('身份上下文管理器初始化失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 创建数据表
   */
  createTables() {
    // 身份上下文表
    this.identityDb.exec(`
      CREATE TABLE IF NOT EXISTS identity_contexts (
        context_id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        context_type TEXT NOT NULL, -- 'personal', 'organization'
        org_id TEXT,
        org_did TEXT,
        display_name TEXT NOT NULL,
        avatar TEXT,
        db_path TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        settings TEXT, -- JSON配置
        UNIQUE(user_did, org_id)
      );

      CREATE INDEX IF NOT EXISTS idx_identity_user_did ON identity_contexts(user_did);
      CREATE INDEX IF NOT EXISTS idx_identity_active ON identity_contexts(is_active);
    `);

    // 上下文切换历史
    this.identityDb.exec(`
      CREATE TABLE IF NOT EXISTS context_switch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_context_id TEXT,
        to_context_id TEXT NOT NULL,
        switched_at INTEGER NOT NULL,
        user_did TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_switch_history_user ON context_switch_history(user_did);
    `);
  }

  /**
   * 迁移现有数据(从个人版升级到企业版)
   */
  async migrateIfNeeded() {
    const oldDbPath = path.join(this.dataDir, 'chainlesschain.db');
    const personalDbPath = path.join(this.dataDir, 'personal.db');

    // 检查是否已经迁移过
    const existingContexts = this.identityDb.prepare(
      'SELECT COUNT(*) as count FROM identity_contexts'
    ).get();

    if (existingContexts.count > 0) {
      console.log('身份上下文已存在,跳过迁移');
      return;
    }

    // 如果存在旧数据库,重命名为个人数据库
    if (fs.existsSync(oldDbPath) && !fs.existsSync(personalDbPath)) {
      console.log('检测到个人版数据库,正在迁移到企业版...');
      fs.renameSync(oldDbPath, personalDbPath);
      console.log('✓ 数据库已重命名为 personal.db');
    }

    // 如果还没有个人数据库,创建一个空的
    if (!fs.existsSync(personalDbPath)) {
      console.log('创建新的个人数据库...');
      const personalDb = new SQLite(personalDbPath);
      personalDb.pragma('journal_mode = WAL');
      personalDb.close();
    }
  }

  /**
   * 创建个人上下文
   */
  async createPersonalContext(userDID, displayName) {
    try {
      const contextId = 'personal';
      const dbPath = path.join(this.dataDir, 'personal.db');

      // 检查是否已存在
      const existing = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE context_id = ?'
      ).get(contextId);

      if (existing) {
        console.log('个人上下文已存在');
        return { success: true, context: existing };
      }

      // 创建个人上下文
      const context = {
        context_id: contextId,
        user_did: userDID,
        context_type: 'personal',
        org_id: null,
        org_did: null,
        display_name: displayName || '个人',
        avatar: null,
        db_path: dbPath,
        is_active: 1,
        created_at: Date.now(),
        last_used_at: Date.now(),
        settings: JSON.stringify({})
      };

      this.identityDb.prepare(`
        INSERT INTO identity_contexts
        (context_id, user_did, context_type, org_id, org_did, display_name, avatar,
         db_path, is_active, created_at, last_used_at, settings)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        context.context_id,
        context.user_did,
        context.context_type,
        context.org_id,
        context.org_did,
        context.display_name,
        context.avatar,
        context.db_path,
        context.is_active,
        context.created_at,
        context.last_used_at,
        context.settings
      );

      console.log('✓ 个人上下文创建成功');
      return { success: true, context };
    } catch (error) {
      console.error('创建个人上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 创建组织上下文
   */
  async createOrganizationContext(userDID, orgId, orgDID, displayName, avatar = null) {
    try {
      const contextId = `org_${orgId}`;
      const dbPath = path.join(this.dataDir, `org_${orgId}.db`);

      // 检查是否已存在
      const existing = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE context_id = ?'
      ).get(contextId);

      if (existing) {
        console.log(`组织上下文 ${displayName} 已存在`);
        return { success: true, context: existing };
      }

      // 创建组织上下文
      const context = {
        context_id: contextId,
        user_did: userDID,
        context_type: 'organization',
        org_id: orgId,
        org_did: orgDID,
        display_name: displayName,
        avatar: avatar,
        db_path: dbPath,
        is_active: 0,
        created_at: Date.now(),
        last_used_at: null,
        settings: JSON.stringify({})
      };

      this.identityDb.prepare(`
        INSERT INTO identity_contexts
        (context_id, user_did, context_type, org_id, org_did, display_name, avatar,
         db_path, is_active, created_at, last_used_at, settings)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        context.context_id,
        context.user_did,
        context.context_type,
        context.org_id,
        context.org_did,
        context.display_name,
        context.avatar,
        context.db_path,
        context.is_active,
        context.created_at,
        context.last_used_at,
        context.settings
      );

      console.log(`✓ 组织上下文 ${displayName} 创建成功`);
      return { success: true, context };
    } catch (error) {
      console.error('创建组织上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取所有身份上下文
   */
  getAllContexts(userDID) {
    try {
      const contexts = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE user_did = ? ORDER BY created_at ASC'
      ).all(userDID);

      return contexts.map(ctx => ({
        ...ctx,
        is_active: Boolean(ctx.is_active),
        settings: ctx.settings ? JSON.parse(ctx.settings) : {}
      }));
    } catch (error) {
      console.error('获取身份上下文列表失败:', error);
      return [];
    }
  }

  /**
   * 获取当前激活的上下文
   */
  getActiveContext(userDID) {
    try {
      const context = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE user_did = ? AND is_active = 1'
      ).get(userDID);

      if (!context) return null;

      return {
        ...context,
        is_active: Boolean(context.is_active),
        settings: context.settings ? JSON.parse(context.settings) : {}
      };
    } catch (error) {
      console.error('获取当前上下文失败:', error);
      return null;
    }
  }

  /**
   * 切换身份上下文
   */
  async switchContext(userDID, targetContextId) {
    try {
      console.log(`切换身份上下文: ${targetContextId}`);

      // 1. 获取目标上下文
      const targetContext = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE context_id = ? AND user_did = ?'
      ).get(targetContextId, userDID);

      if (!targetContext) {
        return { success: false, error: '目标上下文不存在' };
      }

      // 2. 获取当前激活的上下文
      const currentContext = this.getActiveContext(userDID);

      // 3. 卸载当前上下文的数据
      if (currentContext) {
        await this.unloadContext(currentContext.context_id);
      }

      // 4. 更新激活状态
      this.identityDb.prepare(
        'UPDATE identity_contexts SET is_active = 0 WHERE user_did = ?'
      ).run(userDID);

      this.identityDb.prepare(
        'UPDATE identity_contexts SET is_active = 1, last_used_at = ? WHERE context_id = ?'
      ).run(Date.now(), targetContextId);

      // 5. 加载新上下文的数据
      await this.loadContext(targetContextId);

      // 6. 记录切换历史
      this.identityDb.prepare(`
        INSERT INTO context_switch_history (from_context_id, to_context_id, switched_at, user_did)
        VALUES (?, ?, ?, ?)
      `).run(
        currentContext?.context_id || null,
        targetContextId,
        Date.now(),
        userDID
      );

      // 7. 更新当前上下文
      this.activeContext = targetContext;

      // 8. 触发切换事件
      this.emit('context-switched', {
        from: currentContext,
        to: targetContext
      });

      console.log(`✓ 已切换到: ${targetContext.display_name}`);

      return {
        success: true,
        context: {
          ...targetContext,
          is_active: true,
          settings: targetContext.settings ? JSON.parse(targetContext.settings) : {}
        }
      };
    } catch (error) {
      console.error('切换身份上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 加载上下文数据
   */
  async loadContext(contextId) {
    try {
      const context = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE context_id = ?'
      ).get(contextId);

      if (!context) {
        throw new Error('上下文不存在');
      }

      // 打开上下文数据库
      if (!this.contextDatabases.has(contextId)) {
        const dbPath = path.resolve(context.db_path);

        // 如果数据库文件不存在,创建一个新的
        if (!fs.existsSync(dbPath)) {
          console.log(`创建新的数据库文件: ${dbPath}`);
          const db = new SQLite(dbPath);
          db.pragma('journal_mode = WAL');
          db.close();
        }

        // 打开数据库
        const db = new SQLite(dbPath);
        db.pragma('journal_mode = WAL');
        this.contextDatabases.set(contextId, db);

        console.log(`✓ 已加载上下文数据库: ${context.display_name}`);
      }

      return { success: true };
    } catch (error) {
      console.error('加载上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 卸载上下文数据
   */
  async unloadContext(contextId) {
    try {
      // 关闭数据库连接
      if (this.contextDatabases.has(contextId)) {
        const db = this.contextDatabases.get(contextId);
        db.close();
        this.contextDatabases.delete(contextId);

        console.log(`✓ 已卸载上下文数据库: ${contextId}`);
      }

      return { success: true };
    } catch (error) {
      console.error('卸载上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取上下文数据库连接
   */
  getContextDatabase(contextId) {
    return this.contextDatabases.get(contextId);
  }

  /**
   * 加载默认上下文
   */
  async loadDefaultContext() {
    try {
      // 获取激活的上下文
      const activeContext = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE is_active = 1'
      ).get();

      if (activeContext) {
        await this.loadContext(activeContext.context_id);
        this.activeContext = activeContext;
        console.log(`✓ 已加载默认上下文: ${activeContext.display_name}`);
      }
    } catch (error) {
      console.error('加载默认上下文失败:', error);
    }
  }

  /**
   * 删除组织上下文
   */
  async deleteOrganizationContext(userDID, orgId) {
    try {
      const contextId = `org_${orgId}`;

      // 1. 获取上下文信息
      const context = this.identityDb.prepare(
        'SELECT * FROM identity_contexts WHERE context_id = ? AND user_did = ?'
      ).get(contextId, userDID);

      if (!context) {
        return { success: false, error: '上下文不存在' };
      }

      // 2. 如果是当前激活的上下文,先切换到个人上下文
      if (context.is_active) {
        await this.switchContext(userDID, 'personal');
      }

      // 3. 卸载上下文
      await this.unloadContext(contextId);

      // 4. 删除数据库文件
      const dbPath = path.resolve(context.db_path);
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log(`✓ 已删除数据库文件: ${dbPath}`);
      }

      // 5. 删除上下文记录
      this.identityDb.prepare(
        'DELETE FROM identity_contexts WHERE context_id = ?'
      ).run(contextId);

      console.log(`✓ 已删除组织上下文: ${context.display_name}`);

      return { success: true };
    } catch (error) {
      console.error('删除组织上下文失败:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取切换历史
   */
  getSwitchHistory(userDID, limit = 10) {
    try {
      const history = this.identityDb.prepare(`
        SELECT h.*,
               f.display_name as from_context_name,
               t.display_name as to_context_name
        FROM context_switch_history h
        LEFT JOIN identity_contexts f ON h.from_context_id = f.context_id
        LEFT JOIN identity_contexts t ON h.to_context_id = t.context_id
        WHERE h.user_did = ?
        ORDER BY h.switched_at DESC
        LIMIT ?
      `).all(userDID, limit);

      return history;
    } catch (error) {
      console.error('获取切换历史失败:', error);
      return [];
    }
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 关闭所有上下文数据库
    for (const [contextId, db] of this.contextDatabases.entries()) {
      try {
        db.close();
        console.log(`✓ 已关闭上下文数据库: ${contextId}`);
      } catch (error) {
        console.error(`关闭上下文数据库失败 ${contextId}:`, error);
      }
    }
    this.contextDatabases.clear();

    // 关闭身份数据库
    if (this.identityDb) {
      try {
        this.identityDb.close();
        console.log('✓ 已关闭身份上下文数据库');
      } catch (error) {
        console.error('关闭身份上下文数据库失败:', error);
      }
    }
  }
}

// 单例模式
let instance = null;

function getIdentityContextManager(dataDir) {
  if (!instance && dataDir) {
    instance = new IdentityContextManager(dataDir);
  }
  return instance;
}

module.exports = {
  IdentityContextManager,
  getIdentityContextManager
};
