/**
 * Claude Code Bridge — spawns Claude Code CLI processes as execution agents.
 *
 * ChainlessChain (orchestrator) dispatches coding tasks to one or more
 * `claude` CLI sub-processes that run non-interactively, capturing their
 * output and returning structured results.
 *
 * Usage:
 *   const pool = new ClaudeCodePool({ maxParallel: 3 });
 *   const results = await pool.dispatch([
 *     { id: "t1", description: "Fix the null check in auth.js" },
 *     { id: "t2", description: "Add unit tests for login flow" },
 *   ], { cwd: "/path/to/project" });
 */

import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";

/* ---------- _deps injection (Vitest CJS mock pattern) ---------- */
export const _deps = { spawn, execSync };

// ─── Agent status constants ───────────────────────────────────────

export const AGENT_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  TIMEOUT: "timeout",
};

// ─── Detection ───────────────────────────────────────────────────

/**
 * Check if the `claude` CLI is installed and return version info.
 * Returns { found: boolean, version?: string, path?: string }.
 */
export function detectClaudeCode() {
  try {
    const version = _deps
      .execSync("claude --version", { encoding: "utf-8", timeout: 5000 })
      .trim();
    return { found: true, version };
  } catch (_err) {
    return { found: false };
  }
}

/**
 * Check if the `codex` CLI (GitHub Copilot Coding Agent) is installed.
 * Returns { found: boolean, version?: string }.
 */
export function detectCodex() {
  try {
    const version = _deps
      .execSync("codex --version", { encoding: "utf-8", timeout: 5000 })
      .trim();
    return { found: true, version };
  } catch (_err) {
    return { found: false };
  }
}

// ─── Single Agent ─────────────────────────────────────────────────

/**
 * A single Claude Code CLI execution agent.
 * Wraps `claude -p "<task>" --output-format stream-json` as a child process.
 */
