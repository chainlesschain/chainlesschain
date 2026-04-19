/**
 * Cowork Task Runner — executes daily tasks using SubAgentContext.
 *
 * Creates an isolated sub-agent with a template-specific system prompt,
 * runs the agent loop, and yields progress events for WS consumers.
 *
 * @module cowork-task-runner
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SubAgentContext } from "./sub-agent-context.js";
import { getTemplate, setUserTemplates } from "./cowork-task-templates.js";
import { mountTemplateMcpTools } from "./cowork-mcp-tools.js";
import { listUserTemplates } from "./cowork-template-marketplace.js";

// ─── Dependencies (overridable for testing) ──────────────────────────────────

export const _deps = { existsSync, mkdirSync, appendFileSync, readFileSync };

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_TOKEN_BUDGET = 100_000;

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Run a cowork task using SubAgentContext.
 *
 * @param {object} options
 * @param {string|null} options.templateId - Template ID (null = free mode)
 * @param {string} options.userMessage - User's task description
 * @param {string[]} [options.files] - File paths provided by user
 * @param {string} [options.cwd] - Working directory
 * @param {object} [options.db] - Database instance
 * @param {object} [options.llmOptions] - LLM provider/model/key
 * @param {number} [options.maxIterations] - Override iteration limit
 * @param {number} [options.tokenBudget] - Override token budget
 * @returns {Promise<{ taskId: string, status: string, result: object }>}
 */
