/**
 * 飞天诚信（FeiTian）U盾驱动
 *
 * 基于SKF标准API
 * 支持飞天诚信的ePass系列U盾
 */

const { logger, createLogger } = require('../utils/logger.js');
const SKFDriver = require('./skf-driver');
const path = require('path');
const fs = require('fs');

/**
 * 飞天诚信驱动类
 *
 * 支持的产品：
 * - ePass1000
 * - ePass2000
 * - ePass3000
 * - ePass NG系列
 */
class FeiTianDriver extends SKFDriver {
  constructor(config = {}) {
    super(config);

    this.driverName = 'FeiTian';
    this.driverVersion = '1.0.0';
  }

  /**
   * 查找DLL路径
   *
   * 飞天诚信的DLL通常命名为：
   * - ft2k.dll (FeiTian 2K系列)
   * - ShuttleCsp11_3003.dll
   * - FT_SKFAPI.dll
   */
  findDllPath() {
    if (process.platform !== 'win32') {
      logger.warn('[FeiTian] Only Windows platform is supported');
      return null;
    }

    // 可能的DLL路径
    const possiblePaths = [
      // 项目资源目录
      path.join(__dirname, '../../../resources/native/feitian/FT_SKFAPI.dll'),
      path.join(__dirname, '../../../resources/native/feitian/ft2k.dll'),
      path.join(__dirname, '../../../resources/native/feitian/ShuttleCsp11_3003.dll'),

      // 系统目录
      'C:\\Windows\\System32\\FT_SKFAPI.dll',
      'C:\\Windows\\System32\\ft2k.dll',
      'C:\\Windows\\System32\\ShuttleCsp11_3003.dll',
      'C:\\Windows\\SysWOW64\\FT_SKFAPI.dll',
      'C:\\Windows\\SysWOW64\\ft2k.dll',

      // 程序安装目录
      'C:\\Program Files\\FeiTian\\ePass\\FT_SKFAPI.dll',
      'C:\\Program Files (x86)\\FeiTian\\ePass\\FT_SKFAPI.dll',
      'C:\\Program Files\\FeiTian\\ePass\\ft2k.dll',
      'C:\\Program Files (x86)\\FeiTian\\ePass\\ft2k.dll',

      // 用户自定义路径
      path.join(process.cwd(), 'resources', 'native', 'FT_SKFAPI.dll'),
      path.join(process.cwd(), 'native', 'FT_SKFAPI.dll'),
    ];

    // 查找第一个存在的DLL
    for (const dllPath of possiblePaths) {
      if (fs.existsSync(dllPath)) {
        logger.info(`[FeiTian] Found DLL: ${dllPath}`);
        return dllPath;
      }
    }

    logger.warn('[FeiTian] DLL not found in any standard location');
    return null;
  }

  /**
   * 初始化驱动
   */
  async initialize() {
    logger.info('[FeiTian] Initializing FeiTian driver...');

    try {
      // 调用父类初始化
      await super.initialize();

      // 飞天诚信特定初始化
      // 例如：加载特定配置、检查驱动版本等

      logger.info('[FeiTian] FeiTian driver initialized successfully');
      return true;
    } catch (error) {
      logger.error('[FeiTian] Initialization failed:', error);
      this.simulationMode = true;
      this.isInitialized = true;
      return true;
    }
  }

  /**
   * 获取制造商名称
   */
  getManufacturerName() {
    return '飞天诚信科技股份有限公司';
  }

  /**
   * 获取型号名称
   */
  getModelName() {
    return 'FeiTian ePass系列';
  }

  /**
   * 获取驱动名称
   */
  getDriverName() {
    return '飞天诚信U盾驱动';
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
   * 飞天诚信特定的检测逻辑
   */
  async detect() {
    logger.info('[FeiTian] Detecting FeiTian device...');

    try {
      // 调用父类的检测方法
      const result = await super.detect();

      if (result.detected) {
        // 可以在这里添加飞天诚信特定的设备信息
        result.manufacturer = this.getManufacturerName();
        result.model = this.getModelName();
      }

      return result;
    } catch (error) {
      logger.error('[FeiTian] Detection failed:', error);
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

    // 添加飞天诚信特定的信息
    info.manufacturer = this.getManufacturerName();
    info.model = this.getModelName();
    info.vendor = 'FeiTian';
    info.productLine = 'ePass';

    return info;
  }

  /**
   * 飞天诚信特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持
   */
  async getDeviceSerial() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[FeiTian] Getting device serial number...');

    if (this.simulationMode) {
      // 模拟序列号
      return `FT${Date.now().toString().slice(-10)}`;
    }

    // 实际实现需要调用飞天诚信的扩展API
    // 这里先返回设备名作为序列号
    return this.deviceName || 'UNKNOWN';
  }

  /**
   * 飞天诚信特定功能：获取设备证书
   */
  async getDeviceCertificate() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[FeiTian] Getting device certificate...');

    if (this.simulationMode) {
      return null;
    }

    // 实际实现需要调用SKF_ExportCertificate
    // 这里先返回null
    return null;
  }

  /**
   * 飞天诚信特定功能：检查设备健康状态
   */
  async checkDeviceHealth() {
    logger.info('[FeiTian] Checking device health...');

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
}

module.exports = FeiTianDriver;
