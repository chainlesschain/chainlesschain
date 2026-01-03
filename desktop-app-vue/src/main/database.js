// sql.js is optional (may not be available in packaged builds)
let initSqlJs = null;
try {
  initSqlJs = require('sql.js');
} catch (err) {
  console.log('[Database] sql.js not available (will use better-sqlite3)');
}

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 导入数据库加密模块
let createDatabaseAdapter;
let createBetterSQLiteAdapter;
try {
  const dbModule = require('./database/index');
  createDatabaseAdapter = dbModule.createDatabaseAdapter;
} catch (e) {
  console.warn('[Database] 加密模块不可用，将使用sql.js:', e.message);
  createDatabaseAdapter = null;
}

// 导入 Better-SQLite3 适配器（用于开发环境）
try {
  const betterSqliteModule = require('./database/better-sqlite-adapter');
  createBetterSQLiteAdapter = betterSqliteModule.createBetterSQLiteAdapter;
} catch (e) {
  console.warn('[Database] Better-SQLite3 适配器不可用:', e.message);
  createBetterSQLiteAdapter = null;
}

// Try to load electron, fallback to global.app for testing
let app;
try {
  app = require('electron').app;
} catch (e) {
  // In test environment, use global.app if available
  app = global.app || { isPackaged: false, getPath: () => require('os').tmpdir() };
}

let getAppConfig;
try {
  getAppConfig = require('./app-config').getAppConfig;
} catch (e) {
  // Fallback for testing
  getAppConfig = () => ({ enableEncryption: false });
}

/**
 * 数据库管理类
 * 使用 SQLCipher（加密）或 sql.js 管理本地 SQLite 数据库
 */
class DatabaseManager {
  constructor(customPath = null, options = {}) {
    this.db = null;
    this.dbPath = null;
    this.SQL = null;
    this.adapter = null; // 数据库适配器
    this.inTransaction = false; // 跟踪是否在事务中
    this.customPath = customPath; // 允许指定自定义路径
    this.encryptionPassword = options.password || null; // 加密密码
    this.encryptionEnabled = options.encryptionEnabled !== false; // 默认启用加密
  }

  /**
   * 初始化数据库
   */
  async initialize() {
    try {
      // 获取数据库路径
      if (this.customPath) {
        this.dbPath = this.customPath;
      } else {
        const appConfig = getAppConfig();
        this.dbPath = appConfig.getDatabasePath();
        appConfig.ensureDatabaseDir();
      }

      console.log('数据库路径:', this.dbPath);

      // 开发环境优先使用 Better-SQLite3
      const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
      if (isDevelopment && createBetterSQLiteAdapter) {
        try {
          await this.initializeWithBetterSQLite();
          console.log('数据库初始化成功（Better-SQLite3 开发模式）');

          // Verify database is actually initialized
          if (!this.db) {
            throw new Error('数据库对象为null，初始化失败');
          }

          return true;
        } catch (error) {
          console.warn('[Database] Better-SQLite3 初始化失败，尝试其他方式:', error.message);
          console.warn('[Database] 错误堆栈:', error.stack);
        }
      }

      // 尝试使用加密数据库适配器
      if (createDatabaseAdapter && this.encryptionEnabled) {
        try {
          await this.initializeWithAdapter();
          console.log('数据库初始化成功（SQLCipher 加密模式）');

          // Verify database is actually initialized
          if (!this.db) {
            throw new Error('数据库对象为null，初始化失败');
          }

          return true;
        } catch (error) {
          console.warn('[Database] 加密初始化失败，回退到 sql.js:', error.message);
          console.warn('[Database] 错误堆栈:', error.stack);
          // 继续使用 sql.js
        }
      }

      // Fallback: 使用 sql.js
      await this.initializeWithSqlJs();
      console.log('数据库初始化成功（sql.js 模式）');

      // Verify database is actually initialized
      if (!this.db) {
        throw new Error('数据库对象为null，sql.js初始化失败');
      }

      return true;
    } catch (error) {
      console.error('数据库初始化失败:', error);
      console.error('错误堆栈:', error.stack);
      throw error;
    }
  }

  /**
   * 使用 Better-SQLite3 初始化（开发模式）
   */
  async initializeWithBetterSQLite() {
    console.log('[Database] 使用 Better-SQLite3 初始化数据库...');

    // 创建适配器
    this.adapter = await createBetterSQLiteAdapter({
      dbPath: this.dbPath
    });

    // 获取数据库实例
    this.db = this.adapter.db;

    // 不需要应用兼容性补丁 - Better-SQLite3 已经有正确的 API
    // applyStatementCompat() 只适用于 sql.js

    // 为 Better-SQLite3 添加 run() 方法以兼容旧代码
    if (!this.db.run && this.db.exec) {
      this.db.run = (sql, params) => {
        if (params && (Array.isArray(params) || typeof params === 'object')) {
          return this.db.prepare(sql).run(params);
        } else {
          this.db.exec(sql);
        }
      };
    }

    // 启用外键约束
    if (this.db.pragma) {
      this.db.pragma('foreign_keys = ON');
    }

    // 创建表
    this.createTables();

    // 运行数据库迁移
    this.runMigrations();
  }

  /**
   * 使用数据库适配器初始化（支持加密）
   */
  async initializeWithAdapter() {
    const appConfig = getAppConfig();

    // 创建数据库适配器
    this.adapter = await createDatabaseAdapter({
      dbPath: this.dbPath,
      encryptionEnabled: this.encryptionEnabled,
      password: this.encryptionPassword,
      autoMigrate: true,
      configPath: path.join(app.getPath('userData'), 'db-key-config.json')
    });

    // 创建数据库
    this.db = await this.adapter.createDatabase();

    // 应用兼容性补丁
    this.applyStatementCompat();

    // 启用外键约束
    if (this.db.pragma) {
      this.db.pragma('foreign_keys = ON');
    } else if (this.db.run) {
      this.db.run('PRAGMA foreign_keys = ON');
    }

    // 创建表
    this.createTables();

    // 运行数据库迁移
    this.runMigrations();
  }

  /**
   * 使用 sql.js 初始化（传统方式）
   */
  async initializeWithSqlJs() {
    this.SQL = await initSqlJs({
      locateFile: file => {
        const possiblePaths = [];

        if (app && app.isPackaged) {
          possiblePaths.push(
            path.join(process.resourcesPath, file),
            path.join(process.resourcesPath, 'app', 'node_modules', 'sql.js', 'dist', file),
            path.join(process.resourcesPath, 'node_modules', 'sql.js', 'dist', file),
            path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
          );
        } else {
          possiblePaths.push(
            path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
            path.join(process.cwd(), 'desktop-app-vue', 'node_modules', 'sql.js', 'dist', file),
            path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
            path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'sql.js', 'dist', file)
          );
        }

        for (const filePath of possiblePaths) {
          if (fs.existsSync(filePath)) {
            console.log('Found sql.js WASM at:', filePath);
            return filePath;
          }
        }

        console.error('Could not find sql.js WASM file. Tried:', possiblePaths);
        return possiblePaths[0];
      }
    });

