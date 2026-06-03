/**
 * @module blockchain/agent-economy
 * Phase 85: Agent Token Economy - micropayments, resource market, contribution proof, NFT
 */
const EventEmitter = require("events");
const { logger } = require("../utils/logger.js");

class AgentEconomy extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._balances = new Map();
    this._channels = new Map();
    this._market = new Map();
    this._contributions = new Map();
    this._nfts = new Map();
    this._priceList = new Map();
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadState();
    this.initialized = true;
    logger.info("[AgentEconomy] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS economy_balances (
          agent_id TEXT PRIMARY KEY,
          balance REAL DEFAULT 0,
          locked REAL DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS economy_transactions (
          id TEXT PRIMARY KEY,
          from_agent TEXT,
          to_agent TEXT,
          amount REAL NOT NULL,
          type TEXT DEFAULT 'payment',
          description TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS economy_channels (
          id TEXT PRIMARY KEY,
          party_a TEXT NOT NULL,
          party_b TEXT NOT NULL,
          balance_a REAL DEFAULT 0,
          balance_b REAL DEFAULT 0,
          status TEXT DEFAULT 'open',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS economy_market (
          id TEXT PRIMARY KEY,
          resource_type TEXT NOT NULL,
          provider TEXT NOT NULL,
          price REAL NOT NULL,
          available REAL DEFAULT 0,
          unit TEXT DEFAULT 'unit',
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS economy_nfts (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          type TEXT NOT NULL,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS economy_contributions (
          id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          type TEXT NOT NULL,
          value REAL DEFAULT 0,
          proof TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[AgentEconomy] Table creation warning:", error.message);
    }
  }

  async _loadState() {
    try {
      const balances = this.db.prepare("SELECT * FROM economy_balances").all();
      for (const b of balances) {
        this._balances.set(b.agent_id, {
          balance: b.balance,
          locked: b.locked,
        });
      }
      const channels = this.db
        .prepare("SELECT * FROM economy_channels WHERE status = 'open'")
        .all();
      for (const c of channels) {
        this._channels.set(c.id, c);
      }
      const market = this.db
        .prepare("SELECT * FROM economy_market WHERE status = 'active'")
        .all();
      for (const m of market) {
        this._market.set(m.id, m);
      }
    } catch (error) {
      logger.warn("[AgentEconomy] Failed to load state:", error.message);
    }
  }

  // Service Pricing
  priceService(serviceId, price, metadata = {}) {
    this._priceList.set(serviceId, {
      price,
      metadata,
      updatedAt: Date.now(),
    });
    this.emit("economy:price-set", { serviceId, price });
    return { serviceId, price };
  }

  getServicePrice(serviceId) {
    return this._priceList.get(serviceId) || null;
  }

  // Micropayments
  async pay(fromAgent, toAgent, amount, description = "") {
    const fromBalance = this._balances.get(fromAgent) || {
      balance: 0,
      locked: 0,
    };
    if (fromBalance.balance < amount) {
      throw new Error(
        `Insufficient balance: ${fromBalance.balance} < ${amount}`,
      );
    }
    fromBalance.balance -= amount;
    this._balances.set(fromAgent, fromBalance);

    const toBalance = this._balances.get(toAgent) || {
      balance: 0,
      locked: 0,
    };
    toBalance.balance += amount;
    this._balances.set(toAgent, toBalance);

    const txId = `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._persistTransaction(
      txId,
      fromAgent,
      toAgent,
      amount,
      "payment",
      description,
    );
    this._persistBalance(fromAgent, fromBalance);
    this._persistBalance(toAgent, toBalance);

    this.emit("economy:payment", {
      txId,
      from: fromAgent,
      to: toAgent,
      amount,
    });
    return {
      txId,
      from: fromAgent,
      to: toAgent,
      amount,
      balance: fromBalance.balance,
    };
  }

  getBalance(agentId) {
    return this._balances.get(agentId) || { balance: 0, locked: 0 };
  }

  // State Channel
  openChannel(partyA, partyB, depositA = 0) {
    const id = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = {
      id,
      party_a: partyA,
      party_b: partyB,
      balance_a: depositA,
      balance_b: 0,
      status: "open",
    };
    this._channels.set(id, channel);
    try {
      this.db
        .prepare(
          "INSERT INTO economy_channels (id, party_a, party_b, balance_a, balance_b, status) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, partyA, partyB, depositA, 0, "open");
    } catch (error) {
      logger.error("[AgentEconomy] Channel persist failed:", error.message);
    }
    this.emit("economy:channel-opened", { id, partyA, partyB });
    return channel;
  }

  closeChannel(channelId) {
    const channel = this._channels.get(channelId);
    if (!channel) {
      return null;
    }
    channel.status = "closed";
    this._channels.delete(channelId);
    // Settle balances
    const balA = this._balances.get(channel.party_a) || {
      balance: 0,
      locked: 0,
    };
    balA.balance += channel.balance_a;
    this._balances.set(channel.party_a, balA);
    const balB = this._balances.get(channel.party_b) || {
      balance: 0,
      locked: 0,
    };
    balB.balance += channel.balance_b;
    this._balances.set(channel.party_b, balB);
    try {
      this.db
        .prepare("UPDATE economy_channels SET status = 'closed' WHERE id = ?")
        .run(channelId);
    } catch (error) {
      logger.error(
        "[AgentEconomy] Channel close persist failed:",
        error.message,
      );
    }
    this.emit("economy:channel-closed", { id: channelId });
    return {
      settled: true,
      balanceA: channel.balance_a,
      balanceB: channel.balance_b,
    };
  }

  // Resource Market
  listResource(resourceType, provider, price, available, unit = "unit") {
    const id = `res-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const listing = {
      id,
      resource_type: resourceType,
      provider,
      price,
      available,
      unit,
      status: "active",
    };
    this._market.set(id, listing);
    try {
      this.db
        .prepare(
          "INSERT INTO economy_market (id, resource_type, provider, price, available, unit) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, resourceType, provider, price, available, unit);
    } catch (error) {
      logger.error("[AgentEconomy] Market listing failed:", error.message);
    }
    return listing;
  }

  getMarketListings(filter = {}) {
    let listings = Array.from(this._market.values());
    if (filter.type) {
      listings = listings.filter((l) => l.resource_type === filter.type);
    }
    if (filter.provider) {
      listings = listings.filter((l) => l.provider === filter.provider);
    }
    return listings;
  }

  tradeResource(listingId, buyer, quantity) {
    const listing = this._market.get(listingId);
    if (!listing) {
      throw new Error("Listing not found");
    }
    if (listing.available < quantity) {
      throw new Error("Insufficient availability");
    }

    const cost = listing.price * quantity;
    listing.available -= quantity;

    this.emit("economy:trade", { listingId, buyer, quantity, cost });
    return { cost, remaining: listing.available };
  }

  // NFT
  mintNFT(owner, type, metadata = {}) {
    const id = `nft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nft = {
      id,
      owner,
      type,
      metadata,
      created_at: new Date().toISOString(),
    };
    this._nfts.set(id, nft);
    try {
      this.db
        .prepare(
          "INSERT INTO economy_nfts (id, owner, type, metadata) VALUES (?, ?, ?, ?)",
        )
        .run(id, owner, type, JSON.stringify(metadata));
    } catch (error) {
      logger.error("[AgentEconomy] NFT mint failed:", error.message);
    }
    this.emit("economy:nft-minted", { id, owner, type });
    return nft;
  }

  // Contributions
  recordContribution(agentId, type, value, proof = null) {
    const id = `contrib-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contribution = { id, agent_id: agentId, type, value, proof };
    const existing = this._contributions.get(agentId) || [];
    existing.push(contribution);
    this._contributions.set(agentId, existing);
    try {
      this.db
        .prepare(
          "INSERT INTO economy_contributions (id, agent_id, type, value, proof) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, agentId, type, value, proof);
    } catch (error) {
      logger.error("[AgentEconomy] Contribution record failed:", error.message);
    }
    return contribution;
  }

  getContributions(agentId) {
    return this._contributions.get(agentId) || [];
  }

  distributeRevenue(pool, agentIds) {
    if (agentIds.length === 0) {
      return [];
    }
    const share = pool / agentIds.length;
    const results = [];
    for (const agentId of agentIds) {
      const bal = this._balances.get(agentId) || { balance: 0, locked: 0 };
      bal.balance += share;
      this._balances.set(agentId, bal);
      this._persistBalance(agentId, bal);
      results.push({ agentId, share, newBalance: bal.balance });
    }
    this.emit("economy:revenue-distributed", {
      pool,
      recipients: agentIds.length,
    });
    return results;
  }

  _persistTransaction(id, from, to, amount, type, description) {
    try {
      this.db
        .prepare(
          "INSERT INTO economy_transactions (id, from_agent, to_agent, amount, type, description) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, from, to, amount, type, description);
    } catch (error) {
      logger.error("[AgentEconomy] Transaction persist failed:", error.message);
    }
  }

  _persistBalance(agentId, balance) {
    try {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at) VALUES (?, ?, ?, datetime('now'))",
        )
        .run(agentId, balance.balance, balance.locked);
    } catch (error) {
      logger.error("[AgentEconomy] Balance persist failed:", error.message);
    }
  }
}

let instance = null;
function getAgentEconomy() {
  if (!instance) {
    instance = new AgentEconomy();
  }
  return instance;
}

module.exports = { AgentEconomy, getAgentEconomy };
