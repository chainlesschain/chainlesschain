/**
 * 龙脉科技 (LongMai) U盾驱动 (v0.39.0)
 *
 * 支持型号:
 * - mToken K5 (PKCS#11)
 * - mToken K8 (PKCS#11)
 * - mToken KT (USB Key)
 *
 * 基于 SKF 标准 API（GM/T 0016-2012）
 */

const { logger } = require("../utils/logger.js");
const SKFDriver = require("./skf-driver");
const path = require("path");
const fs = require("fs");

class LongMaiDriver extends SKFDriver {
  constructor(config = {}) {
    super(config);
    this.driverName = "LongMai";
    this.driverVersion = "1.0.0";
  }

  static get driverName() {
    return "longmai";
  }
  static get priority() {
    return 10;
  }

  findDllPath() {
    if (process.platform !== "win32") {
      logger.warn("[LongMai] 仅支持 Windows 平台");
      return null;
    }

    const possiblePaths = [
      path.join(__dirname, "../../../resources/native/longmai/mtoken_skf.dll"),
      path.join(
        __dirname,
        "../../../resources/native/longmai/mtoken_pkcs11.dll",
      ),
      path.join(__dirname, "../../../resources/native/longmai/longmai_skf.dll"),
      "C:\\Windows\\System32\\mtoken_skf.dll",
      "C:\\Windows\\System32\\mtoken_pkcs11.dll",
      "C:\\Windows\\SysWOW64\\mtoken_skf.dll",
      "C:\\Program Files\\LongMai\\mToken\\mtoken_skf.dll",
      "C:\\Program Files (x86)\\LongMai\\mToken\\mtoken_skf.dll",
      "C:\\Program Files\\龙脉科技\\mtoken_skf.dll",
      "C:\\Program Files (x86)\\龙脉科技\\mtoken_skf.dll",
      path.join(process.cwd(), "resources", "native", "mtoken_skf.dll"),
    ];

    for (const dllPath of possiblePaths) {
      if (fs.existsSync(dllPath)) {
        logger.info(`[LongMai] 找到 DLL: ${dllPath}`);
        return dllPath;
      }
    }

    logger.warn("[LongMai] 未在标准路径找到 DLL，切换模拟模式");
    return null;
  }

  async initialize() {
    logger.info("[LongMai] 初始化龙脉科技驱动...");
    try {
      await super.initialize();
      logger.info("[LongMai] 龙脉科技驱动初始化成功");
      return true;
    } catch (error) {
      logger.error("[LongMai] 初始化失败:", error);
      this.simulationMode = true;
      this.isInitialized = true;
      return true;
    }
  }

  getManufacturerName() {
    return "北京龙脉科技集团有限公司";
  }
  getModelName() {
    return "龙脉 mToken 系列";
  }
  getDriverName() {
    return "龙脉科技U盾驱动";
  }
  getDriverVersion() {
    return this.driverVersion;
  }

  async detect() {
    logger.info("[LongMai] 检测龙脉科技设备...");
    try {
      const result = await super.detect();
      if (result.detected) {
        result.manufacturer = this.getManufacturerName();
        result.model = this.getModelName();
      }
      return result;
    } catch (error) {
      logger.error("[LongMai] 检测失败:", error);
      return { detected: false, unlocked: false };
    }
  }

  async getDeviceInfo() {
    const info = await super.getDeviceInfo();
    info.manufacturer = this.getManufacturerName();
    info.model = this.getModelName();
    info.vendor = "LongMai";
    info.productLine = "mToken";
    return info;
  }

  async checkDeviceHealth() {
    logger.info("[LongMai] 检测设备健康状态...");
    try {
      if (this.simulationMode) {
        return { healthy: true, status: "simulation" };
      }
      const detected = await this.detect();
      return detected.detected
        ? { healthy: true, status: "ok" }
        : { healthy: false, status: "not_connected" };
    } catch (error) {
      return { healthy: false, status: "error", error: error.message };
    }
  }
}

module.exports = LongMaiDriver;