export async function runCoworkTask(options = {}) {
  const {
    templateId = null,
    userMessage,
    files = [],
    cwd = process.cwd(),
    db = null,
    llmOptions = {},
    maxIterations = DEFAULT_MAX_ITERATIONS,
    tokenBudget = DEFAULT_TOKEN_BUDGET,
    onProgress = null,
    signal = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  // Validate file paths before starting
  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  // Merge user-installed templates (marketplace) into the registry before resolving
  try {
    setUserTemplates(listUserTemplates(cwd));
  } catch (_e) {
    // Non-fatal — marketplace absence should not break task execution
  }

  // Resolve template
  const template = getTemplate(templateId);

  // Build the task prompt with template context + files
  const taskParts = [template.systemPromptExtension];

  // N2: apply learning-layer patch for this template if one exists
  try {
    const { loadUserTemplate } = await import("./cowork-learning.js");
    const override = loadUserTemplate(cwd, template.id);
    if (override?.systemPromptExtension) {
      taskParts.push(
        `\n## 历史学习补丁 (learning patch)\n${override.systemPromptExtension}`,
      );
    }
  } catch (_e) {
    // Non-fatal — learning overrides are optional
  }

  if (files.length > 0) {
    taskParts.push(`\n## 用户提供的文件\n${files.join("\n")}`);
  }

  const task = taskParts.join("\n");

  // Mount template-declared MCP servers (best-effort, failures are tolerated)
  const mcp = await mountTemplateMcpTools(template, {
    onWarn: (msg) => {
      if (onProgress) onProgress({ type: "mcp-warning", message: msg });
    },
  });
  if (onProgress && (mcp.mounted.length > 0 || mcp.skipped.length > 0)) {
    onProgress({
      type: "mcp-mounted",
      mounted: mcp.mounted,
      skipped: mcp.skipped.map((s) => s.name),
      toolCount: mcp.extraToolDefinitions.length,
    });
  }

  // Create isolated sub-agent context
  const subAgent = SubAgentContext.create({
    role: `cowork-${template.id}`,
    task,
    inheritedContext: null,
    maxIterations,
    tokenBudget,
    db,
    llmOptions,
    cwd,
    onProgress,
    signal,
    extraToolDefinitions: mcp.extraToolDefinitions,
    externalToolDescriptors: mcp.externalToolDescriptors,
    externalToolExecutors: mcp.externalToolExecutors,
    mcpClient: mcp.mcpClient,
  });

  const taskId = subAgent.id;

  // Build loop options — pass shell policy overrides if template declares them
  const loopOptions = {};
  if (
    Array.isArray(template.shellPolicyOverrides) &&
    template.shellPolicyOverrides.length
  ) {
    loopOptions.shellPolicyOverrides = template.shellPolicyOverrides;
  }

  // Run the agent with the user's message
  try {
    const result = await subAgent.run(userMessage, loopOptions);
    const entry = {
      taskId,
      status: subAgent.status,
      templateId: template.id,
      templateName: template.name,
      result,
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      result: {
        summary: `Task failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } finally {
    await mcp.cleanup();
  }
}

// ─── Parallel Runner (Orchestrator) ──────────────────────────────────────────

/**
 * Run a cowork task using the Orchestrator for multi-agent parallel execution.
 *
 * @param {object} options - Same as runCoworkTask, plus:
 * @param {number} [options.agents] - Number of parallel agents (default 3, max 10)
 * @param {string} [options.strategy] - Routing strategy (default "round-robin")
 * @param {function} [options.onProgress] - Progress callback
 * @param {AbortSignal} [options.signal] - Cancellation signal
 * @returns {Promise<{ taskId: string, status: string, result: object }>}
 */
export async function runCoworkTaskParallel(options = {}) {
  const {
    templateId = null,
    userMessage,
    files = [],
    cwd = process.cwd(),
    agents = 3,
    strategy,
    onProgress = null,
    signal = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  const template = getTemplate(templateId);

  // Build full task description for the orchestrator
  const taskParts = [
    `[Cowork Template: ${template.name}]`,
    template.systemPromptExtension,
    `\n## 用户需求\n${userMessage}`,
  ];
  if (files.length > 0) {
    taskParts.push(`\n## 用户提供的文件\n${files.join("\n")}`);
  }
  const fullTask = taskParts.join("\n");

  try {
    const { Orchestrator, TASK_SOURCE } = await import("./orchestrator.js");

    const orch = new Orchestrator({
      cwd,
      maxParallel: Math.min(parseInt(agents, 10) || 3, 10),
      ciCommand: "echo ok",
      agents: strategy ? { strategy } : undefined,
      verbose: false,
    });

    // Wire progress events
    if (onProgress) {
      orch.on("task:added", (t) =>
        onProgress({
          type: "orchestrator-started",
          taskId: t.id,
          subtaskCount: 0,
        }),
      );
      orch.on("task:decomposed", (t) =>
        onProgress({
          type: "orchestrator-decomposed",
          taskId: t.id,
          subtaskCount: t.subtasks?.length || 0,
        }),
      );
      orch.on("agents:dispatched", (ev) =>
        onProgress({
          type: "agents-dispatched",
          agentCount: ev.agents?.length || 0,
        }),
      );
      orch.on("agent:output", (ev) =>
        onProgress({
          type: "agent-progress",
          agentIndex: ev.agentIndex,
          status: ev.status,
          output: ev.output?.slice(0, 200),
        }),
      );
    }

    // Handle cancellation
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          orch.stopCronWatch();
        },
        { once: true },
      );
    }

    const orchResult = await orch.addTask(fullTask, {
      source: TASK_SOURCE.CLI,
      cwd,
      runCI: false,
      notify: false,
    });

    const entry = {
      taskId: orchResult.id,
      status: orchResult.status === "completed" ? "completed" : "failed",
      templateId: template.id,
      templateName: template.name,
      parallel: true,
      agentCount: agents,
      result: {
        summary:
          orchResult.agentResults
            ?.map((r) => r.output?.slice(0, 500))
            .join("\n---\n") || "Parallel execution completed",
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: orchResult.retries || 0,
        subtaskCount: orchResult.subtasks?.length || 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId: `cowork-parallel-${Date.now()}`,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      parallel: true,
      result: {
        summary: `Parallel task failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
        subtaskCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  }
}

// ─── Debate Runner (Multi-perspective Review) ───────────────────────────────

/**
 * Run a cowork task in debate mode — multiple reviewer perspectives converge
 * into a final verdict via moderator synthesis.
 *
 * @param {object} options
 * @param {string|null} options.templateId - Should be "code-review" or null
 * @param {string} options.userMessage - Target description / review instructions
 * @param {string[]} [options.files] - File paths to review (concatenated as code body)
 * @param {string[]} [options.perspectives] - Override template perspectives
 * @param {string} [options.cwd] - Working directory for history
 * @param {object} [options.llmOptions] - LLM provider/model/key
 * @param {function} [options.onProgress] - Progress callback
 * @returns {Promise<{ taskId, status, result }>}
 */
export async function runCoworkDebate(options = {}) {
  const {
    templateId = "code-review",
    userMessage,
    files = [],
    perspectives,
    cwd = process.cwd(),
    llmOptions = {},
    onProgress = null,
  } = options;

  if (!userMessage || typeof userMessage !== "string") {
    throw new Error("userMessage is required");
  }

  if (files.length > 0) {
    const missing = files.filter((f) => !_deps.existsSync(f));
    if (missing.length > 0) {
      throw new Error(`File(s) not found: ${missing.join(", ")}`);
    }
  }

  const template = getTemplate(templateId);
  const reviewPerspectives = perspectives ||
    template.debatePerspectives || [
      "performance",
      "security",
      "maintainability",
    ];

  // Build code body from files (or from userMessage if no files provided)
  let code = "";
  if (files.length > 0) {
    const chunks = files.map((f) => {
      try {
        return `// ===== ${f} =====\n${_deps.readFileSync(f, "utf-8")}`;
      } catch (err) {
        return `// ===== ${f} (read error: ${err.message}) =====`;
      }
    });
    code = chunks.join("\n\n");
  } else {
    code = userMessage;
  }

  const taskId = `cowork-debate-${Date.now()}`;

  if (onProgress) {
    onProgress({ type: "debate-started", perspectives: reviewPerspectives });
  }

  try {
    const { startDebate } = await import("./cowork/debate-review-cli.js");
    const debateResult = await startDebate({
      target: userMessage,
      code,
      perspectives: reviewPerspectives,
      llmOptions,
    });

    if (onProgress) {
      onProgress({ type: "debate-completed", verdict: debateResult.verdict });
    }

    const entry = {
      taskId,
      status: "completed",
      templateId: template.id,
      templateName: template.name,
      mode: "debate",
      result: {
        summary: debateResult.summary,
        verdict: debateResult.verdict,
        consensusScore: debateResult.consensusScore,
        reviews: debateResult.reviews,
        perspectives: debateResult.perspectives,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: debateResult.reviews.length + 1,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  } catch (err) {
    const entry = {
      taskId,
      status: "failed",
      templateId: template.id,
      templateName: template.name,
      mode: "debate",
      result: {
        summary: `Debate failed: ${err.message}`,
        artifacts: [],
        tokenCount: 0,
        toolsUsed: [],
        iterationCount: 0,
      },
    };
    _appendHistory(cwd, entry, userMessage);
    return entry;
  }
}

// ─── History Persistence ─────────────────────────────────────────────────────

function _appendHistory(cwd, entry, userMessage) {
  try {
    const histDir = join(cwd, ".chainlesschain", "cowork");
    _deps.mkdirSync(histDir, { recursive: true });
    const record = {
      ...entry,
      userMessage,
      timestamp: new Date().toISOString(),
    };
    _deps.appendFileSync(
      join(histDir, "history.jsonl"),
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  } catch (_e) {
    // Best-effort — don't fail the task for history write errors
  }
}


// ===== V2 Surface: Cowork Task Runner governance overlay (CLI v0.139.0) =====
export const RUNNER_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", PAUSED: "paused", RETIRED: "retired",
});
export const RUNNER_EXEC_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", RUNNING: "running", SUCCEEDED: "succeeded", FAILED: "failed", CANCELLED: "cancelled",
});

