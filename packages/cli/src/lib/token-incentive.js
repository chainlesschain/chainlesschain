/**
 * Token Incentive — CLI port of Phase 66 token-ledger + contribution-tracker
 * (docs/design/modules/37_技能市场系统.md §2.3-2.4).
 *
 * The Desktop build drives token ledger + contribution tracker over Context
 * Engineering and reputation-weighted reward calculation with on-chain anchoring.
 * The CLI can't host the P2P agent mesh or on-chain settlement, so this port
 * ships the tractable scaffolding:
 *
 *   - TokenLedger: accounts (balance/totalEarned/totalSpent) + transfers +
 *     rewards, all tracked as double-entry-ish transactions.
 *   - ContributionTracker: contribution records with typed reward multipliers +
 *     leaderboard aggregation.
 *   - Catalogs: CONTRIBUTION_TYPES, TX_TYPES.
 *
 * Real reputation-weighted rewards, on-chain settlement, and P2P cross-wallet
 * transfer are Desktop-only.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const TX_TYPES = Object.freeze({
  TRANSFER: "transfer",
  REWARD: "reward",
  MINT: "mint",
  BURN: "burn",
});

const VALID_TX_TYPES = new Set(Object.values(TX_TYPES));

// Contribution types and their base reward multipliers.
// These match the Desktop defaults but are tweakable at call site via
// calculateReward(contribution, { multiplier }).
export const CONTRIBUTION_TYPES = Object.freeze({
  SKILL_PUBLICATION: {
    name: "skill_publication",
    baseReward: 10,
    description: "发布新技能服务",
  },
  INVOCATION_PROVIDED: {
    name: "invocation_provided",
    baseReward: 0.1,
    description: "提供一次技能调用",
  },
  SKILL_REVIEW: {
    name: "skill_review",
    baseReward: 1,
    description: "审核或评价技能",
  },
  BUG_REPORT: {
    name: "bug_report",
    baseReward: 2,
    description: "提交有效 Bug 报告",
  },
  CODE_CONTRIBUTION: {
    name: "code_contribution",
    baseReward: 5,
    description: "代码贡献",
  },
  DOCUMENTATION: {
    name: "documentation",
    baseReward: 3,
    description: "文档贡献",
  },
  COMMUNITY_SUPPORT: {
    name: "community_support",
    baseReward: 1,
    description: "社区支持（回答问题、引导新人等）",
  },
});

const VALID_CONTRIBUTION_TYPES = new Set(
  Object.values(CONTRIBUTION_TYPES).map((c) => c.name),
);

function _getTypeSpec(typeName) {
  const name = String(typeName || "").toLowerCase();
  for (const spec of Object.values(CONTRIBUTION_TYPES)) {
    if (spec.name === name) return spec;
  }
  return null;
}

/* ── State ─────────────────────────────────────────────────── */

