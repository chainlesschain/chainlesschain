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

// ═════════════════════════════════════════════════════════════════
// Phase 85 — Agent Economy 2.0 additions (strictly-additive)
// Frozen canonical enums (PAYMENT_TYPE / CHANNEL_STATUS / RESOURCE_TYPE /
// NFT_STATUS) + payment-model-aware pricing + channel lifecycle (open →
// active → settling → closed, + disputed) + NFT status state machine +
// contribution-share based revenue distribution + extended stats.
// ═════════════════════════════════════════════════════════════════

export const PAYMENT_TYPE = Object.freeze({
  PER_CALL: "per_call",
  PER_TOKEN: "per_token",
  PER_MINUTE: "per_minute",
  FLAT_RATE: "flat_rate",
});

export const CHANNEL_STATUS = Object.freeze({
  OPEN: "open",
  ACTIVE: "active",
  SETTLING: "settling",
  CLOSED: "closed",
  DISPUTED: "disputed",
});

export const RESOURCE_TYPE = Object.freeze({
  COMPUTE: "compute",
  STORAGE: "storage",
  MODEL: "model",
  DATA: "data",
  SKILL: "skill",
});

export const NFT_STATUS = Object.freeze({
  MINTED: "minted",
  LISTED: "listed",
  SOLD: "sold",
  BURNED: "burned",
});

const _PAYMENT_TYPE_VALUES = new Set(Object.values(PAYMENT_TYPE));
const _CHANNEL_STATUS_VALUES = new Set(Object.values(CHANNEL_STATUS));
const _RESOURCE_TYPE_VALUES = new Set(Object.values(RESOURCE_TYPE));
const _NFT_STATUS_VALUES = new Set(Object.values(NFT_STATUS));

// V2 stores
const _v2PriceModels = new Map(); // serviceId → { paymentType, rate, metadata }
const _v2NftStatus = new Map(); // nftId → { status, listedPrice?, soldTo?, royaltyPercent }
const _v2TaskContributions = new Map(); // taskId → [{ agentId, weight }]
const _v2Distributions = []; // { id, taskId, total, shares[], distributedAt }

/**
 * Set a price model for a service keyed by PAYMENT_TYPE.
 * rate semantics:
 *   per_call   — cost per invocation
 *   per_token  — cost per token (LLM usage)
 *   per_minute — cost per minute (time-based)
 *   flat_rate  — one-shot cost (amount is ignored on pay)
 */
export function priceServiceV2(
  db,
  { serviceId, paymentType, rate, metadata } = {},
) {
  if (!serviceId) throw new Error("serviceId required");
  if (!_PAYMENT_TYPE_VALUES.has(paymentType))
    throw new Error(`Invalid paymentType: ${paymentType}`);
  if (!Number.isFinite(rate) || rate < 0)
    throw new Error(`Invalid rate: ${rate}`);
  const entry = {
    serviceId,
    paymentType,
    rate,
    metadata: metadata || {},
    updatedAt: new Date().toISOString(),
  };
  _v2PriceModels.set(serviceId, entry);
  return entry;
}

export function getPriceModel(serviceId) {
  return _v2PriceModels.get(serviceId) || null;
}

/**
 * Pay for a service using its registered price model. Computes amount based on
 * paymentType and usage (tokens / minutes / calls). Falls through to existing
 * pay() for actual balance transfer + DB write.
 */
export function payV2(
  db,
  {
    fromAgentId,
    toAgentId,
    serviceId,
    tokens,
    minutes,
    calls = 1,
    metadata,
  } = {},
) {
  if (!fromAgentId || !toAgentId)
    throw new Error("fromAgentId & toAgentId required");
  if (!serviceId) throw new Error("serviceId required");
  const model = _v2PriceModels.get(serviceId);
  if (!model) throw new Error(`No price model for service: ${serviceId}`);
  let amount;
  switch (model.paymentType) {
    case PAYMENT_TYPE.PER_CALL:
      amount = model.rate * (calls || 1);
      break;
    case PAYMENT_TYPE.PER_TOKEN:
      if (!Number.isFinite(tokens) || tokens < 0)
        throw new Error("tokens required for per_token pricing");
      amount = model.rate * tokens;
      break;
    case PAYMENT_TYPE.PER_MINUTE:
      if (!Number.isFinite(minutes) || minutes < 0)
        throw new Error("minutes required for per_minute pricing");
      amount = model.rate * minutes;
      break;
    case PAYMENT_TYPE.FLAT_RATE:
      amount = model.rate;
      break;
    default:
      throw new Error(`Unknown paymentType: ${model.paymentType}`);
  }
  if (amount <= 0) {
    // No-op transfer: still record the intent
    return {
      txId: null,
      from: fromAgentId,
      to: toAgentId,
      amount: 0,
      paymentType: model.paymentType,
      serviceId,
      skipped: true,
    };
  }
  const result = pay(
    db,
    fromAgentId,
    toAgentId,
    amount,
    JSON.stringify({
      serviceId,
      paymentType: model.paymentType,
      metadata: metadata || {},
    }),
  );
  return { ...result, paymentType: model.paymentType, serviceId };
}

