/**
 * EvoMap Governance — gene IP ownership, contribution tracing,
 * and governance proposals for the EvoMap ecosystem.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _ownerships = new Map();
const _proposals = new Map();

const PROPOSAL_STATUS = {
  DRAFT: "draft",
  ACTIVE: "active",
  PASSED: "passed",
  REJECTED: "rejected",
  EXECUTED: "executed",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureEvoMapGovernanceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gene_ownership (
      id TEXT PRIMARY KEY,
      gene_id TEXT NOT NULL,
      owner_did TEXT NOT NULL,
      originality_proof TEXT,
      derivation_chain TEXT,
      revenue_split TEXT,
      verified INTEGER DEFAULT 0,
      plagiarism_score REAL DEFAULT 0.0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evomap_governance_proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      proposer_did TEXT,
      type TEXT DEFAULT 'standard',
      status TEXT DEFAULT 'draft',
      votes_for INTEGER DEFAULT 0,
      votes_against INTEGER DEFAULT 0,
      quorum_reached INTEGER DEFAULT 0,
      voting_deadline TEXT,
      executed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Ownership Registration ───────────────────────────────── */

export function registerOwnership(db, geneId, ownerDid, opts = {}) {
  if (!geneId) throw new Error("Gene ID is required");
  if (!ownerDid) throw new Error("Owner DID is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const originalityProof = opts.originalityProof || {
    method: "did-vc",
    timestamp: now,
  };
  const revenueSplit = opts.revenueSplit || { [ownerDid]: 100 };
  const derivationChain = opts.derivationChain || [];

  const ownership = {
    id,
    geneId,
    ownerDid,
    originalityProof,
    derivationChain,
    revenueSplit,
    verified: 1,
    plagiarismScore: 0.0,
    createdAt: now,
  };

  _ownerships.set(id, ownership);

  db.prepare(
    `INSERT INTO gene_ownership (id, gene_id, owner_did, originality_proof, derivation_chain, revenue_split, verified, plagiarism_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    geneId,
    ownerDid,
    JSON.stringify(originalityProof),
    JSON.stringify(derivationChain),
    JSON.stringify(revenueSplit),
    1,
    0.0,
    now,
  );

  return ownership;
}

/* ── Ownership Tracing ────────────────────────────────────── */

export function traceOwnership(geneId) {
  if (!geneId) throw new Error("Gene ID is required");

  const entries = [..._ownerships.values()].filter((o) => o.geneId === geneId);
  if (entries.length === 0) {
    return {
      geneId,
      owner: null,
      contributors: [],
      derivationChain: [],
      revenueSplit: {},
    };
  }

  const latest = entries[entries.length - 1];
  const contributors = Object.keys(latest.revenueSplit);

  return {
    geneId,
    owner: latest.ownerDid,
    contributors,
    derivationChain: latest.derivationChain,
    revenueSplit: latest.revenueSplit,
  };
}

/* ── Governance Proposals ─────────────────────────────────── */

export function createGovernanceProposal(
  db,
  title,
  description,
  proposerDid,
  opts = {},
) {
  if (!title) throw new Error("Title is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const type = opts.type || "standard";
  const votingDurationMs = opts.votingDurationMs || 7 * 24 * 60 * 60 * 1000;
  const deadline = new Date(Date.now() + votingDurationMs).toISOString();

  const proposal = {
    id,
    title,
    description: description || "",
    proposerDid: proposerDid || "anonymous",
    type,
    status: PROPOSAL_STATUS.ACTIVE,
    votesFor: 0,
    votesAgainst: 0,
    quorumReached: false,
    votingDeadline: deadline,
    executedAt: null,
    createdAt: now,
  };

  _proposals.set(id, proposal);

  db.prepare(
    `INSERT INTO evomap_governance_proposals (id, title, description, proposer_did, type, status, votes_for, votes_against, quorum_reached, voting_deadline, executed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    proposal.title,
    proposal.description,
    proposal.proposerDid,
    proposal.type,
    proposal.status,
    0,
    0,
    0,
    deadline,
    null,
    now,
  );

  return proposal;
}

export function voteOnGovernanceProposal(db, proposalId, voterDid, vote) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS.ACTIVE) {
    throw new Error(`Proposal is not active: ${proposal.status}`);
  }
  if (vote !== "for" && vote !== "against") {
    throw new Error('Vote must be "for" or "against"');
  }

  if (vote === "for") {
    proposal.votesFor++;
  } else {
    proposal.votesAgainst++;
  }

  const totalVotes = proposal.votesFor + proposal.votesAgainst;

  // Check quorum (minimum 3 votes)
  if (totalVotes >= 3 && !proposal.quorumReached) {
    proposal.quorumReached = true;
    proposal.status =
      proposal.votesFor > proposal.votesAgainst
        ? PROPOSAL_STATUS.PASSED
        : PROPOSAL_STATUS.REJECTED;

    db.prepare(
      `UPDATE evomap_governance_proposals SET votes_for = ?, votes_against = ?, quorum_reached = ?, status = ? WHERE id = ?`,
    ).run(
      proposal.votesFor,
      proposal.votesAgainst,
      1,
      proposal.status,
      proposalId,
    );
  } else {
    db.prepare(
      `UPDATE evomap_governance_proposals SET votes_for = ?, votes_against = ? WHERE id = ?`,
    ).run(proposal.votesFor, proposal.votesAgainst, proposalId);
  }

  return {
    proposalId,
    vote,
    totalVotes,
    status: proposal.status,
  };
}