const _accounts = new Map(); // accountId → account
const _transactions = new Map(); // txId → transaction
const _contributions = new Map(); // contributionId → contribution
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureTokenTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_accounts (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE,
      balance REAL DEFAULT 0,
      total_earned REAL DEFAULT 0,
      total_spent REAL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_transactions (
      id TEXT PRIMARY KEY,
      from_account TEXT,
      to_account TEXT,
      amount REAL NOT NULL,
      reason TEXT,
      type TEXT DEFAULT 'transfer',
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value REAL DEFAULT 0,
      metadata TEXT,
      rewarded INTEGER DEFAULT 0,
      reward_amount REAL DEFAULT 0,
      tx_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_token_tx_from ON token_transactions(from_account)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_token_tx_to ON token_transactions(to_account)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_contributions_user ON contributions(user_id)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_contributions_type ON contributions(type)`,
  );
}

/* ── Catalogs ──────────────────────────────────────────────── */

export function listContributionTypes() {
  return Object.values(CONTRIBUTION_TYPES).map((c) => ({ ...c }));
}

export function listTxTypes() {
  return Object.values(TX_TYPES);
}

function _strip(row) {
  const { _seq: _omit, ...rest } = row;
  void _omit;
  return rest;
}

/* ── TokenLedger ───────────────────────────────────────────── */

function _persistAccount(db, account) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO token_accounts (id, account_id, balance, total_earned, total_spent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    account.id,
    account.accountId,
    account.balance,
    account.totalEarned,
    account.totalSpent,
    account.createdAt,
    account.updatedAt,
  );
}

function _ensureAccount(db, accountId, now) {
  const id = String(accountId || "").trim();
  if (!id) throw new Error("accountId is required");

  let account = _accounts.get(id);
  if (account) return account;

  account = {
    id: crypto.randomUUID(),
    accountId: id,
    balance: 0,
    totalEarned: 0,
    totalSpent: 0,
    createdAt: now,
    updatedAt: now,
    _seq: ++_seq,
  };
  _accounts.set(id, account);
  _persistAccount(db, account);
  return account;
}

export function getBalance(accountId) {
  const account = _accounts.get(String(accountId || "").trim());
  return account ? _strip(account) : null;
}

export function listAccounts(opts = {}) {
  let rows = [..._accounts.values()];
  rows.sort((a, b) => b.balance - a.balance || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

function _recordTransaction(db, config) {
  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();
  const tx = {
    id,
    fromAccount: config.from ?? null,
    toAccount: config.to ?? null,
    amount: Number(config.amount),
    reason: config.reason ? String(config.reason) : null,
    type: config.type || TX_TYPES.TRANSFER,
    createdAt: now,
    _seq: ++_seq,
  };
  _transactions.set(id, tx);

  if (db) {
    db.prepare(
      `INSERT INTO token_transactions (id, from_account, to_account, amount, reason, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, tx.fromAccount, tx.toAccount, tx.amount, tx.reason, tx.type, now);
  }
  return tx;
}

export function transfer(db, config = {}) {
  const from = String(config.from || "").trim();
  const to = String(config.to || "").trim();
  const amount = Number(config.amount);

  if (!from) throw new Error("from account is required");
  if (!to) throw new Error("to account is required");
  if (from === to) throw new Error("Cannot transfer to same account");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${config.amount} (must be > 0)`);
  }

  const now = Number(config.now ?? Date.now());
  const fromAccount = _ensureAccount(db, from, now);
  const toAccount = _ensureAccount(db, to, now);

  if (fromAccount.balance < amount) {
    throw new Error(`Insufficient balance: ${fromAccount.balance} < ${amount}`);
  }

  fromAccount.balance -= amount;
  fromAccount.totalSpent += amount;
  fromAccount.updatedAt = now;
  toAccount.balance += amount;
  toAccount.totalEarned += amount;
  toAccount.updatedAt = now;

  _persistAccount(db, fromAccount);
  _persistAccount(db, toAccount);

  const tx = _recordTransaction(db, {
    from,
    to,
    amount,
    reason: config.reason,
    type: TX_TYPES.TRANSFER,
    now,
  });
  return _strip(tx);
}

export function mint(db, config = {}) {
  const to = String(config.to || "").trim();
  const amount = Number(config.amount);

  if (!to) throw new Error("to account is required");
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${config.amount} (must be > 0)`);
  }

  const now = Number(config.now ?? Date.now());
  const account = _ensureAccount(db, to, now);
  account.balance += amount;
  account.totalEarned += amount;
  account.updatedAt = now;
  _persistAccount(db, account);

  const tx = _recordTransaction(db, {
    from: null,
    to,
    amount,
    reason: config.reason,
    type: TX_TYPES.MINT,
    now,
  });
  return _strip(tx);
}

