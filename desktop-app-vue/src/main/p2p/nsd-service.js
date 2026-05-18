/**
 * NSD (Network Service Discovery) 服务注册
 *
 * 使桌面端能被 Android NSD 发现
 */

const { Bonjour } = require("bonjour-service");
const os = require("os");
const { logger } = require("../utils/logger.js");

class NSDService {
  constructor() {
    this.bonjour = null;
    this.service = null;

    // 与 Android 端匹配的配置
    this.SERVICE_TYPE = "chainlesschain"; // 不包含下划线和._tcp.后缀（bonjour会自动添加）
    this.SERVICE_PORT = 8888;
  }

  /**
   * 启动 NSD 服务
   */
  start(deviceInfo) {
    try {
      if (this.service) {
        logger.warn("NSD service already running");
        return;
      }

      logger.info("[NSDService] Initializing Bonjour...");
      // 使用解构导入的 Bonjour 类
      this.bonjour = new Bonjour();
      logger.info("[NSDService] Bonjour initialized successfully");

      // 获取本机 IP 地址
      const networkInterfaces = os.networkInterfaces();
      const addresses = [];

      for (const interfaceName in networkInterfaces) {
        const iface = networkInterfaces[interfaceName];
        for (const addr of iface) {
          // 只使用 IPv4 地址，跳过内部地址
          if (addr.family === "IPv4" && !addr.internal) {
            addresses.push(addr.address);
          }
        }
      }

      const serviceName = `${deviceInfo.deviceName || "Desktop"}-${deviceInfo.deviceId.substring(0, 8)}`;

      // 注册服务（与 Android NSD 兼容）
      // SECURITY-NOTE: This is mDNS service discovery broadcast, not P2P message transmission.
      // Device discovery uses public information only. Actual P2P communication uses Signal Protocol encryption.
      this.service = this.bonjour.publish({
        name: serviceName,
        type: this.SERVICE_TYPE, // bonjour 会自动转换为 _chainlesschain._tcp
        port: this.SERVICE_PORT,
        txt: {
          device_id: deviceInfo.deviceId,
          device_type: "DESKTOP",
          public_key: deviceInfo.publicKey || "",
        },
      });

      this.service.on("up", () => {
        logger.info(`✅ NSD service registered: ${serviceName}`);
        logger.info(`   Service Type: _${this.SERVICE_TYPE}._tcp.`);
        logger.info(`   Port: ${this.SERVICE_PORT}`);
        logger.info(`   IP Addresses: ${addresses.join(", ")}`);
        logger.info(`   Device ID: ${deviceInfo.deviceId}`);
      });

      this.service.on("error", (error) => {
        logger.error("NSD service error:", error);
      });

      logger.info(`🔍 Starting NSD service for ${serviceName}...`);
    } catch (error) {
      logger.error("Failed to start NSD service:", error.message);
      logger.error("Error stack:", error.stack);
      logger.error("Error details:", error);
    }
  }

  /**
   * 停止 NSD 服务
   */
  stop() {
    try {
      if (this.service) {
        this.service.stop(() => {
          logger.info("NSD service stopped");
        });
        this.service = null;
      }

      if (this.bonjour) {
        this.bonjour.destroy();
        this.bonjour = null;
      }
    } catch (error) {
      logger.error("Failed to stop NSD service:", error);
    }
  }

  /**
   * 扫描其他设备（可选功能）
   */
  browse(callback) {
    if (!this.bonjour) {
      this.bonjour = new Bonjour();
    }

    const browser = this.bonjour.find(
      { type: this.SERVICE_TYPE },
      (service) => {
        logger.info(`Found device via NSD: ${service.name}`);

        const deviceInfo = {
          deviceId: service.txt?.device_id || "",
          deviceName: service.name,
          deviceType: service.txt?.device_type || "UNKNOWN",
          address: `${service.referer?.address}:${service.port}`,
          publicKey: service.txt?.public_key || null,
        };

        callback(deviceInfo);
      },
    );

    return browser;
  }
}

module.exports = NSDService;
