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

    // 启用 WAL 模式以提高并发性能；busy_timeout 让 SQLite 自身等待锁
    // 释放（30s 内核级 spin/sleep），优先于 ErrorMonitor 的应用级重试。
    // 没这一行时大部分写并发会立刻抛 SQLITE_BUSY，给 retry 路径制造噪音。
    if (this.db.pragma) {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("busy_timeout = 30000");
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

    // 启用 WAL 模式以提高并发性能（含 busy_timeout 内核级等待）
    if (this.db.pragma) {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("busy_timeout = 30000");
      this.db.pragma("foreign_keys = ON");
    } else if (this.db.run) {
      this.db.run("PRAGMA journal_mode = WAL");
      this.db.run("PRAGMA synchronous = NORMAL");
      this.db.run("PRAGMA busy_timeout = 30000");
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
    const {
      getKnowledgeItems: _getKnowledgeItems,
    } = require("./database/database-knowledge");
    return _getKnowledgeItems(this, logger, (limit = 100), (offset = 0));
  }

  /**
   * 根据ID获取知识库项
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItemById(id) {
    const {
      getKnowledgeItemById: _getKnowledgeItemById,
    } = require("./database/database-knowledge");
    return _getKnowledgeItemById(this, logger, id);
  }

  /**
   * 根据ID获取知识库项（别名）
   * @param {string} id - 项目ID
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItem(id) {
    const {
      getKnowledgeItem: _getKnowledgeItem,
    } = require("./database/database-knowledge");
    return _getKnowledgeItem(this, logger, id);
  }

  /**
   * 根据标题获取知识库项
   * @param {string} title - 标题
   * @returns {Object|null} 知识库项
   */
  getKnowledgeItemByTitle(title) {
    const {
      getKnowledgeItemByTitle: _getKnowledgeItemByTitle,
    } = require("./database/database-knowledge");
    return _getKnowledgeItemByTitle(this, logger, title);
  }

  /**
   * 获取所有知识库项（无限制）
   * @returns {Array} 知识库项列表
   */
  getAllKnowledgeItems() {
    const {
      getAllKnowledgeItems: _getAllKnowledgeItems,
    } = require("./database/database-knowledge");
    return _getAllKnowledgeItems(this, logger);
  }

  /**
   * 添加知识库项
   * @param {Object} item - 知识库项数据
   * @returns {Object} 创建的项目
   */
  addKnowledgeItem(item) {
    const {
      addKnowledgeItem: _addKnowledgeItem,
    } = require("./database/database-knowledge");
    return _addKnowledgeItem(this, logger, item);
  }

  /**
   * 更新知识库项
   * @param {string} id - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的项目
   */
  updateKnowledgeItem(id, updates) {
    const {
      updateKnowledgeItem: _updateKnowledgeItem,
    } = require("./database/database-knowledge");
    return _updateKnowledgeItem(this, logger, id, updates);
  }

  /**
   * 删除知识库项
   * @param {string} id - 项目ID
   * @returns {boolean} 是否删除成功
   */
  deleteKnowledgeItem(id) {
    const {
      deleteKnowledgeItem: _deleteKnowledgeItem,
    } = require("./database/database-knowledge");
    return _deleteKnowledgeItem(this, logger, id);
  }

  // ==================== 搜索功能 ====================

  /**
   * 搜索知识库项
   * @param {string} query - 搜索关键词
   * @returns {Array} 搜索结果
   */
  searchKnowledge(query) {
    const {
      searchKnowledge: _searchKnowledge,
    } = require("./database/database-knowledge");
    return _searchKnowledge(this, logger, query);
  }

  /**
   * 更新搜索索引
   * @param {string} id - 项目ID
   * @param {string} title - 标题
   * @param {string} content - 内容
   */
  updateSearchIndex(id, title, content) {
    const {
      updateSearchIndex: _updateSearchIndex,
    } = require("./database/database-knowledge");
    return _updateSearchIndex(this, logger, id, title, content);
  }

  // ==================== 标签操作 ====================

  /**
   * 获取所有标签
   * @returns {Array} 标签列表
   */
  getAllTags() {
    const {
      getAllTags: _getAllTags,
    } = require("./database/database-knowledge");
    return _getAllTags(this, logger);
  }

  /**
   * 创建标签
   * @param {string} name - 标签名
   * @param {string} color - 颜色
   * @returns {Object} 创建的标签
   */
  createTag(name, color = "#1890ff") {
    const { createTag: _createTag } = require("./database/database-knowledge");
    return _createTag(this, logger, name, (color = "#1890ff"));
  }

  /**
   * 为知识库项添加标签
   * @param {string} knowledgeId - 知识库项ID
   * @param {string} tagId - 标签ID
   */
  addTagToKnowledge(knowledgeId, tagId) {
    const {
      addTagToKnowledge: _addTagToKnowledge,
    } = require("./database/database-knowledge");
    return _addTagToKnowledge(this, logger, knowledgeId, tagId);
  }

  /**
   * 获取知识库项的标签
   * @param {string} knowledgeId - 知识库项ID
   * @returns {Array} 标签列表
   */
  getKnowledgeTags(knowledgeId) {
    const {
      getKnowledgeTags: _getKnowledgeTags,
    } = require("./database/database-knowledge");
    return _getKnowledgeTags(this, logger, knowledgeId);
  }

  // ==================== 统计功能 ====================

  /**
   * 获取统计数据
   * @returns {Object} 统计信息
   */
  getStatistics() {
    const {
      getStatistics: _getStatistics,
    } = require("./database/database-knowledge");
    return _getStatistics(this, logger);
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
    const {
      softDelete: _softDelete,
    } = require("./database/database-soft-delete");
    return _softDelete(this, logger, tableName, id);
  }

  /**
   * 批量软删除记录
   * @param {string} tableName - 表名
   * @param {Array<string>} ids - 记录ID列表
   * @returns {Object} 删除结果统计 {success: number, failed: number}
   */
  batchSoftDelete(tableName, ids) {
    const {
      batchSoftDelete: _batchSoftDelete,
    } = require("./database/database-soft-delete");
    return _batchSoftDelete(this, logger, tableName, ids);
  }

  /**
   * 恢复软删除的记录
   * @param {string} tableName - 表名
   * @param {string} id - 记录ID
   * @returns {boolean} 是否成功
   */
  restoreSoftDeleted(tableName, id) {
    const {
      restoreSoftDeleted: _restoreSoftDeleted,
    } = require("./database/database-soft-delete");
    return _restoreSoftDeleted(this, logger, tableName, id);
  }

  /**
   * 物理删除软删除的记录（永久删除）
   * @param {string} tableName - 表名
   * @param {number} olderThanDays - 删除多少天前的记录（默认30天）
   * @returns {Object} 清理结果 {deleted: number, tableName: string}
   */
  cleanupSoftDeleted(tableName, olderThanDays = 30) {
    const {
      cleanupSoftDeleted: _cleanupSoftDeleted,
    } = require("./database/database-soft-delete");
    return _cleanupSoftDeleted(this, logger, tableName, (olderThanDays = 30));
  }

  /**
   * 清理所有表的软删除记录
   * @param {number} olderThanDays - 删除多少天前的记录（默认30天）
   * @returns {Array<Object>} 清理结果列表
   */
  cleanupAllSoftDeleted(olderThanDays = 30) {
    const {
      cleanupAllSoftDeleted: _cleanupAllSoftDeleted,
    } = require("./database/database-soft-delete");
    return _cleanupAllSoftDeleted(this, logger, (olderThanDays = 30));
  }

  /**
   * 获取软删除记录的统计信息
   * @returns {Object} 统计信息 {total: number, byTable: Object}
   */
  getSoftDeletedStats() {
    const {
      getSoftDeletedStats: _getSoftDeletedStats,
    } = require("./database/database-soft-delete");
    return _getSoftDeletedStats(this, logger);
  }

  /**
   * 启动定期清理任务
   * @param {number} intervalHours - 清理间隔（小时，默认24小时）
   * @param {number} retentionDays - 保留天数（默认30天）
   * @returns {Object} 定时器对象
   */
  startPeriodicCleanup(intervalHours = 24, retentionDays = 30) {
    const {
      startPeriodicCleanup: _startPeriodicCleanup,
    } = require("./database/database-soft-delete");
    return _startPeriodicCleanup(
      this,
      logger,
      (intervalHours = 24),
      (retentionDays = 30),
    );
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
    const { addRelation: _addRelation } = require("./database/database-graph");
    return _addRelation(
      this,
      logger,
      sourceId,
      targetId,
      type,
      (weight = 1.0),
      (metadata = null),
    );
  }

  /**
   * 批量添加知识关系
   * @param {Array} relations - 关系数组
   * @returns {number} 添加的关系数量
   */
  addRelations(relations) {
    const {
      addRelations: _addRelations,
    } = require("./database/database-graph");
    return _addRelations(this, logger, relations);
  }

  /**
   * 删除指定笔记的关系
   * @param {string} noteId - 笔记ID
   * @param {Array<string>} types - 要删除的关系类型列表，如 ['link', 'semantic']。空数组则删除所有类型
   * @returns {number} 删除的关系数量
   */
  deleteRelations(noteId, types = []) {
    const {
      deleteRelations: _deleteRelations,
    } = require("./database/database-graph");
    return _deleteRelations(this, logger, noteId, (types = []));
  }

  /**
   * 获取图谱数据
   * @param {object} options - 查询选项
   * @returns {object} { nodes, edges }
   */
  getGraphData(options = {}) {
    const {
      getGraphData: _getGraphData,
    } = require("./database/database-graph");
    return _getGraphData(this, logger, (options = {}));
  }

  /**
   * 获取笔记的所有关系
   * @param {string} knowledgeId - 笔记ID
   * @returns {Array} 关系列表
   */
  getKnowledgeRelations(knowledgeId) {
    const {
      getKnowledgeRelations: _getKnowledgeRelations,
    } = require("./database/database-graph");
    return _getKnowledgeRelations(this, logger, knowledgeId);
  }

  /**
   * 查找两个笔记之间的关系路径（BFS）
   * @param {string} sourceId - 源笔记ID
   * @param {string} targetId - 目标笔记ID
   * @param {number} maxDepth - 最大搜索深度
   * @returns {object|null} 路径信息
   */
  findRelationPath(sourceId, targetId, maxDepth = 3) {
    const {
      findRelationPath: _findRelationPath,
    } = require("./database/database-graph");
    return _findRelationPath(this, logger, sourceId, targetId, (maxDepth = 3));
  }

  /**
   * 获取笔记的邻居节点（一度或多度关系）
   * @param {string} knowledgeId - 笔记ID
   * @param {number} depth - 深度
   * @returns {object} { nodes, edges }
   */
  getKnowledgeNeighbors(knowledgeId, depth = 1) {
    const {
      getKnowledgeNeighbors: _getKnowledgeNeighbors,
    } = require("./database/database-graph");
    return _getKnowledgeNeighbors(this, logger, knowledgeId, (depth = 1));
  }

  /**
   * 构建标签关系
   * 为共享标签的笔记建立关系
   * @returns {number} 创建的关系数量
   */
  buildTagRelations() {
    const {
      buildTagRelations: _buildTagRelations,
    } = require("./database/database-graph");
    return _buildTagRelations(this, logger);
  }

  /**
   * 构建时间序列关系
   * @param {number} windowDays - 时间窗口（天）
   * @returns {number} 创建的关系数量
   */
  buildTemporalRelations(windowDays = 7) {
    const {
      buildTemporalRelations: _buildTemporalRelations,
    } = require("./database/database-graph");
    return _buildTemporalRelations(this, logger, (windowDays = 7));
  }

  // ==================== 项目管理操作 ====================

  /**
   * 获取所有项目
   * @param {string} userId - 用户ID
   * @returns {Array} 项目列表
   */
  getProjects(userId, options = {}) {
    const {
      getProjects: _getProjects,
    } = require("./database/database-projects");
    return _getProjects(this, logger, userId, (options = {}));
  }

  /**
   * 获取项目总数
   * @param {string} userId - 用户ID
   * @returns {number} 项目总数
   */
  getProjectsCount(userId) {
    const {
      getProjectsCount: _getProjectsCount,
    } = require("./database/database-projects");
    return _getProjectsCount(this, logger, userId);
  }

  /**
   * 调试：获取数据库统计信息
   * @returns {Object} 数据库统计信息
   */
  getDatabaseStats() {
    const {
      getDatabaseStats: _getDatabaseStats,
    } = require("./database/database-projects");
    return _getDatabaseStats(this, logger);
  }

  /**
   * 根据ID获取项目
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 项目
   */
  getProjectById(projectId) {
    const {
      getProjectById: _getProjectById,
    } = require("./database/database-projects");
    return _getProjectById(this, logger, projectId);
  }

  /**
   * 保存项目
   * @param {Object} project - 项目数据
   * @returns {Object} 保存的项目
   */
  saveProject(project) {
    const {
      saveProject: _saveProject,
    } = require("./database/database-projects");
    return _saveProject(this, logger, project);
  }

  /**
   * 更新项目
   * @param {string} projectId - 项目ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的项目
   */
  updateProject(projectId, updates) {
    const {
      updateProject: _updateProject,
    } = require("./database/database-projects");
    return _updateProject(this, logger, projectId, updates);
  }

  /**
   * 删除项目
   * @param {string} projectId - 项目ID
   * @returns {boolean} 是否删除成功
   */
  deleteProject(projectId) {
    const {
      deleteProject: _deleteProject,
    } = require("./database/database-projects");
    return _deleteProject(this, logger, projectId);
  }

  /**
   * 获取项目文件列表
   * @param {string} projectId - 项目ID
   * @returns {Array} 文件列表
   */
  getProjectFiles(projectId) {
    const {
      getProjectFiles: _getProjectFiles,
    } = require("./database/database-projects");
    return _getProjectFiles(this, logger, projectId);
  }

  /**
   * 保存项目文件
   * @param {string} projectId - 项目ID
   * @param {Array} files - 文件列表
   */
  saveProjectFiles(projectId, files) {
    const {
      saveProjectFiles: _saveProjectFiles,
    } = require("./database/database-projects");
    return _saveProjectFiles(this, logger, projectId, files);
  }

  /**
   * 更新单个文件
   * @param {Object} fileUpdate - 文件更新数据
   */
  updateProjectFile(fileUpdate) {
    const {
      updateProjectFile: _updateProjectFile,
    } = require("./database/database-projects");
    return _updateProjectFile(this, logger, fileUpdate);
  }

  // ==================== 对话管理操作 ====================

  /**
   * 创建对话
   * @param {Object} conversationData - 对话数据
   * @returns {Object} 创建的对话
   */
  createConversation(conversationData) {
    const {
      createConversation: _createConversation,
    } = require("./database/database-conversations");
    return _createConversation(this, logger, conversationData);
  }

  /**
   * 根据ID获取对话
   * @param {string} conversationId - 对话ID
   * @returns {Object|null} 对话对象
   */
  getConversationById(conversationId) {
    const {
      getConversationById: _getConversationById,
    } = require("./database/database-conversations");
    return _getConversationById(this, logger, conversationId);
  }

  /**
   * 根据项目ID获取对话
   * @param {string} projectId - 项目ID
   * @returns {Object|null} 对话对象
   */
  getConversationByProject(projectId) {
    const {
      getConversationByProject: _getConversationByProject,
    } = require("./database/database-conversations");
    return _getConversationByProject(this, logger, projectId);
  }

  /**
   * 获取所有对话
   * @param {Object} options - 查询选项
   * @returns {Array} 对话列表
   */
  getConversations(options = {}) {
    const {
      getConversations: _getConversations,
    } = require("./database/database-conversations");
    return _getConversations(this, logger, (options = {}));
  }

  /**
   * 更新对话
   * @param {string} conversationId - 对话ID
   * @param {Object} updates - 更新数据
   * @returns {Object|null} 更新后的对话
   */
  updateConversation(conversationId, updates) {
    const {
      updateConversation: _updateConversation,
    } = require("./database/database-conversations");
    return _updateConversation(this, logger, conversationId, updates);
  }

  /**
   * 删除对话
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否删除成功
   */
  deleteConversation(conversationId) {
    const {
      deleteConversation: _deleteConversation,
    } = require("./database/database-conversations");
    return _deleteConversation(this, logger, conversationId);
  }

  /**
   * 创建消息
   * @param {Object} messageData - 消息数据
   * @returns {Object} 创建的消息
   */
  createMessage(messageData) {
    const {
      createMessage: _createMessage,
    } = require("./database/database-conversations");
    return _createMessage(this, logger, messageData);
  }

  /**
   * 根据ID获取消息
   * @param {string} messageId - 消息ID
   * @returns {Object|null} 消息对象
   */
  getMessageById(messageId) {
    const {
      getMessageById: _getMessageById,
    } = require("./database/database-conversations");
    return _getMessageById(this, logger, messageId);
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
    const {
      getMessagesByConversation: _getMessagesByConversation,
    } = require("./database/database-conversations");
    return _getMessagesByConversation(
      this,
      logger,
      conversationId,
      (options = {}),
    );
  }

  /**
   * 删除消息
   * @param {string} messageId - 消息ID
   * @returns {boolean} 是否删除成功
   */
  deleteMessage(messageId) {
    const {
      deleteMessage: _deleteMessage,
    } = require("./database/database-conversations");
    return _deleteMessage(this, logger, messageId);
  }

  /**
   * 清空对话的所有消息
   * @param {string} conversationId - 对话ID
   * @returns {boolean} 是否清空成功
   */
  clearConversationMessages(conversationId) {
    const {
      clearConversationMessages: _clearConversationMessages,
    } = require("./database/database-conversations");
    return _clearConversationMessages(this, logger, conversationId);
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
      searchMessages: _searchMessages,
    } = require("./database/database-conversations");
    return _searchMessages(this, logger, (options = {}));
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