export function getTransactionHistory(opts = {}) {
  let rows = [..._transactions.values()];
  if (opts.accountId) {
    const id = String(opts.accountId);
    rows = rows.filter((t) => t.fromAccount === id || t.toAccount === id);
  }
  if (opts.type) {
    const t = String(opts.type).toLowerCase();
    if (!VALID_TX_TYPES.has(t)) {
      throw new Error(`Unknown tx type: ${opts.type}`);
    }
    rows = rows.filter((tx) => tx.type === t);
  }
  rows.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

/* ── ContributionTracker ───────────────────────────────────── */

export function calculateReward(contribution, opts = {}) {
  const type = String(contribution?.type || "").toLowerCase();
  const spec = _getTypeSpec(type);
  if (!spec) {
    throw new Error(`Unknown contribution type: ${contribution?.type}`);
  }
  const value = Number(contribution?.value ?? 1);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value: ${contribution?.value} (must be >= 0)`);
  }
  const multiplier = Number(opts.multiplier ?? 1);
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error(`Invalid multiplier: ${opts.multiplier} (must be >= 0)`);
  }
  const reward = spec.baseReward * value * multiplier;
  return Number(reward.toFixed(4));
}

export function recordContribution(db, config = {}) {
  const userId = String(config.userId || "").trim();
  if (!userId) throw new Error("userId is required");

  const type = String(config.type || "").toLowerCase();
  if (!VALID_CONTRIBUTION_TYPES.has(type)) {
    throw new Error(
      `Unknown contribution type: ${config.type} (known: ${[...VALID_CONTRIBUTION_TYPES].join("/")})`,
    );
  }

  const value = Number(config.value ?? 1);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value: ${config.value} (must be >= 0)`);
  }

  const metadata = config.metadata || null;
  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  const contribution = {
    id,
    userId,
    type,
    value,
    metadata,
    rewarded: false,
    rewardAmount: 0,
    txId: null,
    createdAt: now,
    _seq: ++_seq,
  };
  _contributions.set(id, contribution);

  if (db) {
    db.prepare(
      `INSERT INTO contributions (id, user_id, type, value, metadata, rewarded, reward_amount, tx_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      userId,
      type,
      value,
      metadata ? JSON.stringify(metadata) : null,
      0,
      0,
      null,
      now,
    );
  }

  // Auto-reward if requested
  if (config.autoReward) {
    rewardContribution(db, id, { multiplier: config.multiplier });
  }

  return _strip(_contributions.get(id));
}

export function rewardContribution(db, contributionId, opts = {}) {
  const contribution = _contributions.get(contributionId);
  if (!contribution) {
    throw new Error(`Contribution not found: ${contributionId}`);
  }
  if (contribution.rewarded) {
    throw new Error(`Contribution already rewarded: ${contributionId}`);
  }

  const amount = calculateReward(contribution, {
    multiplier: opts.multiplier,
  });
  if (amount <= 0) {
    contribution.rewarded = true;
    contribution.rewardAmount = 0;
    if (db) {
      db.prepare(
        `UPDATE contributions SET rewarded = ?, reward_amount = ? WHERE id = ?`,
      ).run(1, 0, contributionId);
    }
    return { contribution: _strip(contribution), tx: null };
  }

  const now = Number(opts.now ?? Date.now());
  const account = _ensureAccount(db, contribution.userId, now);
  account.balance += amount;
  account.totalEarned += amount;
  account.updatedAt = now;
  _persistAccount(db, account);

  const tx = _recordTransaction(db, {
    from: null,
    to: contribution.userId,
    amount,
    reason: `contribution:${contribution.type}:${contributionId.slice(0, 8)}`,
    type: TX_TYPES.REWARD,
    now,
  });

  contribution.rewarded = true;
  contribution.rewardAmount = amount;
  contribution.txId = tx.id;

  if (db) {
    db.prepare(
      `UPDATE contributions SET rewarded = ?, reward_amount = ?, tx_id = ? WHERE id = ?`,
    ).run(1, amount, tx.id, contributionId);
  }

  return { contribution: _strip(contribution), tx: _strip(tx) };
}

export function getContributions(opts = {}) {
  let rows = [..._contributions.values()];
  if (opts.userId) {
    rows = rows.filter((c) => c.userId === opts.userId);
  }
  if (opts.type) {
    const t = String(opts.type).toLowerCase();
    if (!VALID_CONTRIBUTION_TYPES.has(t)) {
      throw new Error(`Unknown contribution type: ${opts.type}`);
    }
    rows = rows.filter((c) => c.type === t);
  }
  if (opts.rewarded === true) {
    rows = rows.filter((c) => c.rewarded === true);
  } else if (opts.rewarded === false) {
    rows = rows.filter((c) => c.rewarded === false);
  }
  rows.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

export function getLeaderboard(opts = {}) {
  const userStats = new Map();
  for (const c of _contributions.values()) {
    const s = userStats.get(c.userId) || {
      userId: c.userId,
      contributions: 0,
      totalValue: 0,
      totalReward: 0,
    };
    s.contributions += 1;
    s.totalValue += c.value;
    s.totalReward += c.rewardAmount || 0;
    userStats.set(c.userId, s);
  }
  let rows = [...userStats.values()];
  rows.sort(
    (a, b) =>
      b.totalReward - a.totalReward ||
      b.totalValue - a.totalValue ||
      b.contributions - a.contributions,
  );
  const limit = opts.limit || 10;
  return rows.slice(0, limit).map((s) => ({
    ...s,
    totalReward: Number(s.totalReward.toFixed(4)),
    totalValue: Number(s.totalValue.toFixed(4)),
  }));
}

/* ── Reset (tests) ─────────────────────────────────────────── */

export function _resetState() {
  _accounts.clear();
  _transactions.clear();
  _contributions.clear();
  _seq = 0;
}

// ═══════════════════════════════════════════════════════════════
// Phase 66 V2 — Account + Claim lifecycle, per-user claim cap
// ═══════════════════════════════════════════════════════════════

export const ACCOUNT_STATUS_V2 = Object.freeze({
  ACTIVE: "active",
  FROZEN: "frozen",
  CLOSED: "closed",
});

export const CLAIM_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  PAID: "paid",
  REJECTED: "rejected",
});

export const TOKEN_DEFAULT_MAX_PENDING_CLAIMS_PER_USER = 50;
export const TOKEN_DEFAULT_CLAIM_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const TOKEN_DEFAULT_MAX_CLAIM_AMOUNT = 10000;

let _maxPendingClaimsPerUser = TOKEN_DEFAULT_MAX_PENDING_CLAIMS_PER_USER;
let _claimExpiryMs = TOKEN_DEFAULT_CLAIM_EXPIRY_MS;
let _maxClaimAmount = TOKEN_DEFAULT_MAX_CLAIM_AMOUNT;

const _accountStatesV2 = new Map();
const _claimStatesV2 = new Map();

const ACCOUNT_TRANSITIONS_V2 = new Map([
  ["active", new Set(["frozen", "closed"])],
  ["frozen", new Set(["active", "closed"])],
]);
const ACCOUNT_TERMINALS_V2 = new Set(["closed"]);

const CLAIM_TRANSITIONS_V2 = new Map([
  ["pending", new Set(["approved", "rejected"])],
  ["approved", new Set(["paid", "rejected"])],
]);
const CLAIM_TERMINALS_V2 = new Set(["paid", "rejected"]);

function _positiveInt(n, label) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Math.floor(v);
}

export function setMaxPendingClaimsPerUser(n) {
  _maxPendingClaimsPerUser = _positiveInt(n, "maxPendingClaimsPerUser");
  return _maxPendingClaimsPerUser;
}

export function setClaimExpiryMs(ms) {
  _claimExpiryMs = _positiveInt(ms, "claimExpiryMs");
  return _claimExpiryMs;
}

export function setMaxClaimAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error("maxClaimAmount must be a positive number");
  }
  _maxClaimAmount = v;
  return _maxClaimAmount;
}

export function getMaxPendingClaimsPerUser() {
  return _maxPendingClaimsPerUser;
}

export function getClaimExpiryMs() {
  return _claimExpiryMs;
}

export function getMaxClaimAmount() {
  return _maxClaimAmount;
}

export function getPendingClaimCount(userId) {
  let count = 0;
  for (const entry of _claimStatesV2.values()) {
    if (entry.status === CLAIM_STATUS_V2.PENDING) {
      if (!userId || entry.userId === userId) count += 1;
    }
  }
  return count;
}

/* ── Account V2 ─────────────────────────────────────────────── */

export function registerAccountV2(db, { accountId, metadata } = {}) {
  if (!accountId) throw new Error("accountId is required");
  if (_accountStatesV2.has(accountId)) {
    throw new Error(`Account already registered: ${accountId}`);
  }
  const now = Date.now();
  const entry = {
    accountId,
    status: ACCOUNT_STATUS_V2.ACTIVE,
    reason: null,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
  };
  _accountStatesV2.set(accountId, entry);
  return { ...entry };
}

export function getAccountStatusV2(accountId) {
  const entry = _accountStatesV2.get(accountId);
  return entry ? { ...entry } : null;
}

export function setAccountStatusV2(db, accountId, newStatus, patch = {}) {
  const entry = _accountStatesV2.get(accountId);
  if (!entry) throw new Error(`Account not found: ${accountId}`);
  if (!Object.values(ACCOUNT_STATUS_V2).includes(newStatus)) {
    throw new Error(`Invalid account status: ${newStatus}`);
  }
  if (ACCOUNT_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Account is terminal: ${entry.status}`);
  }
  const allowed = ACCOUNT_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function freezeAccount(db, accountId, reason) {
  return setAccountStatusV2(db, accountId, ACCOUNT_STATUS_V2.FROZEN, {
    reason,
  });
}

