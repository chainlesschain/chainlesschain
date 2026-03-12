/**
 * Agent Economy — Token-based agent economy with payments, state channels,
 * marketplace, NFTs, contributions, and revenue distribution.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _balances = new Map();
const _channels = new Map();
const _market = new Map();
const _nfts = new Map();
const _contributions = new Map();
const _priceList = new Map();

/* ── Schema ────────────────────────────────────────────────── */

export function ensureEconomyTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_balances (
      agent_id TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      locked REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_transactions (
      id TEXT PRIMARY KEY,
      from_agent TEXT,
      to_agent TEXT,
      amount REAL NOT NULL,
      type TEXT DEFAULT 'transfer',
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_channels (
      id TEXT PRIMARY KEY,
      party_a TEXT NOT NULL,
      party_b TEXT NOT NULL,
      balance_a REAL DEFAULT 0,
      balance_b REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_market (
      id TEXT PRIMARY KEY,
      resource_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      price REAL NOT NULL,
      available REAL DEFAULT 0,
      unit TEXT DEFAULT 'unit',
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_nfts (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      type TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_contributions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value REAL DEFAULT 0,
      proof TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Pricing ───────────────────────────────────────────────── */

export function priceService(db, serviceId, price, metadata) {
  _priceList.set(serviceId, {
    serviceId,
    price,
    metadata,
    updatedAt: new Date().toISOString(),
  });
  return _priceList.get(serviceId);
}

export function getServicePrice(serviceId) {
  return _priceList.get(serviceId) || null;
}

/* ── Payments ──────────────────────────────────────────────── */

function _getBalance(agentId) {
  if (!_balances.has(agentId)) {
    _balances.set(agentId, { balance: 0, locked: 0 });
  }
  return _balances.get(agentId);
}

export function getBalance(agentId) {
  return { ..._getBalance(agentId) };
}

export function pay(db, fromAgent, toAgent, amount, description) {
  if (amount <= 0) throw new Error("Amount must be positive");

  const fromBal = _getBalance(fromAgent);
  if (fromBal.balance < amount) {
    throw new Error(`Insufficient balance: ${fromBal.balance} < ${amount}`);
  }

  fromBal.balance -= amount;
  const toBal = _getBalance(toAgent);
  toBal.balance += amount;

  const txId = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO economy_transactions (id, from_agent, to_agent, amount, type, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(txId, fromAgent, toAgent, amount, "transfer", description || "", now);

  db.prepare(
    `INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(fromAgent, fromBal.balance, fromBal.locked, now);

  db.prepare(
    `INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at)
     VALUES (?, ?, ?, ?)`,
  ).run(toAgent, toBal.balance, toBal.locked, now);

  return {
    txId,
    from: fromAgent,
    to: toAgent,
    amount,
    balance: fromBal.balance,
  };
}

/* ── State Channels ────────────────────────────────────────── */

export function openChannel(db, partyA, partyB, depositA) {
  const deposit = depositA || 0;
  const balA = _getBalance(partyA);
  if (deposit > 0 && balA.balance < deposit) {
    throw new Error(
      `Insufficient balance for deposit: ${balA.balance} < ${deposit}`,
    );
  }

  if (deposit > 0) {
    balA.balance -= deposit;
    balA.locked += deposit;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const channel = {
    id,
    partyA,
    partyB,
    balanceA: deposit,
    balanceB: 0,
    status: "open",
    createdAt: now,
  };
  _channels.set(id, channel);

  db.prepare(
    `INSERT INTO economy_channels (id, party_a, party_b, balance_a, balance_b, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, partyA, partyB, deposit, 0, "open", now);

  return channel;
}

export function closeChannel(db, channelId) {
  const channel = _channels.get(channelId);
  if (!channel) throw new Error(`Channel not found: ${channelId}`);
  if (channel.status === "closed") throw new Error("Channel already closed");

  channel.status = "closed";

  // Settle: return balances to parties
  const balA = _getBalance(channel.partyA);
  const balB = _getBalance(channel.partyB);
  balA.balance += channel.balanceA;
  balA.locked = Math.max(0, balA.locked - channel.balanceA);
  balB.balance += channel.balanceB;

  db.prepare(`UPDATE economy_channels SET status = 'closed' WHERE id = ?`).run(
    channelId,
  );

  return { ...channel };
}

/* ── Marketplace ───────────────────────────────────────────── */

export function listResource(
  db,
  resourceType,
  provider,
  price,
  available,
  unit,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const listing = {
    id,
    resourceType,
    provider,
    price,
    available,
    unit: unit || "unit",
    status: "active",
    createdAt: now,
  };
  _market.set(id, listing);

  db.prepare(
    `INSERT INTO economy_market (id, resource_type, provider, price, available, unit, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    resourceType,
    provider,
    price,
    available,
    listing.unit,
    "active",
    now,
  );

  return listing;
}

export function getMarketListings(filter) {
  let listings = [..._market.values()].filter((l) => l.status === "active");
  if (filter) {
    if (filter.type)
      listings = listings.filter((l) => l.resourceType === filter.type);
    if (filter.provider)
      listings = listings.filter((l) => l.provider === filter.provider);
  }
  return listings;
}

export function tradeResource(listingId, buyer, quantity) {
  const listing = _market.get(listingId);
  if (!listing) throw new Error(`Listing not found: ${listingId}`);
  if (listing.available < quantity) {
    throw new Error(
      `Insufficient availability: ${listing.available} < ${quantity}`,
    );
  }

  const cost = listing.price * quantity;
  const buyerBal = _getBalance(buyer);
  if (buyerBal.balance < cost) {
    throw new Error(`Insufficient balance: ${buyerBal.balance} < ${cost}`);
  }

  buyerBal.balance -= cost;
  const sellerBal = _getBalance(listing.provider);
  sellerBal.balance += cost;
  listing.available -= quantity;

  if (listing.available <= 0) listing.status = "sold_out";

  return { listingId, buyer, quantity, cost, remaining: listing.available };
}

/* ── NFTs ──────────────────────────────────────────────────── */

export function mintNFT(db, owner, type, metadata) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const nft = { id, owner, type, metadata: metadata || {}, createdAt: now };
  _nfts.set(id, nft);

  db.prepare(
    `INSERT INTO economy_nfts (id, owner, type, metadata, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, owner, type, JSON.stringify(nft.metadata), now);

  return nft;
}

/* ── Contributions ─────────────────────────────────────────── */

export function recordContribution(db, agentId, type, value, proof) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const contribution = {
    id,
    agentId,
    type,
    value,
    proof: proof || "",
    createdAt: now,
  };

  if (!_contributions.has(agentId)) _contributions.set(agentId, []);
  _contributions.get(agentId).push(contribution);

  db.prepare(
    `INSERT INTO economy_contributions (id, agent_id, type, value, proof, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, agentId, type, value, contribution.proof, now);

  return contribution;
}

export function getContributions(agentId) {
  return _contributions.get(agentId) || [];
}

/* ── Revenue Distribution ──────────────────────────────────── */

export function distributeRevenue(db, pool, agentIds) {
  if (!agentIds || agentIds.length === 0)
    throw new Error("No agents specified");
  if (pool <= 0) throw new Error("Pool must be positive");

  const share = pool / agentIds.length;
  const results = [];

  for (const agentId of agentIds) {
    const bal = _getBalance(agentId);
    bal.balance += share;

    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(agentId, bal.balance, bal.locked, now);

    results.push({ agentId, share, newBalance: bal.balance });
  }

  return results;
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _balances.clear();
  _channels.clear();
  _market.clear();
  _nfts.clear();
  _contributions.clear();
  _priceList.clear();
}

export function _setBalance(agentId, balance, locked) {
  _balances.set(agentId, { balance, locked: locked || 0 });
}
