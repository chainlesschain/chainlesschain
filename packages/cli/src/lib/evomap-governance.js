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

  const entries = [..._ownerships.values()].filter(
    (o) => o.geneId === geneId,
  );
  if (entries.length === 0) {
    return { geneId, owner: null, contributors: [], derivationChain: [], revenueSplit: {} };
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

export function createGovernanceProposal(db, title, description, proposerDid, opts = {}) {
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
    ).run(proposal.votesFor, proposal.votesAgainst, 1, proposal.status, proposalId);
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
