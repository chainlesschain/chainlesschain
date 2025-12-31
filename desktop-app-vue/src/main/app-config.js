/**
 * 应用级配置管理器
 * 用于存储无法存储在数据库中的配置（如数据库路径本身）
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 数据库配置
  database: {
    path: null, // null表示使用默认路径
    autoBackup: true,
    backupInterval: 86400000, // 24小时
    maxBackups: 7,
  },

  // 应用配置
  app: {
    language: 'zh-CN',
    theme: 'light',
    startOnBoot: false,
    minimizeToTray: true,
  },

  // 日志配置
  logging: {
    level: 'info', // 'debug', 'info', 'warn', 'error'
    maxSize: 10485760, // 10MB
    maxFiles: 5,
  },
};

/**
 * 应用配置管理器类
 */
class AppConfigManager {
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
    return path.join(userDataPath, 'app-config.json');
  }

  /**
   * 获取默认数据库路径
   */
  getDefaultDatabasePath() {
    const userDataPath = app.getPath('userData');
    const dbDir = path.join(userDataPath, 'data');
    return path.join(dbDir, 'chainlesschain.db');
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
          database: { ...DEFAULT_CONFIG.database, ...(savedConfig.database || {}) },
          app: { ...DEFAULT_CONFIG.app, ...(savedConfig.app || {}) },
          logging: { ...DEFAULT_CONFIG.logging, ...(savedConfig.logging || {}) },
        };

        this.loaded = true;
        console.log('[AppConfig] 配置加载成功');
      } else {
        console.log('[AppConfig] 配置文件不存在，使用默认配置');
        this.loaded = false;
        // 创建默认配置文件
        this.save();
      }
    } catch (error) {
      console.error('[AppConfig] 配置加载失败:', error);
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

      console.log('[AppConfig] 配置保存成功');
      return true;
    } catch (error) {
      console.error('[AppConfig] 配置保存失败:', error);
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
    this.save();
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

  // ==================== 数据库相关 ====================

  /**
   * 获取数据库路径
   */
  getDatabasePath() {
    const customPath = this.config.database.path;
    if (customPath && customPath.trim() !== '') {
      return customPath;
    }
    return this.getDefaultDatabasePath();
  }

  /**
   * 设置数据库路径
   */
  setDatabasePath(newPath) {
    this.config.database.path = newPath;
    this.save();
  }

  /**
   * 获取数据库目录
   */
  getDatabaseDir() {
    const dbPath = this.getDatabasePath();
    return path.dirname(dbPath);
  }

  /**
   * 确保数据库目录存在
   */
  ensureDatabaseDir() {
    const dbDir = this.getDatabaseDir();
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`[AppConfig] 创建数据库目录: ${dbDir}`);
    }
    return dbDir;
  }

  /**
   * 检查数据库文件是否存在
   */
  databaseExists() {
    const dbPath = this.getDatabasePath();
    return fs.existsSync(dbPath);
  }

  /**
   * 迁移数据库到新位置
   * @param {string} newPath - 新的数据库路径
   * @returns {Promise<boolean>}
   */
  async migrateDatabaseTo(newPath) {
    try {
      const currentPath = this.getDatabasePath();

      // 检查源文件是否存在
      if (!fs.existsSync(currentPath)) {
        console.log('[AppConfig] 源数据库不存在，无需迁移');
        this.setDatabasePath(newPath);
        return true;
      }

      // 检查目标路径
      if (currentPath === newPath) {
        console.log('[AppConfig] 新路径与当前路径相同，无需迁移');
        return true;
      }

      // 确保目标目录存在
      const newDir = path.dirname(newPath);
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true });
      }

      // 检查目标文件是否已存在
      if (fs.existsSync(newPath)) {
        throw new Error('目标路径已存在数据库文件');
      }

      console.log(`[AppConfig] 开始迁移数据库: ${currentPath} -> ${newPath}`);

      // 复制数据库文件
      fs.copyFileSync(currentPath, newPath);

      // 验证复制是否成功
      if (!fs.existsSync(newPath)) {
        throw new Error('数据库文件复制失败');
      }

      const originalSize = fs.statSync(currentPath).size;
      const copiedSize = fs.statSync(newPath).size;

      if (originalSize !== copiedSize) {
        // 删除不完整的副本
        fs.unlinkSync(newPath);
        throw new Error('数据库文件复制不完整');
      }

      // 备份原数据库
      const backupPath = `${currentPath}.backup.${Date.now()}`;
      fs.copyFileSync(currentPath, backupPath);
      console.log(`[AppConfig] 已备份原数据库到: ${backupPath}`);

      // 更新配置
      this.setDatabasePath(newPath);

      console.log('[AppConfig] 数据库迁移成功');

      return true;
    } catch (error) {
      console.error('[AppConfig] 数据库迁移失败:', error);
      throw error;
    }
  }

  /**
   * 创建数据库备份
   * @returns {string} 备份文件路径
   */
  createDatabaseBackup() {
    try {
      const dbPath = this.getDatabasePath();

      if (!fs.existsSync(dbPath)) {
        throw new Error('数据库文件不存在');
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${dbPath}.backup.${timestamp}`;

      fs.copyFileSync(dbPath, backupPath);

      console.log(`[AppConfig] 数据库备份成功: ${backupPath}`);

      // 清理旧备份
      this.cleanupOldBackups();

      return backupPath;
    } catch (error) {
      console.error('[AppConfig] 数据库备份失败:', error);
      throw error;
    }
  }

  /**
   * 清理旧备份
   */
  cleanupOldBackups() {
    try {
      const dbPath = this.getDatabasePath();
      const dbDir = path.dirname(dbPath);
      const dbName = path.basename(dbPath);

      // 查找所有备份文件
      const files = fs.readdirSync(dbDir);
      const backupFiles = files
        .filter(file => file.startsWith(`${dbName}.backup.`))
        .map(file => ({
          name: file,
          path: path.join(dbDir, file),
          time: fs.statSync(path.join(dbDir, file)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time); // 按时间降序

      // 保留最新的N个备份
      const maxBackups = this.config.database.maxBackups || 7;
      const toDelete = backupFiles.slice(maxBackups);

      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        console.log(`[AppConfig] 删除旧备份: ${file.name}`);
      }
    } catch (error) {
      console.error('[AppConfig] 清理旧备份失败:', error);
    }
  }

  /**
   * 列出所有备份
   * @returns {Array}
   */
  listBackups() {
    try {
      const dbPath = this.getDatabasePath();
      const dbDir = path.dirname(dbPath);
      const dbName = path.basename(dbPath);

      const files = fs.readdirSync(dbDir);
      const backupFiles = files
        .filter(file => file.startsWith(`${dbName}.backup.`))
        .map(file => {
          const filePath = path.join(dbDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            size: stats.size,
            created: stats.mtime,
          };
        })
        .sort((a, b) => b.created - a.created);

      return backupFiles;
    } catch (error) {
      console.error('[AppConfig] 列出备份失败:', error);
      return [];
    }
  }

  /**
   * 从备份恢复数据库
   * @param {string} backupPath - 备份文件路径
   * @returns {boolean}
   */
  restoreFromBackup(backupPath) {
    try {
      const dbPath = this.getDatabasePath();

      if (!fs.existsSync(backupPath)) {
        throw new Error('备份文件不存在');
      }

      // 备份当前数据库（以防恢复失败）
      if (fs.existsSync(dbPath)) {
        const tempBackup = `${dbPath}.temp.${Date.now()}`;
        fs.copyFileSync(dbPath, tempBackup);
        console.log(`[AppConfig] 已创建临时备份: ${tempBackup}`);
      }

      // 恢复备份
      fs.copyFileSync(backupPath, dbPath);

      console.log(`[AppConfig] 数据库恢复成功: ${backupPath}`);
      return true;
    } catch (error) {
      console.error('[AppConfig] 数据库恢复失败:', error);
      throw error;
    }
  }

  /**
   * 批量应用初始设置配置
   * @param {Object} initialConfig - 来自 initial-setup-config.json 的配置
   */
  applyInitialSetup(initialConfig) {
    console.log('[AppConfig] 应用初始设置配置:', initialConfig);

    // 应用数据库路径
    if (initialConfig.paths?.database) {
      this.setDatabasePath(initialConfig.paths.database);
    }

    // 应用版本设置
    if (initialConfig.edition) {
      this.set('app.edition', initialConfig.edition);
    }

    // 应用项目根路径（保存到 app-config，而非数据库）
    if (initialConfig.paths?.projectRoot) {
      this.set('project.rootPath', initialConfig.paths.projectRoot);
    }

    // 保存配置
    this.save();
    console.log('[AppConfig] 初始设置配置应用成功');
  }
}

// 单例
let instance = null;

function getAppConfig() {
  if (!instance) {
    instance = new AppConfigManager();
    instance.load();
  }
  return instance;
}

module.exports = {
  AppConfigManager,
  getAppConfig,
  DEFAULT_CONFIG,
};
