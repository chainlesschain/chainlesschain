/**
 * 明华澳汉 (MingHua) U盾驱动 (v0.39.0)
 *
 * 支持型号:
 * - EP801 (CSP/PKCS#11)
 * - EP900 (PKCS#11)
 *
 * 基于 SKF 标准 API（GM/T 0016-2012）
 */

const { logger } = require("../utils/logger.js");
const SKFDriver = require("./skf-driver");
const path = require("path");
const fs = require("fs");

class MingHuaDriver extends SKFDriver {
  constructor(config = {}) {
    super(config);
    this.driverName = "MingHua";
    this.driverVersion = "1.0.0";
  }

  static get driverName() {
    return "minghua";
  }
  static get priority() {
    return 10;
  }

  findDllPath() {
    if (process.platform !== "win32") {
      logger.warn("[MingHua] 仅支持 Windows 平台");
      return null;
    }

    const possiblePaths = [
      path.join(__dirname, "../../../resources/native/minghua/mhao_skf.dll"),
      path.join(__dirname, "../../../resources/native/minghua/mhao_pkcs11.dll"),
      "C:\\Windows\\System32\\mhao_skf.dll",
      "C:\\Windows\\System32\\mhao_pkcs11.dll",
      "C:\\Windows\\SysWOW64\\mhao_skf.dll",
      "C:\\Program Files\\MingHuaAoHan\\EP\\mhao_skf.dll",
      "C:\\Program Files (x86)\\MingHuaAoHan\\EP\\mhao_skf.dll",
      "C:\\Program Files\\明华澳汉\\mhao_skf.dll",
      "C:\\Program Files (x86)\\明华澳汉\\mhao_skf.dll",
      path.join(process.cwd(), "resources", "native", "mhao_skf.dll"),
    ];

    for (const dllPath of possiblePaths) {
      if (fs.existsSync(dllPath)) {
        logger.info(`[MingHua] 找到 DLL: ${dllPath}`);
        return dllPath;
      }
    }

    logger.warn("[MingHua] 未在标准路径找到 DLL，切换模拟模式");
    return null;
  }

  async initialize() {
    logger.info("[MingHua] 初始化明华澳汉驱动...");
    try {
      await super.initialize();
      logger.info("[MingHua] 明华澳汉驱动初始化成功");
      return true;
    } catch (error) {
      logger.error("[MingHua] 初始化失败:", error);
      this.simulationMode = true;
      this.isInitialized = true;
      return true;
    }
  }

  getManufacturerName() {
    return "明华澳汉科技（深圳）有限公司";
  }
  getModelName() {
    return "明华澳汉 EP 系列";
  }
  getDriverName() {
    return "明华澳汉U盾驱动";
  }
  getDriverVersion() {
    return this.driverVersion;
  }

  async detect() {
    logger.info("[MingHua] 检测明华澳汉设备...");
    try {
      const result = await super.detect();
      if (result.detected) {
        result.manufacturer = this.getManufacturerName();
        result.model = this.getModelName();
      }
      return result;
    } catch (error) {
      logger.error("[MingHua] 检测失败:", error);
      return { detected: false, unlocked: false };
    }
  }

  async getDeviceInfo() {
    const info = await super.getDeviceInfo();
    info.manufacturer = this.getManufacturerName();
    info.model = this.getModelName();
    info.vendor = "MingHua";
    info.productLine = "EP";
    return info;
  }

  async checkDeviceHealth() {
    logger.info("[MingHua] 检测设备健康状态...");
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

module.exports = MingHuaDriver;