const _rpTrans = new Map([
  [RUNNER_PROFILE_MATURITY_V2.PENDING, new Set([RUNNER_PROFILE_MATURITY_V2.ACTIVE, RUNNER_PROFILE_MATURITY_V2.RETIRED])],
  [RUNNER_PROFILE_MATURITY_V2.ACTIVE, new Set([RUNNER_PROFILE_MATURITY_V2.PAUSED, RUNNER_PROFILE_MATURITY_V2.RETIRED])],
  [RUNNER_PROFILE_MATURITY_V2.PAUSED, new Set([RUNNER_PROFILE_MATURITY_V2.ACTIVE, RUNNER_PROFILE_MATURITY_V2.RETIRED])],
  [RUNNER_PROFILE_MATURITY_V2.RETIRED, new Set()],
]);
const _rpTerminal = new Set([RUNNER_PROFILE_MATURITY_V2.RETIRED]);
const _reTrans = new Map([
  [RUNNER_EXEC_LIFECYCLE_V2.QUEUED, new Set([RUNNER_EXEC_LIFECYCLE_V2.RUNNING, RUNNER_EXEC_LIFECYCLE_V2.CANCELLED])],
  [RUNNER_EXEC_LIFECYCLE_V2.RUNNING, new Set([RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED, RUNNER_EXEC_LIFECYCLE_V2.FAILED, RUNNER_EXEC_LIFECYCLE_V2.CANCELLED])],
  [RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED, new Set()],
  [RUNNER_EXEC_LIFECYCLE_V2.FAILED, new Set()],
  [RUNNER_EXEC_LIFECYCLE_V2.CANCELLED, new Set()],
]);

