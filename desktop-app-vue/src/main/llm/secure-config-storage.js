/**
 * 安全配置存储模块
 *
 * 提供三层加密策略：
 * 1. Electron safeStorage (操作系统凭证存储 - 最安全)
 * 2. AES-256-GCM + 机器特征派生密钥 (后备方案)
 * 3. 基于密码的加密 (用于导出/迁移)
 *
 * @module secure-config-storage
 */

const { logger } = require("../utils/logger.js");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const os = require("os");

// 加密算法配置
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// 存储版本（用于未来迁移）
const STORAGE_VERSION = 2;

/**
 * 敏感配置字段列表 - 支持14+个LLM提供商
 */
const SENSITIVE_FIELDS = [
  // 主要国际提供商
  "openai.apiKey",
  "anthropic.apiKey",
  "deepseek.apiKey",
  "google.apiKey", // Google AI / Gemini
  "cohere.apiKey", // Cohere
  "mistral.apiKey", // Mistral AI

  // 国内主要提供商
  "volcengine.apiKey", // 豆包（火山引擎）
  "dashscope.apiKey", // 阿里云通义千问
  "zhipuai.apiKey", // 智谱AI GLM
  "baidu.apiKey", // 百度千帆
  "baidu.secretKey", // 百度千帆 Secret Key
  "moonshot.apiKey", // 月之暗面 Kimi
  "minimax.apiKey", // MiniMax
  "minimax.groupId", // MiniMax Group ID
  "xunfei.apiKey", // 讯飞星火
  "xunfei.apiSecret", // 讯飞星火 Secret
  "xunfei.appId", // 讯飞星火 App ID
  "stepfun.apiKey", // 阶跃星辰
  "yi.apiKey", // 零一万物
  "baichuan.apiKey", // 百川智能
  "sensenova.apiKey", // 商汤日日新

  // 自定义和代理
  "custom.apiKey",
  "custom.apiSecret",
  "proxy.password", // 代理认证密码

  // 嵌入服务
  "embedding.apiKey",
  "embedding.secretKey",

  // MCP服务器凭证
  "mcp.postgres.password",
  "mcp.mysql.password",
  "mcp.redis.password",
];

/**
 * API Key 格式验证规则
 */
const API_KEY_PATTERNS = {
  openai: /^sk-[a-zA-Z0-9]{32,}$/,
  anthropic: /^sk-ant-[a-zA-Z0-9-]{32,}$/,
  deepseek: /^sk-[a-zA-Z0-9]{32,}$/,
  google: /^AIza[a-zA-Z0-9_-]{32,}$/,
  cohere: /^[a-zA-Z0-9]{32,}$/,
  volcengine: /^[a-f0-9-]{36}$/, // UUID格式
  dashscope: /^sk-[a-zA-Z0-9]{32,}$/,
  zhipuai: /^[a-zA-Z0-9]{32,}\.[a-zA-Z0-9]+$/, // 格式: key.secret
  moonshot: /^sk-[a-zA-Z0-9]{32,}$/,
};

/**
 * 安全配置存储类
 *
 * 使用策略模式支持多种加密后端：
 * - safeStorage: Electron原生，使用操作系统凭证管理器
 * - fallback: 基于机器特征的AES-256-GCM加密
 */
class SecureConfigStorage {
  constructor(options = {}) {
    this.storagePath = options.storagePath || this._getDefaultStoragePath();
    this.safeStorageAvailable = this._checkSafeStorageAvailability();
    this.machineKey = null;
    this._cache = null;
    this._cacheTimestamp = null;
    this._cacheTTL = 5 * 60 * 1000; // 5分钟缓存
  }

  /**
   * 检查 Electron safeStorage 是否可用
   * @private
   */
  _checkSafeStorageAvailability() {
    try {
      if (
        safeStorage &&
        typeof safeStorage.isEncryptionAvailable === "function"
      ) {
        const available = safeStorage.isEncryptionAvailable();
        logger.info(`[SecureConfigStorage] safeStorage 可用性: ${available}`);
        return available;
      }
    } catch (error) {
      logger.warn("[SecureConfigStorage] safeStorage 检查失败:", error.message);
    }
    return false;
  }

  /**
   * 获取默认存储路径
   * @private
   */
  _getDefaultStoragePath() {
    const userDataPath = app.getPath("userData");
    return path.join(userDataPath, "secure-config.enc");
  }

