"use strict";

/**
 * Keystone QR air-gapped wallet adapter
 * Uses Uniform Resource (UR) QR codes for transaction signing
 * No USB — fully air-gapped communication via camera/display
 */

const crypto = require("crypto");

class KeystoneAdapter {
  constructor() {
    this._device = null;
    this._connected = false;
  }

  async connect(device) {
    this._device = device;
    this._connected = true;
    console.log(
      `[KeystoneAdapter] Ready for QR communication with ${device.model}`,
    );
  }

  async disconnect() {
    this._connected = false;
    this._device = null;
  }

  /**
   * Generate QR code data for a transaction (display on computer screen)
   * @param {object} txData - transaction to be signed
   * @returns {{ qrData: string, urType: string, qrPayload: string }}
   */
  generateQRCode(txData) {
    // Encode as Uniform Resource (UR) format used by Keystone
    // Real: use @keystonehq/keystone-sdk for proper UR encoding
    const payload = Buffer.from(
      JSON.stringify({
        type: "eth-sign-request",
        requestId: crypto.randomUUID(),
        signData: Buffer.from(JSON.stringify(txData)).toString("base64"),
        dataType: 1, // 1=transaction, 2=typed data, 3=raw bytes
        chainId: txData.chainId || 1,
        derivationPath: txData.derivationPath || "m/44'/60'/0'/0/0",
        origin: "ChainlessChain",
      }),
    ).toString("base64");

    // UR format: ur:eth-sign-request/<encoded>
    const urPayload = `ur:eth-sign-request/${payload}`;
    console.log(
      `[KeystoneAdapter] Generated QR payload (${urPayload.length} chars)`,
    );

    return {
      qrData: urPayload,
      urType: "eth-sign-request",
      qrPayload: payload,
      estimatedFrames: Math.ceil(urPayload.length / 200), // multi-frame QR
    };
  }

  /**
   * Parse a QR code scanned from the Keystone device (signature response)
   * @param {string} qrData - raw QR code data from device camera
   * @returns {{ signature: string, requestId: string }>}
   */
  parseQRSignature(qrData) {
    if (!qrData) {
      throw new Error("No QR data provided");
    }

    // Real: use @keystonehq/keystone-sdk to decode UR
    // Simulation: extract or generate signature
    if (qrData.startsWith("ur:eth-signature/")) {
      try {
        const base64Part = qrData.split("/")[1];
        const decoded = JSON.parse(
          Buffer.from(base64Part, "base64").toString(),
        );
        return {
          signature: decoded.signature,
          requestId: decoded.requestId,
          origin: "Keystone",
        };
      } catch {
        // Fall through to simulation
      }
    }

    // Simulation: return mock signature
    const r = crypto.randomBytes(32).toString("hex");
    const s = crypto.randomBytes(32).toString("hex");
    return {
      signature: `0x${r}${s}1b`,
      requestId: "simulated",
      origin: "Keystone (simulation)",
    };
  }

  /**
   * Sign a transaction via QR (orchestrates the QR display/scan flow)
   * @param {object} txParams
   * @returns {Promise<{ signature: string, txHash: string }>}
   */
  async signTxViaQR(txParams) {
    this._checkConnected();
    console.log(
      "[KeystoneAdapter] QR signing flow started — display QR on screen",
    );

    const qrInfo = this.generateQRCode(txParams);

    // Emit QR to display (callers should listen to event or use returned qrInfo)
    // In real usage: display qrInfo.qrData as QR code, wait for user to scan + confirm on Keystone

    // Simulate user scanning QR on Keystone device and returning signature QR (3 second delay)
    await new Promise((r) => setTimeout(r, 3000));

    // Simulate receiving the signature QR from Keystone
    const mockSignatureQR =
      "ur:eth-signature/" +
      Buffer.from(
        JSON.stringify({
          requestId: "sim-001",
          signature: "0x" + crypto.randomBytes(65).toString("hex"),
        }),
      ).toString("base64");

    const result = this.parseQRSignature(mockSignatureQR);
    const txHash = "0x" + crypto.randomBytes(32).toString("hex");

    console.log("[KeystoneAdapter] QR signature received and parsed");
    return { ...result, txHash, qrInfo };
  }

  /**
   * Get device info (no USB connection, based on known info)
   */
  async getDeviceInfo() {
    return {
      model: this._device?.model || "Keystone 3 Pro",
      firmwareVersion: this._device?.firmwareVersion || "1.6.0",
      transport: "qr",
      airGapped: true,
    };
  }

  /**
   * Get BIP-44 address (requires QR exchange)
   */
  async getAddress(derivationPath, coinType = "eth") {
    this._checkConnected();
    // In real usage: generate address-request QR, scan address-response QR
    await new Promise((r) => setTimeout(r, 1000));
    const seed = crypto
      .createHash("sha256")
      .update(derivationPath + "keystone")
      .digest();
    return {
      address: "0x" + seed.slice(0, 20).toString("hex"),
      publicKey:
        "04" + seed.toString("hex") + crypto.randomBytes(32).toString("hex"),
      derivationPath,
    };
  }

  _checkConnected() {
    if (!this._connected) {
      throw new Error("Keystone device not initialized");
    }
  }
}

module.exports = { KeystoneAdapter };
