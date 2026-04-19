/**
 * CLI Autonomous Agent — ReAct-style self-directed task execution.
 *
 * Submits a goal → decomposes into sub-steps → runs Reason→Act→Observe loop
 * with self-correction on failure. Single-goal, session-scoped.
 *
 * Lightweight port of desktop-app-vue/src/main/ai-engine/autonomous/autonomous-agent-runner.js
 */

import { EventEmitter } from "events";

// Exported for test injection
export const _deps = {
  Date,
};

/**
 * Goal status
 */
export const GoalStatus = {
  PENDING: "pending",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/**
 * Step status
 */
export const StepStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
};

export class CLIAutonomousAgent extends EventEmitter {
  constructor() {
    super();
    this._goals = new Map();
    this._llmChat = null;
    this._toolExecutor = null;
    this._hookManager = null;
    this._initialized = false;
    this._maxIterations = 20;
    this._maxRetries = 3;
  }

  /**
   * Initialize with required dependencies.
   */
  initialize({
    llmChat,
    toolExecutor,
    hookManager,
    maxIterations,
    iterationBudget,
  } = {}) {
    this._llmChat = llmChat || null;
    this._toolExecutor = toolExecutor || null;
    this._hookManager = hookManager || null;
    if (maxIterations) this._maxIterations = maxIterations;
    this._iterationBudget = iterationBudget || null; // shared budget from caller
    this._initialized = true;
  }

