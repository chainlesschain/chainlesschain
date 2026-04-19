/**
 * DAO Governance v2 — proposals, quadratic voting, delegation,
 * treasury management, and governance statistics.
 */

import crypto from "crypto";

/* ── Phase 92 canonical enums ─────────────────────────────── */

export const PROPOSAL_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  QUEUE: "queue",
  EXECUTE: "execute",
  PASSED: "passed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});

export const VOTE_TYPE = Object.freeze({
  FOR: "for",
  AGAINST: "against",
  ABSTAIN: "abstain",
});

export const DELEGATION_STATUS = Object.freeze({
  ACTIVE: "active",
  REVOKED: "revoked",
  EXPIRED: "expired",
});

export const TREASURY_TX_TYPE = Object.freeze({
  ALLOCATION: "allocation",
  WITHDRAWAL: "withdrawal",
  REFUND: "refund",
  REWARD: "reward",
  DEPOSIT: "deposit",
});

/* ── In-memory stores ──────────────────────────────────────── */
const _proposals = new Map();
const _votes = new Map();
const _delegations = new Map();
const _treasury = { balance: 0, allocations: [] };
// Phase 92: richer delegation records keyed by id
const _delegationsV2 = new Map();
// Phase 92: treasury transaction log with balance_after
const _treasuryTxs = [];

let _config = {
  votingPeriod: 604800000, // 7 days in ms
  quorum: 0.1, // 10%
  executionDelay: 86400000, // 1 day in ms
};

let _configV2 = {
  votingDurationMs: 604800000,
  quorumPercentage: 10,
  timelockMs: 172800000,
  quadraticEnabled: true,
  maxDelegationDepth: 3,
  proposalThreshold: 100,
  maxSingleAllocation: 100000,
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

/* ══════════════════════════════════════════════════════════════
 * Phase 92: DAO Governance 2.0 canonical surface
 * ──────────────────────────────────────────────────────────── */

/* ── Proposal lifecycle (Draft → Active → Queue → Execute) ─── */

export function createProposalV2(db, opts) {
  const {
    title,
    description,
    proposerDid,
    type = "standard",
    actions = [],
    votingDurationMs,
  } = opts || {};

  if (!title) throw new Error("Title is required");
  if (!proposerDid) throw new Error("proposerDid is required");

  const id = `prop-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();
  const duration = votingDurationMs ?? _configV2.votingDurationMs;

  const proposal = {
    id,
    title,
    description: description || "",
    proposer: proposerDid,
    proposerDid,
    type,
    status: PROPOSAL_STATUS.DRAFT,
    actions: Array.isArray(actions) ? actions : [],
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    quadraticWeightFor: 0,
    quadraticWeightAgainst: 0,
    votingType: "quadratic",
    votingDurationMs: duration,
    quorumReached: false,
    votingStart: null,
    votingEnd: null,
    queueEnd: null,
    executedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    endsAt: null,
  };

  _proposals.set(id, proposal);

  db.prepare(
    `INSERT INTO dao_v2_proposals (id, title, description, proposer, status, votes_for, votes_against, voting_type, created_at, ends_at, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    title,
    proposal.description,
    proposerDid,
    PROPOSAL_STATUS.DRAFT,
    0,
    0,
    "quadratic",
    now,
    null,
    null,
  );

  return proposal;
}

export function activateProposal(db, proposalId) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS.DRAFT) {
    throw new Error(
      `Only DRAFT proposals can be activated (current: ${proposal.status})`,
    );
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const endsAtIso = new Date(now + proposal.votingDurationMs).toISOString();

  proposal.status = PROPOSAL_STATUS.ACTIVE;
  proposal.votingStart = nowIso;
  proposal.votingEnd = endsAtIso;
  proposal.endsAt = endsAtIso;
  proposal.updatedAt = nowIso;

  db.prepare(
    `UPDATE dao_v2_proposals SET status = ?, ends_at = ? WHERE id = ?`,
  ).run(PROPOSAL_STATUS.ACTIVE, endsAtIso, proposalId);

  return proposal;
}

