"use strict";

/**
 * OneKey hardware wallet adapter
 * OneKey uses a modified Trezor firmware — same protocol with extensions
 */

const crypto = require("crypto");

class OneKeyAdapter {
  constructor() {
    this._device = null;
    this._connected = false;
    this._bridgeUrl = "http://127.0.0.1:21320"; // OneKey Bridge local service
  }

  async connect(device) {
    this._device = device;
    this._connected = true;
    console.log(
      `[OneKeyAdapter] Connected to ${device.model} via ${device.transport}`,
    );
    // Real: connect via OneKey Bridge or USB HID
  }

  async disconnect() {
    this._connected = false;
    this._device = null;
    console.log("[OneKeyAdapter] Disconnected");
  }

  /**
   * Get BIP-44 address
   * @param {string} derivationPath
   * @param {'eth'|'btc'|'sol'} coinType
   * @returns {Promise<{ address: string, publicKey: string }>}
   */
  async getAddress(derivationPath, coinType = "eth") {
    this._checkConnected();
    await new Promise((r) => setTimeout(r, 200));
    const seed = crypto
      .createHash("sha256")
      .update(derivationPath + this._device.id + "onekey")
      .digest();
    const address = "0x" + seed.slice(0, 20).toString("hex");
    return {
      address,
      publicKey:
        "04" + seed.toString("hex") + crypto.randomBytes(32).toString("hex"),
      derivationPath,
    };
  }

  /**
   * Sign transaction
   * @param {string} derivationPath
   * @param {object} txParams
   * @returns {Promise<string>} signed tx hex
   */
  async signTx(derivationPath, txParams) {
    this._checkConnected();
    console.log(
      "[OneKeyAdapter] Signing tx — waiting for user confirmation on device...",
    );
    await new Promise((r) => setTimeout(r, 2000));
    return "0x" + crypto.randomBytes(200).toString("hex");
  }

  /**
   * Sign personal message
   */
  async signMessage(derivationPath, message) {
    this._checkConnected();
    await new Promise((r) => setTimeout(r, 1500));
    return { signature: "0x" + crypto.randomBytes(65).toString("hex") };
  }

  /**
   * Get device info (OneKey-specific fields)
   */
  async getDeviceInfo() {
    this._checkConnected();
    return {
      model: this._device?.model || "OneKey",
      firmwareVersion: this._device?.firmwareVersion || "4.1.0",
      bootloaderVersion: this._device?.deviceInfo?.bootloader || "3.0.0",
      oneKeyVersion: "OneKey 4.x",
    };
  }

  _checkConnected() {
    if (!this._connected) {
      throw new Error("OneKey device not connected");
    }
  }
}

module.exports = { OneKeyAdapter };