  /**
   * Submit a goal for autonomous execution.
   * @param {string} description - Natural language goal
   * @param {object} [options]
   * @param {number} [options.tokenBudget=50000] - Advisory token budget
   * @returns {{ goalId: string }}
   */
  async submitGoal(description, { tokenBudget = 50000 } = {}) {
    if (!this._initialized) throw new Error("Agent not initialized");
    if (!description) throw new Error("Goal description required");

    const goalId = `goal-${_deps.Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const goal = {
      id: goalId,
      description,
      status: GoalStatus.PENDING,
      tokenBudget,
      tokensUsed: 0,
      steps: [],
      iterations: 0,
      errors: [],
      result: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this._goals.set(goalId, goal);
    this.emit("goal:submitted", { goalId, description });

    // Start the ReAct loop asynchronously
    this._runReActLoop(goal).catch((err) => {
      goal.status = GoalStatus.FAILED;
      goal.errors.push(err.message);
      this.emit("goal:failed", { goalId, error: err.message });
    });

    return { goalId };
  }

  /**
   * Pause a running goal.
   */
  pauseGoal(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return { error: "Goal not found" };
    if (goal.status !== GoalStatus.RUNNING)
      return { error: "Goal is not running" };

    goal.status = GoalStatus.PAUSED;
    goal.updatedAt = new Date().toISOString();
    this.emit("goal:paused", { goalId });
    return { success: true };
  }

  /**
   * Resume a paused goal.
   */
  resumeGoal(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return { error: "Goal not found" };
    if (goal.status !== GoalStatus.PAUSED)
      return { error: "Goal is not paused" };

    goal.status = GoalStatus.RUNNING;
    goal.updatedAt = new Date().toISOString();
    this.emit("goal:resumed", { goalId });

    // Continue the loop
    this._runReActLoop(goal).catch((err) => {
      goal.status = GoalStatus.FAILED;
      goal.errors.push(err.message);
    });

    return { success: true };
  }

  /**
   * Cancel a goal.
   */
  cancelGoal(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return { error: "Goal not found" };

    goal.status = GoalStatus.CANCELLED;
    goal.updatedAt = new Date().toISOString();
    this.emit("goal:cancelled", { goalId });
    return { success: true };
  }

  /**
   * Get goal status with steps.
   */
  getGoalStatus(goalId) {
    const goal = this._goals.get(goalId);
    if (!goal) return null;

    return {
      id: goal.id,
      description: goal.description,
      status: goal.status,
      steps: goal.steps.map((s) => ({
        description: s.description,
        status: s.status,
        tool: s.tool,
        result: s.result ? String(s.result).substring(0, 200) : null,
        error: s.error,
      })),
      iterations: goal.iterations,
      errors: goal.errors,
      result: goal.result,
      tokensUsed: goal.tokensUsed,
    };
  }

  /**
   * List all goals.
   */
  listGoals() {
    return [...this._goals.values()].map((g) => ({
      id: g.id,
      description: g.description.substring(0, 80),
      status: g.status,
      steps: g.steps.length,
      iterations: g.iterations,
    }));
  }

  // ─── ReAct Loop ─────────────────────────────────────────────

  async _runReActLoop(goal) {
    goal.status = GoalStatus.RUNNING;
    this.emit("goal:started", { goalId: goal.id });

    // Decompose goal into initial steps
    if (goal.steps.length === 0) {
      goal.steps = await this._decomposeGoal(goal);
      this.emit("goal:planned", {
        goalId: goal.id,
        stepCount: goal.steps.length,
      });
    }

    while (
      goal.status === GoalStatus.RUNNING &&
      goal.iterations < this._maxIterations
    ) {
      goal.iterations++;

      // Find next pending step
      const nextStep = goal.steps.find((s) => s.status === StepStatus.PENDING);
      if (!nextStep) {
        // All steps done or no pending steps
        const allDone = goal.steps.every(
          (s) =>
            s.status === StepStatus.COMPLETED ||
            s.status === StepStatus.SKIPPED,
        );
        if (allDone) {
          goal.status = GoalStatus.COMPLETED;
          goal.result = this._summarizeResults(goal);
          this.emit("goal:completed", { goalId: goal.id, result: goal.result });
        } else {
          goal.status = GoalStatus.FAILED;
          goal.errors.push("Not all steps completed");
          this.emit("goal:failed", {
            goalId: goal.id,
            error: "Not all steps completed",
          });
        }
        break;
      }

      // Execute step
      nextStep.status = StepStatus.RUNNING;
      this.emit("step:started", {
        goalId: goal.id,
        step: nextStep.description,
      });

      try {
        const result = await this._executeStep(nextStep);
        nextStep.status = StepStatus.COMPLETED;
        nextStep.result = result;
        this.emit("step:completed", {
          goalId: goal.id,
          step: nextStep.description,
        });
      } catch (err) {
        nextStep.error = err.message;

        // Self-correction: try to replan
        if (nextStep.retries < this._maxRetries) {
          nextStep.retries++;
          this.emit("step:retrying", {
            goalId: goal.id,
            step: nextStep.description,
            error: err.message,
          });

          const corrected = await this._selfCorrect(goal, err);
          if (corrected) {
            nextStep.status = StepStatus.PENDING; // Retry
            continue;
          }
        }

        nextStep.status = StepStatus.FAILED;
        this.emit("step:failed", {
          goalId: goal.id,
          step: nextStep.description,
          error: err.message,
        });

        // Check if failure is fatal
        if (nextStep.critical !== false) {
          goal.status = GoalStatus.FAILED;
          goal.errors.push(
            `Step failed: ${nextStep.description} — ${err.message}`,
          );
          this.emit("goal:failed", { goalId: goal.id, error: err.message });
          break;
        }
      }

      goal.updatedAt = new Date().toISOString();
    }

    if (
      goal.iterations >= this._maxIterations &&
      goal.status === GoalStatus.RUNNING
    ) {
      goal.status = GoalStatus.FAILED;
      goal.errors.push("Max iterations reached");
      this.emit("goal:failed", {
        goalId: goal.id,
        error: "Max iterations reached",
      });
    }
  }

  /**
   * Decompose a goal into executable steps using LLM.
   */
  async _decomposeGoal(goal) {
    if (!this._llmChat) {
      // No LLM — create a single step
      return [
        {
          description: goal.description,
          tool: null,
          params: {},
          status: StepStatus.PENDING,
          retries: 0,
          critical: true,
          result: null,
          error: null,
        },
      ];
    }

    try {
      const prompt = `Break down this goal into 2-6 concrete, executable steps. Each step should use one tool.

Goal: ${goal.description}

Available tools: read_file, write_file, edit_file, run_shell, search_files, list_dir, run_skill

Return a JSON array of steps, each with: { "description": "...", "tool": "tool_name", "params": {...} }
Only return the JSON array, no other text.`;

      const response = await this._llmChat(
        [{ role: "user", content: prompt }],
        { maxTokens: 1024 },
      );

      // Parse steps from LLM response
      const parsed = this._parseSteps(response);
      return parsed.map((s) => ({
        description: s.description || "Step",
        tool: s.tool || null,
        params: s.params || {},
        status: StepStatus.PENDING,
        retries: 0,
        critical: s.critical !== false,
        result: null,
        error: null,
      }));
    } catch (_err) {
      // Fallback: single step
      return [
        {
          description: goal.description,
          tool: null,
          params: {},
          status: StepStatus.PENDING,
          retries: 0,
          critical: true,
          result: null,
          error: null,
        },
      ];
    }
  }

  /**
   * Execute a single step using the tool executor.
   */
  async _executeStep(step) {
    if (!step.tool || !this._toolExecutor) {
      // No tool specified or no executor — skip as informational
      return "No tool action required";
    }

    return await this._toolExecutor(step.tool, step.params);
  }

  /**
   * Self-correct after a step failure.
   * Returns true if a correction was applied.
   */
  async _selfCorrect(goal, error) {
    if (!this._llmChat) return false;

    try {
      const context = goal.steps.map((s) => ({
        description: s.description,
        status: s.status,
        error: s.error,
      }));

      const prompt = `A step in my plan failed. Help me fix it.

Goal: ${goal.description}
Steps so far: ${JSON.stringify(context)}
Error: ${error.message}

Should I:
1. Retry the same step with different params
2. Add a new prerequisite step
3. Skip this step and continue

Reply with a JSON object: { "action": "retry|add_step|skip", "newParams": {...}, "newStep": {...} }`;

      const response = await this._llmChat(
        [{ role: "user", content: prompt }],
        { maxTokens: 512 },
      );

      const correction = this._parseJSON(response);
      if (!correction) return false;

      if (correction.action === "skip") {
        const failedStep = goal.steps.find(
          (s) => s.status === StepStatus.RUNNING,
        );
        if (failedStep) failedStep.status = StepStatus.SKIPPED;
        return true;
      }

      if (correction.action === "add_step" && correction.newStep) {
        const failedIdx = goal.steps.findIndex(
          (s) => s.status === StepStatus.RUNNING,
        );
        if (failedIdx >= 0) {
          goal.steps.splice(failedIdx, 0, {
            description: correction.newStep.description || "Corrective step",
            tool: correction.newStep.tool || null,
            params: correction.newStep.params || {},
            status: StepStatus.PENDING,
            retries: 0,
            critical: false,
            result: null,
            error: null,
          });
        }
        return true;
      }

      if (correction.action === "retry" && correction.newParams) {
        const failedStep = goal.steps.find(
          (s) => s.status === StepStatus.RUNNING,
        );
        if (failedStep) {
          Object.assign(failedStep.params, correction.newParams);
        }
        return true;
      }

      return false;
    } catch (_err) {
      return false;
    }
  }

  _summarizeResults(goal) {
    const completed = goal.steps.filter(
      (s) => s.status === StepStatus.COMPLETED,
    );
    return `Completed ${completed.length}/${goal.steps.length} steps for: ${goal.description}`;
  }

  _parseSteps(text) {
    try {
      // Extract JSON array from response
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        return JSON.parse(match[0]);
      }
    } catch (_err) {
      // Parse failure
    }
    return [{ description: "Execute goal", tool: null, params: {} }];
  }

  _parseJSON(text) {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_err) {
      // Parse failure
    }
    return null;
  }
}

// ===== V2 Surface: Autonomous Agent governance overlay (CLI v0.138.0) =====
export const AUTOAGENT_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const AUTOAGENT_RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _aaTrans = new Map([
  [
    AUTOAGENT_MATURITY_V2.PENDING,
    new Set([AUTOAGENT_MATURITY_V2.ACTIVE, AUTOAGENT_MATURITY_V2.ARCHIVED]),
  ],
  [
    AUTOAGENT_MATURITY_V2.ACTIVE,
    new Set([AUTOAGENT_MATURITY_V2.PAUSED, AUTOAGENT_MATURITY_V2.ARCHIVED]),
  ],
  [
    AUTOAGENT_MATURITY_V2.PAUSED,
    new Set([AUTOAGENT_MATURITY_V2.ACTIVE, AUTOAGENT_MATURITY_V2.ARCHIVED]),
  ],
  [AUTOAGENT_MATURITY_V2.ARCHIVED, new Set()],
]);
const _aaTerminal = new Set([AUTOAGENT_MATURITY_V2.ARCHIVED]);
const _aaRunTrans = new Map([
  [
    AUTOAGENT_RUN_LIFECYCLE_V2.QUEUED,
    new Set([
      AUTOAGENT_RUN_LIFECYCLE_V2.RUNNING,
      AUTOAGENT_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    AUTOAGENT_RUN_LIFECYCLE_V2.RUNNING,
    new Set([
      AUTOAGENT_RUN_LIFECYCLE_V2.COMPLETED,
      AUTOAGENT_RUN_LIFECYCLE_V2.FAILED,
      AUTOAGENT_RUN_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [AUTOAGENT_RUN_LIFECYCLE_V2.COMPLETED, new Set()],
  [AUTOAGENT_RUN_LIFECYCLE_V2.FAILED, new Set()],
  [AUTOAGENT_RUN_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _aaAgents = new Map();
const _aaRuns = new Map();
let _aaMaxActivePerOwner = 5;
let _aaMaxPendingRunsPerAgent = 10;
let _aaAgentIdleMs = 7 * 24 * 60 * 60 * 1000;
let _aaRunStuckMs = 30 * 60 * 1000;

function _aaPos(n, lbl) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${lbl} must be positive integer`);
  return v;
}

