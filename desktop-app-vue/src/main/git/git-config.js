/**
 * Git配置管理
 */

const { logger } = require("../utils/logger.js");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { getGitCredentialStore } = require("./git-credential-store");

// M2: _deps injection so tests can mock fs.promises (vi.mock cannot
// intercept fs.promises for inlined CJS modules)
const _deps = { fsp: fs.promises };

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 是否启用Git同步
  enabled: false,

  // 仓库路径
  repoPath: null,

  // 远程仓库URL
  remoteUrl: null,

  // 作者信息
  authorName: "ChainlessChain User",
  authorEmail: "user@chainlesschain.com",

  // 认证信息
  auth: null,

  // 自动同步
  autoSync: false,
  autoSyncInterval: 300000, // 5分钟

  // 同步策略
  syncStrategy: "auto", // 'auto' | 'manual'

  // 导出路径（相对于仓库路径）
  exportPath: "knowledge",

  // 是否启用Git日志输出
  enableLogging: false,

  // 托管服务提供商 (v1.3.0)
  providers: [],

  // 代理配置 (v1.3.0)
  proxy: {
    enabled: false,
    type: "http", // 'http' | 'socks5'
    host: "127.0.0.1",
    port: 7890,
  },

  // SSH 密钥路径 (v1.3.0)
  sshKeyPath: null,
};

/**
 * Git配置管理器
 */
class GitConfig {
  constructor(options = {}) {
    this.configPath = options.configPath || this.getConfigPath();
    this.credentialStore = options.credentialStore || getGitCredentialStore();
    this.config = { ...DEFAULT_CONFIG };
    this.loaded = false;
  }