export function castVote(db, opts) {
  const { proposalId, voterDid, voteType, voteCount = 1, balance } = opts || {};

  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS.ACTIVE) {
    throw new Error(`Proposal is not ACTIVE (current: ${proposal.status})`);
  }
  if (!Object.values(VOTE_TYPE).includes(voteType)) {
    throw new Error(
      `Invalid voteType: ${voteType}. Must be one of: ${Object.values(VOTE_TYPE).join(", ")}`,
    );
  }
  if (typeof voteCount !== "number" || voteCount <= 0) {
    throw new Error("voteCount must be a positive number");
  }

  const quadraticCost = _configV2.quadraticEnabled
    ? voteCount * voteCount
    : voteCount;

  if (balance !== undefined && balance < quadraticCost) {
    throw new Error(
      `Insufficient balance: need ${quadraticCost}, have ${balance}`,
    );
  }

  // Anti-sybil: reject duplicate voter on same proposal
  for (const v of _votes.values()) {
    if (v.proposalId === proposalId && v.voterDid === voterDid) {
      throw new Error(`Voter ${voterDid} already voted on ${proposalId}`);
    }
  }

  const voteId = `vote-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  // Quadratic weight = voteCount (linear weight), but cost = n²
  if (voteType === VOTE_TYPE.FOR) {
    proposal.votesFor += voteCount;
    proposal.quadraticWeightFor += voteCount;
  } else if (voteType === VOTE_TYPE.AGAINST) {
    proposal.votesAgainst += voteCount;
    proposal.quadraticWeightAgainst += voteCount;
  } else {
    proposal.votesAbstain += voteCount;
  }

  const record = {
    id: voteId,
    proposalId,
    voter: voterDid,
    voterDid,
    voteType,
    voteCount,
    quadraticCost,
    weight: voteCount,
    direction: voteType,
    delegatedFrom: null,
    createdAt: now,
  };

  _votes.set(voteId, record);

  db.prepare(
    `INSERT INTO dao_v2_votes (id, proposal_id, voter, weight, direction, delegated_from, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(voteId, proposalId, voterDid, voteCount, voteType, null, now);

  db.prepare(
    `UPDATE dao_v2_proposals SET votes_for = ?, votes_against = ? WHERE id = ?`,
  ).run(proposal.votesFor, proposal.votesAgainst, proposalId);

  return record;
}

/* ── Delegation v2 (cycle-safe, depth-limited, revocable) ─── */

function _resolveDelegateChain(fromDid) {
  const chain = [];
  const visited = new Set();
  let cursor = fromDid;
  while (cursor) {
    if (visited.has(cursor)) return { cycle: true, chain };
    visited.add(cursor);
    const next = [..._delegationsV2.values()].find(
      (d) => d.fromDid === cursor && d.status === DELEGATION_STATUS.ACTIVE,
    );
    if (!next) break;
    chain.push(next);
    cursor = next.toDid;
  }
  return { cycle: false, chain };
}