export function unfreezeAccount(db, accountId, reason) {
  return setAccountStatusV2(db, accountId, ACCOUNT_STATUS_V2.ACTIVE, {
    reason,
  });
}

export function closeAccount(db, accountId, reason) {
  return setAccountStatusV2(db, accountId, ACCOUNT_STATUS_V2.CLOSED, {
    reason,
  });
}

/* ── Claim V2 ───────────────────────────────────────────────── */

export function submitClaimV2(
  db,
  { claimId, userId, amount, contributionId, metadata } = {},
) {
  if (!claimId) throw new Error("claimId is required");
  if (!userId) throw new Error("userId is required");
  const v = Number(amount);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`Invalid amount: ${amount} (must be > 0)`);
  }
  if (v > _maxClaimAmount) {
    throw new Error(`Amount exceeds maxClaimAmount: ${v} > ${_maxClaimAmount}`);
  }
  if (_claimStatesV2.has(claimId)) {
    throw new Error(`Claim already registered: ${claimId}`);
  }
  // Reject if account exists in V2 state and is frozen/closed
  const accountEntry = _accountStatesV2.get(userId);
  if (accountEntry && accountEntry.status !== ACCOUNT_STATUS_V2.ACTIVE) {
    throw new Error(`Account not active: ${accountEntry.status}`);
  }
  // Enforce per-user pending cap
  const pendingCount = getPendingClaimCount(userId);
  if (pendingCount >= _maxPendingClaimsPerUser) {
    throw new Error(
      `Max pending claims reached (${pendingCount}/${_maxPendingClaimsPerUser}) for user ${userId}`,
    );
  }
  const now = Date.now();
  const entry = {
    claimId,
    userId,
    amount: v,
    contributionId: contributionId || null,
    status: CLAIM_STATUS_V2.PENDING,
    reason: null,
    metadata: metadata ? { ...metadata } : {},
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  };
  _claimStatesV2.set(claimId, entry);
  return { ...entry };
}

