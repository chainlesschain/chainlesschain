/**
 * AgentRouter — multi-path agent dispatch.
 *
 * Routes coding subtasks across multiple agent backends in parallel:
 *   - claude     (Claude Code CLI — best for complex reasoning)
 *   - codex      (GitHub Copilot CLI — good for repo context)
 *   - gemini     (Google Gemini via ChainlessChain LLM provider)
 *   - openai     (GPT-4o via ChainlessChain LLM provider)
 *   - ollama     (Local LLM — offline / private)
 *
 * Routing strategies:
 *   round-robin  — distribute evenly across available backends
 *   by-type      — route based on task type keywords
 *   parallel-all — every subtask runs on ALL backends; pick best result
 *   primary      — use first available backend, others as fallback
 *
 * Usage:
 *   const router = new AgentRouter({
 *     backends: [
 *       { type: "claude", weight: 2 },
 *       { type: "gemini", apiKey: "...", model: "gemini-1.5-pro", weight: 1 },
 *     ],
 *     strategy: "round-robin",
 *   });
 *   const results = await router.dispatch(subtasks, { cwd: "/my/project" });
 */

import { EventEmitter } from "events";
import {
  ClaudeCodePool,
  detectClaudeCode,
  detectCodex,
} from "./claude-code-bridge.js";
import { createChatFn } from "./cowork-adapter.js";

// ─── Backend type constants ───────────────────────────────────────
export const BACKEND_TYPE = {
  CLAUDE: "claude",
  CODEX: "codex",
  GEMINI: "gemini",
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  OLLAMA: "ollama",
};

// ─── Task type → preferred backend mapping ────────────────────────
const TASK_TYPE_ROUTING = {
  "code-generation": BACKEND_TYPE.CLAUDE,
  "code-review": BACKEND_TYPE.CLAUDE,
  testing: BACKEND_TYPE.CLAUDE,
  documentation: BACKEND_TYPE.OPENAI,
  "data-analysis": BACKEND_TYPE.GEMINI,
  research: BACKEND_TYPE.GEMINI,
};

// Keywords for auto-detecting task type
const TYPE_KEYWORDS = {
  "code-generation": [
    "implement",
    "create",
    "build",
    "add feature",
    "fix",
    "refactor",
  ],
  "code-review": ["review", "audit", "check", "inspect", "analyze"],
  testing: ["test", "spec", "unit test", "e2e", "coverage"],
  documentation: ["document", "readme", "comment", "docstring", "explain"],
  "data-analysis": ["data", "analyze", "statistics", "report", "chart"],
  research: ["research", "investigate", "explore", "compare"],
};

function detectTaskType(description) {
  const lower = description.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return type;
  }
  return "code-generation";
}

// ─── API-based agent executor ─────────────────────────────────────

/**
 * Execute a task using an LLM API backend (Gemini, GPT, Ollama, etc.)
 * through ChainlessChain's existing llm-providers infrastructure.
 */
async function executeViaAPI(task, options) {
  const { provider, model, apiKey, baseUrl, cwd, timeout = 120_000 } = options;

  const chat = createChatFn({ provider, model, apiKey, baseUrl });

  const systemPrompt =
    "You are an expert software engineer. Implement the requested changes precisely. " +
    "Respond with the complete implementation, file paths, and explanations. " +
    `Working directory: ${cwd}`;

  const startTime = Date.now();
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("LLM API timeout")), timeout),
    );
    const output = await Promise.race([
      chat(
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: task.context
              ? `Context:\n${task.context}\n\nTask:\n${task.description}`
              : task.description,
          },
        ],
        { maxTokens: 4096 },
      ),
      timeoutPromise,
    ]);

    return {
      success: true,
      output,
      exitCode: 0,
      duration: Date.now() - startTime,
      agentId: `api-${provider}`,
    };
  } catch (err) {
    return {
      success: false,
      output: "",
      exitCode: -1,
      duration: Date.now() - startTime,
      agentId: `api-${provider}`,
      error: err.message,
    };
  }
}

// ─── AgentRouter ──────────────────────────────────────────────────

