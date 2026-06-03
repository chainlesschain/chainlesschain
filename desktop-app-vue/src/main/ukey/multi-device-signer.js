"use strict";

/**
 * Multi-device signing orchestrator
 * Coordinates signing between U盾 and hardware wallets based on risk level
 */

const EventEmitter = require("events");
const crypto = require("crypto");

const SIGN_POLICY = {
  low: { requireUKey: true, requireHWWallet: false, requireBiometric: false },
  medium: {
    requireUKey: true,
    requireHWWallet: false,
    requireBiometric: false,
    hwWalletOptional: true,
  },
  high: { requireUKey: true, requireHWWallet: true, requireBiometric: false },
  critical: {
    requireUKey: true,
    requireHWWallet: true,
    requireBiometric: true,
  },
};

class MultiDeviceSigner extends EventEmitter {
  constructor(ukeyManager, hwWalletBridge) {
    super();
    this._ukey = ukeyManager;
    this._hwWallet = hwWalletBridge;
  }

  /**
   * Get signing policy for a risk level
   * @param {'low'|'medium'|'high'|'critical'} riskLevel
   * @returns {{ requireUKey: boolean, requireHWWallet: boolean, requireBiometric: boolean }}
   */
  getPolicyForRisk(riskLevel) {
    return SIGN_POLICY[riskLevel] || SIGN_POLICY.medium;
  }

  /**
   * Multi-device sign a transaction
   * @param {object} txParams
   * @param {'low'|'medium'|'high'|'critical'} riskLevel
   * @param {string} ukeyPin
   * @param {string} [hwDeviceId]
   * @returns {Promise<{ txHash: string, ukeySignature: string, hwSignature: string|null, combined: boolean }>}
   */
  async sign(txParams, riskLevel, ukeyPin, hwDeviceId) {
    const policy = this.getPolicyForRisk(riskLevel);
    console.log(
      `[MultiDeviceSigner] Signing with policy for risk=${riskLevel}: ukey=${policy.requireUKey}, hw=${policy.requireHWWallet}`,
    );

    let ukeySignature = null;
    let hwSignature = null;

    // Step 1: U盾 signing
    if (policy.requireUKey) {
      this.emit("step", { step: "ukey-signing", message: "U盾 signing..." });
      ukeySignature = await this._signWithUKey(txParams, ukeyPin);
      this.emit("step", { step: "ukey-done", ukeySignature });
    }

    // Step 2: Hardware wallet signing (if required or optional and device provided)
    const shouldUseHW =
      policy.requireHWWallet || (policy.hwWalletOptional && hwDeviceId);
    if (shouldUseHW && hwDeviceId) {
      this.emit("step", {
        step: "hw-signing",
        message: "Hardware wallet signing — please confirm on device",
      });
      hwSignature = await this._signWithHWWallet(txParams, hwDeviceId);
      this.emit("step", { step: "hw-done", hwSignature });
    } else if (policy.requireHWWallet && !hwDeviceId) {
      throw new Error(
        `Risk level "${riskLevel}" requires hardware wallet but no device connected`,
      );
    }

    // Step 3: Combine signatures
    const txHash = await this._combinedBroadcast(
      txParams,
      ukeySignature,
      hwSignature,
    );
    const combined = !!(ukeySignature && hwSignature);

    this.emit("signed", { txHash, combined, riskLevel });
    console.log(
      `[MultiDeviceSigner] Signed tx: ${txHash} (combined: ${combined})`,
    );
    return { txHash, ukeySignature, hwSignature, combined };
  }

  /**
   * Verify dual signatures on a transaction
   * @param {string} txHash
   * @param {string} ukeySignature
   * @param {string} hwSignature
   * @returns {Promise<boolean>}
   */
  async verifyDualSignature(txHash, ukeySignature, hwSignature) {
    // In real implementation: recover addresses from both signatures, verify they match expected keys
    console.log(`[MultiDeviceSigner] Verifying dual signature for ${txHash}`);
    await new Promise((r) => setTimeout(r, 200));
    // Simulation: both signatures must be non-empty
    return !!(ukeySignature && hwSignature);
  }

  async _signWithUKey(txParams, pin) {
    // Simulate U盾 signing
    if (this._ukey) {
      try {
        const txData = Buffer.from(JSON.stringify(txParams));
        return await this._ukey.sign(txData, pin);
      } catch (e) {
        console.warn("[MultiDeviceSigner] UKey unavailable, using simulation");
      }
    }
    await new Promise((r) => setTimeout(r, 800));
    return "0x" + crypto.randomBytes(65).toString("hex");
  }

  async _signWithHWWallet(txParams, deviceId) {
    if (this._hwWallet) {
      try {
        const derivationPath = txParams.derivationPath || "m/44'/60'/0'/0/0";
        const result = await this._hwWallet.signTx(
          deviceId,
          derivationPath,
          txParams,
        );
        return result.signature || result;
      } catch (e) {
        console.warn("[MultiDeviceSigner] HW wallet sign failed:", e.message);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
    return "0x" + crypto.randomBytes(65).toString("hex");
  }

  async _combinedBroadcast(txParams, ukeySignature, hwSignature) {
    // In real multi-sig: aggregate signatures into final tx and broadcast
    await new Promise((r) => setTimeout(r, 300));
    return "0x" + crypto.randomBytes(32).toString("hex");
  }
}

module.exports = { MultiDeviceSigner, SIGN_POLICY };
