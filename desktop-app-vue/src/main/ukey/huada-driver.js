/**
 * 华大（ChinaHuada）U盾驱动
 *
 * 基于SKF标准API
 * 支持华大智能卡芯片和U盾产品
 */

const SKFDriver = require('./skf-driver');
const path = require('path');
const fs = require('fs');

/**
 * 华大驱动类
 *
 * 支持的产品：
 * - 华大HD系列U盾
 * - 华大安全U盾（HDSK系列）
 * - 华大金融IC卡U盾
 */
class HuadaDriver extends SKFDriver {
  constructor(config = {}) {
    super(config);

    this.driverName = 'ChinaHuada';
    this.driverVersion = '1.0.0';
  }

  /**
   * 查找DLL路径
   *
   * 华大的DLL通常命名为：
   * - HDSKFAPI.dll
   * - ChinaHuada.dll
   * - HDCSP.dll
   */
  findDllPath() {
    if (process.platform !== 'win32') {
      console.warn('[Huada] Only Windows platform is supported');
      return null;
    }

    // 可能的DLL路径
    const possiblePaths = [
      // 项目资源目录
      path.join(__dirname, '../../../resources/native/huada/HDSKFAPI.dll'),
      path.join(__dirname, '../../../resources/native/huada/ChinaHuada.dll'),
      path.join(__dirname, '../../../resources/native/huada/HDCSP.dll'),

      // 系统目录
      'C:\\Windows\\System32\\HDSKFAPI.dll',
      'C:\\Windows\\System32\\ChinaHuada.dll',
      'C:\\Windows\\System32\\HDCSP.dll',
      'C:\\Windows\\SysWOW64\\HDSKFAPI.dll',
      'C:\\Windows\\SysWOW64\\ChinaHuada.dll',

      // 程序安装目录
      'C:\\Program Files\\ChinaHuada\\HDSKFAPI.dll',
      'C:\\Program Files (x86)\\ChinaHuada\\HDSKFAPI.dll',
      'C:\\Program Files\\ChinaHuada\\UKey\\HDSKFAPI.dll',
      'C:\\Program Files (x86)\\ChinaHuada\\UKey\\HDSKFAPI.dll',
      'C:\\Program Files\\Huada\\SecureKey\\HDSKFAPI.dll',
      'C:\\Program Files (x86)\\Huada\\SecureKey\\HDSKFAPI.dll',

      // 用户自定义路径
      path.join(process.cwd(), 'resources', 'native', 'HDSKFAPI.dll'),
      path.join(process.cwd(), 'native', 'HDSKFAPI.dll'),
    ];

    // 查找第一个存在的DLL
    for (const dllPath of possiblePaths) {
      if (fs.existsSync(dllPath)) {
        console.log(`[Huada] Found DLL: ${dllPath}`);
        return dllPath;
      }
    }

    console.warn('[Huada] DLL not found in any standard location');
    return null;
  }

  /**
   * 初始化驱动
   */
  async initialize() {
    console.log('[Huada] Initializing ChinaHuada driver...');

    try {
      // 调用父类初始化
      await super.initialize();

      // 华大特定初始化
      // 例如：加载特定配置、检查驱动版本等

      console.log('[Huada] ChinaHuada driver initialized successfully');
      return true;
    } catch (error) {
      console.error('[Huada] Initialization failed:', error);
      this.simulationMode = true;
      this.isInitialized = true;
      return true;
    }
  }

  /**
   * 获取制造商名称
   */
  getManufacturerName() {
    return '中国华大集成电路设计集团有限公司';
  }

  /**
   * 获取型号名称
   */
  getModelName() {
    return '华大HD系列U盾';
  }

  /**
   * 获取驱动名称
   */
  getDriverName() {
    return '华大U盾驱动';
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
   * 华大特定的检测逻辑
   */
  async detect() {
    console.log('[Huada] Detecting ChinaHuada device...');

    try {
      // 调用父类的检测方法
      const result = await super.detect();

      if (result.detected) {
        // 可以在这里添加华大特定的设备信息
        result.manufacturer = this.getManufacturerName();
        result.model = this.getModelName();
      }

      return result;
    } catch (error) {
      console.error('[Huada] Detection failed:', error);
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

    // 添加华大特定的信息
    info.manufacturer = this.getManufacturerName();
    info.model = this.getModelName();
    info.vendor = 'ChinaHuada';
    info.productLine = 'HD Series';
    info.chipType = 'SM2/SM3/SM4'; // 华大主要支持国密算法

    return info;
  }

  /**
   * 华大特定功能：读取设备序列号
   *
   * 注意：这需要SKF API的扩展支持
   */
  async getDeviceSerial() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    console.log('[Huada] Getting device serial number...');

    if (this.simulationMode) {
      // 模拟序列号
      return `HD${Date.now().toString().slice(-10)}`;
    }

    // 实际实现需要调用华大的扩展API
    // 这里先返回设备名作为序列号
    return this.deviceName || 'UNKNOWN';
  }

  /**
   * 华大特定功能：获取设备证书
   */
  async getDeviceCertificate() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    console.log('[Huada] Getting device certificate...');

    if (this.simulationMode) {
      return null;
    }

    // 实际实现需要调用SKF_ExportCertificate
    // 这里先返回null
    return null;
  }

  /**
   * 华大特定功能：检查设备健康状态
   */
  async checkDeviceHealth() {
    console.log('[Huada] Checking device health...');

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
   * 华大特定功能：获取芯片信息
   */
  async getChipInfo() {
    if (!this.deviceHandle) {
      throw new Error('设备未连接');
    }

    console.log('[Huada] Getting chip information...');

    if (this.simulationMode) {
      return {
        chipType: 'HD-SM2',
        version: '2.0',
        supportedAlgorithms: ['SM2', 'SM3', 'SM4'],
      };
    }

    // 实际实现需要调用华大特定的API
    // 这里先返回模拟数据
    return {
      chipType: 'HD-SM2',
      version: '2.0',
      supportedAlgorithms: ['SM2', 'SM3', 'SM4'],
    };
  }

  /**
   * 华大特定功能：国密算法支持检查
   */
  supportsSM() {
    // 华大U盾主要支持国密算法
    return {
      SM2: true,  // 国密非对称算法
      SM3: true,  // 国密哈希算法
      SM4: true,  // 国密对称算法
      SM9: false, // SM9 支持较少
    };
  }
}

module.exports = HuadaDriver;
