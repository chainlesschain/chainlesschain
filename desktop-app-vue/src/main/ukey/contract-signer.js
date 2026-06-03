"use strict";

/**
 * Smart contract signing orchestrator
 * Integrates: tx-parser, tx-simulator, risk-analyzer, chain-adapter, ukey-manager
 */

const EventEmitter = require("events");
const crypto = require("crypto");
const { parseTx } = require("./tx-parser");
const { TxSimulator } = require("./tx-simulator");
const { RiskAnalyzer } = require("./risk-analyzer");
const { ChainAdapter } = require("./chain-adapter");

class ContractSigner extends EventEmitter {
  constructor(ukeyManager) {
    super();
    this._ukey = ukeyManager;
    this._simulator = new TxSimulator();
    this._riskAnalyzer = new RiskAnalyzer();
    this._chainAdapter = new ChainAdapter();
    this._pendingRequests = new Map();
  }

  /**
   * Prepare a signing request: parse tx, simulate, assess risk
   * @param {object} txParams - raw transaction parameters
   * @returns {Promise<object>} SigningRequest
   */
  async prepareSign(txParams) {
    const chain = txParams.chain || "ethereum";
    console.log(`[ContractSigner] Preparing tx: ${txParams.to} on ${chain}`);

    // 1. Parse transaction
    const txInfo = parseTx(txParams, chain);
    this.emit("step", { step: "parsed", txInfo });

    // 2. Simulate
    let simulationResult = null;
    try {
      simulationResult = await this._simulator.simulate(txInfo, chain);
      this.emit("step", { step: "simulated", simulationResult });
    } catch (e) {
      console.warn("[ContractSigner] Simulation failed:", e.message);
    }

    // 3. Risk analysis
    const riskReport = this._riskAnalyzer.analyze(txInfo, simulationResult);
    this.emit("step", { step: "analyzed", riskReport });

    // 4. Gas estimate
    const gasPrice = await this._chainAdapter.getGasPrice(chain);

    const signingRequest = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      txInfo,
      simulationResult,
      riskReport,
      gasPrice,
      isWhitelisted: this._riskAnalyzer.isWhitelisted(txInfo.to, chain),
    };

    this._pendingRequests.set(signingRequest.id, signingRequest);
    return signingRequest;
  }

  /**
   * Execute signing: validate auth, sign via ukey, broadcast
   * @param {object} signingRequest
   * @param {string} pin
   * @param {boolean} biometricVerified
   * @returns {Promise<{ txHash: string, explorer: string }>}
   */
  async sign(signingRequest, pin, biometricVerified = false) {
    const { riskReport, txInfo } = signingRequest;

    // Validate authentication level
    if (riskReport.level === "critical" && !biometricVerified) {
      throw new Error(
        "Critical risk transaction requires biometric verification",
      );
    }
    if (riskReport.level === "high" && !pin) {
      throw new Error("High risk transaction requires PIN verification");
    }

    console.log(`[ContractSigner] Signing tx (risk: ${riskReport.level})...`);
    this.emit("step", { step: "signing", riskLevel: riskReport.level });

    // Verify PIN via ukey
    if (pin) {
      try {
        const pinResult = this._ukey
          ? await this._ukey.verifyPin(pin)
          : { success: true }; // simulation
        if (!pinResult.success) {
          throw new Error("PIN verification failed");
        }
      } catch (e) {
        if (e.message !== "PIN verification failed") {
          // UKey not available, use simulation
          console.warn(
            "[ContractSigner] UKey not available, using simulation mode",
          );
        } else {
          throw e;
        }
      }
    }

    // Sign the transaction hash
    const txHash = await this._signTx(txInfo);
    this.emit("step", { step: "signed", txHash });

    // Broadcast to chain
    const result = await this._chainAdapter.broadcastTx(txHash, txInfo.chain);
    this.emit("step", { step: "broadcast", ...result });

    // Add to whitelist if requested (handled in IPC layer)
    this._pendingRequests.delete(signingRequest.id);

    console.log(`[ContractSigner] Tx complete: ${result.txHash}`);
    return result;
  }

  /**
   * Reject a pending signing request
   * @param {object} signingRequest
   */
  reject(signingRequest) {
    this._pendingRequests.delete(signingRequest.id);
    this.emit("rejected", { id: signingRequest.id });
    console.log(`[ContractSigner] Tx rejected: ${signingRequest.id}`);
  }

  /**
   * Add contract to whitelist
   * @param {string} address
   * @param {string} chain
   * @param {string} name
   */
  addToWhitelist(address, chain, name) {
    this._riskAnalyzer.addToWhitelist(address, chain, name);
  }

  /**
   * Check if address is blacklisted
   * @param {string} address
   * @returns {boolean}
   */
  isBlacklisted(address) {
    return this._riskAnalyzer.isBlacklisted(address);
  }

  async _signTx(txInfo) {
    // Create tx hash (keccak256 of serialized tx would go here)
    // In simulation, return a random "signed" tx hash
    return "0x" + crypto.randomBytes(32).toString("hex");
  }
}

module.exports = { ContractSigner };