export class AgentRouter extends EventEmitter {
  /**
   * @param {object} options
   * @param {Array}   options.backends   - Backend configs (see examples above)
   * @param {string}  options.strategy   - "round-robin"|"by-type"|"parallel-all"|"primary"
   * @param {number}  options.maxParallel - Max concurrent agent tasks (default 3)
   */
  constructor(options = {}) {
    super();
    this.strategy = options.strategy || "round-robin";
    this.maxParallel = options.maxParallel || 3;
    this._backends = this._resolveBackends(options.backends || []);
    this._rrIndex = 0; // round-robin cursor
  }

  /**
   * Auto-detect available backends from the environment.
   * Includes CLI tools and API providers based on env vars.
   */
  static autoDetect(options = {}) {
    const backends = [];

    if (detectClaudeCode().found) {
      backends.push({ type: BACKEND_TYPE.CLAUDE, weight: 3 });
    }
    if (detectCodex().found) {
      backends.push({ type: BACKEND_TYPE.CODEX, weight: 2 });
    }
    if (process.env.GEMINI_API_KEY) {
      backends.push({ type: BACKEND_TYPE.GEMINI, weight: 2 });
    }
    if (process.env.OPENAI_API_KEY) {
      backends.push({ type: BACKEND_TYPE.OPENAI, weight: 2 });
    }
    if (process.env.ANTHROPIC_API_KEY) {
      backends.push({ type: BACKEND_TYPE.ANTHROPIC, weight: 2 });
    }
    // Always include Ollama as local fallback
    backends.push({ type: BACKEND_TYPE.OLLAMA, weight: 1 });

    return new AgentRouter({ ...options, backends });
  }

  /**
   * Dispatch subtasks to agent backends according to the routing strategy.
   *
   * @param {Array<{id, description, context?, type?}>} subtasks
   * @param {object} options
   * @param {string} options.cwd
   * @returns {Promise<Array<{taskId, agentId, backendType, success, output, duration}>>}
   */
  async dispatch(subtasks, options = {}) {
    const { cwd = process.cwd() } = options;

    if (this._backends.length === 0) {
      throw new Error(
        "No agent backends available. Install Claude Code: npm i -g @anthropic-ai/claude-code",
      );
    }

    switch (this.strategy) {
      case "parallel-all":
        return this._dispatchParallelAll(subtasks, { cwd });
      case "by-type":
        return this._dispatchByType(subtasks, { cwd });
      case "primary":
        return this._dispatchPrimary(subtasks, { cwd });
      default: // round-robin
        return this._dispatchRoundRobin(subtasks, { cwd });
    }
  }

  // ─── Strategies ────────────────────────────────────────────────

  /** Round-robin: distribute tasks evenly across all backends. */
  async _dispatchRoundRobin(subtasks, { cwd }) {
    // Assign each subtask a backend
    const assignments = subtasks.map((task) => {
      const backend = this._weightedNext();
      return { task, backend };
    });

    return this._runAssignments(assignments, { cwd });
  }

  /** By-type: route task to the best backend for its type. */
  async _dispatchByType(subtasks, { cwd }) {
    const assignments = subtasks.map((task) => {
      const taskType = task.type || detectTaskType(task.description);
      const preferredType = TASK_TYPE_ROUTING[taskType];
      const backend = this._findBackend(preferredType) || this._weightedNext();
      return { task, backend };
    });

    return this._runAssignments(assignments, { cwd });
  }

