/**
 * U盾管理器
 *
 * 统一管理多种U盾驱动
 */

const XinJinKeDriver = require('./xinjinke-driver');
const EventEmitter = require('events');

/**
 * U盾驱动类型
 */
const DriverTypes = {
  XINJINKE: 'xinjinke',
  FEITIAN: 'feitian',
  WATCHDATA: 'watchdata',
  SIMULATED: 'simulated',
};

/**
 * U盾管理器类
 *
 * 功能：
 * - 管理多种U盾驱动
 * - 自动检测U盾类型
 * - 统一的API接口
 * - 设备热插拔监听
 */
class UKeyManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;
    this.currentDriver = null;
    this.driverType = config.driverType || DriverTypes.XINJINKE;
    this.isInitialized = false;

    // 驱动实例缓存
    this.drivers = new Map();
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    console.log('[UKeyManager] 初始化U盾管理器...');

    try {
      // 创建驱动实例
      this.currentDriver = await this.createDriver(this.driverType);

      // 初始化驱动
      await this.currentDriver.initialize();

      this.isInitialized = true;
      console.log('[UKeyManager] U盾管理器初始化成功');

      // 发射初始化事件
      this.emit('initialized');

      return true;
    } catch (error) {
      console.error('[UKeyManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建驱动实例
   * @param {string} driverType - 驱动类型
   */
  async createDriver(driverType) {
    // 检查缓存
    if (this.drivers.has(driverType)) {
      return this.drivers.get(driverType);
    }

    let driver;

    switch (driverType) {
      case DriverTypes.XINJINKE:
        driver = new XinJinKeDriver(this.config);
        break;

      case DriverTypes.FEITIAN:
        // TODO: 实现飞天诚信驱动
        throw new Error('飞天诚信驱动尚未实现');

      case DriverTypes.WATCHDATA:
        // TODO: 实现握奇驱动
        throw new Error('握奇驱动尚未实现');

      case DriverTypes.SIMULATED:
        // TODO: 实现模拟驱动（用于开发测试）
        throw new Error('模拟驱动尚未实现');

      default:
        throw new Error(`不支持的驱动类型: ${driverType}`);
    }

    // 缓存驱动实例
    this.drivers.set(driverType, driver);

    return driver;
  }

  /**
   * 切换驱动类型
   * @param {string} driverType - 驱动类型
   */
  async switchDriver(driverType) {
    console.log('[UKeyManager] 切换驱动类型:', driverType);

    try {
      // 关闭当前驱动
      if (this.currentDriver) {
        await this.currentDriver.close();
      }

      // 创建并初始化新驱动
      this.currentDriver = await this.createDriver(driverType);
      await this.currentDriver.initialize();

      this.driverType = driverType;

      // 发射驱动切换事件
      this.emit('driver-changed', driverType);

      console.log('[UKeyManager] 驱动切换成功');
      return true;
    } catch (error) {
      console.error('[UKeyManager] 切换驱动失败:', error);
      throw error;
    }
  }

  /**
   * 自动检测U盾类型
   *
   * 尝试不同的驱动，看哪个能成功检测到设备
   */
  async autoDetect() {
    console.log('[UKeyManager] 自动检测U盾类型...');

    const driverTypes = [DriverTypes.XINJINKE, DriverTypes.FEITIAN, DriverTypes.WATCHDATA];

    for (const type of driverTypes) {
      try {
        const driver = await this.createDriver(type);
        await driver.initialize();

        const status = await driver.detect();

        if (status.detected) {
          console.log('[UKeyManager] 检测到U盾:', type);
          this.currentDriver = driver;
          this.driverType = type;

          this.emit('device-detected', { driverType: type, status });

          return {
            detected: true,
            driverType: type,
            status,
          };
        }
      } catch (error) {
        console.log(`[UKeyManager] ${type} 检测失败:`, error.message);
        // 继续尝试下一个
      }
    }

    console.log('[UKeyManager] 未检测到任何U盾设备');
    return {
      detected: false,
      driverType: null,
      status: null,
    };
  }

  /**
   * 检测U盾设备
   */
  async detect() {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    const status = await this.currentDriver.detect();

    if (status.detected) {
      this.emit('device-detected', status);
    } else {
      this.emit('device-not-found');
    }

    return status;
  }

  /**
   * 验证PIN码
   */
  async verifyPIN(pin) {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    const result = await this.currentDriver.verifyPIN(pin);

    if (result.success) {
      this.emit('unlocked', result);
    } else {
      this.emit('unlock-failed', result);
    }

    return result;
  }

  /**
   * 数字签名
   */
  async sign(data) {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    if (!this.currentDriver.isDeviceUnlocked()) {
      throw new Error('U盾未解锁');
    }

    return await this.currentDriver.sign(data);
  }

  /**
   * 验证签名
   */
  async verifySignature(data, signature) {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    return await this.currentDriver.verifySignature(data, signature);
  }

  /**
   * 加密数据
   */
  async encrypt(data) {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    if (!this.currentDriver.isDeviceUnlocked()) {
      throw new Error('U盾未解锁');
    }

    return await this.currentDriver.encrypt(data);
  }

  /**
   * 解密数据
   */
  async decrypt(encryptedData) {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    if (!this.currentDriver.isDeviceUnlocked()) {
      throw new Error('U盾未解锁');
    }

    return await this.currentDriver.decrypt(encryptedData);
  }

  /**
   * 获取公钥
   */
  async getPublicKey() {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    return await this.currentDriver.getPublicKey();
  }

  /**
   * 获取设备信息
   */
  async getDeviceInfo() {
    if (!this.currentDriver) {
      throw new Error('驱动未初始化');
    }

    return await this.currentDriver.getDeviceInfo();
  }

  /**
   * 锁定U盾
   */
  lock() {
    if (this.currentDriver) {
      this.currentDriver.lock();
      this.emit('locked');
    }
  }

  /**
   * 检查是否已解锁
   */
  isUnlocked() {
    if (!this.currentDriver) {
      return false;
    }

    return this.currentDriver.isDeviceUnlocked();
  }

  /**
   * 获取当前驱动类型
   */
  getDriverType() {
    return this.driverType;
  }

  /**
   * 获取当前驱动名称
   */
  getDriverName() {
    if (!this.currentDriver) {
      return null;
    }

    return this.currentDriver.getDriverName();
  }

  /**
   * 获取当前驱动版本
   */
  getDriverVersion() {
    if (!this.currentDriver) {
      return null;
    }

    return this.currentDriver.getDriverVersion();
  }

  /**
   * 关闭管理器
   */
  async close() {
    console.log('[UKeyManager] 关闭U盾管理器...');

    // 关闭所有驱动
    for (const driver of this.drivers.values()) {
      try {
        await driver.close();
      } catch (error) {
        console.error('[UKeyManager] 关闭驱动失败:', error);
      }
    }

    this.drivers.clear();
    this.currentDriver = null;
    this.isInitialized = false;

    this.emit('closed');
  }

  /**
   * 监听设备变化（热插拔）
   *
   * 使用轮询方式检测设备变化
   */
  startDeviceMonitor(interval = 5000) {
    console.log('[UKeyManager] 启动设备监听...');

    let lastDetected = false;

    this.monitorInterval = setInterval(async () => {
      try {
        const status = await this.detect();

        if (status.detected && !lastDetected) {
          // 设备插入
          this.emit('device-connected', status);
          lastDetected = true;
        } else if (!status.detected && lastDetected) {
          // 设备拔出
          this.emit('device-disconnected');
          lastDetected = false;

          // 自动锁定
          this.lock();
        }
      } catch (error) {
        console.error('[UKeyManager] 设备监听错误:', error);
      }
    }, interval);
  }

  /**
   * 停止设备监听
   */
  stopDeviceMonitor() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      console.log('[UKeyManager] 停止设备监听');
    }
  }
}

// 导出
module.exports = {
  UKeyManager,
  DriverTypes,
};
