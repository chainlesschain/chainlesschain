/**
 * DAO Governance v2 — proposals, quadratic voting, delegation,
 * treasury management, and governance statistics.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _proposals = new Map();
const _votes = new Map();
const _delegations = new Map();
const _treasury = { balance: 0, allocations: [] };

let _config = {
  votingPeriod: 604800000, // 7 days in ms
  quorum: 0.1, // 10%
  executionDelay: 86400000, // 1 day in ms
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureDAOv2Tables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dao_v2_proposals (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      proposer TEXT,
      status TEXT DEFAULT 'draft',
      votes_for REAL DEFAULT 0,
      votes_against REAL DEFAULT 0,
      voting_type TEXT DEFAULT 'simple',
      created_at TEXT DEFAULT (datetime('now')),
      ends_at TEXT,
      executed_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dao_v2_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT,
      voter TEXT,
      weight REAL,
      direction TEXT,
      delegated_from TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dao_v2_treasury (
      id TEXT PRIMARY KEY,
      type TEXT,
      amount REAL,
      description TEXT,
      proposal_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dao_v2_delegations (
      delegator TEXT PRIMARY KEY,
      delegate TEXT,
      weight REAL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Proposals ─────────────────────────────────────────────── */

export function propose(db, title, description, proposer, options = {}) {
  if (!title) throw new Error("Title is required");
  if (!proposer) throw new Error("Proposer is required");

  const id = `prop-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const votingType = options.votingType || "simple";
  const endsAt = new Date(Date.now() + _config.votingPeriod).toISOString();

  const proposal = {
    id,
    title,
    description: description || "",
    proposer,
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votingType,
    createdAt: now,
    endsAt,
    executedAt: null,
  };

  _proposals.set(id, proposal);

  db.prepare(
    `INSERT INTO dao_v2_proposals (id, title, description, proposer, status, votes_for, votes_against, voting_type, created_at, ends_at, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    proposal.title,
    proposal.description,
    proposal.proposer,
    proposal.status,
    0,
    0,
    votingType,
    now,
    endsAt,
    null,
  );

  return proposal;
}

/* ── Voting ────────────────────────────────────────────────── */

export function vote(db, proposalId, voter, direction, weight = 1) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== "active") {
    throw new Error(`Proposal is not active: ${proposal.status}`);
  }
  if (direction !== "for" && direction !== "against") {
    throw new Error('Direction must be "for" or "against"');
  }

  // Quadratic voting: effective weight = sqrt(weight)
  const effectiveWeight =
    proposal.votingType === "quadratic" ? Math.sqrt(weight) : weight;

  const voteId = `vote-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  if (direction === "for") {
    proposal.votesFor += effectiveWeight;
  } else {
    proposal.votesAgainst += effectiveWeight;
  }

  const voteRecord = {
    id: voteId,
    proposalId,
    voter,
    weight: effectiveWeight,
    direction,
    delegatedFrom: null,
    createdAt: now,
  };

  _votes.set(voteId, voteRecord);

  db.prepare(
    `INSERT INTO dao_v2_votes (id, proposal_id, voter, weight, direction, delegated_from, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(voteId, proposalId, voter, effectiveWeight, direction, null, now);

  db.prepare(
    `UPDATE dao_v2_proposals SET votes_for = ?, votes_against = ? WHERE id = ?`,
  ).run(proposal.votesFor, proposal.votesAgainst, proposalId);

  return { voteId, proposalId, weight: effectiveWeight, direction };
}

/* ── Delegation ────────────────────────────────────────────── */

export function delegate(db, delegator, delegateTo, weight = 1) {
  if (!delegator) throw new Error("Delegator is required");
  if (!delegateTo) throw new Error("Delegate is required");

  const now = new Date().toISOString();

  _delegations.set(delegator, { delegator, delegate: delegateTo, weight });

  db.prepare(
    `INSERT OR REPLACE INTO dao_v2_delegations (delegator, delegate, weight, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(delegator, delegateTo, weight, now);

  return { delegator, delegate: delegateTo, weight };
}

/* ── Execution ─────────────────────────────────────────────── */

export function execute(db, proposalId) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.votesFor <= proposal.votesAgainst) {
    throw new Error(
      "Proposal has not passed (votesFor must exceed votesAgainst)",
    );
  }

  const now = new Date().toISOString();
  proposal.status = "executed";
  proposal.executedAt = now;

  db.prepare(
    `UPDATE dao_v2_proposals SET status = ?, executed_at = ? WHERE id = ?`,
  ).run("executed", now, proposalId);

  return { proposalId, status: "executed" };
}

/* ── Treasury ──────────────────────────────────────────────── */

export function getTreasury() {
  return {
    balance: _treasury.balance,
    allocations: [..._treasury.allocations],
  };
}

export function allocate(db, proposalId, amount, description) {
  if (!proposalId) throw new Error("Proposal ID is required");
  if (amount <= 0) throw new Error("Amount must be positive");
  if (_treasury.balance < amount) {
    throw new Error("Insufficient treasury balance");
  }

  const id = `alloc-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  _treasury.balance -= amount;

  const allocation = {
    id,
    proposalId,
    amount,
    description: description || "",
    date: now,
  };
  _treasury.allocations.push(allocation);

  db.prepare(
    `INSERT INTO dao_v2_treasury (id, type, amount, description, proposal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, "allocation", amount, description || "", proposalId, now);

  return allocation;
}

export function depositToTreasury(db, amount, description) {
  if (amount <= 0) throw new Error("Amount must be positive");

  const id = `dep-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  _treasury.balance += amount;

  db.prepare(
    `INSERT INTO dao_v2_treasury (id, type, amount, description, proposal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, "deposit", amount, description || "", null, now);

  return { id, amount, balance: _treasury.balance };
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getStats() {
  const all = [..._proposals.values()];
  return {
    totalProposals: all.length,
    active: all.filter((p) => p.status === "active").length,
    executed: all.filter((p) => p.status === "executed").length,
    delegations: _delegations.size,
    treasury: _treasury.balance,
  };
}

/* ── Configuration ─────────────────────────────────────────── */

export function configure(config) {
  if (config.votingPeriod !== undefined)
    _config.votingPeriod = config.votingPeriod;
  if (config.quorum !== undefined) _config.quorum = config.quorum;
  if (config.executionDelay !== undefined)
    _config.executionDelay = config.executionDelay;
  return { ..._config };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _proposals.clear();
  _votes.clear();
  _delegations.clear();
  _treasury.balance = 0;
  _treasury.allocations = [];
  _config = {
    votingPeriod: 604800000,
    quorum: 0.1,
    executionDelay: 86400000,
  };
}
