/**
 * Multi-Agent Coordinator — decomposes tasks, selects agents, and aggregates results.
 *
 * Provides task decomposition based on keyword matching, agent selection by
 * capability, subtask assignment tracking, and result aggregation.
 */

import crypto from "crypto";
import { SubAgentContext } from "./sub-agent-context.js";

/**
 * Keyword map for agent type detection.
 */
export const AGENT_TYPE_KEYWORDS = {
  "code-generation": [
    "code",
    "generate",
    "implement",
    "function",
    "class",
    "module",
    "develop",
    "build",
  ],
  "code-review": [
    "review",
    "audit",
    "inspect",
    "check",
    "lint",
    "quality",
    "pull request",
  ],
  "data-analysis": [
    "data",
    "analyze",
    "statistics",
    "chart",
    "graph",
    "csv",
    "report",
    "dashboard",
    "visualization",
  ],
  document: [
    "document",
    "documentation",
    "readme",
    "guide",
    "write",
    "article",
    "tutorial",
    "markdown",
  ],
  testing: [
    "test",
    "unit test",
    "integration",
    "e2e",
    "jest",
    "vitest",
    "coverage",
    "mock",
    "spec",
  ],
};

/**
 * Generate a short unique id.
 */
function generateId() {
  return crypto.randomUUID().slice(0, 12);
}

/**
 * Decompose a task description into subtasks based on keyword matching.
 *
 * @param {string} task - Task description
 * @returns {{ taskId: string, subtasks: Array<{ id: string, agentType: string, description: string, status: string }> }}
 */
export function decomposeTask(task) {
  if (!task || typeof task !== "string") {
    return { taskId: generateId(), subtasks: [] };
  }

  const lower = task.toLowerCase();
  const subtasks = [];

  for (const [agentType, keywords] of Object.entries(AGENT_TYPE_KEYWORDS)) {
    const matched = keywords.filter((kw) => lower.includes(kw));
    if (matched.length > 0) {
      subtasks.push({
        id: generateId(),
        agentType,
        description: `${agentType}: ${matched.join(", ")} — from "${task.substring(0, 80)}"`,
        status: "pending",
      });
    }
  }

  // If nothing matched, create a generic subtask
  if (subtasks.length === 0) {
    subtasks.push({
      id: generateId(),
      agentType: "general",
      description: task.substring(0, 200),
      status: "pending",
    });
  }

  return {
    taskId: generateId(),
    subtasks,
  };
}

/**
 * Select the best matching agent for a subtask from available agents.
 *
 * @param {{ agentType: string }} subtask
 * @param {Array<{ id: string, capabilities: string[] }>} availableAgents
 * @returns {{ id: string, capabilities: string[] } | null}
 */
export function selectAgent(subtask, availableAgents) {
  if (
    !subtask ||
    !Array.isArray(availableAgents) ||
    availableAgents.length === 0
  ) {
    return null;
  }

  // Direct capability match
  for (const agent of availableAgents) {
    if (
      Array.isArray(agent.capabilities) &&
      agent.capabilities.includes(subtask.agentType)
    ) {
      return agent;
    }
  }

  // Partial match — check if any capability keyword overlaps
  const keywords = AGENT_TYPE_KEYWORDS[subtask.agentType] || [];
  let bestAgent = null;
  let bestScore = 0;

  for (const agent of availableAgents) {
    if (!Array.isArray(agent.capabilities)) continue;
    let score = 0;
    for (const cap of agent.capabilities) {
      if (keywords.some((kw) => cap.includes(kw) || kw.includes(cap))) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return bestAgent;
}

/**
 * Assign a subtask to an agent and record in the database.
 *
 * @param {object} db - Database instance (better-sqlite3 API)
 * @param {string} subtaskId
 * @param {string} agentId
 * @returns {{ subtaskId: string, agentId: string, status: string }}
 */
export function assignSubtask(db, subtaskId, agentId) {
  if (db) {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO agent_assignments (id, subtask_id, agent_id, status, assigned_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    );
    stmt.run(generateId(), subtaskId, agentId, "assigned");
  }

  return {
    subtaskId,
    agentId,
    status: "assigned",
  };
}

/**
 * Aggregate results from completed subtasks.
 *
 * @param {Array<{ id: string, agentType: string, status: string, result?: any }>} subtasks
 * @returns {{ taskId: string, status: string, results: any[], summary: string }}
 */
export function aggregateResults(subtasks) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return {
      taskId: "",
      status: "empty",
      results: [],
      summary: "No subtasks to aggregate",
    };
  }

  const results = subtasks.map((s) => ({
    id: s.id,
    agentType: s.agentType,
    status: s.status,
    result: s.result || null,
  }));

  const completed = subtasks.filter((s) => s.status === "completed").length;
  const failed = subtasks.filter((s) => s.status === "failed").length;
  const total = subtasks.length;

  let status = "completed";
  if (failed > 0 && completed === 0) status = "failed";
  else if (failed > 0) status = "partial";
  else if (completed < total) status = "in-progress";

  return {
    taskId: subtasks[0]?.taskId || generateId(),
    status,
    results,
    summary: `${completed}/${total} subtasks completed, ${failed} failed`,
  };
}