/**
 * Open a two-sided state channel with both parties depositing.
 * Transitions: OPEN → (activateChannel) → ACTIVE → (initiateSettlement) →
 * SETTLING → (closeChannelV2) → CLOSED. DISPUTED can be set from ACTIVE.
 */
export function openChannelV2(
  db,
  { partyA, partyB, depositA = 0, depositB = 0 } = {},
) {
  if (!partyA || !partyB) throw new Error("partyA & partyB required");
  if (partyA === partyB) throw new Error("partyA cannot equal partyB");
  if (depositA < 0 || depositB < 0)
    throw new Error("deposits must be non-negative");
  // Use existing openChannel for partyA deposit + DB; then attach partyB deposit
  const ch = openChannel(db, partyA, partyB, depositA);
  if (depositB > 0) {
    const balB = _getBalance(partyB);
    if (balB.balance < depositB)
      throw new Error(
        `Insufficient balance for partyB: ${balB.balance} < ${depositB}`,
      );
    balB.balance -= depositB;
    balB.locked += depositB;
    const stored = _channels.get(ch.id);
    stored.balanceB = depositB;
    ch.balanceB = depositB;
    db.prepare(`UPDATE economy_channels SET balance_b = ? WHERE id = ?`).run(
      depositB,
      ch.id,
    );
  }
  // Upgrade channel.status to use canonical enum value
  const stored = _channels.get(ch.id);
  stored.status = CHANNEL_STATUS.OPEN;
  return { ...stored };
}

export function activateChannel(db, channelId) {
  const ch = _channels.get(channelId);
  if (!ch) throw new Error(`Channel not found: ${channelId}`);
  if (ch.status !== CHANNEL_STATUS.OPEN)
    throw new Error(`Cannot activate: channel is ${ch.status}, not open`);
  ch.status = CHANNEL_STATUS.ACTIVE;
  db.prepare(`UPDATE economy_channels SET status = ? WHERE id = ?`).run(
    CHANNEL_STATUS.ACTIVE,
    channelId,
  );
  return { ...ch };
}

export function initiateSettlement(
  db,
  channelId,
  { finalBalanceA, finalBalanceB } = {},
) {
  const ch = _channels.get(channelId);
  if (!ch) throw new Error(`Channel not found: ${channelId}`);
  if (ch.status !== CHANNEL_STATUS.ACTIVE)
    throw new Error(`Cannot settle: channel is ${ch.status}, not active`);
  const total = (ch.balanceA || 0) + (ch.balanceB || 0);
  const a = Number.isFinite(finalBalanceA) ? finalBalanceA : ch.balanceA;
  const b = Number.isFinite(finalBalanceB) ? finalBalanceB : ch.balanceB;
  if (a < 0 || b < 0) throw new Error("Final balances must be non-negative");
  if (Math.abs(a + b - total) > 1e-9)
    throw new Error(`Settlement must preserve total: ${a}+${b} ≠ ${total}`);
  ch.balanceA = a;
  ch.balanceB = b;
  ch.status = CHANNEL_STATUS.SETTLING;
  db.prepare(
    `UPDATE economy_channels SET status = ?, balance_a = ?, balance_b = ? WHERE id = ?`,
  ).run(CHANNEL_STATUS.SETTLING, a, b, channelId);
  return { ...ch };
}

export function closeChannelV2(db, channelId) {
  const ch = _channels.get(channelId);
  if (!ch) throw new Error(`Channel not found: ${channelId}`);
  if (
    ch.status !== CHANNEL_STATUS.SETTLING &&
    ch.status !== CHANNEL_STATUS.OPEN &&
    ch.status !== CHANNEL_STATUS.ACTIVE
  )
    throw new Error(`Cannot close: channel is ${ch.status}`);
  // Release locked funds back as balance to each party
  const balA = _getBalance(ch.partyA);
  const balB = _getBalance(ch.partyB);
  balA.balance += ch.balanceA;
  balA.locked = Math.max(0, balA.locked - ch.balanceA);
  balB.balance += ch.balanceB;
  balB.locked = Math.max(0, balB.locked - ch.balanceB);
  ch.status = CHANNEL_STATUS.CLOSED;
  db.prepare(`UPDATE economy_channels SET status = ? WHERE id = ?`).run(
    CHANNEL_STATUS.CLOSED,
    channelId,
  );
  return { ...ch };
}