  /** Primary: all tasks go to first backend; fallback on failure. */
  async _dispatchPrimary(subtasks, { cwd }) {
    const primary = this._backends[0];
    const assignments = subtasks.map((task) => ({ task, backend: primary }));
    const results = await this._runAssignments(assignments, { cwd });

    // Retry failed tasks on next available backend
    const retries = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i].success && this._backends.length > 1) {
        const fallback = this._backends[1];
        retries.push(
          this._runSingleTask(subtasks[i], fallback, { cwd }).then((r) => {
            results[i] = r;
          }),
        );
      }
    }
    await Promise.all(retries);
    return results;
  }

  /** Parallel-all: run every task on ALL backends; return best result per task. */
  async _dispatchParallelAll(subtasks, { cwd }) {
    const results = [];
    for (const task of subtasks) {
      const allResults = await Promise.all(
        this._backends.map((backend) =>
          this._runSingleTask(task, backend, { cwd }),
        ),
      );
      // Pick the first successful result; if all fail, pick the first
      const best = allResults.find((r) => r.success) || allResults[0];
      best.allResults = allResults; // attach all results for inspection
      results.push(best);
    }
    return results;
  }

  // ─── Execution ─────────────────────────────────────────────────

  async _runAssignments(assignments, { cwd }) {
    const results = new Array(assignments.length);

    // Process in parallel batches
    for (let i = 0; i < assignments.length; i += this.maxParallel) {
      const batch = assignments.slice(i, i + this.maxParallel);
      const batchResults = await Promise.all(
        batch.map(({ task, backend }) =>
          this._runSingleTask(task, backend, { cwd }),
        ),
      );
      for (let j = 0; j < batchResults.length; j++) {
        results[i + j] = batchResults[j];
      }
    }

    return results;
  }

  async _runSingleTask(task, backend, { cwd }) {
    this.emit("agent:start", { taskId: task.id, backend: backend.type });

    let result;
    if (backend.isCLI) {
      // Use ClaudeCodePool for CLI-based backends
      const pool = backend._pool;
      const [r] = await pool.dispatch([task], { cwd });
      result = r;
    } else {
      // Use LLM API for API-based backends
      result = await executeViaAPI(task, {
        provider: backend.provider,
        model: backend.model,
        apiKey: backend.apiKey,
        baseUrl: backend.baseUrl,
        cwd,
        timeout: backend.timeout,
      });
    }

    result.taskId = task.id;
    result.backendType = backend.type;

    this.emit("agent:complete", result);
    return result;
  }

  // ─── Backend resolution ─────────────────────────────────────────

  _resolveBackends(configs) {
    return configs.map((cfg) => {
      const type = cfg.type || BACKEND_TYPE.CLAUDE;

      if (type === BACKEND_TYPE.CLAUDE || type === BACKEND_TYPE.CODEX) {
        const pool = new ClaudeCodePool({
          maxParallel: 1,
          cliCommand: type === BACKEND_TYPE.CODEX ? "codex" : "claude",
          model: cfg.model || null,
        });
        pool.on("agent:output", (ev) => this.emit("agent:output", ev));
        return {
          type,
          isCLI: true,
          weight: cfg.weight || 1,
          _pool: pool,
          timeout: cfg.timeout || 300_000,
        };
      }

      // API-based backend
      const providerMap = {
        [BACKEND_TYPE.GEMINI]: "gemini",
        [BACKEND_TYPE.OPENAI]: "openai",
        [BACKEND_TYPE.ANTHROPIC]: "anthropic",
        [BACKEND_TYPE.OLLAMA]: "ollama",
      };

      return {
        type,
        isCLI: false,
        weight: cfg.weight || 1,
        provider: providerMap[type] || type,
        model: cfg.model || null,
        apiKey: cfg.apiKey || null,
        baseUrl: cfg.baseUrl || null,
        timeout: cfg.timeout || 120_000,
      };
    });
  }

  /** Find the first backend matching a given type. */
  _findBackend(type) {
    return this._backends.find((b) => b.type === type) || null;
  }

  /** Pick next backend using weighted round-robin. */
  _weightedNext() {
    if (this._backends.length === 0) throw new Error("No backends");
    if (this._backends.length === 1) return this._backends[0];

    // Build weighted list
    const weighted = [];
    for (const b of this._backends) {
      for (let i = 0; i < (b.weight || 1); i++) weighted.push(b);
    }

    const backend = weighted[this._rrIndex % weighted.length];
    this._rrIndex++;
    return backend;
  }

  /** Summary of all configured backends. */
  summary() {
    return this._backends.map((b) => ({
      type: b.type,
      kind: b.isCLI ? "cli" : "api",
      provider: b.provider || b.type,
      weight: b.weight,
    }));
  }
}

