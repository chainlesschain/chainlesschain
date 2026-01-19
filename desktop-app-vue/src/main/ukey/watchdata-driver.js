/**
 * 握奇（WatchData）U盾驱动
 *
 * 基于SKF标准API
 * 支持握奇的各系列U盾产品
 */

const { logger, createLogger } = require('../utils/logger.js');
const SKFDriver = require('./skf-driver');
const path = require('path');
const fs = require('fs');

/**
 * 握奇驱动类
 *
 * 支持的产品：
 * - WatchKey系列
 * - TimeCOS系列
 * - 握奇金融USB Key
 */
class WatchDataDriver extends SKFDriver {
  constructor(config = {}) {
    super(config);

    this.driverName = 'WatchData';
    this.driverVersion = '1.0.0';
  }

  /**
   * 查找DLL路径
   *
   * 握奇的DLL通常命名为：
   * - WDSKFAPI.dll
   * - WatchData.dll
   * - TimeCOS.dll
   */
  findDllPath() {
    if (process.platform !== 'win32') {
      logger.warn('[WatchData] Only Windows platform is supported');
      return null;
    }

    // 可能的DLL路径
    const possiblePaths = [
      // 项目资源目录
      path.join(__dirname, '../../../resources/native/watchdata/WDSKFAPI.dll'),
      path.join(__dirname, '../../../resources/native/watchdata/WatchData.dll'),
      path.join(__dirname, '../../../resources/native/watchdata/TimeCOS.dll'),

      // 系统目录
      'C:\\Windows\\System32\\WDSKFAPI.dll',
      'C:\\Windows\\System32\\WatchData.dll',
      'C:\\Windows\\System32\\TimeCOS.dll',
      'C:\\Windows\\SysWOW64\\WDSKFAPI.dll',
      'C:\\Windows\\SysWOW64\\WatchData.dll',

      // 程序安装目录
      'C:\\Program Files\\WatchData\\WDSKFAPI.dll',
      'C:\\Program Files (x86)\\WatchData\\WDSKFAPI.dll',
      'C:\\Program Files\\WatchData\\WatchKey\\WDSKFAPI.dll',
      'C:\\Program Files (x86)\\WatchData\\WatchKey\\WDSKFAPI.dll',
      'C:\\Program Files\\WatchData\\TimeCOS\\TimeCOS.dll',
      'C:\\Program Files (x86)\\WatchData\\TimeCOS\\TimeCOS.dll',

      // 用户自定义路径
      path.join(process.cwd(), 'resources', 'native', 'WDSKFAPI.dll'),
      path.join(process.cwd(), 'native', 'WDSKFAPI.dll'),
    ];

    // 查找第一个存在的DLL
    for (const dllPath of possiblePaths) {
      if (fs.existsSync(dllPath)) {
        logger.info(`[WatchData] Found DLL: ${dllPath}`);
        return dllPath;
      }
    }

    logger.warn('[WatchData] DLL not found in any standard location');
    return null;
  }

  /**
   * 初始化驱动
   */
  async initialize() {
    logger.info('[WatchData] Initializing WatchData driver...');

    try {
      // 调用父类初始化
      await super.initialize();

      // 握奇特定初始化
      // 例如：加载特定配置、检查驱动版本等

      logger.info('[WatchData] WatchData driver initialized successfully');
      return true;
    } catch (error) {
      logger.error('[WatchData] Initialization failed:', error);
      this.simulationMode = true;
      this.isInitialized = true;
      return true;
    }
  }

  /**
   * 获取制造商名称
   */
  getManufacturerName() {
    return '北京握奇数据股份有限公司';
  }

  /**
   * 获取型号名称
   */
  getModelName() {
    return 'WatchData WatchKey系列';
  }

  /**
   * 获取驱动名称
   */
  getDriverName() {
    return '握奇U盾驱动';
  }

  /**
   * 获取驱动版本
   */
  getDriverVersion() {
    return this.driverVersion;
  }

  /**
   * 检测设备
   *
   * 握奇特定的检测逻辑
   */
  async detect() {
    logger.info('[WatchData] Detecting WatchData device...');

    try {
      // 调用父类的检测方法
      const result = await super.detect();

      if (result.detected) {
        // 可以在这里添加握奇特定的设备信息
        result.manufacturer = this.getManufacturerName();
        result.model = this.getModelName();
      }

      return result;
    } catch (error) {
      logger.error('[WatchData] Detection failed:', error);
      return {
        detected: false,
        unlocked: false,
      };
    }
  }

  /**
   * 模拟检测（用于开发测试）
   */
  simulateDetect() {
    // 在模拟模式下，可以选择性地返回检测成功
    // 方便开发和测试
    return {
      detected: false, // 默认不检测到，避免误报
      unlocked: false,
      manufacturer: this.getManufacturerName(),
      model: this.getModelName(),
    };
  }

  /**
   * 获取设备信息
   */
  async getDeviceInfo() {
    const info = await super.getDeviceInfo();

    // 添加握奇特定的信息
    info.manufacturer = this.getManufacturerName();
    info.model = this.getModelName();
    info.vendor = 'WatchData';
    info.productLine = 'WatchKey';

    return info;
  }

  /**
   * 握奇特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持
   */
  async getDeviceSerial() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[WatchData] Getting device serial number...');

    if (this.simulationMode) {
      // 模拟序列号
      return `WD${Date.now().toString().slice(-10)}`;
    }

    // 实际实现需要调用握奇的扩展API
    // 这里先返回设备名作为序列号
    return this.deviceName || 'UNKNOWN';
  }

  /**
   * 握奇特定功能：获取设备证书
   */
  async getDeviceCertificate() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[WatchData] Getting device certificate...');

    if (this.simulationMode) {
      return null;
    }

    // 实际实现需要调用SKF_ExportCertificate
    // 这里先返回null
    return null;
  }

  /**
   * 握奇特定功能：检查设备健康状态
   */
  async checkDeviceHealth() {
    logger.info('[WatchData] Checking device health...');

    try {
      if (this.simulationMode) {
        return {
          healthy: true,
          status: 'simulation',
        };
      }

      // 尝试连接设备
      const detected = await this.detect();

      if (!detected.detected) {
        return {
          healthy: false,
          status: 'not_connected',
        };
      }

      return {
        healthy: true,
        status: 'ok',
      };
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        error: error.message,
      };
    }
  }

  /**
   * 握奇特定功能：设置设备标签
   */
  async setDeviceLabel(label) {
    if (!this.deviceHandle) {
      throw new Error('设备未连接');
    }

    logger.info('[WatchData] Setting device label:', label);

    if (this.simulationMode) {
      return true;
    }

    // 实际实现需要调用SKF_SetLabel
    // 这里先返回成功
    return true;
  }
}

module.exports = WatchDataDriver;
