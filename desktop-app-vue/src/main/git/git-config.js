/**
 * Git配置管理
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

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
  authorName: 'ChainlessChain User',
  authorEmail: 'user@chainlesschain.com',

  // 认证信息
  auth: null,

  // 自动同步
  autoSync: false,
  autoSyncInterval: 300000, // 5分钟

  // 同步策略
  syncStrategy: 'auto', // 'auto' | 'manual'

  // 导出路径（相对于仓库路径）
  exportPath: 'knowledge',

  // 是否启用Git日志输出
  enableLogging: false,
};

/**
 * Git配置管理器
 */
class GitConfig {
  constructor() {
    this.configPath = this.getConfigPath();
    this.config = { ...DEFAULT_CONFIG };
    this.loaded = false;
  }

  /**
   * 获取配置文件路径
   */
  getConfigPath() {
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'git-config.json');
  }

  /**
   * 加载配置
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const savedConfig = JSON.parse(content);

        this.config = {
          ...DEFAULT_CONFIG,
          ...savedConfig,
        };

        this.loaded = true;
        // 加载配置时使用直接console.log，因为gitLog还未初始化
        if (this.config.enableLogging) {
          logger.info('[GitConfig] 配置加载成功');
        }
      } else {
        if (DEFAULT_CONFIG.enableLogging) {
          logger.info('[GitConfig] 配置文件不存在，使用默认配置');
        }
        this.loaded = false;
      }
    } catch (error) {
      logger.error('[GitConfig] 配置加载失败:', error);
      this.config = { ...DEFAULT_CONFIG };
      this.loaded = false;
    }

    return this.config;
  }

  /**
   * 保存配置
   */
  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');

      if (this.config.enableLogging) {
        logger.info('[GitConfig] 配置保存成功');
      }
      return true;
    } catch (error) {
      logger.error('[GitConfig] 配置保存失败:', error);
      return false;
    }
  }

  /**
   * 获取配置项
   */
  get(key, defaultValue = null) {
    const keys = key.split('.');
    let value = this.config;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
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
    const keys = key.split('.');
    let target = this.config;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in target) || typeof target[k] !== 'object') {
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
    return { ...this.config };
  }

  /**
   * 重置为默认配置
   */
  reset() {
    this.config = { ...DEFAULT_CONFIG };
    this.save();
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
    return this.config.auth;
  }

  setAuth(auth) {
    this.config.auth = auth;
    this.save();
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

module.exports = {
  GitConfig,
  getGitConfig,
  DEFAULT_CONFIG,
  gitLog,
  gitError,
  gitWarn,
};