export class ClaudeCodeAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id =
      options.id ||
      `cc-agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.cliCommand = options.cliCommand || "claude"; // "claude" or "codex"
    this.model = options.model || null;
    this.status = AGENT_STATUS.IDLE;
    this.currentTask = null;
    this._proc = null;
  }

  /**
   * Execute a coding task non-interactively.
   *
   * @param {string} taskDescription - Natural language task for Claude Code
   * @param {object} options
   * @param {string} options.cwd         - Project root directory
   * @param {number} options.timeout     - Max ms to wait (default 300_000 = 5 min)
   * @param {string} options.context     - Extra context prepended to task
   * @param {string} options.allowedTools - Comma-separated tool allow-list
   * @returns {Promise<{success, output, exitCode, duration, taskId}>}
   */
  async executeTask(taskDescription, options = {}) {
    const {
      cwd = process.cwd(),
      timeout = 300_000,
      context = "",
      allowedTools = null,
    } = options;

    const fullPrompt = context
      ? `Context:\n${context}\n\nTask:\n${taskDescription}`
      : taskDescription;

    this.status = AGENT_STATUS.RUNNING;
    this.currentTask = taskDescription;
    this.emit("task:start", { agentId: this.id, task: taskDescription });

    const args = ["-p", fullPrompt, "--output-format", "stream-json"];
    if (this.model) {
      args.push("--model", this.model);
    }
    if (allowedTools) {
      args.push("--allowedTools", allowedTools);
    }

    return new Promise((resolve) => {
      const startTime = Date.now();
      const outputChunks = [];
      const errorChunks = [];
      let timedOut = false;

      const proc = _deps.spawn(this.cliCommand, args, {
        cwd,
        env: { ...process.env },
        windowsHide: true,
      });
      this._proc = proc;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 3000);
      }, timeout);

      proc.stdout.on("data", (data) => {
        const chunk = data.toString("utf8");
        outputChunks.push(chunk);
        this.emit("output", { agentId: this.id, chunk });
      });

      proc.stderr.on("data", (data) => {
        errorChunks.push(data.toString("utf8"));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        this._proc = null;
        const duration = Date.now() - startTime;
        const rawOutput = outputChunks.join("");
        const status = timedOut
          ? AGENT_STATUS.TIMEOUT
          : code === 0
            ? AGENT_STATUS.COMPLETED
            : AGENT_STATUS.FAILED;

        this.status = status;
        this.currentTask = null;

        // Parse stream-json output: last assistant message is the result
        const parsedOutput = _parseStreamJson(rawOutput);

        const result = {
          success: code === 0 && !timedOut,
          output: parsedOutput || rawOutput.slice(-4000), // last 4K chars fallback
          rawOutput,
          exitCode: code,
          duration,
          timedOut,
          agentId: this.id,
          stderr: errorChunks.join("").slice(-2000),
        };

        this.emit("task:complete", result);
        resolve(result);
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        this._proc = null;
        this.status = AGENT_STATUS.FAILED;
        this.currentTask = null;
        const result = {
          success: false,
          output: "",
          exitCode: -1,
          duration: Date.now() - startTime,
          timedOut: false,
          agentId: this.id,
          error: err.message,
        };
        this.emit("task:complete", result);
        resolve(result);
      });
    });
  }

  /** Abort the currently running task. */
  abort() {
    if (this._proc) {
      this._proc.kill("SIGTERM");
    }
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      cliCommand: this.cliCommand,
      currentTask: this.currentTask,
    };
  }
}

// ─── Agent Pool ───────────────────────────────────────────────────

/**
 * Manages a pool of Claude Code agents for parallel task dispatch.
 */
export class ClaudeCodePool extends EventEmitter {
  /**
   * @param {object} options
   * @param {number}  options.maxParallel    - Max concurrent agents (default 3)
   * @param {string}  options.cliCommand     - CLI to use: "claude" or "codex"
   * @param {string}  options.model          - Model override
   * @param {number}  options.agentTimeout   - Per-agent timeout ms
   */
  constructor(options = {}) {
    super();
    this.maxParallel = options.maxParallel || 3;
    this.cliCommand = options.cliCommand || "claude";
    this.model = options.model || null;
    this.agentTimeout = options.agentTimeout || 300_000;

    /** @type {Map<string, ClaudeCodeAgent>} */
    this._agents = new Map();
    this._completed = [];
  }

  /**
   * Dispatch an array of tasks to agents in parallel batches.
   *
   * @param {Array<{id, description, context?, allowedTools?}>} tasks
   * @param {object} options
   * @param {string} options.cwd - Shared working directory for all tasks
   * @returns {Promise<Array<{taskId, agentId, success, output, duration}>>}
   */
  async dispatch(tasks, options = {}) {
    const { cwd = process.cwd() } = options;
    const results = [];

    // Process in batches of maxParallel
    for (let i = 0; i < tasks.length; i += this.maxParallel) {
      const batch = tasks.slice(i, i + this.maxParallel);
      this.emit("batch:start", {
        batchIndex: i / this.maxParallel,
        count: batch.length,
      });

      const batchResults = await Promise.all(
        batch.map((task) => this._runTask(task, { cwd })),
      );

      results.push(...batchResults);
      this.emit("batch:complete", {
        batchIndex: i / this.maxParallel,
        results: batchResults,
      });
    }

    return results;
  }

  async _runTask(task, { cwd }) {
    const agent = new ClaudeCodeAgent({
      id: `agent-${task.id}`,
      cliCommand: this.cliCommand,
      model: this.model,
    });

    this._agents.set(agent.id, agent);
    agent.on("output", (ev) => this.emit("agent:output", ev));

    const result = await agent.executeTask(task.description, {
      cwd,
      timeout: this.agentTimeout,
      context: task.context || "",
      allowedTools: task.allowedTools || null,
    });

    this._agents.delete(agent.id);
    this._completed.push({ ...result, taskId: task.id });

    this.emit("agent:complete", { taskId: task.id, ...result });
    return { taskId: task.id, ...result };
  }

  /** Current pool status snapshot. */
  status() {
    const active = [...this._agents.values()].map((a) => a.toJSON());
    return {
      active,
      activeCount: active.length,
      maxParallel: this.maxParallel,
      cliCommand: this.cliCommand,
    };
  }

  /** Abort all running agents. */
  abortAll() {
    for (const agent of this._agents.values()) {
      agent.abort();
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Parse Claude Code stream-json output and extract the last assistant text.
 * Stream-json lines look like:  {"type":"assistant","message":{...}}
 */
function _parseStreamJson(raw) {
  if (!raw) return "";
  const lines = raw.split("\n").filter(Boolean);
  let lastText = "";

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // stream-json: result message has type "result"
      if (obj.type === "result" && obj.result) {
        return typeof obj.result === "string"
          ? obj.result
          : JSON.stringify(obj.result);
      }
      // assistant message blocks
      if (obj.type === "assistant" && obj.message?.content) {
        const blocks = obj.message.content;
        const textBlocks = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        if (textBlocks) lastText = textBlocks;
      }
    } catch (_err) {
      // Non-JSON line (progress text) — ignore
    }
  }

  return lastText;
}

// =====================================================================
// claude-code-bridge V2 governance overlay (iter17)
// =====================================================================
export const CCBGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DEGRADED: "degraded",
  ARCHIVED: "archived",
});
export const CCBGOV_INVOCATION_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _ccbgovPTrans = new Map([
  [
    CCBGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CCBGOV_PROFILE_MATURITY_V2.ACTIVE,
      CCBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CCBGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CCBGOV_PROFILE_MATURITY_V2.DEGRADED,
      CCBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CCBGOV_PROFILE_MATURITY_V2.DEGRADED,
    new Set([
      CCBGOV_PROFILE_MATURITY_V2.ACTIVE,
      CCBGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CCBGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _ccbgovPTerminal = new Set([CCBGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _ccbgovJTrans = new Map([
  [
    CCBGOV_INVOCATION_LIFECYCLE_V2.QUEUED,
    new Set([
      CCBGOV_INVOCATION_LIFECYCLE_V2.RUNNING,
      CCBGOV_INVOCATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    CCBGOV_INVOCATION_LIFECYCLE_V2.RUNNING,
    new Set([
      CCBGOV_INVOCATION_LIFECYCLE_V2.COMPLETED,
      CCBGOV_INVOCATION_LIFECYCLE_V2.FAILED,
      CCBGOV_INVOCATION_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CCBGOV_INVOCATION_LIFECYCLE_V2.COMPLETED, new Set()],
  [CCBGOV_INVOCATION_LIFECYCLE_V2.FAILED, new Set()],
  [CCBGOV_INVOCATION_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _ccbgovPsV2 = new Map();
const _ccbgovJsV2 = new Map();
let _ccbgovMaxActive = 6,
  _ccbgovMaxPending = 15,
  _ccbgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _ccbgovStuckMs = 60 * 1000;
function _ccbgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _ccbgovCheckP(from, to) {
  const a = _ccbgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ccbgov profile transition ${from} → ${to}`);
}
function _ccbgovCheckJ(from, to) {
  const a = _ccbgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid ccbgov invocation transition ${from} → ${to}`);
}
function _ccbgovCountActive(owner) {
  let c = 0;
  for (const p of _ccbgovPsV2.values())
    if (p.owner === owner && p.status === CCBGOV_PROFILE_MATURITY_V2.ACTIVE)
      c++;
  return c;
}
function _ccbgovCountPending(profileId) {
  let c = 0;
  for (const j of _ccbgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CCBGOV_INVOCATION_LIFECYCLE_V2.QUEUED ||
        j.status === CCBGOV_INVOCATION_LIFECYCLE_V2.RUNNING)
    )
      c++;
  return c;
}
export function setMaxActiveCcbgovProfilesPerOwnerV2(n) {
  _ccbgovMaxActive = _ccbgovPos(n, "maxActiveCcbgovProfilesPerOwner");
}
export function getMaxActiveCcbgovProfilesPerOwnerV2() {
  return _ccbgovMaxActive;
}
export function setMaxPendingCcbgovInvocationsPerProfileV2(n) {
  _ccbgovMaxPending = _ccbgovPos(n, "maxPendingCcbgovInvocationsPerProfile");
}
export function getMaxPendingCcbgovInvocationsPerProfileV2() {
  return _ccbgovMaxPending;
}
export function setCcbgovProfileIdleMsV2(n) {
  _ccbgovIdleMs = _ccbgovPos(n, "ccbgovProfileIdleMs");
}
export function getCcbgovProfileIdleMsV2() {
  return _ccbgovIdleMs;
}
export function setCcbgovInvocationStuckMsV2(n) {
  _ccbgovStuckMs = _ccbgovPos(n, "ccbgovInvocationStuckMs");
}
export function getCcbgovInvocationStuckMsV2() {
  return _ccbgovStuckMs;
}
export function _resetStateClaudeCodeBridgeV2() {
  _ccbgovPsV2.clear();
  _ccbgovJsV2.clear();
  _ccbgovMaxActive = 6;
  _ccbgovMaxPending = 15;
  _ccbgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _ccbgovStuckMs = 60 * 1000;
}
export function registerCcbgovProfileV2({ id, owner, channel, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_ccbgovPsV2.has(id))
    throw new Error(`ccbgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    channel: channel || "stdio",
    status: CCBGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ccbgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCcbgovProfileV2(id) {
  const p = _ccbgovPsV2.get(id);
  if (!p) throw new Error(`ccbgov profile ${id} not found`);
  const isInitial = p.status === CCBGOV_PROFILE_MATURITY_V2.PENDING;
  _ccbgovCheckP(p.status, CCBGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _ccbgovCountActive(p.owner) >= _ccbgovMaxActive)
    throw new Error(`max active ccbgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CCBGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function degradeCcbgovProfileV2(id) {
  const p = _ccbgovPsV2.get(id);
  if (!p) throw new Error(`ccbgov profile ${id} not found`);
  _ccbgovCheckP(p.status, CCBGOV_PROFILE_MATURITY_V2.DEGRADED);
  p.status = CCBGOV_PROFILE_MATURITY_V2.DEGRADED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCcbgovProfileV2(id) {
  const p = _ccbgovPsV2.get(id);
  if (!p) throw new Error(`ccbgov profile ${id} not found`);
  _ccbgovCheckP(p.status, CCBGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CCBGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCcbgovProfileV2(id) {
  const p = _ccbgovPsV2.get(id);
  if (!p) throw new Error(`ccbgov profile ${id} not found`);
  if (_ccbgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal ccbgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCcbgovProfileV2(id) {
  const p = _ccbgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCcbgovProfilesV2() {
  return [..._ccbgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCcbgovInvocationV2({
  id,
  profileId,
  command,
  metadata,
} = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_ccbgovJsV2.has(id))
    throw new Error(`ccbgov invocation ${id} already exists`);
  if (!_ccbgovPsV2.has(profileId))
    throw new Error(`ccbgov profile ${profileId} not found`);
  if (_ccbgovCountPending(profileId) >= _ccbgovMaxPending)
    throw new Error(
      `max pending ccbgov invocations for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    command: command || "",
    status: CCBGOV_INVOCATION_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _ccbgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function runningCcbgovInvocationV2(id) {
  const j = _ccbgovJsV2.get(id);
  if (!j) throw new Error(`ccbgov invocation ${id} not found`);
  _ccbgovCheckJ(j.status, CCBGOV_INVOCATION_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = CCBGOV_INVOCATION_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeInvocationCcbgovV2(id) {
  const j = _ccbgovJsV2.get(id);
  if (!j) throw new Error(`ccbgov invocation ${id} not found`);
  _ccbgovCheckJ(j.status, CCBGOV_INVOCATION_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  j.status = CCBGOV_INVOCATION_LIFECYCLE_V2.COMPLETED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCcbgovInvocationV2(id, reason) {
  const j = _ccbgovJsV2.get(id);
  if (!j) throw new Error(`ccbgov invocation ${id} not found`);
  _ccbgovCheckJ(j.status, CCBGOV_INVOCATION_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CCBGOV_INVOCATION_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCcbgovInvocationV2(id, reason) {
  const j = _ccbgovJsV2.get(id);
  if (!j) throw new Error(`ccbgov invocation ${id} not found`);
  _ccbgovCheckJ(j.status, CCBGOV_INVOCATION_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CCBGOV_INVOCATION_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCcbgovInvocationV2(id) {
  const j = _ccbgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCcbgovInvocationsV2() {
  return [..._ccbgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDegradeIdleCcbgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _ccbgovPsV2.values())
    if (
      p.status === CCBGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _ccbgovIdleMs
    ) {
      p.status = CCBGOV_PROFILE_MATURITY_V2.DEGRADED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCcbgovInvocationsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _ccbgovJsV2.values())
    if (
      j.status === CCBGOV_INVOCATION_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _ccbgovStuckMs
    ) {
      j.status = CCBGOV_INVOCATION_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getClaudeCodeBridgeGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CCBGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _ccbgovPsV2.values()) profilesByStatus[p.status]++;
  const invocationsByStatus = {};
  for (const v of Object.values(CCBGOV_INVOCATION_LIFECYCLE_V2))
    invocationsByStatus[v] = 0;
  for (const j of _ccbgovJsV2.values()) invocationsByStatus[j.status]++;
  return {
    totalCcbgovProfilesV2: _ccbgovPsV2.size,
    totalCcbgovInvocationsV2: _ccbgovJsV2.size,
    maxActiveCcbgovProfilesPerOwner: _ccbgovMaxActive,
    maxPendingCcbgovInvocationsPerProfile: _ccbgovMaxPending,
    ccbgovProfileIdleMs: _ccbgovIdleMs,
    ccbgovInvocationStuckMs: _ccbgovStuckMs,
    profilesByStatus,
    invocationsByStatus,
  };
}
