"use strict";

/**
 * Hardware Wallet Bridge — unified interface for Ledger/Trezor/OneKey/Keystone
 * Handles device detection, routing, and connection management
 */

const EventEmitter = require("events");
const crypto = require("crypto");

// USB Vendor IDs for hardware wallets
const HW_VENDOR_IDS = {
  0x2c97: "Ledger",
  0x534c: "Trezor",
  0x1209: "Trezor", // new VID for Trezor T
  0x1fc9: "OneKey",
};

// Mock device database for simulation mode
const MOCK_DEVICES = [
  {
    id: "ledger-nano-x-001",
    brand: "Ledger",
    model: "Nano X",
    transport: "ble",
    vendorId: 0x2c97,
    productId: 0x0004,
    firmwareVersion: "2.1.0",
    deviceInfo: {
      model: "Nano X",
      firmware: "2.1.0",
      bootloader: "1.11.1",
      mcuVersion: "1.15",
    },
  },
  {
    id: "trezor-model-t-001",
    brand: "Trezor",
    model: "Model T",
    transport: "usb",
    vendorId: 0x1209,
    productId: 0x53c1,
    firmwareVersion: "2.6.3",
    deviceInfo: { model: "Model T", firmware: "2.6.3", bootloader: "2.0.4" },
  },
  {
    id: "onekey-classic-001",
    brand: "OneKey",
    model: "Classic 1S",
    transport: "usb",
    vendorId: 0x1fc9,
    productId: 0x0001,
    firmwareVersion: "4.1.0",
    deviceInfo: { model: "Classic 1S", firmware: "4.1.0", bootloader: "3.0.0" },
  },
  {
    id: "keystone-3-pro-001",
    brand: "Keystone",
    model: "3 Pro",
    transport: "qr",
    vendorId: null,
    productId: null,
    firmwareVersion: "1.6.0",
    deviceInfo: { model: "3 Pro", firmware: "1.6.0", bootloader: null },
  },
];

class HWWalletBridge extends EventEmitter {
  constructor() {
    super();
    this._connected = new Map(); // deviceId → { device, adapter }
    this._simulationMode = true;
  }

  /**
   * Scan for connected hardware wallets
   * @returns {Promise<object[]>} list of detected devices
   */
  async scan() {
    console.log("[HWWalletBridge] Scanning for hardware wallets...");

    if (this._simulationMode) {
      // Simulate scan delay
      await new Promise((r) => setTimeout(r, 500));
      const devices = MOCK_DEVICES.map((d) => ({ ...d }));
      this.emit("devices-found", { devices });
      console.log(
        `[HWWalletBridge] Found ${devices.length} devices (simulation)`,
      );
      return devices;
    }

    // Real HID scan would go here using 'node-hid' or 'usb'
    return [];
  }

  /**
   * Connect to a hardware wallet device
   * @param {string} deviceId
   * @returns {Promise<object>} connected device info
   */
  async connect(deviceId) {
    const deviceInfo = MOCK_DEVICES.find((d) => d.id === deviceId);
    if (!deviceInfo) {
      throw new Error(`Device not found: ${deviceId}`);
    }

    let adapter;
    switch (deviceInfo.brand) {
      case "Ledger":
        adapter = new (require("./ledger-adapter").LedgerAdapter)();
        break;
      case "Trezor":
        adapter = new (require("./trezor-adapter").TrezorAdapter)();
        break;
      case "OneKey":
        adapter = new (require("./onekey-adapter").OneKeyAdapter)();
        break;
      case "Keystone":
        adapter = new (require("./keystone-adapter").KeystoneAdapter)();
        break;
      default:
        throw new Error(`Unsupported device brand: ${deviceInfo.brand}`);
    }

    await adapter.connect(deviceInfo);
    this._connected.set(deviceId, { device: deviceInfo, adapter });
    this.emit("device-connected", { deviceId, brand: deviceInfo.brand });
    console.log(
      `[HWWalletBridge] Connected to ${deviceInfo.brand} ${deviceInfo.model}`,
    );
    return deviceInfo;
  }

  /**
   * Disconnect from a hardware wallet
   * @param {string} deviceId
   */
  async disconnect(deviceId) {
    const conn = this._connected.get(deviceId);
    if (conn) {
      await conn.adapter.disconnect();
      this._connected.delete(deviceId);
      this.emit("device-disconnected", { deviceId });
      console.log(`[HWWalletBridge] Disconnected from ${deviceId}`);
    }
  }

  /**
   * Get all currently connected devices
   * @returns {object[]}
   */
  getConnectedDevices() {
    return Array.from(this._connected.values()).map((c) => c.device);
  }

  /**
   * Get adapter for a connected device
   * @param {string} deviceId
   * @returns {object}
   */
  getAdapter(deviceId) {
    const conn = this._connected.get(deviceId);
    if (!conn) {
      throw new Error(`Device not connected: ${deviceId}`);
    }
    return conn.adapter;
  }

  /**
   * Get address from connected device
   * @param {string} deviceId
   * @param {string} derivationPath
   * @param {string} coinType
   * @returns {Promise<{ address: string, publicKey: string }>}
   */
  async getAddress(deviceId, derivationPath, coinType = "eth") {
    return this.getAdapter(deviceId).getAddress(derivationPath, coinType);
  }

  /**
   * Sign transaction via connected device
   * @param {string} deviceId
   * @param {string} derivationPath
   * @param {object} txParams
   * @returns {Promise<{ signature: string, txHash: string }>}
   */
  async signTx(deviceId, derivationPath, txParams) {
    return this.getAdapter(deviceId).signTx(derivationPath, txParams);
  }
}

module.exports = { HWWalletBridge };