export function disputeChannel(db, channelId, reason) {
  const ch = _channels.get(channelId);
  if (!ch) throw new Error(`Channel not found: ${channelId}`);
  if (
    ch.status === CHANNEL_STATUS.CLOSED ||
    ch.status === CHANNEL_STATUS.DISPUTED
  )
    throw new Error(`Cannot dispute: channel is ${ch.status}`);
  ch.status = CHANNEL_STATUS.DISPUTED;
  ch.disputeReason = reason || null;
  db.prepare(`UPDATE economy_channels SET status = ? WHERE id = ?`).run(
    CHANNEL_STATUS.DISPUTED,
    channelId,
  );
  return { ...ch };
}

export function listChannelsV2(options = {}) {
  let result = [..._channels.values()];
  if (options.status) {
    if (!_CHANNEL_STATUS_VALUES.has(options.status))
      throw new Error(`Invalid status: ${options.status}`);
    result = result.filter((c) => c.status === options.status);
  }
  if (options.party)
    result = result.filter(
      (c) => c.partyA === options.party || c.partyB === options.party,
    );
  return result;
}

/**
 * List a resource with validated RESOURCE_TYPE enum.
 */
export function listResourceV2(
  db,
  { sellerId, resourceType, name, price, available = 1, metadata } = {},
) {
  if (!_RESOURCE_TYPE_VALUES.has(resourceType))
    throw new Error(`Invalid resourceType: ${resourceType}`);
  if (!Number.isFinite(price) || price < 0)
    throw new Error(`Invalid price: ${price}`);
  const listing = listResource(db, resourceType, sellerId, price, available);
  listing.name = name || null;
  listing.metadata = metadata || {};
  return listing;
}

/**
 * Mint an NFT tracked against NFT_STATUS state machine with royalty metadata.
 */
export function mintNFTV2(
  db,
  { owner, assetType, metadata, royaltyPercent = 0 } = {},
) {
  if (!owner) throw new Error("owner required");
  if (!assetType) throw new Error("assetType required");
  if (royaltyPercent < 0 || royaltyPercent > 50)
    throw new Error("royaltyPercent must be 0..50");
  const nft = mintNFT(db, owner, assetType, metadata);
  _v2NftStatus.set(nft.id, {
    status: NFT_STATUS.MINTED,
    royaltyPercent,
    listedPrice: null,
    soldTo: null,
  });
  return { ...nft, status: NFT_STATUS.MINTED, royaltyPercent };
}

export function listNFT(db, nftId, price) {
  const status = _v2NftStatus.get(nftId);
  if (!status) throw new Error(`NFT not found: ${nftId}`);
  if (status.status !== NFT_STATUS.MINTED)
    throw new Error(`Cannot list NFT in ${status.status} state`);
  if (!Number.isFinite(price) || price <= 0)
    throw new Error(`Invalid price: ${price}`);
  status.status = NFT_STATUS.LISTED;
  status.listedPrice = price;
  return { nftId, status: NFT_STATUS.LISTED, price };
}

export function buyNFT(db, nftId, buyer) {
  const nft = _nfts.get(nftId);
  if (!nft) throw new Error(`NFT not found: ${nftId}`);
  const status = _v2NftStatus.get(nftId);
  if (!status || status.status !== NFT_STATUS.LISTED)
    throw new Error(`NFT not listed`);
  const price = status.listedPrice;
  const buyerBal = _getBalance(buyer);
  if (buyerBal.balance < price)
    throw new Error(`Insufficient balance: ${buyerBal.balance} < ${price}`);
  // Split: royalty to original minter, remainder to current owner
  const royalty = (price * status.royaltyPercent) / 100;
  const sellerTake = price - royalty;
  buyerBal.balance -= price;
  const sellerBal = _getBalance(nft.owner);
  sellerBal.balance += sellerTake;
  // Royalty always goes to original owner (first minter) — in this v2, nft.owner
  // is the same as original owner since we don't track chain of custody.
  if (royalty > 0) sellerBal.balance += royalty;
  nft.owner = buyer;
  status.status = NFT_STATUS.SOLD;
  status.soldTo = buyer;
  return { nftId, buyer, price, royalty, status: NFT_STATUS.SOLD };
}

export function burnNFT(db, nftId) {
  const nft = _nfts.get(nftId);
  if (!nft) throw new Error(`NFT not found: ${nftId}`);
  const status = _v2NftStatus.get(nftId);
  if (!status) throw new Error(`NFT status missing: ${nftId}`);
  if (status.status === NFT_STATUS.BURNED)
    throw new Error("NFT already burned");
  status.status = NFT_STATUS.BURNED;
  return { nftId, status: NFT_STATUS.BURNED };
}

export function getNFTStatus(nftId) {
  return _v2NftStatus.get(nftId) || null;
}

/**
 * Record a task-scoped contribution with a weight (used for share calculation).
 */