export function delegateVotingPower(db, opts) {
  const { fromDid, toDid, weight = 1, expiresAt = null } = opts || {};

  if (!fromDid) throw new Error("fromDid is required");
  if (!toDid) throw new Error("toDid is required");
  if (fromDid === toDid) throw new Error("Cannot delegate to self");

  // Cycle detection: would toDid eventually delegate back to fromDid?
  const probe = _resolveDelegateChain(toDid);
  if (probe.cycle) {
    throw new Error("Delegation chain contains a cycle");
  }
  if (probe.chain.some((d) => d.toDid === fromDid)) {
    throw new Error("Cyclic delegation detected");
  }
  if (probe.chain.length + 1 > _configV2.maxDelegationDepth) {
    throw new Error(
      `Delegation depth exceeds maximum (${_configV2.maxDelegationDepth})`,
    );
  }

  const id = `deleg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  const record = {
    id,
    fromDid,
    toDid,
    weight,
    status: DELEGATION_STATUS.ACTIVE,
    expiresAt,
    revokedAt: null,
    createdAt: now,
  };

  _delegationsV2.set(id, record);

  // Also mirror to legacy Map for backward compatibility
  _delegations.set(fromDid, { delegator: fromDid, delegate: toDid, weight });

  db.prepare(
    `INSERT OR REPLACE INTO dao_v2_delegations (delegator, delegate, weight, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(fromDid, toDid, weight, now);

  return record;
}

export function revokeDelegation(db, fromDid) {
  let revoked = null;
  for (const d of _delegationsV2.values()) {
    if (d.fromDid === fromDid && d.status === DELEGATION_STATUS.ACTIVE) {
      d.status = DELEGATION_STATUS.REVOKED;
      d.revokedAt = new Date().toISOString();
      revoked = d;
    }
  }
  if (!revoked) throw new Error(`No active delegation from ${fromDid}`);
  _delegations.delete(fromDid);
  return revoked;
}

export function getActiveDelegations() {
  const now = new Date().toISOString();
  const out = [];
  for (const d of _delegationsV2.values()) {
    if (d.status !== DELEGATION_STATUS.ACTIVE) continue;
    if (d.expiresAt && d.expiresAt <= now) {
      d.status = DELEGATION_STATUS.EXPIRED;
      continue;
    }
    out.push(d);
  }
  return out;
}

/* ── Queue + Execute (timelock) ─────────────────────────────── */

function _isQuorumReached(proposal) {
  const total =
    proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain;
  if (total <= 0) return false;
  const requiredFor = (total * _configV2.quorumPercentage) / 100;
  return proposal.votesFor >= requiredFor;
}

export function queueProposal(db, proposalId) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS.ACTIVE) {
    throw new Error(
      `Only ACTIVE proposals can be queued (current: ${proposal.status})`,
    );
  }
  if (proposal.votesFor <= proposal.votesAgainst) {
    throw new Error("Proposal does not have majority support");
  }
  if (!_isQuorumReached(proposal)) {
    proposal.quorumReached = false;
    throw new Error("Quorum not reached");
  }

  const now = Date.now();
  proposal.quorumReached = true;
  proposal.status = PROPOSAL_STATUS.QUEUE;
  proposal.queueEnd = new Date(now + _configV2.timelockMs).toISOString();
  proposal.updatedAt = new Date(now).toISOString();

  db.prepare(`UPDATE dao_v2_proposals SET status = ? WHERE id = ?`).run(
    PROPOSAL_STATUS.QUEUE,
    proposalId,
  );

  return proposal;
}

export function executeProposalV2(db, proposalId) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS.QUEUE) {
    throw new Error(
      `Only QUEUED proposals can be executed (current: ${proposal.status})`,
    );
  }
  const now = Date.now();
  const queueEndMs = new Date(proposal.queueEnd).getTime();
  if (now < queueEndMs) {
    throw new Error(`Timelock not elapsed (ends at ${proposal.queueEnd})`);
  }

  proposal.status = PROPOSAL_STATUS.EXECUTE;
  proposal.executedAt = new Date(now).toISOString();
  proposal.updatedAt = proposal.executedAt;

  db.prepare(
    `UPDATE dao_v2_proposals SET status = ?, executed_at = ? WHERE id = ?`,
  ).run(PROPOSAL_STATUS.EXECUTE, proposal.executedAt, proposalId);

  return proposal;
}

export function cancelProposal(db, proposalId) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (
    proposal.status === PROPOSAL_STATUS.EXECUTE ||
    proposal.status === PROPOSAL_STATUS.CANCELLED
  ) {
    throw new Error(`Cannot cancel proposal in status: ${proposal.status}`);
  }
  const now = new Date().toISOString();
  proposal.status = PROPOSAL_STATUS.CANCELLED;
  proposal.cancelledAt = now;
  proposal.updatedAt = now;
  db.prepare(`UPDATE dao_v2_proposals SET status = ? WHERE id = ?`).run(
    PROPOSAL_STATUS.CANCELLED,
    proposalId,
  );
  return proposal;
}

/* ── Treasury v2 (proposal-linked, balance_after) ──────────── */

