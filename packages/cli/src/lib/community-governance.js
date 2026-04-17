/**
 * Community Governance — CLI port of Phase 54 AI社区治理系统
 * (docs/design/modules/26_社区治理系统.md).
 *
 * The Desktop build drives governance with LLM-powered impact analysis
 * (context engineering + Ollama), real-time vote prediction, and a
 * GovernancePage.vue with risk/benefit radar charts. The CLI can't host
 * LLM inference or interactive UI, so this port ships:
 *
 *   - ProposalStore: create/list/show/activate/close/expire.
 *   - VoteStore: cast/list per proposal (unique voter+proposal).
 *   - Tally: quorum + pass-threshold calculation.
 *   - Heuristic impact analysis: type-based risk/benefit scoring.
 *   - Heuristic vote prediction: extrapolation from current votes.
 *   - Catalogs: 4 proposal types, 5 statuses, 4 impact levels.
 *
 * What does NOT port: LLM-powered impact analysis (context engineering +
 * Ollama), real-time prediction updates, GovernancePage.vue, Pinia store.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const PROPOSAL_TYPES = Object.freeze({
  PARAMETER_CHANGE: Object.freeze({
    id: "parameter_change",
    name: "Parameter Change",
    description: "参数变更",
  }),
  FEATURE_REQUEST: Object.freeze({
    id: "feature_request",
    name: "Feature Request",
    description: "功能请求",
  }),
  POLICY_UPDATE: Object.freeze({
    id: "policy_update",
    name: "Policy Update",
    description: "策略更新",
  }),
  BUDGET_ALLOCATION: Object.freeze({
    id: "budget_allocation",
    name: "Budget Allocation",
    description: "预算分配",
  }),
});

export const PROPOSAL_STATUS = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PASSED: "passed",
  REJECTED: "rejected",
  EXPIRED: "expired",
});

export const IMPACT_LEVELS = Object.freeze({
  LOW: Object.freeze({ id: "low", name: "Low", description: "低影响" }),
  MEDIUM: Object.freeze({
    id: "medium",
    name: "Medium",
    description: "中等影响",
  }),
  HIGH: Object.freeze({ id: "high", name: "High", description: "高影响" }),
  CRITICAL: Object.freeze({
    id: "critical",
    name: "Critical",
    description: "关键影响",
  }),
});

export const VOTE_VALUES = Object.freeze(["yes", "no", "abstain"]);

// Default config (from design doc §6)
const DEFAULT_CONFIG = {
  votingDurationMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  quorumThreshold: 0.5,
  passThreshold: 0.6,
};

/* ── State ─────────────────────────────────────────────────── */

