/**
 * 数据库适配器
 *
 * 提供统一的接口，自动选择 sql.js 或 SQLCipher
 * 支持平滑迁移和fallback
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');
const { KeyManager } = require('./key-manager');
const { createEncryptedDatabase, createUnencryptedDatabase } = require('./sqlcipher-wrapper');
const { migrateDatabase } = require('./database-migration');

/**
 * 数据库引擎类型
 */
const DatabaseEngine = {
  SQL_JS: 'sql.js',
  SQLCIPHER: 'sqlcipher'
};

/**
 * 数据库适配器类
 */
class DatabaseAdapter {
  constructor(options = {}) {
    this.dbPath = options.dbPath;
    this.engine = null;                    // 当前使用的引擎
    this.keyManager = null;               // 密钥管理器
    this.encryptionEnabled = options.encryptionEnabled !== false; // 默认启用加密
    this.autoMigrate = options.autoMigrate !== false;            // 默认自动迁移
    this.pin = options.pin;               // U-Key PIN码
    this.password = options.password;     // 密码
    this.configPath = options.configPath; // 配置文件路径
    this.developmentMode = this.isDevelopmentMode(); // 开发模式标志
  }

  /**
   * 检查是否为开发模式
   */
  isDevelopmentMode() {
    return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  }

  /**
   * 获取开发模式默认密码
   */
  getDevDefaultPassword() {
    return process.env.DEV_DB_PASSWORD || 'dev_password_2024';
  }

  /**
   * 检测应该使用哪个引擎
   * @returns {string} 引擎类型
   */
  detectEngine() {
    // 优先级：
    // 1. 如果存在 .encrypted 数据库 -> SQLCipher
    // 2. 开发模式且没有密码 -> sql.js（跳过加密）
    // 3. 如果启用加密 -> SQLCipher
    // 4. 否则 -> sql.js

    const encryptedDbPath = this.getEncryptedDbPath();

    if (fs.existsSync(encryptedDbPath)) {
      logger.info('[DatabaseAdapter] 检测到加密数据库，使用 SQLCipher');
      return DatabaseEngine.SQLCIPHER;
    }

    // 开发模式：如果没有密码，直接使用 sql.js
    if (this.developmentMode && !this.password) {
      logger.info('[DatabaseAdapter] 开发模式且未设置密码，使用 sql.js（跳过加密）');
      return DatabaseEngine.SQL_JS;
    }

    if (this.encryptionEnabled) {
      logger.info('[DatabaseAdapter] 加密已启用，使用 SQLCipher');
      return DatabaseEngine.SQLCIPHER;
    }

    logger.info('[DatabaseAdapter] 使用 sql.js');
    return DatabaseEngine.SQL_JS;
  }

  /**
   * 获取加密数据库路径
   * @returns {string}
   */
  getEncryptedDbPath() {
    const ext = path.extname(this.dbPath);
    const base = this.dbPath.substring(0, this.dbPath.length - ext.length);
    return `${base}.encrypted${ext}`;
  }

  /**
   * 初始化适配器
   */
  async initialize() {
    logger.info('[DatabaseAdapter] 初始化数据库适配器...');

    // 1. 检测引擎
    this.engine = this.detectEngine();

    // 2. 如果需要SQLCipher，初始化密钥管理器
    if (this.engine === DatabaseEngine.SQLCIPHER) {
      await this.initializeEncryption();

      // 3. 检查是否需要迁移
      if (this.autoMigrate && this.shouldMigrate()) {
        await this.performMigration();
      }
    }

    logger.info('[DatabaseAdapter] 数据库适配器初始化完成，引擎:', this.engine);
  }

  /**
   * 初始化加密功能
   */
  async initializeEncryption() {
    logger.info('[DatabaseAdapter] 初始化加密功能...');

    // 创建密钥管理器
    // 注意：如果提供了密码，禁用U-Key以使用密码模式
    this.keyManager = new KeyManager({
      encryptionEnabled: this.encryptionEnabled,
      configPath: this.configPath,
      ukeyEnabled: this.password ? false : true // 有密码时禁用U-Key
    });

    await this.keyManager.initialize();
  }

  /**
   * 检查是否需要迁移
   * @returns {boolean}
   */
  shouldMigrate() {
    const encryptedDbPath = this.getEncryptedDbPath();

    // 条件：原数据库存在 && 加密数据库不存在
    return fs.existsSync(this.dbPath) && !fs.existsSync(encryptedDbPath);
  }

  /**
   * 执行数据库迁移
   */
  async performMigration() {
    logger.info('[DatabaseAdapter] 开始自动迁移...');

    try {
      // 获取加密密钥
      const keyResult = await this.getEncryptionKey();

      // 保存密钥元数据
      await this.keyManager.saveKeyMetadata({
        method: keyResult.method,
        salt: keyResult.salt,
        encryptionEnabled: true
      });

      // 执行迁移
      const migrationResult = await migrateDatabase({
        sourcePath: this.dbPath,
        targetPath: this.getEncryptedDbPath(),
        encryptionKey: keyResult.key
      });

      logger.info('[DatabaseAdapter] 迁移完成:', migrationResult);
      return migrationResult;
    } catch (error) {
      logger.error('[DatabaseAdapter] 迁移失败:', error);
      throw error;
    }
  }