  /**
   * 获取备份目录路径
   * @private
   */
  _getBackupDir() {
    const userDataPath = app.getPath("userData");
    return path.join(userDataPath, "secure-backups");
  }

  /**
   * 获取机器特定的密钥种子
   * @private
   */
  _getMachineKeySeed() {
    const components = [
      os.hostname(),
      os.platform(),
      os.arch(),
      os.homedir(),
      JSON.stringify(
        os
          .cpus()
          .map((c) => c.model)
          .slice(0, 1),
      ),
      "chainlesschain-llm-config-v2",
    ];
    return components.join("|");
  }

  /**
   * 从机器种子派生加密密钥
   * @private
   */
  _deriveKey(salt) {
    const seed = this._getMachineKeySeed();
    return crypto.pbkdf2Sync(seed, salt, ITERATIONS, KEY_LENGTH, "sha256");
  }

  /**
   * 使用 safeStorage 加密数据
   * @private
   */
  _encryptWithSafeStorage(data) {
    const jsonData = JSON.stringify({
      version: STORAGE_VERSION,
      data: data,
      timestamp: Date.now(),
    });
    const encrypted = safeStorage.encryptString(jsonData);

    // 添加标记头以识别加密方式
    const header = Buffer.from([0x53, 0x53, STORAGE_VERSION]); // 'SS' + version
    return Buffer.concat([header, encrypted]);
  }

  /**
   * 使用 safeStorage 解密数据
   * @private
   */
  _decryptWithSafeStorage(encryptedData) {
    // 跳过标记头
    const encrypted = encryptedData.subarray(3);
    const decrypted = safeStorage.decryptString(encrypted);
    const parsed = JSON.parse(decrypted);
    return parsed.data;
  }

  /**
   * 使用 AES-256-GCM 加密数据（后备方案）
   * @private
   */
  _encryptWithAES(data) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = this._deriveKey(salt);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const jsonData = JSON.stringify({
      version: STORAGE_VERSION,
      data: data,
      timestamp: Date.now(),
    });

    const encrypted = Buffer.concat([
      cipher.update(jsonData, "utf8"),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // 添加标记头以识别加密方式
    const header = Buffer.from([0x41, 0x45, STORAGE_VERSION]); // 'AE' + version
    return Buffer.concat([header, salt, iv, authTag, encrypted]);
  }

  /**
   * 使用 AES-256-GCM 解密数据
   * @private
   */
  _decryptWithAES(encryptedData) {
    // 跳过标记头
    const data = encryptedData.subarray(3);

    const salt = data.subarray(0, SALT_LENGTH);
    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = data.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
    );
    const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = this._deriveKey(salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    const parsed = JSON.parse(decrypted.toString("utf8"));
    return parsed.data;
  }

  /**
   * 判断加密方式
   * @private
   */
  _getEncryptionType(data) {
    if (data.length < 3) {
      return "unknown";
    }

    const header = data.subarray(0, 2).toString("ascii");
    if (header === "SS") {
      return "safeStorage";
    }
    if (header === "AE") {
      return "aes";
    }

    // 旧版本没有标记头，尝试作为AES解密
    return "legacy";
  }

  /**
   * 加密数据
   * @param {Object} data - 要加密的数据对象
   * @returns {Buffer} 加密后的数据
   */
  encrypt(data) {
    if (this.safeStorageAvailable) {
      try {
        return this._encryptWithSafeStorage(data);
      } catch (error) {
        logger.warn(
          "[SecureConfigStorage] safeStorage 加密失败，使用后备方案:",
          error.message,
        );
      }
    }
    return this._encryptWithAES(data);
  }

  /**
   * 解密数据
   * @param {Buffer} encryptedData - 加密的数据
   * @returns {Object} 解密后的数据对象
   */
  decrypt(encryptedData) {
    const encType = this._getEncryptionType(encryptedData);

    switch (encType) {
      case "safeStorage":
        if (!this.safeStorageAvailable) {
          throw new Error("safeStorage 不可用，无法解密数据");
        }
        return this._decryptWithSafeStorage(encryptedData);

      case "aes":
        return this._decryptWithAES(encryptedData);

      case "legacy":
        // 兼容旧版本格式
        return this._decryptLegacy(encryptedData);

      default:
        throw new Error("未知的加密格式");
    }
  }

  /**
   * 解密旧版本格式
   * @private
   */
  _decryptLegacy(encryptedData) {
    // 旧版本格式: salt (32) + iv (16) + authTag (16) + encrypted
    const salt = encryptedData.subarray(0, SALT_LENGTH);
    const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = encryptedData.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
    );
    const encrypted = encryptedData.subarray(
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
    );

    const key = this._deriveKey(salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return JSON.parse(decrypted.toString("utf8"));
  }

  /**
   * 保存加密配置
   * @param {Object} config - 配置对象
   * @returns {boolean} 是否成功
   */
  save(config) {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const encrypted = this.encrypt(config);
      fs.writeFileSync(this.storagePath, encrypted);

      // 清除缓存
      this._cache = null;
      this._cacheTimestamp = null;

      logger.info("[SecureConfigStorage] 配置已加密保存");
      return true;
    } catch (error) {
      logger.error("[SecureConfigStorage] 保存失败:", error);
      return false;
    }
  }