const _proposals = new Map(); // id → proposal
const _votes = new Map(); // id → vote
const _proposalVotes = new Map(); // proposalId → Set<voteId>
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureGovernanceTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_proposals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT DEFAULT 'feature_request',
      proposer_did TEXT,
      status TEXT DEFAULT 'draft',
      impact_level TEXT,
      impact_analysis TEXT,
      vote_yes INTEGER DEFAULT 0,
      vote_no INTEGER DEFAULT 0,
      vote_abstain INTEGER DEFAULT 0,
      voting_starts_at INTEGER,
      voting_ends_at INTEGER,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      voter_did TEXT NOT NULL,
      vote TEXT NOT NULL,
      reason TEXT,
      weight REAL DEFAULT 1.0,
      created_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_governance_proposals_status ON governance_proposals(status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_governance_proposals_type ON governance_proposals(type)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_governance_votes_proposal ON governance_votes(proposal_id)`,
  );
}

/* ── Catalogs ──────────────────────────────────────────────── */

export function listProposalTypes() {
  return Object.values(PROPOSAL_TYPES).map((t) => ({ ...t }));
}

export function listProposalStatuses() {
  return Object.values(PROPOSAL_STATUS).map((s) => s);
}

export function listImpactLevels() {
  return Object.values(IMPACT_LEVELS).map((l) => ({ ...l }));
}

function _strip(row) {
  const { _seq: _omit, ...rest } = row;
  void _omit;
  return rest;
}

/* ── Proposals ─────────────────────────────────────────────── */

function _persistProposal(db, proposal) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO governance_proposals
     (id, title, description, type, proposer_did, status, impact_level,
      impact_analysis, vote_yes, vote_no, vote_abstain,
      voting_starts_at, voting_ends_at, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    proposal.id,
    proposal.title,
    proposal.description || null,
    proposal.type,
    proposal.proposerDid || null,
    proposal.status,
    proposal.impactLevel || null,
    proposal.impactAnalysis ? JSON.stringify(proposal.impactAnalysis) : null,
    proposal.voteYes,
    proposal.voteNo,
    proposal.voteAbstain,
    proposal.votingStartsAt || null,
    proposal.votingEndsAt || null,
    proposal.metadata ? JSON.stringify(proposal.metadata) : null,
    proposal.createdAt,
  );
}

export function createProposal(db, config = {}) {
  const title = String(config.title || "").trim();
  if (!title) throw new Error("proposal title is required");

  const type = String(config.type || "feature_request");
  const validTypes = Object.values(PROPOSAL_TYPES).map((t) => t.id);
  if (!validTypes.includes(type)) {
    throw new Error(`Unknown proposal type: ${type}`);
  }

  const now = Number(config.now ?? Date.now());
  const id = config.id || crypto.randomUUID();

  if (_proposals.has(id)) {
    throw new Error(`Proposal already exists: ${id}`);
  }

  const proposal = {
    id,
    title,
    description: config.description || null,
    type,
    proposerDid: config.proposerDid || null,
    status: PROPOSAL_STATUS.DRAFT,
    impactLevel: null,
    impactAnalysis: null,
    voteYes: 0,
    voteNo: 0,
    voteAbstain: 0,
    votingStartsAt: null,
    votingEndsAt: null,
    metadata: config.metadata || null,
    createdAt: now,
    _seq: ++_seq,
  };
  _proposals.set(id, proposal);
  _proposalVotes.set(id, new Set());
  _persistProposal(db, proposal);
  return _strip(proposal);
}

export function getProposal(id) {
  const p = _proposals.get(String(id || ""));
  return p ? _strip(p) : null;
}

export function listProposals(options = {}) {
  const rows = Array.from(_proposals.values());
  let filtered = rows;
  if (options.status) {
    filtered = filtered.filter((p) => p.status === options.status);
  }
  if (options.type) {
    filtered = filtered.filter((p) => p.type === options.type);
  }
  if (options.proposerDid) {
    filtered = filtered.filter((p) => p.proposerDid === options.proposerDid);
  }
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  const limit =
    Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : filtered.length;
  return filtered.slice(0, limit).map(_strip);
}

export function activateProposal(db, id, options = {}) {
  const proposal = _proposals.get(String(id || ""));
  if (!proposal) throw new Error(`Proposal not found: ${id}`);
  if (proposal.status !== PROPOSAL_STATUS.DRAFT) {
    throw new Error(
      `Only draft proposals can be activated (current: ${proposal.status})`,
    );
  }
  const now = Number(options.now ?? Date.now());
  const durationMs = Number(
    options.durationMs ?? DEFAULT_CONFIG.votingDurationMs,
  );
  proposal.status = PROPOSAL_STATUS.ACTIVE;
  proposal.votingStartsAt = now;
  proposal.votingEndsAt = now + durationMs;
  _persistProposal(db, proposal);
  return _strip(proposal);
}

export function closeProposal(db, id, options = {}) {
  const proposal = _proposals.get(String(id || ""));
  if (!proposal) throw new Error(`Proposal not found: ${id}`);
  if (proposal.status !== PROPOSAL_STATUS.ACTIVE) {
    throw new Error(
      `Only active proposals can be closed (current: ${proposal.status})`,
    );
  }

  const quorum = options.quorum ?? DEFAULT_CONFIG.quorumThreshold;
  const threshold = options.threshold ?? DEFAULT_CONFIG.passThreshold;
  const totalVoters = options.totalVoters;

  const tally = tallyVotes(id, { quorum, threshold, totalVoters });
  proposal.status = tally.passed
    ? PROPOSAL_STATUS.PASSED
    : PROPOSAL_STATUS.REJECTED;
  _persistProposal(db, proposal);
  return { proposal: _strip(proposal), tally };
}

export function expireProposal(db, id) {
  const proposal = _proposals.get(String(id || ""));
  if (!proposal) throw new Error(`Proposal not found: ${id}`);
  if (
    proposal.status !== PROPOSAL_STATUS.DRAFT &&
    proposal.status !== PROPOSAL_STATUS.ACTIVE
  ) {
    throw new Error(
      `Cannot expire ${proposal.status} proposals (only draft/active)`,
    );
  }
  proposal.status = PROPOSAL_STATUS.EXPIRED;
  _persistProposal(db, proposal);
  return _strip(proposal);
}

/* ── Votes ─────────────────────────────────────────────────── */

function _persistVote(db, vote) {
  if (!db) return;
  db.prepare(
    `INSERT OR REPLACE INTO governance_votes
     (id, proposal_id, voter_did, vote, reason, weight, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    vote.id,
    vote.proposalId,
    vote.voterDid,
    vote.vote,
    vote.reason || null,
    vote.weight,
    vote.createdAt,
  );
}

