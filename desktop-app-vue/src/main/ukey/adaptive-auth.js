/**
 * 自适应认证策略引擎 (v0.40.0)
 *
 * 功能:
 * - 根据操作风险等级自动选择认证方式
 * - 支持多因素组合认证
 * - 环境感知（设备状态、位置、时间）
 * - 可配置的认证规则
 */

const { logger } = require("../utils/logger.js");
const {
  AUTH_LEVEL,
  OPERATION_RISK,
  FINGERPRINT_USAGE,
} = require("./biometric-manager");

// ============================================================
// 操作类型定义
// ============================================================

const OPERATION_TYPE = {
  // 身份认证
  LOGIN: "login",
  UNLOCK: "unlock",
  // 数据操作
  READ_DATA: "read_data",
  WRITE_DATA: "write_data",
  DELETE_DATA: "delete_data",
  // 加密操作
  SIGN_DOCUMENT: "sign_document",
  SIGN_TRANSACTION: "sign_transaction",
  ENCRYPT_DATA: "encrypt_data",
  // 账户管理
  CHANGE_PIN: "change_pin",
  CHANGE_SETTINGS: "change_settings",
  BACKUP_KEY: "backup_key",
  EXPORT_KEY: "export_key",
};

// 操作类型 → 默认风险等级映射
const OPERATION_RISK_MAP = {
  [OPERATION_TYPE.LOGIN]: OPERATION_RISK.LOW,
  [OPERATION_TYPE.UNLOCK]: OPERATION_RISK.LOW,
  [OPERATION_TYPE.READ_DATA]: OPERATION_RISK.LOW,
  [OPERATION_TYPE.WRITE_DATA]: OPERATION_RISK.MEDIUM,
  [OPERATION_TYPE.DELETE_DATA]: OPERATION_RISK.HIGH,
  [OPERATION_TYPE.SIGN_DOCUMENT]: OPERATION_RISK.MEDIUM,
  [OPERATION_TYPE.SIGN_TRANSACTION]: OPERATION_RISK.HIGH,
  [OPERATION_TYPE.ENCRYPT_DATA]: OPERATION_RISK.LOW,
  [OPERATION_TYPE.CHANGE_PIN]: OPERATION_RISK.HIGH,
  [OPERATION_TYPE.CHANGE_SETTINGS]: OPERATION_RISK.MEDIUM,
  [OPERATION_TYPE.BACKUP_KEY]: OPERATION_RISK.CRITICAL,
  [OPERATION_TYPE.EXPORT_KEY]: OPERATION_RISK.CRITICAL,
};

// ============================================================
// 自适应认证策略引擎
// ============================================================

class AdaptiveAuthEngine {
  constructor(config = {}) {
    this.config = config;

    // 默认认证策略: 风险等级 → 认证方式
    this._policy = {
      [OPERATION_RISK.LOW]: {
        methods: ["fingerprint"],
        requireAll: false,
        fallback: ["pin"],
      },
      [OPERATION_RISK.MEDIUM]: {
        methods: ["fingerprint"],
        requireAll: false,
        fallback: ["pin"],
      },
      [OPERATION_RISK.HIGH]: {
        methods: ["pin", "fingerprint"],
        requireAll: true,
        fallback: null,
      },
      [OPERATION_RISK.CRITICAL]: {
        methods: ["pin", "fingerprint", "liveness"],
        requireAll: true,
        fallback: null,
      },
    };

    // 环境因素权重
    this._contextWeights = {
      newDevice: 1, // 新设备 +1 风险等级
      unusualTime: 0.5, // 异常时间 +0.5
      unusualLocation: 1, // 异常位置 +1 风险等级
      firstInteraction: 0.5, // 首次交互 +0.5
    };

    // 交易金额风险阈值（USD）
    this._amountThresholds = {
      [OPERATION_RISK.LOW]: 10,
      [OPERATION_RISK.MEDIUM]: 100,
      [OPERATION_RISK.HIGH]: 1000,
      // CRITICAL: >1000
    };

    // 引用
    this._biometricManager = config.biometricManager || null;
    this._ukeyManager = config.ukeyManager || null;
  }

  // ============================================================
  // 风险评估
  // ============================================================

  /**
   * 评估操作风险等级
   * @param {object} context - 操作上下文
   * @returns {string} OPERATION_RISK 值
   */
  assessRisk(context = {}) {
    const {
      operationType,
      amount = 0,
      isNewContract = false,
      isFirstInteraction = false,
      isUnusualTime = false,
    } = context;

    // 基础风险（操作类型）
    let baseRisk = OPERATION_RISK_MAP[operationType] || OPERATION_RISK.MEDIUM;

    // 金额风险叠加
    const amountRisk = this._getRiskByAmount(amount);
    baseRisk = this._maxRisk(baseRisk, amountRisk);

    // 环境风险叠加
    if (isNewContract || isFirstInteraction) {
      baseRisk = this._elevateRisk(baseRisk, 1);
    }
    if (isUnusualTime) {
      baseRisk = this._elevateRisk(baseRisk, 0.5);
    }

    logger.info(
      `[AdaptiveAuth] 风险评估: ${operationType} → ${baseRisk} (amount=${amount})`,
    );
    return baseRisk;
  }

  _getRiskByAmount(amount) {
    if (amount <= this._amountThresholds[OPERATION_RISK.LOW]) {
      return OPERATION_RISK.LOW;
    }
    if (amount <= this._amountThresholds[OPERATION_RISK.MEDIUM]) {
      return OPERATION_RISK.MEDIUM;
    }
    if (amount <= this._amountThresholds[OPERATION_RISK.HIGH]) {
      return OPERATION_RISK.HIGH;
    }
    return OPERATION_RISK.CRITICAL;
  }