/**
 * Return the list of all supported agent types.
 *
 * @returns {string[]}
 */
export function getAgentTypes() {
  return Object.keys(AGENT_TYPE_KEYWORDS);
}

/**
 * Estimate task complexity based on keyword count and description length.
 *
 * @param {string} task
 * @returns {{ complexity: "low" | "medium" | "high", estimatedSubtasks: number }}
 */
export function estimateComplexity(task) {
  if (!task || typeof task !== "string") {
    return { complexity: "low", estimatedSubtasks: 0 };
  }

  const lower = task.toLowerCase();
  let matchedTypes = 0;
  let totalKeywords = 0;

  for (const [, keywords] of Object.entries(AGENT_TYPE_KEYWORDS)) {
    const matched = keywords.filter((kw) => lower.includes(kw));
    if (matched.length > 0) {
      matchedTypes++;
      totalKeywords += matched.length;
    }
  }

  const lengthFactor = task.length > 200 ? 1 : task.length > 100 ? 0.5 : 0;

  const score = matchedTypes + totalKeywords * 0.3 + lengthFactor;

  let complexity;
  if (score >= 5) complexity = "high";
  else if (score >= 2) complexity = "medium";
  else complexity = "low";

  return {
    complexity,
    estimatedSubtasks: Math.max(1, matchedTypes),
  };
}

// ─── Role-based tool whitelist ──────────────────────────────────────────

export const ROLE_TOOL_WHITELIST = {
  "code-review": ["read_file", "search_files", "list_dir"],
  "code-generation": [
    "read_file",
    "write_file",
    "edit_file",
    "run_shell",
    "search_files",
    "list_dir",
  ],
  "data-analysis": [
    "read_file",
    "search_files",
    "list_dir",
    "run_code",
    "run_shell",
  ],
  document: ["read_file", "write_file", "search_files", "list_dir"],
  testing: [
    "read_file",
    "write_file",
    "edit_file",
    "run_shell",
    "search_files",
    "list_dir",
    "run_code",
  ],
  general: null, // all tools
};

/**
 * Execute a decomposed task using isolated sub-agent contexts.
 * Each subtask gets its own SubAgentContext with role-appropriate tool whitelist.
 *
 * @param {{ taskId: string, subtasks: Array }} decomposition - From decomposeTask()
 * @param {object} [options]
 * @param {string} [options.cwd] - Working directory
 * @param {object} [options.db] - Database instance
 * @param {object} [options.llmOptions] - LLM provider options
 * @param {string} [options.parentContext] - Condensed context from parent
 * @returns {Promise<{ taskId: string, status: string, results: Array, summary: string }>}
 */
