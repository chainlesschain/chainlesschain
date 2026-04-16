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