  /**
   * 加载加密配置
   * @param {boolean} useCache - 是否使用缓存
   * @returns {Object|null} 配置对象或 null
   */
  load(useCache = true) {
    try {
      // 检查缓存
      if (useCache && this._cache && this._cacheTimestamp) {
        if (Date.now() - this._cacheTimestamp < this._cacheTTL) {
          return this._cache;
        }
      }

      if (!fs.existsSync(this.storagePath)) {
        logger.info("[SecureConfigStorage] 加密配置文件不存在");
        return null;
      }

      const encrypted = fs.readFileSync(this.storagePath);
      const config = this.decrypt(encrypted);

      // 更新缓存
      this._cache = config;
      this._cacheTimestamp = Date.now();

      logger.info("[SecureConfigStorage] 配置已解密加载");
      return config;
    } catch (error) {
      logger.error("[SecureConfigStorage] 加载失败:", error);
      return null;
    }
  }

  /**
   * 检查是否存在加密配置
   * @returns {boolean}
   */
  exists() {
    return fs.existsSync(this.storagePath);
  }

  /**
   * 删除加密配置
   * @returns {boolean}
   */
  delete() {
    try {
      if (fs.existsSync(this.storagePath)) {
        fs.unlinkSync(this.storagePath);
        this._cache = null;
        this._cacheTimestamp = null;
        logger.info("[SecureConfigStorage] 加密配置已删除");
      }
      return true;
    } catch (error) {
      logger.error("[SecureConfigStorage] 删除失败:", error);
      return false;
    }
  }

  /**
   * 创建备份
   * @returns {string|null} 备份文件路径或 null
   */
  createBackup() {
    try {
      if (!this.exists()) {
        logger.info("[SecureConfigStorage] 没有配置可备份");
        return null;
      }

      const backupDir = this._getBackupDir();
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(
        backupDir,
        `secure-config-${timestamp}.enc.bak`,
      );

      fs.copyFileSync(this.storagePath, backupPath);
      logger.info("[SecureConfigStorage] 备份已创建:", backupPath);

      return backupPath;
    } catch (error) {
      logger.error("[SecureConfigStorage] 创建备份失败:", error);
      return null;
    }
  }

  /**
   * 从备份恢复
   * @param {string} backupPath - 备份文件路径
   * @returns {boolean}
   */
  restoreFromBackup(backupPath) {
    try {
      if (!fs.existsSync(backupPath)) {
        logger.error("[SecureConfigStorage] 备份文件不存在:", backupPath);
        return false;
      }

      // 先验证备份文件是否可解密
      const encrypted = fs.readFileSync(backupPath);
      this.decrypt(encrypted); // 如果解密失败会抛出异常

      // 备份当前文件
      if (this.exists()) {
        const currentBackup = this.storagePath + ".before-restore";
        fs.copyFileSync(this.storagePath, currentBackup);
      }

      // 恢复
      fs.copyFileSync(backupPath, this.storagePath);
      this._cache = null;
      this._cacheTimestamp = null;

      logger.info("[SecureConfigStorage] 从备份恢复成功");
      return true;
    } catch (error) {
      logger.error("[SecureConfigStorage] 从备份恢复失败:", error);
      return false;
    }
  }