  /**
   * 获取加密密钥
   * @returns {Promise<Object>}
   */
  async getEncryptionKey() {
    if (!this.keyManager) {
      throw new Error('密钥管理器未初始化');
    }

    // 开发模式：如果没有提供密码，使用默认密码
    let effectivePassword = this.password;
    if (this.developmentMode && !effectivePassword) {
      effectivePassword = this.getDevDefaultPassword();
      logger.info('[DatabaseAdapter] 开发模式：使用默认密码');
    }

    // 加载已保存的元数据
    const metadata = this.keyManager.loadKeyMetadata();

    return await this.keyManager.getOrCreateKey({
      password: effectivePassword,
      pin: this.pin,
      salt: metadata ? metadata.salt : undefined,
      forcePassword: effectivePassword ? true : false // 有密码时强制使用密码模式
    });
  }

  /**
   * 创建数据库实例
   * @returns {Object} 数据库实例（sql.js 或 SQLCipher）
   */
  async createDatabase() {
    if (this.engine === DatabaseEngine.SQLCIPHER) {
      return await this.createSQLCipherDatabase();
    } else {
      return await this.createSqlJsDatabase();
    }
  }

  /**
   * 创建 SQLCipher 数据库
   */
  async createSQLCipherDatabase() {
    const encryptedDbPath = this.getEncryptedDbPath();

    // 获取密钥
    const keyResult = await this.getEncryptionKey();

    // 创建数据库
    const db = createEncryptedDatabase(encryptedDbPath, keyResult.key);
    db.open();

    logger.info('[DatabaseAdapter] SQLCipher 数据库已创建');
    return db;
  }

  /**
   * 创建 sql.js 数据库
   */
  async createSqlJsDatabase() {
    let initSqlJs;
    try {
      initSqlJs = require('sql.js');
    } catch (err) {
      throw new Error('sql.js is not available. Please use better-sqlite3 instead.');
    }

    // 初始化 sql.js
    const SQL = await initSqlJs({
      locateFile: file => {
        const possiblePaths = [
          path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
          path.join(process.cwd(), 'desktop-app-vue', 'node_modules', 'sql.js', 'dist', file),
          path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file),
          path.join(__dirname, '..', '..', '..', '..', 'node_modules', 'sql.js', 'dist', file)
        ];

        for (const filePath of possiblePaths) {
          if (fs.existsSync(filePath)) {
            logger.info('[DatabaseAdapter] Found sql.js WASM at:', filePath);
            return filePath;
          }
        }
        logger.error('[DatabaseAdapter] Could not find sql.js WASM file. Tried:', possiblePaths);
        return file;
      }
    });

    // 加载或创建数据库
    let db;
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }

    logger.info('[DatabaseAdapter] sql.js 数据库已创建');
    return db;
  }

  /**
   * 保存数据库（sql.js 专用）
   * @param {Object} db - 数据库实例
   */
  saveDatabase(db) {
    if (this.engine === DatabaseEngine.SQL_JS && db.export) {
      try {
        const data = db.export();
        const buffer = Buffer.from(data);

        // 确保目录存在
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }

        fs.writeFileSync(this.dbPath, buffer);
      } catch (error) {
        logger.error('[DatabaseAdapter] 保存数据库失败:', error);
      }
    }
    // SQLCipher 会自动保存，不需要手动操作
  }

  /**
   * 关闭数据库适配器
   */
  async close() {
    logger.info('[DatabaseAdapter] 关闭数据库适配器...');

    if (this.keyManager) {
      await this.keyManager.close();
    }

    logger.info('[DatabaseAdapter] 数据库适配器已关闭');
  }

  /**
   * 获取当前引擎类型
   */
  getEngine() {
    return this.engine;
  }

  /**
   * 是否使用加密
   */
  isEncrypted() {
    return this.engine === DatabaseEngine.SQLCIPHER;
  }

  /**
   * 修改数据库加密密码
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   * @param {Object} db - 数据库实例
   * @returns {Promise<Object>} 修改结果
   */
  async changePassword(oldPassword, newPassword, db) {
    if (!this.isEncrypted()) {
      throw new Error('数据库未使用加密，无法修改密码');
    }

    if (!this.keyManager) {
      throw new Error('密钥管理器未初始化');
    }

    try {
      // 1. 验证旧密码
      const oldKeyResult = await this.keyManager.getOrCreateKey({
        password: oldPassword,
        forcePassword: true
      });

      // 验证旧密钥是否正确（通过尝试读取数据库）
      const testDb = createEncryptedDatabase(this.getEncryptedDbPath(), oldKeyResult.key);
      try {
        testDb.open();
        testDb.prepare('SELECT count(*) FROM sqlite_master').get();
        testDb.close();
      } catch (error) {
        throw new Error('旧密码验证失败');
      }

      // 2. 生成新密钥
      const newKeyResult = await this.keyManager.deriveKeyFromPassword(newPassword);

      // 3. 使用 rekey 修改数据库密钥
      if (db && db.rekey) {
        db.rekey(newKeyResult.key);
      } else {
        throw new Error('数据库实例不支持密钥修改');
      }

      // 4. 更新密钥元数据
      await this.keyManager.saveKeyMetadata({
        method: 'password',
        salt: newKeyResult.salt,
        encryptionEnabled: true
      });

      // 5. 更新当前密码
      this.password = newPassword;

      logger.info('[DatabaseAdapter] 数据库密码修改成功');
      return {
        success: true,
        message: '密码修改成功'
      };
    } catch (error) {
      logger.error('[DatabaseAdapter] 密码修改失败:', error);
      throw error;
    }
  }
}

/**
 * 创建数据库适配器实例
 * @param {Object} options - 选项
 * @returns {Promise<DatabaseAdapter>}
 */
async function createDatabaseAdapter(options) {
  const adapter = new DatabaseAdapter(options);
  await adapter.initialize();
  return adapter;
}

module.exports = {
  DatabaseAdapter,
  DatabaseEngine,
  createDatabaseAdapter
};