export function castVote(db, proposalId, voterDid, voteValue, options = {}) {
  const proposal = _proposals.get(String(proposalId || ""));
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);
  if (proposal.status !== PROPOSAL_STATUS.ACTIVE) {
    throw new Error(
      `Can only vote on active proposals (current: ${proposal.status})`,
    );
  }
  voterDid = String(voterDid || "").trim();
  if (!voterDid) throw new Error("voter DID is required");
  if (!VOTE_VALUES.includes(voteValue)) {
    throw new Error(
      `Invalid vote: ${voteValue} (expected ${VOTE_VALUES.join(" | ")})`,
    );
  }

  const weight = Number(options.weight ?? 1.0);
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error("Vote weight must be a non-negative finite number");
  }

  // Check for duplicate voter on same proposal — replace previous vote
  const existingVotes = _proposalVotes.get(proposal.id) || new Set();
  for (const vid of existingVotes) {
    const existing = _votes.get(vid);
    if (existing && existing.voterDid === voterDid) {
      // Remove old vote counts
      _updateVoteCounts(proposal, existing.vote, existing.weight, -1);
      _votes.delete(vid);
      existingVotes.delete(vid);
      if (db) {
        db.prepare("DELETE FROM governance_votes WHERE id = ?").run(vid);
      }
      break;
    }
  }

  const now = Number(options.now ?? Date.now());
  const id = options.id || crypto.randomUUID();

  const vote = {
    id,
    proposalId: proposal.id,
    voterDid,
    vote: voteValue,
    reason: options.reason || null,
    weight,
    createdAt: now,
    _seq: ++_seq,
  };
  _votes.set(id, vote);
  existingVotes.add(id);
  _proposalVotes.set(proposal.id, existingVotes);

  _updateVoteCounts(proposal, voteValue, weight, 1);
  _persistProposal(db, proposal);
  _persistVote(db, vote);
  return _strip(vote);
}

function _updateVoteCounts(proposal, voteValue, weight, direction) {
  const delta = weight * direction;
  if (voteValue === "yes") proposal.voteYes += delta;
  else if (voteValue === "no") proposal.voteNo += delta;
  else if (voteValue === "abstain") proposal.voteAbstain += delta;
}

export function listVotes(proposalId, options = {}) {
  const ids = _proposalVotes.get(String(proposalId || "")) || new Set();
  const rows = Array.from(ids)
    .map((vid) => _votes.get(vid))
    .filter(Boolean);
  rows.sort((a, b) => b.createdAt - a.createdAt);
  const limit =
    Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : rows.length;
  return rows.slice(0, limit).map(_strip);
}

/* ── Tally ─────────────────────────────────────────────────── */

