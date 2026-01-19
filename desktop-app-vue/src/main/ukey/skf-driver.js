/**
 * SKF标准驱动基类
 *
 * 基于中国国家标准 GM/T 0016-2012（智能密码钥匙应用接口规范）
 *
 * 此基类实现了SKF API的核心功能，供飞天诚信、握奇等厂商驱动继承使用
 */

const { logger, createLogger } = require('../utils/logger.js');
const BaseUKeyDriver = require('./base-driver');
const koffi = require('koffi');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

/**
 * SKF错误码
 */
const SKF_ERROR_CODES = {
  SAR_OK: 0x00000000,                    // 成功
  SAR_FAIL: 0x0A000001,                  // 失败
  SAR_UNKNOWNER: 0x0A000002,             // 异常错误
  SAR_NOSUPPORTYETERR: 0x0A000003,       // 不支持的服务
  SAR_INVALIDHANDLEERR: 0x0A000005,      // 无效的句柄
  SAR_INVALIDPARAMERR: 0x0A000006,       // 无效的参数
  SAR_NOTINITIALIZEERR: 0x0A00000C,      // 未初始化
  SAR_PIN_INCORRECT: 0x0A000024,         // PIN不正确
  SAR_PIN_LOCKED: 0x0A000025,            // PIN被锁定
  SAR_PIN_INVALID: 0x0A000026,           // PIN无效
  SAR_USER_NOT_LOGGED_IN: 0x0A00002D,    // 用户未登录
  SAR_APPLICATION_NOT_EXISTS: 0x0A00002E,// 应用不存在
  SAR_FILE_NOT_EXIST: 0x0A000031,        // 文件不存在
};

/**
 * SKF驱动基类
 *
 * 实现SKF标准API的封装和调用
 */
class SKFDriver extends BaseUKeyDriver {
  constructor(config = {}) {
    super(config);

    // DLL库路径
    this.dllPath = config.dllPath || this.findDllPath();
    this.lib = null;

    // 设备句柄
    this.deviceHandle = null;
    this.applicationHandle = null;
    this.containerHandle = null;

    // 设备信息
    this.deviceName = null;
    this.applicationName = config.applicationName || 'ChainlessChain';
    this.containerName = config.containerName || 'DefaultContainer';

    // PIN码信息
    this.adminPin = config.adminPin || '12345678';
    this.userPin = config.userPin || '12345678';
    this.maxRetryCount = 6;

    // 模拟模式
    this.simulationMode = false;
  }

  /**
   * 查找DLL路径
   * 子类应该重写此方法以指定具体的DLL文件名
   */
  findDllPath() {
    throw new Error('findDllPath() must be implemented by subclass');
  }

  /**
   * 加载DLL库
   */
  loadLibrary() {
    if (this.lib) {
      return true;
    }

    try {
      if (!this.dllPath || !fs.existsSync(this.dllPath)) {
        logger.warn(`[SKF] DLL not found: ${this.dllPath}, using simulation mode`);
        this.simulationMode = true;
        return false;
      }

      // 加载DLL
      this.lib = koffi.load(this.dllPath);

      // 绑定SKF API函数
      this.bindSKFFunctions();

      logger.info(`[SKF] Library loaded successfully: ${this.dllPath}`);
      return true;
    } catch (error) {
      logger.error('[SKF] Failed to load library:', error.message);
      this.simulationMode = true;
      return false;
    }
  }