  /**
   * 列出所有备份
   * @returns {Array<{path: string, date: Date, size: number}>}
   */
  listBackups() {
    try {
      const backupDir = this._getBackupDir();
      if (!fs.existsSync(backupDir)) {
        return [];
      }

      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.endsWith(".enc.bak"))
        .map((f) => {
          const fullPath = path.join(backupDir, f);
          const stat = fs.statSync(fullPath);
          return {
            path: fullPath,
            filename: f,
            date: stat.mtime,
            size: stat.size,
          };
        })
        .sort((a, b) => b.date - a.date);

      return files;
    } catch (error) {
      logger.error("[SecureConfigStorage] 列出备份失败:", error);
      return [];
    }
  }

  /**
   * 导出配置（使用密码加密）
   * @param {string} password - 导出密码
   * @param {string} exportPath - 导出文件路径
   * @returns {boolean}
   */
  exportWithPassword(password, exportPath) {
    try {
      const config = this.load(false);
      if (!config) {
        logger.error("[SecureConfigStorage] 没有配置可导出");
        return false;
      }

      // 使用密码派生密钥
      const salt = crypto.randomBytes(SALT_LENGTH);
      const key = crypto.pbkdf2Sync(
        password,
        salt,
        ITERATIONS,
        KEY_LENGTH,
        "sha256",
      );
      const iv = crypto.randomBytes(IV_LENGTH);

      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const jsonData = JSON.stringify({
        version: STORAGE_VERSION,
        exportTime: new Date().toISOString(),
        data: config,
      });

      const encrypted = Buffer.concat([
        cipher.update(jsonData, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // 格式: 'EX' + version + salt + iv + authTag + encrypted
      const header = Buffer.from([0x45, 0x58, STORAGE_VERSION]); // 'EX' + version
      const exportData = Buffer.concat([header, salt, iv, authTag, encrypted]);

      fs.writeFileSync(exportPath, exportData);
      logger.info("[SecureConfigStorage] 配置已导出:", exportPath);
      return true;
    } catch (error) {
      logger.error("[SecureConfigStorage] 导出失败:", error);
      return false;
    }
  }

  /**
   * 导入配置（使用密码解密）
   * @param {string} password - 导入密码
   * @param {string} importPath - 导入文件路径
   * @returns {boolean}
   */
  importWithPassword(password, importPath) {
    try {
      if (!fs.existsSync(importPath)) {
        logger.error("[SecureConfigStorage] 导入文件不存在");
        return false;
      }

      const fileData = fs.readFileSync(importPath);

      // 验证格式
      if (
        fileData.length < 3 ||
        fileData.subarray(0, 2).toString("ascii") !== "EX"
      ) {
        logger.error("[SecureConfigStorage] 无效的导入文件格式");
        return false;
      }

      const data = fileData.subarray(3);
      const salt = data.subarray(0, SALT_LENGTH);
      const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const authTag = data.subarray(
        SALT_LENGTH + IV_LENGTH,
        SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
      );
      const encrypted = data.subarray(
        SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH,
      );

      // 使用密码派生密钥
      const key = crypto.pbkdf2Sync(
        password,
        salt,
        ITERATIONS,
        KEY_LENGTH,
        "sha256",
      );

      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      const parsed = JSON.parse(decrypted.toString("utf8"));

      // 创建备份后保存
      this.createBackup();
      this.save(parsed.data);

      logger.info("[SecureConfigStorage] 配置已导入");
      return true;
    } catch (error) {
      logger.error("[SecureConfigStorage] 导入失败:", error);
      return false;
    }
  }

  /**
   * 获取存储信息
   * @returns {Object}
   */
  getStorageInfo() {
    const info = {
      exists: this.exists(),
      safeStorageAvailable: this.safeStorageAvailable,
      storagePath: this.storagePath,
      backupCount: 0,
      encryptionType: null,
      version: null,
      lastModified: null,
      size: null,
    };

    if (info.exists) {
      try {
        const stat = fs.statSync(this.storagePath);
        info.lastModified = stat.mtime;
        info.size = stat.size;

        const data = fs.readFileSync(this.storagePath);
        info.encryptionType = this._getEncryptionType(data);
        info.version = data.length > 2 ? data[2] : 1;
      } catch (error) {
        logger.warn("[SecureConfigStorage] 获取存储信息失败:", error.message);
      }
    }

    info.backupCount = this.listBackups().length;

    return info;
  }

  /**
   * 迁移到更安全的加密方式
   * @returns {boolean}
   */
  migrateToSafeStorage() {
    if (!this.safeStorageAvailable) {
      logger.warn("[SecureConfigStorage] safeStorage 不可用，无法迁移");
      return false;
    }

    try {
      const config = this.load(false);
      if (!config) {
        logger.info("[SecureConfigStorage] 没有配置需要迁移");
        return true;
      }

      // 创建备份
      this.createBackup();

      // 使用 safeStorage 重新加密
      const encrypted = this._encryptWithSafeStorage(config);
      fs.writeFileSync(this.storagePath, encrypted);

      this._cache = null;
      this._cacheTimestamp = null;

      logger.info("[SecureConfigStorage] 已迁移到 safeStorage");
      return true;
    } catch (error) {
      logger.error("[SecureConfigStorage] 迁移失败:", error);
      return false;
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this._cache = null;
    this._cacheTimestamp = null;
  }
}

/**
 * 验证 API Key 格式
 * @param {string} provider - 提供商名称
 * @param {string} apiKey - API Key
 * @returns {{valid: boolean, message?: string}}
 */
function validateApiKeyFormat(provider, apiKey) {
  if (!apiKey || typeof apiKey !== "string") {
    return { valid: false, message: "API Key 不能为空" };
  }

  apiKey = apiKey.trim();

  if (apiKey.length < 10) {
    return { valid: false, message: "API Key 长度过短" };
  }

  const pattern = API_KEY_PATTERNS[provider];
  if (pattern && !pattern.test(apiKey)) {
    return {
      valid: false,
      message: `API Key 格式不正确，应符合 ${provider} 的标准格式`,
    };
  }

  return { valid: true };
}

/**
 * 从配置对象中提取敏感字段
 * @param {Object} config - 完整配置
 * @returns {Object} 敏感字段
 */
function extractSensitiveFields(config) {
  const sensitive = {};

  for (const fieldPath of SENSITIVE_FIELDS) {
    const keys = fieldPath.split(".");
    let value = config;

    for (const key of keys) {
      if (value && typeof value === "object" && key in value) {
        value = value[key];
      } else {
        value = undefined;
        break;
      }
    }

    if (value !== undefined && value !== "") {
      sensitive[fieldPath] = value;
    }
  }

  return sensitive;
}

/**
 * 将敏感字段合并回配置对象
 * @param {Object} config - 配置对象（会被修改）
 * @param {Object} sensitive - 敏感字段
 */
function mergeSensitiveFields(config, sensitive) {
  for (const [fieldPath, value] of Object.entries(sensitive)) {
    const keys = fieldPath.split(".");
    let target = config;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in target) || typeof target[key] !== "object") {
        target[key] = {};
      }
      target = target[key];
    }

    target[keys[keys.length - 1]] = value;
  }
}

