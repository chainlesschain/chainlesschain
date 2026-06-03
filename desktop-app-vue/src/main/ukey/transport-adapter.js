/**
 * 多传输适配器 (v0.41.0)
 *
 * 统一管理 USB / BLE / NFC 三种传输方式
 * 优先级: USB > BLE > NFC
 * 支持自动切换（USB 断开时自动切换到 BLE）
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");

const TRANSPORT_TYPE = {
  USB: "usb",
  BLE: "ble",
  NFC: "nfc",
};

const TRANSPORT_PRIORITY = {
  [TRANSPORT_TYPE.USB]: 3,
  [TRANSPORT_TYPE.BLE]: 2,
  [TRANSPORT_TYPE.NFC]: 1,
};

class TransportAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;

    this._activeTransport = null;
    this._transports = new Map();

    this._priority = config.transportPriority || [
      TRANSPORT_TYPE.USB,
      TRANSPORT_TYPE.BLE,
      TRANSPORT_TYPE.NFC,
    ];

    this._autoSwitch = config.autoSwitch !== false;
    this._monitorInterval = null;
  }

  // ============================================================
  // 传输驱动注册
  // ============================================================

  register(type, driver) {
    this._transports.set(type, driver);
    logger.info(`[TransportAdapter] 注册传输驱动: ${type}`);
  }

  // ============================================================
  // 连接管理
  // ============================================================

  async connect() {
    logger.info("[TransportAdapter] 按优先级尝试传输连接...");

    for (const type of this._priority) {
      const driver = this._transports.get(type);
      if (!driver) {
        continue;
      }

      try {
        const available = await driver.isAvailable();
        if (available) {
          await driver.connect();
          this._activeTransport = type;
          logger.info(`[TransportAdapter] 使用传输: ${type}`);
          this.emit("transport-connected", { type });
          this._startMonitor();
          return { success: true, transport: type };
        }
      } catch (e) {
        logger.warn(`[TransportAdapter] ${type} 连接失败: ${e.message}`);
      }
    }

    return { success: false, reason: "no_transport_available" };
  }

  async disconnect() {
    this._stopMonitor();
    if (this._activeTransport) {
      const driver = this._transports.get(this._activeTransport);
      if (driver) {
        await driver.disconnect().catch(() => {});
      }
      this._activeTransport = null;
    }
    this.emit("transport-disconnected");
  }

  // ============================================================
  // 数据收发
  // ============================================================

  async send(data) {
    const driver = this._getActiveDriver();
    if (!driver) {
      throw new Error("无可用传输连接");
    }
    return await driver.send(data);
  }

  async receive(timeout = 30000) {
    const driver = this._getActiveDriver();
    if (!driver) {
      throw new Error("无可用传输连接");
    }
    return await driver.receive(timeout);
  }

  _getActiveDriver() {
    if (!this._activeTransport) {
      return null;
    }
    return this._transports.get(this._activeTransport) || null;
  }

  // ============================================================
  // 自动切换
  // ============================================================

  _startMonitor() {
    if (!this._autoSwitch || this._monitorInterval) {
      return;
    }

    this._monitorInterval = setInterval(async () => {
      if (!this._activeTransport) {
        return;
      }

      const driver = this._transports.get(this._activeTransport);
      if (!driver) {
        return;
      }

      try {
        const alive = await driver.isConnected();
        if (!alive) {
          logger.warn(
            `[TransportAdapter] 传输 ${this._activeTransport} 已断开，尝试切换...`,
          );
          this.emit("transport-lost", { type: this._activeTransport });
          this._activeTransport = null;
          await this.connect();
        }

        // 检查是否有更高优先级的传输可用
        await this._checkForBetterTransport();
      } catch (e) {
        logger.warn("[TransportAdapter] 监控出错:", e.message);
      }
    }, 3000);
  }

  _stopMonitor() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
  }

  async _checkForBetterTransport() {
    if (!this._activeTransport) {
      return;
    }
    const currentPriority = TRANSPORT_PRIORITY[this._activeTransport] || 0;

    for (const type of this._priority) {
      if (TRANSPORT_PRIORITY[type] <= currentPriority) {
        continue;
      }
      const driver = this._transports.get(type);
      if (!driver) {
        continue;
      }

      try {
        const available = await driver.isAvailable();
        if (available) {
          logger.info(
            `[TransportAdapter] 发现更高优先级传输 ${type}，切换中...`,
          );
          const old = this._activeTransport;
          await this._transports
            .get(old)
            ?.disconnect()
            .catch(() => {});
          await driver.connect();
          this._activeTransport = type;
          this.emit("transport-switched", { from: old, to: type });
          break;
        }
      } catch (_e) {
        /* ignore transport switch errors */
      }
    }
  }

  // ============================================================
  // 状态查询
  // ============================================================

  getActiveTransport() {
    return this._activeTransport;
  }
  isConnected() {
    return !!this._activeTransport;
  }

  async getSignalStrength() {
    if (this._activeTransport === TRANSPORT_TYPE.BLE) {
      const driver = this._transports.get(TRANSPORT_TYPE.BLE);
      return driver?.getSignalStrength?.() || null;
    }
    return null;
  }

  async close() {
    await this.disconnect();
    for (const driver of this._transports.values()) {
      await driver.close?.().catch(() => {});
    }
    this._transports.clear();
  }
}

module.exports = { TransportAdapter, TRANSPORT_TYPE, TRANSPORT_PRIORITY };