const _rpsV2 = new Map();
const _resV2 = new Map();
let _rpMaxActivePerOwner = 8;
let _rpMaxPendingExecsPerProfile = 15;
let _rpIdleMs = 14 * 24 * 60 * 60 * 1000;
let _reStuckMs = 20 * 60 * 1000;

function _rpPos(n, lbl) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${lbl} must be positive integer`); return v; }

export function setMaxActiveRunnerProfilesPerOwnerV2(n) { _rpMaxActivePerOwner = _rpPos(n, "maxActiveRunnerProfilesPerOwner"); }
export function getMaxActiveRunnerProfilesPerOwnerV2() { return _rpMaxActivePerOwner; }
export function setMaxPendingRunnerExecsPerProfileV2(n) { _rpMaxPendingExecsPerProfile = _rpPos(n, "maxPendingRunnerExecsPerProfile"); }
export function getMaxPendingRunnerExecsPerProfileV2() { return _rpMaxPendingExecsPerProfile; }
export function setRunnerProfileIdleMsV2(n) { _rpIdleMs = _rpPos(n, "runnerProfileIdleMs"); }
export function getRunnerProfileIdleMsV2() { return _rpIdleMs; }
export function setRunnerExecStuckMsV2(n) { _reStuckMs = _rpPos(n, "runnerExecStuckMs"); }
export function getRunnerExecStuckMsV2() { return _reStuckMs; }

export function _resetStateRunnerV2() {
  _rpsV2.clear(); _resV2.clear();
  _rpMaxActivePerOwner = 8; _rpMaxPendingExecsPerProfile = 15;
  _rpIdleMs = 14 * 24 * 60 * 60 * 1000; _reStuckMs = 20 * 60 * 1000;
}

export function registerRunnerProfileV2({ id, owner, template, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!owner || typeof owner !== "string") throw new Error("owner is required");
  if (_rpsV2.has(id)) throw new Error(`runner profile ${id} already registered`);
  const now = Date.now();
  const p = { id, owner, template: template || "default", status: RUNNER_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, retiredAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _rpsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
function _rpCheckP(from, to) { const a = _rpTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid runner profile transition ${from} → ${to}`); }
function _rpCountActive(owner) { let n = 0; for (const p of _rpsV2.values()) if (p.owner === owner && p.status === RUNNER_PROFILE_MATURITY_V2.ACTIVE) n++; return n; }

