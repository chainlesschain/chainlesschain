/**
 * U盾配置管理
 *
 * 负责读取、保存和管理U盾配置
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  // 驱动类型
  driverType: 'xinjinke',

  // DLL路径（可选，如果不指定会自动查找）
  dllPath: null,

  // 超时设置（毫秒）
  timeout: 30000,

  // 自动锁定
  autoLock: true,
  autoLockTimeout: 300, // 5分钟

  // 设备监听间隔（毫秒）
  monitorInterval: 5000,

  // 调试模式
  debug: false,

  // 模拟模式（开发用）
  simulationMode: false,

  // 驱动特定选项
  driverOptions: {
    xinjinke: {
      defaultPassword: '888888',
    },
    feitian: {},
    watchdata: {},
    huada: {
      supportSM: true, // 支持国密算法
    },
    tdr: {
      paymentMode: false, // 是否启用支付模式
    },
  },
};

/**
 * U盾配置管理器
 */
class UKeyConfig {
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
    return path.join(userDataPath, 'ukey-config.json');
  }

  /**
   * 加载配置
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const savedConfig = JSON.parse(content);

        // 合并配置（保留默认值）
        this.config = {
          ...DEFAULT_CONFIG,
          ...savedConfig,
          driverOptions: {
            ...DEFAULT_CONFIG.driverOptions,
            ...(savedConfig.driverOptions || {}),
          },
        };

        this.loaded = true;
        // console.log('[UKeyConfig] 配置加载成功:', this.configPath);
      } else {
        // console.log('[UKeyConfig] 配置文件不存在，使用默认配置');
        this.loaded = false;
      }
    } catch (error) {
      // console.error('[UKeyConfig] 配置加载失败:', error);
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
      // 确保目录存在
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入配置文件
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');

      // console.log('[UKeyConfig] 配置保存成功:', this.configPath);
      return true;
    } catch (error) {
      // console.error('[UKeyConfig] 配置保存失败:', error);
      return false;
    }
  }

  /**
   * 获取配置项
   * @param {string} key - 配置键
   * @param {*} defaultValue - 默认值
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
   * @param {string} key - 配置键
   * @param {*} value - 配置值
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
    // console.log('[UKeyConfig] 配置已重置为默认值');
  }

  /**
   * 获取驱动类型
   */
  getDriverType() {
    return this.config.driverType;
  }

  /**
   * 设置驱动类型
   */
  setDriverType(driverType) {
    this.config.driverType = driverType;
    this.save();
  }

  /**
   * 获取驱动特定选项
   */
  getDriverOptions(driverType) {
    return this.config.driverOptions[driverType] || {};
  }

  /**
   * 设置驱动特定选项
   */
  setDriverOptions(driverType, options) {
    if (!this.config.driverOptions) {
      this.config.driverOptions = {};
    }
    this.config.driverOptions[driverType] = {
      ...this.config.driverOptions[driverType],
      ...options,
    };
    this.save();
  }

  /**
   * 是否启用自动锁定
   */
  isAutoLockEnabled() {
    return this.config.autoLock === true;
  }

  /**
   * 获取自动锁定超时（秒）
   */
  getAutoLockTimeout() {
    return this.config.autoLockTimeout || 300;
  }

  /**
   * 设置自动锁定
   */
  setAutoLock(enabled, timeout = null) {
    this.config.autoLock = enabled;
    if (timeout !== null) {
      this.config.autoLockTimeout = timeout;
    }
    this.save();
  }

  /**
   * 是否启用调试模式
   */
  isDebugEnabled() {
    return this.config.debug === true;
  }

  /**
   * 设置调试模式
   */
  setDebug(enabled) {
    this.config.debug = enabled;
    this.save();
  }

  /**
   * 是否使用模拟模式
   */
  isSimulationMode() {
    return this.config.simulationMode === true;
  }

  /**
   * 设置模拟模式
   */
  setSimulationMode(enabled) {
    this.config.simulationMode = enabled;
    this.save();
  }

  /**
   * 获取监听间隔
   */
  getMonitorInterval() {
    return this.config.monitorInterval || 5000;
  }

  /**
   * 设置监听间隔
   */
  setMonitorInterval(interval) {
    this.config.monitorInterval = interval;
    this.save();
  }

  /**
   * 获取超时时间
   */
  getTimeout() {
    return this.config.timeout || 30000;
  }

  /**
   * 设置超时时间
   */
  setTimeout(timeout) {
    this.config.timeout = timeout;
    this.save();
  }

  /**
   * 导出配置（JSON字符串）
   */
  export() {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * 导入配置（从JSON字符串）
   */
  import(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      this.config = {
        ...DEFAULT_CONFIG,
        ...imported,
      };
      this.save();
      // console.log('[UKeyConfig] 配置导入成功');
      return true;
    } catch (error) {
      // console.error('[UKeyConfig] 配置导入失败:', error);
      return false;
    }
  }
}

// 单例模式
let instance = null;

/**
 * 获取配置管理器实例
 */
function getUKeyConfig() {
  if (!instance) {
    instance = new UKeyConfig();
    instance.load();
  }
  return instance;
}

module.exports = {
  UKeyConfig,
  getUKeyConfig,
  DEFAULT_CONFIG,
};
