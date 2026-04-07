import { createRequire } from "module";
import { logger } from "./utils/logger.js";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import SqlSecurity from "./database/sql-security.js";

const require = createRequire(import.meta.url);

// sql.js is optional (may not be available in packaged builds)
let initSqlJs = null;
try {
  initSqlJs = require("sql.js");
} catch {
  // sql.js not available, will use native adapter
}

const disableNativeDb =
  process.env.CHAINLESSCHAIN_DISABLE_NATIVE_DB === "1" ||
  process.env.CHAINLESSCHAIN_FORCE_SQLJS === "1";

// 导入数据库加密模块
let createDatabaseAdapter;
let createBetterSQLiteAdapter;
try {
  const dbModule = require("./database/index");
  createDatabaseAdapter = dbModule.createDatabaseAdapter;
} catch (_dbErr) {
  logger.warn("[Database] 加密模块不可用，将使用sql.js:", _dbErr.message);
  createDatabaseAdapter = null;
}

// 导入 Better-SQLite3 适配器（用于开发环境）
if (!disableNativeDb) {
  try {
    const betterSqliteModule = require("./database/better-sqlite-adapter");
    createBetterSQLiteAdapter = betterSqliteModule.createBetterSQLiteAdapter;
  } catch (_sqliteErr) {
    logger.warn("[Database] Better-SQLite3 适配器不可用:", _sqliteErr.message);
    createBetterSQLiteAdapter = null;
  }
} else {
  logger.info(
    "[Database] 本地 Better-SQLite3 适配器已通过环境变量禁用，直接使用 sql.js",
  );
  createBetterSQLiteAdapter = null;
}

// Try to load electron, fallback to global.app for testing
let app;
try {
  app = require("electron").app;
} catch {
  // In test environment, use global.app if available
  app = global.app || {
    isPackaged: false,
    getPath: () => require("os").tmpdir(),
  };
}

