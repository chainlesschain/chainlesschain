"use strict";

/**
 * Ledger hardware wallet adapter
 * Communicates via APDU commands over USB HID or BLE
 */

const crypto = require("crypto");

// APDU command codes
const CLA = 0xe0;
const INS_GET_ADDRESS = 0x02;
const INS_SIGN_TX = 0x04;
const INS_GET_APP_NAME = 0x01;
const INS_GET_DEVICE_INFO = 0x01;

class LedgerAdapter {
  constructor() {
    this._device = null;
    this._transport = null;
    this._connected = false;
  }

  /**
   * Connect to Ledger device
   * @param {object} device - device info from HWWalletBridge
   * @returns {Promise<void>}
   */
  async connect(device) {
    this._device = device;
    this._connected = true;
    console.log(
      `[LedgerAdapter] Connected to ${device.model} via ${device.transport}`,
    );
    // Real: open USB HID or BLE GATT connection here
  }

  /**
   * Disconnect
   */
  async disconnect() {
    this._connected = false;
    this._device = null;
    console.log("[LedgerAdapter] Disconnected");
  }

  /**
   * Get BIP-44 address from Ledger
   * @param {string} derivationPath - e.g. "m/44'/60'/0'/0/0"
   * @param {'eth'|'btc'|'sol'} coinType
   * @returns {Promise<{ address: string, publicKey: string }>}
   */
  async getAddress(derivationPath, coinType = "eth") {
    this._checkConnected();
    console.log(`[LedgerAdapter] Getting address: ${derivationPath}`);

    // Simulate APDU response
    await new Promise((r) => setTimeout(r, 200));
    const seed = crypto
      .createHash("sha256")
      .update(derivationPath + this._device.id)
      .digest();
    const address = "0x" + seed.slice(0, 20).toString("hex");
    const publicKey =
      "04" + seed.toString("hex") + crypto.randomBytes(32).toString("hex");

    return { address, publicKey, derivationPath };
  }

  /**
   * Sign a transaction on Ledger (user must confirm on device)
   * @param {string} derivationPath
   * @param {object|string} txParams
   * @param {number} [chainId]
   * @returns {Promise<{ v: number, r: string, s: string, signature: string }>}
   */
  async signTx(derivationPath, txParams, chainId = 1) {
    this._checkConnected();
    console.log(`[LedgerAdapter] Signing tx on device (user must confirm)...`);

    // Simulate device confirmation time (user presses button)
    await new Promise((r) => setTimeout(r, 2000));

    const r = crypto.randomBytes(32).toString("hex");
    const s = crypto.randomBytes(32).toString("hex");
    const v = chainId * 2 + 35 + Math.floor(Math.random() * 2);
    const signature = `0x${r}${s}${v.toString(16).padStart(2, "0")}`;

    return { v, r: "0x" + r, s: "0x" + s, signature };
  }

  /**
   * Sign a personal message
   * @param {string} derivationPath
   * @param {string} message
   * @returns {Promise<{ signature: string }>}
   */
  async signMessage(derivationPath, message) {
    this._checkConnected();
    console.log(`[LedgerAdapter] Signing message on device...`);
    await new Promise((r) => setTimeout(r, 1500));
    const signature = "0x" + crypto.randomBytes(65).toString("hex");
    return { signature };
  }

  /**
   * Get device info
   * @returns {Promise<{ model: string, firmwareVersion: string, appVersion: string }>}
   */
  async getDeviceInfo() {
    this._checkConnected();
    return {
      model: this._device?.model || "Ledger",
      firmwareVersion: this._device?.firmwareVersion || "2.1.0",
      appVersion: "1.10.3",
      mcuVersion: this._device?.deviceInfo?.mcuVersion || "1.15",
    };
  }

  _checkConnected() {
    if (!this._connected) {
      throw new Error("Ledger device not connected");
    }
  }
}

module.exports = { LedgerAdapter };