export function tallyVotes(proposalId, options = {}) {
  const proposal = _proposals.get(String(proposalId || ""));
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);

  const quorum = Number(options.quorum ?? DEFAULT_CONFIG.quorumThreshold);
  const threshold = Number(options.threshold ?? DEFAULT_CONFIG.passThreshold);
  const totalVoters = options.totalVoters;

  const voteIds = _proposalVotes.get(proposal.id) || new Set();
  const voteCount = voteIds.size;

  const yesWeight = proposal.voteYes;
  const noWeight = proposal.voteNo;
  const abstainWeight = proposal.voteAbstain;
  const totalWeight = yesWeight + noWeight + abstainWeight;

  // Quorum: based on totalVoters if provided, else just check there are votes
  let quorumMet;
  if (totalVoters !== undefined && totalVoters > 0) {
    quorumMet = voteCount / totalVoters >= quorum;
  } else {
    quorumMet = voteCount > 0;
  }

  // Pass threshold: yes / (yes + no), abstain excluded
  const decisiveWeight = yesWeight + noWeight;
  const yesRatio = decisiveWeight > 0 ? yesWeight / decisiveWeight : 0;
  const passed = quorumMet && yesRatio >= threshold;

  return {
    proposalId: proposal.id,
    voteCount,
    yesWeight,
    noWeight,
    abstainWeight,
    totalWeight,
    yesRatio: Math.round(yesRatio * 10000) / 10000,
    quorum,
    quorumMet,
    threshold,
    passed,
  };
}

/* ── Heuristic Impact Analysis ──────────────────────────────── */

// Risk/benefit heuristics per proposal type (no LLM needed).
const TYPE_RISK_MAP = {
  parameter_change: { riskBase: 0.3, benefitBase: 0.5, effort: "small" },
  feature_request: { riskBase: 0.4, benefitBase: 0.7, effort: "medium" },
  policy_update: { riskBase: 0.5, benefitBase: 0.6, effort: "medium" },
  budget_allocation: { riskBase: 0.6, benefitBase: 0.8, effort: "large" },
};

const HIGH_RISK_KEYWORDS = [
  "security",
  "delete",
  "remove",
  "migration",
  "breaking",
  "downtime",
  "encryption",
  "auth",
  "permission",
  "安全",
  "删除",
  "迁移",
  "停机",
  "加密",
  "权限",
];

const COMPONENT_KEYWORDS = {
  database: ["database", "db", "sql", "migration", "数据库", "迁移"],
  security: [
    "security",
    "auth",
    "encrypt",
    "permission",
    "安全",
    "加密",
    "权限",
  ],
  network: ["network", "p2p", "api", "endpoint", "网络", "接口"],
  ui: ["ui", "frontend", "page", "component", "界面", "前端", "页面"],
  ai: ["ai", "llm", "model", "embedding", "模型", "向量"],
  storage: ["storage", "file", "disk", "cache", "存储", "文件", "缓存"],
};

export function analyzeImpact(proposalId) {
  const proposal = _proposals.get(String(proposalId || ""));
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);

  const typeInfo =
    TYPE_RISK_MAP[proposal.type] || TYPE_RISK_MAP.feature_request;
  const text = `${proposal.title} ${proposal.description || ""}`.toLowerCase();

  // Risk boost from keywords
  let riskBoost = 0;
  for (const kw of HIGH_RISK_KEYWORDS) {
    if (text.includes(kw)) riskBoost += 0.08;
  }
  const riskScore = Math.min(1, typeInfo.riskBase + riskBoost);

  // Detect affected components
  const affectedComponents = [];
  for (const [component, keywords] of Object.entries(COMPONENT_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) {
      affectedComponents.push(component);
    }
  }
  if (affectedComponents.length === 0) affectedComponents.push("general");

  // Benefit scales with description length (more detail → higher confidence)
  const descLength = (proposal.description || "").length;
  const detailBonus = Math.min(0.15, descLength / 2000);
  const benefitScore = Math.min(1, typeInfo.benefitBase + detailBonus);

  // Impact level from risk score
  let impactLevel;
  if (riskScore >= 0.7) impactLevel = "critical";
  else if (riskScore >= 0.5) impactLevel = "high";
  else if (riskScore >= 0.3) impactLevel = "medium";
  else impactLevel = "low";

  const analysis = {
    impactLevel,
    affectedComponents,
    riskScore: Math.round(riskScore * 10000) / 10000,
    benefitScore: Math.round(benefitScore * 10000) / 10000,
    estimatedEffort: typeInfo.effort,
    communitySentiment: riskScore > 0.5 ? "cautious" : "positive",
    recommendations: _generateRecommendations(
      proposal,
      riskScore,
      affectedComponents,
    ),
    analyzedAt: Date.now(),
  };

  // Store analysis on the proposal
  proposal.impactLevel = impactLevel;
  proposal.impactAnalysis = analysis;
  return analysis;
}