export function getClaimStatusV2(claimId) {
  const entry = _claimStatesV2.get(claimId);
  return entry ? { ...entry } : null;
}

export function setClaimStatusV2(db, claimId, newStatus, patch = {}) {
  const entry = _claimStatesV2.get(claimId);
  if (!entry) throw new Error(`Claim not found: ${claimId}`);
  if (!Object.values(CLAIM_STATUS_V2).includes(newStatus)) {
    throw new Error(`Invalid claim status: ${newStatus}`);
  }
  if (CLAIM_TERMINALS_V2.has(entry.status)) {
    throw new Error(`Claim is terminal: ${entry.status}`);
  }
  const allowed = CLAIM_TRANSITIONS_V2.get(entry.status) || new Set();
  if (!allowed.has(newStatus)) {
    throw new Error(`Invalid transition: ${entry.status} → ${newStatus}`);
  }
  entry.status = newStatus;
  entry.updatedAt = Date.now();
  if (newStatus === CLAIM_STATUS_V2.PAID) entry.paidAt = entry.updatedAt;
  if (patch.reason !== undefined) entry.reason = patch.reason;
  if (patch.metadata) entry.metadata = { ...entry.metadata, ...patch.metadata };
  return { ...entry };
}

export function approveClaim(db, claimId, reason) {
  return setClaimStatusV2(db, claimId, CLAIM_STATUS_V2.APPROVED, { reason });
}

