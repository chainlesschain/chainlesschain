"use strict";

/**
 * Trezor hardware wallet adapter
 * Uses Trezor Connect protocol (simulated)
 */

const crypto = require("crypto");

class TrezorAdapter {
  constructor() {
    this._device = null;
    this._connected = false;
    this._sessionId = null;
  }

  async connect(device) {
    this._device = device;
    this._connected = true;
    this._sessionId = crypto.randomBytes(8).toString("hex");
    console.log(
      `[TrezorAdapter] Connected to ${device.model} (session: ${this._sessionId})`,
    );
  }

  async disconnect() {
    this._connected = false;
    this._device = null;
    this._sessionId = null;
    console.log("[TrezorAdapter] Disconnected");
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
      .update(derivationPath + this._device.id + "trezor")
      .digest();
    const address =
      coinType === "btc"
        ? "bc1q" + seed.slice(0, 20).toString("hex")
        : "0x" + seed.slice(0, 20).toString("hex");
    return {
      address,
      publicKey:
        "04" + seed.toString("hex") + crypto.randomBytes(32).toString("hex"),
      derivationPath,
    };
  }

  /**
   * Sign transaction (user confirms on Trezor screen)
   * @param {string} derivationPath
   * @param {object} txParams
   * @returns {Promise<string>} signed tx hex
   */
  async signTx(derivationPath, txParams) {
    this._checkConnected();
    console.log(
      `[TrezorAdapter] Signing tx — waiting for user confirmation on device...`,
    );
    await new Promise((r) => setTimeout(r, 2500));
    // Return simulated signed tx hex
    return "0x" + crypto.randomBytes(200).toString("hex");
  }

  /**
   * Sign personal message
   * @param {string} derivationPath
   * @param {string} message
   * @returns {Promise<{ signature: string }>}
   */
  async signMessage(derivationPath, message) {
    this._checkConnected();
    await new Promise((r) => setTimeout(r, 1500));
    return { signature: "0x" + crypto.randomBytes(65).toString("hex") };
  }

  /**
   * Get device info
   */
  async getDeviceInfo() {
    this._checkConnected();
    return {
      model: this._device?.model || "Trezor",
      firmwareVersion: this._device?.firmwareVersion || "2.6.3",
      bootloaderVersion: this._device?.deviceInfo?.bootloader || "2.0.4",
      sessionId: this._sessionId,
    };
  }

  /**
   * Wipe device (requires explicit user confirmation)
   * @param {boolean} confirmed - must be true (caller responsibility)
   */
  async wipeDevice(confirmed) {
    if (!confirmed) {
      throw new Error("Device wipe requires explicit confirmation");
    }
    this._checkConnected();
    console.warn("[TrezorAdapter] WIPE DEVICE — this is irreversible!");
    await new Promise((r) => setTimeout(r, 3000));
    return { success: true };
  }

  /**
   * Reset device with new seed
   * @param {{ strength: number, label: string }} options
   */
  async resetDevice(options = {}) {
    this._checkConnected();
    console.warn("[TrezorAdapter] Reset device — generating new seed");
    await new Promise((r) => setTimeout(r, 5000));
    return { success: true, label: options.label || "My Trezor" };
  }

  _checkConnected() {
    if (!this._connected) {
      throw new Error("Trezor device not connected");
    }
  }
}

module.exports = { TrezorAdapter };