  _maxRisk(a, b) {
    const order = [
      OPERATION_RISK.LOW,
      OPERATION_RISK.MEDIUM,
      OPERATION_RISK.HIGH,
      OPERATION_RISK.CRITICAL,
    ];
    return order[Math.max(order.indexOf(a), order.indexOf(b))];
  }

  _elevateRisk(risk, steps) {
    const order = [
      OPERATION_RISK.LOW,
      OPERATION_RISK.MEDIUM,
      OPERATION_RISK.HIGH,
      OPERATION_RISK.CRITICAL,
    ];
    const idx = order.indexOf(risk);
    return order[Math.min(order.length - 1, idx + Math.ceil(steps))];
  }

  // ============================================================
  // 认证执行
  // ============================================================

  /**
   * 根据风险等级执行自适应认证
   * @param {string} riskLevel - OPERATION_RISK 值
   * @param {object} credentials - { pin, fingerprintId }
   * @returns {Promise<{ success, method, factors }>}
   */
  async authenticate(riskLevel, credentials = {}) {
    const policy = this._policy[riskLevel];
    if (!policy) {
      return { success: false, reason: "unknown_risk_level" };
    }

    logger.info(
      `[AdaptiveAuth] 执行认证: 风险=${riskLevel}, 方法=${policy.methods.join("+")}`,
    );

    const results = {};
    let allPassed = true;

    for (const method of policy.methods) {
      const result = await this._authenticateWith(method, credentials);
      results[method] = result;

      if (!result.success) {
        if (policy.requireAll) {
          allPassed = false;

          // 尝试降级方案
          if (policy.fallback) {
            logger.info(
              `[AdaptiveAuth] 主方法 ${method} 失败，尝试备用方案: ${policy.fallback.join("+")}`,
            );
            return await this._authenticateWithFallback(
              policy.fallback,
              credentials,
            );
          }

          return { success: false, reason: `${method}_failed`, ...result };
        }
        // 不需要全部通过时，任一成功即可
      }
    }

    if (!policy.requireAll) {
      // 任一成功
      allPassed = Object.values(results).some((r) => r.success);
    }

    if (allPassed) {
      const passedMethods = Object.entries(results)
        .filter(([, r]) => r.success)
        .map(([m]) => m);

      logger.info(`[AdaptiveAuth] 认证成功: ${passedMethods.join("+")}`);
      return {
        success: true,
        method: passedMethods.join("+"),
        factors: results,
      };
    }

    return { success: false, reason: "all_methods_failed", factors: results };
  }

  async _authenticateWith(method, credentials) {
    switch (method) {
      case "pin":
        if (!credentials.pin) {
          return { success: false, reason: "no_pin_provided" };
        }
        if (!this._ukeyManager) {
          return { success: false, reason: "no_ukey_manager" };
        }
        return await this._ukeyManager.verifyPIN(credentials.pin);

      case "fingerprint":
        if (!this._biometricManager) {
          return { success: false, reason: "no_biometric_manager" };
        }
        return await this._biometricManager.verifyFingerprint({
          usage: credentials.usage || FINGERPRINT_USAGE.ALL,
        });

      case "liveness": {
        if (!this._biometricManager) {
          return { success: false, reason: "no_biometric_manager" };
        }
        const liveness = await this._biometricManager._livenessDetection();
        return { success: liveness.passed };
      }

      default:
        return { success: false, reason: `unknown_method_${method}` };
    }
  }

  async _authenticateWithFallback(methods, credentials) {
    for (const method of methods) {
      const result = await this._authenticateWith(method, credentials);
      if (result.success) {
        return { success: true, method, isFallback: true };
      }
    }
    return { success: false, reason: "fallback_failed" };
  }

  // ============================================================
  // 策略管理
  // ============================================================

  /**
   * 更新认证策略
   */
  updatePolicy(riskLevel, policy) {
    this._policy[riskLevel] = { ...this._policy[riskLevel], ...policy };
    logger.info(
      `[AdaptiveAuth] 更新策略: ${riskLevel}`,
      this._policy[riskLevel],
    );
  }

  /**
   * 更新金额阈值
   */
  updateAmountThresholds(thresholds) {
    this._amountThresholds = { ...this._amountThresholds, ...thresholds };
  }

  /**
   * 获取操作建议认证方式（UI 展示用）
   */
  getAuthRequirements(riskLevel) {
    const policy = this._policy[riskLevel];
    if (!policy) {
      return null;
    }

    return {
      riskLevel,
      methods: policy.methods,
      requireAll: policy.requireAll,
      hasFallback: !!policy.fallback,
      description: this._getAuthDescription(riskLevel, policy),
    };
  }

  _getAuthDescription(riskLevel, policy) {
    const methodNames = {
      pin: "PIN 码",
      fingerprint: "指纹",
      liveness: "活体检测",
    };
    const names = policy.methods.map((m) => methodNames[m] || m);
    const connector = policy.requireAll ? " + " : " 或 ";
    return names.join(connector);
  }

  setUKeyManager(ukeyManager) {
    this._ukeyManager = ukeyManager;
  }
  setBiometricManager(bm) {
    this._biometricManager = bm;
  }
}

module.exports = {
  AdaptiveAuthEngine,
  OPERATION_TYPE,
  OPERATION_RISK_MAP,
};
