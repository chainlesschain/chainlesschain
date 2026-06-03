/**
 * 模拟U盾驱动
 *
 * 用于开发和测试，不需要实际的硬件设备
 * 模拟完整的U盾功能，包括：
 * - PIN验证
 * - 数字签名
 * - 加密/解密
 * - 设备信息
 */

const { logger } = require("../utils/logger.js");
const BaseUKeyDriver = require("./base-driver");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/**
 * 模拟驱动类
 *
 * 特点：
 * - 不依赖任何硬件
 * - 使用文件系统存储状态
 * - 完全兼容BaseUKeyDriver接口
 * - 适合开发、测试、演示
 */
class SimulatedDriver extends BaseUKeyDriver {
  constructor(config = {}) {
    super(config);

    this.driverName = "Simulated";
    this.driverVersion = "1.0.0";

    // 模拟设备配置
    this.deviceId = config.deviceId || this.generateDeviceId();
    this.serialNumber = config.serialNumber || this.generateSerialNumber();
    this.manufacturer = "模拟设备制造商";
    this.model = "模拟U盾 Model-X";

    // PIN配置
    this.defaultPin = config.defaultPin || "123456";
    this.currentPin = this.defaultPin;
    this.maxRetryCount = 6;
    this.retryCount = 0;
    this.isLocked = false;

    // 密钥对（模拟）
    this.keyPair = null;
    this.sessionKey = null;

    // 状态文件路径
    this.stateFilePath = this.getStateFilePath();

    // 自动检测设置
    this.autoDetect = config.autoDetect !== false; // 默认为true
  }

  /**
   * 生成设备ID
   */
  generateDeviceId() {
    return `SIM-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
  }

  /**
   * 生成序列号
   */
  generateSerialNumber() {
    const prefix = "SIM";
    const timestamp = Date.now().toString().slice(-10);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${timestamp}${random}`;
  }

  /**
   * 获取状态文件路径
   */
  getStateFilePath() {
    try {
      const userDataPath = app.getPath("userData");
      const stateDir = path.join(userDataPath, "ukey-state");

      // 确保目录存在
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      return path.join(stateDir, `simulated-${this.deviceId}.json`);
    } catch (error) {
      // 如果无法访问应用数据目录，使用临时目录
      return path.join(
        require("os").tmpdir(),
        `ukey-sim-${this.deviceId}.json`,
      );
    }
  }

  /**
   * 加载状态
   */
  loadState() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const stateData = fs.readFileSync(this.stateFilePath, "utf8");
        const state = JSON.parse(stateData);

        this.currentPin = state.pin || this.defaultPin;
        this.retryCount = state.retryCount || 0;
        this.isLocked = state.isLocked || false;
        this.serialNumber = state.serialNumber || this.serialNumber;

