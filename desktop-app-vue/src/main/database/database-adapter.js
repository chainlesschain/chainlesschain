/**
 * 数据库适配器
 *
 * 提供统一的接口，自动选择 sql.js 或 SQLCipher
 * 支持平滑迁移和fallback
 */

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
  }

  /**
   * 检测应该使用哪个引擎
   * @returns {string} 引擎类型
   */
  detectEngine() {
    // 优先级：
    // 1. 如果存在 .encrypted 数据库 -> SQLCipher
    // 2. 如果启用加密 -> SQLCipher
    // 3. 否则 -> sql.js

    const encryptedDbPath = this.getEncryptedDbPath();

    if (fs.existsSync(encryptedDbPath)) {
      console.log('[DatabaseAdapter] 检测到加密数据库，使用 SQLCipher');
      return DatabaseEngine.SQLCIPHER;
    }

    if (this.encryptionEnabled) {
      console.log('[DatabaseAdapter] 加密已启用，使用 SQLCipher');
      return DatabaseEngine.SQLCIPHER;
    }

    console.log('[DatabaseAdapter] 使用 sql.js');
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
    console.log('[DatabaseAdapter] 初始化数据库适配器...');

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

    console.log('[DatabaseAdapter] 数据库适配器初始化完成，引擎:', this.engine);
  }

  /**
   * 初始化加密功能
   */
  async initializeEncryption() {
    console.log('[DatabaseAdapter] 初始化加密功能...');

    // 创建密钥管理器
    this.keyManager = new KeyManager({
      encryptionEnabled: this.encryptionEnabled,
      configPath: this.configPath
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
    console.log('[DatabaseAdapter] 开始自动迁移...');

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

      console.log('[DatabaseAdapter] 迁移完成:', migrationResult);
      return migrationResult;
    } catch (error) {
      console.error('[DatabaseAdapter] 迁移失败:', error);
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

    // 加载已保存的元数据
    const metadata = this.keyManager.loadKeyMetadata();

    return await this.keyManager.getOrCreateKey({
      password: this.password,
      pin: this.pin,
      salt: metadata ? metadata.salt : undefined
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

    console.log('[DatabaseAdapter] SQLCipher 数据库已创建');
    return db;
  }

  /**
   * 创建 sql.js 数据库
   */
  async createSqlJsDatabase() {
    const initSqlJs = require('sql.js');

    // 初始化 sql.js
    const SQL = await initSqlJs({
      locateFile: file => {
        const possiblePaths = [
          path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
          path.join(__dirname, '..', '..', '..', 'node_modules', 'sql.js', 'dist', file)
        ];

        for (const filePath of possiblePaths) {
          if (fs.existsSync(filePath)) {
            return filePath;
          }
        }
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

    console.log('[DatabaseAdapter] sql.js 数据库已创建');
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
        console.error('[DatabaseAdapter] 保存数据库失败:', error);
      }
    }
    // SQLCipher 会自动保存，不需要手动操作
  }

  /**
   * 关闭数据库适配器
   */
  async close() {
    console.log('[DatabaseAdapter] 关闭数据库适配器...');

    if (this.keyManager) {
      await this.keyManager.close();
    }

    console.log('[DatabaseAdapter] 数据库适配器已关闭');
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