export function rejectClaim(db, claimId, reason) {
  return setClaimStatusV2(db, claimId, CLAIM_STATUS_V2.REJECTED, { reason });
}

export function payClaim(db, claimId, reason) {
  return setClaimStatusV2(db, claimId, CLAIM_STATUS_V2.PAID, { reason });
}

export function autoExpireUnclaimedClaims(db, nowMs = Date.now()) {
  const expired = [];
  for (const entry of _claimStatesV2.values()) {
    if (entry.status !== CLAIM_STATUS_V2.PENDING) continue;
    if (nowMs - entry.createdAt > _claimExpiryMs) {
      entry.status = CLAIM_STATUS_V2.REJECTED;
      entry.reason = "expired";
      entry.updatedAt = nowMs;
      expired.push({ ...entry });
    }
  }
  return expired;
}

/* ── Stats V2 ───────────────────────────────────────────────── */

export function getTokenStatsV2() {
  const accountsByStatus = { active: 0, frozen: 0, closed: 0 };
  const claimsByStatus = { pending: 0, approved: 0, paid: 0, rejected: 0 };
  let totalClaimedAmount = 0;
  let totalPaidAmount = 0;

  for (const entry of _accountStatesV2.values()) {
    if (accountsByStatus[entry.status] !== undefined)
      accountsByStatus[entry.status] += 1;
  }
  for (const entry of _claimStatesV2.values()) {
    if (claimsByStatus[entry.status] !== undefined)
      claimsByStatus[entry.status] += 1;
    totalClaimedAmount += entry.amount;
    if (entry.status === CLAIM_STATUS_V2.PAID) totalPaidAmount += entry.amount;
  }

  return {
    totalAccounts: _accountStatesV2.size,
    totalClaims: _claimStatesV2.size,
    totalClaimedAmount: Number(totalClaimedAmount.toFixed(4)),
    totalPaidAmount: Number(totalPaidAmount.toFixed(4)),
    maxPendingClaimsPerUser: _maxPendingClaimsPerUser,
    claimExpiryMs: _claimExpiryMs,
    maxClaimAmount: _maxClaimAmount,
    accountsByStatus,
    claimsByStatus,
  };
}

/* ── Reset V2 (tests) ───────────────────────────────────────── */

export function _resetStateV2() {
  _accountStatesV2.clear();
  _claimStatesV2.clear();
  _maxPendingClaimsPerUser = TOKEN_DEFAULT_MAX_PENDING_CLAIMS_PER_USER;
  _claimExpiryMs = TOKEN_DEFAULT_CLAIM_EXPIRY_MS;
  _maxClaimAmount = TOKEN_DEFAULT_MAX_CLAIM_AMOUNT;
}

