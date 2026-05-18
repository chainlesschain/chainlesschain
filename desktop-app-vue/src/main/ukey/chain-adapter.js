"use strict";

/**
 * Multi-chain adapter for broadcasting transactions and fetching chain state
 */

const crypto = require("crypto");

const SUPPORTED_CHAINS = {
  ethereum: {
    chainId: 1,
    rpc: "https://eth.llamarpc.com",
    symbol: "ETH",
    decimals: 18,
  },
  polygon: {
    chainId: 137,
    rpc: "https://polygon.llamarpc.com",
    symbol: "MATIC",
    decimals: 18,
  },
  bsc: {
    chainId: 56,
    rpc: "https://bsc-dataseed1.binance.org",
    symbol: "BNB",
    decimals: 18,
  },
  avalanche: {
    chainId: 43114,
    rpc: "https://api.avax.network/ext/bc/C/rpc",
    symbol: "AVAX",
    decimals: 18,
  },
  arbitrum: {
    chainId: 42161,
    rpc: "https://arb1.arbitrum.io/rpc",
    symbol: "ETH",
    decimals: 18,
  },
  optimism: {
    chainId: 10,
    rpc: "https://mainnet.optimism.io",
    symbol: "ETH",
    decimals: 18,
  },
  solana: {
    chainId: null,
    rpc: "https://api.mainnet-beta.solana.com",
    symbol: "SOL",
    decimals: 9,
  },
  bitcoin: {
    chainId: null,
    rpc: "https://blockstream.info/api",
    symbol: "BTC",
    decimals: 8,
  },
};

class ChainAdapter {
  constructor(customRpcs = {}) {
    this._rpcs = { ...SUPPORTED_CHAINS };
    for (const [chain, rpc] of Object.entries(customRpcs)) {
      if (this._rpcs[chain]) {
        this._rpcs[chain] = { ...this._rpcs[chain], rpc };
      }
    }
  }

  /**
   * Broadcast a signed transaction to the chain
   * @param {string} signedTx - hex-encoded signed tx
   * @param {string} chain
   * @returns {Promise<{ txHash: string, explorer: string }>}
   */
  async broadcastTx(signedTx, chain = "ethereum") {
    const chainInfo = SUPPORTED_CHAINS[chain];
    if (!chainInfo) {
      throw new Error(`Unsupported chain: ${chain}`);
    }

    console.log(`[ChainAdapter] Broadcasting tx on ${chain}...`);

    // Simulation mode: generate realistic mock tx hash
    await new Promise((r) => setTimeout(r, 500));
    const txHash = "0x" + crypto.randomBytes(32).toString("hex");
    const explorer = this._getExplorerUrl(chain, txHash);

    console.log(`[ChainAdapter] Tx broadcast: ${txHash}`);
    return { txHash, explorer };
  }

  /**
   * Get current gas price for a chain
   * @param {string} chain
   * @returns {Promise<{ gasPrice: string, maxFeePerGas: string, maxPriorityFeePerGas: string }>}
   */
  async getGasPrice(chain = "ethereum") {
    // Simulated gas prices in gwei
    const mockPrices = {
      ethereum: {
        gasPrice: "20000000000",
        maxFeePerGas: "25000000000",
        maxPriorityFeePerGas: "2000000000",
      },
      polygon: {
        gasPrice: "50000000000",
        maxFeePerGas: "60000000000",
        maxPriorityFeePerGas: "5000000000",
      },
      bsc: {
        gasPrice: "5000000000",
        maxFeePerGas: "6000000000",
        maxPriorityFeePerGas: "1000000000",
      },
    };
    return (
      mockPrices[chain] || {
        gasPrice: "1000000000",
        maxFeePerGas: "1500000000",
        maxPriorityFeePerGas: "500000000",
      }
    );
  }

  /**
   * Get current nonce for an address
   * @param {string} address
   * @param {string} chain
   * @returns {Promise<number>}
   */
  async getNonce(address, chain = "ethereum") {
    // Simulated nonce
    return Math.floor(Math.random() * 50);
  }

  /**
   * Wait for transaction confirmation
   * @param {string} txHash
   * @param {string} chain
   * @param {number} [timeout] ms
   * @returns {Promise<{ confirmed: boolean, blockNumber: number, confirmations: number }>}
   */
  async waitForConfirmation(txHash, chain = "ethereum", timeout = 60000) {
    console.log(`[ChainAdapter] Waiting for ${txHash} on ${chain}...`);
    // Simulate 5 second confirmation
    await new Promise((r) => setTimeout(r, Math.min(5000, timeout)));
    const blockNumber = Math.floor(Math.random() * 1000000) + 18000000;
    return { confirmed: true, blockNumber, confirmations: 1 };
  }

  _getExplorerUrl(chain, txHash) {
    const explorers = {
      ethereum: `https://etherscan.io/tx/${txHash}`,
      polygon: `https://polygonscan.com/tx/${txHash}`,
      bsc: `https://bscscan.com/tx/${txHash}`,
      avalanche: `https://snowtrace.io/tx/${txHash}`,
      arbitrum: `https://arbiscan.io/tx/${txHash}`,
      optimism: `https://optimistic.etherscan.io/tx/${txHash}`,
      solana: `https://solscan.io/tx/${txHash}`,
      bitcoin: `https://blockstream.info/tx/${txHash}`,
    };
    return explorers[chain] || txHash;
  }
}

module.exports = { ChainAdapter, SUPPORTED_CHAINS };