export function getGovernanceDashboard() {
  const all = [..._proposals.values()];
  return {
    totalProposals: all.length,
    active: all.filter((p) => p.status === PROPOSAL_STATUS.ACTIVE).length,
    passed: all.filter((p) => p.status === PROPOSAL_STATUS.PASSED).length,
    rejected: all.filter((p) => p.status === PROPOSAL_STATUS.REJECTED).length,
    executed: all.filter((p) => p.status === PROPOSAL_STATUS.EXECUTED).length,
  };
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _ownerships.clear();
  _proposals.clear();
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Canonical Surface (Phase 42 — EvoMap Advanced Governance)
 *   Strictly additive; legacy exports above remain unchanged.
 * ═══════════════════════════════════════════════════════════════ */

export const PROPOSAL_STATUS_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PASSED: "passed",
  REJECTED: "rejected",
  EXECUTED: "executed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

export const PROPOSAL_TYPE = Object.freeze({
  STANDARD: "standard",
  GENE_STANDARD: "gene_standard",
  CONFIG_CHANGE: "config_change",
  DISPUTE: "dispute",
  FUNDING: "funding",
});

export const VOTE_DIRECTION = Object.freeze({
  FOR: "for",
  AGAINST: "against",
  ABSTAIN: "abstain",
});

const _allowedProposalTransitions = new Map([
  ["draft", new Set(["active", "cancelled"])],
  ["active", new Set(["passed", "rejected", "expired", "cancelled"])],
  ["passed", new Set(["executed"])],
  ["rejected", new Set([])],
  ["executed", new Set([])],
  ["expired", new Set([])],
  ["cancelled", new Set([])],
]);

export function createGovernanceProposalV2(db, options = {}) {
  const {
    title,
    description,
    proposerDid,
    type,
    votingDurationMs,
    quorum,
    threshold,
  } = options;

  if (!title) throw new Error("Title is required");
  const proposalType = type || PROPOSAL_TYPE.STANDARD;
  if (!Object.values(PROPOSAL_TYPE).includes(proposalType)) {
    throw new Error(`Unknown proposal type: ${proposalType}`);
  }

  const quorumValue = typeof quorum === "number" ? quorum : 3;
  const thresholdValue = typeof threshold === "number" ? threshold : 0.5;
  if (quorumValue < 1) throw new Error("Quorum must be >= 1");
  if (thresholdValue <= 0 || thresholdValue > 1) {
    throw new Error("Threshold must be in (0, 1]");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const duration = votingDurationMs || 7 * 24 * 60 * 60 * 1000;
  const deadline = new Date(Date.now() + duration).toISOString();

  const proposal = {
    id,
    title,
    description: description || "",
    proposerDid: proposerDid || "anonymous",
    type: proposalType,
    status: PROPOSAL_STATUS_V2.ACTIVE,
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    weightFor: 0,
    weightAgainst: 0,
    weightAbstain: 0,
    quorum: quorumValue,
    threshold: thresholdValue,
    votingDeadline: deadline,
    executedAt: null,
    createdAt: now,
  };

  _proposals.set(id, proposal);

  db.prepare(
    `INSERT INTO evomap_governance_proposals (id, title, description, proposer_did, type, status, votes_for, votes_against, quorum_reached, voting_deadline, executed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    proposal.title,
    proposal.description,
    proposal.proposerDid,
    proposal.type,
    proposal.status,
    0,
    0,
    0,
    deadline,
    null,
    now,
  );

  return proposal;
}

export function castVoteV2(db, options = {}) {
  const { proposalId, voterDid, direction, weight } = options;
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS_V2.ACTIVE) {
    throw new Error(`Proposal is not active: ${proposal.status}`);
  }
  if (!Object.values(VOTE_DIRECTION).includes(direction)) {
    throw new Error(`Unknown vote direction: ${direction}`);
  }
  const weightValue = typeof weight === "number" ? weight : 1;
  if (weightValue <= 0) throw new Error("Vote weight must be positive");

  if (direction === VOTE_DIRECTION.FOR) {
    proposal.votesFor++;
    proposal.weightFor += weightValue;
  } else if (direction === VOTE_DIRECTION.AGAINST) {
    proposal.votesAgainst++;
    proposal.weightAgainst += weightValue;
  } else {
    proposal.votesAbstain++;
    proposal.weightAbstain += weightValue;
  }

  const totalVotes =
    proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain;
  const decisiveVotes = proposal.votesFor + proposal.votesAgainst;
  const decisiveWeight = proposal.weightFor + proposal.weightAgainst;

  if (totalVotes >= proposal.quorum) {
    const ratio =
      decisiveWeight === 0 ? 0 : proposal.weightFor / decisiveWeight;
    if (ratio >= proposal.threshold) {
      proposal.status = PROPOSAL_STATUS_V2.PASSED;
    } else {
      proposal.status = PROPOSAL_STATUS_V2.REJECTED;
    }

    db.prepare(
      `UPDATE evomap_governance_proposals SET votes_for = ?, votes_against = ?, quorum_reached = ?, status = ? WHERE id = ?`,
    ).run(
      proposal.votesFor,
      proposal.votesAgainst,
      1,
      proposal.status,
      proposalId,
    );
  } else {
    db.prepare(
      `UPDATE evomap_governance_proposals SET votes_for = ?, votes_against = ? WHERE id = ?`,
    ).run(proposal.votesFor, proposal.votesAgainst, proposalId);
  }

  return {
    proposalId,
    direction,
    weight: weightValue,
    totalVotes,
    decisiveVotes,
    status: proposal.status,
  };
}

export function setProposalStatus(db, proposalId, newStatus) {
  const proposal = _proposals.get(proposalId);
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  const validStatuses = Object.values(PROPOSAL_STATUS_V2);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Unknown proposal status: ${newStatus}`);
  }
  const allowed = _allowedProposalTransitions.get(proposal.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid proposal status transition: ${proposal.status} → ${newStatus}`,
    );
  }
  proposal.status = newStatus;
  if (newStatus === PROPOSAL_STATUS_V2.EXECUTED) {
    proposal.executedAt = new Date().toISOString();
  }
  db.prepare(
    `UPDATE evomap_governance_proposals SET status = ?, executed_at = ? WHERE id = ?`,
  ).run(newStatus, proposal.executedAt, proposalId);

  return { proposalId, status: newStatus };
}

export function executeProposal(db, proposalId) {
  return setProposalStatus(db, proposalId, PROPOSAL_STATUS_V2.EXECUTED);
}

export function cancelProposal(db, proposalId) {
  return setProposalStatus(db, proposalId, PROPOSAL_STATUS_V2.CANCELLED);
}

export function expireProposalsV2(db, now) {
  const cutoff = typeof now === "number" ? now : Date.now();
  const expired = [];
  for (const p of _proposals.values()) {
    if (p.status === PROPOSAL_STATUS_V2.ACTIVE) {
      const deadlineMs = new Date(p.votingDeadline).getTime();
      if (deadlineMs <= cutoff) {
        p.status = PROPOSAL_STATUS_V2.EXPIRED;
        expired.push(p.id);
        db.prepare(
          `UPDATE evomap_governance_proposals SET status = ? WHERE id = ?`,
        ).run(PROPOSAL_STATUS_V2.EXPIRED, p.id);
      }
    }
  }
  return { expiredCount: expired.length, expiredIds: expired };
}

export function listProposalsV2(db, filter = {}) {
  let proposals = [..._proposals.values()];
  if (filter.status) {
    proposals = proposals.filter((p) => p.status === filter.status);
  }
  if (filter.type) {
    proposals = proposals.filter((p) => p.type === filter.type);
  }
  if (filter.proposerDid) {
    proposals = proposals.filter((p) => p.proposerDid === filter.proposerDid);
  }
  const limit = filter.limit || 100;
  return proposals.slice(0, limit);
}

export function traceContributions(geneId) {
  return traceOwnership(geneId);
}

export function getGovernanceStatsV2() {
  const all = [..._proposals.values()];

  const byStatus = {};
  for (const status of Object.values(PROPOSAL_STATUS_V2)) {
    byStatus[status] = all.filter((p) => p.status === status).length;
  }

  const byType = {};
  for (const type of Object.values(PROPOSAL_TYPE)) {
    byType[type] = all.filter((p) => p.type === type).length;
  }

  const totalVotes = all.reduce(
    (s, p) => s + p.votesFor + p.votesAgainst + (p.votesAbstain || 0),
    0,
  );
  const totalWeight = all.reduce(
    (s, p) =>
      s + (p.weightFor || 0) + (p.weightAgainst || 0) + (p.weightAbstain || 0),
    0,
  );

  return {
    totalProposals: all.length,
    totalOwnerships: _ownerships.size,
    totalVotes,
    totalWeight,
    byStatus,
    byType,
  };
}