export function setMaxActiveAutoAgentsPerOwnerV2(n) {
  _aaMaxActivePerOwner = _aaPos(n, "maxActiveAutoAgentsPerOwner");
}
export function getMaxActiveAutoAgentsPerOwnerV2() {
  return _aaMaxActivePerOwner;
}
export function setMaxPendingAutoAgentRunsPerAgentV2(n) {
  _aaMaxPendingRunsPerAgent = _aaPos(n, "maxPendingAutoAgentRunsPerAgent");
}
export function getMaxPendingAutoAgentRunsPerAgentV2() {
  return _aaMaxPendingRunsPerAgent;
}
export function setAutoAgentIdleMsV2(n) {
  _aaAgentIdleMs = _aaPos(n, "autoAgentIdleMs");
}
export function getAutoAgentIdleMsV2() {
  return _aaAgentIdleMs;
}
export function setAutoAgentRunStuckMsV2(n) {
  _aaRunStuckMs = _aaPos(n, "autoAgentRunStuckMs");
}
export function getAutoAgentRunStuckMsV2() {
  return _aaRunStuckMs;
}

export function _resetStateAutonomousAgentV2() {
  _aaAgents.clear();
  _aaRuns.clear();
  _aaMaxActivePerOwner = 5;
  _aaMaxPendingRunsPerAgent = 10;
  _aaAgentIdleMs = 7 * 24 * 60 * 60 * 1000;
  _aaRunStuckMs = 30 * 60 * 1000;
}

