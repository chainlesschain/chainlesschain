/**
 * 长城信安 (ChangCheng) U盾驱动 (v0.39.0)
 *
 * 支持型号:
 * - GW-USB100 (PKCS#11)
 * - GW-USB200 (PKCS#11)
 *
 * 基于 SKF 标准 API（GM/T 0016-2012）
 */

const { logger } = require("../utils/logger.js");
const SKFDriver = require("./skf-driver");
const path = require("path");
const fs = require("fs");

class ChangChengDriver extends SKFDriver {
  constructor(config = {}) {
    super(config);
    this.driverName = "ChangCheng";
    this.driverVersion = "1.0.0";
  }

  static get driverName() {
    return "changcheng";
  }
  static get priority() {
    return 10;
  }

  findDllPath() {
    if (process.platform !== "win32") {
      logger.warn("[ChangCheng] 仅支持 Windows 平台");
      return null;
    }

    const possiblePaths = [
      path.join(
        __dirname,
        "../../../resources/native/changcheng/GW_SKFAPI.dll",
      ),
      path.join(
        __dirname,
        "../../../resources/native/changcheng/gw_pkcs11.dll",
      ),
      "C:\\Windows\\System32\\GW_SKFAPI.dll",
      "C:\\Windows\\System32\\gw_pkcs11.dll",
      "C:\\Windows\\SysWOW64\\GW_SKFAPI.dll",
      "C:\\Program Files\\ChangCheng\\USB\\GW_SKFAPI.dll",
      "C:\\Program Files (x86)\\ChangCheng\\USB\\GW_SKFAPI.dll",
      "C:\\Program Files\\长城信安\\GW_SKFAPI.dll",
      "C:\\Program Files (x86)\\长城信安\\GW_SKFAPI.dll",
      path.join(process.cwd(), "resources", "native", "GW_SKFAPI.dll"),
    ];

    for (const dllPath of possiblePaths) {
      if (fs.existsSync(dllPath)) {
        logger.info(`[ChangCheng] 找到 DLL: ${dllPath}`);
        return dllPath;
      }
    }

    logger.warn("[ChangCheng] 未在标准路径找到 DLL，切换模拟模式");
    return null;
  }

  async initialize() {
    logger.info("[ChangCheng] 初始化长城信安驱动...");
    try {
      await super.initialize();
      logger.info("[ChangCheng] 长城信安驱动初始化成功");
      return true;
    } catch (error) {
      logger.error("[ChangCheng] 初始化失败:", error);
      this.simulationMode = true;
      this.isInitialized = true;
      return true;
    }
  }

  getManufacturerName() {
    return "长城信安（北京）科技有限公司";
  }
  getModelName() {
    return "长城信安 GW-USB 系列";
  }
  getDriverName() {
    return "长城信安U盾驱动";
  }
  getDriverVersion() {
    return this.driverVersion;
  }

  async detect() {
    logger.info("[ChangCheng] 检测长城信安设备...");
    try {
      const result = await super.detect();
      if (result.detected) {
        result.manufacturer = this.getManufacturerName();
        result.model = this.getModelName();
      }
      return result;
    } catch (error) {
      logger.error("[ChangCheng] 检测失败:", error);
      return { detected: false, unlocked: false };
    }
  }

  async getDeviceInfo() {
    const info = await super.getDeviceInfo();
    info.manufacturer = this.getManufacturerName();
    info.model = this.getModelName();
    info.vendor = "ChangCheng";
    info.productLine = "GW-USB";
    return info;
  }

  async checkDeviceHealth() {
    logger.info("[ChangCheng] 检测设备健康状态...");
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

module.exports = ChangChengDriver;