let getAppConfig;
try {
  getAppConfig = require("./config/database-config").getAppConfig;
} catch {
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

    // 🚀 性能优化：Prepared Statement 缓存（LRU 策略，避免长期运行无界增长）
    this.initializePreparedStatementCache();

    // 🚀 性能优化：查询结果缓存（使用LRU策略）
    this.initializeQueryCache();
  }

  /**
   * 初始化 Prepared Statement 缓存（LRU 策略）
   *
   * 修复 H4: 长期运行的实例下，每条不同 SQL 都会缓存对应的 prepared statement，
   * 历史上使用普通 Map 无淘汰机制，会导致内存随会话数线性增长。
   */
  initializePreparedStatementCache() {
    try {
      const LRU = require("lru-cache");
      this.preparedStatements = new LRU({
        max: 500, // 单连接最多缓存 500 条 prepared statement
        // 注意：不能用 dispose 关闭 better-sqlite3 stmt，因为 caller 仍可能持有引用
        // better-sqlite3 stmt 在被 GC 时会自动 finalize
      });
      logger.info("[Database] Prepared statement 缓存已初始化 (LRU, max=500)");
    } catch (error) {
      logger.warn("[Database] LRU 不可用，回退到无界 Map:", error.message);
      this.preparedStatements = new Map();
    }
  }

  /**
   * 初始化查询缓存（LRU策略）
   */
  initializeQueryCache() {
    try {
      const LRU = require("lru-cache");
      this.queryCache = new LRU({
        max: 500, // 最多缓存500个查询
        maxSize: 10 * 1024 * 1024, // 最大10MB
        sizeCalculation: (value) => {
          try {
            return JSON.stringify(value).length;
          } catch {
            return 1024; // 默认1KB
          }
        },
        ttl: 1000 * 60 * 5, // 5分钟过期
        updateAgeOnGet: true, // 访问时更新年龄
      });
      logger.info("[Database] 查询缓存已初始化 (最大500项, 10MB, TTL: 5分钟)");
    } catch (error) {
      logger.warn(
        "[Database] 查询缓存初始化失败，将不使用查询缓存:",
        error.message,
      );
      this.queryCache = null;
    }
  }

  /**
   * 获取或创建 Prepared Statement
   * @param {string} sql - SQL语句
   * @returns {Statement} Prepared statement
   */
  getPreparedStatement(sql) {
    if (!this.preparedStatements.has(sql)) {
      if (!this.db || !this.db.prepare) {
        throw new Error(
          "Database not initialized or does not support prepare()",
        );
      }
      this.preparedStatements.set(sql, this.db.prepare(sql));
    }
    return this.preparedStatements.get(sql);
  }

  /**
   * 清除所有 Prepared Statements（用于数据库重置）
   *
   * 兼容 lru-cache v6 (reset) 和 v7+/Map (clear)
   */
  clearPreparedStatements() {
    if (typeof this.preparedStatements.reset === "function") {
      this.preparedStatements.reset();
    } else if (typeof this.preparedStatements.clear === "function") {
      this.preparedStatements.clear();
    }
    logger.info("[Database] Prepared statement缓存已清除");
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

      logger.info("数据库路径:", this.dbPath);

      // 开发环境优先使用 Better-SQLite3
      const isDevelopment =
        process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
      if (isDevelopment && createBetterSQLiteAdapter) {
        try {
          await this.initializeWithBetterSQLite();
          logger.info("数据库初始化成功（Better-SQLite3 开发模式）");

          // Verify database is actually initialized
          if (!this.db) {
            throw new Error("数据库对象为null，初始化失败");
          }

          return true;
        } catch (error) {
          logger.warn(
            "[Database] Better-SQLite3 初始化失败，尝试其他方式:",
            error.message,
          );
          logger.warn("[Database] 错误堆栈:", error.stack);
        }
      }

      // 尝试使用加密数据库适配器
      if (createDatabaseAdapter && this.encryptionEnabled) {
        try {
          await this.initializeWithAdapter();
          logger.info("数据库初始化成功（SQLCipher 加密模式）");

          // Verify database is actually initialized
          if (!this.db) {
            throw new Error("数据库对象为null，初始化失败");
          }

          return true;
        } catch (error) {
          logger.warn(
            "[Database] 加密初始化失败，回退到 sql.js:",
            error.message,
          );
          logger.warn("[Database] 错误堆栈:", error.stack);
          // 继续使用 sql.js
        }
      }

      // Fallback: 使用 sql.js
      await this.initializeWithSqlJs();
      logger.info("数据库初始化成功（sql.js 模式）");

      // Verify database is actually initialized
      if (!this.db) {
        throw new Error("数据库对象为null，sql.js初始化失败");
      }

      return true;
    } catch (error) {
      logger.error("数据库初始化失败:", error);
      logger.error("错误堆栈:", error.stack);
      throw error;
    }
  }

  /**
   * 使用 Better-SQLite3 初始化（开发模式）
   */
  async initializeWithBetterSQLite() {
    logger.info("[Database] 使用 Better-SQLite3 初始化数据库...");

    // 创建适配器
    this.adapter = await createBetterSQLiteAdapter({
      dbPath: this.dbPath,
    });

    // 获取数据库实例
    this.db = this.adapter.db;

    // 不需要应用兼容性补丁 - Better-SQLite3 已经有正确的 API
    // applyStatementCompat() 只适用于 sql.js

    // 为 Better-SQLite3 添加 run() 方法以兼容旧代码
    if (!this.db.run && this.db.exec) {
      this.db.run = (sql, params) => {
        if (params && (Array.isArray(params) || typeof params === "object")) {
          return this.db.prepare(sql).run(params);
        } else {
          this.db.exec(sql);
        }
      };
    }

    // 启用 WAL 模式以提高并发性能
    if (this.db.pragma) {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    }

    // 临时禁用外键约束以允许表创建和迁移
    if (this.db.pragma) {
      this.db.pragma("foreign_keys = OFF");
    }

    // 创建表
    this.createTables();

    // 运行数据库迁移（带版本检查优化）
    this.runMigrationsOptimized();

    // 重新启用外键约束
    if (this.db.pragma) {
      this.db.pragma("foreign_keys = ON");
    }
  }

  /**
   * 使用数据库适配器初始化（支持加密）
   */
  async initializeWithAdapter() {
    // Note: getAppConfig() called but result not currently used
    getAppConfig();

    // 创建数据库适配器
    this.adapter = await createDatabaseAdapter({
      dbPath: this.dbPath,
      encryptionEnabled: this.encryptionEnabled,
      password: this.encryptionPassword,
      autoMigrate: true,
      configPath: path.join(app.getPath("userData"), "db-key-config.json"),
    });

    // 创建数据库
    this.db = await this.adapter.createDatabase();

    // 应用兼容性补丁
    this.applyStatementCompat();

    // 启用 WAL 模式以提高并发性能
    if (this.db.pragma) {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("foreign_keys = ON");
    } else if (this.db.run) {
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA synchronous = NORMAL");
      this.db.run("PRAGMA foreign_keys = ON");
    }

    // 创建表
    this.createTables();

    // 运行数据库迁移（带版本检查优化）
    this.runMigrationsOptimized();
  }

  /**
   * 使用 sql.js 初始化（传统方式）
   */
  async initializeWithSqlJs() {
    this.SQL = await initSqlJs({
      locateFile: (file) => {
        // Prefer Node resolution (works with pnpm workspace layouts)
        try {
          const resolved = require.resolve(`sql.js/dist/${file}`);
          if (fs.existsSync(resolved)) {
            logger.info("Found sql.js WASM via require.resolve:", resolved);
            return resolved;
          }
        } catch {
          // Continue to manual path probing
        }

        const possiblePaths = [];

        if (app && app.isPackaged) {
          possiblePaths.push(
            path.join(process.resourcesPath, file),
            path.join(
              process.resourcesPath,
              "app",
              "node_modules",
              "sql.js",
              "dist",
              file,
            ),
            path.join(
              process.resourcesPath,
              "node_modules",
              "sql.js",
              "dist",
              file,
            ),
            path.join(
              __dirname,
              "..",
              "..",
              "node_modules",
              "sql.js",
              "dist",
              file,
            ),
          );
        } else {
          possiblePaths.push(
            path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
            path.join(
              process.cwd(),
              "desktop-app-vue",
              "node_modules",
              "sql.js",
              "dist",
              file,
            ),
            path.join(
              __dirname,
              "..",
              "..",
              "..",
              "node_modules",
              "sql.js",
              "dist",
              file,
            ),
            path.join(
              __dirname,
              "..",
              "..",
              "..",
              "..",
              "node_modules",
              "sql.js",
              "dist",
              file,
            ),
          );
        }

        for (const filePath of possiblePaths) {
          if (fs.existsSync(filePath)) {
            logger.info("Found sql.js WASM at:", filePath);
            return filePath;
          }
        }

        logger.error("Could not find sql.js WASM file. Tried:", possiblePaths);
        return possiblePaths[0];
      },
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
    this.db.run("PRAGMA foreign_keys = ON");

    // 创建表
    this.createTables();

    // 运行数据库迁移（带版本检查优化）
    this.runMigrationsOptimized();
  }

  /**
   * Add better-sqlite style helpers to sql.js statements.
   */
  applyStatementCompat() {
    if (!this.db || this.db.__betterSqliteCompat) {
      return;
    }

    // Wrap Database.run() method for compatibility
    // Store reference to manager for use in nested function
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const manager = this;
    this.db.run = function (sql, params) {
      try {
        const stmt = manager.db.prepare(sql);
        if (params && (Array.isArray(params) || typeof params === "object")) {
          stmt.bind(manager.normalizeParams(params));
        }
        stmt.step();
        stmt.free();

        // Save to file if not in transaction
        if (!manager.inTransaction) {
          manager.saveToFile();
        }

        return {
          changes: manager.db.getRowsModified
            ? manager.db.getRowsModified()
            : 0,
        };
      } catch (error) {
        logger.error("[Database] db.run() failed:", error.message);
        logger.error("[Database] SQL:", sql.substring(0, 100));
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
        } else if (first && typeof first === "object") {
          result = first;
        } else {
          result = params;
        }
      } else {
        result = params;
      }

      // 将数组中的 undefined 替换为 null（sql.js 不支持 undefined）
      if (Array.isArray(result)) {
        return result.map((v) => (v === undefined ? null : v));
      }

      // 对象参数也要清理 undefined
      if (result && typeof result === "object") {
        const cleaned = {};
        for (const key in result) {
          if (Object.prototype.hasOwnProperty.call(result, key)) {
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
          if (
            Array.isArray(bound)
              ? bound.length
              : bound && typeof bound === "object"
          ) {
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
              logger.error("[Database] 构建行对象失败:", err);
              row = null;
            }
          }

          stmt.reset();
          return row;
        };

        stmt.all = (...params) => {
          const bound = normalizeParams(params);
          if (
            Array.isArray(bound)
              ? bound.length
              : bound && typeof bound === "object"
          ) {
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
              logger.error("[Database] 构建行对象失败:", err);
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
            if (
              Array.isArray(bound)
                ? bound.length
                : bound && typeof bound === "object"
            ) {
              rawRun(bound);
            } else {
              rawRun();
            }
          } else {
            if (
              Array.isArray(bound)
                ? bound.length
                : bound && typeof bound === "object"
            ) {
              stmt.bind(bound);
            }
            stmt.step();
            stmt.reset();
          }
          // 只在非事务状态下自动保存文件
          if (!manager.inTransaction) {
            manager.saveToFile();
          }
          if (typeof manager.db.getRowsModified === "function") {
            return { changes: manager.db.getRowsModified() };
          }
          return {};
        };
      }

      return stmt;
    };

    // 添加 transaction 方法兼容性（模拟 better-sqlite3 的 transaction API）
    if (!this.db.transaction) {
      this.db.transaction = (fn) => {
        // 返回一个可调用的函数，执行时会包裹在事务中
        return (...args) => {
          try {
            manager.inTransaction = true;
            manager.db.run("BEGIN TRANSACTION");
            const result = fn(...args);
            manager.db.run("COMMIT");
            manager.saveToFile();
            return result;
          } catch (error) {
            manager.db.run("ROLLBACK");
            throw error;
          } finally {
            manager.inTransaction = false;
          }
        };
      };
    }

    this.db.__betterSqliteCompat = true;
  }

  /**
   * 保存数据库到文件
   */
  saveToFile() {
    if (!this.db) {
      throw new Error("数据库未初始化");
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
    const {
      createTables: _createTables,
    } = require("./database/database-schema");
    _createTables(this, logger);
  }

  /**
   * Ensure task_boards has required columns and related indexes.
   */
  ensureTaskBoardOwnerSchema() {
    const {
      ensureTaskBoardOwnerSchema: _ensureTaskBoardOwnerSchema,
    } = require("./database/database-migrations");
    return _ensureTaskBoardOwnerSchema(this, logger);
  }

  /**
   * 数据库迁移：为已存在的表添加新列
   */
  migrateDatabase() {
    const {
      migrateDatabase: _migrateDatabase,
    } = require("./database/database-migrations");
    return _migrateDatabase(this, logger);
  }

  /**
   * 运行数据库迁移（优化版）- 使用版本跟踪跳过不必要的迁移
   */
  runMigrationsOptimized() {
    const {
      runMigrationsOptimized: _runMigrationsOptimized,
    } = require("./database/database-migrations");
    return _runMigrationsOptimized(this, logger);
  }

  /**
   * 运行数据库迁移 - 增量更新数据库结构
   */
  runMigrations() {
    const {
      runMigrations: _runMigrations,
    } = require("./database/database-migrations");
    return _runMigrations(this, logger);
  }

  /**
   * 检查表是否需要重建（通过测试category值）
   */
  checkIfTableNeedsRebuild(tableName, testCategoryValue) {
    const {
      checkIfTableNeedsRebuild: _checkIfTableNeedsRebuild,
    } = require("./database/database-migrations");
    return _checkIfTableNeedsRebuild(
      this,
      logger,
      tableName,
      testCategoryValue,
    );
  }

  /**
   * 重建projects表（更新CHECK约束）
   */
  rebuildProjectsTable() {
    const {
      rebuildProjectsTable: _rebuildProjectsTable,
    } = require("./database/database-migrations");
    return _rebuildProjectsTable(this, logger);
  }

  /**
   * 重建project_templates表（更新CHECK约束）
   */
  rebuildProjectTemplatesTable() {
    const {
      rebuildProjectTemplatesTable: _rebuildProjectTemplatesTable,
    } = require("./database/database-migrations");
    return _rebuildProjectTemplatesTable(this, logger);
  }

  /**
   * 检查列是否存在
   */
  checkColumnExists(tableName, columnName) {
    const {
      checkColumnExists: _checkColumnExists,
    } = require("./database/database-migrations");
    return _checkColumnExists(this, logger, tableName, columnName);
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
      logger.warn("[Database] 数据库未初始化，无法获取知识库项");
      return [];
    }

    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.floor(parsedLimit)
        : 100;
    const safeOffset =
      Number.isFinite(parsedOffset) && parsedOffset >= 0
        ? Math.floor(parsedOffset)
        : 0;

    try {
      const sql = `
        SELECT * FROM knowledge_items
        ORDER BY updated_at DESC
        LIMIT ${safeLimit} OFFSET ${safeOffset}
      `;

      // Use the unified all() method which handles both sql.js and better-sqlite3
      return this.all(sql);
    } catch (error) {
      logger.error("[Database] 获取知识库项失败:", error.message);
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
      return this.get("SELECT * FROM knowledge_items WHERE id = ?", [id]);
    } catch (error) {
      logger.error("[Database] 获取知识库项失败:", error.message);
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
      return this.get("SELECT * FROM knowledge_items WHERE title = ? LIMIT 1", [
        title,
      ]);
    } catch (error) {
      logger.error("[Database] 根据标题获取知识库项失败:", error.message);
      return null;
    }
  }

  /**
   * 获取所有知识库项（无限制）
   * @returns {Array} 知识库项列表
   */
  getAllKnowledgeItems() {
    if (!this.db) {
      logger.warn("[Database] 数据库未初始化，无法获取知识库项");
      return [];
    }

    try {
      return this.all("SELECT * FROM knowledge_items ORDER BY updated_at DESC");
    } catch (error) {
      logger.error("[Database] 获取所有知识库项失败:", error.message);
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
    const rawTitle =
      typeof safeItem.title === "string" ? safeItem.title.trim() : "";
    const title = rawTitle || "Untitled";
    const type =
      typeof safeItem.type === "string" && safeItem.type
        ? safeItem.type
        : "note";
    const content =
      typeof safeItem.content === "string" ? safeItem.content : null;

    this.db.run(
      `
      INSERT INTO knowledge_items (
        id, title, type, content, content_path, embedding_path,
        created_at, updated_at, git_commit_hash, device_id, sync_status
      ) VALUES (?, COALESCE(NULLIF(?, ''), 'Untitled'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
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
        safeItem.sync_status || "pending",
      ],
    );

    // 更新全文搜索索引
    this.updateSearchIndex(id, title, content || "");

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
      fields.push("title = ?");
      values.push(updates.title);
    }
    if (updates.type !== undefined) {
      fields.push("type = ?");
      values.push(updates.type);
    }
    if (updates.content !== undefined) {
      fields.push("content = ?");
      values.push(updates.content);
    }
    if (updates.content_path !== undefined) {
      fields.push("content_path = ?");
      values.push(updates.content_path);
    }
    if (updates.sync_status !== undefined) {
      fields.push("sync_status = ?");
      values.push(updates.sync_status);
    }

    // 总是更新 updated_at
    fields.push("updated_at = ?");
    values.push(now);

    // 添加 WHERE 条件的 ID
    values.push(id);

    if (fields.length === 1) {
      // 只有 updated_at，不需要更新
      return this.getKnowledgeItemById(id);
    }

    this.db.run(
      `
      UPDATE knowledge_items
      SET ${fields.join(", ")}
      WHERE id = ?
    `,
      values,
    );

    // 更新全文搜索索引
    const item = this.getKnowledgeItemById(id);
    if (item) {
      this.updateSearchIndex(id, item.title, item.content || "");
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
    this.run("DELETE FROM knowledge_search WHERE id = ?", [id]);

    // 删除知识库项
    this.run("DELETE FROM knowledge_items WHERE id = ?", [id]);

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
    return this.all(
      `
      SELECT * FROM knowledge_items
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY updated_at DESC
      LIMIT 50
    `,
      [pattern, pattern],
    );
  }

  /**
   * 更新搜索索引
   * @param {string} id - 项目ID
   * @param {string} title - 标题
   * @param {string} content - 内容
   */
  updateSearchIndex(id, title, content) {
    // 先删除旧索引
    this.db.run("DELETE FROM knowledge_search WHERE id = ?", [id]);

    // 插入新索引
    this.db.run(
      `
      INSERT INTO knowledge_search (id, title, content)
      VALUES (?, ?, ?)
    `,
      [id, title, content],
    );
  }

  // ==================== 标签操作 ====================

  /**
   * 获取所有标签
   * @returns {Array} 标签列表
   */
  getAllTags() {
    return this.all("SELECT * FROM tags ORDER BY name");
  }

  /**
   * 创建标签
   * @param {string} name - 标签名
   * @param {string} color - 颜色
   * @returns {Object} 创建的标签
   */
  createTag(name, color = "#1890ff") {
    const id = uuidv4();
    const now = Date.now();

    try {
      this.run(
        `
        INSERT INTO tags (id, name, color, created_at)
        VALUES (?, ?, ?, ?)
      `,
        [id, name, color, now],
      );

      return { id, name, color, created_at: now };
    } catch (error) {
      if (error.message.includes("UNIQUE")) {
        // 标签已存在，返回现有标签
        return this.get("SELECT * FROM tags WHERE name = ?", [name]);
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
    this.db.run(
      `
      INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag_id, created_at)
      VALUES (?, ?, ?)
    `,
      [knowledgeId, tagId, Date.now()],
    );
    this.saveToFile();
  }

  /**
   * 获取知识库项的标签
   * @param {string} knowledgeId - 知识库项ID
   * @returns {Array} 标签列表
   */
  getKnowledgeTags(knowledgeId) {
    return this.all(
      `
      SELECT t.* FROM tags t
      JOIN knowledge_tags kt ON t.id = kt.tag_id
      WHERE kt.knowledge_id = ?
    `,
      [knowledgeId],
    );
  }

  // ==================== 统计功能 ====================

  /**
   * 获取统计数据
   * @returns {Object} 统计信息
   */
  getStatistics() {
    const total = this.get("SELECT COUNT(*) as count FROM knowledge_items");

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    const todayCount = this.get(
      "SELECT COUNT(*) as count FROM knowledge_items WHERE created_at >= ?",
      [todayTimestamp],
    );

    const byType = this.all(`
      SELECT type, COUNT(*) as count
      FROM knowledge_items
      GROUP BY type
    `);

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
   * Generate a unique ID
   * @returns {string} UUID
   */
  generateId() {
    return uuidv4();
  }

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
      const {
        getPerformanceMonitor,
      } = require("../../utils/performance-monitor");
      const monitor = getPerformanceMonitor();

      // Log slow query if it exceeds threshold (from env or default 100ms)
      const slowQueryThreshold =
        parseInt(process.env.DB_SLOW_QUERY_THRESHOLD) || 100;

      if (duration > slowQueryThreshold) {
        monitor.logSlowQuery(sql, duration, params);
      }

      // Track the operation
      monitor.trackOperation(queryName, duration, {
        sql: sql.substring(0, 100), // First 100 chars of SQL
        paramCount: Array.isArray(params) ? params.length : 0,
      });
    } catch {
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
      if (typeof value === "number" && !isFinite(value)) {
        logger.warn(
          "[Database] 警告: 检测到特殊数值 (NaN/Infinity)，已转换为NULL",
        );
        return null;
      }
      return value;
    };

    if (Array.isArray(params)) {
      return params.map(normalizeValue);
    }
    if (typeof params === "object") {
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
      throw new Error("Database not initialized");
    }

    const startTime = Date.now();
    try {
      logger.info("[Database] 开始执行SQL操作");
      const safeParams = this.normalizeParams(params);
      logger.info("[Database] 参数规范化完成");
      logger.info(
        "[Database] 执行SQL:",
        sql.substring(0, 100).replace(/\s+/g, " "),
      );
      logger.info(
        "[Database] 参数数量:",
        Array.isArray(safeParams) ? safeParams.length : "N/A",
      );

      // 打印前3个参数用于调试（避免泄露过多信息）
      if (Array.isArray(safeParams) && safeParams.length > 0) {
        logger.info("[Database] 前3个参数:", safeParams.slice(0, 3));
      }

      logger.info("[Database] 调用 prepare + run...");
      // 使用 prepare + run 方式以确保参数正确绑定
      const stmt = this.db.prepare(sql);
      stmt.run(safeParams ?? []);
      logger.info("[Database] ✅ SQL执行成功");

      logger.info("[Database] 开始保存到文件...");
      if (!this.inTransaction) {
        this.saveToFile();
        logger.info("[Database] ✅ 数据已保存到文件");
      }

      // Track performance
      const duration = Date.now() - startTime;
      this.trackQueryPerformance("db.run", duration, sql, safeParams);
    } catch (error) {
      logger.error("[Database] ❌ SQL执行失败:", error.message);
      logger.error("[Database] Error类型:", error.constructor.name);
      logger.error("[Database] SQL语句前100字:", sql.substring(0, 100));
      logger.error(
        "[Database] 参数数量:",
        Array.isArray(params) ? params.length : "N/A",
      );
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
      throw new Error("Database not initialized");
    }

    const startTime = Date.now();
    const stmt = this.db.prepare(sql);

    // Use the wrapped get() method if available (safer than direct getAsObject)
    if (
      stmt.get &&
      typeof stmt.get === "function" &&
      stmt.__betterSqliteCompat
    ) {
      const row = stmt.get(params);
      stmt.free();

      // Track performance
      const duration = Date.now() - startTime;
      this.trackQueryPerformance("db.get", duration, sql, params);

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
        logger.error("[Database] Error building row object:", err);
        row = null;
      }
    }

    stmt.free();

    // Track performance
    const duration = Date.now() - startTime;
    this.trackQueryPerformance("db.get", duration, sql, safeParams);

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
      throw new Error("Database not initialized");
    }

    const startTime = Date.now();
    const stmt = this.db.prepare(sql);

    // Use the wrapped all() method if available (safer than direct getAsObject)
    if (
      stmt.all &&
      typeof stmt.all === "function" &&
      stmt.__betterSqliteCompat
    ) {
      const rows = stmt.all(params);
      stmt.free();

      // Track performance
      const duration = Date.now() - startTime;
      this.trackQueryPerformance("db.all", duration, sql, params);

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
        logger.error("[Database] Error building row object:", err);
        // Skip this row and continue
      }
    }

    stmt.free();

    // Track performance
    const duration = Date.now() - startTime;
    this.trackQueryPerformance("db.all", duration, sql, safeParams);

    return rows;
  }

  /**
   * Execute SQL and return raw results (for DDL or queries)
   * @param {string} sql - SQL statement
   * @returns {Array} Raw query results
   */
  exec(sql) {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    try {
      return this.db.exec(sql);
    } catch (error) {
      logger.error("[Database] exec() failed:", error.message);
      logger.error("[Database] SQL:", sql.substring(0, 100));
      throw error;
    }
  }

  /**
   * Get the underlying database instance
   * @returns {Object} Database instance
   */
  getDatabase() {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    return this.db;
  }

  /**
   * Prepare a SQL statement
   * @param {string} sql - SQL statement
   * @returns {Object} Prepared statement
   */
  prepare(sql) {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    try {
      return this.db.prepare(sql);
    } catch (error) {
      logger.error("[Database] prepare() failed:", error.message);
      logger.error("[Database] SQL:", sql.substring(0, 100));
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
      this.db.prepare("BEGIN TRANSACTION").run();

      // 执行回调中的操作
      callback();

      // 提交事务
      this.db.prepare("COMMIT").run();

      // 清除事务标志
      this.inTransaction = false;

      // 保存到文件
      this.saveToFile();
    } catch (error) {
      // 回滚事务
      try {
        this.db.prepare("ROLLBACK").run();
      } catch (rollbackError) {
        logger.error("[Database] ROLLBACK 失败:", rollbackError);
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
           WHERE id = ?`,
        );

        stmt.run(status, syncedAt, recordId);
        stmt.free();
      });

      return true;
    } catch (error) {
      logger.error(
        `[Database] 更新同步状态失败: table=${tableName}, id=${recordId}`,
        error,
      );
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
        update.syncedAt,
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

      // 清理缓存
      this.clearPreparedStatements();
      if (this.queryCache && typeof this.queryCache.clear === "function") {
        this.queryCache.clear();
        logger.info("[Database] 查询缓存已清除");
      }

      this.db.close();
      logger.info("数据库连接已关闭");
    }
  }

  /**
   * 切换到另一个数据库文件
   * @param {string} newDbPath - 新数据库文件的路径
   * @param {Object} options - 选项（password, encryptionEnabled）
   * @returns {Promise<boolean>} 切换是否成功
   */
  async switchDatabase(newDbPath, options = {}) {
    logger.info("[Database] 切换数据库:", newDbPath);

    try {
      // 1. 保存并关闭当前数据库
      if (this.db) {
        logger.info("[Database] 保存并关闭当前数据库...");
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

      logger.info("[Database] ✓ 数据库切换成功:", newDbPath);
      return true;
    } catch (error) {
      logger.error("[Database] 切换数据库失败:", error);
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
    const dataDir = appConfig.getDatabaseDir
      ? appConfig.getDatabaseDir()
      : path.join(app.getPath("userData"), "data");

    // 确保数据目录存在
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (contextId === "personal") {
      // 个人数据库
      return path.join(dataDir, "personal.db");
    } else if (contextId.startsWith("org_")) {
      // 组织数据库
      return path.join(dataDir, `${contextId}.db`);
    } else {
      // 默认数据库（向后兼容）
      return path.join(dataDir, "chainlesschain.db");
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
   * 备份数据库
   * @param {string} backupPath - 备份路径
   * @returns {Promise<void>}
   */
  async backup(backupPath) {
    if (!this.db) {
      throw new Error("数据库未初始化");
    }

    // Check for sql.js first (has export() method which returns Uint8Array)
    // Note: sql.js 1.8+ also has backup() but with different signature
    if (typeof this.db.export === "function") {
      // sql.js: use export() and write buffer to file
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(backupPath, buffer);
      return;
    }

    // better-sqlite3 / better-sqlite3-multiple-ciphers: check if connection is open
    if (this.db.__betterSqliteCompat || typeof this.db.backup === "function") {
      // Check if database connection is still open
      // better-sqlite3 has an 'open' property that indicates connection status
      if (this.db.open === false) {
        logger.warn("[Database] 数据库连接已关闭，使用文件复制备份");
        if (this.dbPath && fs.existsSync(this.dbPath)) {
          fs.copyFileSync(this.dbPath, backupPath);
          return;
        }
        throw new Error("数据库连接已关闭且无法复制文件");
      }

      try {
        // better-sqlite3-multiple-ciphers backup() returns a Promise
        // better-sqlite3 backup() is synchronous but can be awaited safely
        await this.db.backup(backupPath);
        return;
      } catch (error) {
        // If backup fails (e.g., connection issues), try file copy as fallback
        logger.warn("[Database] backup() 失败，尝试文件复制:", error.message);
        if (this.dbPath && fs.existsSync(this.dbPath)) {
          fs.copyFileSync(this.dbPath, backupPath);
          return;
        }
        throw error;
      }
    }

    // Fallback: copy the database file directly
    if (this.dbPath && fs.existsSync(this.dbPath)) {
      fs.copyFileSync(this.dbPath, backupPath);
    } else {
      throw new Error("无法备份数据库: 不支持的数据库类型");
    }
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
      // ✅ 安全验证：防止SQL注入
      const safeTableName = SqlSecurity.validateTableName(
        tableName,
        SqlSecurity.getAllowedTables(),
      );

      const stmt = this.db.prepare(
        `UPDATE ${safeTableName}
         SET deleted = 1,
             updated_at = ?,
             sync_status = 'pending'
         WHERE id = ?`,
      );

      stmt.run(Date.now(), id);
      stmt.free();

      this.saveToFile();
      logger.info(`[Database] 软删除记录: table=${tableName}, id=${id}`);
      return true;
    } catch (error) {
      logger.error(
        `[Database] 软删除失败: table=${tableName}, id=${id}`,
        error,
      );
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
      // ✅ 安全验证：防止SQL注入
      const safeTableName = SqlSecurity.validateTableName(
        tableName,
        SqlSecurity.getAllowedTables(),
      );

      const stmt = this.db.prepare(
        `UPDATE ${safeTableName}
         SET deleted = 0,
             updated_at = ?,
             sync_status = 'pending'
         WHERE id = ?`,
      );

      stmt.run(Date.now(), id);
      stmt.free();

      this.saveToFile();
      logger.info(`[Database] 恢复软删除记录: table=${tableName}, id=${id}`);
      return true;
    } catch (error) {
      logger.error(`[Database] 恢复失败: table=${tableName}, id=${id}`, error);
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
      // ✅ 安全验证：防止SQL注入
      const safeTableName = SqlSecurity.validateTableName(
        tableName,
        SqlSecurity.getAllowedTables(),
      );

      const stmt = this.db.prepare(
        `DELETE FROM ${safeTableName}
         WHERE deleted = 1
           AND updated_at < ?`,
      );

      const info = stmt.run(cutoffTime);
      stmt.free();

      const deletedCount = info.changes || 0;

      if (deletedCount > 0) {
        this.saveToFile();
        logger.info(`[Database] 清理${tableName}表: ${deletedCount}条记录`);
      }

      return { deleted: deletedCount, tableName };
    } catch (error) {
      logger.error(`[Database] 清理失败: table=${tableName}`, error);
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
      "projects",
      "project_files",
      "knowledge_items",
      "project_collaborators",
      "project_comments",
      "project_tasks",
    ];

    const results = [];
    let totalDeleted = 0;

    for (const tableName of syncTables) {
      const result = this.cleanupSoftDeleted(tableName, olderThanDays);
      results.push(result);
      totalDeleted += result.deleted;
    }

    logger.info(`[Database] 总共清理 ${totalDeleted} 条软删除记录`);

    return results;
  }

  /**
   * 获取软删除记录的统计信息
   * @returns {Object} 统计信息 {total: number, byTable: Object}
   */
  getSoftDeletedStats() {
    const syncTables = [
      "projects",
      "project_files",
      "knowledge_items",
      "project_collaborators",
      "project_comments",
      "project_tasks",
    ];

    const stats = {
      total: 0,
      byTable: {},
    };

    for (const tableName of syncTables) {
      try {
        // ✅ 安全验证：即使是内部表名也验证
        const safeTableName = SqlSecurity.validateTableName(
          tableName,
          SqlSecurity.getAllowedTables(),
        );

        const stmt = this.db.prepare(
          `SELECT COUNT(*) as count FROM ${safeTableName} WHERE deleted = 1`,
        );

        stmt.step();
        const count = stmt.getAsObject().count || 0;
        stmt.free();

        stats.byTable[tableName] = count;
        stats.total += count;
      } catch (error) {
        logger.error(`[Database] 统计失败: table=${tableName}`, error);
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
    logger.info(
      `[Database] 启动定期清理: 每${intervalHours}小时清理${retentionDays}天前的软删除记录`,
    );

    // 立即执行一次
    this.cleanupAllSoftDeleted(retentionDays);

    // 定期执行
    const timer = setInterval(
      () => {
        logger.info("[Database] 执行定期清理任务...");
        this.cleanupAllSoftDeleted(retentionDays);
      },
      intervalHours * 60 * 60 * 1000,
    );

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
    if (!relations || relations.length === 0) {
      return 0;
    }

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO knowledge_relations (id, source_id, target_id, relation_type, weight, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let count = 0;
    relations.forEach((rel) => {
      const id = this.generateId();
      const createdAt = Date.now();
      const metadataStr = rel.metadata ? JSON.stringify(rel.metadata) : null;

      try {
        stmt.run([
          id,
          rel.sourceId,
          rel.targetId,
          rel.type,
          rel.weight || 1.0,
          metadataStr,
          createdAt,
        ]);
        count++;
      } catch (error) {
        logger.error(
          `[Database] 添加关系失败 (${rel.sourceId} -> ${rel.targetId}):`,
          error,
        );
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
    if (!noteId) {
      return 0;
    }

    let query;
    let params;

    if (types && types.length > 0) {
      const placeholders = types.map(() => "?").join(",");
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
      relationTypes = ["link", "tag", "semantic", "temporal"],
      minWeight = 0.0,
      nodeTypes = ["note", "document", "conversation", "web_clip"],
      limit = 500,
    } = options;

    // 1. 查询涉及关系的所有笔记ID
    const relationTypesList = relationTypes.map(() => "?").join(",");
    const relStmt = this.db.prepare(`
      SELECT DISTINCT source_id as id FROM knowledge_relations
      WHERE relation_type IN (${relationTypesList}) AND weight >= ?
      UNION
      SELECT DISTINCT target_id as id FROM knowledge_relations
      WHERE relation_type IN (${relationTypesList}) AND weight >= ?
      LIMIT ?
    `);
    relStmt.bind([
      ...relationTypes,
      minWeight,
      ...relationTypes,
      minWeight,
      limit,
    ]);

    const nodeIds = [];
    while (relStmt.step()) {
      nodeIds.push(relStmt.getAsObject().id);
    }
    relStmt.free();

    // 2. 查询这些笔记的详细信息
    const nodes = [];
    if (nodeIds.length > 0) {
      const nodeTypesFilter = nodeTypes.map(() => "?").join(",");
      const idsFilter = nodeIds.map(() => "?").join(",");
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
      const idsFilter = nodeIds.map(() => "?").join(",");
      const relationTypesFilter = relationTypes.map(() => "?").join(",");
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

      currentLevel.forEach((nodeId) => {
        const stmt = this.db.prepare(`
          SELECT id, source_id, target_id, relation_type, weight, metadata
          FROM knowledge_relations
          WHERE source_id = ? OR target_id = ?
        `);
        stmt.bind([nodeId, nodeId]);

        while (stmt.step()) {
          const edge = stmt.getAsObject();
          const otherId =
            edge.source_id === nodeId ? edge.target_id : edge.source_id;

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
      const idsFilter = nodeIds.map(() => "?").join(",");
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
        type: "tag",
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
        sourceId:
          row.source_time < row.target_time ? row.source_id : row.target_id,
        targetId:
          row.source_time < row.target_time ? row.target_id : row.source_id,
        type: "temporal",
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
  getProjects(userId, options = {}) {
    if (!this.db) {
      logger.error("[DatabaseManager] 数据库未初始化");
      return [];
    }

    const {
      offset = 0,
      limit = 0,
      sortBy = "updated_at",
      sortOrder = "DESC",
    } = options;

    // ✅ 安全验证：防止SQL注入
    const safeSortBy = SqlSecurity.validateColumnName(sortBy, [
      "id",
      "name",
      "created_at",
      "updated_at",
      "project_type",
      "status",
    ]);
    const safeSortOrder = SqlSecurity.validateOrder(sortOrder);

    let query = `
      SELECT
        id, user_id, name, description, project_type, status,
        root_path, file_count, total_size, template_id, cover_image_url,
        tags, metadata, created_at, updated_at, synced_at, sync_status
      FROM projects
      WHERE user_id = ? AND deleted = 0
      ORDER BY ${safeSortBy} ${safeSortOrder}
    `;

    const params = [userId];

    // 添加分页
    if (limit > 0) {
      const safeLimit = SqlSecurity.validateLimit(limit);
      const safeOffset = SqlSecurity.validateOffset(offset);
      query += " LIMIT ? OFFSET ?";
      params.push(safeLimit, safeOffset);
    }

    const stmt = this.db.prepare(query);

    let projects = [];
    try {
      projects = stmt.all(...params);
    } catch (err) {
      logger.error("[Database] getProjects 查询失败:", err);
      // 返回空数组
      return [];
    }

    // 清理每个项目中的 undefined 和 null 值
    return projects.map((project) => {
      const cleaned = {};
      for (const key in project) {
        if (Object.prototype.hasOwnProperty.call(project, key)) {
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
   * 获取项目总数
   * @param {string} userId - 用户ID
   * @returns {number} 项目总数
   */
  getProjectsCount(userId) {
    if (!this.db) {
      logger.error("[DatabaseManager] 数据库未初始化");
      return 0;
    }

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM projects
      WHERE user_id = ? AND deleted = 0
    `);

    try {
      const result = stmt.get(userId);
      return result?.count || 0;
    } catch (err) {
      logger.error("[Database] getProjectsCount 查询失败:", err);
      return 0;
    }
  }

  /**
   * 调试：获取数据库统计信息
   * @returns {Object} 数据库统计信息
   */
  getDatabaseStats() {
    if (!this.db) {
      return { error: "数据库未初始化" };
    }

    try {
      const stats = {};

      // 获取projects表统计
      const projectsCount = this.db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get();
      const projectsDeleted = this.db
        .prepare("SELECT COUNT(*) as count FROM projects WHERE deleted = 1")
        .get();
      const projectsActive = this.db
        .prepare("SELECT COUNT(*) as count FROM projects WHERE deleted = 0")
        .get();

      // 获取project_files表统计
      const filesCount = this.db
        .prepare("SELECT COUNT(*) as count FROM project_files")
        .get();
      const filesDeleted = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM project_files WHERE deleted = 1",
        )
        .get();
      const filesActive = this.db
        .prepare(
          "SELECT COUNT(*) as count FROM project_files WHERE deleted = 0",
        )
        .get();

      // 获取所有用户ID
      const users = this.db
        .prepare("SELECT DISTINCT user_id FROM projects")
        .all();

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

      stats.users = users.map((u) => u.user_id);

      // 获取数据库路径和大小
      stats.dbPath = this.dbPath;
      if (fs.existsSync(this.dbPath)) {
        const fileStats = fs.statSync(this.dbPath);
        stats.dbSize = fileStats.size;
        stats.dbSizeMB = (fileStats.size / 1024 / 1024).toFixed(2) + " MB";
        stats.dbModified = new Date(fileStats.mtime).toISOString();
      }

      // 是否使用加密
      stats.encrypted = !!this.adapter;

      return stats;
    } catch (error) {
      logger.error("[Database] getDatabaseStats 失败:", error);
      return { error: error.message };
    }
  }

  /**
   * 根据ID获取项目
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 项目
   */
  getProjectById(projectId) {
    logger.info(
      "[Database] getProjectById 输入参数:",
      projectId,
      "type:",
      typeof projectId,
    );

    const stmt = this.db.prepare("SELECT * FROM projects WHERE id = ?");

    logger.info("[Database] 准备执行 stmt.get...");
    let project;
    try {
      project = stmt.get(projectId);
      logger.info(
        "[Database] stmt.get 执行成功，结果:",
        project ? "OK" : "NULL",
      );
    } catch (getError) {
      logger.error("[Database] stmt.get 失败!");
      logger.error("[Database] 查询参数 projectId:", projectId);
      logger.error("[Database] 错误对象:", getError);
      throw getError;
    }

    // 清理 undefined 值，SQLite 可能返回 undefined
    if (!project) {
      logger.info("[Database] 未找到项目，返回 null");
      return null;
    }

    logger.info("[Database] 开始清理 undefined 值...");
    const cleaned = {};
    for (const key in project) {
      if (
        Object.prototype.hasOwnProperty.call(project, key) &&
        project[key] !== undefined
      ) {
        cleaned[key] = project[key];
      }
    }

    logger.info("[Database] 清理完成，返回键:", Object.keys(cleaned));
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
      const errorMsg =
        "数据库未初始化，无法保存项目。请检查数据库配置和加密设置。";
      logger.error("[Database]", errorMsg);
      throw new Error(errorMsg);
    }

    const safeProject = project || {};
    const projectType =
      safeProject.project_type ?? safeProject.projectType ?? "web";
    const userId = safeProject.user_id ?? safeProject.userId ?? "local-user";
    const rootPath = safeProject.root_path ?? safeProject.rootPath ?? null;
    const templateId =
      safeProject.template_id ?? safeProject.templateId ?? null;
    const coverImageUrl =
      safeProject.cover_image_url ?? safeProject.coverImageUrl ?? null;
    const fileCount = safeProject.file_count ?? safeProject.fileCount ?? 0;
    const totalSize = safeProject.total_size ?? safeProject.totalSize ?? 0;
    const tagsValue =
      typeof safeProject.tags === "string"
        ? safeProject.tags
        : JSON.stringify(safeProject.tags || []);
    const metadataValue =
      typeof safeProject.metadata === "string"
        ? safeProject.metadata
        : JSON.stringify(safeProject.metadata || {});
    // 确保时间戳是数字（毫秒），如果是字符串则转换
    let createdAt =
      safeProject.created_at ?? safeProject.createdAt ?? Date.now();
    logger.info(
      "[Database] createdAt 原始值:",
      createdAt,
      "type:",
      typeof createdAt,
    );
    if (typeof createdAt === "string") {
      createdAt = new Date(createdAt).getTime();
      logger.info(
        "[Database] createdAt 转换后:",
        createdAt,
        "type:",
        typeof createdAt,
      );
    }

    let updatedAt =
      safeProject.updated_at ?? safeProject.updatedAt ?? Date.now();
    logger.info(
      "[Database] updatedAt 原始值:",
      updatedAt,
      "type:",
      typeof updatedAt,
    );
    if (typeof updatedAt === "string") {
      updatedAt = new Date(updatedAt).getTime();
      logger.info(
        "[Database] updatedAt 转换后:",
        updatedAt,
        "type:",
        typeof updatedAt,
      );
    }

    let syncedAt = safeProject.synced_at ?? safeProject.syncedAt ?? null;
    logger.info(
      "[Database] syncedAt 原始值:",
      syncedAt,
      "type:",
      typeof syncedAt,
    );
    if (typeof syncedAt === "string") {
      syncedAt = new Date(syncedAt).getTime();
      logger.info(
        "[Database] syncedAt 转换后:",
        syncedAt,
        "type:",
        typeof syncedAt,
      );
    }

    const syncStatus =
      safeProject.sync_status ?? safeProject.syncStatus ?? "pending";
    const deviceId = safeProject.device_id ?? safeProject.deviceId ?? null;
    const deleted = safeProject.deleted ?? 0;
    const categoryId =
      safeProject.category_id ?? safeProject.categoryId ?? null;

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
      safeProject.status || "active",
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

    logger.info("[Database] 最终params准备绑定:");
    params.forEach((param, index) => {
      logger.info(
        `  [${index}] ${typeof param} = ${param === undefined ? "UNDEFINED!" : param === null ? "NULL" : JSON.stringify(param).substring(0, 50)}`,
      );
    });

    logger.info("[Database] 开始执行 stmt.run...");
    try {
      stmt.run(...params);
      logger.info("[Database] stmt.run 执行成功");
    } catch (runError) {
      logger.error("[Database] stmt.run 失败!");
      logger.error("[Database] 错误对象:", runError);
      logger.error("[Database] 错误类型:", typeof runError);
      logger.error("[Database] 错误消息:", runError?.message);
      logger.error("[Database] 错误堆栈:", runError?.stack);
      logger.error("[Database] 错误代码:", runError?.code);
      throw runError;
    }

    // 不查询数据库，直接返回刚保存的数据（避免查询返回 undefined 字段）
    logger.info("[Database] 直接返回 safeProject（不查询）");
    const savedProject = {
      id: safeProject.id,
      user_id: userId,
      name: safeProject.name,
      description: safeProject.description,
      project_type: projectType,
      status: safeProject.status || "active",
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

    logger.info("[Database] saveProject 完成，返回结果");
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
      "name",
      "description",
      "status",
      "tags",
      "cover_image_url",
      "file_count",
      "total_size",
      "sync_status",
      "synced_at",
      "root_path",
      "folder_path",
      "project_type",
      "delivered_at",
    ];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (field === "tags" || field === "metadata") {
          values.push(
            typeof updates[field] === "string"
              ? updates[field]
              : JSON.stringify(updates[field]),
          );
        } else {
          values.push(updates[field]);
        }
      }
    });

    // 总是更新 updated_at
    fields.push("updated_at = ?");
    values.push(updates.updated_at || Date.now());

    values.push(projectId);

    if (fields.length === 1) {
      return this.getProjectById(projectId);
    }

    this.db.run(
      `
      UPDATE projects SET ${fields.join(", ")} WHERE id = ?
    `,
      values,
    );

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
    this.db.run("DELETE FROM project_files WHERE project_id = ?", [projectId]);

    // 删除项目
    this.db.run("DELETE FROM projects WHERE id = ?", [projectId]);

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
      const errorMsg =
        "数据库未初始化，无法保存项目文件。请检查数据库配置和加密设置。";
      logger.error("[Database]", errorMsg);
      throw new Error(errorMsg);
    }

    const safeFiles = Array.isArray(files) ? files : [];
    this.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO project_files (
          id, project_id, file_path, file_name, file_type,
          file_size, content, content_hash, version, fs_path, is_folder,
          created_at, updated_at, sync_status, synced_at, device_id, deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      safeFiles.forEach((file) => {
        // 支持多种字段名格式：后端可能返回 path/type，前端可能使用 file_path/filePath
        const rawPath = file.file_path ?? file.filePath ?? file.path ?? null;
        const derivedName =
          file.file_name ??
          file.fileName ??
          (rawPath ? rawPath.split(/[\\/]/).pop() : null);
        const filePath = rawPath || derivedName || "";
        const fileName = derivedName || filePath || "untitled";
        const fileType = file.file_type ?? file.fileType ?? file.type ?? null;
        const fileSize = file.file_size ?? file.fileSize ?? null;
        const content = file.content ?? null;
        const contentHash = file.content_hash ?? file.contentHash ?? null;
        const version = file.version ?? 1;
        const fsPath = file.fs_path ?? file.fsPath ?? null;
        const syncStatus = file.sync_status ?? file.syncStatus ?? "pending";
        const syncedAt = file.synced_at ?? file.syncedAt ?? null;
        const deviceId = file.device_id ?? file.deviceId ?? null;
        const deleted = file.deleted ?? 0;
        const isFolder = file.is_folder ?? file.isFolder ?? 0;

        // 如果没有file_size但有content，自动计算大小
        let actualFileSize = fileSize;
        if (!actualFileSize && content) {
          if (typeof content === "string") {
            // base64编码的内容
            if (file.content_encoding === "base64") {
              actualFileSize = Math.floor(content.length * 0.75); // base64解码后约为3/4
            } else {
              actualFileSize = Buffer.byteLength(content, "utf-8");
            }
          } else if (Buffer.isBuffer(content)) {
            actualFileSize = content.length;
          }
        }
        actualFileSize = actualFileSize || 0;

        // 确保时间戳是数字（毫秒），如果是字符串则转换
        let createdAt = file.created_at ?? file.createdAt ?? Date.now();
        if (typeof createdAt === "string") {
          createdAt = new Date(createdAt).getTime();
        }

        let updatedAt = file.updated_at ?? file.updatedAt ?? Date.now();
        if (typeof updatedAt === "string") {
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
          isFolder,
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
      fileUpdate.id,
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
    const id =
      conversationData.id ||
      `conv_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO conversations (
        id, title, knowledge_id, project_id, context_type, context_data,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      conversationData.title || "新对话",
      conversationData.knowledge_id || null,
      conversationData.project_id || null,
      conversationData.context_type || "global",
      conversationData.context_data
        ? JSON.stringify(conversationData.context_data)
        : null,
      conversationData.created_at || now,
      conversationData.updated_at || now,
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
    const stmt = this.db.prepare("SELECT * FROM conversations WHERE id = ?");
    const conversation = stmt.get(conversationId);

    if (!conversation) {
      return null;
    }

    // 解析 context_data
    if (conversation.context_data) {
      try {
        conversation.context_data = JSON.parse(conversation.context_data);
      } catch (_e) {
        logger.error("解析 context_data 失败:", _e);
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

    if (!conversation) {
      return null;
    }

    // 解析 context_data
    if (conversation.context_data) {
      try {
        conversation.context_data = JSON.parse(conversation.context_data);
      } catch (_e) {
        logger.error("解析 context_data 失败:", _e);
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
    let query = "SELECT * FROM conversations WHERE 1=1";
    const params = [];

    if (options.project_id) {
      query += " AND project_id = ?";
      params.push(options.project_id);
    }

    if (options.knowledge_id) {
      query += " AND knowledge_id = ?";
      params.push(options.knowledge_id);
    }

    if (options.context_type) {
      query += " AND context_type = ?";
      params.push(options.context_type);
    }

    query += " ORDER BY updated_at DESC";

    if (options.limit) {
      query += " LIMIT ?";
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const conversations = stmt.all(...params);

    // 解析 context_data
    return conversations.map((conv) => {
      if (conv.context_data) {
        try {
          conv.context_data = JSON.parse(conv.context_data);
        } catch (_e) {
          logger.error("解析 context_data 失败:", _e);
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

    const allowedFields = ["title", "context_type", "context_data"];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        fields.push(`${field} = ?`);
        if (field === "context_data" && typeof updates[field] !== "string") {
          values.push(JSON.stringify(updates[field]));
        } else {
          values.push(updates[field]);
        }
      }
    });

    // 总是更新 updated_at
    fields.push("updated_at = ?");
    values.push(Date.now());

    values.push(conversationId);

    if (fields.length === 1) {
      return this.getConversationById(conversationId);
    }

    this.db.run(
      `
      UPDATE conversations SET ${fields.join(", ")} WHERE id = ?
    `,
      values,
    );

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
    this.db.run("DELETE FROM messages WHERE conversation_id = ?", [
      conversationId,
    ]);

    // 删除对话
    this.db.run("DELETE FROM conversations WHERE id = ?", [conversationId]);

    this.saveToFile();
    return true;
  }

  /**
   * 创建消息
   * @param {Object} messageData - 消息数据
   * @returns {Object} 创建的消息
   */
  createMessage(messageData) {
    const id =
      messageData.id ||
      `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    // 确定message_type：优先使用messageData.type，否则根据role推断
    let messageType = messageData.type || messageData.message_type;
    if (!messageType) {
      // 向后兼容：根据role推断message_type
      if (messageData.role === "user") {
        messageType = "USER";
      } else if (messageData.role === "assistant") {
        messageType = "ASSISTANT";
      } else if (messageData.role === "system") {
        messageType = "SYSTEM";
      } else {
        messageType = "ASSISTANT";
      } // 默认值
    }

    // 序列化metadata为JSON字符串
    const metadataStr = messageData.metadata
      ? JSON.stringify(messageData.metadata)
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, conversation_id, role, content, timestamp, tokens, message_type, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      messageData.conversation_id,
      messageData.role,
      messageData.content,
      messageData.timestamp || now,
      messageData.tokens || null,
      messageType,
      metadataStr,
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
    const stmt = this.db.prepare("SELECT * FROM messages WHERE id = ?");
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
    // ✅ 安全验证：防止SQL注入
    const safeOrder = SqlSecurity.validateOrder(options.order || "ASC");
    let query = `SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ${safeOrder}`;
    const params = [conversationId];

    // 添加分页支持
    if (options.limit) {
      const safeLimit = SqlSecurity.validateLimit(options.limit);
      query += " LIMIT ?";
      params.push(safeLimit);

      if (options.offset) {
        const safeOffset = SqlSecurity.validateOffset(options.offset);
        query += " OFFSET ?";
        params.push(safeOffset);
      }
    }

    const stmt = this.db.prepare(query);
    const rawMessages = stmt.all(...params);

    // 反序列化metadata字段
    const messages = rawMessages.map((msg) => {
      if (msg.metadata) {
        try {
          msg.metadata = JSON.parse(msg.metadata);
        } catch (_e) {
          logger.warn("[Database] 无法解析消息metadata:", msg.id, _e);
          msg.metadata = null;
        }
      }
      // 向后兼容：如果没有message_type，根据role设置
      if (!msg.message_type) {
        if (msg.role === "user") {
          msg.message_type = "USER";
        } else if (msg.role === "assistant") {
          msg.message_type = "ASSISTANT";
        } else if (msg.role === "system") {
          msg.message_type = "SYSTEM";
        } else {
          msg.message_type = "ASSISTANT";
        }
      }
      return msg;
    });

    // 获取总消息数
    const countStmt = this.db.prepare(
      "SELECT COUNT(*) as total FROM messages WHERE conversation_id = ?",
    );
    const countResult = countStmt.get(conversationId);
    const total = countResult ? countResult.total : 0;

    return {
      messages,
      total,
      hasMore:
        options.limit && options.offset
          ? options.offset + options.limit < total
          : false,
    };
  }

  /**
   * 删除消息
   * @param {string} messageId - 消息ID
   * @returns {boolean} 是否删除成功
   */
  deleteMessage(messageId) {
    this.db.run("DELETE FROM messages WHERE id = ?", [messageId]);
    this.saveToFile();
    return true;
  }

  /**
   * 清空对话的所有消息
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否清空成功
   */
  clearConversationMessages(conversationId) {
    this.db.run("DELETE FROM messages WHERE conversation_id = ?", [
      conversationId,
    ]);
    this.saveToFile();
    return true;
  }

  /**
   * 搜索消息
   * @param {Object} options - 搜索选项
   * @param {string} options.query - 搜索关键词
   * @param {string} [options.conversationId] - 对话ID（可选，限制在特定对话中搜索）
   * @param {string} [options.role] - 消息角色（可选，user/assistant/system）
   * @param {number} [options.limit] - 返回结果数量限制（默认50）
   * @param {number} [options.offset] - 偏移量（默认0）
   * @param {string} [options.order] - 排序方式（'ASC'或'DESC'，默认'DESC'）
   * @returns {Object} { messages: Array, total: number, hasMore: boolean }
   */
  searchMessages(options = {}) {
    const {
      query,
      conversationId,
      role,
      limit = 50,
      offset = 0,
      order = "DESC",
    } = options;

    if (!query || !query.trim()) {
      return { messages: [], total: 0, hasMore: false };
    }

    const searchPattern = `%${query.trim()}%`;
    const params = [searchPattern];
    const whereConditions = ["content LIKE ?"];

    // 添加对话ID过滤
    if (conversationId) {
      whereConditions.push("conversation_id = ?");
      params.push(conversationId);
    }

    // 添加角色过滤
    if (role) {
      whereConditions.push("role = ?");
      params.push(role);
    }

    // 构建查询SQL
    const whereClause = whereConditions.join(" AND ");
    const orderClause = order === "ASC" ? "ASC" : "DESC";

    // 查询消息
    const messagesQuery = `
      SELECT * FROM messages
      WHERE ${whereClause}
      ORDER BY timestamp ${orderClause}
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    const stmt = this.db.prepare(messagesQuery);
    const rawMessages = stmt.all(...params);

    // 反序列化metadata字段
    const messages = rawMessages.map((msg) => {
      if (msg.metadata) {
        try {
          msg.metadata = JSON.parse(msg.metadata);
        } catch (_e) {
          logger.warn("[Database] 无法解析消息metadata:", msg.id, _e);
          msg.metadata = null;
        }
      }
      // 向后兼容：如果没有message_type，根据role设置
      if (!msg.message_type) {
        if (msg.role === "user") {
          msg.message_type = "USER";
        } else if (msg.role === "assistant") {
          msg.message_type = "ASSISTANT";
        } else if (msg.role === "system") {
          msg.message_type = "SYSTEM";
        } else {
          msg.message_type = "ASSISTANT";
        }
      }
      return msg;
    });

    // 获取总数
    const countQuery = `
      SELECT COUNT(*) as total FROM messages
      WHERE ${whereClause}
    `;
    const countParams = params.slice(0, -2); // 移除limit和offset参数
    const countStmt = this.db.prepare(countQuery);
    const countResult = countStmt.get(...countParams);
    const total = countResult ? countResult.total : 0;

    return {
      messages,
      total,
      hasMore: offset + limit < total,
    };
  }

  // ==================== 系统配置管理 ====================

  /**
   * 初始化默认配置
   */
  initDefaultSettings() {
    const {
      initDefaultSettings: _initDefaultSettings,
    } = require("./database/database-settings");
    return _initDefaultSettings(this, logger);
  }

  /**
   * 获取单个配置项
   * @param {string} key - 配置键
   * @returns {any} 配置值
   */
  getSetting(key) {
    const { getSetting: _getSetting } = require("./database/database-settings");
    return _getSetting(this, logger, key);
  }

  /**
   * 获取所有配置
   * @returns {Object} 配置对象
   */
  getAllSettings() {
    const {
      getAllSettings: _getAllSettings,
    } = require("./database/database-settings");
    return _getAllSettings(this, logger);
  }

  /**
   * 设置单个配置项
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {boolean} 是否设置成功
   */
  setSetting(key, value) {
    const { setSetting: _setSetting } = require("./database/database-settings");
    return _setSetting(this, logger, key, value);
  }

  /**
   * 批量更新配置
   * @param {Object} config - 配置对象
   * @returns {boolean} 是否更新成功
   */
  updateSettings(config) {
    const {
      updateSettings: _updateSettings,
    } = require("./database/database-settings");
    return _updateSettings(this, logger, config);
  }

  /**
   * 删除配置项
   * @param {string} key - 配置键
   * @returns {boolean} 是否删除成功
   */
  deleteSetting(key) {
    const {
      deleteSetting: _deleteSetting,
    } = require("./database/database-settings");
    return _deleteSetting(this, logger, key);
  }

  /**
   * 重置所有配置为默认值
   * @returns {boolean} 是否重置成功
   */
  resetSettings() {
    const {
      resetSettings: _resetSettings,
    } = require("./database/database-settings");
    return _resetSettings(this, logger);
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
    throw new Error("数据库未初始化，请先调用 setDatabase()");
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

export { DatabaseManager, getDatabase, setDatabase };