export function registerAutoAgentV2({ id, owner, goal, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_aaAgents.has(id)) throw new Error(`auto-agent ${id} already registered`);
  const now = Date.now();
  const a = {
    id,
    owner,
    goal: goal || "",
    status: AUTOAGENT_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    activatedAt: null,
    archivedAt: null,
    lastTouchedAt: now,
    metadata: { ...(metadata || {}) },
  };
  _aaAgents.set(id, a);
  return { ...a, metadata: { ...a.metadata } };
}
function _aaCheckA(from, to) {
  const a = _aaTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid auto-agent transition ${from} → ${to}`);
}
function _aaCountActive(owner) {
  let n = 0;
  for (const a of _aaAgents.values())
    if (a.owner === owner && a.status === AUTOAGENT_MATURITY_V2.ACTIVE) n++;
  return n;
}

export function activateAutoAgentV2(id) {
  const a = _aaAgents.get(id);
  if (!a) throw new Error(`auto-agent ${id} not found`);
  _aaCheckA(a.status, AUTOAGENT_MATURITY_V2.ACTIVE);
  const recovery = a.status === AUTOAGENT_MATURITY_V2.PAUSED;
  if (!recovery) {
    const c = _aaCountActive(a.owner);
    if (c >= _aaMaxActivePerOwner)
      throw new Error(
        `max active auto-agents per owner (${_aaMaxActivePerOwner}) reached for ${a.owner}`,
      );
  }
  const now = Date.now();
  a.status = AUTOAGENT_MATURITY_V2.ACTIVE;
  a.updatedAt = now;
  a.lastTouchedAt = now;
  if (!a.activatedAt) a.activatedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function pauseAutoAgentV2(id) {
  const a = _aaAgents.get(id);
  if (!a) throw new Error(`auto-agent ${id} not found`);
  _aaCheckA(a.status, AUTOAGENT_MATURITY_V2.PAUSED);
  a.status = AUTOAGENT_MATURITY_V2.PAUSED;
  a.updatedAt = Date.now();
  return { ...a, metadata: { ...a.metadata } };
}
export function archiveAutoAgentV2(id) {
  const a = _aaAgents.get(id);
  if (!a) throw new Error(`auto-agent ${id} not found`);
  _aaCheckA(a.status, AUTOAGENT_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  a.status = AUTOAGENT_MATURITY_V2.ARCHIVED;
  a.updatedAt = now;
  if (!a.archivedAt) a.archivedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function touchAutoAgentV2(id) {
  const a = _aaAgents.get(id);
  if (!a) throw new Error(`auto-agent ${id} not found`);
  if (_aaTerminal.has(a.status))
    throw new Error(`cannot touch terminal auto-agent ${id}`);
  const now = Date.now();
  a.lastTouchedAt = now;
  a.updatedAt = now;
  return { ...a, metadata: { ...a.metadata } };
}
export function getAutoAgentV2(id) {
  const a = _aaAgents.get(id);
  if (!a) return null;
  return { ...a, metadata: { ...a.metadata } };
}
export function listAutoAgentsV2() {
  return [..._aaAgents.values()].map((a) => ({
    ...a,
    metadata: { ...a.metadata },
  }));
}

function _aaCountPendingRuns(aid) {
  let n = 0;
  for (const r of _aaRuns.values())
    if (
      r.agentId === aid &&
      (r.status === AUTOAGENT_RUN_LIFECYCLE_V2.QUEUED ||
        r.status === AUTOAGENT_RUN_LIFECYCLE_V2.RUNNING)
    )
      n++;
  return n;
}

export function createAutoAgentRunV2({ id, agentId, prompt, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!agentId || typeof agentId !== "string")
    throw new Error("agentId is required");
  if (_aaRuns.has(id)) throw new Error(`auto-agent run ${id} already exists`);
  if (!_aaAgents.has(agentId))
    throw new Error(`auto-agent ${agentId} not found`);
  const pending = _aaCountPendingRuns(agentId);
  if (pending >= _aaMaxPendingRunsPerAgent)
    throw new Error(
      `max pending auto-agent runs per agent (${_aaMaxPendingRunsPerAgent}) reached for ${agentId}`,
    );
  const now = Date.now();
  const r = {
    id,
    agentId,
    prompt: prompt || "",
    status: AUTOAGENT_RUN_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _aaRuns.set(id, r);
  return { ...r, metadata: { ...r.metadata } };
}
function _aaCheckR(from, to) {
  const a = _aaRunTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid auto-agent run transition ${from} → ${to}`);
}
export function startAutoAgentRunV2(id) {
  const r = _aaRuns.get(id);
  if (!r) throw new Error(`auto-agent run ${id} not found`);
  _aaCheckR(r.status, AUTOAGENT_RUN_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  r.status = AUTOAGENT_RUN_LIFECYCLE_V2.RUNNING;
  r.updatedAt = now;
  if (!r.startedAt) r.startedAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function completeAutoAgentRunV2(id) {
  const r = _aaRuns.get(id);
  if (!r) throw new Error(`auto-agent run ${id} not found`);
  _aaCheckR(r.status, AUTOAGENT_RUN_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  r.status = AUTOAGENT_RUN_LIFECYCLE_V2.COMPLETED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  return { ...r, metadata: { ...r.metadata } };
}
export function failAutoAgentRunV2(id, reason) {
  const r = _aaRuns.get(id);
  if (!r) throw new Error(`auto-agent run ${id} not found`);
  _aaCheckR(r.status, AUTOAGENT_RUN_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  r.status = AUTOAGENT_RUN_LIFECYCLE_V2.FAILED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.failReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function cancelAutoAgentRunV2(id, reason) {
  const r = _aaRuns.get(id);
  if (!r) throw new Error(`auto-agent run ${id} not found`);
  _aaCheckR(r.status, AUTOAGENT_RUN_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  r.status = AUTOAGENT_RUN_LIFECYCLE_V2.CANCELLED;
  r.updatedAt = now;
  if (!r.settledAt) r.settledAt = now;
  if (reason) r.metadata.cancelReason = String(reason);
  return { ...r, metadata: { ...r.metadata } };
}
export function getAutoAgentRunV2(id) {
  const r = _aaRuns.get(id);
  if (!r) return null;
  return { ...r, metadata: { ...r.metadata } };
}
export function listAutoAgentRunsV2() {
  return [..._aaRuns.values()].map((r) => ({
    ...r,
    metadata: { ...r.metadata },
  }));
}

export function autoPauseIdleAutoAgentsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const a of _aaAgents.values())
    if (
      a.status === AUTOAGENT_MATURITY_V2.ACTIVE &&
      t - a.lastTouchedAt >= _aaAgentIdleMs
    ) {
      a.status = AUTOAGENT_MATURITY_V2.PAUSED;
      a.updatedAt = t;
      flipped.push(a.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckAutoAgentRunsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const r of _aaRuns.values())
    if (
      r.status === AUTOAGENT_RUN_LIFECYCLE_V2.RUNNING &&
      r.startedAt != null &&
      t - r.startedAt >= _aaRunStuckMs
    ) {
      r.status = AUTOAGENT_RUN_LIFECYCLE_V2.FAILED;
      r.updatedAt = t;
      if (!r.settledAt) r.settledAt = t;
      r.metadata.failReason = "auto-fail-stuck";
      flipped.push(r.id);
    }
  return { flipped, count: flipped.length };
}

export function getAutonomousAgentGovStatsV2() {
  const agentsByStatus = {};
  for (const s of Object.values(AUTOAGENT_MATURITY_V2)) agentsByStatus[s] = 0;
  for (const a of _aaAgents.values()) agentsByStatus[a.status]++;
  const runsByStatus = {};
  for (const s of Object.values(AUTOAGENT_RUN_LIFECYCLE_V2))
    runsByStatus[s] = 0;
  for (const r of _aaRuns.values()) runsByStatus[r.status]++;
  return {
    totalAutoAgentsV2: _aaAgents.size,
    totalAutoAgentRunsV2: _aaRuns.size,
    maxActiveAutoAgentsPerOwner: _aaMaxActivePerOwner,
    maxPendingAutoAgentRunsPerAgent: _aaMaxPendingRunsPerAgent,
    autoAgentIdleMs: _aaAgentIdleMs,
    autoAgentRunStuckMs: _aaRunStuckMs,
    agentsByStatus,
    runsByStatus,
  };
}