/**
 * 从配置对象中移除敏感字段（替换为占位符）
 * @param {Object} config - 配置对象
 * @returns {Object} 脱敏后的配置
 */
function sanitizeConfig(config) {
  const sanitized = JSON.parse(JSON.stringify(config));

  for (const fieldPath of SENSITIVE_FIELDS) {
    const keys = fieldPath.split(".");
    let target = sanitized;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (target && typeof target === "object" && key in target) {
        target = target[key];
      } else {
        target = null;
        break;
      }
    }

    if (target && typeof target === "object") {
      const lastKey = keys[keys.length - 1];
      if (target[lastKey] && target[lastKey] !== "") {
        const original = String(target[lastKey]);
        if (original.length > 8) {
          target[lastKey] =
            original.substring(0, 4) +
            "****" +
            original.substring(original.length - 4);
        } else {
          target[lastKey] = "********";
        }
      }
    }
  }

  return sanitized;
}

/**
 * 检查字段是否为敏感字段
 * @param {string} fieldPath - 字段路径
 * @returns {boolean}
 */
function isSensitiveField(fieldPath) {
  return SENSITIVE_FIELDS.includes(fieldPath);
}

/**
 * 获取提供商的敏感字段列表
 * @param {string} provider - 提供商名称
 * @returns {string[]}
 */
function getProviderSensitiveFields(provider) {
  return SENSITIVE_FIELDS.filter((f) => f.startsWith(provider + "."));
}

// 单例实例
let instance = null;

/**
 * 获取安全配置存储单例
 * @returns {SecureConfigStorage}
 */
function getSecureConfigStorage() {
  if (!instance) {
    instance = new SecureConfigStorage();
  }
  return instance;
}

/**
 * 重置单例（仅用于测试）
 */
function resetInstance() {
  instance = null;
}

module.exports = {
  SecureConfigStorage,
  getSecureConfigStorage,
  resetInstance,
  extractSensitiveFields,
  mergeSensitiveFields,
  sanitizeConfig,
  validateApiKeyFormat,
  isSensitiveField,
  getProviderSensitiveFields,
  SENSITIVE_FIELDS,
  API_KEY_PATTERNS,
  STORAGE_VERSION,
};