function _generateRecommendations(proposal, riskScore, components) {
  const recs = [];
  if (riskScore >= 0.5) {
    recs.push("Consider a phased rollout to minimize risk");
  }
  if (components.includes("security")) {
    recs.push("Security review required before implementation");
  }
  if (components.includes("database")) {
    recs.push("Ensure database migration is reversible");
  }
  if (proposal.type === "budget_allocation") {
    recs.push("Include ROI projections in the proposal description");
  }
  if (recs.length === 0) {
    recs.push("Standard review process is sufficient");
  }
  return recs;
}

/* ── Heuristic Vote Prediction ──────────────────────────────── */

export function predictVote(proposalId) {
  const proposal = _proposals.get(String(proposalId || ""));
  if (!proposal) throw new Error(`Proposal not found: ${proposalId}`);

  const totalWeight = proposal.voteYes + proposal.voteNo + proposal.voteAbstain;

  if (totalWeight === 0) {
    // No votes yet — predict from impact analysis if available
    const analysis = proposal.impactAnalysis;
    const benefit = analysis ? analysis.benefitScore : 0.6;
    const risk = analysis ? analysis.riskScore : 0.4;
    const yesProb = benefit * 0.7 + (1 - risk) * 0.3;
    return {
      proposalId: proposal.id,
      predictedOutcome: yesProb >= 0.5 ? "pass" : "reject",
      confidence: 0.3, // Low confidence with no votes
      yesProb: Math.round(yesProb * 10000) / 10000,
      noProb: Math.round((1 - yesProb) * 10000) / 10000,
      abstainProb: 0,
      basedOn: "heuristic",
      sampleSize: 0,
    };
  }

  const yesPct = proposal.voteYes / totalWeight;
  const noPct = proposal.voteNo / totalWeight;
  const abstainPct = proposal.voteAbstain / totalWeight;

  // Confidence grows with sample size (log scale)
  const voteIds = _proposalVotes.get(proposal.id) || new Set();
  const sampleSize = voteIds.size;
  const confidence = Math.min(0.95, 0.3 + Math.log2(sampleSize + 1) * 0.15);

  const decisiveWeight = proposal.voteYes + proposal.voteNo;
  const yesRatio = decisiveWeight > 0 ? proposal.voteYes / decisiveWeight : 0;

  return {
    proposalId: proposal.id,
    predictedOutcome:
      yesRatio >= DEFAULT_CONFIG.passThreshold ? "pass" : "reject",
    confidence: Math.round(confidence * 10000) / 10000,
    yesProb: Math.round(yesPct * 10000) / 10000,
    noProb: Math.round(noPct * 10000) / 10000,
    abstainProb: Math.round(abstainPct * 10000) / 10000,
    basedOn: "votes",
    sampleSize,
  };
}

/* ── Stats ─────────────────────────────────────────────────── */

export function getGovernanceStats() {
  const proposals = Array.from(_proposals.values());
  const byStatus = {};
  for (const s of Object.values(PROPOSAL_STATUS)) byStatus[s] = 0;
  const byType = {};
  for (const t of Object.values(PROPOSAL_TYPES)) byType[t.id] = 0;
  for (const p of proposals) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byType[p.type] = (byType[p.type] || 0) + 1;
  }

  return {
    proposalCount: proposals.length,
    voteCount: _votes.size,
    byStatus,
    byType,
  };
}

/* ── Test Helpers ──────────────────────────────────────────── */

export function _resetState() {
  _proposals.clear();
  _votes.clear();
  _proposalVotes.clear();
  _seq = 0;
}
