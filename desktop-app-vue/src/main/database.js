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
    this.inTransaction = false; // 跟踪是否在事务中
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
          // 尝试多个可能的路径
          const possiblePaths = [];

          if (app.isPackaged) {
            // 生产环境的可能路径
            possiblePaths.push(
              // extraResource 路径（推荐）
              path.join(process.resourcesPath, file),
              // node_modules 路径
              path.join(process.resourcesPath, 'app', 'node_modules', 'sql.js', 'dist', file),
              path.join(process.resourcesPath, 'node_modules', 'sql.js', 'dist', file),
              path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
            );
          } else {
            // 开发环境：Monorepo workspace，sql.js可能在父目录或本地node_modules中
            possiblePaths.push(
              path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
              path.join(process.cwd(), '../node_modules/sql.js/dist', file),
              path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file)
            );
          }

          // 找到第一个存在的路径
          for (const filePath of possiblePaths) {
            if (fs.existsSync(filePath)) {
              console.log('Found sql.js WASM at:', filePath);
              return filePath;
            }
          }

          // 如果都不存在，返回第一个路径并记录错误
          console.error('Could not find sql.js WASM file. Tried:', possiblePaths);
          return possiblePaths[0];
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
      this.applyStatementCompat();
      // Enable foreign key constraints.
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
   * Add better-sqlite style helpers to sql.js statements.
   */
  applyStatementCompat() {
    if (!this.db || this.db.__betterSqliteCompat) {
      return;
    }

    const manager = this;
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
        project_id TEXT,
        context_type TEXT DEFAULT 'global',
        context_data TEXT,
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

    // ==================== 项目管理表 ====================

    // 项目表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app')),
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
        synced_at INTEGER,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error'))
      )
    `);

    // 项目文件表
    this.db.run(`
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
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // 项目模板表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project_type TEXT NOT NULL,
        description TEXT,
        preview_image_url TEXT,
        config_json TEXT,
        file_structure TEXT,
        usage_count INTEGER DEFAULT 0,
        is_builtin INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        synced_at INTEGER
      )
    `);

    // 文件同步状态表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS file_sync_state (
        file_id TEXT PRIMARY KEY,
        fs_hash TEXT,
        db_hash TEXT,
        last_synced_at INTEGER,
        sync_direction TEXT DEFAULT 'bidirectional',
        conflict_detected INTEGER DEFAULT 0,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE
      )
    `);

    // 项目任务表
    this.db.run(`
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
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // 项目对话历史表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // 项目任务计划表（AI智能拆解）
    this.db.run(`
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
      )
    `);

    // 项目协作者表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_collaborators (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        did TEXT,
        role TEXT DEFAULT 'viewer' CHECK(role IN ('owner', 'editor', 'viewer')),
        permissions TEXT,
        invited_by TEXT,
        invited_at INTEGER NOT NULL,
        accepted_at INTEGER,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'removed')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, user_id)
      )
    `);

    // 项目评论表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_id TEXT,
        parent_id TEXT,
        user_id TEXT NOT NULL,
        did TEXT,
        content TEXT NOT NULL,
        line_number INTEGER,
        resolved INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES project_comments(id) ON DELETE CASCADE
      )
    `);

    // 项目市场清单表
    this.db.run(`
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
      )
    `);

    // 项目知识链接表
    this.db.run(`
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
      )
    `);

    // 项目自动化规则表
    this.db.run(`
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
      )
    `);

    // 项目统计表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_stats (
        project_id TEXT PRIMARY KEY,
        file_count INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        code_lines INTEGER DEFAULT 0,
        comment_lines INTEGER DEFAULT 0,
        blank_lines INTEGER DEFAULT 0,
        commit_count INTEGER DEFAULT 0,
        contributor_count INTEGER DEFAULT 0,
        last_commit_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      )
    `);

    // 项目日志表
    this.db.run(`
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
      )
    `);

    // 项目管理索引
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_projects_sync_status ON projects(sync_status);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_templates_type ON project_templates(project_type);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_file_sync_state_file_id ON file_sync_state(file_id);
    `);

    // 新增项目表索引
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_conversations_project_id ON project_conversations(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_conversations_created_at ON project_conversations(created_at DESC);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_comments_project_id ON project_comments(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_comments_file_id ON project_comments(file_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_marketplace_project_id ON project_marketplace_listings(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_marketplace_status ON project_marketplace_listings(status);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_links_project_id ON project_knowledge_links(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_links_knowledge_id ON project_knowledge_links(knowledge_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_automation_project_id ON project_automation_rules(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_automation_enabled ON project_automation_rules(enabled);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_logs_project_id ON project_logs(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_logs_level ON project_logs(log_level);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_logs_created_at ON project_logs(created_at DESC);
    `);

    // 项目分享表
    this.db.run(`
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
      )
    `);

    // 项目分享索引
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_shares_project_id ON project_shares(project_id);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_shares_token ON project_shares(share_token);
    `);
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_shares_mode ON project_shares(share_mode);
    `);

    // 数据库迁移：为已存在的表添加新列（必须在创建依赖新列的索引之前执行）
    this.migrateDatabase();

    // 在迁移后创建依赖迁移新增列的索引
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);
    `);

    // 保存更改
    this.saveToFile();
    console.log('数据库表创建完成');
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

      // 为 projects 表添加同步字段
      const projectsInfo = this.db.prepare("PRAGMA table_info(projects)").all();
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

      // 为 project_files 表添加同步字段
      const filesSyncInfo = this.db.prepare("PRAGMA table_info(project_files)").all();
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

      // 为 knowledge_items 表添加同步字段
      const knowledgeInfo = this.db.prepare("PRAGMA table_info(knowledge_items)").all();
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

      console.log('[Database] 数据库迁移完成');
    } catch (error) {
      console.error('[Database] 数据库迁移失败:', error);
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
    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : 100;
    const safeOffset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? Math.floor(parsedOffset) : 0;

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
  }

  /**
   * 根据ID获取知识库项
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItemById(id) {
    if (!id) {
      return null;
    }
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
   * Normalize SQL params to avoid undefined values.
   * @param {Array|Object|null|undefined} params
   * @returns {Array|Object|null|undefined}
   */
  normalizeParams(params) {
    if (params === undefined || params === null) {
      return params;
    }
    if (Array.isArray(params)) {
      return params.map((value) => (value === undefined ? null : value));
    }
    if (typeof params === 'object') {
      const sanitized = {};
      Object.keys(params).forEach((key) => {
        const value = params[key];
        sanitized[key] = value === undefined ? null : value;
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
    const safeParams = this.normalizeParams(params);
    this.db.run(sql, safeParams ?? []);
    this.saveToFile();
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
    const stmt = this.db.prepare(sql);
    const safeParams = this.normalizeParams(params);
    if (safeParams !== undefined && safeParams !== null) {
      stmt.bind(safeParams);
    }
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
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
    const stmt = this.db.prepare(sql);
    const safeParams = this.normalizeParams(params);
    if (safeParams !== undefined && safeParams !== null) {
      stmt.bind(safeParams);
    }
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
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

  // ==================== 项目管理操作 ====================

  /**
   * 获取所有项目
   * @param {string} userId - 用户ID
   * @returns {Array} 项目列表
   */
  getProjects(userId) {
    const stmt = this.db.prepare(`
      SELECT
        id, user_id, name, description, project_type, status,
        root_path, file_count, total_size, template_id, cover_image_url,
        tags, metadata, created_at, updated_at, synced_at, sync_status
      FROM projects
      WHERE user_id = ?
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

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO projects (
        id, user_id, name, description, project_type, status,
        root_path, file_count, total_size, template_id, cover_image_url,
        tags, metadata, created_at, updated_at, synced_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      syncedAt,
      syncStatus,
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
      synced_at: syncedAt,
      sync_status: syncStatus,
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
      'file_count', 'total_size', 'sync_status', 'synced_at'
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
      WHERE project_id = ?
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
    const safeFiles = Array.isArray(files) ? files : [];
    this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO project_files (
          id, project_id, file_path, file_name, file_type,
          file_size, content, content_hash, version,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      safeFiles.forEach(file => {
        const rawPath = file.file_path ?? file.filePath ?? null;
        const derivedName = file.file_name
          ?? file.fileName
          ?? (rawPath ? rawPath.split(/[\\/]/).pop() : null);
        const filePath = rawPath || derivedName || '';
        const fileName = derivedName || filePath || 'untitled';
        const fileType = file.file_type ?? file.fileType ?? null;
        const fileSize = file.file_size ?? file.fileSize ?? 0;
        const content = file.content ?? null;
        const contentHash = file.content_hash ?? file.contentHash ?? null;
        const version = file.version ?? 1;

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
          fileSize,
          content,
          contentHash,
          version,
          createdAt,
          updatedAt,
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

  /**
   * 获取所有模板
   * @returns {Array} 模板列表
   */
  getProjectTemplates() {
    const stmt = this.db.prepare(`
      SELECT * FROM project_templates
      ORDER BY is_builtin DESC, usage_count DESC
    `);
    return stmt.all();
  }

  /**
   * 保存模板
   * @param {Object} template - 模板数据
   */
  saveProjectTemplate(template) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO project_templates (
        id, name, project_type, description, preview_image_url,
        config_json, file_structure, usage_count, is_builtin,
        created_at, updated_at, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      template.id,
      template.name,
      template.project_type,
      template.description,
      template.preview_image_url,
      typeof template.config_json === 'string' ? template.config_json : JSON.stringify(template.config_json || {}),
      typeof template.file_structure === 'string' ? template.file_structure : JSON.stringify(template.file_structure || []),
      template.usage_count || 0,
      template.is_builtin ? 1 : 0,
      template.created_at || Date.now(),
      template.updated_at || Date.now(),
      template.synced_at
    );

    this.saveToFile();
  }

  /**
   * 批量保存模板
   * @param {Array} templates - 模板列表
   */
  saveProjectTemplates(templates) {
    this.transaction(() => {
      templates.forEach(template => {
        this.saveProjectTemplate(template);
      });
    });
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
   * 获取对话的所有消息
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 查询选项
   * @returns {Array} 消息列表
   */
  getMessagesByConversation(conversationId, options = {}) {
    let query = 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC';
    const params = [conversationId];

    if (options.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    return stmt.all(...params);
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
}

module.exports = DatabaseManager;
