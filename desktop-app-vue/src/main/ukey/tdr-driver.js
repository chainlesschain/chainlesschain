/**
 * 天地融（TDR）U盾驱动
 *
 * 基于SKF标准API
 * 支持天地融支付密码器和U盾产品
 */

const { logger, createLogger } = require('../utils/logger.js');
const SKFDriver = require('./skf-driver');
const path = require('path');
const fs = require('fs');

/**
 * 天地融驱动类
 *
 * 支持的产品：
 * - TDR支付密码器
 * - TDR SecureKey系列
 * - TDR金融USB Key
 */
class TDRDriver extends SKFDriver {
  constructor(config = {}) {
    super(config);

    this.driverName = 'TDR';
    this.driverVersion = '1.0.0';
  }

  /**
   * 查找DLL路径
   *
   * 天地融的DLL通常命名为：
   * - TDRSKFAPI.dll
   * - TDR_CSP.dll
   * - TianDiRong.dll
   */
  findDllPath() {
    if (process.platform !== 'win32') {
      logger.warn('[TDR] Only Windows platform is supported');
      return null;
    }

    // 可能的DLL路径
    const possiblePaths = [
      // 项目资源目录
      path.join(__dirname, '../../../resources/native/tdr/TDRSKFAPI.dll'),
      path.join(__dirname, '../../../resources/native/tdr/TDR_CSP.dll'),
      path.join(__dirname, '../../../resources/native/tdr/TianDiRong.dll'),

      // 系统目录
      'C:\\Windows\\System32\\TDRSKFAPI.dll',
      'C:\\Windows\\System32\\TDR_CSP.dll',
      'C:\\Windows\\System32\\TianDiRong.dll',
      'C:\\Windows\\SysWOW64\\TDRSKFAPI.dll',
      'C:\\Windows\\SysWOW64\\TDR_CSP.dll',

      // 程序安装目录
      'C:\\Program Files\\TDR\\TDRSKFAPI.dll',
      'C:\\Program Files (x86)\\TDR\\TDRSKFAPI.dll',
      'C:\\Program Files\\TDR\\SecureKey\\TDRSKFAPI.dll',
      'C:\\Program Files (x86)\\TDR\\SecureKey\\TDRSKFAPI.dll',
      'C:\\Program Files\\TianDiRong\\TDRSKFAPI.dll',
      'C:\\Program Files (x86)\\TianDiRong\\TDRSKFAPI.dll',
      'C:\\Program Files\\TianDiRong\\UKey\\TDRSKFAPI.dll',
      'C:\\Program Files (x86)\\TianDiRong\\UKey\\TDRSKFAPI.dll',

      // 用户自定义路径
      path.join(process.cwd(), 'resources', 'native', 'TDRSKFAPI.dll'),
      path.join(process.cwd(), 'native', 'TDRSKFAPI.dll'),
    ];

    // 查找第一个存在的DLL
    for (const dllPath of possiblePaths) {
      if (fs.existsSync(dllPath)) {
        logger.info(`[TDR] Found DLL: ${dllPath}`);
        return dllPath;
      }
    }

    logger.warn('[TDR] DLL not found in any standard location');
    return null;
  }

  /**
   * 初始化驱动
   */
  async initialize() {
    logger.info('[TDR] Initializing TDR driver...');

    try {
      // 调用父类初始化
      await super.initialize();

      // 天地融特定初始化
      // 例如：加载特定配置、检查驱动版本等

      logger.info('[TDR] TDR driver initialized successfully');
      return true;
    } catch (error) {
      logger.error('[TDR] Initialization failed:', error);
      this.simulationMode = true;
      this.isInitialized = true;
      return true;
    }
  }

  /**
   * 获取制造商名称
   */
  getManufacturerName() {
    return '深圳市天地融科技股份有限公司';
  }

  /**
   * 获取型号名称
   */
  getModelName() {
    return '天地融SecureKey系列';
  }

  /**
   * 获取驱动名称
   */
  getDriverName() {
    return '天地融U盾驱动';
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
   * 天地融特定的检测逻辑
   */
  async detect() {
    logger.info('[TDR] Detecting TDR device...');

    try {
      // 调用父类的检测方法
      const result = await super.detect();

      if (result.detected) {
        // 可以在这里添加天地融特定的设备信息
        result.manufacturer = this.getManufacturerName();
        result.model = this.getModelName();
      }

      return result;
    } catch (error) {
      logger.error('[TDR] Detection failed:', error);
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

    // 添加天地融特定的信息
    info.manufacturer = this.getManufacturerName();
    info.model = this.getModelName();
    info.vendor = 'TDR';
    info.productLine = 'SecureKey';
    info.industry = 'Payment'; // 支付行业

    return info;
  }

  /**
   * 天地融特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持
   */
  async getDeviceSerial() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[TDR] Getting device serial number...');

    if (this.simulationMode) {
      // 模拟序列号
      return `TDR${Date.now().toString().slice(-10)}`;
    }

    // 实际实现需要调用天地融的扩展API
    // 这里先返回设备名作为序列号
    return this.deviceName || 'UNKNOWN';
  }

  /**
   * 天地融特定功能：获取设备证书
   */
  async getDeviceCertificate() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[TDR] Getting device certificate...');

    if (this.simulationMode) {
      return null;
    }

    // 实际实现需要调用SKF_ExportCertificate
    // 这里先返回null
    return null;
  }

  /**
   * 天地融特定功能：检查设备健康状态
   */
  async checkDeviceHealth() {
    logger.info('[TDR] Checking device health...');

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
   * 天地融特定功能：支付密码器模式
   *
   * 天地融设备常用于支付场景，支持PIN输入保护
   */
  async enablePaymentMode() {
    logger.info('[TDR] Enabling payment mode...');

    if (this.simulationMode) {
      return { enabled: true, mode: 'payment' };
    }

    // 实际实现需要调用天地融特定的API
    // 启用支付密码器保护模式
    return { enabled: true, mode: 'payment' };
  }

  /**
   * 天地融特定功能：获取交易计数器
   *
   * 用于支付场景的交易计数
   */
  async getTransactionCounter() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[TDR] Getting transaction counter...');

    if (this.simulationMode) {
      // 模拟交易计数
      return {
        counter: 12345,
        maxCount: 1000000,
      };
    }

    // 实际实现需要调用天地融特定的API
    return {
      counter: 0,
      maxCount: 1000000,
    };
  }

  /**
   * 天地融特定功能：重置交易计数器
   */
  async resetTransactionCounter() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[TDR] Resetting transaction counter...');

    if (this.simulationMode) {
      return { success: true, counter: 0 };
    }

    // 实际实现需要调用天地融特定的API
    return { success: true, counter: 0 };
  }
}

module.exports = TDRDriver;