// =====================================================================
// token-incentive V2 governance overlay (iter17)
// =====================================================================
export const INCGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const INCGOV_PAYOUT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  PAID: "paid",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _incgovPTrans = new Map([
  [
    INCGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      INCGOV_PROFILE_MATURITY_V2.ACTIVE,
      INCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    INCGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      INCGOV_PROFILE_MATURITY_V2.PAUSED,
      INCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    INCGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      INCGOV_PROFILE_MATURITY_V2.ACTIVE,
      INCGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [INCGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _incgovPTerminal = new Set([INCGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _incgovJTrans = new Map([
  [
    INCGOV_PAYOUT_LIFECYCLE_V2.QUEUED,
    new Set([
      INCGOV_PAYOUT_LIFECYCLE_V2.PROCESSING,
      INCGOV_PAYOUT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    INCGOV_PAYOUT_LIFECYCLE_V2.PROCESSING,
    new Set([
      INCGOV_PAYOUT_LIFECYCLE_V2.PAID,
      INCGOV_PAYOUT_LIFECYCLE_V2.FAILED,
      INCGOV_PAYOUT_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [INCGOV_PAYOUT_LIFECYCLE_V2.PAID, new Set()],
  [INCGOV_PAYOUT_LIFECYCLE_V2.FAILED, new Set()],
  [INCGOV_PAYOUT_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _incgovPsV2 = new Map();
const _incgovJsV2 = new Map();
let _incgovMaxActive = 10,
  _incgovMaxPending = 30,
  _incgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _incgovStuckMs = 60 * 1000;
function _incgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _incgovCheckP(from, to) {
  const a = _incgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid incgov profile transition ${from} → ${to}`);
}
function _incgovCheckJ(from, to) {
  const a = _incgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid incgov payout transition ${from} → ${to}`);
}
function _incgovCountActive(owner) {
  let c = 0;
  for (const p of _incgovPsV2.values())
    if (p.owner === owner && p.status === INCGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _incgovCountPending(profileId) {
  let c = 0;
  for (const j of _incgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === INCGOV_PAYOUT_LIFECYCLE_V2.QUEUED ||
        j.status === INCGOV_PAYOUT_LIFECYCLE_V2.PROCESSING)
    )
      c++;
  return c;
}
export function setMaxActiveIncgovProfilesPerOwnerV2(n) {
  _incgovMaxActive = _incgovPos(n, "maxActiveIncgovProfilesPerOwner");
}
export function getMaxActiveIncgovProfilesPerOwnerV2() {
  return _incgovMaxActive;
}
export function setMaxPendingIncgovPayoutsPerProfileV2(n) {
  _incgovMaxPending = _incgovPos(n, "maxPendingIncgovPayoutsPerProfile");
}
export function getMaxPendingIncgovPayoutsPerProfileV2() {
  return _incgovMaxPending;
}
export function setIncgovProfileIdleMsV2(n) {
  _incgovIdleMs = _incgovPos(n, "incgovProfileIdleMs");
}
export function getIncgovProfileIdleMsV2() {
  return _incgovIdleMs;
}
export function setIncgovPayoutStuckMsV2(n) {
  _incgovStuckMs = _incgovPos(n, "incgovPayoutStuckMs");
}
export function getIncgovPayoutStuckMsV2() {
  return _incgovStuckMs;
}
export function _resetStateTokenIncentiveV2() {
  _incgovPsV2.clear();
  _incgovJsV2.clear();
  _incgovMaxActive = 10;
  _incgovMaxPending = 30;
  _incgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _incgovStuckMs = 60 * 1000;
}
export function registerIncgovProfileV2({ id, owner, token, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_incgovPsV2.has(id))
    throw new Error(`incgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    token: token || "CLC",
    status: INCGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _incgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateIncgovProfileV2(id) {
  const p = _incgovPsV2.get(id);
  if (!p) throw new Error(`incgov profile ${id} not found`);
  const isInitial = p.status === INCGOV_PROFILE_MATURITY_V2.PENDING;
  _incgovCheckP(p.status, INCGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _incgovCountActive(p.owner) >= _incgovMaxActive)
    throw new Error(`max active incgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = INCGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseIncgovProfileV2(id) {
  const p = _incgovPsV2.get(id);
  if (!p) throw new Error(`incgov profile ${id} not found`);
  _incgovCheckP(p.status, INCGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = INCGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveIncgovProfileV2(id) {
  const p = _incgovPsV2.get(id);
  if (!p) throw new Error(`incgov profile ${id} not found`);
  _incgovCheckP(p.status, INCGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = INCGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchIncgovProfileV2(id) {
  const p = _incgovPsV2.get(id);
  if (!p) throw new Error(`incgov profile ${id} not found`);
  if (_incgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal incgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getIncgovProfileV2(id) {
  const p = _incgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listIncgovProfilesV2() {
  return [..._incgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createIncgovPayoutV2({
  id,
  profileId,
  recipient,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_incgovJsV2.has(id))
    throw new Error(`incgov payout ${id} already exists`);
  if (!_incgovPsV2.has(profileId))
    throw new Error(`incgov profile ${profileId} not found`);
  if (_incgovCountPending(profileId) >= _incgovMaxPending)
    throw new Error(
      `max pending incgov payouts for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    recipient: recipient || "",
    status: INCGOV_PAYOUT_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _incgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function processingIncgovPayoutV2(id) {
  const j = _incgovJsV2.get(id);
  if (!j) throw new Error(`incgov payout ${id} not found`);
  _incgovCheckJ(j.status, INCGOV_PAYOUT_LIFECYCLE_V2.PROCESSING);
  const now = Date.now();
  j.status = INCGOV_PAYOUT_LIFECYCLE_V2.PROCESSING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completePayoutIncgovV2(id) {
  const j = _incgovJsV2.get(id);
  if (!j) throw new Error(`incgov payout ${id} not found`);
  _incgovCheckJ(j.status, INCGOV_PAYOUT_LIFECYCLE_V2.PAID);
  const now = Date.now();
  j.status = INCGOV_PAYOUT_LIFECYCLE_V2.PAID;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failIncgovPayoutV2(id, reason) {
  const j = _incgovJsV2.get(id);
  if (!j) throw new Error(`incgov payout ${id} not found`);
  _incgovCheckJ(j.status, INCGOV_PAYOUT_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = INCGOV_PAYOUT_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelIncgovPayoutV2(id, reason) {
  const j = _incgovJsV2.get(id);
  if (!j) throw new Error(`incgov payout ${id} not found`);
  _incgovCheckJ(j.status, INCGOV_PAYOUT_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = INCGOV_PAYOUT_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getIncgovPayoutV2(id) {
  const j = _incgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listIncgovPayoutsV2() {
  return [..._incgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleIncgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _incgovPsV2.values())
    if (
      p.status === INCGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _incgovIdleMs
    ) {
      p.status = INCGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckIncgovPayoutsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _incgovJsV2.values())
    if (
      j.status === INCGOV_PAYOUT_LIFECYCLE_V2.PROCESSING &&
      j.startedAt != null &&
      t - j.startedAt >= _incgovStuckMs
    ) {
      j.status = INCGOV_PAYOUT_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getTokenIncentiveGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(INCGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _incgovPsV2.values()) profilesByStatus[p.status]++;
  const payoutsByStatus = {};
  for (const v of Object.values(INCGOV_PAYOUT_LIFECYCLE_V2))
    payoutsByStatus[v] = 0;
  for (const j of _incgovJsV2.values()) payoutsByStatus[j.status]++;
  return {
    totalIncgovProfilesV2: _incgovPsV2.size,
    totalIncgovPayoutsV2: _incgovJsV2.size,
    maxActiveIncgovProfilesPerOwner: _incgovMaxActive,
    maxPendingIncgovPayoutsPerProfile: _incgovMaxPending,
    incgovProfileIdleMs: _incgovIdleMs,
    incgovPayoutStuckMs: _incgovStuckMs,
    profilesByStatus,
    payoutsByStatus,
  };
}