export function recordTaskContribution(
  db,
  { taskId, agentId, weight = 1 } = {},
) {
  if (!taskId) throw new Error("taskId required");
  if (!agentId) throw new Error("agentId required");
  if (!Number.isFinite(weight) || weight <= 0)
    throw new Error("weight must be positive");
  if (!_v2TaskContributions.has(taskId)) _v2TaskContributions.set(taskId, []);
  const entry = { agentId, weight, recordedAt: new Date().toISOString() };
  _v2TaskContributions.get(taskId).push(entry);
  return { taskId, ...entry };
}

export function getTaskContributions(taskId) {
  return [...(_v2TaskContributions.get(taskId) || [])];
}

/**
 * Distribute revenue across contributors proportional to their weights.
 * Returns an array of { agentId, share, newBalance }.
 */
export function distributeRevenueV2(db, { taskId, total } = {}) {
  if (!taskId) throw new Error("taskId required");
  if (!Number.isFinite(total) || total <= 0)
    throw new Error("total must be positive");
  const contribs = _v2TaskContributions.get(taskId) || [];
  if (contribs.length === 0)
    throw new Error(`No contributions for task: ${taskId}`);
  // Aggregate by agent
  const weightByAgent = new Map();
  for (const c of contribs)
    weightByAgent.set(
      c.agentId,
      (weightByAgent.get(c.agentId) || 0) + c.weight,
    );
  const totalWeight = [...weightByAgent.values()].reduce((a, b) => a + b, 0);
  const shares = [];
  const now = new Date().toISOString();
  for (const [agentId, w] of weightByAgent) {
    const share = (total * w) / totalWeight;
    const bal = _getBalance(agentId);
    bal.balance += share;
    db.prepare(
      `INSERT OR REPLACE INTO economy_balances (agent_id, balance, locked, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(agentId, bal.balance, bal.locked, now);
    shares.push({ agentId, share, weight: w, newBalance: bal.balance });
  }
  const record = {
    id: crypto.randomUUID(),
    taskId,
    total,
    shares,
    distributedAt: now,
  };
  _v2Distributions.push(record);
  return record;
}

export function listDistributions({ taskId } = {}) {
  if (taskId) return _v2Distributions.filter((d) => d.taskId === taskId);
  return [..._v2Distributions];
}

/**
 * Extended V2 stats.
 */
export function getEconomyStatsV2() {
  const channelsByStatus = {};
  for (const c of _channels.values()) {
    const st = c.status || "unknown";
    channelsByStatus[st] = (channelsByStatus[st] || 0) + 1;
  }
  const nftByStatus = {};
  for (const n of _v2NftStatus.values()) {
    const st = n.status || "unknown";
    nftByStatus[st] = (nftByStatus[st] || 0) + 1;
  }
  const resourcesByType = {};
  for (const l of _market.values()) {
    resourcesByType[l.resourceType] =
      (resourcesByType[l.resourceType] || 0) + 1;
  }
  return {
    totalAccounts: _balances.size,
    totalChannels: _channels.size,
    channelsByStatus,
    totalListings: _market.size,
    resourcesByType,
    totalNFTs: _nfts.size,
    nftByStatus,
    priceModels: _v2PriceModels.size,
    distributions: _v2Distributions.length,
  };
}

// Reset hook augmentation — called by _resetState indirectly (callers should
// explicitly call _resetV2State in tests, since _resetState is unchanged for
// strictly-additive preservation).
export function _resetV2State() {
  _v2PriceModels.clear();
  _v2NftStatus.clear();
  _v2TaskContributions.clear();
  _v2Distributions.length = 0;
}

// ===== V2 Surface: Agent Economy governance overlay (CLI v0.137.0) =====
export const ECONOMY_ACCOUNT_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  FROZEN: "frozen",
  CLOSED: "closed",
});
export const ECONOMY_TX_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  SETTLED: "settled",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _econAcctTrans = new Map([
  [
    ECONOMY_ACCOUNT_MATURITY_V2.PENDING,
    new Set([
      ECONOMY_ACCOUNT_MATURITY_V2.ACTIVE,
      ECONOMY_ACCOUNT_MATURITY_V2.CLOSED,
    ]),
  ],
  [
    ECONOMY_ACCOUNT_MATURITY_V2.ACTIVE,
    new Set([
      ECONOMY_ACCOUNT_MATURITY_V2.FROZEN,
      ECONOMY_ACCOUNT_MATURITY_V2.CLOSED,
    ]),
  ],
  [
    ECONOMY_ACCOUNT_MATURITY_V2.FROZEN,
    new Set([
      ECONOMY_ACCOUNT_MATURITY_V2.ACTIVE,
      ECONOMY_ACCOUNT_MATURITY_V2.CLOSED,
    ]),
  ],
  [ECONOMY_ACCOUNT_MATURITY_V2.CLOSED, new Set()],
]);
const _econAcctTerminal = new Set([ECONOMY_ACCOUNT_MATURITY_V2.CLOSED]);
const _econTxTrans = new Map([
  [
    ECONOMY_TX_LIFECYCLE_V2.QUEUED,
    new Set([
      ECONOMY_TX_LIFECYCLE_V2.PROCESSING,
      ECONOMY_TX_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    ECONOMY_TX_LIFECYCLE_V2.PROCESSING,
    new Set([
      ECONOMY_TX_LIFECYCLE_V2.SETTLED,
      ECONOMY_TX_LIFECYCLE_V2.FAILED,
      ECONOMY_TX_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [ECONOMY_TX_LIFECYCLE_V2.SETTLED, new Set()],
  [ECONOMY_TX_LIFECYCLE_V2.FAILED, new Set()],
  [ECONOMY_TX_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _econAccts = new Map();
const _econTxs = new Map();
let _econMaxActivePerHolder = 20;
let _econMaxPendingPerAcct = 30;
let _econAcctIdleMs = 7 * 24 * 60 * 60 * 1000;
let _econTxStuckMs = 5 * 60 * 1000;

function _econPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveEconomyAccountsPerHolderV2(n) {
  _econMaxActivePerHolder = _econPos(n, "maxActiveEconomyAccountsPerHolder");
}
export function getMaxActiveEconomyAccountsPerHolderV2() {
  return _econMaxActivePerHolder;
}
export function setMaxPendingEconomyTxsPerAccountV2(n) {
  _econMaxPendingPerAcct = _econPos(n, "maxPendingEconomyTxsPerAccount");
}
export function getMaxPendingEconomyTxsPerAccountV2() {
  return _econMaxPendingPerAcct;
}
export function setEconomyAccountIdleMsV2(n) {
  _econAcctIdleMs = _econPos(n, "economyAccountIdleMs");
}
export function getEconomyAccountIdleMsV2() {
  return _econAcctIdleMs;
}
export function setEconomyTxStuckMsV2(n) {
  _econTxStuckMs = _econPos(n, "economyTxStuckMs");
}
export function getEconomyTxStuckMsV2() {
  return _econTxStuckMs;
}

export function _resetStateAgentEconomyV2() {
  _econAccts.clear();
  _econTxs.clear();
  _econMaxActivePerHolder = 20;
  _econMaxPendingPerAcct = 30;
  _econAcctIdleMs = 7 * 24 * 60 * 60 * 1000;
  _econTxStuckMs = 5 * 60 * 1000;
}

export function registerEconomyAccountV2({
  id,
  holder,
  currency,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!holder || typeof holder !== "string")
    throw new Error("holder is required");
  if (_econAccts.has(id))
    throw new Error(`economy account ${id} already registered`);
  const now = Date.now();
  const a = {
    id,
    holder,
    currency: currency || "CLC",
    status: ECONOMY_ACCOUNT_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    closedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _econAccts.set(id, a);
  return { ...a, metadata: { ...a.metadata } };
}
function _econCheckA(from, to) {
  const a = _econAcctTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid economy account transition ${from} → ${to}`);
}
function _econCountActive(holder) {
  let n = 0;
  for (const a of _econAccts.values())
    if (a.holder === holder && a.status === ECONOMY_ACCOUNT_MATURITY_V2.ACTIVE)
      n++;
  return n;
}

export function activateEconomyAccountV2(id) {
  const a = _econAccts.get(id);
  if (!a) throw new Error(`economy account ${id} not found`);
  _econCheckA(a.status, ECONOMY_ACCOUNT_MATURITY_V2.ACTIVE);
  const recovery = a.status === ECONOMY_ACCOUNT_MATURITY_V2.FROZEN;
  if (!recovery) {
    const c = _econCountActive(a.holder);
    if (c >= _econMaxActivePerHolder)
      throw new Error(
        `max active economy accounts per holder (${_econMaxActivePerHolder}) reached for ${a.holder}`,
      );
  }
  const now = Date.now();
  a.status = ECONOMY_ACCOUNT_MATURITY_V2.ACTIVE;
  a.updatedAt = now;
  a.lastTouchedAt = now;
  if (!a.activatedAt) a.activatedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function freezeEconomyAccountV2(id) {
  const a = _econAccts.get(id);
  if (!a) throw new Error(`economy account ${id} not found`);
  _econCheckA(a.status, ECONOMY_ACCOUNT_MATURITY_V2.FROZEN);
  a.status = ECONOMY_ACCOUNT_MATURITY_V2.FROZEN;
  a.updatedAt = Date.now();
  return { ...a, metadata: { ...a.metadata } };
}
export function closeEconomyAccountV2(id) {
  const a = _econAccts.get(id);
  if (!a) throw new Error(`economy account ${id} not found`);
  _econCheckA(a.status, ECONOMY_ACCOUNT_MATURITY_V2.CLOSED);
  const now = Date.now();
  a.status = ECONOMY_ACCOUNT_MATURITY_V2.CLOSED;
  a.updatedAt = now;
  if (!a.closedAt) a.closedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function touchEconomyAccountV2(id) {
  const a = _econAccts.get(id);
  if (!a) throw new Error(`economy account ${id} not found`);
  if (_econAcctTerminal.has(a.status))
    throw new Error(`cannot touch terminal economy account ${id}`);
  const now = Date.now();
  a.lastTouchedAt = now;
  a.updatedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function getEconomyAccountV2(id) {
  const a = _econAccts.get(id);
  if (!a) return null;
  return { ...a, metadata: { ...a.metadata } };
}
export function listEconomyAccountsV2() {
  return [..._econAccts.values()].map((a) => ({
    ...a,
    metadata: { ...a.metadata },
  }));
}

function _econCountPending(aid) {
  let n = 0;
  for (const t of _econTxs.values())
    if (
      t.accountId === aid &&
      (t.status === ECONOMY_TX_LIFECYCLE_V2.QUEUED ||
        t.status === ECONOMY_TX_LIFECYCLE_V2.PROCESSING)
    )
      n++;
  return n;
}

export function createEconomyTxV2({ id, accountId, amount, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!accountId || typeof accountId !== "string")
    throw new Error("accountId is required");
  if (_econTxs.has(id)) throw new Error(`economy tx ${id} already exists`);
  if (!_econAccts.has(accountId))
    throw new Error(`economy account ${accountId} not found`);
  const pending = _econCountPending(accountId);
  if (pending >= _econMaxPendingPerAcct)
    throw new Error(
      `max pending economy txs per account (${_econMaxPendingPerAcct}) reached for ${accountId}`,
    );
  const now = Date.now();
  const t = {
    id,
    accountId,
    amount: amount || "0",
    status: ECONOMY_TX_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _econTxs.set(id, t);
  return { ...t, metadata: { ...t.metadata } };
}
function _econCheckT(from, to) {
  const a = _econTxTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid economy tx transition ${from} → ${to}`);
}
export function startEconomyTxV2(id) {
  const t = _econTxs.get(id);
  if (!t) throw new Error(`economy tx ${id} not found`);
  _econCheckT(t.status, ECONOMY_TX_LIFECYCLE_V2.PROCESSING);
  const now = Date.now();
  t.status = ECONOMY_TX_LIFECYCLE_V2.PROCESSING;
  t.updatedAt = now;
  if (!t.startedAt) t.startedAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function settleEconomyTxV2(id) {
  const t = _econTxs.get(id);
  if (!t) throw new Error(`economy tx ${id} not found`);
  _econCheckT(t.status, ECONOMY_TX_LIFECYCLE_V2.SETTLED);
  const now = Date.now();
  t.status = ECONOMY_TX_LIFECYCLE_V2.SETTLED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  return { ...t, metadata: { ...t.metadata } };
}
export function failEconomyTxV2(id, reason) {
  const t = _econTxs.get(id);
  if (!t) throw new Error(`economy tx ${id} not found`);
  _econCheckT(t.status, ECONOMY_TX_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  t.status = ECONOMY_TX_LIFECYCLE_V2.FAILED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.failReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function cancelEconomyTxV2(id, reason) {
  const t = _econTxs.get(id);
  if (!t) throw new Error(`economy tx ${id} not found`);
  _econCheckT(t.status, ECONOMY_TX_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  t.status = ECONOMY_TX_LIFECYCLE_V2.CANCELLED;
  t.updatedAt = now;
  if (!t.settledAt) t.settledAt = now;
  if (reason) t.metadata.cancelReason = String(reason);
  return { ...t, metadata: { ...t.metadata } };
}
export function getEconomyTxV2(id) {
  const t = _econTxs.get(id);
  if (!t) return null;
  return { ...t, metadata: { ...t.metadata } };
}
export function listEconomyTxsV2() {
  return [..._econTxs.values()].map((t) => ({
    ...t,
    metadata: { ...t.metadata },
  }));
}

export function autoFreezeIdleEconomyAccountsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const a of _econAccts.values())
    if (
      a.status === ECONOMY_ACCOUNT_MATURITY_V2.ACTIVE &&
      t - a.lastTouchedAt >= _econAcctIdleMs
    ) {
      a.status = ECONOMY_ACCOUNT_MATURITY_V2.FROZEN;
      a.updatedAt = t;
      flipped.push(a.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEconomyTxsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const tx of _econTxs.values())
    if (
      tx.status === ECONOMY_TX_LIFECYCLE_V2.PROCESSING &&
      tx.startedAt != null &&
      t - tx.startedAt >= _econTxStuckMs
    ) {
      tx.status = ECONOMY_TX_LIFECYCLE_V2.FAILED;
      tx.updatedAt = t;
      if (!tx.settledAt) tx.settledAt = t;
      tx.metadata.failReason = "auto-fail-stuck";
      flipped.push(tx.id);
    }
  return { flipped, count: flipped.length };
}

export function getAgentEconomyGovStatsV2() {
  const accountsByStatus = {};
  for (const s of Object.values(ECONOMY_ACCOUNT_MATURITY_V2))
    accountsByStatus[s] = 0;
  for (const a of _econAccts.values()) accountsByStatus[a.status]++;
  const txsByStatus = {};
  for (const s of Object.values(ECONOMY_TX_LIFECYCLE_V2)) txsByStatus[s] = 0;
  for (const t of _econTxs.values()) txsByStatus[t.status]++;
  return {
    totalAccountsV2: _econAccts.size,
    totalTxsV2: _econTxs.size,
    maxActiveEconomyAccountsPerHolder: _econMaxActivePerHolder,
    maxPendingEconomyTxsPerAccount: _econMaxPendingPerAcct,
    economyAccountIdleMs: _econAcctIdleMs,
    economyTxStuckMs: _econTxStuckMs,
    accountsByStatus,
    txsByStatus,
  };
}

// === Iter28 V2 governance overlay: Aecogov ===
export const AECOGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const AECOGOV_TRADE_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  TRADING: "trading",
  SETTLED: "settled",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _aecogovPTrans = new Map([
  [
    AECOGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      AECOGOV_PROFILE_MATURITY_V2.ACTIVE,
      AECOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    AECOGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      AECOGOV_PROFILE_MATURITY_V2.PAUSED,
      AECOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    AECOGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      AECOGOV_PROFILE_MATURITY_V2.ACTIVE,
      AECOGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [AECOGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _aecogovPTerminal = new Set([AECOGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _aecogovJTrans = new Map([
  [
    AECOGOV_TRADE_LIFECYCLE_V2.QUEUED,
    new Set([
      AECOGOV_TRADE_LIFECYCLE_V2.TRADING,
      AECOGOV_TRADE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    AECOGOV_TRADE_LIFECYCLE_V2.TRADING,
    new Set([
      AECOGOV_TRADE_LIFECYCLE_V2.SETTLED,
      AECOGOV_TRADE_LIFECYCLE_V2.FAILED,
      AECOGOV_TRADE_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [AECOGOV_TRADE_LIFECYCLE_V2.SETTLED, new Set()],
  [AECOGOV_TRADE_LIFECYCLE_V2.FAILED, new Set()],
  [AECOGOV_TRADE_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _aecogovPsV2 = new Map();
const _aecogovJsV2 = new Map();
let _aecogovMaxActive = 8,
  _aecogovMaxPending = 25,
  _aecogovIdleMs = 2592000000,
  _aecogovStuckMs = 60 * 1000;
function _aecogovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _aecogovCheckP(from, to) {
  const a = _aecogovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid aecogov profile transition ${from} → ${to}`);
}
function _aecogovCheckJ(from, to) {
  const a = _aecogovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid aecogov trade transition ${from} → ${to}`);
}
function _aecogovCountActive(owner) {
  let c = 0;
  for (const p of _aecogovPsV2.values())
    if (p.owner === owner && p.status === AECOGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _aecogovCountPending(profileId) {
  let c = 0;
  for (const j of _aecogovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === AECOGOV_TRADE_LIFECYCLE_V2.QUEUED ||
        j.status === AECOGOV_TRADE_LIFECYCLE_V2.TRADING)
    )
      c++;
  return c;
}
export function setMaxActiveAecoProfilesPerOwnerV2(n) {
  _aecogovMaxActive = _aecogovPos(n, "maxActiveAecoProfilesPerOwner");
}
export function getMaxActiveAecoProfilesPerOwnerV2() {
  return _aecogovMaxActive;
}
export function setMaxPendingAecoTradesPerProfileV2(n) {
  _aecogovMaxPending = _aecogovPos(n, "maxPendingAecoTradesPerProfile");
}
export function getMaxPendingAecoTradesPerProfileV2() {
  return _aecogovMaxPending;
}
export function setAecoProfileIdleMsV2(n) {
  _aecogovIdleMs = _aecogovPos(n, "aecogovProfileIdleMs");
}
export function getAecoProfileIdleMsV2() {
  return _aecogovIdleMs;
}
export function setAecoTradeStuckMsV2(n) {
  _aecogovStuckMs = _aecogovPos(n, "aecogovTradeStuckMs");
}
export function getAecoTradeStuckMsV2() {
  return _aecogovStuckMs;
}
export function _resetStateAecogovV2() {
  _aecogovPsV2.clear();
  _aecogovJsV2.clear();
  _aecogovMaxActive = 8;
  _aecogovMaxPending = 25;
  _aecogovIdleMs = 2592000000;
  _aecogovStuckMs = 60 * 1000;
}
export function registerAecoProfileV2({ id, owner, market, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_aecogovPsV2.has(id))
    throw new Error(`aecogov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    market: market || "default",
    status: AECOGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _aecogovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateAecoProfileV2(id) {
  const p = _aecogovPsV2.get(id);
  if (!p) throw new Error(`aecogov profile ${id} not found`);
  const isInitial = p.status === AECOGOV_PROFILE_MATURITY_V2.PENDING;
  _aecogovCheckP(p.status, AECOGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _aecogovCountActive(p.owner) >= _aecogovMaxActive)
    throw new Error(`max active aecogov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = AECOGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pausedAecoProfileV2(id) {
  const p = _aecogovPsV2.get(id);
  if (!p) throw new Error(`aecogov profile ${id} not found`);
  _aecogovCheckP(p.status, AECOGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = AECOGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveAecoProfileV2(id) {
  const p = _aecogovPsV2.get(id);
  if (!p) throw new Error(`aecogov profile ${id} not found`);
  _aecogovCheckP(p.status, AECOGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = AECOGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchAecoProfileV2(id) {
  const p = _aecogovPsV2.get(id);
  if (!p) throw new Error(`aecogov profile ${id} not found`);
  if (_aecogovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal aecogov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getAecoProfileV2(id) {
  const p = _aecogovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listAecoProfilesV2() {
  return [..._aecogovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createAecoTradeV2({ id, profileId, orderId, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_aecogovJsV2.has(id))
    throw new Error(`aecogov trade ${id} already exists`);
  if (!_aecogovPsV2.has(profileId))
    throw new Error(`aecogov profile ${profileId} not found`);
  if (_aecogovCountPending(profileId) >= _aecogovMaxPending)
    throw new Error(
      `max pending aecogov trades for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    orderId: orderId || "",
    status: AECOGOV_TRADE_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _aecogovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function tradingAecoTradeV2(id) {
  const j = _aecogovJsV2.get(id);
  if (!j) throw new Error(`aecogov trade ${id} not found`);
  _aecogovCheckJ(j.status, AECOGOV_TRADE_LIFECYCLE_V2.TRADING);
  const now = Date.now();
  j.status = AECOGOV_TRADE_LIFECYCLE_V2.TRADING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeTradeAecoV2(id) {
  const j = _aecogovJsV2.get(id);
  if (!j) throw new Error(`aecogov trade ${id} not found`);
  _aecogovCheckJ(j.status, AECOGOV_TRADE_LIFECYCLE_V2.SETTLED);
  const now = Date.now();
  j.status = AECOGOV_TRADE_LIFECYCLE_V2.SETTLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failAecoTradeV2(id, reason) {
  const j = _aecogovJsV2.get(id);
  if (!j) throw new Error(`aecogov trade ${id} not found`);
  _aecogovCheckJ(j.status, AECOGOV_TRADE_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = AECOGOV_TRADE_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelAecoTradeV2(id, reason) {
  const j = _aecogovJsV2.get(id);
  if (!j) throw new Error(`aecogov trade ${id} not found`);
  _aecogovCheckJ(j.status, AECOGOV_TRADE_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = AECOGOV_TRADE_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getAecoTradeV2(id) {
  const j = _aecogovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listAecoTradesV2() {
  return [..._aecogovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPausedIdleAecoProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _aecogovPsV2.values())
    if (
      p.status === AECOGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _aecogovIdleMs
    ) {
      p.status = AECOGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckAecoTradesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _aecogovJsV2.values())
    if (
      j.status === AECOGOV_TRADE_LIFECYCLE_V2.TRADING &&
      j.startedAt != null &&
      t - j.startedAt >= _aecogovStuckMs
    ) {
      j.status = AECOGOV_TRADE_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getAecogovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(AECOGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _aecogovPsV2.values()) profilesByStatus[p.status]++;
  const tradesByStatus = {};
  for (const v of Object.values(AECOGOV_TRADE_LIFECYCLE_V2))
    tradesByStatus[v] = 0;
  for (const j of _aecogovJsV2.values()) tradesByStatus[j.status]++;
  return {
    totalAecoProfilesV2: _aecogovPsV2.size,
    totalAecoTradesV2: _aecogovJsV2.size,
    maxActiveAecoProfilesPerOwner: _aecogovMaxActive,
    maxPendingAecoTradesPerProfile: _aecogovMaxPending,
    aecogovProfileIdleMs: _aecogovIdleMs,
    aecogovTradeStuckMs: _aecogovStuckMs,
    profilesByStatus,
    tradesByStatus,
  };
}