export function allocateFundsV2(db, opts) {
  const { proposalId, recipient, amount, asset = "native", memo } = opts || {};
  if (!proposalId) throw new Error("proposalId is required");
  if (!recipient) throw new Error("recipient is required");
  if (typeof amount !== "number" || amount <= 0) {
    throw new Error("amount must be a positive number");
  }
  if (amount > _configV2.maxSingleAllocation) {
    throw new Error(
      `Amount exceeds maxSingleAllocation (${_configV2.maxSingleAllocation})`,
    );
  }

  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS.EXECUTE) {
    throw new Error(
      `Allocation requires EXECUTED proposal (current: ${proposal.status})`,
    );
  }
  if (_treasury.balance < amount) {
    throw new Error("Insufficient treasury balance");
  }

  _treasury.balance -= amount;
  const balanceAfter = _treasury.balance;

  const id = `tx-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  const tx = {
    id,
    txType: TREASURY_TX_TYPE.ALLOCATION,
    proposalId,
    recipient,
    amount,
    asset,
    memo: memo || "",
    balanceAfter,
    createdAt: now,
  };

  _treasuryTxs.push(tx);
  _treasury.allocations.push({
    id,
    proposalId,
    amount,
    description: memo || "",
    date: now,
  });

  db.prepare(
    `INSERT INTO dao_v2_treasury (id, type, amount, description, proposal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, TREASURY_TX_TYPE.ALLOCATION, amount, memo || "", proposalId, now);

  return tx;
}

export function getTreasuryState() {
  const totalAllocated = _treasuryTxs
    .filter((t) => t.txType === TREASURY_TX_TYPE.ALLOCATION)
    .reduce((s, t) => s + t.amount, 0);
  return {
    balance: _treasury.balance,
    totalAllocated,
    transactions: [..._treasuryTxs],
    recentTxs: [..._treasuryTxs].slice(-10).reverse(),
    allocations: [..._treasury.allocations],
  };
}

/* ── Governance stats v2 ────────────────────────────────────── */

export function getGovernanceStatsV2(totalMembers = 0) {
  const all = [..._proposals.values()];
  const byStatus = {};
  for (const s of Object.values(PROPOSAL_STATUS)) byStatus[s] = 0;
  for (const p of all) byStatus[p.status] = (byStatus[p.status] || 0) + 1;

  const uniqueVoters = new Set([..._votes.values()].map((v) => v.voter));
  const participationRate =
    totalMembers > 0 ? uniqueVoters.size / totalMembers : 0;

  const activeDelegs = getActiveDelegations();
  const delegationCoverage =
    totalMembers > 0 ? activeDelegs.length / totalMembers : 0;

  return {
    totalProposals: all.length,
    byStatus,
    uniqueVoters: uniqueVoters.size,
    participationRate,
    activeDelegations: activeDelegs.length,
    delegationCoverage,
    treasuryBalance: _treasury.balance,
  };
}

/* ── Configuration v2 ───────────────────────────────────────── */

export function configureV2(updates = {}) {
  const allowed = [
    "votingDurationMs",
    "quorumPercentage",
    "timelockMs",
    "quadraticEnabled",
    "maxDelegationDepth",
    "proposalThreshold",
    "maxSingleAllocation",
  ];
  for (const key of allowed) {
    if (updates[key] !== undefined) _configV2[key] = updates[key];
  }
  return { ..._configV2 };
}

export function getConfigV2() {
  return { ..._configV2 };
}

/* ── Deposit v2 (mirror to tx log) ──────────────────────────── */

export function depositToTreasuryV2(db, opts) {
  const { amount, asset = "native", memo, depositorDid } = opts || {};
  if (typeof amount !== "number" || amount <= 0) {
    throw new Error("amount must be a positive number");
  }

  _treasury.balance += amount;
  const id = `tx-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const now = new Date().toISOString();

  const tx = {
    id,
    txType: TREASURY_TX_TYPE.DEPOSIT,
    proposalId: null,
    recipient: null,
    amount,
    asset,
    memo: memo || "",
    balanceAfter: _treasury.balance,
    depositorDid: depositorDid || null,
    createdAt: now,
  };

  _treasuryTxs.push(tx);

  db.prepare(
    `INSERT INTO dao_v2_treasury (id, type, amount, description, proposal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, TREASURY_TX_TYPE.DEPOSIT, amount, memo || "", null, now);

  return tx;
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _proposals.clear();
  _votes.clear();
  _delegations.clear();
  _delegationsV2.clear();
  _treasuryTxs.length = 0;
  _treasury.balance = 0;
  _treasury.allocations = [];
  _config = {
    votingPeriod: 604800000,
    quorum: 0.1,
    executionDelay: 86400000,
  };
  _configV2 = {
    votingDurationMs: 604800000,
    quorumPercentage: 10,
    timelockMs: 172800000,
    quadraticEnabled: true,
    maxDelegationDepth: 3,
    proposalThreshold: 100,
    maxSingleAllocation: 100000,
  };
}

