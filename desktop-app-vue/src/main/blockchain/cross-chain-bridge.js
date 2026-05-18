/**
 * @module blockchain/cross-chain-bridge
 * Phase 89: Cross-chain interoperability - EVM bridge, Solana adapter, atomic swap, messaging
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class CrossChainBridge extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._chains = new Map();
    this._bridges = new Map();
    this._pendingTransfers = new Map();
    this._balances = new Map();
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    this._registerDefaultChains();
    this.initialized = true;
    logger.info("[CrossChainBridge] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS crosschain_transfers (
          id TEXT PRIMARY KEY, from_chain TEXT, to_chain TEXT, asset TEXT, amount REAL,
          status TEXT DEFAULT 'pending', tx_hash TEXT, created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS crosschain_swaps (
          id TEXT PRIMARY KEY, party_a TEXT, party_b TEXT, asset_a TEXT, asset_b TEXT,
          amount_a REAL, amount_b REAL, hash_lock TEXT, time_lock INTEGER,
          status TEXT DEFAULT 'initiated', created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS crosschain_messages (
          id TEXT PRIMARY KEY, from_chain TEXT, to_chain TEXT, payload TEXT,
          status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[CrossChainBridge] Table creation warning:", error.message);
    }
  }

  _registerDefaultChains() {
    const chains = [
      {
        id: "ethereum",
        name: "Ethereum",
        type: "evm",
        chainId: 1,
        rpc: "https://eth.llamarpc.com",
      },
      {
        id: "polygon",
        name: "Polygon",
        type: "evm",
        chainId: 137,
        rpc: "https://polygon-rpc.com",
      },
      {
        id: "bsc",
        name: "BNB Smart Chain",
        type: "evm",
        chainId: 56,
        rpc: "https://bsc-dataseed.binance.org",
      },
      {
        id: "arbitrum",
        name: "Arbitrum",
        type: "evm",
        chainId: 42161,
        rpc: "https://arb1.arbitrum.io/rpc",
      },
      {
        id: "solana",
        name: "Solana",
        type: "svm",
        rpc: "https://api.mainnet-beta.solana.com",
      },
    ];
    for (const chain of chains) {
      this._chains.set(chain.id, chain);
    }
  }

  // Bridge Asset
  async bridgeAsset(fromChain, toChain, asset, amount, options = {}) {
    if (!this._chains.has(fromChain)) {
      throw new Error(`Unknown chain: ${fromChain}`);
    }
    if (!this._chains.has(toChain)) {
      throw new Error(`Unknown chain: ${toChain}`);
    }
    const id = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const transfer = {
      id,
      fromChain,
      toChain,
      asset,
      amount,
      status: "pending",
      fee: amount * 0.001,
      estimatedTime: 300,
    };
    this._pendingTransfers.set(id, transfer);
    try {
      this.db
        .prepare(
          "INSERT INTO crosschain_transfers (id, from_chain, to_chain, asset, amount, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, fromChain, toChain, asset, amount, "pending");
    } catch (error) {
      logger.error(
        "[CrossChainBridge] Transfer persist failed:",
        error.message,
      );
    }
    this.emit("bridge:transfer-initiated", { id, fromChain, toChain, amount });
    return transfer;
  }

  // Atomic Swap (HTLC)
  async atomicSwap(partyA, partyB, assetA, assetB, amountA, amountB) {
    const id = `swap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const hashLock = `hash-${Math.random().toString(36).slice(2, 18)}`;
    const swap = {
      id,
      partyA,
      partyB,
      assetA,
      assetB,
      amountA,
      amountB,
      hashLock,
      timeLock: Date.now() + 3600000,
      status: "initiated",
    };
    try {
      this.db
        .prepare(
          "INSERT INTO crosschain_swaps (id, party_a, party_b, asset_a, asset_b, amount_a, amount_b, hash_lock, time_lock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          partyA,
          partyB,
          assetA,
          assetB,
          amountA,
          amountB,
          hashLock,
          swap.timeLock,
        );
    } catch (error) {
      logger.error("[CrossChainBridge] Swap persist failed:", error.message);
    }
    this.emit("bridge:swap-initiated", { id });
    return swap;
  }

  // Cross-chain messaging
  async sendMessage(fromChain, toChain, payload) {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg = {
      id,
      fromChain,
      toChain,
      payload,
      status: "pending",
      sentAt: Date.now(),
    };
    try {
      this.db
        .prepare(
          "INSERT INTO crosschain_messages (id, from_chain, to_chain, payload) VALUES (?, ?, ?, ?)",
        )
        .run(id, fromChain, toChain, JSON.stringify(payload));
    } catch (error) {
      logger.error("[CrossChainBridge] Message persist failed:", error.message);
    }
    this.emit("bridge:message-sent", { id, fromChain, toChain });
    return msg;
  }

  getBalances(address) {
    const balances = {};
    for (const [chainId] of this._chains) {
      balances[chainId] = this._balances.get(`${address}:${chainId}`) || {
        native: 0,
        tokens: {},
      };
    }
    return balances;
  }

  listChains() {
    return Array.from(this._chains.values());
  }

  estimateFee(fromChain, toChain, amount) {
    const baseFee = amount * 0.001;
    const fromType = this._chains.get(fromChain)?.type;
    const toType = this._chains.get(toChain)?.type;
    const crossTypeFee = fromType !== toType ? baseFee * 2 : baseFee;
    return {
      fee: crossTypeFee,
      currency: "USD",
      estimatedTime: fromType !== toType ? 600 : 300,
    };
  }

  getTransferStatus(transferId) {
    return this._pendingTransfers.get(transferId) || null;
  }

  configureChain(chainId, config) {
    const chain = this._chains.get(chainId);
    if (!chain) {
      return null;
    }
    Object.assign(chain, config);
    return chain;
  }
}

let instance = null;
function getCrossChainBridge() {
  if (!instance) {
    instance = new CrossChainBridge();
  }
  return instance;
}
module.exports = { CrossChainBridge, getCrossChainBridge };
