"use strict";

/**
 * Transaction simulator — dry-run estimation and asset change preview
 */

const MOCK_TOKEN_PRICES = {
  ETH: 2400,
  WETH: 2400,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  BTC: 65000,
  WBTC: 65000,
  MATIC: 0.8,
  BNB: 400,
  AVAX: 30,
};

class TxSimulator {
  constructor() {
    this._rpcEndpoints = {
      ethereum: "https://eth.llamarpc.com",
      polygon: "https://polygon.llamarpc.com",
      bsc: "https://bsc.llamarpc.com",
    };
  }

  /**
   * Simulate transaction execution
   * @param {object} txParams - { to, from, value, data, methodName, params, chain }
   * @param {string} chain
   * @returns {Promise<{ success: boolean, gasUsed: number, assetChanges: object[], stateChanges: object[], revertReason: string|null }>}
   */
  async simulate(txParams, chain = "ethereum") {
    console.log(
      `[TxSimulator] Simulating ${txParams.methodName || "tx"} on ${chain}`,
    );

    // Simulate network latency
    await new Promise((r) => setTimeout(r, 300));

    const assetChanges = this.simulateAssetChanges(txParams);
    const gasUsed = await this.estimateGas(txParams, chain);

    return {
      success: true,
      gasUsed,
      assetChanges,
      stateChanges: [
        {
          type: "nonce",
          address: txParams.from,
          from: txParams.nonce || 0,
          to: (txParams.nonce || 0) + 1,
        },
      ],
      revertReason: null,
    };
  }

  /**
   * Estimate gas for a transaction
   * @param {object} txParams
   * @param {string} chain
   * @returns {Promise<number>}
   */
  async estimateGas(txParams, chain = "ethereum") {
    const method = txParams.methodName || "";
    const gasEstimates = {
      transfer: 21000,
      approve: 46000,
      swapExactTokensForTokens: 142000,
      swapExactETHForTokens: 120000,
      addLiquidity: 180000,
      deposit: 65000,
      withdraw: 65000,
      mint: 85000,
    };
    const base = gasEstimates[method] || 50000;
    // Add ±15% randomness for realism
    return Math.floor(base * (0.85 + Math.random() * 0.3));
  }

  /**
   * Simulate asset changes for a transaction
   * @param {object} txParams
   * @returns {Array<{ token: string, symbol: string, delta: number, decimals: number, usdValue: number }>}
   */
  simulateAssetChanges(txParams) {
    const method = txParams.methodName || "";

    if (method === "transfer" || method === "transferFrom") {
      const amount = txParams.params?.[1]
        ? Number(txParams.params[1]) / 1e6
        : 100;
      return [
        {
          token: "USDC",
          symbol: "USDC",
          delta: -amount,
          decimals: 6,
          usdValue: -amount,
        },
      ];
    }

    if (method.includes("swap") || method.includes("Swap")) {
      const tokenIn = {
        token: "USDC",
        symbol: "USDC",
        delta: -1000,
        decimals: 6,
        usdValue: -1000,
      };
      const tokenOut = {
        token: "ETH",
        symbol: "ETH",
        delta: +(1000 / MOCK_TOKEN_PRICES.ETH).toFixed(6),
        decimals: 18,
        usdValue: 1000,
      };
      return [tokenIn, tokenOut];
    }

    if (method === "approve") {
      return []; // approve doesn't change token balance
    }

    if (parseFloat(txParams.value) > 0) {
      const eth = parseFloat(txParams.value);
      return [
        {
          token: "ETH",
          symbol: "ETH",
          delta: -eth,
          decimals: 18,
          usdValue: -(eth * MOCK_TOKEN_PRICES.ETH),
        },
      ];
    }

    return [];
  }
}

module.exports = { TxSimulator };
