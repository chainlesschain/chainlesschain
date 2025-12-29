/**
 * SQLCipher 数据库包装器
 *
 * 提供与 sql.js 兼容的 API，使用 better-sqlite3-multiple-ciphers 实现
 * 支持 AES-256 加密
 */

const Database = require('better-sqlite3-multiple-ciphers');
const fs = require('fs');

/**
 * SQLCipher 配置
 */
const SQLCIPHER_CONFIG = {
  // SQLCipher 版本 (4.x)
  version: 4,
  // 页大小
  pageSize: 4096,
  // KDF 迭代次数
  kdfIterations: 256000,
  // HMAC算法
  hmacAlgorithm: 1, // HMAC_SHA1
  // KDF算法
  kdfAlgorithm: 2   // PBKDF2_HMAC_SHA512
};

/**
 * Statement 包装器类
 * 模拟 sql.js 的 Statement API
 */
class StatementWrapper {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.stmt = null;
    this._prepare();
  }

  _prepare() {
    try {
      this.stmt = this.db.prepare(this.sql);
    } catch (error) {
      throw new Error(`SQL prepare error: ${error.message}`);
    }
  }

  /**
   * 绑定参数并执行
   * @param {Array|Object} params - 参数
   * @returns {boolean} 是否有结果
   */
  bind(params) {
    if (!this.stmt) {
      throw new Error('Statement not prepared');
    }

    try {
      if (Array.isArray(params)) {
        this.stmt.bind(params);
      } else if (params && typeof params === 'object') {
        this.stmt.bind(params);
      }
      return true;
    } catch (error) {
      throw new Error(`Bind error: ${error.message}`);
    }
  }

  /**
   * 执行并获取单行
   * @param {Array|Object} params - 参数
   * @returns {Array|null}
   */
  get(params = []) {
    if (!this.stmt) {
      this._prepare();
    }

    try {
      const result = this.stmt.get(params);
      return result ? Object.values(result) : null;
    } catch (error) {
      throw new Error(`Get error: ${error.message}`);
    }
  }

  /**
   * 执行并获取所有行
   * @param {Array|Object} params - 参数
   * @returns {Array}
   */
  all(params = []) {
    if (!this.stmt) {
      this._prepare();
    }

    try {
      const results = this.stmt.all(params);
      // Return objects as-is for compatibility with PRAGMA queries
      // (e.g., PRAGMA table_info() returns objects with 'name' property)
      return results;
    } catch (error) {
      throw new Error(`All error: ${error.message}`);
    }
  }

  /**
   * 执行 (INSERT/UPDATE/DELETE)
   * @param {Array|Object} params - 参数
   * @returns {Object} 执行结果
   */
  run(params = []) {
    if (!this.stmt) {
      this._prepare();
    }

    try {
      const info = this.stmt.run(params);
      return {
        changes: info.changes,
        lastInsertRowid: info.lastInsertRowid
      };
    } catch (error) {
      throw new Error(`Run error: ${error.message}`);
    }
  }

  /**
   * 单步执行
   * @returns {boolean}
   */
  step() {
    // better-sqlite3 不需要 step，使用迭代器
    return false;
  }

  /**
   * 获取列名
   * @returns {Array<string>}
   */
  getColumnNames() {
    if (!this.stmt) {
      this._prepare();
    }
    return this.stmt.columns().map(col => col.name);
  }

  /**
   * 获取当前行
   * @returns {Array|null}
   */
  getAsObject() {
    // 这个方法在新版API中不常用，返回null
    return null;
  }

  /**
   * 重置语句
   */
  reset() {
    // better-sqlite3 会自动重置
  }

  /**
   * 释放语句
   */
  free() {
    if (this.stmt) {
      // better-sqlite3 语句会自动清理
      this.stmt = null;
    }
  }

  /**
   * 完成并释放
   */
  finalize() {
    this.free();
  }
}

/**
 * SQLCipher 数据库包装器类
 * 提供与 sql.js 兼容的 API
 */