export async function executeDecomposedTask(decomposition, options = {}) {
  const { subtasks } = decomposition;
  if (!subtasks || subtasks.length === 0) {
    return {
      taskId: decomposition.taskId,
      status: "empty",
      results: [],
      summary: "No subtasks to execute",
    };
  }

  const maxConcurrency = options.maxConcurrency || 3;

  // Run subtasks in parallel batches with concurrency limit
  const results = [];
  for (let i = 0; i < subtasks.length; i += maxConcurrency) {
    const batch = subtasks.slice(i, i + maxConcurrency);
    const batchPromises = batch.map(async (subtask) => {
      const allowedTools = ROLE_TOOL_WHITELIST[subtask.agentType] || null;

      const subCtx = SubAgentContext.create({
        role: subtask.agentType,
        task: subtask.description,
        inheritedContext: options.parentContext || null,
        allowedTools,
        cwd: options.cwd || process.cwd(),
        db: options.db || null,
        llmOptions: options.llmOptions || {},
      });

      try {
        const result = await subCtx.run(subtask.description);
        subtask.status = "completed";
        subtask.result = result.summary;
        return {
          id: subtask.id,
          agentType: subtask.agentType,
          status: "completed",
          summary: result.summary,
          toolsUsed: result.toolsUsed,
        };
      } catch (err) {
        subtask.status = "failed";
        subtask.result = err.message;
        return {
          id: subtask.id,
          agentType: subtask.agentType,
          status: "failed",
          error: err.message,
        };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }

  const aggregated = aggregateResults(subtasks);
  return {
    taskId: decomposition.taskId,
    status: aggregated.status,
    results,
    summary: aggregated.summary,
  };
}

// ===== V2 Surface (cli 0.131.0) — in-memory governance =====
export const COORD_AGENT_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  IDLE: "idle",
  RETIRED: "retired",
});
export const COORD_ASSIGNMENT_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  DISPATCHED: "dispatched",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _CA_V2 = COORD_AGENT_MATURITY_V2;
const _CL_V2 = COORD_ASSIGNMENT_LIFECYCLE_V2;
const _CA_TRANS_V2 = new Map([
  [_CA_V2.PENDING, new Set([_CA_V2.ACTIVE, _CA_V2.RETIRED])],
  [_CA_V2.ACTIVE, new Set([_CA_V2.IDLE, _CA_V2.RETIRED])],
  [_CA_V2.IDLE, new Set([_CA_V2.ACTIVE, _CA_V2.RETIRED])],
  [_CA_V2.RETIRED, new Set()],
]);
const _CL_TRANS_V2 = new Map([
  [_CL_V2.QUEUED, new Set([_CL_V2.DISPATCHED, _CL_V2.CANCELLED])],
  [
    _CL_V2.DISPATCHED,
    new Set([_CL_V2.COMPLETED, _CL_V2.FAILED, _CL_V2.CANCELLED]),
  ],
  [_CL_V2.COMPLETED, new Set()],
  [_CL_V2.FAILED, new Set()],
  [_CL_V2.CANCELLED, new Set()],
]);
const _CL_TERM_V2 = new Set([
  _CL_V2.COMPLETED,
  _CL_V2.FAILED,
  _CL_V2.CANCELLED,
]);

const COORD_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER = 8;
const COORD_DEFAULT_MAX_PENDING_ASSIGNMENTS_PER_AGENT = 12;
const COORD_DEFAULT_AGENT_IDLE_MS = 60 * 60 * 1000;
const COORD_DEFAULT_ASSIGNMENT_STUCK_MS = 5 * 60 * 1000;

const _coordAgentsV2 = new Map();
const _coordAssignmentsV2 = new Map();
let _coordConfigV2 = {
  maxActiveAgentsPerOwner: COORD_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER,
  maxPendingAssignmentsPerAgent:
    COORD_DEFAULT_MAX_PENDING_ASSIGNMENTS_PER_AGENT,
  agentIdleMs: COORD_DEFAULT_AGENT_IDLE_MS,
  assignmentStuckMs: COORD_DEFAULT_ASSIGNMENT_STUCK_MS,
};

function _coordPosIntV2(n, label) {
  if (typeof n !== "number" || !isFinite(n) || isNaN(n))
    throw new Error(`${label} must be positive integer`);
  const v = Math.floor(n);
  if (v <= 0) throw new Error(`${label} must be positive integer`);
  return v;
}

export function _resetStateAgentCoordinatorV2() {
  _coordAgentsV2.clear();
  _coordAssignmentsV2.clear();
  _coordConfigV2 = {
    maxActiveAgentsPerOwner: COORD_DEFAULT_MAX_ACTIVE_AGENTS_PER_OWNER,
    maxPendingAssignmentsPerAgent:
      COORD_DEFAULT_MAX_PENDING_ASSIGNMENTS_PER_AGENT,
    agentIdleMs: COORD_DEFAULT_AGENT_IDLE_MS,
    assignmentStuckMs: COORD_DEFAULT_ASSIGNMENT_STUCK_MS,
  };
}

export function setMaxActiveAgentsPerOwnerCoordV2(n) {
  _coordConfigV2.maxActiveAgentsPerOwner = _coordPosIntV2(
    n,
    "maxActiveAgentsPerOwner",
  );
}
export function setMaxPendingAssignmentsPerAgentV2(n) {
  _coordConfigV2.maxPendingAssignmentsPerAgent = _coordPosIntV2(
    n,
    "maxPendingAssignmentsPerAgent",
  );
}
export function setAgentIdleMsCoordV2(n) {
  _coordConfigV2.agentIdleMs = _coordPosIntV2(n, "agentIdleMs");
}
export function setAssignmentStuckMsV2(n) {
  _coordConfigV2.assignmentStuckMs = _coordPosIntV2(n, "assignmentStuckMs");
}
export function getMaxActiveAgentsPerOwnerCoordV2() {
  return _coordConfigV2.maxActiveAgentsPerOwner;
}
export function getMaxPendingAssignmentsPerAgentV2() {
  return _coordConfigV2.maxPendingAssignmentsPerAgent;
}
export function getAgentIdleMsCoordV2() {
  return _coordConfigV2.agentIdleMs;
}
export function getAssignmentStuckMsV2() {
  return _coordConfigV2.assignmentStuckMs;
}

function _copyCoordAgentV2(a) {
  return { ...a, metadata: { ...(a.metadata || {}) } };
}
function _copyAssignmentV2(a) {
  return { ...a, metadata: { ...(a.metadata || {}) } };
}

export function registerCoordAgentV2({ id, owner, role, name, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!owner || typeof owner !== "string") throw new Error("owner required");
  if (!role || typeof role !== "string") throw new Error("role required");
  if (_coordAgentsV2.has(id)) throw new Error(`agent ${id} already registered`);
  const now = Date.now();
  const a = {
    id,
    owner,
    role,
    name: name || id,
    status: _CA_V2.PENDING,
    activatedAt: null,
    retiredAt: null,
    lastSeenAt: now,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _coordAgentsV2.set(id, a);
  return _copyCoordAgentV2(a);
}

function _activeCoordAgentCountForOwnerV2(owner) {
  let c = 0;
  for (const a of _coordAgentsV2.values())
    if (a.owner === owner && a.status === _CA_V2.ACTIVE) c++;
  return c;
}

function _transitionCoordAgentV2(id, next) {
  const a = _coordAgentsV2.get(id);
  if (!a) throw new Error(`agent ${id} not found`);
  const allowed = _CA_TRANS_V2.get(a.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${a.status} -> ${next}`);
  if (next === _CA_V2.ACTIVE && a.status === _CA_V2.PENDING) {
    if (
      _activeCoordAgentCountForOwnerV2(a.owner) >=
      _coordConfigV2.maxActiveAgentsPerOwner
    ) {
      throw new Error(
        `owner ${a.owner} active-agent cap reached (${_coordConfigV2.maxActiveAgentsPerOwner})`,
      );
    }
  }
  const now = Date.now();
  a.status = next;
  if (next === _CA_V2.ACTIVE && !a.activatedAt) a.activatedAt = now;
  if (next === _CA_V2.RETIRED && !a.retiredAt) a.retiredAt = now;
  a.lastSeenAt = now;
  return _copyCoordAgentV2(a);
}

export function activateCoordAgentV2(id) {
  return _transitionCoordAgentV2(id, _CA_V2.ACTIVE);
}
export function idleCoordAgentV2(id) {
  return _transitionCoordAgentV2(id, _CA_V2.IDLE);
}
export function retireCoordAgentV2(id) {
  return _transitionCoordAgentV2(id, _CA_V2.RETIRED);
}
export function touchCoordAgentV2(id) {
  const a = _coordAgentsV2.get(id);
  if (!a) throw new Error(`agent ${id} not found`);
  a.lastSeenAt = Date.now();
  return _copyCoordAgentV2(a);
}
export function getCoordAgentV2(id) {
  const a = _coordAgentsV2.get(id);
  return a ? _copyCoordAgentV2(a) : null;
}
export function listCoordAgentsV2({ owner, status, role } = {}) {
  const out = [];
  for (const a of _coordAgentsV2.values()) {
    if (owner && a.owner !== owner) continue;
    if (status && a.status !== status) continue;
    if (role && a.role !== role) continue;
    out.push(_copyCoordAgentV2(a));
  }
  return out;
}

function _pendingAssignmentCountForAgentV2(agentId) {
  let c = 0;
  for (const a of _coordAssignmentsV2.values()) {
    if (a.agentId !== agentId) continue;
    if (a.status === _CL_V2.QUEUED || a.status === _CL_V2.DISPATCHED) c++;
  }
  return c;
}

export function createAssignmentV2({ id, agentId, subtask, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!agentId || typeof agentId !== "string")
    throw new Error("agentId required");
  if (_coordAssignmentsV2.has(id))
    throw new Error(`assignment ${id} already exists`);
  const agent = _coordAgentsV2.get(agentId);
  if (!agent) throw new Error(`agent ${agentId} not found`);
  if (agent.status === _CA_V2.RETIRED)
    throw new Error(`agent ${agentId} retired`);
  if (
    _pendingAssignmentCountForAgentV2(agentId) >=
    _coordConfigV2.maxPendingAssignmentsPerAgent
  ) {
    throw new Error(
      `agent ${agentId} pending-assignment cap reached (${_coordConfigV2.maxPendingAssignmentsPerAgent})`,
    );
  }
  const now = Date.now();
  const a = {
    id,
    agentId,
    subtask: subtask || "untitled",
    status: _CL_V2.QUEUED,
    startedAt: null,
    settledAt: null,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _coordAssignmentsV2.set(id, a);
  return _copyAssignmentV2(a);
}

function _transitionAssignmentV2(id, next, extra = {}) {
  const a = _coordAssignmentsV2.get(id);
  if (!a) throw new Error(`assignment ${id} not found`);
  const allowed = _CL_TRANS_V2.get(a.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${a.status} -> ${next}`);
  const now = Date.now();
  a.status = next;
  if (next === _CL_V2.DISPATCHED && !a.startedAt) a.startedAt = now;
  if (_CL_TERM_V2.has(next) && !a.settledAt) a.settledAt = now;
  if (extra.error) a.metadata.error = extra.error;
  return _copyAssignmentV2(a);
}

export function dispatchAssignmentV2(id) {
  return _transitionAssignmentV2(id, _CL_V2.DISPATCHED);
}
export function completeAssignmentV2(id) {
  return _transitionAssignmentV2(id, _CL_V2.COMPLETED);
}
export function failAssignmentV2(id, error) {
  return _transitionAssignmentV2(id, _CL_V2.FAILED, { error });
}
export function cancelAssignmentV2(id) {
  return _transitionAssignmentV2(id, _CL_V2.CANCELLED);
}
export function getAssignmentV2(id) {
  const a = _coordAssignmentsV2.get(id);
  return a ? _copyAssignmentV2(a) : null;
}
export function listAssignmentsV2({ agentId, status } = {}) {
  const out = [];
  for (const a of _coordAssignmentsV2.values()) {
    if (agentId && a.agentId !== agentId) continue;
    if (status && a.status !== status) continue;
    out.push(_copyAssignmentV2(a));
  }
  return out;
}

export function autoIdleCoordAgentsV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const a of _coordAgentsV2.values()) {
    if (a.status !== _CA_V2.ACTIVE) continue;
    if (t - a.lastSeenAt > _coordConfigV2.agentIdleMs) {
      a.status = _CA_V2.IDLE;
      a.lastSeenAt = t;
      flipped.push(_copyCoordAgentV2(a));
    }
  }
  return flipped;
}