    // 加载或创建数据库
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(buffer);
    } else {
      this.db = new this.SQL.Database();
    }

    // 启用外键约束
    this.applyStatementCompat();
    this.db.run('PRAGMA foreign_keys = ON');

    // 创建表
    this.createTables();

    // 运行数据库迁移
    this.runMigrations();
  }

  /**
   * Add better-sqlite style helpers to sql.js statements.
   */
  applyStatementCompat() {
    if (!this.db || this.db.__betterSqliteCompat) {
      return;
    }

    const manager = this;

    // Wrap Database.run() method for compatibility
    const originalDbRun = this.db.run ? this.db.run.bind(this.db) : null;
    this.db.run = function(sql, params) {
      try {
        const stmt = manager.db.prepare(sql);
        if (params && (Array.isArray(params) || typeof params === 'object')) {
          stmt.bind(manager.normalizeParams(params));
        }
        stmt.step();
        stmt.free();

        // Save to file if not in transaction
        if (!manager.inTransaction) {
          manager.saveToFile();
        }

        return { changes: manager.db.getRowsModified ? manager.db.getRowsModified() : 0 };
      } catch (error) {
        console.error('[Database] db.run() failed:', error.message);
        console.error('[Database] SQL:', sql.substring(0, 100));
        throw error;
      }
    };
    const rawPrepare = this.db.prepare.bind(this.db);

    const normalizeParams = (params) => {
      let result;
      if (params.length === 1) {
        const first = params[0];
        if (Array.isArray(first)) {
          result = first;
        } else if (first && typeof first === 'object') {
          result = first;
        } else {
          result = params;
        }
      } else {
        result = params;
      }

      // 将数组中的 undefined 替换为 null（sql.js 不支持 undefined）
      if (Array.isArray(result)) {
        return result.map(v => v === undefined ? null : v);
      }

      // 对象参数也要清理 undefined
      if (result && typeof result === 'object') {
        const cleaned = {};
        for (const key in result) {
          if (result.hasOwnProperty(key)) {
            cleaned[key] = result[key] === undefined ? null : result[key];
          }
        }
        return cleaned;
      }

      return result;
    };

    this.db.prepare = (sql) => {
      const stmt = rawPrepare(sql);

      if (!stmt.__betterSqliteCompat) {
        stmt.__betterSqliteCompat = true;

        // 保存原始方法的引用
        const rawGet = stmt.get ? stmt.get.bind(stmt) : null;

        stmt.get = (...params) => {
          const bound = normalizeParams(params);
          if (Array.isArray(bound) ? bound.length : bound && typeof bound === 'object') {
            stmt.bind(bound);
          }

          let row = null;
          if (stmt.step()) {
            try {
              // 获取列名
              const columns = stmt.getColumnNames();
              // 调用原始的 get() 方法获取数组值
              const values = rawGet ? rawGet() : [];

              // 手动构建对象
              row = {};
              for (let i = 0; i < columns.length; i++) {
                const value = values[i];
                // 只添加非 undefined 的值
                if (value !== undefined) {
                  row[columns[i]] = value;
                }
              }

              // 如果对象为空，返回 null
              if (Object.keys(row).length === 0) {
                row = null;
              }
            } catch (err) {
              console.error('[Database] 构建行对象失败:', err);
              row = null;
            }
          }

          stmt.reset();
          return row;
        };

        stmt.all = (...params) => {
          const bound = normalizeParams(params);
          if (Array.isArray(bound) ? bound.length : bound && typeof bound === 'object') {
            stmt.bind(bound);
          }
          const rows = [];

          // 获取列名
          let columns = null;

          while (stmt.step()) {
            try {
              // 第一次迭代时获取列名
              if (!columns) {
                columns = stmt.getColumnNames();
              }

              // 调用原始的 get() 方法获取数组值
              const values = rawGet ? rawGet() : [];

              // 使用列名手动构建对象
              const row = {};
              for (let i = 0; i < columns.length; i++) {
                const value = values[i];
                // 只添加非 undefined 的值
                if (value !== undefined) {
                  row[columns[i]] = value;
                }
              }

              if (Object.keys(row).length > 0) {
                rows.push(row);
              }
            } catch (err) {
              console.error('[Database] 构建行对象失败:', err);
              // 跳过这一行，继续处理下一行
            }
          }
          stmt.reset();
          return rows;
        };

        const rawRun = stmt.run ? stmt.run.bind(stmt) : null;
        stmt.run = (...params) => {
          const bound = normalizeParams(params);
          if (rawRun) {
            if (Array.isArray(bound) ? bound.length : bound && typeof bound === 'object') {
              rawRun(bound);
            } else {
              rawRun();
            }
          } else {
            if (Array.isArray(bound) ? bound.length : bound && typeof bound === 'object') {
              stmt.bind(bound);
            }
            stmt.step();
            stmt.reset();
          }
          // 只在非事务状态下自动保存文件
          if (!manager.inTransaction) {
            manager.saveToFile();
          }
          if (typeof manager.db.getRowsModified === 'function') {
            return { changes: manager.db.getRowsModified() };
          }
          return {};
        };
      }

      return stmt;
    };

    this.db.__betterSqliteCompat = true;
  }

  /**
   * 保存数据库到文件
   */
  saveToFile() {
    if (!this.db) {
      throw new Error('数据库未初始化');
    }

    // 如果使用适配器（SQLCipher），数据库自动保存
    if (this.adapter) {
      this.adapter.saveDatabase(this.db);
      return;
    }

    // sql.js 需要手动导出
    if (this.db.export) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  /**
   * 创建数据库表
   */
  createTables() {
    console.log('[Database] 开始创建数据库表...');

    try {
      // 使用exec()一次性执行所有SQL语句
      // 这样可以避免多次调用导致的statement关闭问题
      this.db.exec(`
      -- 知识库项表
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
      );

      -- 标签表
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- 知识库项-标签关联表
      CREATE TABLE IF NOT EXISTS knowledge_tags (
        knowledge_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (knowledge_id, tag_id),
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      -- 知识关系表（图谱）
      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL CHECK(relation_type IN ('link', 'tag', 'semantic', 'temporal')),
        weight REAL DEFAULT 1.0,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        UNIQUE(source_id, target_id, relation_type)
      );

      -- 对话表
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        knowledge_id TEXT,
        project_id TEXT,
        context_type TEXT DEFAULT 'global',
        context_data TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE SET NULL
      );

      -- 消息表
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      -- 搜索索引表
      CREATE TABLE IF NOT EXISTS knowledge_search (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY (id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 截图表
      CREATE TABLE IF NOT EXISTS screenshots (
        id TEXT PRIMARY KEY,
        knowledge_item_id TEXT,
        image_path TEXT NOT NULL,
        annotations TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 知识库版本历史表
      CREATE TABLE IF NOT EXISTS knowledge_version_history (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        content_snapshot TEXT,
        created_by TEXT,
        updated_by TEXT,
        git_commit_hash TEXT,
        cid TEXT,
        parent_version_id TEXT,
        change_summary TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_version_id) REFERENCES knowledge_version_history(id) ON DELETE SET NULL,
        UNIQUE(knowledge_id, version)
      );

      -- 项目分类表
      CREATE TABLE IF NOT EXISTS project_categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        icon TEXT,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (parent_id) REFERENCES project_categories(id) ON DELETE CASCADE
      );

      -- 项目表
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design')),
        status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
        root_path TEXT,
        file_count INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        template_id TEXT,
        cover_image_url TEXT,
        tags TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        category_id TEXT
      );

      -- 项目文件表
      CREATE TABLE IF NOT EXISTS project_files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER DEFAULT 0,
        content TEXT,
        content_hash TEXT,
        version INTEGER DEFAULT 1,
        fs_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 文件同步状态表
      CREATE TABLE IF NOT EXISTS file_sync_state (
        file_id TEXT PRIMARY KEY,
        fs_hash TEXT,
        db_hash TEXT,
        last_synced_at INTEGER,
        sync_direction TEXT DEFAULT 'bidirectional',
        conflict_detected INTEGER DEFAULT 0,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE
      );

      -- 项目任务表
      CREATE TABLE IF NOT EXISTS project_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_type TEXT NOT NULL CHECK(task_type IN ('create_file', 'edit_file', 'query_info', 'analyze_data', 'export_file', 'deploy_project')),
        description TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        result_path TEXT,
        result_data TEXT,
        error_message TEXT,
        execution_time INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目对话历史表
      CREATE TABLE IF NOT EXISTS project_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目任务计划表
      CREATE TABLE IF NOT EXISTS project_task_plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_title TEXT NOT NULL,
        task_type TEXT DEFAULT 'create' CHECK(task_type IN ('create', 'modify', 'analyze', 'export')),
        user_request TEXT NOT NULL,
        estimated_duration TEXT,
        subtasks TEXT NOT NULL,
        final_output TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
        current_step INTEGER DEFAULT 0,
        total_steps INTEGER DEFAULT 0,
        progress_percentage INTEGER DEFAULT 0,
        error_message TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目协作者表
      CREATE TABLE IF NOT EXISTS project_collaborators (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        collaborator_did TEXT,
        did TEXT,
        role TEXT DEFAULT 'viewer' CHECK(role IN ('owner', 'editor', 'viewer')),
        permissions TEXT,
        invited_by TEXT,
        invited_at INTEGER NOT NULL,
        accepted_at INTEGER,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'removed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, user_id)
      );

      -- 系统配置表
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        type TEXT DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 项目评论表
      CREATE TABLE IF NOT EXISTS project_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_id TEXT,
        file_path TEXT,
        parent_id TEXT,
        parent_comment_id TEXT,
        user_id TEXT NOT NULL,
        author_did TEXT,
        did TEXT,
        content TEXT NOT NULL,
        line_number INTEGER,
        resolved INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES project_comments(id) ON DELETE CASCADE
      );

      -- 项目市场清单表
      CREATE TABLE IF NOT EXISTS project_marketplace_listings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        price REAL DEFAULT 0,
        currency TEXT DEFAULT 'CNY',
        preview_images TEXT,
        demo_url TEXT,
        downloads INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        tags TEXT,
        category TEXT,
        license TEXT DEFAULT 'MIT',
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'unlisted', 'removed')),
        published_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id)
      );

      -- 项目知识链接表
      CREATE TABLE IF NOT EXISTS project_knowledge_links (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        knowledge_id TEXT NOT NULL,
        link_type TEXT DEFAULT 'reference' CHECK(link_type IN ('reference', 'source', 'related')),
        relevance_score REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        UNIQUE(project_id, knowledge_id)
      );

      -- 项目自动化规则表
      CREATE TABLE IF NOT EXISTS project_automation_rules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        trigger_type TEXT NOT NULL CHECK(trigger_type IN ('file_change', 'git_commit', 'schedule', 'manual')),
        trigger_config TEXT,
        action_type TEXT NOT NULL CHECK(action_type IN ('run_tests', 'build', 'deploy', 'notify', 'custom')),
        action_config TEXT,
        enabled INTEGER DEFAULT 1,
        last_run_at INTEGER,
        run_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目统计表
      CREATE TABLE IF NOT EXISTS project_stats (
        project_id TEXT PRIMARY KEY,
        file_count INTEGER DEFAULT 0,
        total_size_kb REAL DEFAULT 0,
        code_lines INTEGER DEFAULT 0,
        comment_lines INTEGER DEFAULT 0,
        blank_lines INTEGER DEFAULT 0,
        commit_count INTEGER DEFAULT 0,
        contributor_count INTEGER DEFAULT 0,
        last_commit_at INTEGER,
        last_updated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目日志表
      CREATE TABLE IF NOT EXISTS project_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        log_level TEXT NOT NULL CHECK(log_level IN ('debug', 'info', 'warn', 'error')),
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        user_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目分享表
      CREATE TABLE IF NOT EXISTS project_shares (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        share_token TEXT NOT NULL UNIQUE,
        share_mode TEXT NOT NULL CHECK(share_mode IN ('private', 'public')),
        share_link TEXT,
        access_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目模板表
      CREATE TABLE IF NOT EXISTS project_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        cover_image TEXT,
        category TEXT NOT NULL CHECK(category IN ('writing', 'ppt', 'excel', 'web', 'design', 'podcast', 'resume', 'research', 'marketing', 'education', 'lifestyle', 'travel', 'video', 'social-media', 'creative-writing', 'code-project', 'data-science', 'tech-docs', 'ecommerce', 'marketing-pro', 'legal', 'learning', 'health', 'productivity', 'career')),
        subcategory TEXT,
        tags TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design')),
        prompt_template TEXT,
        variables_schema TEXT,
        file_structure TEXT,
        default_files TEXT,
        is_builtin INTEGER DEFAULT 0,
        author TEXT,
        version TEXT DEFAULT '1.0.0',
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'conflict')),
        deleted INTEGER DEFAULT 0
      );

      -- 模板使用记录表
      CREATE TABLE IF NOT EXISTS template_usage_history (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        project_id TEXT,
        variables_used TEXT,
        used_at INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES project_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );

      -- 模板评价表
      CREATE TABLE IF NOT EXISTS template_ratings (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        review TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES project_templates(id) ON DELETE CASCADE,
        UNIQUE(template_id, user_id)
      );

      -- 创建所有索引
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON knowledge_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_updated_at ON knowledge_items(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_sync_status ON knowledge_items(sync_status);
      CREATE INDEX IF NOT EXISTS idx_kr_source ON knowledge_relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_kr_target ON knowledge_relations(target_id);
      CREATE INDEX IF NOT EXISTS idx_kr_type ON knowledge_relations(relation_type);
      CREATE INDEX IF NOT EXISTS idx_kr_weight ON knowledge_relations(weight DESC);
      -- 复合索引优化图谱查询性能
      CREATE INDEX IF NOT EXISTS idx_kr_source_type_weight ON knowledge_relations(source_id, relation_type, weight DESC);
      CREATE INDEX IF NOT EXISTS idx_kr_target_type_weight ON knowledge_relations(target_id, relation_type, weight DESC);
      CREATE INDEX IF NOT EXISTS idx_kr_type_weight_source ON knowledge_relations(relation_type, weight DESC, source_id);
      CREATE INDEX IF NOT EXISTS idx_kr_type_weight_target ON knowledge_relations(relation_type, weight DESC, target_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      -- 复合索引优化消息分页查询
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp ON messages(conversation_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_type_updated ON knowledge_items(type, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type);
      CREATE INDEX IF NOT EXISTS idx_projects_sync_status ON projects(sync_status);
      CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id);

      CREATE INDEX IF NOT EXISTS idx_project_categories_user_id ON project_categories(user_id);
      CREATE INDEX IF NOT EXISTS idx_project_categories_parent_id ON project_categories(parent_id);
      CREATE INDEX IF NOT EXISTS idx_project_categories_sort_order ON project_categories(sort_order);

      CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
      CREATE INDEX IF NOT EXISTS idx_file_sync_state_file_id ON file_sync_state(file_id);

      CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_project_conversations_project_id ON project_conversations(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_conversations_created_at ON project_conversations(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);
      CREATE INDEX IF NOT EXISTS idx_project_comments_project_id ON project_comments(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_comments_file_id ON project_comments(file_id);
      CREATE INDEX IF NOT EXISTS idx_project_marketplace_project_id ON project_marketplace_listings(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_marketplace_status ON project_marketplace_listings(status);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_links_project_id ON project_knowledge_links(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_links_knowledge_id ON project_knowledge_links(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_project_automation_project_id ON project_automation_rules(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_automation_enabled ON project_automation_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_project_logs_project_id ON project_logs(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_logs_level ON project_logs(log_level);
      CREATE INDEX IF NOT EXISTS idx_project_logs_created_at ON project_logs(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_project_shares_project_id ON project_shares(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_shares_token ON project_shares(share_token);
      CREATE INDEX IF NOT EXISTS idx_project_shares_mode ON project_shares(share_mode);

      CREATE INDEX IF NOT EXISTS idx_templates_category ON project_templates(category);
      CREATE INDEX IF NOT EXISTS idx_templates_subcategory ON project_templates(subcategory);
      CREATE INDEX IF NOT EXISTS idx_templates_type ON project_templates(project_type);
      CREATE INDEX IF NOT EXISTS idx_templates_usage ON project_templates(usage_count DESC);
      CREATE INDEX IF NOT EXISTS idx_templates_rating ON project_templates(rating DESC);
      CREATE INDEX IF NOT EXISTS idx_templates_builtin ON project_templates(is_builtin);
      CREATE INDEX IF NOT EXISTS idx_templates_deleted ON project_templates(deleted);
      CREATE INDEX IF NOT EXISTS idx_template_usage_template_id ON template_usage_history(template_id);
      CREATE INDEX IF NOT EXISTS idx_template_usage_user_id ON template_usage_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_template_usage_used_at ON template_usage_history(used_at DESC);
      CREATE INDEX IF NOT EXISTS idx_template_ratings_template_id ON template_ratings(template_id);
      CREATE INDEX IF NOT EXISTS idx_template_ratings_user_id ON template_ratings(user_id);

      CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);

      -- 社交模块：聊天会话表
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        participant_did TEXT NOT NULL,
        friend_nickname TEXT,
        last_message TEXT,
        last_message_time INTEGER,
        unread_count INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 社交模块：P2P消息持久化表
      CREATE TABLE IF NOT EXISTS p2p_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        receiver_did TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'file', 'voice', 'video')),
        file_path TEXT,
        encrypted INTEGER DEFAULT 1,
        status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read', 'failed')),
        device_id TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      -- 通知表
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('friend_request', 'message', 'like', 'comment', 'system')),
        title TEXT NOT NULL,
        content TEXT,
        data TEXT,
        is_read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- ============================
      -- 区块链相关表
      -- ============================

      -- 区块链钱包表
      CREATE TABLE IF NOT EXISTS blockchain_wallets (
        id TEXT PRIMARY KEY,
        address TEXT UNIQUE NOT NULL,
        wallet_type TEXT NOT NULL CHECK(wallet_type IN ('internal', 'external')),
        provider TEXT CHECK(provider IN ('builtin', 'metamask', 'walletconnect')),
        encrypted_private_key TEXT,
        mnemonic_encrypted TEXT,
        derivation_path TEXT,
        chain_id INTEGER,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- 链上资产表
      CREATE TABLE IF NOT EXISTS blockchain_assets (
        id TEXT PRIMARY KEY,
        local_asset_id TEXT,
        contract_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        token_type TEXT CHECK(token_type IN ('ERC20', 'ERC721', 'ERC1155')),
        token_id TEXT,
        deployment_tx TEXT,
        deployed_at INTEGER,
        UNIQUE(contract_address, chain_id, token_id),
        FOREIGN KEY (local_asset_id) REFERENCES assets(id) ON DELETE SET NULL
      );

      -- 区块链交易表
      CREATE TABLE IF NOT EXISTS blockchain_transactions (
        id TEXT PRIMARY KEY,
        tx_hash TEXT UNIQUE NOT NULL,
        chain_id INTEGER NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT,
        value TEXT,
        gas_used TEXT,
        gas_price TEXT,
        status TEXT CHECK(status IN ('pending', 'confirmed', 'failed')),
        block_number INTEGER,
        tx_type TEXT,
        local_ref_id TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER
      );

      -- 智能合约部署记录
      CREATE TABLE IF NOT EXISTS deployed_contracts (
        id TEXT PRIMARY KEY,
        contract_name TEXT NOT NULL,
        contract_type TEXT,
        contract_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        deployment_tx TEXT,
        deployer_address TEXT,
        abi_json TEXT,
        local_contract_id TEXT,
        deployed_at INTEGER NOT NULL,
        UNIQUE(contract_address, chain_id),
        FOREIGN KEY (local_contract_id) REFERENCES contracts(id) ON DELETE SET NULL
      );

      -- 跨链桥记录
      CREATE TABLE IF NOT EXISTS bridge_transfers (
        id TEXT PRIMARY KEY,
        from_chain_id INTEGER NOT NULL,
        to_chain_id INTEGER NOT NULL,
        from_tx_hash TEXT,
        to_tx_hash TEXT,
        asset_id TEXT,
        amount TEXT,
        status TEXT CHECK(status IN ('pending', 'completed', 'failed')),
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      -- 区块链索引
      CREATE INDEX IF NOT EXISTS idx_blockchain_wallets_address ON blockchain_wallets(address);
      CREATE INDEX IF NOT EXISTS idx_blockchain_wallets_chain ON blockchain_wallets(chain_id);
      CREATE INDEX IF NOT EXISTS idx_blockchain_assets_contract ON blockchain_assets(contract_address, chain_id);
      CREATE INDEX IF NOT EXISTS idx_blockchain_assets_local ON blockchain_assets(local_asset_id);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_hash ON blockchain_transactions(tx_hash);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_from ON blockchain_transactions(from_address);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_to ON blockchain_transactions(to_address);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_status ON blockchain_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_created ON blockchain_transactions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deployed_contracts_address ON deployed_contracts(contract_address, chain_id);
      CREATE INDEX IF NOT EXISTS idx_bridge_transfers_status ON bridge_transfers(status);
      CREATE INDEX IF NOT EXISTS idx_bridge_transfers_from_tx ON bridge_transfers(from_tx_hash);
      CREATE INDEX IF NOT EXISTS idx_bridge_transfers_to_tx ON bridge_transfers(to_tx_hash);

      -- 聊天和通知索引
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_participant ON chat_sessions(participant_did);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_unread ON chat_sessions(unread_count DESC);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_session ON p2p_chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_timestamp ON p2p_chat_messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_sender ON p2p_chat_messages(sender_did);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_receiver ON p2p_chat_messages(receiver_did);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_status ON p2p_chat_messages(status);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_did);
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

      -- ============================
      -- 企业版（去中心化组织）表结构
      -- ============================

      -- 身份上下文表（用户级别，加密）
      CREATE TABLE IF NOT EXISTS identity_contexts (
        context_id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        context_type TEXT NOT NULL CHECK(context_type IN ('personal', 'organization')),
        org_id TEXT,
        org_name TEXT,
        org_avatar TEXT,
        role TEXT,
        display_name TEXT,
        db_path TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER
      );

      -- 组织成员关系表（缓存）
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        org_id TEXT NOT NULL,
        org_did TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        UNIQUE(user_did, org_id)
      );

      -- 组织元数据表
      CREATE TABLE IF NOT EXISTS organization_info (
        org_id TEXT PRIMARY KEY,
        org_did TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT CHECK(type IN ('startup', 'company', 'community', 'opensource', 'education')),
        avatar TEXT,
        owner_did TEXT NOT NULL,
        settings_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 组织成员表
      CREATE TABLE IF NOT EXISTS organization_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        display_name TEXT,
        avatar TEXT,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
        permissions TEXT,
        joined_at INTEGER NOT NULL,
        last_active_at INTEGER,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'removed')),
        UNIQUE(org_id, member_did)
      );

      -- 组织角色表
      CREATE TABLE IF NOT EXISTS organization_roles (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        permissions TEXT,
        is_builtin INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(org_id, name)
      );

      -- 组织邀请表
      CREATE TABLE IF NOT EXISTS organization_invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        invite_code TEXT UNIQUE,
        invited_by TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        max_uses INTEGER DEFAULT 1,
        used_count INTEGER DEFAULT 0,
        expire_at INTEGER,
        created_at INTEGER NOT NULL
      );

      -- 组织DID邀请表（点对点邀请）
      CREATE TABLE IF NOT EXISTS organization_did_invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        org_name TEXT NOT NULL,
        invited_by_did TEXT NOT NULL,
        invited_by_name TEXT,
        invited_did TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'expired')),
        message TEXT,
        expire_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(org_id, invited_did)
      );

      -- 组织项目表
      CREATE TABLE IF NOT EXISTS organization_projects (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        owner_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 组织活动日志表
      CREATE TABLE IF NOT EXISTS organization_activities (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        actor_did TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        metadata TEXT,
        timestamp INTEGER NOT NULL
      );

      -- P2P同步状态表
      CREATE TABLE IF NOT EXISTS p2p_sync_state (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        local_version INTEGER DEFAULT 1,
        remote_version INTEGER DEFAULT 1,
        vector_clock TEXT, -- JSON: {did: version}
        cid TEXT,
        sync_status TEXT DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'conflict')),
        last_synced_at INTEGER,
        UNIQUE(org_id, resource_type, resource_id)
      );

      -- 离线同步队列表
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        data TEXT, -- JSON
        version INTEGER NOT NULL,
        vector_clock TEXT, -- JSON
        created_at INTEGER NOT NULL,
        retry_count INTEGER DEFAULT 0,
        last_retry_at INTEGER,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'failed', 'completed'))
      );

      -- 冲突记录表
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        local_version INTEGER NOT NULL,
        remote_version INTEGER NOT NULL,
        local_data TEXT, -- JSON
        remote_data TEXT, -- JSON
        local_vector_clock TEXT, -- JSON
        remote_vector_clock TEXT, -- JSON
        resolution_strategy TEXT, -- 'lww', 'merge', 'manual', 'local_wins', 'remote_wins'
        resolved INTEGER DEFAULT 0,
        resolved_at INTEGER,
        resolved_by_did TEXT,
        created_at INTEGER NOT NULL
      );

      -- 企业版索引
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_context ON identity_contexts(is_active) WHERE is_active = 1;
      CREATE INDEX IF NOT EXISTS idx_org_members_org_did ON organization_members(org_id, member_did);
      CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(org_id, role);
      CREATE INDEX IF NOT EXISTS idx_knowledge_org_id ON knowledge_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activities_org_timestamp ON organization_activities(org_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_activities_actor ON organization_activities(actor_did);
      CREATE INDEX IF NOT EXISTS idx_version_history_knowledge ON knowledge_version_history(knowledge_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_version_history_created ON knowledge_version_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sync_state_status ON p2p_sync_state(org_id, sync_status);
      CREATE INDEX IF NOT EXISTS idx_sync_state_version ON p2p_sync_state(org_id, resource_type, remote_version);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(org_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_resource ON sync_queue(org_id, resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_unresolved ON sync_conflicts(org_id, resolved, created_at);

      -- ============================
      -- 视频处理系统表结构
      -- ============================

      -- 视频文件主表
      CREATE TABLE IF NOT EXISTS video_files (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        duration REAL,
        width INTEGER,
        height INTEGER,
        fps REAL,
        format TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        bitrate INTEGER,
        has_audio INTEGER DEFAULT 1,
        thumbnail_path TEXT,
        knowledge_id TEXT,
        analysis_status TEXT DEFAULT 'pending',
        analysis_progress INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 视频分析结果表
      CREATE TABLE IF NOT EXISTS video_analysis (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        audio_path TEXT,
        transcription_text TEXT,
        transcription_confidence REAL,
        summary TEXT,
        tags TEXT,
        key_topics TEXT,
        sentiment TEXT,
        ocr_text TEXT,
        ocr_confidence REAL,
        analysis_engine TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频关键帧表
      CREATE TABLE IF NOT EXISTS video_keyframes (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        frame_path TEXT NOT NULL,
        timestamp REAL NOT NULL,
        scene_change_score REAL,
        ocr_text TEXT,
        ocr_confidence REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频字幕表
      CREATE TABLE IF NOT EXISTS video_subtitles (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        subtitle_type TEXT NOT NULL,
        language TEXT NOT NULL,
        format TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT,
        source TEXT,
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频编辑历史表
      CREATE TABLE IF NOT EXISTS video_edit_history (
        id TEXT PRIMARY KEY,
        original_video_id TEXT NOT NULL,
        output_video_id TEXT,
        output_path TEXT,
        operation_type TEXT NOT NULL,
        operation_params TEXT,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        duration REAL,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (original_video_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频场景表
      CREATE TABLE IF NOT EXISTS video_scenes (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        scene_index INTEGER NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        duration REAL,
        keyframe_path TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频系统索引
      CREATE INDEX IF NOT EXISTS idx_video_files_knowledge ON video_files(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_video_files_created ON video_files(created_at);
      CREATE INDEX IF NOT EXISTS idx_video_files_status ON video_files(analysis_status);
      CREATE INDEX IF NOT EXISTS idx_video_analysis_video ON video_analysis(video_file_id);
      CREATE INDEX IF NOT EXISTS idx_keyframes_video ON video_keyframes(video_file_id);
      CREATE INDEX IF NOT EXISTS idx_keyframes_timestamp ON video_keyframes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_subtitles_video ON video_subtitles(video_file_id);
      CREATE INDEX IF NOT EXISTS idx_edit_history_original ON video_edit_history(original_video_id);
      CREATE INDEX IF NOT EXISTS idx_scenes_video ON video_scenes(video_file_id);

      -- ============================
      -- 设计工具模块表（UI/UX Design Tool System）
      -- ============================

      -- 设计画板表
      CREATE TABLE IF NOT EXISTS design_artboards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT DEFAULT 'Untitled Artboard',
        width INTEGER DEFAULT 1920,
        height INTEGER DEFAULT 1080,
        background_color TEXT DEFAULT '#FFFFFF',
        position_x REAL DEFAULT 0,
        position_y REAL DEFAULT 0,
        order_index INTEGER DEFAULT 0,
        is_template BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 设计元素表（核心）
      CREATE TABLE IF NOT EXISTS design_objects (
        id TEXT PRIMARY KEY,
        artboard_id TEXT NOT NULL,
        object_type TEXT NOT NULL CHECK(object_type IN ('rect', 'circle', 'path', 'text', 'image', 'group', 'component')),
        name TEXT DEFAULT 'Layer',
        fabric_json TEXT NOT NULL,
        parent_id TEXT,
        order_index INTEGER DEFAULT 0,
        is_locked BOOLEAN DEFAULT 0,
        is_visible BOOLEAN DEFAULT 1,
        constraints TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (artboard_id) REFERENCES design_artboards(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES design_objects(id) ON DELETE CASCADE
      );

      -- UI 组件库表
      CREATE TABLE IF NOT EXISTS design_components (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        description TEXT,
        thumbnail_path TEXT,
        fabric_template TEXT NOT NULL,
        props_schema TEXT,
        default_props TEXT,
        tags TEXT,
        usage_count INTEGER DEFAULT 0,
        is_system BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 设计系统表（Design Tokens）
      CREATE TABLE IF NOT EXISTS design_tokens (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        token_type TEXT NOT NULL CHECK(token_type IN ('color', 'typography', 'spacing', 'shadow', 'border-radius')),
        token_name TEXT NOT NULL,
        token_value TEXT NOT NULL,
        description TEXT,
        category TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, token_type, token_name)
      );

      -- 设计评论表
      CREATE TABLE IF NOT EXISTS design_comments (
        id TEXT PRIMARY KEY,
        artboard_id TEXT NOT NULL,
        object_id TEXT,
        user_id TEXT NOT NULL,
        position_x REAL,
        position_y REAL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'archived')),
        thread_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (artboard_id) REFERENCES design_artboards(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES design_objects(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES design_comments(id) ON DELETE CASCADE
      );

      -- 设计版本历史表
      CREATE TABLE IF NOT EXISTS design_versions (
        id TEXT PRIMARY KEY,
        artboard_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        snapshot_data TEXT NOT NULL,
        change_summary TEXT,
        author_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (artboard_id) REFERENCES design_artboards(id) ON DELETE CASCADE,
        UNIQUE(artboard_id, version_number)
      );

      -- 设计模块索引
      CREATE INDEX IF NOT EXISTS idx_artboards_project ON design_artboards(project_id);
      CREATE INDEX IF NOT EXISTS idx_artboards_order ON design_artboards(project_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_objects_artboard ON design_objects(artboard_id);
      CREATE INDEX IF NOT EXISTS idx_objects_artboard_order ON design_objects(artboard_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_objects_parent ON design_objects(parent_id);
      CREATE INDEX IF NOT EXISTS idx_objects_type ON design_objects(object_type);
      CREATE INDEX IF NOT EXISTS idx_components_project ON design_components(project_id);
      CREATE INDEX IF NOT EXISTS idx_components_category ON design_components(category);
      CREATE INDEX IF NOT EXISTS idx_components_system ON design_components(is_system);
      CREATE INDEX IF NOT EXISTS idx_tokens_project_type ON design_tokens(project_id, token_type);
      CREATE INDEX IF NOT EXISTS idx_comments_artboard ON design_comments(artboard_id);
      CREATE INDEX IF NOT EXISTS idx_comments_object ON design_comments(object_id);
      CREATE INDEX IF NOT EXISTS idx_comments_thread ON design_comments(thread_id);
      CREATE INDEX IF NOT EXISTS idx_comments_status ON design_comments(status);
      CREATE INDEX IF NOT EXISTS idx_versions_artboard ON design_versions(artboard_id);
      CREATE INDEX IF NOT EXISTS idx_versions_artboard_version ON design_versions(artboard_id, version_number);
    `);

      console.log('[Database] ✓ 所有表和索引创建成功');

      // 保存更改
      this.saveToFile();
      console.log('[Database] 数据库表创建完成');
    } catch (error) {
      console.error('[Database] 创建表失败:', error);
      console.error('[Database] 错误详情:', error.message);
      console.error('[Database] 错误堆栈:', error.stack);
      throw error;
    }

    // 初始化默认配置和数据库迁移在表创建成功后单独执行
    // 这样即使它们失败也不影响表的创建
    try {
      this.initDefaultSettings();
    } catch (error) {
      console.warn('[Database] 初始化默认配置失败（可忽略）:', error.message);
    }

    try {
      this.migrateDatabase();
    } catch (error) {
      console.warn('[Database] 数据库迁移失败（可忽略）:', error.message);
    }
  }

  /**
   * 数据库迁移：为已存在的表添加新列
   */
  migrateDatabase() {
    console.log('[Database] 开始数据库迁移...');

    try {
      // ==================== 原有迁移 ====================
      // 检查 conversations 表是否有 project_id 列
      const conversationsInfo = this.db.prepare("PRAGMA table_info(conversations)").all();
      const hasProjectId = conversationsInfo.some(col => col.name === 'project_id');
      const hasContextType = conversationsInfo.some(col => col.name === 'context_type');
      const hasContextData = conversationsInfo.some(col => col.name === 'context_data');

      if (!hasProjectId) {
        console.log('[Database] 添加 conversations.project_id 列');
        this.db.run('ALTER TABLE conversations ADD COLUMN project_id TEXT');
      }
      if (!hasContextType) {
        console.log('[Database] 添加 conversations.context_type 列');
        this.db.run("ALTER TABLE conversations ADD COLUMN context_type TEXT DEFAULT 'global'");
      }
      if (!hasContextData) {
        console.log('[Database] 添加 conversations.context_data 列');
        this.db.run('ALTER TABLE conversations ADD COLUMN context_data TEXT');
      }

      // 检查 project_files 表是否有 fs_path 列
      const projectFilesInfo = this.db.prepare("PRAGMA table_info(project_files)").all();
      const hasFsPath = projectFilesInfo.some(col => col.name === 'fs_path');

      if (!hasFsPath) {
        console.log('[Database] 添加 project_files.fs_path 列');
        this.db.run('ALTER TABLE project_files ADD COLUMN fs_path TEXT');
      }

      // ==================== 同步字段迁移（V2） ====================
      console.log('[Database] 执行同步字段迁移 (V2)...');

      // 为 projects 表添加设备ID和同步字段
      const projectsInfo = this.db.prepare("PRAGMA table_info(projects)").all();
      if (!projectsInfo.some(col => col.name === 'device_id')) {
        console.log('[Database] 添加 projects.device_id 列');
        this.db.run('ALTER TABLE projects ADD COLUMN device_id TEXT');
      }
      if (!projectsInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 projects.synced_at 列');
        this.db.run('ALTER TABLE projects ADD COLUMN synced_at INTEGER');
      }
      if (!projectsInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 projects.deleted 列');
        this.db.run('ALTER TABLE projects ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // 为 conversations 表添加同步字段
      const convSyncInfo = this.db.prepare("PRAGMA table_info(conversations)").all();
      if (!convSyncInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 conversations.sync_status 列');
        this.db.run("ALTER TABLE conversations ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!convSyncInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 conversations.synced_at 列');
        this.db.run('ALTER TABLE conversations ADD COLUMN synced_at INTEGER');
      }

      // 为 messages 表添加同步字段
      const messagesInfo = this.db.prepare("PRAGMA table_info(messages)").all();
      if (!messagesInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 messages.sync_status 列');
        this.db.run("ALTER TABLE messages ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!messagesInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 messages.synced_at 列');
        this.db.run('ALTER TABLE messages ADD COLUMN synced_at INTEGER');
      }

      // 为 project_files 表添加设备ID和同步字段
      const filesSyncInfo = this.db.prepare("PRAGMA table_info(project_files)").all();
      if (!filesSyncInfo.some(col => col.name === 'device_id')) {
        console.log('[Database] 添加 project_files.device_id 列');
        this.db.run('ALTER TABLE project_files ADD COLUMN device_id TEXT');
      }
      if (!filesSyncInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 project_files.sync_status 列');
        this.db.run("ALTER TABLE project_files ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!filesSyncInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 project_files.synced_at 列');
        this.db.run('ALTER TABLE project_files ADD COLUMN synced_at INTEGER');
      }
      if (!filesSyncInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 project_files.deleted 列');
        this.db.run('ALTER TABLE project_files ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // 为 knowledge_items 表添加设备ID和同步字段
      const knowledgeInfo = this.db.prepare("PRAGMA table_info(knowledge_items)").all();
      if (!knowledgeInfo.some(col => col.name === 'device_id')) {
        console.log('[Database] 添加 knowledge_items.device_id 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN device_id TEXT');
      }
      if (!knowledgeInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 knowledge_items.sync_status 列');
        this.db.run("ALTER TABLE knowledge_items ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!knowledgeInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 knowledge_items.synced_at 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN synced_at INTEGER');
      }
      if (!knowledgeInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 knowledge_items.deleted 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // ==================== 企业版字段迁移 ====================
      console.log('[Database] 执行企业版字段迁移...');

      // 为 knowledge_items 表添加组织相关字段
      if (!knowledgeInfo.some(col => col.name === 'org_id')) {
        console.log('[Database] 添加 knowledge_items.org_id 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN org_id TEXT');
      }
      if (!knowledgeInfo.some(col => col.name === 'created_by')) {
        console.log('[Database] 添加 knowledge_items.created_by 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN created_by TEXT');
      }
      if (!knowledgeInfo.some(col => col.name === 'updated_by')) {
        console.log('[Database] 添加 knowledge_items.updated_by 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN updated_by TEXT');
      }
      if (!knowledgeInfo.some(col => col.name === 'share_scope')) {
        console.log('[Database] 添加 knowledge_items.share_scope 列');
        this.db.run("ALTER TABLE knowledge_items ADD COLUMN share_scope TEXT DEFAULT 'private'");
      }
      if (!knowledgeInfo.some(col => col.name === 'permissions')) {
        console.log('[Database] 添加 knowledge_items.permissions 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN permissions TEXT');
      }
      if (!knowledgeInfo.some(col => col.name === 'version')) {
        console.log('[Database] 添加 knowledge_items.version 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN version INTEGER DEFAULT 1');
      }
      if (!knowledgeInfo.some(col => col.name === 'parent_version_id')) {
        console.log('[Database] 添加 knowledge_items.parent_version_id 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN parent_version_id TEXT');
      }
      if (!knowledgeInfo.some(col => col.name === 'cid')) {
        console.log('[Database] 添加 knowledge_items.cid 列');
        this.db.run('ALTER TABLE knowledge_items ADD COLUMN cid TEXT');
      }

      // 为 project_collaborators 表添加基础和同步字段
      const collabInfo = this.db.prepare("PRAGMA table_info(project_collaborators)").all();
      if (!collabInfo.some(col => col.name === 'created_at')) {
        console.log('[Database] 添加 project_collaborators.created_at 列');
        this.db.run('ALTER TABLE project_collaborators ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');
      }
      if (!collabInfo.some(col => col.name === 'updated_at')) {
        console.log('[Database] 添加 project_collaborators.updated_at 列');
        this.db.run('ALTER TABLE project_collaborators ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0');
      }
      if (!collabInfo.some(col => col.name === 'device_id')) {
        console.log('[Database] 添加 project_collaborators.device_id 列');
        this.db.run('ALTER TABLE project_collaborators ADD COLUMN device_id TEXT');
      }
      if (!collabInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 project_collaborators.sync_status 列');
        this.db.run("ALTER TABLE project_collaborators ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!collabInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 project_collaborators.synced_at 列');
        this.db.run('ALTER TABLE project_collaborators ADD COLUMN synced_at INTEGER');
      }
      if (!collabInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 project_collaborators.deleted 列');
        this.db.run('ALTER TABLE project_collaborators ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // 为 project_comments 表添加设备ID和同步字段
      const commentsInfo = this.db.prepare("PRAGMA table_info(project_comments)").all();
      if (!commentsInfo.some(col => col.name === 'device_id')) {
        console.log('[Database] 添加 project_comments.device_id 列');
        this.db.run('ALTER TABLE project_comments ADD COLUMN device_id TEXT');
      }
      if (!commentsInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 project_comments.sync_status 列');
        this.db.run("ALTER TABLE project_comments ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!commentsInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 project_comments.synced_at 列');
        this.db.run('ALTER TABLE project_comments ADD COLUMN synced_at INTEGER');
      }
      if (!commentsInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 project_comments.deleted 列');
        this.db.run('ALTER TABLE project_comments ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // 为 project_tasks 表添加设备ID和同步字段
      const tasksInfo = this.db.prepare("PRAGMA table_info(project_tasks)").all();
      if (!tasksInfo.some(col => col.name === 'device_id')) {
        console.log('[Database] 添加 project_tasks.device_id 列');
        this.db.run('ALTER TABLE project_tasks ADD COLUMN device_id TEXT');
      }
      if (!tasksInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 project_tasks.sync_status 列');
        this.db.run("ALTER TABLE project_tasks ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!tasksInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 project_tasks.synced_at 列');
        this.db.run('ALTER TABLE project_tasks ADD COLUMN synced_at INTEGER');
      }
      if (!tasksInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 project_tasks.deleted 列');
        this.db.run('ALTER TABLE project_tasks ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // 为 project_conversations 表添加同步字段
      const projConvInfo = this.db.prepare("PRAGMA table_info(project_conversations)").all();
      if (!projConvInfo.some(col => col.name === 'sync_status')) {
        console.log('[Database] 添加 project_conversations.sync_status 列');
        this.db.run("ALTER TABLE project_conversations ADD COLUMN sync_status TEXT DEFAULT 'pending'");
      }
      if (!projConvInfo.some(col => col.name === 'synced_at')) {
        console.log('[Database] 添加 project_conversations.synced_at 列');
        this.db.run('ALTER TABLE project_conversations ADD COLUMN synced_at INTEGER');
      }
      if (!projConvInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 project_conversations.deleted 列');
        this.db.run('ALTER TABLE project_conversations ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // 为 project_templates 表添加 deleted 字段
      const templatesInfo = this.db.prepare("PRAGMA table_info(project_templates)").all();
      if (!templatesInfo.some(col => col.name === 'deleted')) {
        console.log('[Database] 添加 project_templates.deleted 列');
        this.db.run('ALTER TABLE project_templates ADD COLUMN deleted INTEGER DEFAULT 0');
      }

      // ==================== 项目分类迁移 (V3) ====================
      console.log('[Database] 执行项目分类迁移 (V3)...');

      // 为 projects 表添加 category_id 字段
      const projectsInfoV3 = this.db.prepare("PRAGMA table_info(projects)").all();
      if (!projectsInfoV3.some(col => col.name === 'category_id')) {
        console.log('[Database] 添加 projects.category_id 列');
        this.db.run('ALTER TABLE projects ADD COLUMN category_id TEXT');
        // 添加外键约束（注：SQLite的ALTER TABLE不支持直接添加外键，需要在查询时处理）
      }

      // ==================== CHECK约束更新迁移 (V4) ====================
      console.log('[Database] 执行CHECK约束更新迁移 (V4)...');

      // 检查是否需要重建projects表（通过尝试插入测试数据来判断）
      const needsProjectsRebuild = this.checkIfTableNeedsRebuild('projects', 'presentation');
      if (needsProjectsRebuild) {
        console.log('[Database] 检测到projects表需要更新CHECK约束，开始重建...');
        this.rebuildProjectsTable();
      }

      // 检查是否需要重建project_templates表
      const needsTemplatesRebuild = this.checkIfTableNeedsRebuild('project_templates', 'career');
      if (needsTemplatesRebuild) {
        console.log('[Database] 检测到project_templates表需要更新CHECK约束，开始重建...');
        this.rebuildProjectTemplatesTable();
      }

      console.log('[Database] 数据库迁移完成');
    } catch (error) {
      console.error('[Database] 数据库迁移失败:', error);
    }
  }

  /**
   * 运行数据库迁移 - 增量更新数据库结构
   */
  runMigrations() {
    try {
      console.log('[Database] 开始运行数据库迁移...');

      // 迁移1: 修复 project_stats 表的列名
      const statsInfo = this.db.prepare("PRAGMA table_info(project_stats)").all();
      const hasTotalSize = statsInfo.some(col => col.name === 'total_size');
      const hasTotalSizeKb = statsInfo.some(col => col.name === 'total_size_kb');
      const hasLastUpdatedAt = statsInfo.some(col => col.name === 'last_updated_at');

      if (hasTotalSize && !hasTotalSizeKb) {
        console.log('[Database] 迁移 project_stats 表: total_size -> total_size_kb');
        // SQLite不支持重命名列，需要重建表
        this.db.exec(`
          -- 创建临时表
          CREATE TABLE project_stats_new (
            project_id TEXT PRIMARY KEY,
            file_count INTEGER DEFAULT 0,
            total_size_kb REAL DEFAULT 0,
            code_lines INTEGER DEFAULT 0,
            comment_lines INTEGER DEFAULT 0,
            blank_lines INTEGER DEFAULT 0,
            commit_count INTEGER DEFAULT 0,
            contributor_count INTEGER DEFAULT 0,
            last_commit_at INTEGER,
            last_updated_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          );

          -- 复制数据，将 total_size (bytes) 转换为 total_size_kb
          INSERT INTO project_stats_new (
            project_id, file_count, total_size_kb, code_lines, comment_lines,
            blank_lines, commit_count, contributor_count, last_commit_at,
            last_updated_at, created_at, updated_at
          )
          SELECT
            project_id, file_count, CAST(total_size AS REAL) / 1024.0, code_lines, comment_lines,
            blank_lines, commit_count, contributor_count, last_commit_at,
            last_commit_at, created_at, updated_at
          FROM project_stats;

          -- 删除旧表
          DROP TABLE project_stats;

          -- 重命名新表
          ALTER TABLE project_stats_new RENAME TO project_stats;
        `);
        this.saveToFile();
        console.log('[Database] project_stats 表迁移完成');
      } else if (!hasTotalSizeKb) {
        // 如果两个列都不存在，添加 total_size_kb 列
        console.log('[Database] 添加 project_stats.total_size_kb 列');
        this.db.run('ALTER TABLE project_stats ADD COLUMN total_size_kb REAL DEFAULT 0');
        this.saveToFile();

        // 同时检查并添加 last_updated_at 列
        if (!hasLastUpdatedAt) {
          console.log('[Database] 添加 project_stats.last_updated_at 列');
          this.db.run('ALTER TABLE project_stats ADD COLUMN last_updated_at INTEGER');
          this.saveToFile();
        }
      } else if (!hasLastUpdatedAt) {
        // 如果 total_size_kb 已存在，但 last_updated_at 不存在
        console.log('[Database] 添加 project_stats.last_updated_at 列');
        this.db.run('ALTER TABLE project_stats ADD COLUMN last_updated_at INTEGER');
        this.saveToFile();
      }

      // 迁移2: 插件系统
      const pluginTableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='plugins'").get();

      if (!pluginTableExists) {
        console.log('[Database] 创建插件系统表...');
        try {
          const migrationPath = path.join(__dirname, 'database', 'migrations', '001_plugin_system.sql');
          if (fs.existsSync(migrationPath)) {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
            this.db.exec(migrationSQL);
            this.saveToFile();
            console.log('[Database] 插件系统表创建完成');
          } else {
            console.warn('[Database] 插件系统迁移文件不存在:', migrationPath);
          }
        } catch (pluginError) {
          console.error('[Database] 创建插件系统表失败:', pluginError);
        }
      }

      // 迁移3: 音频系统 (语音识别)
      const audioTableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audio_files'").get();

      if (!audioTableExists) {
        console.log('[Database] 创建音频系统表...');
        try {
          const migrationPath = path.join(__dirname, 'database', 'migrations', '002_audio_system.sql');
          if (fs.existsSync(migrationPath)) {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
            this.db.exec(migrationSQL);
            this.saveToFile();
            console.log('[Database] 音频系统表创建完成');
          } else {
            console.warn('[Database] 音频系统迁移文件不存在:', migrationPath);
          }
        } catch (audioError) {
          console.error('[Database] 创建音频系统表失败:', audioError);
        }
      }

      // 迁移4: 技能和工具管理系统
      const skillTableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'").get();

      if (!skillTableExists) {
        console.log('[Database] 创建技能和工具管理系统表...');
        try {
          const migrationPath = path.join(__dirname, 'database', 'migrations', '003_skill_tool_system.sql');
          if (fs.existsSync(migrationPath)) {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
            this.db.exec(migrationSQL);
            this.saveToFile();
            console.log('[Database] 技能和工具管理系统表创建完成');
          } else {
            console.warn('[Database] 技能工具系统迁移文件不存在:', migrationPath);
          }
        } catch (skillToolError) {
          console.error('[Database] 创建技能工具系统表失败:', skillToolError);
        }
      }

      // 迁移5: 初始化内置技能和工具数据
      const skillsCount = this.db.prepare("SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1").get();

      if (skillTableExists && skillsCount.count === 0) {
        console.log('[Database] 初始化内置技能和工具数据...');
        try {
          const dataInitPath = path.join(__dirname, 'database', 'migrations', '004_video_skills_tools.sql');
          if (fs.existsSync(dataInitPath)) {
            const dataInitSQL = fs.readFileSync(dataInitPath, 'utf-8');
            this.db.exec(dataInitSQL);
            this.saveToFile();

            // 验证数据是否成功插入
            const newSkillsCount = this.db.prepare("SELECT COUNT(*) as count FROM skills WHERE is_builtin = 1").get();
            const newToolsCount = this.db.prepare("SELECT COUNT(*) as count FROM tools WHERE is_builtin = 1").get();
            console.log(`[Database] 内置数据初始化完成 - 技能: ${newSkillsCount.count}, 工具: ${newToolsCount.count}`);
          } else {
            console.warn('[Database] 内置数据初始化文件不存在:', dataInitPath);
          }
        } catch (dataInitError) {
          console.error('[Database] 初始化内置数据失败:', dataInitError);
        }
      }

      // 迁移6: Phase 1 - 工作区与任务管理系统 (v0.17.0)
      const workspaceTableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='organization_workspaces'").get();

      if (!workspaceTableExists) {
        console.log('[Database] Phase 1 迁移 - 创建工作区与任务管理系统表...');
        try {
          const migrationPath = path.join(__dirname, 'database', 'migrations', '005_workspace_task_system.sql');
          if (fs.existsSync(migrationPath)) {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
            this.db.exec(migrationSQL);
            this.saveToFile();
            console.log('[Database] 工作区与任务管理系统表创建完成');
          } else {
            console.warn('[Database] 工作区任务系统迁移文件不存在:', migrationPath);
          }
        } catch (workspaceError) {
          console.error('[Database] 创建工作区任务系统表失败:', workspaceError);
        }
      }

      // 迁移7: 为现有 project_tasks 表添加企业协作字段
      const tasksInfo = this.db.prepare("PRAGMA table_info(project_tasks)").all();
      const tasksColumnsToAdd = [
        { name: 'org_id', type: 'TEXT', default: null },
        { name: 'workspace_id', type: 'TEXT', default: null },
        { name: 'assigned_to', type: 'TEXT', default: null },
        { name: 'collaborators', type: 'TEXT', default: null },
        { name: 'labels', type: 'TEXT', default: null },
        { name: 'due_date', type: 'INTEGER', default: null },
        { name: 'reminder_at', type: 'INTEGER', default: null },
        { name: 'blocked_by', type: 'TEXT', default: null },
        { name: 'estimate_hours', type: 'REAL', default: null },
        { name: 'actual_hours', type: 'REAL', default: null }
      ];

      let tasksColumnsAdded = false;
      for (const column of tasksColumnsToAdd) {
        if (!tasksInfo.some(col => col.name === column.name)) {
          console.log(`[Database] 添加 project_tasks.${column.name} 列`);
          const defaultClause = column.default !== null ? ` DEFAULT ${column.default}` : '';
          this.db.run(`ALTER TABLE project_tasks ADD COLUMN ${column.name} ${column.type}${defaultClause}`);
          tasksColumnsAdded = true;
        }
      }

      if (tasksColumnsAdded) {
        this.saveToFile();
        console.log('[Database] project_tasks 表字段扩展完成');
      }

      // 迁移8: Phase 2 - 文件共享与版本控制系统 (v0.18.0)
      const fileVersionsTableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='file_versions'").get();

      if (!fileVersionsTableExists) {
        console.log('[Database] Phase 2 迁移 - 创建文件共享与版本控制系统表...');
        try {
          const migrationPath = path.join(__dirname, 'database', 'migrations', '006_file_sharing_system.sql');
          if (fs.existsSync(migrationPath)) {
            const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
            this.db.exec(migrationSQL);
            this.saveToFile();
            console.log('[Database] 文件共享与版本控制系统表创建完成');
          } else {
            console.warn('[Database] 文件共享系统迁移文件不存在:', migrationPath);
          }
        } catch (fileError) {
          console.error('[Database] 创建文件共享系统表失败:', fileError);
        }
      }

      // 迁移9: 为现有 project_files 表添加共享和锁定字段
      const filesInfo = this.db.prepare("PRAGMA table_info(project_files)").all();
      const filesColumnsToAdd = [
        { name: 'org_id', type: 'TEXT', default: null },
        { name: 'workspace_id', type: 'TEXT', default: null },
        { name: 'shared_with', type: 'TEXT', default: null },
        { name: 'lock_status', type: 'TEXT', default: "'unlocked'" },
        { name: 'locked_by', type: 'TEXT', default: null },
        { name: 'locked_at', type: 'INTEGER', default: null },
        { name: 'version_number', type: 'INTEGER', default: 1 },
        { name: 'checksum', type: 'TEXT', default: null }
      ];

      let filesColumnsAdded = false;
      for (const column of filesColumnsToAdd) {
        if (!filesInfo.some(col => col.name === column.name)) {
          console.log(`[Database] 添加 project_files.${column.name} 列`);
          const defaultClause = column.default !== null ? ` DEFAULT ${column.default}` : '';
          this.db.run(`ALTER TABLE project_files ADD COLUMN ${column.name} ${column.type}${defaultClause}`);
          filesColumnsAdded = true;
        }
      }

      if (filesColumnsAdded) {
        this.saveToFile();
        console.log('[Database] project_files 表字段扩展完成');
      }

      console.log('[Database] 数据库迁移任务完成');
    } catch (error) {
      console.error('[Database] 运行数据库迁移失败:', error);
      // 不抛出错误，避免影响应用启动
    }
  }

  /**
   * 检查表是否需要重建（通过测试category值）
   */
  checkIfTableNeedsRebuild(tableName, testCategoryValue) {
    try {
      // 获取表的SQL定义
      const stmt = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?");
      const result = stmt.get([tableName]);
      stmt.free();

      if (!result || !result.sql) {
        return false;
      }

      // 检查SQL定义中是否包含新的值
      const sql = result.sql;

      if (tableName === 'projects') {
        // 检查是否包含 'presentation' 和 'spreadsheet'
        return !sql.includes("'presentation'") || !sql.includes("'spreadsheet'");
      } else if (tableName === 'project_templates') {
        // 检查category是否包含测试值
        return !sql.includes(`'${testCategoryValue}'`);
      }

      return false;
    } catch (error) {
      console.error(`[Database] 检查${tableName}表失败:`, error);
      return false;
    }
  }

  /**
   * 重建projects表（更新CHECK约束）
   */
  rebuildProjectsTable() {
    try {
      console.log('[Database] 开始重建projects表...');

      // 1. 重命名旧表
      this.db.run('ALTER TABLE projects RENAME TO projects_old');

      // 2. 创建新表（带更新的CHECK约束）
      this.db.run(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design')),
          status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
          root_path TEXT,
          file_count INTEGER DEFAULT 0,
          total_size INTEGER DEFAULT 0,
          template_id TEXT,
          cover_image_url TEXT,
          tags TEXT,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
          synced_at INTEGER,
          device_id TEXT,
          deleted INTEGER DEFAULT 0,
          category_id TEXT
        )
      `);

      // 3. 复制数据
      this.db.run(`
        INSERT INTO projects
        SELECT id, user_id, name, description, project_type, status, root_path,
               file_count, total_size, template_id, cover_image_url, tags, metadata,
               created_at, updated_at, sync_status, synced_at, device_id, deleted,
               ${this.checkColumnExists('projects_old', 'category_id') ? 'category_id' : 'NULL'}
        FROM projects_old
      `);

      // 4. 删除旧表
      this.db.run('DROP TABLE projects_old');

      // 5. 重新创建索引
      this.db.run('CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_projects_sync_status ON projects(sync_status)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id)');

      this.saveToFile();
      console.log('[Database] projects表重建成功');
    } catch (error) {
      console.error('[Database] 重建projects表失败:', error);
      throw error;
    }
  }

  /**
   * 重建project_templates表（更新CHECK约束）
   */
  rebuildProjectTemplatesTable() {
    try {
      console.log('[Database] 开始重建project_templates表...');

      // 1. 重命名旧表
      this.db.run('ALTER TABLE project_templates RENAME TO project_templates_old');

      // 2. 创建新表（带更新的CHECK约束）
      this.db.run(`
        CREATE TABLE project_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          description TEXT,
          icon TEXT,
          cover_image TEXT,

          -- 分类信息
          category TEXT NOT NULL CHECK(category IN (
            -- 原有分类
            'writing',      -- 写作
            'ppt',          -- PPT演示
            'excel',        -- Excel数据
            'web',          -- 网页开发
            'design',       -- 设计
            'podcast',      -- 播客
            'resume',       -- 简历
            'research',     -- 研究
            'marketing',    -- 营销
            'education',    -- 教育
            'lifestyle',    -- 生活
            'travel',       -- 旅游
            -- 新增分类 (v0.19.0)
            'video',            -- 视频内容
            'social-media',     -- 社交媒体
            'creative-writing', -- 创意写作
            'code-project',     -- 代码项目
            'data-science',     -- 数据科学
            'tech-docs',        -- 技术文档
            'ecommerce',        -- 电商运营
            'marketing-pro',    -- 营销推广
            'legal',            -- 法律文档
            'learning',         -- 学习成长
            'health',           -- 健康生活
            'productivity',     -- 时间管理
            'career'            -- 职业发展
          )),
          subcategory TEXT,
          tags TEXT,

          -- 模板配置
          project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design')),
          prompt_template TEXT,
          variables_schema TEXT,
          file_structure TEXT,
          default_files TEXT,

          -- 元数据
          is_builtin INTEGER DEFAULT 0,
          author TEXT,
          version TEXT DEFAULT '1.0.0',
          usage_count INTEGER DEFAULT 0,
          rating REAL DEFAULT 0,
          rating_count INTEGER DEFAULT 0,

          -- 时间戳
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,

          -- 同步
          sync_status TEXT DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'conflict')),
          deleted INTEGER DEFAULT 0
        )
      `);

      // 3. 复制数据
      this.db.run(`
        INSERT INTO project_templates
        SELECT id, name, display_name, description, icon, cover_image,
               category, subcategory, tags,
               project_type, prompt_template, variables_schema, file_structure, default_files,
               is_builtin, author, version, usage_count, rating, rating_count,
               created_at, updated_at, sync_status,
               ${this.checkColumnExists('project_templates_old', 'deleted') ? 'deleted' : '0'}
        FROM project_templates_old
      `);

      // 4. 删除旧表
      this.db.run('DROP TABLE project_templates_old');

      // 5. 重新创建索引
      this.db.run('CREATE INDEX IF NOT EXISTS idx_templates_category ON project_templates(category)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_templates_subcategory ON project_templates(subcategory)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_templates_type ON project_templates(project_type)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_templates_usage ON project_templates(usage_count DESC)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_templates_rating ON project_templates(rating DESC)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_templates_builtin ON project_templates(is_builtin)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_templates_deleted ON project_templates(deleted)');

      this.saveToFile();
      console.log('[Database] project_templates表重建成功');
    } catch (error) {
      console.error('[Database] 重建project_templates表失败:', error);
      throw error;
    }
  }

  /**
   * 检查列是否存在
   */
  checkColumnExists(tableName, columnName) {
    try {
      const stmt = this.db.prepare(`PRAGMA table_info(${tableName})`);
      const columns = stmt.all();
      stmt.free();
      return columns.some(col => col.name === columnName);
    } catch (error) {
      return false;
    }
  }

  // ==================== 知识库项操作 ====================

  /**
   * 获取所有知识库项
   * @param {number} limit - 限制数量
   * @param {number} offset - 偏移量
   * @returns {Array} 知识库项列表
   */
  getKnowledgeItems(limit = 100, offset = 0) {
    // 数据库未初始化检查
    if (!this.db) {
      console.warn('[Database] 数据库未初始化，无法获取知识库项');
      return [];
    }

    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 100;
    const safeOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? Math.floor(parsedOffset) : 0;

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM knowledge_items
        ORDER BY updated_at DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `);

      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('[Database] 获取知识库项失败:', error.message);
      return [];
    }
  }

  /**
   * 根据ID获取知识库项
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItemById(id) {
    if (!id || !this.db) {
      return null;
    }

    try {
      const stmt = this.db.prepare('SELECT * FROM knowledge_items WHERE id = ?');
      stmt.bind([id]);

      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return result;
    } catch (error) {
      console.error('[Database] 获取知识库项失败:', error.message);
      return null;
    }
  }

  /**
   * 根据ID获取知识库项（别名）
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItem(id) {
    return this.getKnowledgeItemById(id);
  }

  /**
   * 根据标题获取知识库项
   * @param {string} title - 标题
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItemByTitle(title) {
    if (!title || !this.db) {
      return null;
    }

    try {
      const stmt = this.db.prepare('SELECT * FROM knowledge_items WHERE title = ? LIMIT 1');
      stmt.bind([title]);

      const result = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return result;
    } catch (error) {
      console.error('[Database] 根据标题获取知识库项失败:', error.message);
      return null;
    }
  }

  /**
   * 获取所有知识库项（无限制）
   * @returns {Array} 知识库项列表
   */
  getAllKnowledgeItems() {
    if (!this.db) {
      console.warn('[Database] 数据库未初始化，无法获取知识库项');
      return [];
    }

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM knowledge_items
        ORDER BY updated_at DESC
      `);

      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (error) {
      console.error('[Database] 获取所有知识库项失败:', error.message);
      return [];
    }
  }

  /**
   * 添加知识库项
   * @param {Object} item - 知识库项数据
   * @returns {Object} 创建的项目
   */
  addKnowledgeItem(item) {
    const safeItem = item || {};
    const id = safeItem.id || uuidv4();
    const now = Date.now();
    const rawTitle = typeof safeItem.title === 'string' ? safeItem.title.trim() : '';
    const title = rawTitle || 'Untitled';
    const type = typeof safeItem.type === 'string' && safeItem.type ? safeItem.type : 'note';
    const content = typeof safeItem.content === 'string' ? safeItem.content : null;

    this.db.run(`
      INSERT INTO knowledge_items (
        id, title, type, content, content_path, embedding_path,
        created_at, updated_at, git_commit_hash, device_id, sync_status
      ) VALUES (?, COALESCE(NULLIF(?, ''), 'Untitled'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      title,
      type,
      content,
      safeItem.content_path || null,
      safeItem.embedding_path || null,
      now,
      now,
      safeItem.git_commit_hash || null,
      safeItem.device_id || null,
      safeItem.sync_status || 'pending'
    ]);

    // 更新全文搜索索引
    this.updateSearchIndex(id, title, content || '');

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
   * Track query performance and log slow queries
   * @param {string} queryName - Name of the query operation
   * @param {number} duration - Query execution time in milliseconds
   * @param {string} sql - SQL query string
   * @param {Array|Object} params - Query parameters
   */
  trackQueryPerformance(queryName, duration, sql, params = []) {
    try {
      // Get performance monitor
      const { getPerformanceMonitor } = require('../utils/performance-monitor');
      const monitor = getPerformanceMonitor();

      // Log slow query if it exceeds threshold (from env or default 100ms)
      const slowQueryThreshold = parseInt(process.env.DB_SLOW_QUERY_THRESHOLD) || 100;

      if (duration > slowQueryThreshold) {
        monitor.logSlowQuery(sql, duration, params);
      }

      // Track the operation
      monitor.trackOperation(queryName, duration, {
        sql: sql.substring(0, 100), // First 100 chars of SQL
        paramCount: Array.isArray(params) ? params.length : 0
      });
    } catch (error) {
      // Silently fail if performance monitoring is not available
      // Don't let performance tracking break the database operations
    }
  }

  /**
   * Normalize SQL params to avoid undefined values and special number types.
   * @param {Array|Object|null|undefined} params
   * @returns {Array|Object|null|undefined}
   */
  normalizeParams(params) {
    if (params === undefined || params === null) {
      return params;
    }

    // Helper function to normalize a single value
    const normalizeValue = (value) => {
      // Convert undefined to null
      if (value === undefined) {
        return null;
      }
      // Convert NaN and Infinity to null to avoid SQL binding errors
      if (typeof value === 'number' && (!isFinite(value))) {
        console.warn('[Database] 警告: 检测到特殊数值 (NaN/Infinity)，已转换为NULL');
        return null;
      }
      return value;
    };

    if (Array.isArray(params)) {
      return params.map(normalizeValue);
    }
    if (typeof params === 'object') {
      const sanitized = {};
      Object.keys(params).forEach((key) => {
        sanitized[key] = normalizeValue(params[key]);
      });
      return sanitized;
    }
    return params;
  }

  /**
   * Execute a write statement (DDL/DML) and persist changes.
   * @param {string} sql
   * @param {Array|Object} params
   */
  run(sql, params = []) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const startTime = Date.now();
    try {
      console.log('[Database] 开始执行SQL操作');
      const safeParams = this.normalizeParams(params);
      console.log('[Database] 参数规范化完成');
      console.log('[Database] 执行SQL:', sql.substring(0, 100).replace(/\s+/g, ' '));
      console.log('[Database] 参数数量:', Array.isArray(safeParams) ? safeParams.length : 'N/A');

      // 打印前3个参数用于调试（避免泄露过多信息）
      if (Array.isArray(safeParams) && safeParams.length > 0) {
        console.log('[Database] 前3个参数:', safeParams.slice(0, 3));
      }

      console.log('[Database] 调用 prepare + run...');
      // 使用 prepare + run 方式以确保参数正确绑定
      const stmt = this.db.prepare(sql);
      stmt.run(safeParams ?? []);
      console.log('[Database] ✅ SQL执行成功');

      console.log('[Database] 开始保存到文件...');
      if (!this.inTransaction) {
        this.saveToFile();
        console.log('[Database] ✅ 数据已保存到文件');
      }

      // Track performance
      const duration = Date.now() - startTime;
      this.trackQueryPerformance('db.run', duration, sql, safeParams);
    } catch (error) {
      console.error('[Database] ❌ SQL执行失败:', error.message);
      console.error('[Database] Error类型:', error.constructor.name);
      console.error('[Database] SQL语句前100字:', sql.substring(0, 100));
      console.error('[Database] 参数数量:', Array.isArray(params) ? params.length : 'N/A');
      throw error;
    }
  }

  /**
   * Fetch a single row as an object.
   * @param {string} sql
   * @param {Array|Object} params
   * @returns {Object|null}
   */
  get(sql, params = []) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const startTime = Date.now();
    const stmt = this.db.prepare(sql);

    // Use the wrapped get() method if available (safer than direct getAsObject)
    if (stmt.get && typeof stmt.get === 'function' && stmt.__betterSqliteCompat) {
      const row = stmt.get(params);
      stmt.free();

      // Track performance
      const duration = Date.now() - startTime;
      this.trackQueryPerformance('db.get', duration, sql, params);

      return row;
    }

    // Fallback to manual implementation
    const safeParams = this.normalizeParams(params);
    if (safeParams !== undefined && safeParams !== null) {
      stmt.bind(safeParams);
    }

    let row = null;
    if (stmt.step()) {
      try {
        // Manually build object instead of using getAsObject
        const columns = stmt.getColumnNames();
        const values = stmt.get ? stmt.get() : [];

        row = {};
        for (let i = 0; i < columns.length; i++) {
          const value = values[i];
          if (value !== undefined) {
            row[columns[i]] = value;
          }
        }

        if (Object.keys(row).length === 0) {
          row = null;
        }
      } catch (err) {
        console.error('[Database] Error building row object:', err);
        row = null;
      }
    }

    stmt.free();

    // Track performance
    const duration = Date.now() - startTime;
    this.trackQueryPerformance('db.get', duration, sql, safeParams);

    return row;
  }

  /**
   * Fetch all rows as objects.
   * @param {string} sql
   * @param {Array|Object} params
   * @returns {Array}
   */
  all(sql, params = []) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const startTime = Date.now();
    const stmt = this.db.prepare(sql);

    // Use the wrapped all() method if available (safer than direct getAsObject)
    if (stmt.all && typeof stmt.all === 'function' && stmt.__betterSqliteCompat) {
      const rows = stmt.all(params);
      stmt.free();

      // Track performance
      const duration = Date.now() - startTime;
      this.trackQueryPerformance('db.all', duration, sql, params);

      return rows;
    }

    // Fallback to manual implementation
    const safeParams = this.normalizeParams(params);
    if (safeParams !== undefined && safeParams !== null) {
      stmt.bind(safeParams);
    }

    const rows = [];
    let columns = null;

    while (stmt.step()) {
      try {
        if (!columns) {
          columns = stmt.getColumnNames();
        }

        const values = stmt.get ? stmt.get() : [];
        const row = {};

        for (let i = 0; i < columns.length; i++) {
          const value = values[i];
          if (value !== undefined) {
            row[columns[i]] = value;
          }
        }

        if (Object.keys(row).length > 0) {
          rows.push(row);
        }
      } catch (err) {
        console.error('[Database] Error building row object:', err);
        // Skip this row and continue
      }
    }

    stmt.free();

    // Track performance
    const duration = Date.now() - startTime;
    this.trackQueryPerformance('db.all', duration, sql, safeParams);

    return rows;
  }

  /**
   * Execute SQL and return raw results (for DDL or queries)
   * @param {string} sql - SQL statement
   * @returns {Array} Raw query results
   */
  exec(sql) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    try {
      return this.db.exec(sql);
    } catch (error) {
      console.error('[Database] exec() failed:', error.message);
      console.error('[Database] SQL:', sql.substring(0, 100));
      throw error;
    }
  }

  /**
   * Prepare a SQL statement
   * @param {string} sql - SQL statement
   * @returns {Object} Prepared statement
   */
  prepare(sql) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    try {
      return this.db.prepare(sql);
    } catch (error) {
      console.error('[Database] prepare() failed:', error.message);
      console.error('[Database] SQL:', sql.substring(0, 100));
      throw error;
    }
  }

  /**
   * 执行事务
   * @param {Function} callback - 事务回调
   */
  transaction(callback) {
    // 使用原生 exec 方法执行事务控制语句，避免包装方法的干扰
    try {
      // 设置事务标志
      this.inTransaction = true;

      // 开始事务
      this.db.exec('BEGIN TRANSACTION');

      // 执行回调中的操作
      callback();

      // 提交事务
      this.db.exec('COMMIT');

      // 清除事务标志
      this.inTransaction = false;

      // 保存到文件
      this.saveToFile();
    } catch (error) {
      // 回滚事务
      try {
        this.db.exec('ROLLBACK');
      } catch (rollbackError) {
        console.error('[Database] ROLLBACK 失败:', rollbackError);
      }

      // 确保清除事务标志
      this.inTransaction = false;

      throw error;
    }
  }

  /**
   * 更新单条记录的同步状态
   * 每条记录独立事务，与后端保持一致
   * @param {string} tableName - 表名
   * @param {string} recordId - 记录ID
   * @param {string} status - 同步状态 ('pending'|'synced'|'conflict'|'error')
   * @param {number|null} syncedAt - 同步时间戳（毫秒），null表示清除
   * @returns {boolean} 是否更新成功
   */
  updateSyncStatus(tableName, recordId, status, syncedAt) {
    try {
      this.transaction(() => {
        const stmt = this.db.prepare(
          `UPDATE ${tableName}
           SET sync_status = ?, synced_at = ?
           WHERE id = ?`
        );

        stmt.run(status, syncedAt, recordId);
        stmt.free();
      });

      return true;
    } catch (error) {
      console.error(`[Database] 更新同步状态失败: table=${tableName}, id=${recordId}`, error);
      return false;
    }
  }

  /**
   * 批量更新同步状态（仅用于明确的批量操作场景）
   * @param {string} tableName - 表名
   * @param {Array<{id: string, status: string, syncedAt: number}>} updates - 更新列表
   * @returns {Object} 更新结果统计 {success: number, failed: number}
   */
  batchUpdateSyncStatus(tableName, updates) {
    let success = 0;
    let failed = 0;

    for (const update of updates) {
      const result = this.updateSyncStatus(
        tableName,
        update.id,
        update.status,
        update.syncedAt
      );

      if (result) {
        success++;
      } else {
        failed++;
      }
    }

    return { success, failed };
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
   * 切换到另一个数据库文件
   * @param {string} newDbPath - 新数据库文件的路径
   * @param {Object} options - 选项（password, encryptionEnabled）
   * @returns {Promise<boolean>} 切换是否成功
   */
  async switchDatabase(newDbPath, options = {}) {
    console.log('[Database] 切换数据库:', newDbPath);

    try {
      // 1. 保存并关闭当前数据库
      if (this.db) {
        console.log('[Database] 保存并关闭当前数据库...');
        this.saveToFile();
        this.db.close();
        this.db = null;
      }

      // 2. 更新数据库路径和加密选项
      this.dbPath = newDbPath;
      if (options.password !== undefined) {
        this.encryptionPassword = options.password;
      }
      if (options.encryptionEnabled !== undefined) {
        this.encryptionEnabled = options.encryptionEnabled;
      }

      // 3. 初始化新数据库
      await this.initialize();

      console.log('[Database] ✓ 数据库切换成功:', newDbPath);
      return true;
    } catch (error) {
      console.error('[Database] 切换数据库失败:', error);
      throw error;
    }
  }

  /**
   * 根据身份上下文获取数据库路径
   * @param {string} contextId - 身份上下文ID ('personal' 或 'org_xxx')
   * @returns {string} 数据库文件路径
   */
  getDatabasePath(contextId) {
    const appConfig = getAppConfig();
    const dataDir = appConfig.getDatabaseDir ? appConfig.getDatabaseDir() : path.join(app.getPath('userData'), 'data');

    // 确保数据目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (contextId === 'personal') {
      // 个人数据库
      return path.join(dataDir, 'personal.db');
    } else if (contextId.startsWith('org_')) {
      // 组织数据库
      return path.join(dataDir, `${contextId}.db`);
    } else {
      // 默认数据库（向后兼容）
      return path.join(dataDir, 'chainlesschain.db');
    }
  }

  /**
   * 获取当前数据库路径
   * @returns {string|null} 当前数据库路径
   */
  getCurrentDatabasePath() {
    return this.dbPath;
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

  // ==================== 软删除管理 ====================

  /**
   * 软删除记录（设置deleted=1而不是物理删除）
   * @param {string} tableName - 表名
   * @param {string} id - 记录ID
   * @returns {boolean} 是否成功
   */
  softDelete(tableName, id) {
    try {
      const stmt = this.db.prepare(
        `UPDATE ${tableName}
         SET deleted = 1,
             updated_at = ?,
             sync_status = 'pending'
         WHERE id = ?`
      );

      stmt.run(Date.now(), id);
      stmt.free();

      this.saveToFile();
      console.log(`[Database] 软删除记录: table=${tableName}, id=${id}`);
      return true;
    } catch (error) {
      console.error(`[Database] 软删除失败: table=${tableName}, id=${id}`, error);
      return false;
    }
  }

  /**
   * 批量软删除记录
   * @param {string} tableName - 表名
   * @param {Array<string>} ids - 记录ID列表
   * @returns {Object} 删除结果统计 {success: number, failed: number}
   */
  batchSoftDelete(tableName, ids) {
    let success = 0;
    let failed = 0;

    for (const id of ids) {
      if (this.softDelete(tableName, id)) {
        success++;
      } else {
        failed++;
      }
    }

    return { success, failed };
  }

  /**
   * 恢复软删除的记录
   * @param {string} tableName - 表名
   * @param {string} id - 记录ID
   * @returns {boolean} 是否成功
   */
  restoreSoftDeleted(tableName, id) {
    try {
      const stmt = this.db.prepare(
        `UPDATE ${tableName}
         SET deleted = 0,
             updated_at = ?,
             sync_status = 'pending'
         WHERE id = ?`
      );

      stmt.run(Date.now(), id);
      stmt.free();

      this.saveToFile();
      console.log(`[Database] 恢复软删除记录: table=${tableName}, id=${id}`);
      return true;
    } catch (error) {
      console.error(`[Database] 恢复失败: table=${tableName}, id=${id}`, error);
      return false;
    }
  }

  /**
   * 物理删除软删除的记录（永久删除）
   * @param {string} tableName - 表名
   * @param {number} olderThanDays - 删除多少天前的记录（默认30天）
   * @returns {Object} 清理结果 {deleted: number, tableName: string}
   */
  cleanupSoftDeleted(tableName, olderThanDays = 30) {
    const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

    try {
      const stmt = this.db.prepare(
        `DELETE FROM ${tableName}
         WHERE deleted = 1
           AND updated_at < ?`
      );

      const info = stmt.run(cutoffTime);
      stmt.free();

      const deletedCount = info.changes || 0;

      if (deletedCount > 0) {
        this.saveToFile();
        console.log(`[Database] 清理${tableName}表: ${deletedCount}条记录`);
      }

      return { deleted: deletedCount, tableName };
    } catch (error) {
      console.error(`[Database] 清理失败: table=${tableName}`, error);
      return { deleted: 0, tableName, error: error.message };
    }
  }

  /**
   * 清理所有表的软删除记录
   * @param {number} olderThanDays - 删除多少天前的记录（默认30天）
   * @returns {Array<Object>} 清理结果列表
   */
  cleanupAllSoftDeleted(olderThanDays = 30) {
    const syncTables = [
      'projects',
      'project_files',
      'knowledge_items',
      'project_collaborators',
      'project_comments',
      'project_tasks'
    ];

    const results = [];
    let totalDeleted = 0;

    for (const tableName of syncTables) {
      const result = this.cleanupSoftDeleted(tableName, olderThanDays);
      results.push(result);
      totalDeleted += result.deleted;
    }

    console.log(`[Database] 总共清理 ${totalDeleted} 条软删除记录`);

    return results;
  }

  /**
   * 获取软删除记录的统计信息
   * @returns {Object} 统计信息 {total: number, byTable: Object}
   */
  getSoftDeletedStats() {
    const syncTables = [
      'projects',
      'project_files',
      'knowledge_items',
      'project_collaborators',
      'project_comments',
      'project_tasks'
    ];

    const stats = {
      total: 0,
      byTable: {}
    };

    for (const tableName of syncTables) {
      try {
        const stmt = this.db.prepare(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE deleted = 1`
        );

        stmt.step();
        const count = stmt.getAsObject().count || 0;
        stmt.free();

        stats.byTable[tableName] = count;
        stats.total += count;
      } catch (error) {
        console.error(`[Database] 统计失败: table=${tableName}`, error);
        stats.byTable[tableName] = 0;
      }
    }

    return stats;
  }

  /**
   * 启动定期清理任务
   * @param {number} intervalHours - 清理间隔（小时，默认24小时）
   * @param {number} retentionDays - 保留天数（默认30天）
   * @returns {Object} 定时器对象
   */
  startPeriodicCleanup(intervalHours = 24, retentionDays = 30) {
    console.log(`[Database] 启动定期清理: 每${intervalHours}小时清理${retentionDays}天前的软删除记录`);

    // 立即执行一次
    this.cleanupAllSoftDeleted(retentionDays);

    // 定期执行
    const timer = setInterval(() => {
      console.log('[Database] 执行定期清理任务...');
      this.cleanupAllSoftDeleted(retentionDays);
    }, intervalHours * 60 * 60 * 1000);

    return timer;
  }

  // ==================== 知识图谱操作 ====================

  /**
   * 添加知识关系
   * @param {string} sourceId - 源笔记ID
   * @param {string} targetId - 目标笔记ID
   * @param {string} type - 关系类型 (link/tag/semantic/temporal)
   * @param {number} weight - 关系权重 (0.0-1.0)
   * @param {object} metadata - 元数据
   * @returns {object} 创建的关系
   */
  addRelation(sourceId, targetId, type, weight = 1.0, metadata = null) {
    const id = this.generateId();
    const createdAt = Date.now();
    const metadataStr = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO knowledge_relations (id, source_id, target_id, relation_type, weight, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run([id, sourceId, targetId, type, weight, metadataStr, createdAt]);
    stmt.free();

    return { id, sourceId, targetId, type, weight, metadata, createdAt };
  }

  /**
   * 批量添加知识关系
   * @param {Array} relations - 关系数组
   * @returns {number} 添加的关系数量
   */
  addRelations(relations) {
    if (!relations || relations.length === 0) return 0;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO knowledge_relations (id, source_id, target_id, relation_type, weight, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    relations.forEach(rel => {
      const id = this.generateId();
      const createdAt = Date.now();
      const metadataStr = rel.metadata ? JSON.stringify(rel.metadata) : null;

      try {
        stmt.run([id, rel.sourceId, rel.targetId, rel.type, rel.weight || 1.0, metadataStr, createdAt]);
        count++;
      } catch (error) {
        console.error(`[Database] 添加关系失败 (${rel.sourceId} -> ${rel.targetId}):`, error);
      }
    });

    stmt.free();
    return count;
  }

  /**
   * 删除指定笔记的关系
   * @param {string} noteId - 笔记ID
   * @param {Array<string>} types - 要删除的关系类型列表，如 ['link', 'semantic']。空数组则删除所有类型
   * @returns {number} 删除的关系数量
   */
  deleteRelations(noteId, types = []) {
    if (!noteId) return 0;

    let query;
    let params;

    if (types && types.length > 0) {
      const placeholders = types.map(() => '?').join(',');
      query = `
        DELETE FROM knowledge_relations
        WHERE (source_id = ? OR target_id = ?)
        AND relation_type IN (${placeholders})
      `;
      params = [noteId, noteId, ...types];
    } else {
      query = `
        DELETE FROM knowledge_relations
        WHERE source_id = ? OR target_id = ?
      `;
      params = [noteId, noteId];
    }

    const stmt = this.db.prepare(query);
    stmt.run(params);
    const changes = this.db.getRowsModified();
    stmt.free();

    return changes;
  }

  /**
   * 获取图谱数据
   * @param {object} options - 查询选项
   * @returns {object} { nodes, edges }
   */
  getGraphData(options = {}) {
    const {
      relationTypes = ['link', 'tag', 'semantic', 'temporal'],
      minWeight = 0.0,
      nodeTypes = ['note', 'document', 'conversation', 'web_clip'],
      limit = 500
    } = options;

    // 1. 查询涉及关系的所有笔记ID
    const relationTypesList = relationTypes.map(() => '?').join(',');
    const relStmt = this.db.prepare(`
      SELECT DISTINCT source_id as id FROM knowledge_relations
      WHERE relation_type IN (${relationTypesList}) AND weight >= ?
      UNION
      SELECT DISTINCT target_id as id FROM knowledge_relations
      WHERE relation_type IN (${relationTypesList}) AND weight >= ?
      LIMIT ?
    `);
    relStmt.bind([...relationTypes, minWeight, ...relationTypes, minWeight, limit]);

    const nodeIds = [];
    while (relStmt.step()) {
      nodeIds.push(relStmt.getAsObject().id);
    }
    relStmt.free();

    // 2. 查询这些笔记的详细信息
    const nodes = [];
    if (nodeIds.length > 0) {
      const nodeTypesFilter = nodeTypes.map(() => '?').join(',');
      const idsFilter = nodeIds.map(() => '?').join(',');
      const nodeStmt = this.db.prepare(`
        SELECT id, title, type, created_at, updated_at
        FROM knowledge_items
        WHERE id IN (${idsFilter}) AND type IN (${nodeTypesFilter})
      `);
      nodeStmt.bind([...nodeIds, ...nodeTypes]);

      while (nodeStmt.step()) {
        const node = nodeStmt.getAsObject();
        nodes.push({
          id: node.id,
          title: node.title,
          type: node.type,
          createdAt: node.created_at,
          updatedAt: node.updated_at,
        });
      }
      nodeStmt.free();
    }

    // 3. 查询这些节点之间的关系
    const edges = [];
    if (nodeIds.length > 0) {
      const idsFilter = nodeIds.map(() => '?').join(',');
      const relationTypesFilter = relationTypes.map(() => '?').join(',');
      const edgeStmt = this.db.prepare(`
        SELECT id, source_id, target_id, relation_type, weight, metadata
        FROM knowledge_relations
        WHERE source_id IN (${idsFilter})
          AND target_id IN (${idsFilter})
          AND relation_type IN (${relationTypesFilter})
          AND weight >= ?
      `);
      edgeStmt.bind([...nodeIds, ...nodeIds, ...relationTypes, minWeight]);

      while (edgeStmt.step()) {
        const edge = edgeStmt.getAsObject();
        edges.push({
          id: edge.id,
          source: edge.source_id,
          target: edge.target_id,
          type: edge.relation_type,
          weight: edge.weight,
          metadata: edge.metadata ? JSON.parse(edge.metadata) : null,
        });
      }
      edgeStmt.free();
    }

    return { nodes, edges };
  }

  /**
   * 获取笔记的所有关系
   * @param {string} knowledgeId - 笔记ID
   * @returns {Array} 关系列表
   */
  getKnowledgeRelations(knowledgeId) {
    const stmt = this.db.prepare(`
      SELECT * FROM knowledge_relations
      WHERE source_id = ? OR target_id = ?
      ORDER BY weight DESC
    `);
    stmt.bind([knowledgeId, knowledgeId]);

    const relations = [];
    while (stmt.step()) {
      const rel = stmt.getAsObject();
      relations.push({
        id: rel.id,
        source: rel.source_id,
        target: rel.target_id,
        type: rel.relation_type,
        weight: rel.weight,
        metadata: rel.metadata ? JSON.parse(rel.metadata) : null,
        createdAt: rel.created_at,
      });
    }
    stmt.free();

    return relations;
  }

  /**
   * 查找两个笔记之间的关系路径（BFS）
   * @param {string} sourceId - 源笔记ID
   * @param {string} targetId - 目标笔记ID
   * @param {number} maxDepth - 最大搜索深度
   * @returns {object|null} 路径信息
   */
  findRelationPath(sourceId, targetId, maxDepth = 3) {
    if (sourceId === targetId) {
      return { nodes: [sourceId], edges: [], length: 0 };
    }

    // BFS算法
    const queue = [{ id: sourceId, path: [sourceId], edgePath: [] }];
    const visited = new Set([sourceId]);

    // 获取所有关系（双向）
    const stmt = this.db.prepare(`
      SELECT source_id, target_id, id as edge_id, relation_type, weight
      FROM knowledge_relations
    `);

    const graph = new Map();
    while (stmt.step()) {
      const rel = stmt.getAsObject();

      // 正向边
      if (!graph.has(rel.source_id)) {
        graph.set(rel.source_id, []);
      }
      graph.get(rel.source_id).push({
        to: rel.target_id,
        edgeId: rel.edge_id,
        type: rel.relation_type,
        weight: rel.weight,
      });

      // 反向边（无向图）
      if (!graph.has(rel.target_id)) {
        graph.set(rel.target_id, []);
      }
      graph.get(rel.target_id).push({
        to: rel.source_id,
        edgeId: rel.edge_id,
        type: rel.relation_type,
        weight: rel.weight,
      });
    }
    stmt.free();

    // BFS搜索
    while (queue.length > 0) {
      const current = queue.shift();

      if (current.path.length > maxDepth) {
        continue;
      }

      const neighbors = graph.get(current.id) || [];
      for (const neighbor of neighbors) {
        if (neighbor.to === targetId) {
          // 找到目标
          return {
            nodes: [...current.path, targetId],
            edges: [...current.edgePath, neighbor.edgeId],
            length: current.path.length,
          };
        }

        if (!visited.has(neighbor.to)) {
          visited.add(neighbor.to);
          queue.push({
            id: neighbor.to,
            path: [...current.path, neighbor.to],
            edgePath: [...current.edgePath, neighbor.edgeId],
          });
        }
      }
    }

    return null; // 未找到路径
  }

  /**
   * 获取笔记的邻居节点（一度或多度关系）
   * @param {string} knowledgeId - 笔记ID
   * @param {number} depth - 深度
   * @returns {object} { nodes, edges }
   */
  getKnowledgeNeighbors(knowledgeId, depth = 1) {
    const allNodes = new Set([knowledgeId]);
    const allEdges = new Map();
    let currentLevel = [knowledgeId];

    for (let d = 0; d < depth; d++) {
      const nextLevel = [];

      currentLevel.forEach(nodeId => {
        const stmt = this.db.prepare(`
          SELECT id, source_id, target_id, relation_type, weight, metadata
          FROM knowledge_relations
          WHERE source_id = ? OR target_id = ?
        `);
        stmt.bind([nodeId, nodeId]);

        while (stmt.step()) {
          const edge = stmt.getAsObject();
          const otherId = edge.source_id === nodeId ? edge.target_id : edge.source_id;

          if (!allNodes.has(otherId)) {
            allNodes.add(otherId);
            nextLevel.push(otherId);
          }

          if (!allEdges.has(edge.id)) {
            allEdges.set(edge.id, {
              id: edge.id,
              source: edge.source_id,
              target: edge.target_id,
              type: edge.relation_type,
              weight: edge.weight,
              metadata: edge.metadata ? JSON.parse(edge.metadata) : null,
            });
          }
        }
        stmt.free();
      });

      currentLevel = nextLevel;
    }

    // 查询节点详情
    const nodes = [];
    const nodeIds = Array.from(allNodes);
    if (nodeIds.length > 0) {
      const idsFilter = nodeIds.map(() => '?').join(',');
      const stmt = this.db.prepare(`
        SELECT id, title, type, created_at, updated_at
        FROM knowledge_items
        WHERE id IN (${idsFilter})
      `);
      stmt.bind(nodeIds);

      while (stmt.step()) {
        const node = stmt.getAsObject();
        nodes.push({
          id: node.id,
          title: node.title,
          type: node.type,
          createdAt: node.created_at,
          updatedAt: node.updated_at,
        });
      }
      stmt.free();
    }

    return {
      nodes,
      edges: Array.from(allEdges.values()),
    };
  }

  /**
   * 构建标签关系
   * 为共享标签的笔记建立关系
   * @returns {number} 创建的关系数量
   */
  buildTagRelations() {
    // 清除旧的标签关系
    const deleteStmt = this.db.prepare(`
      DELETE FROM knowledge_relations WHERE relation_type = 'tag'
    `);
    deleteStmt.step();
    deleteStmt.free();

    // 查询共享标签的笔记对
    const stmt = this.db.prepare(`
      SELECT
        k1.knowledge_id as source_id,
        k2.knowledge_id as target_id,
        COUNT(*) as shared_tags
      FROM knowledge_tags k1
      JOIN knowledge_tags k2 ON k1.tag_id = k2.tag_id
      WHERE k1.knowledge_id < k2.knowledge_id
      GROUP BY k1.knowledge_id, k2.knowledge_id
      HAVING shared_tags > 0
    `);

    const relations = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();

      // 计算权重：共享标签数 / 最大标签数
      const source = this.getKnowledgeTags(row.source_id);
      const target = this.getKnowledgeTags(row.target_id);
      const maxTags = Math.max(source.length, target.length);
      const weight = maxTags > 0 ? row.shared_tags / maxTags : 0;

      relations.push({
        sourceId: row.source_id,
        targetId: row.target_id,
        type: 'tag',
        weight: weight,
        metadata: { sharedTags: row.shared_tags },
      });
    }
    stmt.free();

    // 批量插入
    return this.addRelations(relations);
  }

  /**
   * 构建时间序列关系
   * @param {number} windowDays - 时间窗口（天）
   * @returns {number} 创建的关系数量
   */
  buildTemporalRelations(windowDays = 7) {
    // 清除旧的时间关系
    const deleteStmt = this.db.prepare(`
      DELETE FROM knowledge_relations WHERE relation_type = 'temporal'
    `);
    deleteStmt.step();
    deleteStmt.free();

    const windowMs = windowDays * 24 * 60 * 60 * 1000;

    // 查询时间接近的笔记对
    const stmt = this.db.prepare(`
      SELECT
        k1.id as source_id,
        k2.id as target_id,
        k1.created_at as source_time,
        k2.created_at as target_time
      FROM knowledge_items k1
      JOIN knowledge_items k2 ON k1.id < k2.id
      WHERE ABS(k1.created_at - k2.created_at) <= ?
      ORDER BY k1.created_at ASC
    `);
    stmt.bind([windowMs]);

    const relations = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const timeDiff = Math.abs(row.target_time - row.source_time);
      const daysDiff = timeDiff / (24 * 60 * 60 * 1000);

      // 权重：时间越近权重越高
      const weight = 1 / (1 + daysDiff);

      relations.push({
        sourceId: row.source_time < row.target_time ? row.source_id : row.target_id,
        targetId: row.source_time < row.target_time ? row.target_id : row.source_id,
        type: 'temporal',
        weight: weight,
        metadata: { daysDiff: daysDiff.toFixed(2) },
      });
    }
    stmt.free();

    return this.addRelations(relations);
  }

  // ==================== 项目管理操作 ====================

  /**
   * 获取所有项目
   * @param {string} userId - 用户ID
   * @returns {Array} 项目列表
   */
  getProjects(userId) {
    if (!this.db) {
      console.error('[DatabaseManager] 数据库未初始化');
      return [];
    }
    const stmt = this.db.prepare(`
      SELECT
        id, user_id, name, description, project_type, status,
        root_path, file_count, total_size, template_id, cover_image_url,
        tags, metadata, created_at, updated_at, synced_at, sync_status
      FROM projects
      WHERE user_id = ? AND deleted = 0
      ORDER BY updated_at DESC
    `);

    let projects = [];
    try {
      projects = stmt.all(userId);
    } catch (err) {
      console.error('[Database] getProjects 查询失败:', err);
      // 返回空数组
      return [];
    }

    // 清理每个项目中的 undefined 和 null 值
    return projects.map(project => {
      const cleaned = {};
      for (const key in project) {
        if (project.hasOwnProperty(key)) {
          const value = project[key];
          // 跳过 undefined 和 null
          if (value !== undefined && value !== null) {
            cleaned[key] = value;
          }
        }
      }
      return cleaned;
    });
  }

  /**
   * 调试：获取数据库统计信息
   * @returns {Object} 数据库统计信息
   */
  getDatabaseStats() {
    if (!this.db) {
      return { error: '数据库未初始化' };
    }

    try {
      const stats = {};

      // 获取projects表统计
      const projectsCount = this.db.prepare('SELECT COUNT(*) as count FROM projects').get();
      const projectsDeleted = this.db.prepare('SELECT COUNT(*) as count FROM projects WHERE deleted = 1').get();
      const projectsActive = this.db.prepare('SELECT COUNT(*) as count FROM projects WHERE deleted = 0').get();

      // 获取project_files表统计
      const filesCount = this.db.prepare('SELECT COUNT(*) as count FROM project_files').get();
      const filesDeleted = this.db.prepare('SELECT COUNT(*) as count FROM project_files WHERE deleted = 1').get();
      const filesActive = this.db.prepare('SELECT COUNT(*) as count FROM project_files WHERE deleted = 0').get();

      // 获取所有用户ID
      const users = this.db.prepare('SELECT DISTINCT user_id FROM projects').all();

      stats.projects = {
        total: projectsCount.count,
        active: projectsActive.count,
        deleted: projectsDeleted.count,
      };

      stats.files = {
        total: filesCount.count,
        active: filesActive.count,
        deleted: filesDeleted.count,
      };

      stats.users = users.map(u => u.user_id);

      // 获取数据库路径和大小
      stats.dbPath = this.dbPath;
      if (fs.existsSync(this.dbPath)) {
        const fileStats = fs.statSync(this.dbPath);
        stats.dbSize = fileStats.size;
        stats.dbSizeMB = (fileStats.size / 1024 / 1024).toFixed(2) + ' MB';
        stats.dbModified = new Date(fileStats.mtime).toISOString();
      }

      // 是否使用加密
      stats.encrypted = !!this.adapter;

      return stats;
    } catch (error) {
      console.error('[Database] getDatabaseStats 失败:', error);
      return { error: error.message };
    }
  }

  /**
   * 根据ID获取项目
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 项目
   */
  getProjectById(projectId) {
    console.log('[Database] getProjectById 输入参数:', projectId, 'type:', typeof projectId);

    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');

    console.log('[Database] 准备执行 stmt.get...');
    let project;
    try {
      project = stmt.get(projectId);
      console.log('[Database] stmt.get 执行成功，结果:', project ? 'OK' : 'NULL');
    } catch (getError) {
      console.error('[Database] stmt.get 失败!');
      console.error('[Database] 查询参数 projectId:', projectId);
      console.error('[Database] 错误对象:', getError);
      throw getError;
    }

    // 清理 undefined 值，SQLite 可能返回 undefined
    if (!project) {
      console.log('[Database] 未找到项目，返回 null');
      return null;
    }

    console.log('[Database] 开始清理 undefined 值...');
    const cleaned = {};
    for (const key in project) {
      if (project.hasOwnProperty(key) && project[key] !== undefined) {
        cleaned[key] = project[key];
      }
    }

    console.log('[Database] 清理完成，返回键:', Object.keys(cleaned));
    return cleaned;
  }

  /**
   * 保存项目
   * @param {Object} project - 项目数据
   * @returns {Object} 保存的项目
   */
  saveProject(project) {
    // Check if database is initialized
    if (!this.db) {
      const errorMsg = '数据库未初始化，无法保存项目。请检查数据库配置和加密设置。';
      console.error('[Database]', errorMsg);
      throw new Error(errorMsg);
    }

    const safeProject = project || {};
    const projectType = safeProject.project_type ?? safeProject.projectType ?? 'web';
    const userId = safeProject.user_id ?? safeProject.userId ?? 'local-user';
    const rootPath = safeProject.root_path ?? safeProject.rootPath ?? null;
    const templateId = safeProject.template_id ?? safeProject.templateId ?? null;
    const coverImageUrl = safeProject.cover_image_url ?? safeProject.coverImageUrl ?? null;
    const fileCount = safeProject.file_count ?? safeProject.fileCount ?? 0;
    const totalSize = safeProject.total_size ?? safeProject.totalSize ?? 0;
    const tagsValue = typeof safeProject.tags === 'string'
      ? safeProject.tags
      : JSON.stringify(safeProject.tags || []);
    const metadataValue = typeof safeProject.metadata === 'string'
      ? safeProject.metadata
      : JSON.stringify(safeProject.metadata || {});
    // 确保时间戳是数字（毫秒），如果是字符串则转换
    let createdAt = safeProject.created_at ?? safeProject.createdAt ?? Date.now();
    console.log('[Database] createdAt 原始值:', createdAt, 'type:', typeof createdAt);
    if (typeof createdAt === 'string') {
      createdAt = new Date(createdAt).getTime();
      console.log('[Database] createdAt 转换后:', createdAt, 'type:', typeof createdAt);
    }

    let updatedAt = safeProject.updated_at ?? safeProject.updatedAt ?? Date.now();
    console.log('[Database] updatedAt 原始值:', updatedAt, 'type:', typeof updatedAt);
    if (typeof updatedAt === 'string') {
      updatedAt = new Date(updatedAt).getTime();
      console.log('[Database] updatedAt 转换后:', updatedAt, 'type:', typeof updatedAt);
    }

    let syncedAt = safeProject.synced_at ?? safeProject.syncedAt ?? null;
    console.log('[Database] syncedAt 原始值:', syncedAt, 'type:', typeof syncedAt);
    if (typeof syncedAt === 'string') {
      syncedAt = new Date(syncedAt).getTime();
      console.log('[Database] syncedAt 转换后:', syncedAt, 'type:', typeof syncedAt);
    }

    const syncStatus = safeProject.sync_status ?? safeProject.syncStatus ?? 'pending';
    const deviceId = safeProject.device_id ?? safeProject.deviceId ?? null;
    const deleted = safeProject.deleted ?? 0;
    const categoryId = safeProject.category_id ?? safeProject.categoryId ?? null;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO projects (
        id, user_id, name, description, project_type, status,
        root_path, file_count, total_size, template_id, cover_image_url,
        tags, metadata, created_at, updated_at, sync_status, synced_at,
        device_id, deleted, category_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const params = [
      safeProject.id,
      userId,
      safeProject.name,
      safeProject.description,
      projectType,
      safeProject.status || 'active',
      rootPath,
      fileCount,
      totalSize,
      templateId,
      coverImageUrl,
      tagsValue,
      metadataValue,
      createdAt,
      updatedAt,
      syncStatus,
      syncedAt,
      deviceId,
      deleted,
      categoryId,
    ].map((value) => (value === undefined ? null : value));

    console.log('[Database] 最终params准备绑定:');
    params.forEach((param, index) => {
      console.log(`  [${index}] ${typeof param} = ${param === undefined ? 'UNDEFINED!' : (param === null ? 'NULL' : JSON.stringify(param).substring(0, 50))}`);
    });

    console.log('[Database] 开始执行 stmt.run...');
    try {
      stmt.run(...params);
      console.log('[Database] stmt.run 执行成功');
    } catch (runError) {
      console.error('[Database] stmt.run 失败!');
      console.error('[Database] 错误对象:', runError);
      console.error('[Database] 错误类型:', typeof runError);
      console.error('[Database] 错误消息:', runError?.message);
      console.error('[Database] 错误堆栈:', runError?.stack);
      console.error('[Database] 错误代码:', runError?.code);
      throw runError;
    }

    // 不查询数据库，直接返回刚保存的数据（避免查询返回 undefined 字段）
    console.log('[Database] 直接返回 safeProject（不查询）');
    const savedProject = {
      id: safeProject.id,
      user_id: userId,
      name: safeProject.name,
      description: safeProject.description,
      project_type: projectType,
      status: safeProject.status || 'active',
      root_path: rootPath,
      file_count: fileCount,
      total_size: totalSize,
      template_id: templateId,
      cover_image_url: coverImageUrl,
      tags: tagsValue,
      metadata: metadataValue,
      created_at: createdAt,
      updated_at: updatedAt,
      sync_status: syncStatus,
      synced_at: syncedAt,
      device_id: deviceId,
      deleted: deleted,
      category_id: categoryId,
    };

    console.log('[Database] saveProject 完成，返回结果');
    return savedProject;
  }

  /**
   * 更新项目
   * @param {string} projectId - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的项目
   */
  updateProject(projectId, updates) {
    const fields = [];
    const values = [];

    // 动态构建更新字段
    const allowedFields = [
      'name', 'description', 'status', 'tags', 'cover_image_url',
      'file_count', 'total_size', 'sync_status', 'synced_at',
      'root_path', 'folder_path', 'project_type'
    ];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (field === 'tags' || field === 'metadata') {
          values.push(typeof updates[field] === 'string' ? updates[field] : JSON.stringify(updates[field]));
        } else {
          values.push(updates[field]);
        }
      }
    });

    // 总是更新 updated_at
    fields.push('updated_at = ?');
    values.push(updates.updated_at || Date.now());

    values.push(projectId);

    if (fields.length === 1) {
      return this.getProjectById(projectId);
    }

    this.db.run(`
      UPDATE projects SET ${fields.join(', ')} WHERE id = ?
    `, values);

    this.saveToFile();
    return this.getProjectById(projectId);
  }

  /**
   * 删除项目
   * @param {string} projectId - 项目ID
   * @returns {boolean} 是否删除成功
   */
  deleteProject(projectId) {
    // 删除项目文件
    this.db.run('DELETE FROM project_files WHERE project_id = ?', [projectId]);

    // 删除项目
    this.db.run('DELETE FROM projects WHERE id = ?', [projectId]);

    this.saveToFile();
    return true;
  }

  /**
   * 获取项目文件列表
   * @param {string} projectId - 项目ID
   * @returns {Array} 文件列表
   */
  getProjectFiles(projectId) {
    const stmt = this.db.prepare(`
      SELECT * FROM project_files
      WHERE project_id = ? AND deleted = 0
      ORDER BY file_path
    `);
    return stmt.all(projectId);
  }

  /**
   * 保存项目文件
   * @param {string} projectId - 项目ID
   * @param {Array} files - 文件列表
   */
  saveProjectFiles(projectId, files) {
    // Check if database is initialized
    if (!this.db) {
      const errorMsg = '数据库未初始化，无法保存项目文件。请检查数据库配置和加密设置。';
      console.error('[Database]', errorMsg);
      throw new Error(errorMsg);
    }

    const safeFiles = Array.isArray(files) ? files : [];
    this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO project_files (
          id, project_id, file_path, file_name, file_type,
          file_size, content, content_hash, version, fs_path,
          created_at, updated_at, sync_status, synced_at, device_id, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      safeFiles.forEach(file => {
        // 支持多种字段名格式：后端可能返回 path/type，前端可能使用 file_path/filePath
        const rawPath = file.file_path ?? file.filePath ?? file.path ?? null;
        const derivedName = file.file_name
          ?? file.fileName
          ?? (rawPath ? rawPath.split(/[\\/]/).pop() : null);
        const filePath = rawPath || derivedName || '';
        const fileName = derivedName || filePath || 'untitled';
        const fileType = file.file_type ?? file.fileType ?? file.type ?? null;
        const fileSize = file.file_size ?? file.fileSize ?? null;
        const content = file.content ?? null;
        const contentHash = file.content_hash ?? file.contentHash ?? null;
        const version = file.version ?? 1;
        const fsPath = file.fs_path ?? file.fsPath ?? null;
        const syncStatus = file.sync_status ?? file.syncStatus ?? 'pending';
        const syncedAt = file.synced_at ?? file.syncedAt ?? null;
        const deviceId = file.device_id ?? file.deviceId ?? null;
        const deleted = file.deleted ?? 0;

        // 如果没有file_size但有content，自动计算大小
        let actualFileSize = fileSize;
        if (!actualFileSize && content) {
          if (typeof content === 'string') {
            // base64编码的内容
            if (file.content_encoding === 'base64') {
              actualFileSize = Math.floor(content.length * 0.75); // base64解码后约为3/4
            } else {
              actualFileSize = Buffer.byteLength(content, 'utf-8');
            }
          } else if (Buffer.isBuffer(content)) {
            actualFileSize = content.length;
          }
        }
        actualFileSize = actualFileSize || 0;

        // 确保时间戳是数字（毫秒），如果是字符串则转换
        let createdAt = file.created_at ?? file.createdAt ?? Date.now();
        if (typeof createdAt === 'string') {
          createdAt = new Date(createdAt).getTime();
        }

        let updatedAt = file.updated_at ?? file.updatedAt ?? Date.now();
        if (typeof updatedAt === 'string') {
          updatedAt = new Date(updatedAt).getTime();
        }

        const fileId = file.id || uuidv4();

        const params = [
          fileId,
          projectId,
          filePath,
          fileName,
          fileType,
          actualFileSize,
          content,
          contentHash,
          version,
          fsPath,
          createdAt,
          updatedAt,
          syncStatus,
          syncedAt,
          deviceId,
          deleted,
        ].map((value) => (value === undefined ? null : value));

        stmt.run(...params);
      });
    });
  }

  /**
   * 更新单个文件
   * @param {Object} fileUpdate - 文件更新数据
   */
  updateProjectFile(fileUpdate) {
    const stmt = this.db.prepare(`
      UPDATE project_files
      SET content = ?, updated_at = ?, version = ?
      WHERE id = ?
    `);

    stmt.run(
      fileUpdate.content,
      fileUpdate.updated_at || Date.now(),
      fileUpdate.version,
      fileUpdate.id
    );

    this.saveToFile();
  }

  // ==================== 对话管理操作 ====================

  /**
   * 创建对话
   * @param {Object} conversationData - 对话数据
   * @returns {Object} 创建的对话
   */
  createConversation(conversationData) {
    const id = conversationData.id || `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (
        id, title, knowledge_id, project_id, context_type, context_data,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      conversationData.title || '新对话',
      conversationData.knowledge_id || null,
      conversationData.project_id || null,
      conversationData.context_type || 'global',
      conversationData.context_data ? JSON.stringify(conversationData.context_data) : null,
      conversationData.created_at || now,
      conversationData.updated_at || now
    );

    this.saveToFile();

    return this.getConversationById(id);
  }

  /**
   * 根据ID获取对话
   * @param {string} conversationId - 对话ID
   * @returns {Object|null} 对话对象
   */
  getConversationById(conversationId) {
    const stmt = this.db.prepare('SELECT * FROM conversations WHERE id = ?');
    const conversation = stmt.get(conversationId);

    if (!conversation) return null;

    // 解析 context_data
    if (conversation.context_data) {
      try {
        conversation.context_data = JSON.parse(conversation.context_data);
      } catch (e) {
        console.error('解析 context_data 失败:', e);
      }
    }

    return conversation;
  }

  /**
   * 根据项目ID获取对话
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 对话对象
   */
  getConversationByProject(projectId) {
    const stmt = this.db.prepare(`
      SELECT * FROM conversations
      WHERE project_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    const conversation = stmt.get(projectId);

    if (!conversation) return null;

    // 解析 context_data
    if (conversation.context_data) {
      try {
        conversation.context_data = JSON.parse(conversation.context_data);
      } catch (e) {
        console.error('解析 context_data 失败:', e);
      }
    }

    return conversation;
  }

  /**
   * 获取所有对话
   * @param {Object} options - 查询选项
   * @returns {Array} 对话列表
   */
  getConversations(options = {}) {
    let query = 'SELECT * FROM conversations WHERE 1=1';
    const params = [];

    if (options.project_id) {
      query += ' AND project_id = ?';
      params.push(options.project_id);
    }

    if (options.knowledge_id) {
      query += ' AND knowledge_id = ?';
      params.push(options.knowledge_id);
    }

    if (options.context_type) {
      query += ' AND context_type = ?';
      params.push(options.context_type);
    }

    query += ' ORDER BY updated_at DESC';

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const conversations = stmt.all(...params);

    // 解析 context_data
    return conversations.map(conv => {
      if (conv.context_data) {
        try {
          conv.context_data = JSON.parse(conv.context_data);
        } catch (e) {
          console.error('解析 context_data 失败:', e);
        }
      }
      return conv;
    });
  }

  /**
   * 更新对话
   * @param {string} conversationId - 对话ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的对话
   */
  updateConversation(conversationId, updates) {
    const fields = [];
    const values = [];

    const allowedFields = ['title', 'context_type', 'context_data'];

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (field === 'context_data' && typeof updates[field] !== 'string') {
          values.push(JSON.stringify(updates[field]));
        } else {
          values.push(updates[field]);
        }
      }
    });

    // 总是更新 updated_at
    fields.push('updated_at = ?');
    values.push(Date.now());

    values.push(conversationId);

    if (fields.length === 1) {
      return this.getConversationById(conversationId);
    }

    this.db.run(`
      UPDATE conversations SET ${fields.join(', ')} WHERE id = ?
    `, values);

    this.saveToFile();
    return this.getConversationById(conversationId);
  }

  /**
   * 删除对话
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否删除成功
   */
  deleteConversation(conversationId) {
    // 先删除相关消息
    this.db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);

    // 删除对话
    this.db.run('DELETE FROM conversations WHERE id = ?', [conversationId]);

    this.saveToFile();
    return true;
  }

  /**
   * 创建消息
   * @param {Object} messageData - 消息数据
   * @returns {Object} 创建的消息
   */
  createMessage(messageData) {
    const id = messageData.id || `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, conversation_id, role, content, timestamp, tokens
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      messageData.conversation_id,
      messageData.role,
      messageData.content,
      messageData.timestamp || now,
      messageData.tokens || null
    );

    this.saveToFile();

    // 更新对话的 updated_at
    this.updateConversation(messageData.conversation_id, {});

    return this.getMessageById(id);
  }

  /**
   * 根据ID获取消息
   * @param {string} messageId - 消息ID
   * @returns {Object|null} 消息对象
   */
  getMessageById(messageId) {
    const stmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    return stmt.get(messageId);
  }

  /**
   * 获取对话的所有消息（支持分页）
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 每页消息数量
   * @param {number} options.offset - 偏移量
   * @param {string} options.order - 排序方式 ('ASC' 或 'DESC')
   * @returns {Object} 包含消息列表和总数的对象
   */
  getMessagesByConversation(conversationId, options = {}) {
    const order = options.order || 'ASC';
    let query = `SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ${order}`;
    const params = [conversationId];

    // 添加分页支持
    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);

      if (options.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const stmt = this.db.prepare(query);
    const messages = stmt.all(...params);

    // 获取总消息数
    const countStmt = this.db.prepare('SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?');
    const countResult = countStmt.get(conversationId);
    const total = countResult ? countResult.total : 0;

    return {
      messages,
      total,
      hasMore: options.limit && options.offset ? (options.offset + options.limit) < total : false
    };
  }

  /**
   * 删除消息
   * @param {string} messageId - 消息ID
   * @returns {boolean} 是否删除成功
   */
  deleteMessage(messageId) {
    this.db.run('DELETE FROM messages WHERE id = ?', [messageId]);
    this.saveToFile();
    return true;
  }

  /**
   * 清空对话的所有消息
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否清空成功
   */
  clearConversationMessages(conversationId) {
    this.db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
    this.saveToFile();
    return true;
  }

  // ==================== 系统配置管理 ====================

  /**
   * 初始化默认配置
   */
  initDefaultSettings() {
    const now = Date.now();
    const path = require('path');
    const { app } = require('electron');

    // 获取默认的项目根目录
    const defaultProjectRoot = path.join(app.getPath('userData'), 'projects');

    const defaultSettings = [
      // 项目配置
      { key: 'project.rootPath', value: defaultProjectRoot, type: 'string', description: '项目文件存储根目录' },
      { key: 'project.maxSizeMB', value: '1000', type: 'number', description: '单个项目最大大小（MB）' },
      { key: 'project.autoSync', value: 'true', type: 'boolean', description: '自动同步项目到后端' },
      { key: 'project.syncIntervalSeconds', value: '300', type: 'number', description: '同步间隔（秒）' },

      // LLM 配置 - 优先级和智能选择
      { key: 'llm.provider', value: 'volcengine', type: 'string', description: 'LLM服务提供商（当前激活）' },
      { key: 'llm.priority', value: JSON.stringify(['volcengine', 'ollama', 'deepseek']), type: 'json', description: 'LLM服务优先级列表' },
      { key: 'llm.autoFallback', value: 'true', type: 'boolean', description: '自动切换到备用LLM服务' },
      { key: 'llm.autoSelect', value: 'true', type: 'boolean', description: 'AI自主选择最优LLM' },
      { key: 'llm.selectionStrategy', value: 'balanced', type: 'string', description: '选择策略：cost（成本优先）、speed（速度优先）、quality（质量优先）、balanced（平衡）' },

      // Ollama 配置
      { key: 'llm.ollamaHost', value: 'http://localhost:11434', type: 'string', description: 'Ollama服务地址' },
      { key: 'llm.ollamaModel', value: 'qwen2:7b', type: 'string', description: 'Ollama模型名称' },

      // OpenAI 配置
      { key: 'llm.openaiApiKey', value: '', type: 'string', description: 'OpenAI API Key' },
      { key: 'llm.openaiBaseUrl', value: 'https://api.openai.com/v1', type: 'string', description: 'OpenAI API地址' },
      { key: 'llm.openaiModel', value: 'gpt-3.5-turbo', type: 'string', description: 'OpenAI模型' },

      // 火山引擎（豆包）配置
      { key: 'llm.volcengineApiKey', value: '', type: 'string', description: '火山引擎API Key' },
      { key: 'llm.volcengineModel', value: 'doubao-seed-1-6-lite-251015', type: 'string', description: '火山引擎模型' },

      // 阿里通义千问配置
      { key: 'llm.dashscopeApiKey', value: '', type: 'string', description: '阿里通义千问API Key' },
      { key: 'llm.dashscopeModel', value: 'qwen-turbo', type: 'string', description: '阿里通义千问模型' },

      // 智谱AI配置
      { key: 'llm.zhipuApiKey', value: '', type: 'string', description: '智谱AI API Key' },
      { key: 'llm.zhipuModel', value: 'glm-4', type: 'string', description: '智谱AI模型' },

      // DeepSeek配置
      { key: 'llm.deepseekApiKey', value: '', type: 'string', description: 'DeepSeek API Key' },
      { key: 'llm.deepseekModel', value: 'deepseek-chat', type: 'string', description: 'DeepSeek模型' },

      // 向量数据库配置
      { key: 'vector.qdrantHost', value: 'http://localhost:6333', type: 'string', description: 'Qdrant服务地址' },
      { key: 'vector.qdrantPort', value: '6333', type: 'number', description: 'Qdrant端口' },
      { key: 'vector.qdrantCollection', value: 'chainlesschain_vectors', type: 'string', description: 'Qdrant集合名称' },
      { key: 'vector.embeddingModel', value: 'bge-base-zh-v1.5', type: 'string', description: 'Embedding模型' },
      { key: 'vector.embeddingDimension', value: '768', type: 'number', description: '向量维度' },

      // Git 配置
      { key: 'git.enabled', value: 'false', type: 'boolean', description: '启用Git同步' },
      { key: 'git.autoSync', value: 'false', type: 'boolean', description: '自动提交和推送' },
      { key: 'git.autoSyncInterval', value: '300', type: 'number', description: 'Git同步间隔（秒）' },
      { key: 'git.userName', value: '', type: 'string', description: 'Git用户名' },
      { key: 'git.userEmail', value: '', type: 'string', description: 'Git邮箱' },
      { key: 'git.remoteUrl', value: '', type: 'string', description: 'Git远程仓库URL' },

      // 后端服务配置
      { key: 'backend.projectServiceUrl', value: 'http://localhost:9090', type: 'string', description: '项目服务地址' },
      { key: 'backend.aiServiceUrl', value: 'http://localhost:8001', type: 'string', description: 'AI服务地址' },

      // 数据库配置
      { key: 'database.sqlcipherKey', value: '', type: 'string', description: 'SQLCipher加密密钥' },

      // P2P 网络配置
      { key: 'p2p.transports.webrtc.enabled', value: 'true', type: 'boolean', description: '启用WebRTC传输（推荐）' },
      { key: 'p2p.transports.websocket.enabled', value: 'true', type: 'boolean', description: '启用WebSocket传输' },
      { key: 'p2p.transports.tcp.enabled', value: 'true', type: 'boolean', description: '启用TCP传输（向后兼容）' },
      { key: 'p2p.transports.autoSelect', value: 'true', type: 'boolean', description: '智能自动选择传输层' },

      // STUN 配置（仅公共免费服务器）
      { key: 'p2p.stun.servers', value: JSON.stringify([
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302'
      ]), type: 'json', description: 'STUN服务器列表' },

      // Circuit Relay 配置
      { key: 'p2p.relay.enabled', value: 'true', type: 'boolean', description: '启用Circuit Relay v2中继' },
      { key: 'p2p.relay.maxReservations', value: '2', type: 'number', description: '最大中继预留数量' },
      { key: 'p2p.relay.autoUpgrade', value: 'true', type: 'boolean', description: '自动升级中继为直连（DCUTr）' },

      // NAT 穿透配置
      { key: 'p2p.nat.autoDetect', value: 'true', type: 'boolean', description: '启动时自动检测NAT类型' },
      { key: 'p2p.nat.detectionInterval', value: '3600000', type: 'number', description: 'NAT检测间隔（毫秒，默认1小时）' },

      // 连接配置
      { key: 'p2p.connection.dialTimeout', value: '30000', type: 'number', description: '连接超时时间（毫秒）' },
      { key: 'p2p.connection.maxRetries', value: '3', type: 'number', description: '最大重试次数' },
      { key: 'p2p.connection.healthCheckInterval', value: '60000', type: 'number', description: '健康检查间隔（毫秒）' },

      // WebSocket 端口配置
      { key: 'p2p.websocket.port', value: '9001', type: 'number', description: 'WebSocket监听端口' },

      // 向后兼容
      { key: 'p2p.compatibility.detectLegacy', value: 'true', type: 'boolean', description: '自动检测并兼容旧版TCP节点' }
    ];

    const stmt = this.db.prepare('SELECT key FROM system_settings WHERE key = ?');

    for (const setting of defaultSettings) {
      const existing = stmt.get([setting.key]);

      if (!existing) {
        const insertStmt = this.db.prepare(
          'INSERT INTO system_settings (key, value, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        insertStmt.run([setting.key, setting.value, setting.type, setting.description, now, now]);
        insertStmt.free();
      }
    }

    stmt.free();
    this.saveToFile();
  }

  /**
   * 获取单个配置项
   * @param {string} key - 配置键
   * @returns {any} 配置值
   */
  getSetting(key) {
    const stmt = this.db.prepare('SELECT value, type FROM system_settings WHERE key = ?');
    const row = stmt.get([key]);
    stmt.free();

    if (!row) {
      return null;
    }

    // 根据类型转换值
    switch (row.type) {
      case 'number':
        return parseFloat(row.value);
      case 'boolean':
        return row.value === 'true';
      case 'json':
        try {
          return JSON.parse(row.value);
        } catch (e) {
          return null;
        }
      default:
        return row.value;
    }
  }

  /**
   * 获取所有配置
   * @returns {Object} 配置对象
   */
  getAllSettings() {
    const stmt = this.db.prepare('SELECT key, value, type FROM system_settings');
    const rows = stmt.all();
    stmt.free();

    const config = {
      project: {},
      llm: {},
      vector: {},
      git: {},
      backend: {},
      database: {}
    };

    for (const row of rows) {
      const [section, key] = row.key.split('.');
      let value = row.value;

      // 根据类型转换值
      switch (row.type) {
        case 'number':
          value = parseFloat(value);
          break;
        case 'boolean':
          value = value === 'true';
          break;
        case 'json':
          try {
            value = JSON.parse(value);
          } catch (e) {
            value = null;
          }
          break;
      }

      if (config[section]) {
        config[section][key] = value;
      }
    }

    return config;
  }

  /**
   * 设置单个配置项
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {boolean} 是否设置成功
   */
  setSetting(key, value) {
    const now = Date.now();

    // 确定值的类型
    let type = 'string';
    let stringValue = String(value);

    if (typeof value === 'number') {
      type = 'number';
    } else if (typeof value === 'boolean') {
      type = 'boolean';
      stringValue = value ? 'true' : 'false';
    } else if (typeof value === 'object') {
      type = 'json';
      stringValue = JSON.stringify(value);
    }

    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO system_settings (key, value, type, updated_at, created_at) VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM system_settings WHERE key = ?), ?))'
    );
    stmt.run([key, stringValue, type, now, key, now]);
    stmt.free();

    this.saveToFile();
    return true;
  }

  /**
   * 批量更新配置
   * @param {Object} config - 配置对象
   * @returns {boolean} 是否更新成功
   */
  updateSettings(config) {
    for (const section in config) {
      if (typeof config[section] === 'object' && config[section] !== null) {
        for (const key in config[section]) {
          this.setSetting(`${section}.${key}`, config[section][key]);
        }
      }
    }
    return true;
  }

  /**
   * 删除配置项
   * @param {string} key - 配置键
   * @returns {boolean} 是否删除成功
   */
  deleteSetting(key) {
    const stmt = this.db.prepare('DELETE FROM system_settings WHERE key = ?');
    stmt.run([key]);
    stmt.free();
    this.saveToFile();
    return true;
  }

  /**
   * 重置所有配置为默认值
   * @returns {boolean} 是否重置成功
   */
  resetSettings() {
    this.db.run('DELETE FROM system_settings');
    this.initDefaultSettings();
    return true;
  }
}

// 单例实例
let databaseInstance = null;

/**
 * 获取数据库单例实例
 * @returns {DatabaseManager}
 */
function getDatabase() {
  if (!databaseInstance) {
    throw new Error('数据库未初始化，请先调用 setDatabase()');
  }
  return databaseInstance;
}

/**
 * 设置数据库实例（由main index.js调用）
 * @param {DatabaseManager} instance
 */
function setDatabase(instance) {
  databaseInstance = instance;
}

module.exports = DatabaseManager;
module.exports.getDatabase = getDatabase;
module.exports.setDatabase = setDatabase;