export function activateRunnerProfileV2(id) {
  const p = _rpsV2.get(id); if (!p) throw new Error(`runner profile ${id} not found`);
  _rpCheckP(p.status, RUNNER_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === RUNNER_PROFILE_MATURITY_V2.PAUSED;
  if (!recovery) { const c = _rpCountActive(p.owner); if (c >= _rpMaxActivePerOwner) throw new Error(`max active runner profiles per owner (${_rpMaxActivePerOwner}) reached for ${p.owner}`); }
  const now = Date.now(); p.status = RUNNER_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now; if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseRunnerProfileV2(id) { const p = _rpsV2.get(id); if (!p) throw new Error(`runner profile ${id} not found`); _rpCheckP(p.status, RUNNER_PROFILE_MATURITY_V2.PAUSED); p.status = RUNNER_PROFILE_MATURITY_V2.PAUSED; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function retireRunnerProfileV2(id) { const p = _rpsV2.get(id); if (!p) throw new Error(`runner profile ${id} not found`); _rpCheckP(p.status, RUNNER_PROFILE_MATURITY_V2.RETIRED); const now = Date.now(); p.status = RUNNER_PROFILE_MATURITY_V2.RETIRED; p.updatedAt = now; if (!p.retiredAt) p.retiredAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchRunnerProfileV2(id) { const p = _rpsV2.get(id); if (!p) throw new Error(`runner profile ${id} not found`); if (_rpTerminal.has(p.status)) throw new Error(`cannot touch terminal runner profile ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getRunnerProfileV2(id) { const p = _rpsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listRunnerProfilesV2() { return [..._rpsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }

function _reCountPending(profileId) { let n = 0; for (const e of _resV2.values()) if (e.profileId === profileId && (e.status === RUNNER_EXEC_LIFECYCLE_V2.QUEUED || e.status === RUNNER_EXEC_LIFECYCLE_V2.RUNNING)) n++; return n; }

export function createRunnerExecV2({ id, profileId, taskInput, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id is required");
  if (!profileId || typeof profileId !== "string") throw new Error("profileId is required");
  if (_resV2.has(id)) throw new Error(`runner exec ${id} already exists`);
  if (!_rpsV2.has(profileId)) throw new Error(`runner profile ${profileId} not found`);
  const pending = _reCountPending(profileId);
  if (pending >= _rpMaxPendingExecsPerProfile) throw new Error(`max pending runner execs per profile (${_rpMaxPendingExecsPerProfile}) reached for ${profileId}`);
  const now = Date.now();
  const e = { id, profileId, taskInput: taskInput || "", status: RUNNER_EXEC_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _resV2.set(id, e);
  return { ...e, metadata: { ...e.metadata } };
}
function _reCheckE(from, to) { const a = _reTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid runner exec transition ${from} → ${to}`); }
export function startRunnerExecV2(id) { const e = _resV2.get(id); if (!e) throw new Error(`runner exec ${id} not found`); _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.RUNNING); const now = Date.now(); e.status = RUNNER_EXEC_LIFECYCLE_V2.RUNNING; e.updatedAt = now; if (!e.startedAt) e.startedAt = now; return { ...e, metadata: { ...e.metadata } }; }
export function succeedRunnerExecV2(id) { const e = _resV2.get(id); if (!e) throw new Error(`runner exec ${id} not found`); _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED); const now = Date.now(); e.status = RUNNER_EXEC_LIFECYCLE_V2.SUCCEEDED; e.updatedAt = now; if (!e.settledAt) e.settledAt = now; return { ...e, metadata: { ...e.metadata } }; }
export function failRunnerExecV2(id, reason) { const e = _resV2.get(id); if (!e) throw new Error(`runner exec ${id} not found`); _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.FAILED); const now = Date.now(); e.status = RUNNER_EXEC_LIFECYCLE_V2.FAILED; e.updatedAt = now; if (!e.settledAt) e.settledAt = now; if (reason) e.metadata.failReason = String(reason); return { ...e, metadata: { ...e.metadata } }; }
export function cancelRunnerExecV2(id, reason) { const e = _resV2.get(id); if (!e) throw new Error(`runner exec ${id} not found`); _reCheckE(e.status, RUNNER_EXEC_LIFECYCLE_V2.CANCELLED); const now = Date.now(); e.status = RUNNER_EXEC_LIFECYCLE_V2.CANCELLED; e.updatedAt = now; if (!e.settledAt) e.settledAt = now; if (reason) e.metadata.cancelReason = String(reason); return { ...e, metadata: { ...e.metadata } }; }
export function getRunnerExecV2(id) { const e = _resV2.get(id); if (!e) return null; return { ...e, metadata: { ...e.metadata } }; }
export function listRunnerExecsV2() { return [..._resV2.values()].map((e) => ({ ...e, metadata: { ...e.metadata } })); }

export function autoPauseIdleRunnerProfilesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _rpsV2.values()) if (p.status === RUNNER_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _rpIdleMs) { p.status = RUNNER_PROFILE_MATURITY_V2.PAUSED; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckRunnerExecsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const e of _resV2.values()) if (e.status === RUNNER_EXEC_LIFECYCLE_V2.RUNNING && e.startedAt != null && (t - e.startedAt) >= _reStuckMs) { e.status = RUNNER_EXEC_LIFECYCLE_V2.FAILED; e.updatedAt = t; if (!e.settledAt) e.settledAt = t; e.metadata.failReason = "auto-fail-stuck"; flipped.push(e.id); } return { flipped, count: flipped.length }; }

export function getRunnerGovStatsV2() {
  const profilesByStatus = {}; for (const s of Object.values(RUNNER_PROFILE_MATURITY_V2)) profilesByStatus[s] = 0; for (const p of _rpsV2.values()) profilesByStatus[p.status]++;
  const execsByStatus = {}; for (const s of Object.values(RUNNER_EXEC_LIFECYCLE_V2)) execsByStatus[s] = 0; for (const e of _resV2.values()) execsByStatus[e.status]++;
  return { totalRunnerProfilesV2: _rpsV2.size, totalRunnerExecsV2: _resV2.size, maxActiveRunnerProfilesPerOwner: _rpMaxActivePerOwner, maxPendingRunnerExecsPerProfile: _rpMaxPendingExecsPerProfile, runnerProfileIdleMs: _rpIdleMs, runnerExecStuckMs: _reStuckMs, profilesByStatus, execsByStatus };
}
