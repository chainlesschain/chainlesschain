/**
 * 数据库加密配置管理器
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs');
const path = require('path');

class EncryptionConfigManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = this.loadConfig();
  }

  /**
   * 检查是否为开发模式
   */
  isDevelopmentMode() {
    return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  }

  /**
   * 加载配置
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error('[EncryptionConfig] 加载配置失败:', error);
    }

    // 返回默认配置
    // 开发模式下默认禁用加密
    const defaultEncryptionEnabled = !this.isDevelopmentMode();

    return {
      encryptionEnabled: defaultEncryptionEnabled,
      encryptionMethod: 'password', // 'password' | 'ukey' | 'mixed'
      autoMigrate: true,
      firstTimeSetup: true,
      developmentMode: this.isDevelopmentMode()
    };
  }

  /**
   * 保存配置
   */
  saveConfig() {
    try {
      // 确保目录存在
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf8'
      );

      logger.info('[EncryptionConfig] 配置已保存');
      return true;
    } catch (error) {
      logger.error('[EncryptionConfig] 保存配置失败:', error);
      return false;
    }
  }

  /**
   * 获取配置项
   */
  get(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  /**
   * 设置配置项
   */
  set(key, value) {
    this.config[key] = value;
    return this.saveConfig();
  }

  /**
   * 批量设置配置
   */
  setMultiple(values) {
    Object.assign(this.config, values);
    return this.saveConfig();
  }

  /**
   * 是否已完成首次设置
   */
  isFirstTimeSetup() {
    return this.get('firstTimeSetup', true);
  }

  /**
   * 标记首次设置已完成
   */
  markFirstTimeSetupComplete() {
    return this.set('firstTimeSetup', false);
  }

  /**
   * 是否启用加密
   */
  isEncryptionEnabled() {
    return this.get('encryptionEnabled', false);
  }

  /**
   * 启用/禁用加密
   */
  setEncryptionEnabled(enabled) {
    return this.set('encryptionEnabled', enabled);
  }

  /**
   * 获取加密方法
   */
  getEncryptionMethod() {
    return this.get('encryptionMethod', 'password');
  }

  /**
   * 设置加密方法
   */
  setEncryptionMethod(method) {
    return this.set('encryptionMethod', method);
  }

  /**
   * 获取所有配置
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * 获取开发模式状态
   */
  getDevelopmentMode() {
    return this.get('developmentMode', this.isDevelopmentMode());
  }

  /**
   * 是否可以跳过密码设置（仅开发模式）
   */
  canSkipPassword() {
    return this.isDevelopmentMode();
  }

  /**
   * 重置配置
   */
  reset() {
    const defaultEncryptionEnabled = !this.isDevelopmentMode();
    this.config = {
      encryptionEnabled: defaultEncryptionEnabled,
      encryptionMethod: 'password',
      autoMigrate: true,
      firstTimeSetup: true,
      developmentMode: this.isDevelopmentMode()
    };
    return this.saveConfig();
  }
}

module.exports = EncryptionConfigManager;
