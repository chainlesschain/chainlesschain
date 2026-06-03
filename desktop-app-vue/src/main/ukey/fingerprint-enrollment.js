/**
 * 指纹注册流程管理器 (v0.40.0)
 *
 * 管理完整的指纹注册向导流程:
 * 1. 确认设备支持
 * 2. PIN 身份验证
 * 3. 多次采集
 * 4. 质量评估
 * 5. 设置用途
 * 6. 写入 U盾 芯片
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { BiometricManager, FINGERPRINT_USAGE } = require("./biometric-manager");

// 注册状态机
const ENROLLMENT_STATE = {
  IDLE: "idle",
  CHECKING_DEVICE: "checking_device",
  VERIFYING_PIN: "verifying_pin",
  COLLECTING: "collecting",
  ASSESSING_QUALITY: "assessing_quality",
  SETTING_USAGE: "setting_usage",
  WRITING_TEMPLATE: "writing_template",
  COMPLETED: "completed",
  FAILED: "failed",
};

class FingerprintEnrollment extends EventEmitter {
  constructor(biometricManager) {
    super();
    this._bm = biometricManager;
    this._state = ENROLLMENT_STATE.IDLE;
    this._session = null;
  }

  // ============================================================
  // 注册向导
  // ============================================================

  /**
   * 启动注册向导
   * @param {object} options - { label, usage, pin }
   */
  async startEnrollment(options = {}) {
    if (
      this._state !== ENROLLMENT_STATE.IDLE &&
      this._state !== ENROLLMENT_STATE.FAILED
    ) {
      return { success: false, reason: "enrollment_in_progress" };
    }

    this._session = {
      id: `enroll-${Date.now()}`,
      label: options.label || `指纹 ${Date.now()}`,
      usage: options.usage || FINGERPRINT_USAGE.ALL,
      samples: [],
      quality: null,
      startedAt: new Date().toISOString(),
    };

    logger.info(`[FingerprintEnrollment] 启动注册向导: ${this._session.label}`);
    this._setState(ENROLLMENT_STATE.CHECKING_DEVICE);

    // Step 1: 检查设备支持
    if (!this._bm.isSupported()) {
      this._setState(ENROLLMENT_STATE.FAILED);
      return {
        success: false,
        reason: "no_biometric_support",
        message: "设备不支持指纹识别",
      };
    }

    // Step 2: PIN 验证
    this._setState(ENROLLMENT_STATE.VERIFYING_PIN);
    this.emit("step-changed", {
      step: "verify_pin",
      message: "请输入 PIN 码验证身份",
    });

    if (options.pin) {
      const pinResult = await this._verifyPin(options.pin);
      if (!pinResult.success) {
        this._setState(ENROLLMENT_STATE.FAILED);
        return {
          success: false,
          reason: "pin_failed",
          message: "PIN 码验证失败",
        };
      }
    }

    // Step 3: 开始采集
    this._setState(ENROLLMENT_STATE.COLLECTING);
    this.emit("step-changed", {
      step: "collect",
      message: "请将手指放在传感器上",
    });

    return {
      success: true,
      sessionId: this._session.id,
      state: this._state,
      totalSamples: 4,
    };
  }

  /**
   * 采集单次样本（由 UI 调用，每次用户按压传感器触发）
   */
  async collectSample() {
    if (this._state !== ENROLLMENT_STATE.COLLECTING) {
      return { success: false, reason: "invalid_state", state: this._state };
    }

    const MAX_SAMPLES = 4;
    const sampleIdx = this._session.samples.length;

    logger.info(
      `[FingerprintEnrollment] 采集样本 ${sampleIdx + 1}/${MAX_SAMPLES}`,
    );
    this.emit("sample-collecting", { index: sampleIdx, total: MAX_SAMPLES });

    const sample = await this._bm._captureFingerprintSample();
    if (!sample.success) {
      this.emit("sample-failed", {
        index: sampleIdx,
        message: "采集失败，请重试",
      });
      return { success: false, reason: "capture_failed" };
    }

    this._session.samples.push(sample.data);
    this.emit("sample-collected", {
      index: sampleIdx,
      total: MAX_SAMPLES,
      remaining: MAX_SAMPLES - this._session.samples.length,
    });

    if (this._session.samples.length >= MAX_SAMPLES) {
      return await this._finalizeEnrollment();
    }

    return {
      success: true,
      sampleIndex: sampleIdx,
      remaining: MAX_SAMPLES - this._session.samples.length,
      nextInstruction: this._getNextInstruction(sampleIdx),
    };
  }

  _getNextInstruction(sampleIdx) {
    const instructions = [
      "请抬起手指，然后再次按压",
      "请从不同角度按压（向右偏移）",
      "请从不同角度按压（向左偏移）",
      "最后一次，正常按压",
    ];
    return instructions[sampleIdx + 1] || "继续按压";
  }

  async _finalizeEnrollment() {
    // Step 4: 质量评估
    this._setState(ENROLLMENT_STATE.ASSESSING_QUALITY);
    this.emit("step-changed", {
      step: "assess_quality",
      message: "正在评估指纹质量...",
    });

    const quality = await this._bm._assessQuality(this._session.samples);
    this._session.quality = quality;

    if (quality < 0.8) {
      this._setState(ENROLLMENT_STATE.FAILED);
      this.emit("quality-too-low", {
        quality,
        message: `指纹质量不足 (${(quality * 100).toFixed(0)}%)`,
      });
      return {
        success: false,
        reason: "poor_quality",
        quality,
        message: `指纹质量 ${(quality * 100).toFixed(0)}%，需 ≥ 80%，请重新注册`,
      };
    }

    // Step 5: 写入模板
    this._setState(ENROLLMENT_STATE.WRITING_TEMPLATE);
    this.emit("step-changed", {
      step: "write_template",
      message: "正在将指纹写入 U盾 芯片...",
    });

    const result = await this._bm.enrollFingerprint({
      usage: this._session.usage,
      label: this._session.label,
    });

    if (result.success) {
      this._setState(ENROLLMENT_STATE.COMPLETED);
      this.emit("enrollment-success", {
        fingerprintId: result.fingerprintId,
        label: this._session.label,
        quality,
      });
      return {
        success: true,
        fingerprintId: result.fingerprintId,
        quality,
        label: this._session.label,
      };
    } else {
      this._setState(ENROLLMENT_STATE.FAILED);
      return { success: false, reason: result.reason, message: result.message };
    }
  }

  /**
   * 取消注册
   */
  cancel() {
    this._setState(ENROLLMENT_STATE.IDLE);
    this._session = null;
    this.emit("enrollment-cancelled");
  }

  /**
   * 重置（注册失败后重新开始）
   */
  reset() {
    this._setState(ENROLLMENT_STATE.IDLE);
    this._session = null;
  }

  async _verifyPin(pin) {
    // 通过 BiometricManager 引用的 UKeyManager 验证 PIN
    if (this._bm._ukeyManager) {
      return await this._bm._ukeyManager.verifyPIN(pin);
    }
    return { success: true }; // 没有 UKeyManager 时跳过
  }

  _setState(state) {
    this._state = state;
    this.emit("state-changed", { state });
    logger.info(`[FingerprintEnrollment] 状态: ${state}`);
  }

  getState() {
    return this._state;
  }
  getSession() {
    return this._session ? { ...this._session, samples: undefined } : null;
  }
}

module.exports = {
  FingerprintEnrollment,
  ENROLLMENT_STATE,
};
