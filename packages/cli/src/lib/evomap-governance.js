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

// =====================================================================
// evomap-governance V2 governance overlay (iter20)
// =====================================================================
export const EVGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const EVGOV_PROPOSAL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  REVIEWING: "reviewing",
  REVIEWED: "reviewed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _evgovPTrans = new Map([
  [
    EVGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      EVGOV_PROFILE_MATURITY_V2.ACTIVE,
      EVGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EVGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      EVGOV_PROFILE_MATURITY_V2.PAUSED,
      EVGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    EVGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      EVGOV_PROFILE_MATURITY_V2.ACTIVE,
      EVGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [EVGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _evgovPTerminal = new Set([EVGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _evgovJTrans = new Map([
  [
    EVGOV_PROPOSAL_LIFECYCLE_V2.QUEUED,
    new Set([
      EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWING,
      EVGOV_PROPOSAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWING,
    new Set([
      EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWED,
      EVGOV_PROPOSAL_LIFECYCLE_V2.FAILED,
      EVGOV_PROPOSAL_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWED, new Set()],
  [EVGOV_PROPOSAL_LIFECYCLE_V2.FAILED, new Set()],
  [EVGOV_PROPOSAL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _evgovPsV2 = new Map();
const _evgovJsV2 = new Map();
let _evgovMaxActive = 6,
  _evgovMaxPending = 15,
  _evgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _evgovStuckMs = 60 * 1000;
function _evgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _evgovCheckP(from, to) {
  const a = _evgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evgov profile transition ${from} → ${to}`);
}
function _evgovCheckJ(from, to) {
  const a = _evgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid evgov proposal transition ${from} → ${to}`);
}
function _evgovCountActive(owner) {
  let c = 0;
  for (const p of _evgovPsV2.values())
    if (p.owner === owner && p.status === EVGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _evgovCountPending(profileId) {
  let c = 0;
  for (const j of _evgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === EVGOV_PROPOSAL_LIFECYCLE_V2.QUEUED ||
        j.status === EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWING)
    )
      c++;
  return c;
}
export function setMaxActiveEvgovProfilesPerOwnerV2(n) {
  _evgovMaxActive = _evgovPos(n, "maxActiveEvgovProfilesPerOwner");
}
export function getMaxActiveEvgovProfilesPerOwnerV2() {
  return _evgovMaxActive;
}
export function setMaxPendingEvgovProposalsPerProfileV2(n) {
  _evgovMaxPending = _evgovPos(n, "maxPendingEvgovProposalsPerProfile");
}
export function getMaxPendingEvgovProposalsPerProfileV2() {
  return _evgovMaxPending;
}
export function setEvgovProfileIdleMsV2(n) {
  _evgovIdleMs = _evgovPos(n, "evgovProfileIdleMs");
}
export function getEvgovProfileIdleMsV2() {
  return _evgovIdleMs;
}
export function setEvgovProposalStuckMsV2(n) {
  _evgovStuckMs = _evgovPos(n, "evgovProposalStuckMs");
}
export function getEvgovProposalStuckMsV2() {
  return _evgovStuckMs;
}
export function _resetStateEvomapGovernanceGovV2() {
  _evgovPsV2.clear();
  _evgovJsV2.clear();
  _evgovMaxActive = 6;
  _evgovMaxPending = 15;
  _evgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _evgovStuckMs = 60 * 1000;
}
export function registerEvgovProfileV2({ id, owner, lane, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_evgovPsV2.has(id)) throw new Error(`evgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    lane: lane || "core",
    status: EVGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _evgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateEvgovProfileV2(id) {
  const p = _evgovPsV2.get(id);
  if (!p) throw new Error(`evgov profile ${id} not found`);
  const isInitial = p.status === EVGOV_PROFILE_MATURITY_V2.PENDING;
  _evgovCheckP(p.status, EVGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _evgovCountActive(p.owner) >= _evgovMaxActive)
    throw new Error(`max active evgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = EVGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseEvgovProfileV2(id) {
  const p = _evgovPsV2.get(id);
  if (!p) throw new Error(`evgov profile ${id} not found`);
  _evgovCheckP(p.status, EVGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = EVGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveEvgovProfileV2(id) {
  const p = _evgovPsV2.get(id);
  if (!p) throw new Error(`evgov profile ${id} not found`);
  _evgovCheckP(p.status, EVGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = EVGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchEvgovProfileV2(id) {
  const p = _evgovPsV2.get(id);
  if (!p) throw new Error(`evgov profile ${id} not found`);
  if (_evgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal evgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getEvgovProfileV2(id) {
  const p = _evgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listEvgovProfilesV2() {
  return [..._evgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createEvgovProposalV2({ id, profileId, topic, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_evgovJsV2.has(id))
    throw new Error(`evgov proposal ${id} already exists`);
  if (!_evgovPsV2.has(profileId))
    throw new Error(`evgov profile ${profileId} not found`);
  if (_evgovCountPending(profileId) >= _evgovMaxPending)
    throw new Error(
      `max pending evgov proposals for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    topic: topic || "",
    status: EVGOV_PROPOSAL_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _evgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function reviewingEvgovProposalV2(id) {
  const j = _evgovJsV2.get(id);
  if (!j) throw new Error(`evgov proposal ${id} not found`);
  _evgovCheckJ(j.status, EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWING);
  const now = Date.now();
  j.status = EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeProposalEvgovV2(id) {
  const j = _evgovJsV2.get(id);
  if (!j) throw new Error(`evgov proposal ${id} not found`);
  _evgovCheckJ(j.status, EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWED);
  const now = Date.now();
  j.status = EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failEvgovProposalV2(id, reason) {
  const j = _evgovJsV2.get(id);
  if (!j) throw new Error(`evgov proposal ${id} not found`);
  _evgovCheckJ(j.status, EVGOV_PROPOSAL_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = EVGOV_PROPOSAL_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelEvgovProposalV2(id, reason) {
  const j = _evgovJsV2.get(id);
  if (!j) throw new Error(`evgov proposal ${id} not found`);
  _evgovCheckJ(j.status, EVGOV_PROPOSAL_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = EVGOV_PROPOSAL_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getEvgovProposalV2(id) {
  const j = _evgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listEvgovProposalsV2() {
  return [..._evgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleEvgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _evgovPsV2.values())
    if (
      p.status === EVGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _evgovIdleMs
    ) {
      p.status = EVGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckEvgovProposalsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _evgovJsV2.values())
    if (
      j.status === EVGOV_PROPOSAL_LIFECYCLE_V2.REVIEWING &&
      j.startedAt != null &&
      t - j.startedAt >= _evgovStuckMs
    ) {
      j.status = EVGOV_PROPOSAL_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getEvomapGovernanceGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(EVGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _evgovPsV2.values()) profilesByStatus[p.status]++;
  const proposalsByStatus = {};
  for (const v of Object.values(EVGOV_PROPOSAL_LIFECYCLE_V2))
    proposalsByStatus[v] = 0;
  for (const j of _evgovJsV2.values()) proposalsByStatus[j.status]++;
  return {
    totalEvgovProfilesV2: _evgovPsV2.size,
    totalEvgovProposalsV2: _evgovJsV2.size,
    maxActiveEvgovProfilesPerOwner: _evgovMaxActive,
    maxPendingEvgovProposalsPerProfile: _evgovMaxPending,
    evgovProfileIdleMs: _evgovIdleMs,
    evgovProposalStuckMs: _evgovStuckMs,
    profilesByStatus,
    proposalsByStatus,
  };
}
