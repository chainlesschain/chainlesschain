/**
 * U盾管理器
 *
 * 统一管理多种U盾驱动
 * 支持国产U盾（鑫金科、飞天、握奇、华大、天地融）
 * 支持跨平台 PKCS#11 标准驱动
 */

const { logger, createLogger } = require('../utils/logger.js');
const XinJinKeDriver = require("./xinjinke-driver");
const FeiTianDriver = require("./feitian-driver");
const WatchDataDriver = require("./watchdata-driver");
const HuadaDriver = require("./huada-driver");
const TDRDriver = require("./tdr-driver");
const SimulatedDriver = require("./simulated-driver");
const PKCS11Driver = require("./pkcs11-driver");
const EventEmitter = require("events");
const os = require("os");

/**
 * U盾驱动类型
 */
const DriverTypes = {
  XINJINKE: "xinjinke",
  FEITIAN: "feitian",
  WATCHDATA: "watchdata",
  HUADA: "huada",
  TDR: "tdr",
  PKCS11: "pkcs11", // 跨平台 PKCS#11 标准
  SIMULATED: "simulated",
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

    // Normalize config - handle null/undefined
    this.config = config || {};
    this.currentDriver = null;
    this.driverType = this.config.driverType || DriverTypes.XINJINKE;
    this.isInitialized = false;

    // 驱动实例缓存
    this.drivers = new Map();
  }

  /**
   * 初始化管理器
   */
  async initialize() {
    // logger.info('[UKeyManager] 初始化U盾管理器...');

    // 创建驱动实例
    this.currentDriver = await this.createDriver(this.driverType);

    // 初始化驱动
    await this.currentDriver.initialize();

    this.isInitialized = true;
    // logger.info('[UKeyManager] U盾管理器初始化成功');

    // 发射初始化事件
    this.emit("initialized");

    return true;
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
        driver = new FeiTianDriver(this.config);
        break;

      case DriverTypes.WATCHDATA:
        driver = new WatchDataDriver(this.config);
        break;

      case DriverTypes.HUADA:
        driver = new HuadaDriver(this.config);
        break;

      case DriverTypes.TDR:
        driver = new TDRDriver(this.config);
        break;

      case DriverTypes.PKCS11:
        driver = new PKCS11Driver(this.config);
        break;

      case DriverTypes.SIMULATED:
        driver = new SimulatedDriver(this.config);
        break;

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
    // logger.info('[UKeyManager] 切换驱动类型:', driverType);

    // 关闭当前驱动
    if (this.currentDriver) {
      await this.currentDriver.close();
    }

    // 创建并初始化新驱动
    this.currentDriver = await this.createDriver(driverType);
    await this.currentDriver.initialize();

    this.driverType = driverType;

    // 发射驱动切换事件
    this.emit("driver-changed", driverType);

    // logger.info('[UKeyManager] 驱动切换成功');
    return true;
  }

  /**
   * 自动检测U盾类型
   *
   * 尝试不同的驱动，看哪个能成功检测到设备
   * Windows: 优先使用国产驱动，然后 PKCS#11
   * macOS/Linux: 优先使用 PKCS#11（跨平台支持）
   */
  async autoDetect() {
    // logger.info('[UKeyManager] 自动检测U盾类型...');

    const platform = os.platform();
    let driverTypes;

    if (platform === "win32") {
      // Windows: 国产驱动优先
      driverTypes = [
        DriverTypes.XINJINKE, // 鑫金科
        DriverTypes.FEITIAN, // 飞天诚信
        DriverTypes.WATCHDATA, // 握奇（卫士通）
        DriverTypes.HUADA, // 华大
        DriverTypes.TDR, // 天地融
        DriverTypes.PKCS11, // PKCS#11 作为后备
      ];
    } else {
      // macOS/Linux: PKCS#11 优先（跨平台支持最好）
      driverTypes = [
        DriverTypes.PKCS11, // PKCS#11 跨平台标准
      ];
    }

    for (const type of driverTypes) {
      try {
        const driver = await this.createDriver(type);
        await driver.initialize();

        const status = await driver.detect();

        if (status.detected) {
          // logger.info('[UKeyManager] 检测到U盾:', type);
          this.currentDriver = driver;
          this.driverType = type;

          this.emit("device-detected", { driverType: type, status });

          return {
            detected: true,
            driverType: type,
            status,
          };
        }
      } catch (error) {
        // logger.info(`[UKeyManager] ${type} 检测失败:`, error.message);
        // 继续尝试下一个
      }
    }

    // logger.info('[UKeyManager] 未检测到任何U盾设备');
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
      // 在非Windows平台上，返回未检测到设备的状态，而不是抛出错误
      return {
        detected: false,
        reason: "driver_not_initialized",
        message: "U-Key driver not available on this platform (Windows only)",
        platform: process.platform,
      };
    }

    const status = await this.currentDriver.detect();

    if (status.detected) {
      this.emit("device-detected", status);
    } else {
      this.emit("device-not-found");
    }

    return status;
  }

  /**
   * 验证PIN码
   */
  async verifyPIN(pin) {
    if (!this.currentDriver) {
      return {
        success: false,
        reason: "driver_not_initialized",
        message: "U-Key driver not available on this platform (Windows only)",
      };
    }

    const result = await this.currentDriver.verifyPIN(pin);

    if (result?.success) {
      this.emit("unlocked", result);
    } else {
      this.emit("unlock-failed", result || { success: false, reason: "no_result" });
    }

    return result || { success: false, reason: "no_result" };
  }

  /**
   * 数字签名
   */
  async sign(data) {
    if (!this.currentDriver) {
      return {
        success: false,
        reason: "driver_not_initialized",
        message: "U-Key driver not available on this platform (Windows only)",
      };
    }

    if (!this.currentDriver.isDeviceUnlocked()) {
      return {
        success: false,
        reason: "device_locked",
        message: "U-Key device is locked",
      };
    }

    return await this.currentDriver.sign(data);
  }

  /**
   * 验证签名
   */
  async verifySignature(data, signature) {
    if (!this.currentDriver) {
      return {
        success: false,
        reason: "driver_not_initialized",
        message: "U-Key driver not available on this platform (Windows only)",
      };
    }

    return await this.currentDriver.verifySignature(data, signature);
  }

  /**
   * 加密数据
   */
  async encrypt(data) {
    if (!this.currentDriver) {
      return {
        success: false,
        reason: "driver_not_initialized",
        message: "U-Key driver not available on this platform (Windows only)",
      };
    }

    if (!this.currentDriver.isDeviceUnlocked()) {
      return {
        success: false,
        reason: "device_locked",
        message: "U-Key device is locked",
      };
    }

    return await this.currentDriver.encrypt(data);
  }

  /**
   * 解密数据
   */
  async decrypt(encryptedData) {
    if (!this.currentDriver) {
      return {
        success: false,
        reason: "driver_not_initialized",
        message: "U-Key driver not available on this platform (Windows only)",
      };
    }

    if (!this.currentDriver.isDeviceUnlocked()) {
      return {
        success: false,
        reason: "device_locked",
        message: "U-Key device is locked",
      };
    }

    return await this.currentDriver.decrypt(encryptedData);
  }

  /**
   * 获取公钥
   */
  async getPublicKey() {
    if (!this.currentDriver) {
      throw new Error("驱动未初始化");
    }

    return await this.currentDriver.getPublicKey();
  }

  /**
   * 获取设备信息
   */
  async getDeviceInfo() {
    if (!this.currentDriver) {
      throw new Error("驱动未初始化");
    }

    return await this.currentDriver.getDeviceInfo();
  }

  /**
   * 锁定U盾
   */
  lock() {
    if (this.currentDriver) {
      this.currentDriver.lock();
      this.emit("locked");
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
    // logger.info('[UKeyManager] 关闭U盾管理器...');

    // 关闭所有驱动
    for (const driver of this.drivers.values()) {
      try {
        await driver.close();
      } catch (error) {
        // logger.error('[UKeyManager] 关闭驱动失败:', error);
      }
    }

    this.drivers.clear();
    this.currentDriver = null;
    this.isInitialized = false;

    this.emit("closed");
  }

  /**
   * 监听设备变化（热插拔）
   *
   * 使用轮询方式检测设备变化
   */
  startDeviceMonitor(interval = 5000) {
    // logger.info('[UKeyManager] 启动设备监听...');

    let lastDetected = false;

    this.monitorInterval = setInterval(async () => {
      try {
        const status = await this.detect();

        if (status.detected && !lastDetected) {
          // 设备插入
          this.emit("device-connected", status);
          lastDetected = true;
        } else if (!status.detected && lastDetected) {
          // 设备拔出
          this.emit("device-disconnected");
          lastDetected = false;

          // 自动锁定
          this.lock();
        }
      } catch (error) {
        // logger.error('[UKeyManager] 设备监听错误:', error);
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
      // logger.info('[UKeyManager] 停止设备监听');
    }
  }
}

// 导出
module.exports = {
  UKeyManager,
  DriverTypes,
};