// ===== V2 Surface: DAO Governance overlay (CLI v0.136.0) =====
export const DAO_ORG_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  DISSOLVED: "dissolved",
});
export const DAO_PROPOSAL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  VOTING: "voting",
  PASSED: "passed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _daoOrgTrans = new Map([
  [
    DAO_ORG_MATURITY_V2.PENDING,
    new Set([DAO_ORG_MATURITY_V2.ACTIVE, DAO_ORG_MATURITY_V2.DISSOLVED]),
  ],
  [
    DAO_ORG_MATURITY_V2.ACTIVE,
    new Set([DAO_ORG_MATURITY_V2.PAUSED, DAO_ORG_MATURITY_V2.DISSOLVED]),
  ],
  [
    DAO_ORG_MATURITY_V2.PAUSED,
    new Set([DAO_ORG_MATURITY_V2.ACTIVE, DAO_ORG_MATURITY_V2.DISSOLVED]),
  ],
  [DAO_ORG_MATURITY_V2.DISSOLVED, new Set()],
]);
const _daoOrgTerminal = new Set([DAO_ORG_MATURITY_V2.DISSOLVED]);
const _daoPropTrans = new Map([
  [
    DAO_PROPOSAL_LIFECYCLE_V2.QUEUED,
    new Set([
      DAO_PROPOSAL_LIFECYCLE_V2.VOTING,
      DAO_PROPOSAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    DAO_PROPOSAL_LIFECYCLE_V2.VOTING,
    new Set([
      DAO_PROPOSAL_LIFECYCLE_V2.PASSED,
      DAO_PROPOSAL_LIFECYCLE_V2.FAILED,
      DAO_PROPOSAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [DAO_PROPOSAL_LIFECYCLE_V2.PASSED, new Set()],
  [DAO_PROPOSAL_LIFECYCLE_V2.FAILED, new Set()],
  [DAO_PROPOSAL_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _daoOrgs = new Map();
const _daoProps = new Map();
let _daoMaxActivePerOwner = 8;
let _daoMaxPendingPerOrg = 50;
let _daoOrgIdleMs = 7 * 24 * 60 * 60 * 1000;
let _daoPropStuckMs = 2 * 60 * 1000;

function _daoPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveDaoOrgsPerOwnerV2(n) {
  _daoMaxActivePerOwner = _daoPos(n, "maxActiveDaoOrgsPerOwner");
}
export function getMaxActiveDaoOrgsPerOwnerV2() {
  return _daoMaxActivePerOwner;
}
export function setMaxPendingDaoProposalsPerOrgV2(n) {
  _daoMaxPendingPerOrg = _daoPos(n, "maxPendingDaoProposalsPerOrg");
}
export function getMaxPendingDaoProposalsPerOrgV2() {
  return _daoMaxPendingPerOrg;
}
export function setDaoOrgIdleMsV2(n) {
  _daoOrgIdleMs = _daoPos(n, "daoOrgIdleMs");
}
export function getDaoOrgIdleMsV2() {
  return _daoOrgIdleMs;
}
export function setDaoProposalStuckMsV2(n) {
  _daoPropStuckMs = _daoPos(n, "daoProposalStuckMs");
}
export function getDaoProposalStuckMsV2() {
  return _daoPropStuckMs;
}

export function _resetStateDaoGovernanceV2() {
  _daoOrgs.clear();
  _daoProps.clear();
  _daoMaxActivePerOwner = 8;
  _daoMaxPendingPerOrg = 50;
  _daoOrgIdleMs = 7 * 24 * 60 * 60 * 1000;
  _daoPropStuckMs = 2 * 60 * 1000;
}

export function registerDaoOrgV2({ id, owner, name, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_daoOrgs.has(id)) throw new Error(`dao org ${id} already registered`);
  const now = Date.now();
  const o = {
    id,
    owner,
    name: name || id,
    status: DAO_ORG_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    dissolvedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _daoOrgs.set(id, o);
  return { ...o, metadata: { ...o.metadata } };
}
function _daoCheckO(from, to) {
  const a = _daoOrgTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dao org transition ${from} → ${to}`);
}
function _daoCountActive(owner) {
  let n = 0;
  for (const o of _daoOrgs.values())
    if (o.owner === owner && o.status === DAO_ORG_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateDaoOrgV2(id) {
  const o = _daoOrgs.get(id);
  if (!o) throw new Error(`dao org ${id} not found`);
  _daoCheckO(o.status, DAO_ORG_MATURITY_V2.ACTIVE);
  const recovery = o.status === DAO_ORG_MATURITY_V2.PAUSED;
  if (!recovery) {
    const a = _daoCountActive(o.owner);
    if (a >= _daoMaxActivePerOwner)
      throw new Error(
        `max active dao orgs per owner (${_daoMaxActivePerOwner}) reached for ${o.owner}`,
      );
  }
  const now = Date.now();
  o.status = DAO_ORG_MATURITY_V2.ACTIVE;
  o.updatedAt = now;
  o.lastTouchedAt = now;
  if (!o.activatedAt) o.activatedAt = now;
  return { ...o, metadata: { ...o.metadata } };
}
export function pauseDaoOrgV2(id) {
  const o = _daoOrgs.get(id);
  if (!o) throw new Error(`dao org ${id} not found`);
  _daoCheckO(o.status, DAO_ORG_MATURITY_V2.PAUSED);
  o.status = DAO_ORG_MATURITY_V2.PAUSED;
  o.updatedAt = Date.now();
  return { ...o, metadata: { ...o.metadata } };
}
export function dissolveDaoOrgV2(id) {
  const o = _daoOrgs.get(id);
  if (!o) throw new Error(`dao org ${id} not found`);
  _daoCheckO(o.status, DAO_ORG_MATURITY_V2.DISSOLVED);
  const now = Date.now();
  o.status = DAO_ORG_MATURITY_V2.DISSOLVED;
  o.updatedAt = now;
  if (!o.dissolvedAt) o.dissolvedAt = now;
  return { ...o, metadata: { ...o.metadata } };
}
export function touchDaoOrgV2(id) {
  const o = _daoOrgs.get(id);
  if (!o) throw new Error(`dao org ${id} not found`);
  if (_daoOrgTerminal.has(o.status))
    throw new Error(`cannot touch terminal dao org ${id}`);
  const now = Date.now();
  o.lastTouchedAt = now;
  o.updatedAt = now;
  return { ...o, metadata: { ...o.metadata } };
}
export function getDaoOrgV2(id) {
  const o = _daoOrgs.get(id);
  if (!o) return null;
  return { ...o, metadata: { ...o.metadata } };
}
export function listDaoOrgsV2() {
  return [..._daoOrgs.values()].map((o) => ({
    ...o,
    metadata: { ...o.metadata },
  }));
}

function _daoCountPending(oid) {
  let n = 0;
  for (const p of _daoProps.values())
    if (
      p.orgId === oid &&
      (p.status === DAO_PROPOSAL_LIFECYCLE_V2.QUEUED ||
        p.status === DAO_PROPOSAL_LIFECYCLE_V2.VOTING)
    )
      n++;
  return n;
}

export function createDaoProposalV2({ id, orgId, title, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!orgId || typeof orgId !== "string") throw new Error("orgId is required");
  if (_daoProps.has(id)) throw new Error(`dao proposal ${id} already exists`);
  if (!_daoOrgs.has(orgId)) throw new Error(`dao org ${orgId} not found`);
  const pending = _daoCountPending(orgId);
  if (pending >= _daoMaxPendingPerOrg)
    throw new Error(
      `max pending dao proposals per org (${_daoMaxPendingPerOrg}) reached for ${orgId}`,
    );
  const now = Date.now();
  const p = {
    id,
    orgId,
    title: title || id,
    status: DAO_PROPOSAL_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _daoProps.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _daoCheckP(from, to) {
  const a = _daoPropTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid dao proposal transition ${from} → ${to}`);
}
export function startDaoProposalV2(id) {
  const p = _daoProps.get(id);
  if (!p) throw new Error(`dao proposal ${id} not found`);
  _daoCheckP(p.status, DAO_PROPOSAL_LIFECYCLE_V2.VOTING);
  const now = Date.now();
  p.status = DAO_PROPOSAL_LIFECYCLE_V2.VOTING;
  p.updatedAt = now;
  if (!p.startedAt) p.startedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function passDaoProposalV2(id) {
  const p = _daoProps.get(id);
  if (!p) throw new Error(`dao proposal ${id} not found`);
  _daoCheckP(p.status, DAO_PROPOSAL_LIFECYCLE_V2.PASSED);
  const now = Date.now();
  p.status = DAO_PROPOSAL_LIFECYCLE_V2.PASSED;
  p.updatedAt = now;
  if (!p.settledAt) p.settledAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function failDaoProposalV2(id, reason) {
  const p = _daoProps.get(id);
  if (!p) throw new Error(`dao proposal ${id} not found`);
  _daoCheckP(p.status, DAO_PROPOSAL_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  p.status = DAO_PROPOSAL_LIFECYCLE_V2.FAILED;
  p.updatedAt = now;
  if (!p.settledAt) p.settledAt = now;
  if (reason) p.metadata.failReason = String(reason);
  return { ...p, metadata: { ...p.metadata } };
}
export function cancelDaoProposalV2(id, reason) {
  const p = _daoProps.get(id);
  if (!p) throw new Error(`dao proposal ${id} not found`);
  _daoCheckP(p.status, DAO_PROPOSAL_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  p.status = DAO_PROPOSAL_LIFECYCLE_V2.CANCELLED;
  p.updatedAt = now;
  if (!p.settledAt) p.settledAt = now;
  if (reason) p.metadata.cancelReason = String(reason);
  return { ...p, metadata: { ...p.metadata } };
}
export function getDaoProposalV2(id) {
  const p = _daoProps.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listDaoProposalsV2() {
  return [..._daoProps.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

export function autoPauseIdleDaoOrgsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const o of _daoOrgs.values())
    if (
      o.status === DAO_ORG_MATURITY_V2.ACTIVE &&
      t - o.lastTouchedAt >= _daoOrgIdleMs
    ) {
      o.status = DAO_ORG_MATURITY_V2.PAUSED;
      o.updatedAt = t;
      flipped.push(o.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckDaoProposalsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _daoProps.values())
    if (
      p.status === DAO_PROPOSAL_LIFECYCLE_V2.VOTING &&
      p.startedAt != null &&
      t - p.startedAt >= _daoPropStuckMs
    ) {
      p.status = DAO_PROPOSAL_LIFECYCLE_V2.FAILED;
      p.updatedAt = t;
      if (!p.settledAt) p.settledAt = t;
      p.metadata.failReason = "auto-fail-stuck";
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}

export function getDaoGovernanceGovStatsV2() {
  const orgsByStatus = {};
  for (const s of Object.values(DAO_ORG_MATURITY_V2)) orgsByStatus[s] = 0;
  for (const o of _daoOrgs.values()) orgsByStatus[o.status]++;
  const proposalsByStatus = {};
  for (const s of Object.values(DAO_PROPOSAL_LIFECYCLE_V2))
    proposalsByStatus[s] = 0;
  for (const p of _daoProps.values()) proposalsByStatus[p.status]++;
  return {
    totalOrgsV2: _daoOrgs.size,
    totalProposalsV2: _daoProps.size,
    maxActiveDaoOrgsPerOwner: _daoMaxActivePerOwner,
    maxPendingDaoProposalsPerOrg: _daoMaxPendingPerOrg,
    daoOrgIdleMs: _daoOrgIdleMs,
    daoProposalStuckMs: _daoPropStuckMs,
    orgsByStatus,
    proposalsByStatus,
  };
}
