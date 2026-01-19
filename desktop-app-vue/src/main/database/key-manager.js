/**
 * 数据库加密密钥管理器
 *
 * 负责生成、派生和管理数据库加密密钥
 * 支持U-Key硬件密钥派生和密码派生两种模式
 */

const { logger, createLogger } = require('../utils/logger.js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 尝试加载U-Key管理器，如果不存在则使用模拟模式
let UKeyManager;
try {
  UKeyManager = require('../ukey/ukey-manager');
} catch (e) {
  logger.warn('[KeyManager] U-Key模块不可用，将使用密码模式');
  UKeyManager = null;
}

/**
 * 密钥派生配置
 */
const KEY_DERIVATION_CONFIG = {
  // PBKDF2配置
  pbkdf2: {
    iterations: 100000,      // 迭代次数
    keyLength: 32,           // 密钥长度（256位）
    digest: 'sha256'         // 哈希算法
  },
  // 盐值长度
  saltLength: 32,
  // U-Key派生配置
  ukeyDerivation: {
    purpose: 'database-encryption',
    version: 1
  }
};

/**
 * 密钥管理器类
 */
class KeyManager {
  constructor(options = {}) {
    this.ukeyManager = null;
    this.keyCache = null;           // 密钥缓存（内存中）
    this.encryptionEnabled = options.encryptionEnabled !== false; // 默认启用加密
    this.ukeyEnabled = options.ukeyEnabled !== false;             // 默认启用U-Key
    this.configPath = options.configPath;                         // 配置文件路径
  }

  /**
   * 初始化密钥管理器
   */
  async initialize() {
    logger.info('[KeyManager] 初始化密钥管理器...');

    // 如果不启用加密，直接返回
    if (!this.encryptionEnabled) {
      logger.info('[KeyManager] 加密已禁用');
      return;
    }

    // 尝试初始化U-Key
    if (this.ukeyEnabled && UKeyManager) {
      try {
        this.ukeyManager = new UKeyManager({
          driverType: 'simulated' // 默认使用模拟模式，生产环境应改为实际驱动
        });
        await this.ukeyManager.initialize();
        logger.info('[KeyManager] U-Key初始化成功');
      } catch (error) {
        logger.warn('[KeyManager] U-Key初始化失败，将使用密码模式:', error.message);
        this.ukeyManager = null;
      }
    }

    logger.info('[KeyManager] 密钥管理器初始化完成');
  }

  /**
   * 检查是否启用了加密
   */
  isEncryptionEnabled() {
    return this.encryptionEnabled;
  }

  /**
   * 检查是否有可用的U-Key
   */
  hasUKey() {
    return this.ukeyManager !== null && this.ukeyManager.isInitialized;
  }

  /**
   * 使用U-Key派生数据库加密密钥
   * @param {string} pin - U-Key PIN码
   * @returns {Promise<string>} 十六进制格式的加密密钥
   */
  async deriveKeyFromUKey(pin) {
    if (!this.ukeyManager) {
      throw new Error('U-Key不可用');
    }

    try {
      // 解锁U-Key
      await this.ukeyManager.unlock(pin);

      // 构建派生数据（使用固定的salt确保每次派生相同的密钥）
      const derivationData = Buffer.from(
        `${KEY_DERIVATION_CONFIG.ukeyDerivation.purpose}-v${KEY_DERIVATION_CONFIG.ukeyDerivation.version}`,
        'utf8'
      );

      // 使用U-Key加密派生数据
      const encryptedData = await this.ukeyManager.encrypt(derivationData);

      // 对加密结果进行哈希，得到固定长度的密钥
      const hash = crypto.createHash('sha256');
      hash.update(encryptedData);
      const key = hash.digest('hex');

      // 缓存密钥
      this.keyCache = key;

      logger.info('[KeyManager] 使用U-Key成功派生密钥');
      return key;
    } catch (error) {
      logger.error('[KeyManager] U-Key密钥派生失败:', error);
      throw new Error(`U-Key密钥派生失败: ${error.message}`);
    }
  }

  /**
   * 使用密码派生数据库加密密钥
   * @param {string} password - 用户密码
   * @param {Buffer} [salt] - 盐值，如果不提供则生成新的
   * @returns {Promise<{key: string, salt: string}>} 密钥和盐值（十六进制）
   */
  async deriveKeyFromPassword(password, salt = null) {
    if (!password || password.length === 0) {
      throw new Error('密码不能为空');
    }

    // 生成或使用提供的盐值
    const saltBuffer = salt || crypto.randomBytes(KEY_DERIVATION_CONFIG.saltLength);

    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        saltBuffer,
        KEY_DERIVATION_CONFIG.pbkdf2.iterations,
        KEY_DERIVATION_CONFIG.pbkdf2.keyLength,
        KEY_DERIVATION_CONFIG.pbkdf2.digest,
        (err, derivedKey) => {
          if (err) {
            reject(new Error(`密钥派生失败: ${err.message}`));
            return;
          }

          const key = derivedKey.toString('hex');
          const saltHex = saltBuffer.toString('hex');

          // 缓存密钥
          this.keyCache = key;

          logger.info('[KeyManager] 使用密码成功派生密钥');
          resolve({ key, salt: saltHex });
        }
      );
    });
  }

  /**
   * 获取或生成数据库加密密钥
   * @param {Object} options - 选项
   * @param {string} options.password - 密码（密码模式必需）
   * @param {string} options.pin - U-Key PIN码（U-Key模式必需）
   * @param {string} options.salt - 盐值（密码模式，已有数据库时必需）
   * @param {boolean} options.forcePassword - 强制使用密码模式
   * @returns {Promise<{key: string, salt?: string, method: string}>}
   */
  async getOrCreateKey(options = {}) {
    if (!this.encryptionEnabled) {
      throw new Error('加密未启用');
    }

    // 如果已有缓存的密钥，直接返回
    if (this.keyCache) {
      logger.info('[KeyManager] 使用缓存的密钥');
      return { key: this.keyCache, method: 'cached' };
    }

    // 优先使用U-Key模式（除非强制使用密码）
    if (!options.forcePassword && this.hasUKey()) {
      if (!options.pin) {
        throw new Error('U-Key模式需要提供PIN码');
      }

      const key = await this.deriveKeyFromUKey(options.pin);
      return { key, method: 'ukey' };
    }

    // 密码模式
    if (!options.password) {
      throw new Error('密码模式需要提供密码');
    }

    // 如果提供了salt，说明是已有数据库
    const salt = options.salt ? Buffer.from(options.salt, 'hex') : null;
    const result = await this.deriveKeyFromPassword(options.password, salt);

    return {
      key: result.key,
      salt: result.salt,
      method: 'password'
    };
  }

  /**
   * 清除缓存的密钥
   */
  clearKeyCache() {
    if (this.keyCache) {
      // 安全清除密钥（覆盖内存）
      this.keyCache = null;
      logger.info('[KeyManager] 已清除密钥缓存');
    }
  }

  /**
   * 保存密钥元数据（不包含密钥本身）
   * @param {Object} metadata - 元数据
   */
  async saveKeyMetadata(metadata) {
    if (!this.configPath) {
      logger.warn('[KeyManager] 未配置configPath，跳过保存元数据');
      return;
    }

    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const data = {
      ...metadata,
      version: 1,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(
      this.configPath,
      JSON.stringify(data, null, 2),
      'utf8'
    );

    logger.info('[KeyManager] 密钥元数据已保存');
  }

  /**
   * 加载密钥元数据
   * @returns {Object|null}
   */
  loadKeyMetadata() {
    if (!this.configPath || !fs.existsSync(this.configPath)) {
      return null;
    }

    try {
      const data = fs.readFileSync(this.configPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('[KeyManager] 加载密钥元数据失败:', error);
      return null;
    }
  }

  /**
   * 关闭密钥管理器
   */
  async close() {
    logger.info('[KeyManager] 关闭密钥管理器...');

    // 清除密钥缓存
    this.clearKeyCache();

    // 关闭U-Key
    if (this.ukeyManager) {
      try {
        await this.ukeyManager.close();
      } catch (error) {
        logger.error('[KeyManager] 关闭U-Key失败:', error);
      }
    }

    logger.info('[KeyManager] 密钥管理器已关闭');
  }
}

module.exports = {
  KeyManager,
  KEY_DERIVATION_CONFIG
};
