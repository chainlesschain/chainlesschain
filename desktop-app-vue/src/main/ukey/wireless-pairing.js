/**
 * 无线 U盾 配对管理器 (v0.41.0)
 *
 * 管理 BLE/NFC 无线 U盾 的配对信息:
 * - BLE 设备配对（ECDH 密钥交换）
 * - NFC 设备注册
 * - 配对信息持久化
 * - 连接状态监控
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { BLEDriver } = require("./ble-driver");
const { NFCDriver } = require("./nfc-driver");
const { TransportAdapter, TRANSPORT_TYPE } = require("./transport-adapter");

const PAIRING_FILE = ".chainlesschain/wireless-pairing.json";

class WirelessPairingManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;

    this._pairingFile = path.join(
      process.env.APPDATA || process.env.HOME || process.env.USERPROFILE || "",
      "chainlesschain-desktop-vue",
      PAIRING_FILE,
    );

    this._pairedDevices = this._loadPairingData();

    // 子驱动
    this._bleDriver = new BLEDriver(config.ble || {});
    this._nfcDriver = new NFCDriver(config.nfc || {});

    // 传输适配器
    this._transportAdapter = new TransportAdapter(config.transport || {});
    this._transportAdapter.register(TRANSPORT_TYPE.BLE, this._bleDriver);
    this._transportAdapter.register(TRANSPORT_TYPE.NFC, this._nfcDriver);

    // 连接状态
    this._connectionStatus = {
      ble: "disconnected",
      nfc: "idle",
      active: null,
    };

    this._setupEventListeners();
  }

  // ============================================================
  // BLE 配对流程
  // ============================================================

  /**
   * 扫描并配对 BLE 设备
   */
  async pairBLEDevice() {
    logger.info("[WirelessPairing] 开始 BLE 配对流程...");
    this.emit("pairing-started", { type: "ble" });

    // 扫描
    const scanResult = await this._bleDriver.scan(15000);
    if (!scanResult.success || scanResult.devices.length === 0) {
      this.emit("pairing-failed", { type: "ble", reason: "no_devices_found" });
      return {
        success: false,
        reason: "no_devices_found",
        message: "未发现 FIDO2 BLE 设备",
      };
    }

    // 返回设备列表供用户选择
    this.emit("devices-found", { type: "ble", devices: scanResult.devices });
    return {
      success: true,
      devices: scanResult.devices,
      requiresSelection: true,
    };
  }

  /**
   * 选择并确认配对指定设备
   * @param {string} deviceId
   */
  async confirmBLEPairing(deviceId) {
    logger.info(`[WirelessPairing] 确认配对: ${deviceId}`);
    this.emit("pairing-progress", { type: "ble", step: "exchanging_keys" });

    const result = await this._bleDriver.pair(deviceId);
    if (!result.success) {
      this.emit("pairing-failed", { type: "ble", reason: result.reason });
      return result;
    }

    // 持久化配对信息
    this._pairedDevices.ble[deviceId] = {
      id: deviceId,
      name: result.pairingInfo.deviceName,
      pairedAt: result.pairingInfo.pairedAt,
      type: "ble",
    };
    this._savePairingData();

    this.emit("pairing-completed", { type: "ble", deviceId });
    logger.info(`[WirelessPairing] BLE 配对完成: ${deviceId}`);
    return { success: true, deviceId };
  }

  // ============================================================
  // NFC 注册
  // ============================================================

  async registerNFCDevice() {
    logger.info("[WirelessPairing] 注册 NFC 设备...");
    this.emit("pairing-started", { type: "nfc" });

    this.emit("nfc-tap-prompt", { message: "请将 NFC U盾 触碰读卡器" });

    const pollResult = await this._nfcDriver.startPolling(30000).catch((e) => ({
      success: false,
      error: e.message,
    }));

    if (!pollResult.success) {
      this.emit("pairing-failed", { type: "nfc", reason: "timeout" });
      return { success: false, reason: "timeout", message: "NFC 触碰超时" };
    }

    const tag = pollResult.tag;
    const nfcId = `nfc-${tag.uid}`;

    this._pairedDevices.nfc[nfcId] = {
      id: nfcId,
      uid: tag.uid,
      type: "nfc",
      standard: tag.standard,
      registeredAt: new Date().toISOString(),
    };
    this._savePairingData();

    this.emit("pairing-completed", { type: "nfc", deviceId: nfcId, tag });
    logger.info(`[WirelessPairing] NFC 设备注册完成: ${tag.uid}`);
    return { success: true, deviceId: nfcId, tag };
  }

  // ============================================================
  // 连接管理
  // ============================================================

  async connect() {
    return await this._transportAdapter.connect();
  }

  async disconnect() {
    await this._transportAdapter.disconnect();
    this._connectionStatus.active = null;
  }

  getConnectionStatus() {
    return {
      active: this._transportAdapter.getActiveTransport(),
      isConnected: this._transportAdapter.isConnected(),
      ...this._connectionStatus,
    };
  }

  // ============================================================
  // 设备管理
  // ============================================================

  listPairedDevices() {
    const all = [];
    for (const [id, info] of Object.entries(this._pairedDevices.ble || {})) {
      all.push({ ...info, transport: "ble" });
    }
    for (const [id, info] of Object.entries(this._pairedDevices.nfc || {})) {
      all.push({ ...info, transport: "nfc" });
    }
    return all;
  }

  removePairedDevice(deviceId) {
    let removed = false;

    if (this._pairedDevices.ble[deviceId]) {
      delete this._pairedDevices.ble[deviceId];
      this._bleDriver.removePairedDevice(deviceId);
      removed = true;
    }
    if (this._pairedDevices.nfc[deviceId]) {
      delete this._pairedDevices.nfc[deviceId];
      removed = true;
    }

    if (removed) {
      this._savePairingData();
      this.emit("device-removed", { deviceId });
    }

    return { success: removed };
  }

  // ============================================================
  // 数据持久化
  // ============================================================

  _loadPairingData() {
    try {
      if (fs.existsSync(this._pairingFile)) {
        return JSON.parse(fs.readFileSync(this._pairingFile, "utf8"));
      }
    } catch (e) {
      logger.warn("[WirelessPairing] 加载配对数据失败:", e.message);
    }
    return { ble: {}, nfc: {} };
  }

  _savePairingData() {
    try {
      const dir = path.dirname(this._pairingFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        this._pairingFile,
        JSON.stringify(this._pairedDevices, null, 2),
      );
    } catch (e) {
      logger.warn("[WirelessPairing] 保存配对数据失败:", e.message);
    }
  }

  // ============================================================
  // 事件监听
  // ============================================================

  _setupEventListeners() {
    this._transportAdapter.on("transport-connected", ({ type }) => {
      this._connectionStatus.active = type;
      this.emit("connected", { transport: type });
    });

    this._transportAdapter.on("transport-disconnected", () => {
      this._connectionStatus.active = null;
      this.emit("disconnected");
    });

    this._transportAdapter.on("transport-switched", ({ from, to }) => {
      this._connectionStatus.active = to;
      this.emit("transport-switched", { from, to });
    });

    this._bleDriver.on("device-found", (device) => {
      this.emit("ble-device-found", device);
    });

    this._nfcDriver.on("tag-detected", (tag) => {
      this.emit("nfc-tag-detected", tag);
    });
  }

  async close() {
    await this.disconnect();
    await this._bleDriver.close();
    await this._nfcDriver.close();
    await this._transportAdapter.close();
  }
}

module.exports = { WirelessPairingManager };