class SQLCipherWrapper {
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath;
    this.options = options;
    this.db = null;
    this.key = options.key || null;
    this.__betterSqliteCompat = true; // 标记兼容性
  }

  /**
   * 打开数据库
   */
  open() {
    if (this.db) {
      return;
    }

    try {
      // 如果提供了密钥，使用加密模式创建数据库
      if (this.key) {
        // 使用未加密模式打开，然后立即设置密钥
        this.db = new Database(this.dbPath, this.options);
        this._setupEncryption(this.key);
      } else {
        // 未加密模式
        this.db = new Database(this.dbPath, this.options);
      }

      // 启用外键约束
      this.db.pragma('foreign_keys = ON');

      console.log('[SQLCipher] 数据库已打开:', this.dbPath);
    } catch (error) {
      throw new Error(`Failed to open database: ${error.message}`);
    }
  }

  /**
   * 设置数据库加密
   * @param {string} key - 十六进制格式的密钥
   */
  _setupEncryption(key) {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    try {
      // 设置加密密钥（使用 raw key）
      this.db.pragma(`key = "x'${key}'"`);

      // 配置 SQLCipher 参数
      this.db.pragma(`cipher_page_size = ${SQLCIPHER_CONFIG.pageSize}`);
      this.db.pragma(`kdf_iter = ${SQLCIPHER_CONFIG.kdfIterations}`);
      this.db.pragma(`cipher_hmac_algorithm = ${SQLCIPHER_CONFIG.hmacAlgorithm}`);
      this.db.pragma(`cipher_kdf_algorithm = ${SQLCIPHER_CONFIG.kdfAlgorithm}`);

      // 测试密钥是否正确（尝试读取schema）
      try {
        this.db.prepare('SELECT count(*) FROM sqlite_master').get();
      } catch (error) {
        throw new Error('Invalid encryption key or corrupted database');
      }

      console.log('[SQLCipher] 加密已启用');
    } catch (error) {
      throw new Error(`Encryption setup failed: ${error.message}`);
    }
  }

  /**
   * 准备 SQL 语句
   * @param {string} sql - SQL 语句
   * @returns {StatementWrapper}
   */
  prepare(sql) {
    if (!this.db) {
      this.open();
    }
    return new StatementWrapper(this.db, sql);
  }

  /**
   * 执行 SQL 语句（直接执行，不返回结果）
   * @param {string} sql - SQL 语句
   */
  exec(sql) {
    if (!this.db) {
      this.open();
    }

    try {
      this.db.exec(sql);
    } catch (error) {
      throw new Error(`Exec error: ${error.message}`);
    }
  }

  /**
   * 执行 SQL 语句（兼容 sql.js API）
   * @param {string} sql - SQL 语句
   * @param {Array} params - 参数
   * @returns {Array} 结果集
   */
  run(sql, params = []) {
    const stmt = this.prepare(sql);
    try {
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return [{ columns: stmt.getColumnNames(), values: stmt.all(params) }];
      } else {
        const result = stmt.run(params);
        return [{ columns: [], values: [[result.changes, result.lastInsertRowid]] }];
      }
    } finally {
      stmt.free();
    }
  }

  /**
   * 导出数据库到 Buffer
   * @returns {Buffer}
   */
  export() {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    try {
      // 关闭数据库以确保数据写入
      this.close();

      // 读取数据库文件
      const buffer = fs.readFileSync(this.dbPath);

      // 重新打开数据库
      this.open();

      return buffer;
    } catch (error) {
      throw new Error(`Export failed: ${error.message}`);
    }
  }

  /**
   * 获取原始数据库对象
   * @returns {Database}
   */
  getHandle() {
    if (!this.db) {
      this.open();
    }
    return this.db;
  }

  /**
   * 关闭数据库
   */
  close() {
    if (this.db) {
      try {
        this.db.close();
        this.db = null;
        console.log('[SQLCipher] 数据库已关闭');
      } catch (error) {
        console.error('[SQLCipher] 关闭数据库失败:', error);
      }
    }
  }

  /**
   * 重新设置密钥
   * @param {string} newKey - 新密钥（十六进制）
   */
  rekey(newKey) {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    try {
      this.db.pragma(`rekey = "x'${newKey}'"`);
      this.key = newKey;
      console.log('[SQLCipher] 数据库密钥已更新');
    } catch (error) {
      throw new Error(`Rekey failed: ${error.message}`);
    }
  }

  /**
   * 移除加密
   */
  removeEncryption() {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    try {
      this.db.pragma("rekey = ''");
      this.key = null;
      console.log('[SQLCipher] 数据库加密已移除');
    } catch (error) {
      throw new Error(`Remove encryption failed: ${error.message}`);
    }
  }

  /**
   * 创建备份
   * @param {string} backupPath - 备份文件路径
   */
  backup(backupPath) {
    if (!this.db) {
      throw new Error('Database not opened');
    }

    try {
      const backup = this.db.backup(backupPath);
      backup.step(-1); // 一次性完成备份
      backup.finish();
      console.log('[SQLCipher] 数据库备份完成:', backupPath);
    } catch (error) {
      throw new Error(`Backup failed: ${error.message}`);
    }
  }
}

/**
 * 创建加密数据库
 * @param {string} dbPath - 数据库路径
 * @param {string} key - 加密密钥（十六进制）
 * @param {Object} options - 其他选项
 * @returns {SQLCipherWrapper}
 */
function createEncryptedDatabase(dbPath, key, options = {}) {
  return new SQLCipherWrapper(dbPath, { ...options, key });
}

/**
 * 创建未加密数据库
 * @param {string} dbPath - 数据库路径
 * @param {Object} options - 其他选项
 * @returns {SQLCipherWrapper}
 */
function createUnencryptedDatabase(dbPath, options = {}) {
  return new SQLCipherWrapper(dbPath, options);
}

module.exports = {
  SQLCipherWrapper,
  StatementWrapper,
  createEncryptedDatabase,
  createUnencryptedDatabase,
  SQLCIPHER_CONFIG
};
