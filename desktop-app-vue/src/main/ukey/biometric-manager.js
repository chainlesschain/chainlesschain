/**
 * 生物识别管理器 (v0.40.0)
 *
 * 功能:
 * - 指纹注册（最多10个指纹）
 * - 指纹验证替代 PIN 码
 * - PIN+指纹双因素认证
 * - 活体检测（防止假指纹攻击）
 * - 指纹模板管理
 * - 指纹质量评估
 * - 自适应认证策略
 * - 指纹 U盾 + 传统 U盾 混合管理
 *
 * 支持设备:
 * - 飞天诚信 BioPass FIDO2
 * - YubiKey Bio
 * - Kensington VeriMark
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const crypto = require("crypto");

// ============================================================
// 常量
// ============================================================

const MAX_FINGERPRINTS = 10;
const MIN_QUALITY = 0.8; // 指纹质量阈值（80%）
const MAX_LIVENESS_RETRY = 3; // 活体检测最大重试次数
const BIOMETRIC_FAIL_LOCK = 5; // 连续失败次数触发锁定

const FINGERPRINT_USAGE = {
  LOGIN: "login", // 快速登录
  SIGN: "transaction_sign", // 交易签名
  ALL: "all", // 全部操作
};

const AUTH_LEVEL = {
  STANDARD: "standard", // 标准: PIN 码
  ENHANCED: "enhanced", // 增强: 指纹
  HIGH: "high", // 高安全: PIN + 指纹
  MAX: "max", // 最高安全: PIN + 指纹 + 活体
};

const OPERATION_RISK = {
  LOW: "low", // 低风险: 仅指纹
  MEDIUM: "medium", // 中风险: PIN 或指纹
  HIGH: "high", // 高风险: PIN + 指纹
  CRITICAL: "critical", // 极高风险: PIN + 指纹 + 活体
};

// ============================================================
// 生物识别管理器
// ============================================================

class BiometricManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = config;

    // 生物识别能力
    this._hasBiometric = false;
    this._deviceType = null; // "fingerprint", "face", etc.
    this._maxFingerprints = config.maxFingerprints || MAX_FINGERPRINTS;

    // 已注册指纹（存储在 U盾 安全芯片内）
    this._enrolledFingerprints = new Map(); // id → metadata

    // 失败计数器
    this._failCount = 0;
    this._isLocked = false;

    // 活体检测状态
    this._livenessEnabled = config.livenessEnabled !== false;

    // 引用 ukeyManager
    this._ukeyManager = config.ukeyManager || null;

    // 认证策略规则（运算风险 → 认证级别）
    this._authPolicy = {
      [OPERATION_RISK.LOW]: AUTH_LEVEL.ENHANCED,
      [OPERATION_RISK.MEDIUM]: AUTH_LEVEL.ENHANCED,
      [OPERATION_RISK.HIGH]: AUTH_LEVEL.HIGH,
      [OPERATION_RISK.CRITICAL]: AUTH_LEVEL.MAX,
    };
  }

  // ============================================================
  // 初始化
  // ============================================================

  async initialize(ukeyManager) {
    if (ukeyManager) {
      this._ukeyManager = ukeyManager;
    }
    logger.info("[BiometricManager] 初始化生物识别管理器...");

    try {
      this._hasBiometric = await this._checkBiometricCapability();
      logger.info(
        `[BiometricManager] 生物识别能力: ${this._hasBiometric ? "支持" : "不支持"}`,
      );
    } catch (e) {
      logger.warn("[BiometricManager] 生物识别能力检测失败:", e.message);
      this._hasBiometric = false;
    }

    return this._hasBiometric;
  }

  async _checkBiometricCapability() {
    if (!this._ukeyManager) {
      return false;
    }

    try {
      const deviceInfo = await this._ukeyManager.getDeviceInfo();
      // 检测设备是否支持 FIDO2 生物识别
      const driverType = this._ukeyManager.getDriverType?.() || "";
      const isBioDevice =
        driverType === "fido2" ||
        (deviceInfo?.model || "").toLowerCase().includes("bio") ||
        (deviceInfo?.model || "").toLowerCase().includes("fingerprint");

      if (isBioDevice) {
        this._deviceType = "fingerprint";
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  // 指纹注册
  // ============================================================

  /**
   * 注册指纹
   * @param {object} options - { usage, label, adminPin }
   * @returns {Promise<{ success, fingerprintId, quality }>}
   */
  async enrollFingerprint(options = {}) {
    const {
      usage = FINGERPRINT_USAGE.ALL,
      label = `指纹 ${this._enrolledFingerprints.size + 1}`,
      adminPin,
    } = options;

    if (!this._hasBiometric) {
      return {
        success: false,
        reason: "no_biometric_support",
        message: "设备不支持生物识别",
      };
    }

    if (this._enrolledFingerprints.size >= this._maxFingerprints) {
      return {
        success: false,
        reason: "max_fingerprints",
        message: `最多注册 ${this._maxFingerprints} 个指纹`,
      };
    }

    logger.info(`[BiometricManager] 开始注册指纹: ${label}`);
    this.emit("enrollment-started", { label });

    try {
      // Step 1: 收集指纹样本（3-5次）
      const samples = [];
      const SAMPLE_COUNT = 4;

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        this.emit("enrollment-progress", { step: i + 1, total: SAMPLE_COUNT });
        logger.info(`[BiometricManager] 采集指纹样本 ${i + 1}/${SAMPLE_COUNT}`);

        const sample = await this._captureFingerprintSample();
        if (!sample.success) {
          return {
            success: false,
            reason: "capture_failed",
            message: sample.message,
          };
        }
        samples.push(sample.data);
        await this.sleep(500);
      }

      // Step 2: 质量评估
      const quality = await this._assessQuality(samples);
      logger.info(
        `[BiometricManager] 指纹质量: ${(quality * 100).toFixed(1)}%`,
      );

      if (quality < MIN_QUALITY) {
        return {
          success: false,
          reason: "poor_quality",
          quality,
          message: `指纹质量不足 (${(quality * 100).toFixed(0)}%)，请重新采集`,
        };
      }

      // Step 3: 模板生成并写入 U盾 安全芯片
      const fingerprintId = crypto.randomUUID();
      const template = await this._generateTemplate(samples);

      // Step 4: 存储元数据（模板本身存储在 U盾 芯片内）
      const metadata = {
        id: fingerprintId,
        label,
        usage,
        quality,
        enrolledAt: new Date().toISOString(),
        sampleCount: SAMPLE_COUNT,
      };

      this._enrolledFingerprints.set(fingerprintId, metadata);

      logger.info(`[BiometricManager] 指纹注册成功: ${fingerprintId}`);
      this.emit("enrollment-completed", { fingerprintId, label, quality });

      return { success: true, fingerprintId, quality, label };
    } catch (error) {
      logger.error("[BiometricManager] 指纹注册失败:", error);
      this.emit("enrollment-failed", { error: error.message });
      return { success: false, reason: "error", message: error.message };
    }
  }

  // ============================================================
  // 指纹验证
  // ============================================================

  /**
   * 指纹验证（替代 PIN 码）
   * @param {object} options - { usage, requireLiveness }
   */
  async verifyFingerprint(options = {}) {
    const { usage = FINGERPRINT_USAGE.LOGIN, requireLiveness = false } =
      options;

    if (this._isLocked) {
      return {
        success: false,
        reason: "locked",
        message: "生物识别已锁定，请使用 PIN 码",
      };
    }

    if (!this._hasBiometric) {
      return { success: false, reason: "no_biometric_support" };
    }

    if (this._enrolledFingerprints.size === 0) {
      return {
        success: false,
        reason: "no_fingerprints",
        message: "尚未注册指纹",
      };
    }

    logger.info("[BiometricManager] 开始指纹验证...");
    this.emit("verification-started");

    try {
      // 活体检测
      if (requireLiveness || this._livenessEnabled) {
        const liveness = await this._livenessDetection();
        if (!liveness.passed) {
          logger.warn("[BiometricManager] 活体检测失败");
          return {
            success: false,
            reason: "liveness_failed",
            message: "活体检测失败，请重试",
          };
        }
      }

      // 采集指纹
      const sample = await this._captureFingerprintSample();
      if (!sample.success) {
        return { success: false, reason: "capture_failed" };
      }

      // 比对已注册指纹
      const matchResult = await this._matchFingerprint(sample.data, usage);

      if (matchResult.matched) {
        this._failCount = 0;
        logger.info(
          `[BiometricManager] 指纹验证成功: ${matchResult.fingerprintId}`,
        );
        this.emit("verification-success", {
          fingerprintId: matchResult.fingerprintId,
        });
        return {
          success: true,
          fingerprintId: matchResult.fingerprintId,
          confidence: matchResult.confidence,
        };
      } else {
        this._failCount++;
        logger.warn(
          `[BiometricManager] 指纹验证失败 (${this._failCount}/${BIOMETRIC_FAIL_LOCK})`,
        );

        if (this._failCount >= BIOMETRIC_FAIL_LOCK) {
          this._isLocked = true;
          this.emit("biometric-locked");
          return {
            success: false,
            reason: "locked_after_failures",
            message: "多次验证失败，已锁定",
          };
        }

        this.emit("verification-failed", { failCount: this._failCount });
        return {
          success: false,
          reason: "no_match",
          failCount: this._failCount,
          remainingAttempts: BIOMETRIC_FAIL_LOCK - this._failCount,
        };
      }
    } catch (error) {
      logger.error("[BiometricManager] 指纹验证出错:", error);
      return { success: false, reason: "error", message: error.message };
    }
  }

  // ============================================================
  // PIN + 指纹双因素认证
  // ============================================================

  /**
   * 双因素认证: PIN + 指纹
   * @param {string} pin
   * @param {object} options
   */
  async verifyPinAndFingerprint(pin, options = {}) {
    logger.info("[BiometricManager] 双因素认证: PIN + 指纹...");

    // Step 1: 验证 PIN
    if (!this._ukeyManager) {
      return { success: false, reason: "no_ukey_manager" };
    }

    const pinResult = await this._ukeyManager.verifyPIN(pin);
    if (!pinResult.success) {
      return { success: false, reason: "pin_failed", ...pinResult };
    }

    // Step 2: 验证指纹
    const fpResult = await this.verifyFingerprint(options);
    if (!fpResult.success) {
      return { success: false, reason: "fingerprint_failed", ...fpResult };
    }

    logger.info("[BiometricManager] 双因素认证成功");
    return { success: true, method: "pin+fingerprint" };
  }

  // ============================================================
  // 指纹模板管理
  // ============================================================

  /**
   * 获取已注册指纹列表
   */
  listFingerprints() {
    const list = [];
    for (const [id, meta] of this._enrolledFingerprints) {
      list.push({ ...meta });
    }
    return list;
  }

  /**
   * 删除指纹
   * @param {string} fingerprintId
   */
  async deleteFingerprint(fingerprintId) {
    if (!this._enrolledFingerprints.has(fingerprintId)) {
      return { success: false, reason: "not_found" };
    }

    this._enrolledFingerprints.delete(fingerprintId);
    logger.info(`[BiometricManager] 删除指纹: ${fingerprintId}`);
    this.emit("fingerprint-deleted", { fingerprintId });
    return { success: true };
  }

  /**
   * 清除所有指纹
   */
  async clearAllFingerprints() {
    const count = this._enrolledFingerprints.size;
    this._enrolledFingerprints.clear();
    logger.info(`[BiometricManager] 清除所有指纹 (${count} 个)`);
    this.emit("all-fingerprints-cleared");
    return { success: true, count };
  }

  // ============================================================
  // 活体检测
  // ============================================================

  async _livenessDetection() {
    logger.info("[BiometricManager] 执行活体检测...");

    // 通过多角度采集和电容/温度分析检测活体
    // 在真实设备上，这由 U盾 安全芯片完成（Match-on-Card）
    // 这里模拟活体检测逻辑

    const capacitanceCheck = Math.random() > 0.05; // 95% 通过率（正常手指）
    const temperatureCheck = Math.random() > 0.02; // 98% 通过率

    const passed = capacitanceCheck && temperatureCheck;

    logger.info(`[BiometricManager] 活体检测结果: ${passed ? "通过" : "失败"}`);
    return { passed, capacitanceCheck, temperatureCheck };
  }

  // ============================================================
  // 内部辅助方法（硬件接口抽象）
  // ============================================================

  async _captureFingerprintSample() {
    // 实际实现需要通过 FIDO2 CTAP2 HID 接口采集
    // 这里模拟采集过程
    await this.sleep(500);
    const data = crypto.randomBytes(64).toString("hex");
    return { success: true, data };
  }

  async _assessQuality(samples) {
    // 质量评估基于多个维度：
    // - 指纹覆盖面积
    // - 脊线清晰度
    // - 噪声水平
    // 模拟返回 80-100% 的质量分数
    return 0.85 + Math.random() * 0.15;
  }

  async _generateTemplate(samples) {
    // 从多个样本生成指纹模板
    // 模板存储在 U盾 安全芯片内，不可导出
    return crypto.createHash("sha256").update(samples.join("")).digest("hex");
  }

  async _matchFingerprint(sampleData, usage) {
    // 指纹比对在 U盾 安全芯片内完成（Match-on-Card）
    if (this._enrolledFingerprints.size === 0) {
      return { matched: false };
    }

    // 模拟高精度比对（实际设备 FAR < 0.001%）
    const matched = Math.random() > 0.02; // 98% 匹配成功率
    if (matched) {
      const ids = [...this._enrolledFingerprints.keys()];
      const fingerprintId = ids[Math.floor(Math.random() * ids.length)];
      return {
        matched: true,
        fingerprintId,
        confidence: 0.9 + Math.random() * 0.1,
      };
    }
    return { matched: false };
  }

  // ============================================================
  // 自适应认证策略
  // ============================================================

  /**
   * 根据操作风险等级获取所需认证方式
   * @param {string} operationRisk - OPERATION_RISK 中的值
   * @returns {string} AUTH_LEVEL 中的值
   */
  getRequiredAuthLevel(operationRisk) {
    return this._authPolicy[operationRisk] || AUTH_LEVEL.STANDARD;
  }

  /**
   * 设置自定义认证策略
   */
  setAuthPolicy(policy) {
    this._authPolicy = { ...this._authPolicy, ...policy };
    logger.info("[BiometricManager] 认证策略已更新:", this._authPolicy);
  }

  /**
   * 根据金额获取操作风险等级
   * @param {number} amount - 交易金额（USD）
   */
  getRiskByAmount(amount) {
    if (amount <= 10) {
      return OPERATION_RISK.LOW;
    }
    if (amount <= 100) {
      return OPERATION_RISK.MEDIUM;
    }
    if (amount <= 1000) {
      return OPERATION_RISK.HIGH;
    }
    return OPERATION_RISK.CRITICAL;
  }

  // ============================================================
  // 状态查询
  // ============================================================

  isSupported() {
    return this._hasBiometric;
  }
  isLocked() {
    return this._isLocked;
  }
  getEnrolledCount() {
    return this._enrolledFingerprints.size;
  }

  unlockBiometric() {
    this._isLocked = false;
    this._failCount = 0;
    logger.info("[BiometricManager] 生物识别已解锁");
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = {
  BiometricManager,
  FINGERPRINT_USAGE,
  AUTH_LEVEL,
  OPERATION_RISK,
  MAX_FINGERPRINTS,
};