export function autoFailStuckAssignmentsV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const a of _coordAssignmentsV2.values()) {
    if (a.status !== _CL_V2.DISPATCHED) continue;
    if (a.startedAt && t - a.startedAt > _coordConfigV2.assignmentStuckMs) {
      a.status = _CL_V2.FAILED;
      a.settledAt = t;
      a.metadata.error = "stuck-timeout";
      flipped.push(_copyAssignmentV2(a));
    }
  }
  return flipped;
}

export function getAgentCoordinatorStatsV2() {
  const agentsByStatus = {};
  for (const s of Object.values(_CA_V2)) agentsByStatus[s] = 0;
  for (const a of _coordAgentsV2.values()) agentsByStatus[a.status]++;
  const assignmentsByStatus = {};
  for (const s of Object.values(_CL_V2)) assignmentsByStatus[s] = 0;
  for (const a of _coordAssignmentsV2.values()) assignmentsByStatus[a.status]++;
  return {
    totalAgentsV2: _coordAgentsV2.size,
    totalAssignmentsV2: _coordAssignmentsV2.size,
    maxActiveAgentsPerOwner: _coordConfigV2.maxActiveAgentsPerOwner,
    maxPendingAssignmentsPerAgent: _coordConfigV2.maxPendingAssignmentsPerAgent,
    agentIdleMs: _coordConfigV2.agentIdleMs,
    assignmentStuckMs: _coordConfigV2.assignmentStuckMs,
    agentsByStatus,
    assignmentsByStatus,
  };
}