  _sealAuth(auth, scope) {
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
      return { auth: auth || null, changed: false };
    }
    const secrets = {};
    if (typeof auth.token === "string" && auth.token) {
      secrets.token = auth.token;
    }
    if (typeof auth.password === "string" && auth.password) {
      secrets.password = auth.password;
    }
    if (Object.keys(secrets).length === 0) {
      return { auth: { ...auth }, changed: false };
    }
    const references = this.credentialStore.set(scope, secrets);
    const sealed = { ...auth, ...references };
    delete sealed.token;
    delete sealed.password;
    return { auth: sealed, changed: true };
  }

  _resolveAuth(auth) {
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) {
      return null;
    }
    const resolved = { ...auth };
    if (auth.tokenRef) {
      resolved.token = this.credentialStore.get(auth.tokenRef);
    }
    if (auth.passwordRef) {
      resolved.password = this.credentialStore.get(auth.passwordRef);
    }
    delete resolved.tokenRef;
    delete resolved.passwordRef;
    return resolved;
  }

  _sealCredentials() {
    let changed = false;
    const root = this._sealAuth(this.config.auth, "default");
    this.config.auth = root.auth;
    changed ||= root.changed;

    if (Array.isArray(this.config.providers)) {
      this.config.providers = this.config.providers.map((provider, index) => {
        if (!provider || typeof provider !== "object") {
          return provider;
        }
        const scope = `provider:${provider.name || provider.type || index}`;
        const result = this._sealAuth(provider.auth, scope);
        changed ||= result.changed;
        return { ...provider, auth: result.auth };
      });
    }
    return changed;
  }

  _writeConfigSync() {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      "utf8",
    );
  }

  async _writeConfigAsync() {
    await _deps.fsp.mkdir(path.dirname(this.configPath), { recursive: true });
    await _deps.fsp.writeFile(
      this.configPath,
      JSON.stringify(this.config, null, 2),
      "utf8",
    );
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath() {
    const userDataPath = app.getPath("userData");
    return path.join(userDataPath, "git-config.json");
  }

  /**
   * 加载配置
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, "utf8");
        const savedConfig = JSON.parse(content);

        this.config = {
          ...DEFAULT_CONFIG,
          ...savedConfig,
        };

        if (this._sealCredentials()) {
          this._writeConfigSync();
        }

        this.loaded = true;
        // 加载配置时使用直接console.log，因为gitLog还未初始化
        if (this.config.enableLogging) {
          logger.info("[GitConfig] 配置加载成功");
        }
      } else {
        if (DEFAULT_CONFIG.enableLogging) {
          logger.info("[GitConfig] 配置文件不存在，使用默认配置");
        }
        this.loaded = false;
      }
    } catch (error) {
      logger.error("[GitConfig] 配置加载失败:", error);
      this.config = { ...DEFAULT_CONFIG };
      this.loaded = false;
    }

    return this.config;
  }

  /**
   * 异步加载配置 (M2: 启动期使用，避免阻塞事件循环)
   */
  async loadAsync() {
    try {
      const content = await _deps.fsp.readFile(this.configPath, "utf8");
      const savedConfig = JSON.parse(content);
      this.config = {
        ...DEFAULT_CONFIG,
        ...savedConfig,
      };
      if (this._sealCredentials()) {
        await this._writeConfigAsync();
      }
      this.loaded = true;
      if (this.config.enableLogging) {
        logger.info("[GitConfig] 配置加载成功");
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        logger.error("[GitConfig] 配置加载失败:", error);
        this.config = { ...DEFAULT_CONFIG };
      } else if (DEFAULT_CONFIG.enableLogging) {
        logger.info("[GitConfig] 配置文件不存在，使用默认配置");
      }
      this.loaded = false;
    }
    return this.config;
  }

  /**
   * 保存配置
   */
  save() {
    try {
      this._sealCredentials();
      this._writeConfigSync();

      if (this.config.enableLogging) {
        logger.info("[GitConfig] 配置保存成功");
      }
      return true;
    } catch (error) {
      logger.error("[GitConfig] 配置保存失败:", error);
      return false;
    }
  }

  /**
   * 获取配置项
   */
  get(key, defaultValue = null) {
    const keys = key.split(".");
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * 设置配置项
   */
  set(key, value) {
    if (key === "auth") {
      return this.setAuth(value);
    }
    const keys = key.split(".");
    let target = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== "object") {
        target[k] = {};
      }
      target = target[k];
    }

    target[keys[keys.length - 1]] = value;
  }

  /**
   * 获取全部配置
   */
  getAll() {
    const publicConfig = JSON.parse(JSON.stringify(this.config));
    const redactAuth = (auth) => {
      if (!auth || typeof auth !== "object") {
        return auth || null;
      }
      const result = { ...auth };
      const credentialConfigured = Boolean(
        result.tokenRef || result.passwordRef,
      );
      delete result.tokenRef;
      delete result.passwordRef;
      delete result.token;
      delete result.password;
      return { ...result, credentialConfigured };
    };
    publicConfig.auth = redactAuth(publicConfig.auth);
    if (Array.isArray(publicConfig.providers)) {
      publicConfig.providers = publicConfig.providers.map((provider) => ({
        ...provider,
        auth: redactAuth(provider?.auth),
      }));
    }
    return publicConfig;
  }

  getProviderConfigs() {
    return Array.isArray(this.config.providers)
      ? this.config.providers.map((provider) => ({
          ...provider,
          auth: this._resolveAuth(provider?.auth),
        }))
      : [];
  }

  /**
   * 重置为默认配置
   */
  reset() {
    this.credentialStore.clearAll();
    this.config = { ...DEFAULT_CONFIG };
    return this.save();
  }

  // 便捷方法

  isEnabled() {
    return this.config.enabled === true;
  }

  setEnabled(enabled) {
    this.config.enabled = enabled;
    this.save();
  }

  getRepoPath() {
    return this.config.repoPath;
  }

  setRepoPath(path) {
    this.config.repoPath = path;
    this.save();
  }

  getRemoteUrl() {
    return this.config.remoteUrl;
  }

  setRemoteUrl(url) {
    this.config.remoteUrl = url;
    this.save();
  }

  getAuthor() {
    return {
      name: this.config.authorName,
      email: this.config.authorEmail,
    };
  }

  setAuthor(name, email) {
    this.config.authorName = name;
    this.config.authorEmail = email;
    this.save();
  }

  getAuth() {
    return this._resolveAuth(this.config.auth);
  }

  setAuth(auth) {
    if (auth == null) {
      this.credentialStore.clear("default");
      this.config.auth = null;
    } else {
      const sealed = this._sealAuth(auth, "default");
      this.config.auth = sealed.auth;
    }
    if (!this.save()) {
      throw new Error("Unable to persist Git credential references");
    }
    return true;
  }

  isAutoSyncEnabled() {
    return this.config.autoSync === true;
  }

  setAutoSync(enabled, interval = null) {
    this.config.autoSync = enabled;
    if (interval !== null) {
      this.config.autoSyncInterval = interval;
    }
    this.save();
  }

  getAutoSyncInterval() {
    return this.config.autoSyncInterval;
  }

  getSyncStrategy() {
    return this.config.syncStrategy;
  }

  setSyncStrategy(strategy) {
    this.config.syncStrategy = strategy;
    this.save();
  }

  getExportPath() {
    return this.config.exportPath;
  }

  setExportPath(path) {
    this.config.exportPath = path;
    this.save();
  }

  isLoggingEnabled() {
    return this.config.enableLogging === true;
  }

  setLogging(enabled) {
    this.config.enableLogging = enabled;
    this.save();
  }
}

/**
 * Git日志工具函数
 * 根据配置决定是否输出日志
 */
function gitLog(tag, ...args) {
  const config = getGitConfig();
  if (config.isLoggingEnabled()) {
    logger.info(`[${tag}]`, ...args);
  }
}

function gitError(tag, ...args) {
  // 错误日志始终输出
  logger.error(`[${tag}]`, ...args);
}

function gitWarn(tag, ...args) {
  const config = getGitConfig();
  if (config.isLoggingEnabled()) {
    logger.warn(`[${tag}]`, ...args);
  }
}

// 单例
let instance = null;

function getGitConfig() {
  if (!instance) {
    instance = new GitConfig();
    instance.load();
  }
  return instance;
}

/**
 * 异步获取 GitConfig 单例 (M2: 启动期使用)
 */
async function getGitConfigAsync() {
  if (!instance) {
    instance = new GitConfig();
    await instance.loadAsync();
  }
  return instance;
}

module.exports = {
  GitConfig,
  getGitConfig,
  getGitConfigAsync,
  DEFAULT_CONFIG,
  gitLog,
  gitError,
  gitWarn,
};
module.exports._deps = _deps;
