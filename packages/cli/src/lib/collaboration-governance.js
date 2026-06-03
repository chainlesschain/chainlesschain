/**
 * Collaboration Governance — CLI port of Phase 64
 * (docs/design/modules/36_协作治理系统.md).
 *
 * The Desktop build drives long-running multi-agent coordination: raft/pbft
 * consensus over P2P, ML-based auto-merge, real-time quality monitoring.
 * The CLI can't host the P2P layer or the live agent mesh, so this port
 * ships the tractable scaffolding:
 *
 *   - Governance decisions with voting (quorum/threshold tally) +
 *     SQLite persistence.
 *   - Per-agent autonomy-level + permission tier management.
 *   - Pure-function task assignment helpers (skill match, load balance,
 *     priority score, optimize assignment).
 *   - Catalogs: decision types, conflict strategies, quality metrics,
 *     priority levels, permission tiers.
 *
 * Raft/PBFT/Paxos consensus, real-time quality monitoring and ML-driven
 * auto-merge rules are Desktop-only.
 */

import crypto from "crypto";

/* ── Constants ─────────────────────────────────────────────── */

export const DECISION_TYPES = Object.freeze({
  TASK_ASSIGNMENT: "task_assignment",
  RESOURCE_ALLOCATION: "resource_allocation",
  CONFLICT_RESOLUTION: "conflict_resolution",
  POLICY_UPDATE: "policy_update",
  AUTONOMY_LEVEL: "autonomy_level",
});

export const DECISION_STATUS = Object.freeze({
  PENDING: "pending",
  VOTING: "voting",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXECUTED: "executed",
});

export const CONFLICT_STRATEGIES = Object.freeze({
  VOTING: {
    name: "voting",
    types: ["majority", "weighted", "unanimous"],
  },
  ARBITRATION: {
    name: "arbitration",
    types: ["expert", "senior_agent", "human"],
  },
  CONSENSUS: {
    name: "consensus",
    algorithms: ["raft", "pbft", "paxos"],
  },
  AUTO_MERGE: {
    name: "auto_merge",
    rules: ["rule_based", "ml_based"],
  },
});

export const QUALITY_METRICS = Object.freeze({
  CODE_QUALITY: "code_quality",
  COMMUNICATION_EFFICIENCY: "communication_efficiency",
  TASK_COMPLETION_RATE: "task_completion_rate",
  COLLABORATION_SATISFACTION: "collaboration_satisfaction",
  CONFLICT_RESOLUTION_TIME: "conflict_resolution_time",
});

export const PRIORITY_LEVELS = Object.freeze({
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  TRIVIAL: 1,
});

export const PERMISSION_TIERS = Object.freeze({
  L0: ["read", "suggest"],
  L1: ["read", "suggest", "write_simple"],
  L2: ["read", "suggest", "write", "refactor", "test"],
  L3: ["read", "suggest", "write", "refactor", "test", "design", "review"],
  L4: ["all"],
});

const VALID_DECISION_TYPES = new Set(Object.values(DECISION_TYPES));
const VALID_DECISION_STATUS = new Set(Object.values(DECISION_STATUS));
const VALID_VOTES = new Set(["approve", "reject", "abstain"]);
const VALID_LEVELS = new Set([0, 1, 2, 3, 4]);

/* ── State ─────────────────────────────────────────────────── */

const _decisions = new Map();
const _agentLevels = new Map();
let _seq = 0;

/* ── Schema ────────────────────────────────────────────────── */