        logger.info("[Simulated] State loaded from:", this.stateFilePath);
      }
    } catch (error) {
      logger.warn("[Simulated] Failed to load state:", error.message);
    }
  }

  /**
   * 保存状态
   */
  saveState() {
    try {
      const state = {
        pin: this.currentPin,
        retryCount: this.retryCount,
        isLocked: this.isLocked,
        serialNumber: this.serialNumber,
        lastUpdated: new Date().toISOString(),
      };

      fs.writeFileSync(
        this.stateFilePath,
        JSON.stringify(state, null, 2),
        "utf8",
      );
      logger.info("[Simulated] State saved to:", this.stateFilePath);
    } catch (error) {
      logger.warn("[Simulated] Failed to save state:", error.message);
    }
  }

  /**
   * 初始化驱动
   */
  async initialize() {
    logger.info("[Simulated] Initializing simulated driver...");

    try {
      // 加载之前的状态
      this.loadState();

      // 生成密钥对
      this.generateKeyPair();

      this.isInitialized = true;
      logger.info("[Simulated] Driver initialized successfully");
      logger.info(`[Simulated] Device ID: ${this.deviceId}`);
      logger.info(`[Simulated] Serial Number: ${this.serialNumber}`);
      logger.info(`[Simulated] Default PIN: ${this.defaultPin}`);

      return true;
    } catch (error) {
      logger.error("[Simulated] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * 生成模拟密钥对
   */
  generateKeyPair() {
    try {
      // 生成RSA密钥对
      this.keyPair = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: "spki",
          format: "pem",
        },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
        },
      });

      logger.info("[Simulated] Key pair generated");
    } catch (error) {
      logger.error("[Simulated] Failed to generate key pair:", error);
    }
  }

  /**
   * 检测设备
   */
  async detect() {
    logger.info("[Simulated] Detecting simulated device...");

    // 模拟驱动可以配置为总是检测到或不检测到
    if (!this.autoDetect) {
      return {
        detected: false,
        unlocked: false,
      };
    }

    return {
      detected: true,
      unlocked: this.isUnlocked,
      deviceId: this.deviceId,
      serialNumber: this.serialNumber,
      manufacturer: this.manufacturer,
      model: this.model,
    };
  }

  /**
   * 验证PIN码
   */
  async verifyPIN(pin) {
    logger.info("[Simulated] Verifying PIN...");

    // 检查是否已锁定
    if (this.isLocked) {
      return {
        success: false,
        error: "PIN已被锁定",
        remainingAttempts: 0,
      };
    }

    // 验证PIN
    if (pin === this.currentPin) {
      // 验证成功
      this.isUnlocked = true;
      this.retryCount = 0;
      this.saveState();

      logger.info("[Simulated] PIN verification successful");

      return {
        success: true,
        remainingAttempts: this.maxRetryCount,
      };
    } else {
      // 验证失败
      this.retryCount++;

      if (this.retryCount >= this.maxRetryCount) {
        // 锁定设备
        this.isLocked = true;
        this.isUnlocked = false;
        this.saveState();

        logger.info("[Simulated] PIN locked after too many failed attempts");

        return {
          success: false,
          error: "PIN码错误次数过多，已被锁定",
          remainingAttempts: 0,
        };
      } else {
        this.saveState();

        const remainingAttempts = this.maxRetryCount - this.retryCount;
        logger.info(
          "[Simulated] PIN verification failed, remaining attempts:",
          remainingAttempts,
        );

        return {
          success: false,
          error: "PIN码错误",
          remainingAttempts: remainingAttempts,
        };
      }
    }
  }

  /**
   * 修改PIN码
   */
  async changePIN(oldPin, newPin) {
    logger.info("[Simulated] Changing PIN...");

    // 验证旧PIN
    if (oldPin !== this.currentPin) {
      return {
        success: false,
        error: "旧PIN码错误",
      };
    }

    // 设置新PIN
    this.currentPin = newPin;
    this.saveState();

    logger.info("[Simulated] PIN changed successfully");

    return {
      success: true,
    };
  }

  /**
   * 数字签名
   */
  async sign(data) {
    if (!this.isUnlocked) {
      throw new Error("设备未解锁");
    }

    logger.info("[Simulated] Signing data...");

    try {
      // 使用私钥签名
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(data);
      const signature = sign.sign(this.keyPair.privateKey, "base64");

      logger.info("[Simulated] Data signed successfully");
      return signature;
    } catch (error) {
      logger.error("[Simulated] Signing failed:", error);
      throw error;
    }
  }

  /**
   * 验证签名
   */
  async verifySignature(data, signature) {
    logger.info("[Simulated] Verifying signature...");

    try {
      const verify = crypto.createVerify("RSA-SHA256");
      verify.update(data);
      const isValid = verify.verify(
        this.keyPair.publicKey,
        signature,
        "base64",
      );

      logger.info("[Simulated] Signature verification result:", isValid);
      return isValid;
    } catch (error) {
      logger.error("[Simulated] Signature verification failed:", error);
      return false;
    }
  }

  /**
   * 加密数据
   */
  async encrypt(data) {
    if (!this.isUnlocked) {
      throw new Error("设备未解锁");
    }

    logger.info("[Simulated] Encrypting data...");

    try {
      // 生成会话密钥
      if (!this.sessionKey) {
        this.sessionKey = crypto.randomBytes(32);
      }

      // 使用AES-256-CBC加密
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv("aes-256-cbc", this.sessionKey, iv);

      let encrypted = cipher.update(data, "utf8", "base64");
      encrypted += cipher.final("base64");

      // 返回格式：IV|加密数据
      const result = iv.toString("base64") + "|" + encrypted;

      logger.info("[Simulated] Data encrypted successfully");
      return result;
    } catch (error) {
      logger.error("[Simulated] Encryption failed:", error);
      throw error;
    }
  }

  /**
   * 解密数据
   */
  async decrypt(encryptedData) {
    if (!this.isUnlocked) {
      throw new Error("设备未解锁");
    }

    logger.info("[Simulated] Decrypting data...");

    try {
      // 解析IV和加密数据
      const [ivBase64, dataBase64] = encryptedData.split("|");
      const iv = Buffer.from(ivBase64, "base64");

      // 使用AES-256-CBC解密
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        this.sessionKey,
        iv,
      );

      let decrypted = decipher.update(dataBase64, "base64", "utf8");
      decrypted += decipher.final("utf8");

      logger.info("[Simulated] Data decrypted successfully");
      return decrypted;
    } catch (error) {
      logger.error("[Simulated] Decryption failed:", error);
      throw error;
    }
  }

  /**
   * 获取公钥
   */
  async getPublicKey() {
    logger.info("[Simulated] Getting public key...");

    if (!this.keyPair) {
      throw new Error("密钥对未生成");
    }

    return this.keyPair.publicKey;
  }

  /**
   * 获取设备信息
   */
  async getDeviceInfo() {
    return {
      id: this.deviceId,
      serialNumber: this.serialNumber,
      manufacturer: this.manufacturer,
      model: this.model,
      firmware: this.driverVersion,
      isConnected: true,
      isSimulated: true,
      pinRetryCount: this.maxRetryCount - this.retryCount,
      maxPinRetryCount: this.maxRetryCount,
      isLocked: this.isLocked,
    };
  }

  /**
   * 锁定设备
   */
  lock() {
    super.lock();
    logger.info("[Simulated] Device locked");
  }

  /**
   * 解锁设备（仅用于测试）
   */
  unlockForTesting() {
    this.isLocked = false;
    this.retryCount = 0;
    this.saveState();
    logger.info("[Simulated] Device unlocked for testing");
  }

  /**
   * 重置设备（仅用于测试）
   */
  resetForTesting() {
    this.currentPin = this.defaultPin;
    this.retryCount = 0;
    this.isLocked = false;
    this.isUnlocked = false;
    this.saveState();
    logger.info("[Simulated] Device reset for testing");
  }

  /**
   * 关闭驱动
   */
  async close() {
    logger.info("[Simulated] Closing driver...");

    // 保存状态
    this.saveState();

    await super.close();
    logger.info("[Simulated] Driver closed");
  }

  /**
   * 获取驱动名称
   */
  getDriverName() {
    return "模拟U盾驱动";
  }

  /**
   * 获取驱动版本
   */
  getDriverVersion() {
    return this.driverVersion;
  }

  /**
   * 设置自动检测
   */
  setAutoDetect(enabled) {
    this.autoDetect = enabled;
    logger.info("[Simulated] Auto-detect set to:", enabled);
  }

  /**
   * 获取状态文件路径（用于调试）
   */
  getStateFile() {
    return this.stateFilePath;
  }
}

module.exports = SimulatedDriver;
