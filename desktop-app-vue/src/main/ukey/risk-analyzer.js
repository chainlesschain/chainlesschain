"use strict";

/**
 * Transaction risk analysis engine
 * Scores transactions and generates security warnings
 */

const RISK_LEVEL = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

// Known blacklisted addresses (demo)
const BLACKLIST = new Set(["0x0000000000000000000000000000000000000000"]);

// Per-chain whitelists: address → { name, addedAt }
const whitelists = {};

class RiskAnalyzer {
  /**
   * Analyze a transaction and return risk assessment
   * @param {object} txInfo - parsed tx info from tx-parser
   * @param {object} [simulationResult] - from tx-simulator
   * @returns {{ level: string, score: number, warnings: object[], reasons: string[], requireBiometric: boolean }}
   */
  analyze(txInfo, simulationResult) {
    let score = 0;
    const warnings = [];
    const reasons = [];

    // 1. Unknown contract check
    if (txInfo.to && !this.isWhitelisted(txInfo.to, txInfo.chain)) {
      score += 10;
      reasons.push("Contract not in whitelist");
    }

    // 2. Blacklist check
    if (txInfo.to && this.isBlacklisted(txInfo.to)) {
      score += 50;
      warnings.push({
        severity: "error",
        message: "⛔ Contract address is blacklisted (known scam/exploit)",
      });
      reasons.push("Blacklisted address");
    }

    // 3. Large value transfer
    const ethValue = parseFloat(txInfo.value || "0");
    if (ethValue > 1) {
      score += 20;
      warnings.push({
        severity: "warning",
        message: `Large ETH transfer: ${ethValue} ETH`,
      });
      reasons.push("Large value transfer");
    } else if (ethValue > 0.1) {
      score += 10;
    }

    // 4. Unlimited approval detection
    const MAX_UINT =
      "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    if (
      txInfo.methodName === "approve" &&
      txInfo.params?.some((p) => p === MAX_UINT || p > 1e30)
    ) {
      score += 25;
      warnings.push({
        severity: "warning",
        message: "⚠️ Unlimited token approval — use exact amounts instead",
      });
      reasons.push("Unlimited approval (MAX_UINT256)");
    }

    // 5. Unknown method
    if (txInfo.methodId && txInfo.methodName?.startsWith("unknown_")) {
      score += 15;
      warnings.push({
        severity: "warning",
        message: `Unknown contract method: 0x${txInfo.methodId}`,
      });
      reasons.push("Unknown method selector");
    }

    // 6. Simulation failure
    if (simulationResult && !simulationResult.success) {
      score += 30;
      warnings.push({
        severity: "error",
        message: `Simulation failed: ${simulationResult.revertReason || "transaction would revert"}`,
      });
      reasons.push("Simulation revert");
    }

    // 7. High gas price (possible front-running)
    if (txInfo.gasPrice && parseFloat(txInfo.gasPrice) > 100e9) {
      score += 10;
      warnings.push({
        severity: "info",
        message: "High gas price detected — possible network congestion",
      });
    }

    // 8. Asset change slippage
    if (simulationResult?.assetChanges?.length > 0) {
      const totalOut = simulationResult.assetChanges
        .filter((a) => a.delta < 0)
        .reduce((sum, a) => sum + Math.abs(a.usdValue || 0), 0);
      if (totalOut > 500) {
        score += 5;
        warnings.push({
          severity: "info",
          message: `Large outgoing value: ~$${totalOut.toFixed(0)} USD`,
        });
      }
    }

    // Clamp score
    score = Math.min(100, Math.max(0, score));

    const level =
      score <= 30
        ? RISK_LEVEL.LOW
        : score <= 60
          ? RISK_LEVEL.MEDIUM
          : score <= 85
            ? RISK_LEVEL.HIGH
            : RISK_LEVEL.CRITICAL;

    const requireBiometric = score >= 60;

    return { level, score, warnings, reasons, requireBiometric };
  }

  /**
   * Check if an address is blacklisted
   * @param {string} address
   * @returns {boolean}
   */
  isBlacklisted(address) {
    return BLACKLIST.has(address?.toLowerCase());
  }

  /**
   * Add address to chain whitelist
   * @param {string} address
   * @param {string} chain
   * @param {string} [name]
   */
  addToWhitelist(address, chain = "ethereum", name = "") {
    if (!whitelists[chain]) {
      whitelists[chain] = {};
    }
    whitelists[chain][address?.toLowerCase()] = {
      name,
      addedAt: new Date().toISOString(),
    };
    console.log(`[RiskAnalyzer] Whitelisted ${address} on ${chain}`);
  }

  /**
   * Check if an address is whitelisted
   * @param {string} address
   * @param {string} chain
   * @returns {boolean}
   */
  isWhitelisted(address, chain = "ethereum") {
    return !!whitelists[chain]?.[address?.toLowerCase()];
  }

  /**
   * Get full whitelist for a chain
   * @param {string} chain
   * @returns {object}
   */
  getWhitelist(chain = "ethereum") {
    return whitelists[chain] || {};
  }
}

module.exports = { RiskAnalyzer, RISK_LEVEL };