export function ensureGovernanceTables(db) {
  if (!db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_decisions (
      decision_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      proposal TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      votes TEXT,
      resolution TEXT,
      executed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS autonomy_levels (
      agent_id TEXT PRIMARY KEY,
      current_level INTEGER NOT NULL,
      permissions TEXT NOT NULL,
      adjustment_history TEXT,
      last_review_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_governance_decisions_status ON governance_decisions(status)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_governance_decisions_type ON governance_decisions(type)`,
  );
}

/* ── Catalogs ──────────────────────────────────────────────── */

export function listDecisionTypes() {
  return Object.values(DECISION_TYPES);
}

export function listConflictStrategies() {
  return Object.values(CONFLICT_STRATEGIES);
}

export function listQualityMetrics() {
  return Object.values(QUALITY_METRICS);
}

export function listPriorityLevels() {
  return Object.entries(PRIORITY_LEVELS).map(([name, value]) => ({
    name,
    value,
  }));
}

export function listPermissionTiers() {
  return Object.entries(PERMISSION_TIERS).map(([tier, permissions]) => ({
    tier,
    level: Number(tier.slice(1)),
    permissions: [...permissions],
  }));
}

function _strip(row) {
  const { _seq: _omit, ...rest } = row;
  void _omit;
  return rest;
}

/* ── Decisions ─────────────────────────────────────────────── */

export function createDecision(db, config = {}) {
  const type = String(config.type || "").toLowerCase();
  if (!VALID_DECISION_TYPES.has(type)) {
    throw new Error(
      `Unknown decision type: ${config.type} (known: ${[...VALID_DECISION_TYPES].join("/")})`,
    );
  }
  const proposal = String(config.proposal || "").trim();
  if (!proposal) throw new Error("proposal is required");

  const now = Number(config.now ?? Date.now());
  const decisionId = config.decisionId || crypto.randomUUID();
  const decision = {
    decisionId,
    type,
    proposal,
    status: DECISION_STATUS.PENDING,
    votes: {},
    resolution: null,
    executedAt: null,
    createdAt: now,
    updatedAt: now,
    _seq: ++_seq,
  };
  _decisions.set(decisionId, decision);

  if (db) {
    db.prepare(
      `INSERT INTO governance_decisions (decision_id, type, proposal, status, votes, resolution, executed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      decisionId,
      type,
      proposal,
      decision.status,
      JSON.stringify(decision.votes),
      null,
      null,
      now,
      now,
    );
  }

  return _strip(decision);
}

export function getDecision(decisionId) {
  const d = _decisions.get(decisionId);
  return d ? _strip(d) : null;
}

export function listDecisions(opts = {}) {
  let rows = [..._decisions.values()];
  if (opts.type) {
    const t = String(opts.type).toLowerCase();
    rows = rows.filter((d) => d.type === t);
  }
  if (opts.status) {
    const s = String(opts.status).toLowerCase();
    if (!VALID_DECISION_STATUS.has(s)) {
      throw new Error(`Unknown status: ${opts.status}`);
    }
    rows = rows.filter((d) => d.status === s);
  }
  rows.sort((a, b) => b.createdAt - a.createdAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

function _mustGet(decisionId) {
  const d = _decisions.get(decisionId);
  if (!d) throw new Error(`Decision not found: ${decisionId}`);
  return d;
}

function _persistDecision(db, decisionId, fields) {
  if (!db) return;
  const setClauses = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = Object.values(fields).map((v) =>
    v && typeof v === "object" ? JSON.stringify(v) : v,
  );
  db.prepare(
    `UPDATE governance_decisions SET ${setClauses} WHERE decision_id = ?`,
  ).run(...values, decisionId);
}

export function vote(db, decisionId, agentId, voteValue, reason = "") {
  const decision = _mustGet(decisionId);
  if (
    decision.status !== DECISION_STATUS.PENDING &&
    decision.status !== DECISION_STATUS.VOTING
  ) {
    throw new Error(`Cannot vote on ${decision.status} decision`);
  }
  const normalizedVote = String(voteValue || "").toLowerCase();
  if (!VALID_VOTES.has(normalizedVote)) {
    throw new Error(
      `Invalid vote: ${voteValue} (must be approve|reject|abstain)`,
    );
  }
  const aid = String(agentId || "").trim();
  if (!aid) throw new Error("agentId is required");

  const now = Date.now();
  decision.votes[aid] = { vote: normalizedVote, reason, votedAt: now };
  decision.status = DECISION_STATUS.VOTING;
  decision.updatedAt = now;

  _persistDecision(db, decisionId, {
    votes: decision.votes,
    status: decision.status,
    updated_at: now,
  });

  return _strip(decision);
}

export function tallyDecision(db, decisionId, opts = {}) {
  const decision = _mustGet(decisionId);
  if (
    decision.status !== DECISION_STATUS.PENDING &&
    decision.status !== DECISION_STATUS.VOTING
  ) {
    throw new Error(`Cannot tally ${decision.status} decision`);
  }

  const quorum = opts.quorum ?? 0.5;
  const threshold = opts.threshold ?? 0.6;
  const totalVoters = opts.totalVoters ?? Object.keys(decision.votes).length;

  const tallied = { approve: 0, reject: 0, abstain: 0 };
  for (const v of Object.values(decision.votes)) {
    if (tallied[v.vote] != null) tallied[v.vote]++;
  }
  const participation =
    totalVoters > 0
      ? (tallied.approve + tallied.reject + tallied.abstain) / totalVoters
      : 0;
  const effectiveVotes = tallied.approve + tallied.reject;
  const approvalRate =
    effectiveVotes > 0 ? tallied.approve / effectiveVotes : 0;

  let nextStatus;
  let outcome;
  if (participation < quorum) {
    nextStatus = DECISION_STATUS.REJECTED;
    outcome = `quorum not met (${(participation * 100).toFixed(1)}% < ${(quorum * 100).toFixed(0)}%)`;
  } else if (approvalRate >= threshold) {
    nextStatus = DECISION_STATUS.APPROVED;
    outcome = `approved (${(approvalRate * 100).toFixed(1)}% ≥ ${(threshold * 100).toFixed(0)}%)`;
  } else {
    nextStatus = DECISION_STATUS.REJECTED;
    outcome = `rejected (${(approvalRate * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%)`;
  }

  const now = Date.now();
  const resolution = {
    tally: tallied,
    totalVoters,
    participation: Number(participation.toFixed(3)),
    approvalRate: Number(approvalRate.toFixed(3)),
    quorum,
    threshold,
    outcome,
    tallyAt: now,
  };
  decision.status = nextStatus;
  decision.resolution = resolution;
  decision.updatedAt = now;

  _persistDecision(db, decisionId, {
    status: nextStatus,
    resolution,
    updated_at: now,
  });

  return _strip(decision);
}

export function markExecuted(db, decisionId) {
  const decision = _mustGet(decisionId);
  if (decision.status !== DECISION_STATUS.APPROVED) {
    throw new Error(
      `Can only execute approved decisions (status=${decision.status})`,
    );
  }
  const now = Date.now();
  decision.status = DECISION_STATUS.EXECUTED;
  decision.executedAt = now;
  decision.updatedAt = now;

  _persistDecision(db, decisionId, {
    status: decision.status,
    executed_at: now,
    updated_at: now,
  });

  return _strip(decision);
}

/* ── Agent autonomy levels ─────────────────────────────────── */

export function setAutonomyLevel(db, agentId, level, opts = {}) {
  const aid = String(agentId || "").trim();
  if (!aid) throw new Error("agentId is required");
  const lvl = Number(level);
  if (!VALID_LEVELS.has(lvl)) {
    throw new Error(`Invalid autonomy level: ${level} (must be 0..4)`);
  }
  const permissions = PERMISSION_TIERS[`L${lvl}`];
  const now = Number(opts.now ?? Date.now());

  const existing = _agentLevels.get(aid);
  const history = existing?.adjustmentHistory || [];
  history.push({
    level: lvl,
    reason: opts.reason || "",
    adjustedAt: now,
  });

  const record = {
    agentId: aid,
    currentLevel: lvl,
    permissions: [...permissions],
    adjustmentHistory: history,
    lastReviewAt: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    _seq: ++_seq,
  };
  _agentLevels.set(aid, record);

  if (db) {
    if (existing) {
      db.prepare(
        `UPDATE autonomy_levels SET current_level = ?, permissions = ?, adjustment_history = ?, last_review_at = ?, updated_at = ? WHERE agent_id = ?`,
      ).run(
        lvl,
        JSON.stringify(record.permissions),
        JSON.stringify(history),
        now,
        now,
        aid,
      );
    } else {
      db.prepare(
        `INSERT INTO autonomy_levels (agent_id, current_level, permissions, adjustment_history, last_review_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        aid,
        lvl,
        JSON.stringify(record.permissions),
        JSON.stringify(history),
        now,
        now,
        now,
      );
    }
  }

  return _strip(record);
}

export function getAutonomyLevel(agentId) {
  const r = _agentLevels.get(agentId);
  return r ? _strip(r) : null;
}

export function listAutonomyAgents(opts = {}) {
  let rows = [..._agentLevels.values()];
  if (opts.level != null) {
    const lvl = Number(opts.level);
    rows = rows.filter((r) => r.currentLevel === lvl);
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt || b._seq - a._seq);
  const limit = opts.limit || 50;
  return rows.slice(0, limit).map(_strip);
}

/* ── Task assignment helpers ───────────────────────────────── */

export function calculateSkillMatch(requiredSkills = [], agentSkills = {}) {
  if (!Array.isArray(requiredSkills) || requiredSkills.length === 0) return 0;
  let totalWeight = 0;
  let totalScore = 0;
  for (const skill of requiredSkills) {
    const weight = Number(skill.weight ?? 1);
    const requiredLevel = Number(
      skill.requiredLevel ?? skill.required_level ?? 1,
    );
    const agentLevel = Number(agentSkills[skill.name] ?? 0);
    const match =
      requiredLevel > 0 ? Math.min(agentLevel / requiredLevel, 1.0) : 0;
    totalScore += match * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

export function balanceLoad(agents = []) {
  if (!Array.isArray(agents) || agents.length === 0) return null;
  const sorted = [...agents].sort((a, b) => {
    const la = a.currentLoad / Math.max(a.maxCapacity, 1);
    const lb = b.currentLoad / Math.max(b.maxCapacity, 1);
    return la - lb;
  });
  return sorted[0];
}

export function calculatePriority(task = {}) {
  const urgency = Number(task.urgency ?? 0);
  const importance = Number(task.importance ?? 0);
  const complexity = Number(task.complexity ?? 0);
  const dependencies = Number(task.dependencies ?? 0);
  return (
    urgency * 0.4 + importance * 0.3 + complexity * 0.2 + dependencies * 0.1
  );
}

export function optimizeTaskAssignment(tasks = [], agents = []) {
  if (!Array.isArray(tasks) || !Array.isArray(agents)) {
    throw new Error("tasks and agents must be arrays");
  }
  const sortedTasks = [...tasks].sort(
    (a, b) => calculatePriority(b) - calculatePriority(a),
  );
  const agentLoad = new Map(
    agents.map((a) => [
      a.id,
      {
        ...a,
        currentLoad: Number(a.currentLoad ?? 0),
        maxCapacity: Number(a.maxCapacity ?? 1),
      },
    ]),
  );

  const assignments = [];
  const unassigned = [];

  for (const task of sortedTasks) {
    const candidates = [...agentLoad.values()].filter(
      (a) => a.currentLoad < a.maxCapacity,
    );
    if (candidates.length === 0) {
      unassigned.push({ taskId: task.id, reason: "no capacity" });
      continue;
    }
    const required = task.requiredSkills || [];
    const scored = candidates
      .map((a) => ({
        agent: a,
        skillScore: calculateSkillMatch(required, a.skills || {}),
        loadRatio: a.currentLoad / Math.max(a.maxCapacity, 1),
      }))
      .sort((a, b) => b.skillScore - a.skillScore || a.loadRatio - b.loadRatio);
    const best = scored[0];
    if (best.skillScore === 0 && required.length > 0) {
      unassigned.push({ taskId: task.id, reason: "no skill match" });
      continue;
    }
    assignments.push({
      taskId: task.id,
      agentId: best.agent.id,
      skillScore: Number(best.skillScore.toFixed(3)),
      priority: Number(calculatePriority(task).toFixed(3)),
    });
    best.agent.currentLoad += 1;
  }

  return {
    assignments,
    unassigned,
    totalTasks: tasks.length,
    assigned: assignments.length,
    unassignedCount: unassigned.length,
  };
}

/* ── Reset (tests) ─────────────────────────────────────────── */

export function _resetState() {
  _decisions.clear();
  _agentLevels.clear();
  _seq = 0;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Surface — Collaboration Governance V2 (additive)
 * ═══════════════════════════════════════════════════════════════ */

export const AGENT_MATURITY_CG_V2 = Object.freeze({
  PROVISIONAL: "provisional",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  RETIRED: "retired",
});

export const PROPOSAL_LIFECYCLE_V2 = Object.freeze({
  DRAFT: "draft",
  VOTING: "voting",
  APPROVED: "approved",
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
});

const _AGENT_TRANS_CG_V2 = new Map([
  [
    AGENT_MATURITY_CG_V2.PROVISIONAL,
    new Set([AGENT_MATURITY_CG_V2.ACTIVE, AGENT_MATURITY_CG_V2.RETIRED]),
  ],
  [
    AGENT_MATURITY_CG_V2.ACTIVE,
    new Set([AGENT_MATURITY_CG_V2.SUSPENDED, AGENT_MATURITY_CG_V2.RETIRED]),
  ],
  [
    AGENT_MATURITY_CG_V2.SUSPENDED,
    new Set([AGENT_MATURITY_CG_V2.ACTIVE, AGENT_MATURITY_CG_V2.RETIRED]),
  ],
  [AGENT_MATURITY_CG_V2.RETIRED, new Set()],
]);

const _PROPOSAL_TRANS_V2 = new Map([
  [
    PROPOSAL_LIFECYCLE_V2.DRAFT,
    new Set([PROPOSAL_LIFECYCLE_V2.VOTING, PROPOSAL_LIFECYCLE_V2.WITHDRAWN]),
  ],
  [
    PROPOSAL_LIFECYCLE_V2.VOTING,
    new Set([
      PROPOSAL_LIFECYCLE_V2.APPROVED,
      PROPOSAL_LIFECYCLE_V2.REJECTED,
      PROPOSAL_LIFECYCLE_V2.WITHDRAWN,
    ]),
  ],
  [PROPOSAL_LIFECYCLE_V2.APPROVED, new Set()],
  [PROPOSAL_LIFECYCLE_V2.REJECTED, new Set()],
  [PROPOSAL_LIFECYCLE_V2.WITHDRAWN, new Set()],
]);

const _AGENT_TERMINAL_CG_V2 = new Set([AGENT_MATURITY_CG_V2.RETIRED]);
const _PROPOSAL_TERMINAL_V2 = new Set([
  PROPOSAL_LIFECYCLE_V2.APPROVED,
  PROPOSAL_LIFECYCLE_V2.REJECTED,
  PROPOSAL_LIFECYCLE_V2.WITHDRAWN,
]);

export const CG_DEFAULT_MAX_ACTIVE_AGENTS_PER_REALM = 10;
export const CG_DEFAULT_MAX_VOTING_PROPOSALS_PER_PROPOSER = 3;
export const CG_DEFAULT_AGENT_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const CG_DEFAULT_PROPOSAL_STUCK_MS = 7 * 24 * 60 * 60 * 1000;

let _cgMaxActiveAgents = CG_DEFAULT_MAX_ACTIVE_AGENTS_PER_REALM;
let _cgMaxVotingProposals = CG_DEFAULT_MAX_VOTING_PROPOSALS_PER_PROPOSER;
let _cgAgentIdleMs = CG_DEFAULT_AGENT_IDLE_MS;
let _cgProposalStuckMs = CG_DEFAULT_PROPOSAL_STUCK_MS;

const _agentsCgV2 = new Map();
const _proposalsV2 = new Map();

function _posIntCgV2(n, label) {
  const v = Number.isInteger(n) ? n : Math.floor(n);
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be a positive integer`);
  return v;
}

export function getMaxActiveAgentsPerRealmCgV2() {
  return _cgMaxActiveAgents;
}
export function setMaxActiveAgentsPerRealmCgV2(n) {
  _cgMaxActiveAgents = _posIntCgV2(n, "maxActiveAgentsPerRealm");
  return _cgMaxActiveAgents;
}
export function getMaxVotingProposalsPerProposerV2() {
  return _cgMaxVotingProposals;
}
export function setMaxVotingProposalsPerProposerV2(n) {
  _cgMaxVotingProposals = _posIntCgV2(n, "maxVotingProposalsPerProposer");
  return _cgMaxVotingProposals;
}
export function getAgentIdleMsCgV2() {
  return _cgAgentIdleMs;
}
export function setAgentIdleMsCgV2(n) {
  _cgAgentIdleMs = _posIntCgV2(n, "agentIdleMs");
  return _cgAgentIdleMs;
}
export function getProposalStuckMsV2() {
  return _cgProposalStuckMs;
}
export function setProposalStuckMsV2(n) {
  _cgProposalStuckMs = _posIntCgV2(n, "proposalStuckMs");
  return _cgProposalStuckMs;
}

export function getActiveAgentCountCgV2(realm) {
  if (!realm) throw new Error("realm is required");
  let c = 0;
  for (const a of _agentsCgV2.values()) {
    if (a.realm !== realm) continue;
    if (a.status === AGENT_MATURITY_CG_V2.RETIRED) continue;
    if (a.status === AGENT_MATURITY_CG_V2.PROVISIONAL) continue;
    c++;
  }
  return c;
}

export function getVotingProposalCountV2(proposer) {
  if (!proposer) throw new Error("proposer is required");
  let c = 0;
  for (const p of _proposalsV2.values()) {
    if (p.proposer !== proposer) continue;
    if (p.status !== PROPOSAL_LIFECYCLE_V2.VOTING) continue;
    c++;
  }
  return c;
}

export function registerAgentCgV2({ id, realm, role, metadata }) {
  if (!id) throw new Error("id is required");
  if (!realm) throw new Error("realm is required");
  if (!role) throw new Error("role is required");
  if (_agentsCgV2.has(id)) throw new Error(`agent ${id} already exists`);
  const now = Date.now();
  const agent = {
    id,
    realm,
    role: String(role),
    status: AGENT_MATURITY_CG_V2.PROVISIONAL,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    lastSeenAt: now,
    metadata: metadata ? { ...metadata } : {},
  };
  _agentsCgV2.set(id, agent);
  return { ...agent, metadata: { ...agent.metadata } };
}

export function getAgentCgV2(id) {
  const a = _agentsCgV2.get(id);
  if (!a) return null;
  return { ...a, metadata: { ...a.metadata } };
}

export function listAgentsCgV2({ realm, status } = {}) {
  const out = [];
  for (const a of _agentsCgV2.values()) {
    if (realm && a.realm !== realm) continue;
    if (status && a.status !== status) continue;
    out.push({ ...a, metadata: { ...a.metadata } });
  }
  return out;
}

export function setAgentMaturityCgV2(
  id,
  nextStatus,
  { reason, metadata } = {},
) {
  const a = _agentsCgV2.get(id);
  if (!a) throw new Error(`agent ${id} not found`);
  if (!_AGENT_TRANS_CG_V2.has(a.status))
    throw new Error(`unknown status ${a.status}`);
  const allowed = _AGENT_TRANS_CG_V2.get(a.status);
  if (!allowed.has(nextStatus)) {
    throw new Error(
      `cannot transition agent ${id} from ${a.status} to ${nextStatus}`,
    );
  }
  if (nextStatus === AGENT_MATURITY_CG_V2.ACTIVE) {
    const wasActive =
      a.status === AGENT_MATURITY_CG_V2.ACTIVE ||
      a.status === AGENT_MATURITY_CG_V2.SUSPENDED;
    if (!wasActive && getActiveAgentCountCgV2(a.realm) >= _cgMaxActiveAgents) {
      throw new Error(
        `realm ${a.realm} exceeds max active agent cap ${_cgMaxActiveAgents}`,
      );
    }
  }
  const now = Date.now();
  a.status = nextStatus;
  a.updatedAt = now;
  a.lastSeenAt = now;
  if (nextStatus === AGENT_MATURITY_CG_V2.ACTIVE && !a.activatedAt)
    a.activatedAt = now;
  if (reason) a.reason = reason;
  if (metadata) a.metadata = { ...a.metadata, ...metadata };
  return { ...a, metadata: { ...a.metadata } };
}

export function activateAgentCgV2(id, opts) {
  return setAgentMaturityCgV2(id, AGENT_MATURITY_CG_V2.ACTIVE, opts);
}
export function suspendAgentCgV2(id, opts) {
  return setAgentMaturityCgV2(id, AGENT_MATURITY_CG_V2.SUSPENDED, opts);
}
export function retireAgentCgV2(id, opts) {
  return setAgentMaturityCgV2(id, AGENT_MATURITY_CG_V2.RETIRED, opts);
}

export function touchAgentCgV2(id) {
  const a = _agentsCgV2.get(id);
  if (!a) throw new Error(`agent ${id} not found`);
  if (_AGENT_TERMINAL_CG_V2.has(a.status))
    throw new Error(`agent ${id} is terminal`);
  a.lastSeenAt = Date.now();
  return { ...a, metadata: { ...a.metadata } };
}

export function createProposalV2({ id, proposer, topic, metadata }) {
  if (!id) throw new Error("id is required");
  if (!proposer) throw new Error("proposer is required");
  if (!topic) throw new Error("topic is required");
  if (_proposalsV2.has(id)) throw new Error(`proposal ${id} already exists`);
  const now = Date.now();
  const prop = {
    id,
    proposer,
    topic: String(topic),
    status: PROPOSAL_LIFECYCLE_V2.DRAFT,
    createdAt: now,
    updatedAt: now,
    votingStartedAt: null,
    decidedAt: null,
    metadata: metadata ? { ...metadata } : {},
  };
  _proposalsV2.set(id, prop);
  return { ...prop, metadata: { ...prop.metadata } };
}

export function getProposalV2(id) {
  const p = _proposalsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}

export function listProposalsV2({ proposer, status } = {}) {
  const out = [];
  for (const p of _proposalsV2.values()) {
    if (proposer && p.proposer !== proposer) continue;
    if (status && p.status !== status) continue;
    out.push({ ...p, metadata: { ...p.metadata } });
  }
  return out;
}

export function setProposalStatusV2(id, nextStatus, { reason, metadata } = {}) {
  const p = _proposalsV2.get(id);
  if (!p) throw new Error(`proposal ${id} not found`);
  if (!_PROPOSAL_TRANS_V2.has(p.status))
    throw new Error(`unknown status ${p.status}`);
  const allowed = _PROPOSAL_TRANS_V2.get(p.status);
  if (!allowed.has(nextStatus)) {
    throw new Error(
      `cannot transition proposal ${id} from ${p.status} to ${nextStatus}`,
    );
  }
  if (nextStatus === PROPOSAL_LIFECYCLE_V2.VOTING) {
    if (getVotingProposalCountV2(p.proposer) >= _cgMaxVotingProposals) {
      throw new Error(
        `proposer ${p.proposer} exceeds max voting proposal cap ${_cgMaxVotingProposals}`,
      );
    }
  }
  const now = Date.now();
  p.status = nextStatus;
  p.updatedAt = now;
  if (nextStatus === PROPOSAL_LIFECYCLE_V2.VOTING && !p.votingStartedAt)
    p.votingStartedAt = now;
  if (_PROPOSAL_TERMINAL_V2.has(nextStatus)) p.decidedAt = now;
  if (reason) p.reason = reason;
  if (metadata) p.metadata = { ...p.metadata, ...metadata };
  return { ...p, metadata: { ...p.metadata } };
}

export function startVotingV2(id, opts) {
  return setProposalStatusV2(id, PROPOSAL_LIFECYCLE_V2.VOTING, opts);
}
export function approveProposalV2(id, opts) {
  return setProposalStatusV2(id, PROPOSAL_LIFECYCLE_V2.APPROVED, opts);
}
export function rejectProposalV2(id, opts) {
  return setProposalStatusV2(id, PROPOSAL_LIFECYCLE_V2.REJECTED, opts);
}
export function withdrawProposalV2(id, opts) {
  return setProposalStatusV2(id, PROPOSAL_LIFECYCLE_V2.WITHDRAWN, opts);
}

export function autoRetireIdleAgentsCgV2({ now } = {}) {
  const t = now ?? Date.now();
  const out = [];
  for (const a of _agentsCgV2.values()) {
    if (a.status === AGENT_MATURITY_CG_V2.RETIRED) continue;
    if (a.status === AGENT_MATURITY_CG_V2.PROVISIONAL) continue;
    if (t - a.lastSeenAt > _cgAgentIdleMs) {
      a.status = AGENT_MATURITY_CG_V2.RETIRED;
      a.updatedAt = t;
      out.push(a.id);
    }
  }
  return out;
}

export function autoWithdrawStuckProposalsV2({ now } = {}) {
  const t = now ?? Date.now();
  const out = [];
  for (const p of _proposalsV2.values()) {
    if (p.status !== PROPOSAL_LIFECYCLE_V2.VOTING) continue;
    if (p.votingStartedAt == null) continue;
    if (t - p.votingStartedAt > _cgProposalStuckMs) {
      p.status = PROPOSAL_LIFECYCLE_V2.WITHDRAWN;
      p.decidedAt = t;
      p.updatedAt = t;
      p.reason = p.reason || "auto-withdraw: stuck voting";
      out.push(p.id);
    }
  }
  return out;
}

export function getCollaborationGovernanceStatsV2() {
  const agentsByStatus = {};
  for (const v of Object.values(AGENT_MATURITY_CG_V2)) agentsByStatus[v] = 0;
  for (const a of _agentsCgV2.values()) agentsByStatus[a.status]++;
  const proposalsByStatus = {};
  for (const v of Object.values(PROPOSAL_LIFECYCLE_V2))
    proposalsByStatus[v] = 0;
  for (const p of _proposalsV2.values()) proposalsByStatus[p.status]++;
  return {
    totalAgentsCgV2: _agentsCgV2.size,
    totalProposalsV2: _proposalsV2.size,
    maxActiveAgentsPerRealm: _cgMaxActiveAgents,
    maxVotingProposalsPerProposer: _cgMaxVotingProposals,
    agentIdleMs: _cgAgentIdleMs,
    proposalStuckMs: _cgProposalStuckMs,
    agentsByStatus,
    proposalsByStatus,
  };
}

export function _resetStateCgV2() {
  _agentsCgV2.clear();
  _proposalsV2.clear();
  _cgMaxActiveAgents = CG_DEFAULT_MAX_ACTIVE_AGENTS_PER_REALM;
  _cgMaxVotingProposals = CG_DEFAULT_MAX_VOTING_PROPOSALS_PER_PROPOSER;
  _cgAgentIdleMs = CG_DEFAULT_AGENT_IDLE_MS;
  _cgProposalStuckMs = CG_DEFAULT_PROPOSAL_STUCK_MS;
}

// =====================================================================
// collaboration-governance V2 governance overlay (iter19)
// =====================================================================
export const COGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  ARCHIVED: "archived",
});
export const COGOV_DECISION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  DELIBERATING: "deliberating",
  DECIDED: "decided",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cogovPTrans = new Map([
  [
    COGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      COGOV_PROFILE_MATURITY_V2.ACTIVE,
      COGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      COGOV_PROFILE_MATURITY_V2.SUSPENDED,
      COGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    COGOV_PROFILE_MATURITY_V2.SUSPENDED,
    new Set([
      COGOV_PROFILE_MATURITY_V2.ACTIVE,
      COGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [COGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cogovPTerminal = new Set([COGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _cogovJTrans = new Map([
  [
    COGOV_DECISION_LIFECYCLE_V2.QUEUED,
    new Set([
      COGOV_DECISION_LIFECYCLE_V2.DELIBERATING,
      COGOV_DECISION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    COGOV_DECISION_LIFECYCLE_V2.DELIBERATING,
    new Set([
      COGOV_DECISION_LIFECYCLE_V2.DECIDED,
      COGOV_DECISION_LIFECYCLE_V2.FAILED,
      COGOV_DECISION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [COGOV_DECISION_LIFECYCLE_V2.DECIDED, new Set()],
  [COGOV_DECISION_LIFECYCLE_V2.FAILED, new Set()],
  [COGOV_DECISION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cogovPsV2 = new Map();
const _cogovJsV2 = new Map();
let _cogovMaxActive = 8,
  _cogovMaxPending = 20,
  _cogovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cogovStuckMs = 60 * 1000;
function _cogovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cogovCheckP(from, to) {
  const a = _cogovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cogov profile transition ${from} → ${to}`);
}
function _cogovCheckJ(from, to) {
  const a = _cogovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cogov decision transition ${from} → ${to}`);
}
function _cogovCountActive(owner) {
  let c = 0;
  for (const p of _cogovPsV2.values())
    if (p.owner === owner && p.status === COGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _cogovCountPending(profileId) {
  let c = 0;
  for (const j of _cogovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === COGOV_DECISION_LIFECYCLE_V2.QUEUED ||
        j.status === COGOV_DECISION_LIFECYCLE_V2.DELIBERATING)
    )
      c++;
  return c;
}
export function setMaxActiveCogovProfilesPerOwnerV2(n) {
  _cogovMaxActive = _cogovPos(n, "maxActiveCogovProfilesPerOwner");
}
export function getMaxActiveCogovProfilesPerOwnerV2() {
  return _cogovMaxActive;
}
export function setMaxPendingCogovDecisionsPerProfileV2(n) {
  _cogovMaxPending = _cogovPos(n, "maxPendingCogovDecisionsPerProfile");
}
export function getMaxPendingCogovDecisionsPerProfileV2() {
  return _cogovMaxPending;
}
export function setCogovProfileIdleMsV2(n) {
  _cogovIdleMs = _cogovPos(n, "cogovProfileIdleMs");
}
export function getCogovProfileIdleMsV2() {
  return _cogovIdleMs;
}
export function setCogovDecisionStuckMsV2(n) {
  _cogovStuckMs = _cogovPos(n, "cogovDecisionStuckMs");
}
export function getCogovDecisionStuckMsV2() {
  return _cogovStuckMs;
}
export function _resetStateCollaborationGovernanceGovV2() {
  _cogovPsV2.clear();
  _cogovJsV2.clear();
  _cogovMaxActive = 8;
  _cogovMaxPending = 20;
  _cogovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cogovStuckMs = 60 * 1000;
}
export function registerCogovProfileV2({ id, owner, scope, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cogovPsV2.has(id)) throw new Error(`cogov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    scope: scope || "team",
    status: COGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cogovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCogovProfileV2(id) {
  const p = _cogovPsV2.get(id);
  if (!p) throw new Error(`cogov profile ${id} not found`);
  const isInitial = p.status === COGOV_PROFILE_MATURITY_V2.PENDING;
  _cogovCheckP(p.status, COGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cogovCountActive(p.owner) >= _cogovMaxActive)
    throw new Error(`max active cogov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = COGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function suspendCogovProfileV2(id) {
  const p = _cogovPsV2.get(id);
  if (!p) throw new Error(`cogov profile ${id} not found`);
  _cogovCheckP(p.status, COGOV_PROFILE_MATURITY_V2.SUSPENDED);
  p.status = COGOV_PROFILE_MATURITY_V2.SUSPENDED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCogovProfileV2(id) {
  const p = _cogovPsV2.get(id);
  if (!p) throw new Error(`cogov profile ${id} not found`);
  _cogovCheckP(p.status, COGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = COGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCogovProfileV2(id) {
  const p = _cogovPsV2.get(id);
  if (!p) throw new Error(`cogov profile ${id} not found`);
  if (_cogovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cogov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCogovProfileV2(id) {
  const p = _cogovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCogovProfilesV2() {
  return [..._cogovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCogovDecisionV2({ id, profileId, topic, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cogovJsV2.has(id))
    throw new Error(`cogov decision ${id} already exists`);
  if (!_cogovPsV2.has(profileId))
    throw new Error(`cogov profile ${profileId} not found`);
  if (_cogovCountPending(profileId) >= _cogovMaxPending)
    throw new Error(
      `max pending cogov decisions for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    topic: topic || "",
    status: COGOV_DECISION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cogovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function deliberatingCogovDecisionV2(id) {
  const j = _cogovJsV2.get(id);
  if (!j) throw new Error(`cogov decision ${id} not found`);
  _cogovCheckJ(j.status, COGOV_DECISION_LIFECYCLE_V2.DELIBERATING);
  const now = Date.now();
  j.status = COGOV_DECISION_LIFECYCLE_V2.DELIBERATING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeDecisionCogovV2(id) {
  const j = _cogovJsV2.get(id);
  if (!j) throw new Error(`cogov decision ${id} not found`);
  _cogovCheckJ(j.status, COGOV_DECISION_LIFECYCLE_V2.DECIDED);
  const now = Date.now();
  j.status = COGOV_DECISION_LIFECYCLE_V2.DECIDED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCogovDecisionV2(id, reason) {
  const j = _cogovJsV2.get(id);
  if (!j) throw new Error(`cogov decision ${id} not found`);
  _cogovCheckJ(j.status, COGOV_DECISION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = COGOV_DECISION_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCogovDecisionV2(id, reason) {
  const j = _cogovJsV2.get(id);
  if (!j) throw new Error(`cogov decision ${id} not found`);
  _cogovCheckJ(j.status, COGOV_DECISION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = COGOV_DECISION_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCogovDecisionV2(id) {
  const j = _cogovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCogovDecisionsV2() {
  return [..._cogovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoSuspendIdleCogovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cogovPsV2.values())
    if (
      p.status === COGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cogovIdleMs
    ) {
      p.status = COGOV_PROFILE_MATURITY_V2.SUSPENDED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCogovDecisionsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cogovJsV2.values())
    if (
      j.status === COGOV_DECISION_LIFECYCLE_V2.DELIBERATING &&
      j.startedAt != null &&
      t - j.startedAt >= _cogovStuckMs
    ) {
      j.status = COGOV_DECISION_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCollaborationGovernanceGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(COGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cogovPsV2.values()) profilesByStatus[p.status]++;
  const decisionsByStatus = {};
  for (const v of Object.values(COGOV_DECISION_LIFECYCLE_V2))
    decisionsByStatus[v] = 0;
  for (const j of _cogovJsV2.values()) decisionsByStatus[j.status]++;
  return {
    totalCogovProfilesV2: _cogovPsV2.size,
    totalCogovDecisionsV2: _cogovJsV2.size,
    maxActiveCogovProfilesPerOwner: _cogovMaxActive,
    maxPendingCogovDecisionsPerProfile: _cogovMaxPending,
    cogovProfileIdleMs: _cogovIdleMs,
    cogovDecisionStuckMs: _cogovStuckMs,
    profilesByStatus,
    decisionsByStatus,
  };
}