  /**
   * 绑定SKF API函数
   */
  bindSKFFunctions() {
    try {
      // 设备管理
      this.SKF_EnumDev = this.lib.func('SKF_EnumDev', 'uint32', ['bool', koffi.out(koffi.pointer('char', 1024)), koffi.out(koffi.pointer('uint32'))]);
      this.SKF_ConnectDev = this.lib.func('SKF_ConnectDev', 'uint32', ['string', koffi.out(koffi.pointer('void*'))]);
      this.SKF_DisConnectDev = this.lib.func('SKF_DisConnectDev', 'uint32', ['void*']);
      this.SKF_GetDevState = this.lib.func('SKF_GetDevState', 'uint32', ['string', koffi.out(koffi.pointer('uint32'))]);

      // 应用管理
      this.SKF_CreateApplication = this.lib.func('SKF_CreateApplication', 'uint32', [
        'void*', 'string', 'string', 'uint32', 'string', 'uint32', 'uint32', koffi.out(koffi.pointer('void*'))
      ]);
      this.SKF_EnumApplication = this.lib.func('SKF_EnumApplication', 'uint32', ['void*', koffi.out(koffi.pointer('char', 1024)), koffi.out(koffi.pointer('uint32'))]);
      this.SKF_OpenApplication = this.lib.func('SKF_OpenApplication', 'uint32', ['void*', 'string', koffi.out(koffi.pointer('void*'))]);
      this.SKF_CloseApplication = this.lib.func('SKF_CloseApplication', 'uint32', ['void*']);
      this.SKF_DeleteApplication = this.lib.func('SKF_DeleteApplication', 'uint32', ['void*', 'string']);

      // PIN管理
      this.SKF_VerifyPIN = this.lib.func('SKF_VerifyPIN', 'uint32', ['void*', 'uint32', 'string', koffi.out(koffi.pointer('uint32'))]);
      this.SKF_ChangePIN = this.lib.func('SKF_ChangePIN', 'uint32', ['void*', 'uint32', 'string', 'string', koffi.out(koffi.pointer('uint32'))]);
      this.SKF_GetPINInfo = this.lib.func('SKF_GetPINInfo', 'uint32', ['void*', 'uint32', koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('uint32')), koffi.out(koffi.pointer('bool'))]);

      // 容器管理
      this.SKF_CreateContainer = this.lib.func('SKF_CreateContainer', 'uint32', ['void*', 'string', koffi.out(koffi.pointer('void*'))]);
      this.SKF_OpenContainer = this.lib.func('SKF_OpenContainer', 'uint32', ['void*', 'string', koffi.out(koffi.pointer('void*'))]);
      this.SKF_CloseContainer = this.lib.func('SKF_CloseContainer', 'uint32', ['void*']);
      this.SKF_DeleteContainer = this.lib.func('SKF_DeleteContainer', 'uint32', ['void*', 'string']);
      this.SKF_EnumContainer = this.lib.func('SKF_EnumContainer', 'uint32', ['void*', koffi.out(koffi.pointer('char', 1024)), koffi.out(koffi.pointer('uint32'))]);

      // 随机数生成
      this.SKF_GenRandom = this.lib.func('SKF_GenRandom', 'uint32', ['void*', koffi.out(koffi.pointer('uint8')), 'uint32']);

      logger.info('[SKF] SKF functions bound successfully');
    } catch (error) {
      logger.error('[SKF] Failed to bind SKF functions:', error);
      throw error;
    }
  }

  /**
   * 初始化驱动
   */
  async initialize() {
    logger.info('[SKF] Initializing SKF driver...');

    try {
      // 加载DLL库
      const loaded = this.loadLibrary();

      if (!loaded) {
        logger.warn('[SKF] Running in simulation mode');
        this.simulationMode = true;
      }

      this.isInitialized = true;
      logger.info('[SKF] Driver initialized successfully');
      return true;
    } catch (error) {
      logger.error('[SKF] Initialization failed:', error);
      this.simulationMode = true;
      this.isInitialized = true; // 使用模拟模式继续
      return true;
    }
  }

  /**
   * 检测设备
   */
  async detect() {
    logger.info('[SKF] Detecting device...');

    try {
      if (this.simulationMode) {
        return this.simulateDetect();
      }

      // 枚举设备
      const devices = await this.enumerateDevices();

      if (devices.length === 0) {
        return {
          detected: false,
          unlocked: false,
        };
      }

      // 使用第一个设备
      this.deviceName = devices[0];

      // 连接设备
      const connected = await this.connectDevice(this.deviceName);

      if (!connected) {
        return {
          detected: false,
          unlocked: false,
        };
      }

      return {
        detected: true,
        unlocked: this.isUnlocked,
        deviceId: this.deviceName,
        manufacturer: this.getManufacturerName(),
        model: this.getModelName(),
      };
    } catch (error) {
      logger.error('[SKF] Detection failed:', error);
      return {
        detected: false,
        unlocked: false,
      };
    }
  }

  /**
   * 枚举设备
   */
  async enumerateDevices() {
    if (this.simulationMode) {
      return [];
    }

    try {
      const nameBuffer = Buffer.alloc(1024);
      const sizePtr = Buffer.alloc(4);
      sizePtr.writeUInt32LE(1024, 0);

      const result = this.SKF_EnumDev(true, nameBuffer, sizePtr);

      if (result !== SKF_ERROR_CODES.SAR_OK) {
        logger.error('[SKF] Failed to enumerate devices:', result);
        return [];
      }

      const deviceNames = nameBuffer.toString('utf8').split('\0').filter(name => name.length > 0);
      logger.info('[SKF] Found devices:', deviceNames);

      return deviceNames;
    } catch (error) {
      logger.error('[SKF] Failed to enumerate devices:', error);
      return [];
    }
  }

  /**
   * 连接设备
   */
  async connectDevice(deviceName) {
    if (this.simulationMode) {
      this.deviceHandle = 'simulated-device-handle';
      return true;
    }

    try {
      const handlePtr = Buffer.alloc(8);
      const result = this.SKF_ConnectDev(deviceName, handlePtr);

      if (result !== SKF_ERROR_CODES.SAR_OK) {
        logger.error('[SKF] Failed to connect device:', result);
        return false;
      }

      this.deviceHandle = handlePtr.readBigUInt64LE(0);
      logger.info('[SKF] Device connected successfully');
      return true;
    } catch (error) {
      logger.error('[SKF] Failed to connect device:', error);
      return false;
    }
  }

  /**
   * 验证PIN码
   */
  async verifyPIN(pin) {
    logger.info('[SKF] Verifying PIN...');

    try {
      if (!this.deviceHandle) {
        const status = await this.detect();
        if (!status.detected) {
          return {
            success: false,
            error: '设备未检测到',
          };
        }
      }

      if (this.simulationMode) {
        return this.simulateVerifyPIN(pin);
      }

      // 打开或创建应用
      await this.openOrCreateApplication();

      // 验证用户PIN
      const retryCountPtr = Buffer.alloc(4);
      const result = this.SKF_VerifyPIN(this.applicationHandle, 1, pin, retryCountPtr);

      if (result === SKF_ERROR_CODES.SAR_OK) {
        this.isUnlocked = true;
        logger.info('[SKF] PIN verification successful');

        // 打开或创建容器
        await this.openOrCreateContainer();

        return {
          success: true,
          remainingAttempts: null,
        };
      } else if (result === SKF_ERROR_CODES.SAR_PIN_INCORRECT) {
        const remainingAttempts = retryCountPtr.readUInt32LE(0);
        logger.info('[SKF] PIN verification failed, remaining attempts:', remainingAttempts);

        return {
          success: false,
          error: 'PIN码错误',
          remainingAttempts: remainingAttempts,
        };
      } else if (result === SKF_ERROR_CODES.SAR_PIN_LOCKED) {
        return {
          success: false,
          error: 'PIN已被锁定',
          remainingAttempts: 0,
        };
      } else {
        return {
          success: false,
          error: `验证失败: ${result}`,
        };
      }
    } catch (error) {
      logger.error('[SKF] PIN verification error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 打开或创建应用
   */
  async openOrCreateApplication() {
    if (this.simulationMode) {
      this.applicationHandle = 'simulated-app-handle';
      return true;
    }

    try {
      // 尝试打开应用
      const handlePtr = Buffer.alloc(8);
      let result = this.SKF_OpenApplication(this.deviceHandle, this.applicationName, handlePtr);

      if (result === SKF_ERROR_CODES.SAR_APPLICATION_NOT_EXISTS) {
        // 应用不存在，创建新应用
        logger.info('[SKF] Application does not exist, creating...');
        result = this.SKF_CreateApplication(
          this.deviceHandle,
          this.applicationName,
          this.adminPin,
          this.maxRetryCount,
          this.userPin,
          this.maxRetryCount,
          0x00000001, // 创建文件权限
          handlePtr
        );

        if (result !== SKF_ERROR_CODES.SAR_OK) {
          throw new Error(`Failed to create application: ${result}`);
        }
      } else if (result !== SKF_ERROR_CODES.SAR_OK) {
        throw new Error(`Failed to open application: ${result}`);
      }

      this.applicationHandle = handlePtr.readBigUInt64LE(0);
      logger.info('[SKF] Application opened successfully');
      return true;
    } catch (error) {
      logger.error('[SKF] Failed to open/create application:', error);
      throw error;
    }
  }

  /**
   * 打开或创建容器
   */
  async openOrCreateContainer() {
    if (this.simulationMode) {
      this.containerHandle = 'simulated-container-handle';
      return true;
    }

    try {
      // 尝试打开容器
      const handlePtr = Buffer.alloc(8);
      let result = this.SKF_OpenContainer(this.applicationHandle, this.containerName, handlePtr);

      if (result !== SKF_ERROR_CODES.SAR_OK) {
        // 容器不存在，创建新容器
        logger.info('[SKF] Container does not exist, creating...');
        result = this.SKF_CreateContainer(this.applicationHandle, this.containerName, handlePtr);

        if (result !== SKF_ERROR_CODES.SAR_OK) {
          throw new Error(`Failed to create container: ${result}`);
        }
      }

      this.containerHandle = handlePtr.readBigUInt64LE(0);
      logger.info('[SKF] Container opened successfully');
      return true;
    } catch (error) {
      logger.error('[SKF] Failed to open/create container:', error);
      throw error;
    }
  }

  /**
   * 数字签名
   */
  async sign(data) {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[SKF] Signing data...');

    if (this.simulationMode) {
      return this.simulateSign(data);
    }

    // 使用容器中的私钥进行签名
    // 这里简化实现，实际应该调用SKF_RSASignData或SKF_ECCSignData
    const hash = crypto.createHash('sha256').update(data).digest();
    return hash.toString('base64');
  }

  /**
   * 验证签名
   */
  async verifySignature(data, signature) {
    logger.info('[SKF] Verifying signature...');

    if (this.simulationMode) {
      return this.simulateVerifySignature(data, signature);
    }

    const expectedSignature = await this.sign(data);
    return expectedSignature === signature;
  }

  /**
   * 加密数据
   */
  async encrypt(data) {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[SKF] Encrypting data...');

    if (this.simulationMode) {
      return this.simulateEncrypt(data);
    }

    // 简化实现：使用AES加密
    const key = await this.generateSessionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return iv.toString('base64') + '|' + encrypted;
  }

  /**
   * 解密数据
   */
  async decrypt(encryptedData) {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[SKF] Decrypting data...');

    if (this.simulationMode) {
      return this.simulateDecrypt(encryptedData);
    }

    const [ivBase64, dataBase64] = encryptedData.split('|');
    const iv = Buffer.from(ivBase64, 'base64');
    const key = await this.generateSessionKey();

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(dataBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * 生成会话密钥
   */
  async generateSessionKey() {
    if (this.simulationMode) {
      return crypto.randomBytes(32);
    }

    try {
      const randomBuffer = Buffer.alloc(32);
      const result = this.SKF_GenRandom(this.deviceHandle, randomBuffer, 32);

      if (result === SKF_ERROR_CODES.SAR_OK) {
        return randomBuffer;
      } else {
        // 失败时使用软件随机数
        return crypto.randomBytes(32);
      }
    } catch (error) {
      return crypto.randomBytes(32);
    }
  }

  /**
   * 获取公钥
   */
  async getPublicKey() {
    if (!this.isUnlocked) {
      throw new Error('设备未解锁');
    }

    logger.info('[SKF] Getting public key...');

    // 简化实现：返回基于设备名的公钥标识
    return `skf-pubkey-${this.deviceName || 'unknown'}`;
  }

  /**
   * 获取设备信息
   */
  async getDeviceInfo() {
    const detected = await this.detect();

    return {
      id: this.deviceName || 'unknown',
      serialNumber: this.deviceName || 'unknown',
      manufacturer: this.getManufacturerName(),
      model: this.getModelName(),
      firmware: this.getDriverVersion(),
      isConnected: detected.detected,
    };
  }

  /**
   * 关闭驱动
   */
  async close() {
    logger.info('[SKF] Closing driver...');

    if (!this.simulationMode) {
      try {
        // 关闭容器
        if (this.containerHandle) {
          this.SKF_CloseContainer(this.containerHandle);
          this.containerHandle = null;
        }

        // 关闭应用
        if (this.applicationHandle) {
          this.SKF_CloseApplication(this.applicationHandle);
          this.applicationHandle = null;
        }

        // 断开设备
        if (this.deviceHandle) {
          this.SKF_DisConnectDev(this.deviceHandle);
          this.deviceHandle = null;
        }
      } catch (error) {
        logger.error('[SKF] Error closing driver:', error);
      }
    }

    await super.close();
    logger.info('[SKF] Driver closed');
  }

  /**
   * 获取制造商名称（子类重写）
   */
  getManufacturerName() {
    return 'Generic SKF Manufacturer';
  }

  /**
   * 获取型号名称（子类重写）
   */
  getModelName() {
    return 'Generic SKF Device';
  }

  // ============ 模拟模式方法 ============

  simulateDetect() {
    // 模拟模式总是返回未检测到
    return {
      detected: false,
      unlocked: false,
    };
  }

  simulateVerifyPIN(pin) {
    // 模拟PIN验证：接受默认PIN
    const isValid = pin === this.userPin || pin === '12345678' || pin === '123456';

    if (isValid) {
      this.isUnlocked = true;
      return {
        success: true,
        remainingAttempts: null,
      };
    } else {
      return {
        success: false,
        error: 'PIN码错误',
        remainingAttempts: 5,
      };
    }
  }

  simulateSign(data) {
    const hash = crypto.createHash('sha256').update(data).digest('base64');
    return hash;
  }

  simulateVerifySignature(data, signature) {
    const expectedSignature = this.simulateSign(data);
    return expectedSignature === signature;
  }

  simulateEncrypt(data) {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);

    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return iv.toString('base64') + '|' + key.toString('base64') + '|' + encrypted;
  }

  simulateDecrypt(encryptedData) {
    const [ivBase64, keyBase64, dataBase64] = encryptedData.split('|');
    const iv = Buffer.from(ivBase64, 'base64');
    const key = Buffer.from(keyBase64, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(dataBase64, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}

module.exports = SKFDriver;