// ===== V2 Surface: Agent Router governance overlay (CLI v0.132.0) =====
// In-memory governance for router profiles + dispatch lifecycle, independent of
// the AgentRouter class above (legacy ClaudeCodePool/createChatFn untouched).

export const ROUTER_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  RETIRED: "retired",
});

export const ROUTER_DISPATCH_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _profileTransitionsV2 = new Map([
  [
    ROUTER_PROFILE_MATURITY_V2.PENDING,
    new Set([
      ROUTER_PROFILE_MATURITY_V2.ACTIVE,
      ROUTER_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    ROUTER_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      ROUTER_PROFILE_MATURITY_V2.DEGRADED,
      ROUTER_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [
    ROUTER_PROFILE_MATURITY_V2.DEGRADED,
    new Set([
      ROUTER_PROFILE_MATURITY_V2.ACTIVE,
      ROUTER_PROFILE_MATURITY_V2.RETIRED,
    ]),
  ],
  [ROUTER_PROFILE_MATURITY_V2.RETIRED, new Set()],
]);
const _profileTerminalV2 = new Set([ROUTER_PROFILE_MATURITY_V2.RETIRED]);

const _dispatchTransitionsV2 = new Map([
  [
    ROUTER_DISPATCH_LIFECYCLE_V2.QUEUED,
    new Set([
      ROUTER_DISPATCH_LIFECYCLE_V2.DISPATCHING,
      ROUTER_DISPATCH_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    ROUTER_DISPATCH_LIFECYCLE_V2.DISPATCHING,
    new Set([
      ROUTER_DISPATCH_LIFECYCLE_V2.COMPLETED,
      ROUTER_DISPATCH_LIFECYCLE_V2.FAILED,
      ROUTER_DISPATCH_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [ROUTER_DISPATCH_LIFECYCLE_V2.COMPLETED, new Set()],
  [ROUTER_DISPATCH_LIFECYCLE_V2.FAILED, new Set()],
  [ROUTER_DISPATCH_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _dispatchTerminalV2 = new Set([
  ROUTER_DISPATCH_LIFECYCLE_V2.COMPLETED,
  ROUTER_DISPATCH_LIFECYCLE_V2.FAILED,
  ROUTER_DISPATCH_LIFECYCLE_V2.CANCELLED,
]);

const _profilesV2 = new Map();
const _dispatchesV2 = new Map();
let _maxActiveProfilesPerOwnerRouterV2 = 8;
let _maxPendingDispatchesPerProfileV2 = 16;
let _profileIdleMsRouterV2 = 6 * 60 * 60 * 1000;
let _dispatchStuckMsV2 = 5 * 60 * 1000;

function _routerPosIntV2(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}

export function setMaxActiveProfilesPerOwnerRouterV2(n) {
  _maxActiveProfilesPerOwnerRouterV2 = _routerPosIntV2(
    n,
    "maxActiveProfilesPerOwner",
  );
}
export function getMaxActiveProfilesPerOwnerRouterV2() {
  return _maxActiveProfilesPerOwnerRouterV2;
}
export function setMaxPendingDispatchesPerProfileV2(n) {
  _maxPendingDispatchesPerProfileV2 = _routerPosIntV2(
    n,
    "maxPendingDispatchesPerProfile",
  );
}
export function getMaxPendingDispatchesPerProfileV2() {
  return _maxPendingDispatchesPerProfileV2;
}
export function setProfileIdleMsRouterV2(n) {
  _profileIdleMsRouterV2 = _routerPosIntV2(n, "profileIdleMs");
}
export function getProfileIdleMsRouterV2() {
  return _profileIdleMsRouterV2;
}
export function setDispatchStuckMsV2(n) {
  _dispatchStuckMsV2 = _routerPosIntV2(n, "dispatchStuckMs");
}
export function getDispatchStuckMsV2() {
  return _dispatchStuckMsV2;
}

export function _resetStateAgentRouterV2() {
  _profilesV2.clear();
  _dispatchesV2.clear();
  _maxActiveProfilesPerOwnerRouterV2 = 8;
  _maxPendingDispatchesPerProfileV2 = 16;
  _profileIdleMsRouterV2 = 6 * 60 * 60 * 1000;
  _dispatchStuckMsV2 = 5 * 60 * 1000;
}

export function registerRouterProfileV2({
  id,
  owner,
  strategy,
  metadata,
} = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_profilesV2.has(id)) throw new Error(`profile ${id} already registered`);
  const now = Date.now();
  const profile = {
    id,
    owner,
    strategy: strategy || "round-robin",
    status: ROUTER_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    retiredAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _profilesV2.set(id, profile);
  return { ...profile, metadata: { ...profile.metadata } };
}

function _routerCheckTransition(from, to) {
  const allowed = _profileTransitionsV2.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid profile transition ${from} → ${to}`);
}

function _countActiveProfilesByOwner(owner) {
  let n = 0;
  for (const p of _profilesV2.values()) {
    if (p.owner === owner && p.status === ROUTER_PROFILE_MATURITY_V2.ACTIVE)
      n++;
  }
  return n;
}

export function activateRouterProfileV2(id) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  _routerCheckTransition(p.status, ROUTER_PROFILE_MATURITY_V2.ACTIVE);
  const isRecovery = p.status === ROUTER_PROFILE_MATURITY_V2.DEGRADED;
  if (!isRecovery) {
    const active = _countActiveProfilesByOwner(p.owner);
    if (active >= _maxActiveProfilesPerOwnerRouterV2) {
      throw new Error(
        `max active profiles per owner (${_maxActiveProfilesPerOwnerRouterV2}) reached for ${p.owner}`,
      );
    }
  }
  const now = Date.now();
  p.status = ROUTER_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function degradeRouterProfileV2(id) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  _routerCheckTransition(p.status, ROUTER_PROFILE_MATURITY_V2.DEGRADED);
  const now = Date.now();
  p.status = ROUTER_PROFILE_MATURITY_V2.DEGRADED;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function retireRouterProfileV2(id) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  _routerCheckTransition(p.status, ROUTER_PROFILE_MATURITY_V2.RETIRED);
  const now = Date.now();
  p.status = ROUTER_PROFILE_MATURITY_V2.RETIRED;
  p.updatedAt = now;
  if (!p.retiredAt) p.retiredAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function touchRouterProfileV2(id) {
  const p = _profilesV2.get(id);
  if (!p) throw new Error(`profile ${id} not found`);
  if (_profileTerminalV2.has(p.status))
    throw new Error(`cannot touch terminal profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}

export function getRouterProfileV2(id) {
  const p = _profilesV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}

export function listRouterProfilesV2() {
  return [..._profilesV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}

function _countPendingDispatchesByProfile(profileId) {
  let n = 0;
  for (const d of _dispatchesV2.values()) {
    if (
      d.profileId === profileId &&
      (d.status === ROUTER_DISPATCH_LIFECYCLE_V2.QUEUED ||
        d.status === ROUTER_DISPATCH_LIFECYCLE_V2.DISPATCHING)
    )
      n++;
  }
  return n;
}

export function createDispatchV2({ id, profileId, task, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string")
    throw new Error("profileId is required");
  if (_dispatchesV2.has(id)) throw new Error(`dispatch ${id} already exists`);
  const profile = _profilesV2.get(profileId);
  if (!profile) throw new Error(`profile ${profileId} not found`);
  const pending = _countPendingDispatchesByProfile(profileId);
  if (pending >= _maxPendingDispatchesPerProfileV2) {
    throw new Error(
      `max pending dispatches per profile (${_maxPendingDispatchesPerProfileV2}) reached for ${profileId}`,
    );
  }
  const now = Date.now();
  const d = {
    id,
    profileId,
    task: task || "",
    status: ROUTER_DISPATCH_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    dispatchedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _dispatchesV2.set(id, d);
  return { ...d, metadata: { ...d.metadata } };
}

function _dispatchCheckTransition(from, to) {
  const allowed = _dispatchTransitionsV2.get(from);
  if (!allowed || !allowed.has(to))
    throw new Error(`invalid dispatch transition ${from} → ${to}`);
}

export function dispatchDispatchV2(id) {
  const d = _dispatchesV2.get(id);
  if (!d) throw new Error(`dispatch ${id} not found`);
  _dispatchCheckTransition(d.status, ROUTER_DISPATCH_LIFECYCLE_V2.DISPATCHING);
  const now = Date.now();
  d.status = ROUTER_DISPATCH_LIFECYCLE_V2.DISPATCHING;
  d.updatedAt = now;
  if (!d.dispatchedAt) d.dispatchedAt = now;
  return { ...d, metadata: { ...d.metadata } };
}

export function completeDispatchV2(id) {
  const d = _dispatchesV2.get(id);
  if (!d) throw new Error(`dispatch ${id} not found`);
  _dispatchCheckTransition(d.status, ROUTER_DISPATCH_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  d.status = ROUTER_DISPATCH_LIFECYCLE_V2.COMPLETED;
  d.updatedAt = now;
  if (!d.settledAt) d.settledAt = now;
  return { ...d, metadata: { ...d.metadata } };
}

export function failDispatchV2(id, reason) {
  const d = _dispatchesV2.get(id);
  if (!d) throw new Error(`dispatch ${id} not found`);
  _dispatchCheckTransition(d.status, ROUTER_DISPATCH_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  d.status = ROUTER_DISPATCH_LIFECYCLE_V2.FAILED;
  d.updatedAt = now;
  if (!d.settledAt) d.settledAt = now;
  if (reason) d.metadata.failReason = String(reason);
  return { ...d, metadata: { ...d.metadata } };
}

export function cancelDispatchV2(id, reason) {
  const d = _dispatchesV2.get(id);
  if (!d) throw new Error(`dispatch ${id} not found`);
  _dispatchCheckTransition(d.status, ROUTER_DISPATCH_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  d.status = ROUTER_DISPATCH_LIFECYCLE_V2.CANCELLED;
  d.updatedAt = now;
  if (!d.settledAt) d.settledAt = now;
  if (reason) d.metadata.cancelReason = String(reason);
  return { ...d, metadata: { ...d.metadata } };
}

export function getDispatchV2(id) {
  const d = _dispatchesV2.get(id);
  if (!d) return null;
  return { ...d, metadata: { ...d.metadata } };
}

export function listDispatchesV2() {
  return [..._dispatchesV2.values()].map((d) => ({
    ...d,
    metadata: { ...d.metadata },
  }));
}

export function autoDegradeIdleProfilesRouterV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _profilesV2.values()) {
    if (
      p.status === ROUTER_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _profileIdleMsRouterV2
    ) {
      p.status = ROUTER_PROFILE_MATURITY_V2.DEGRADED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function autoFailStuckDispatchesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const d of _dispatchesV2.values()) {
    if (
      d.status === ROUTER_DISPATCH_LIFECYCLE_V2.DISPATCHING &&
      d.dispatchedAt != null &&
      t - d.dispatchedAt >= _dispatchStuckMsV2
    ) {
      d.status = ROUTER_DISPATCH_LIFECYCLE_V2.FAILED;
      d.updatedAt = t;
      if (!d.settledAt) d.settledAt = t;
      d.metadata.failReason = "auto-fail-stuck";
      flipped.push(d.id);
    }
  }
  return { flipped, count: flipped.length };
}

export function getAgentRouterStatsV2() {
  const profilesByStatus = {};
  for (const s of Object.values(ROUTER_PROFILE_MATURITY_V2))
    profilesByStatus[s] = 0;
  for (const p of _profilesV2.values()) profilesByStatus[p.status]++;
  const dispatchesByStatus = {};
  for (const s of Object.values(ROUTER_DISPATCH_LIFECYCLE_V2))
    dispatchesByStatus[s] = 0;
  for (const d of _dispatchesV2.values()) dispatchesByStatus[d.status]++;
  return {
    totalProfilesV2: _profilesV2.size,
    totalDispatchesV2: _dispatchesV2.size,
    maxActiveProfilesPerOwner: _maxActiveProfilesPerOwnerRouterV2,
    maxPendingDispatchesPerProfile: _maxPendingDispatchesPerProfileV2,
    profileIdleMs: _profileIdleMsRouterV2,
    dispatchStuckMs: _dispatchStuckMsV2,
    profilesByStatus,
    dispatchesByStatus,
  };
}

// =====================================================================
// agent-router V2 governance overlay (iter25)
// =====================================================================
export const ARGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  STALE: "stale",
  ARCHIVED: "archived",
});
export const ARGOV_ROUTING_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  ROUTING_RUN: "routing",
  ROUTED: "routed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _argovPTrans = new Map([
  [
    ARGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      ARGOV_PROFILE_MATURITY_V2.ACTIVE,
      ARGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    ARGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      ARGOV_PROFILE_MATURITY_V2.STALE,
      ARGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    ARGOV_PROFILE_MATURITY_V2.STALE,
    new Set([
      ARGOV_PROFILE_MATURITY_V2.ACTIVE,
      ARGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [ARGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _argovPTerminal = new Set([ARGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _argovJTrans = new Map([
  [
    ARGOV_ROUTING_LIFECYCLE_V2.QUEUED,
    new Set([
      ARGOV_ROUTING_LIFECYCLE_V2.ROUTING_RUN,
      ARGOV_ROUTING_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    ARGOV_ROUTING_LIFECYCLE_V2.ROUTING_RUN,
    new Set([
      ARGOV_ROUTING_LIFECYCLE_V2.ROUTED,
      ARGOV_ROUTING_LIFECYCLE_V2.FAILED,
      ARGOV_ROUTING_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [ARGOV_ROUTING_LIFECYCLE_V2.ROUTED, new Set()],
  [ARGOV_ROUTING_LIFECYCLE_V2.FAILED, new Set()],
  [ARGOV_ROUTING_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _argovPsV2 = new Map();
const _argovJsV2 = new Map();
let _argovMaxActive = 8,
  _argovMaxPending = 20,
  _argovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _argovStuckMs = 60 * 1000;
function _argovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _argovCheckP(from, to) {
  const a = _argovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid argov profile transition ${from} → ${to}`);
}
function _argovCheckJ(from, to) {
  const a = _argovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid argov routing transition ${from} → ${to}`);
}
function _argovCountActive(owner) {
  let c = 0;
  for (const p of _argovPsV2.values())
    if (p.owner === owner && p.status === ARGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _argovCountPending(profileId) {
  let c = 0;
  for (const j of _argovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === ARGOV_ROUTING_LIFECYCLE_V2.QUEUED ||
        j.status === ARGOV_ROUTING_LIFECYCLE_V2.ROUTING_RUN)
    )
      c++;
  return c;
}
export function setMaxActiveArgovProfilesPerOwnerV2(n) {
  _argovMaxActive = _argovPos(n, "maxActiveArgovProfilesPerOwner");
}
export function getMaxActiveArgovProfilesPerOwnerV2() {
  return _argovMaxActive;
}
export function setMaxPendingArgovRoutingsPerProfileV2(n) {
  _argovMaxPending = _argovPos(n, "maxPendingArgovRoutingsPerProfile");
}
export function getMaxPendingArgovRoutingsPerProfileV2() {
  return _argovMaxPending;
}
export function setArgovProfileIdleMsV2(n) {
  _argovIdleMs = _argovPos(n, "argovProfileIdleMs");
}
export function getArgovProfileIdleMsV2() {
  return _argovIdleMs;
}
export function setArgovRoutingStuckMsV2(n) {
  _argovStuckMs = _argovPos(n, "argovRoutingStuckMs");
}
export function getArgovRoutingStuckMsV2() {
  return _argovStuckMs;
}
export function _resetStateAgentRouterGovV2() {
  _argovPsV2.clear();
  _argovJsV2.clear();
  _argovMaxActive = 8;
  _argovMaxPending = 20;
  _argovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _argovStuckMs = 60 * 1000;
}
export function registerArgovProfileV2({ id, owner, strategy, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_argovPsV2.has(id)) throw new Error(`argov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    strategy: strategy || "round-robin",
    status: ARGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _argovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateArgovProfileV2(id) {
  const p = _argovPsV2.get(id);
  if (!p) throw new Error(`argov profile ${id} not found`);
  const isInitial = p.status === ARGOV_PROFILE_MATURITY_V2.PENDING;
  _argovCheckP(p.status, ARGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _argovCountActive(p.owner) >= _argovMaxActive)
    throw new Error(`max active argov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = ARGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleArgovProfileV2(id) {
  const p = _argovPsV2.get(id);
  if (!p) throw new Error(`argov profile ${id} not found`);
  _argovCheckP(p.status, ARGOV_PROFILE_MATURITY_V2.STALE);
  p.status = ARGOV_PROFILE_MATURITY_V2.STALE;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveArgovProfileV2(id) {
  const p = _argovPsV2.get(id);
  if (!p) throw new Error(`argov profile ${id} not found`);
  _argovCheckP(p.status, ARGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = ARGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchArgovProfileV2(id) {
  const p = _argovPsV2.get(id);
  if (!p) throw new Error(`argov profile ${id} not found`);
  if (_argovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal argov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getArgovProfileV2(id) {
  const p = _argovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listArgovProfilesV2() {
  return [..._argovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createArgovRoutingV2({ id, profileId, target, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_argovJsV2.has(id)) throw new Error(`argov routing ${id} already exists`);
  if (!_argovPsV2.has(profileId))
    throw new Error(`argov profile ${profileId} not found`);
  if (_argovCountPending(profileId) >= _argovMaxPending)
    throw new Error(
      `max pending argov routings for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    target: target || "",
    status: ARGOV_ROUTING_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _argovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function runningArgovRoutingV2(id) {
  const j = _argovJsV2.get(id);
  if (!j) throw new Error(`argov routing ${id} not found`);
  _argovCheckJ(j.status, ARGOV_ROUTING_LIFECYCLE_V2.ROUTING_RUN);
  const now = Date.now();
  j.status = ARGOV_ROUTING_LIFECYCLE_V2.ROUTING_RUN;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeRoutingArgovV2(id) {
  const j = _argovJsV2.get(id);
  if (!j) throw new Error(`argov routing ${id} not found`);
  _argovCheckJ(j.status, ARGOV_ROUTING_LIFECYCLE_V2.ROUTED);
  const now = Date.now();
  j.status = ARGOV_ROUTING_LIFECYCLE_V2.ROUTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failArgovRoutingV2(id, reason) {
  const j = _argovJsV2.get(id);
  if (!j) throw new Error(`argov routing ${id} not found`);
  _argovCheckJ(j.status, ARGOV_ROUTING_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = ARGOV_ROUTING_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelArgovRoutingV2(id, reason) {
  const j = _argovJsV2.get(id);
  if (!j) throw new Error(`argov routing ${id} not found`);
  _argovCheckJ(j.status, ARGOV_ROUTING_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = ARGOV_ROUTING_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getArgovRoutingV2(id) {
  const j = _argovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listArgovRoutingsV2() {
  return [..._argovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoStaleIdleArgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _argovPsV2.values())
    if (
      p.status === ARGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _argovIdleMs
    ) {
      p.status = ARGOV_PROFILE_MATURITY_V2.STALE;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckArgovRoutingsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _argovJsV2.values())
    if (
      j.status === ARGOV_ROUTING_LIFECYCLE_V2.ROUTING_RUN &&
      j.startedAt != null &&
      t - j.startedAt >= _argovStuckMs
    ) {
      j.status = ARGOV_ROUTING_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getAgentRouterGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(ARGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _argovPsV2.values()) profilesByStatus[p.status]++;
  const routingsByStatus = {};
  for (const v of Object.values(ARGOV_ROUTING_LIFECYCLE_V2))
    routingsByStatus[v] = 0;
  for (const j of _argovJsV2.values()) routingsByStatus[j.status]++;
  return {
    totalArgovProfilesV2: _argovPsV2.size,
    totalArgovRoutingsV2: _argovJsV2.size,
    maxActiveArgovProfilesPerOwner: _argovMaxActive,
    maxPendingArgovRoutingsPerProfile: _argovMaxPending,
    argovProfileIdleMs: _argovIdleMs,
    argovRoutingStuckMs: _argovStuckMs,
    profilesByStatus,
    routingsByStatus,
  };
}
