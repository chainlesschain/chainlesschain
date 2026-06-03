/**
 * Cowork Workflow — chain multiple Cowork tasks into a DAG.
 *
 * A workflow is a declarative set of steps with optional dependencies. Each
 * step invokes a Cowork template (or free mode) with a user message that can
 * reference earlier steps' results via `${step.<id>.summary}` placeholders.
 *
 * The executor:
 *   1. topologically sorts steps by `dependsOn`
 *   2. runs independent steps in parallel (bounded by `maxParallel`)
 *   3. substitutes placeholders in `message` from completed step outputs
 *   4. halts on first failure unless `continueOnError` is set
 *
 * Persistence mirrors the cron scheduler: one JSON file per workflow under
 * `.chainlesschain/cowork/workflows/<id>.json`, plus a `run-history.jsonl`
 * capturing each execution.
 *
 * The runner itself is injected via `_deps.runTask` to avoid a circular import
 * with `cowork-task-runner.js`.
 *
 * @module cowork-workflow
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { evaluate as evalExpr, resolveReference } from "./workflow-expr.js";

/** Maximum number of items a single forEach step can expand into. */
export const MAX_FAN_OUT = 500;

export const _deps = {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  appendFileSync,
  now: () => Date.now(),
  runTask: null, // injected by CLI
};

// ─── Paths ───────────────────────────────────────────────────────────────────

function workflowsDir(cwd) {
  return join(cwd, ".chainlesschain", "cowork", "workflows");
}

function workflowFile(cwd, id) {
  return join(workflowsDir(cwd), `${id}.json`);
}

function historyFile(cwd) {
  return join(cwd, ".chainlesschain", "cowork", "workflow-history.jsonl");
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a workflow definition. Returns `{ valid, errors }`.
 */
export function validateWorkflow(wf) {
  const errors = [];
  if (!wf || typeof wf !== "object") {
    return { valid: false, errors: ["workflow must be an object"] };
  }
  if (!wf.id || typeof wf.id !== "string") errors.push("id required");
  if (!wf.name || typeof wf.name !== "string") errors.push("name required");
  if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
    errors.push("steps must be a non-empty array");
  } else {
    const ids = new Set();
    for (const [i, s] of wf.steps.entries()) {
      if (!s.id || typeof s.id !== "string") {
        errors.push(`steps[${i}].id required`);
        continue;
      }
      if (ids.has(s.id)) errors.push(`duplicate step id '${s.id}'`);
      ids.add(s.id);
      if (!s.message || typeof s.message !== "string") {
        errors.push(`steps[${i}].message required`);
      }
      if (s.dependsOn && !Array.isArray(s.dependsOn)) {
        errors.push(`steps[${i}].dependsOn must be an array`);
      }
      if (s.when !== undefined && typeof s.when !== "string") {
        errors.push(`steps[${i}].when must be a string expression`);
      }
      if (s.forEach !== undefined) {
        const f = s.forEach;
        const ok =
          Array.isArray(f) || (typeof f === "string" && f.trim().length > 0);
        if (!ok) {
          errors.push(
            `steps[${i}].forEach must be an array or reference string`,
          );
        }
      }
    }
    // Check dependsOn references exist
    for (const s of wf.steps) {
      for (const dep of s.dependsOn || []) {
        if (!ids.has(dep)) {
          errors.push(`step '${s.id}' dependsOn unknown step '${dep}'`);
        }
      }
    }
    // Detect cycles via topo-sort
    if (errors.length === 0) {
      try {
        topoSort(wf.steps);
      } catch (e) {
        errors.push(e.message);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ─── Topological sort ────────────────────────────────────────────────────────

/**
 * Return steps in execution order (Kahn's algorithm). Throws on cycle.
 * The result is a flat array; independent steps appear adjacently but the
 * executor separately groups them into parallel batches.
 */
export function topoSort(steps) {
  const incoming = new Map();
  const outgoing = new Map();
  for (const s of steps) {
    incoming.set(s.id, new Set(s.dependsOn || []));
    outgoing.set(s.id, []);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (outgoing.has(dep)) outgoing.get(dep).push(s.id);
    }
  }

  const ready = [];
  for (const [id, incs] of incoming) {
    if (incs.size === 0) ready.push(id);
  }

  const order = [];
  const byId = new Map(steps.map((s) => [s.id, s]));
  while (ready.length > 0) {
    const id = ready.shift();
    order.push(byId.get(id));
    for (const next of outgoing.get(id)) {
      const incs = incoming.get(next);
      incs.delete(id);
      if (incs.size === 0) ready.push(next);
    }
  }

  if (order.length !== steps.length) {
    throw new Error("workflow contains a cycle");
  }
  return order;
}

/**
 * Group steps into parallel batches based on dependencies. Within a batch,
 * all steps are independent and can run concurrently.
 */
export function planBatches(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const done = new Set();
  const batches = [];
  const remaining = new Set(steps.map((s) => s.id));

  while (remaining.size > 0) {
    const batch = [];
    for (const id of remaining) {
      const s = byId.get(id);
      const deps = s.dependsOn || [];
      if (deps.every((d) => done.has(d))) batch.push(s);
    }
    if (batch.length === 0) throw new Error("workflow contains a cycle");
    batches.push(batch);
    for (const s of batch) {
      done.add(s.id);
      remaining.delete(s.id);
    }
  }
  return batches;
}

// ─── forEach expansion ───────────────────────────────────────────────────────

/**
 * Resolve the array source for a `forEach` step. Accepts either:
 *   - an array literal (returned verbatim)
 *   - a `${...}` reference string resolving to an array on a prior step result
 *
 * Throws if the resolved value isn't an array or exceeds MAX_FAN_OUT.
 */
export function resolveForEachItems(forEach, resultsById) {
  if (Array.isArray(forEach)) {
    if (forEach.length > MAX_FAN_OUT) {
      throw new Error(
        `forEach array exceeds MAX_FAN_OUT=${MAX_FAN_OUT} (got ${forEach.length})`,
      );
    }
    return forEach;
  }
  if (typeof forEach === "string") {
    const trimmed = forEach.trim();
    // Accept bare `${...}` wrapper; resolve inner ref.
    const m = trimmed.match(/^\$\{(.+)\}$/);
    if (!m) {
      throw new Error(`forEach ref must be wrapped in \${...}: ${trimmed}`);
    }
    const value = resolveReference(m[1].trim(), { step: resultsById });
    if (!Array.isArray(value)) {
      throw new Error(
        `forEach ref did not resolve to an array: ${trimmed} (got ${typeof value})`,
      );
    }
    if (value.length > MAX_FAN_OUT) {
      throw new Error(
        `forEach expansion exceeds MAX_FAN_OUT=${MAX_FAN_OUT} (got ${value.length})`,
      );
    }
    return value;
  }
  throw new Error("forEach must be an array or reference string");
}

/** Substitute `${item}` tokens in a template string. Non-string → stringify. */
export function substituteItem(template, item) {
  if (typeof template !== "string") return template;
  const repl = typeof item === "string" ? item : JSON.stringify(item);
  return template.replace(/\$\{item\}/g, repl);
}

/** Evaluate a step's `when` expression. Missing expression → always true. */
export function shouldRunStep(step, resultsById) {
  if (!step.when) return true;
  try {
    return evalExpr(step.when, { step: resultsById });
  } catch (err) {
    throw new Error(`invalid when on step '${step.id}': ${err.message}`);
  }
}

// ─── Placeholder substitution ────────────────────────────────────────────────

/**
 * Replace `${step.<id>.<field>}` tokens in `template` using the map of
 * completed step results. Missing tokens resolve to an empty string.
 *
 * Supported fields: `summary`, `status`, `taskId`, `tokenCount`,
 * `iterationCount`.
 */
export function substitutePlaceholders(template, resultsById) {
  if (typeof template !== "string") return template;
  return template.replace(
    /\$\{step\.([\w-]+)\.([\w-]+)\}/g,
    (_, stepId, field) => {
      const entry = resultsById.get(stepId);
      if (!entry) return "";
      if (field === "summary") return entry.result?.summary ?? "";
      if (field === "status") return entry.status ?? "";
      if (field === "taskId") return entry.taskId ?? "";
      if (field === "tokenCount") return String(entry.result?.tokenCount ?? 0);
      if (field === "iterationCount")
        return String(entry.result?.iterationCount ?? 0);
      return "";
    },
  );
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export function listWorkflows(cwd) {
  const dir = workflowsDir(cwd);
  if (!_deps.existsSync(dir)) return [];
  const entries = _deps.readdirSync(dir) || [];
  const out = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      const body = _deps.readFileSync(join(dir, name), "utf-8");
      out.push(JSON.parse(body));
    } catch (_e) {
      // skip malformed files
    }
  }
  return out;
}

export function getWorkflow(cwd, id) {
  const file = workflowFile(cwd, id);
  if (!_deps.existsSync(file)) return null;
  try {
    return JSON.parse(_deps.readFileSync(file, "utf-8"));
  } catch (_e) {
    return null;
  }
}

export function saveWorkflow(cwd, wf) {
  const { valid, errors } = validateWorkflow(wf);
  if (!valid) throw new Error(`Invalid workflow: ${errors.join("; ")}`);
  const dir = workflowsDir(cwd);
  _deps.mkdirSync(dir, { recursive: true });
  _deps.writeFileSync(
    workflowFile(cwd, wf.id),
    JSON.stringify(wf, null, 2),
    "utf-8",
  );
  return wf;
}

export function removeWorkflow(cwd, id) {
  const file = workflowFile(cwd, id);
  if (!_deps.existsSync(file)) return false;
  _deps.unlinkSync(file);
  return true;
}

// ─── Execution ───────────────────────────────────────────────────────────────

/**
 * Execute a workflow. The runner for individual tasks must be injected via
 * `_deps.runTask` (signature matches `runCoworkTask`).
 *
 * @param {object} options
 * @param {object} options.workflow - Workflow definition
 * @param {string} [options.cwd] - Working directory for history
 * @param {number} [options.maxParallel] - Max parallel steps per batch
 * @param {boolean} [options.continueOnError] - Keep running after a failure
 * @param {object} [options.llmOptions] - Forwarded to each task
 * @param {function} [options.onStepStart]
 * @param {function} [options.onStepComplete]
 * @returns {Promise<{
 *   workflowId: string,
 *   status: "completed"|"failed"|"partial",
 *   steps: Array<{ id, status, taskId, result }>,
 *   startedAt: string,
 *   finishedAt: string,
 * }>}
 */
export async function executeWorkflow(options = {}) {
  const {
    workflow,
    cwd = process.cwd(),
    maxParallel = 4,
    continueOnError = false,
    llmOptions = {},
    onStepStart,
    onStepComplete,
  } = options;

  const { valid, errors } = validateWorkflow(workflow);
  if (!valid) throw new Error(`Invalid workflow: ${errors.join("; ")}`);
  if (typeof _deps.runTask !== "function") {
    throw new Error(
      "cowork-workflow: _deps.runTask is not injected (wire runCoworkTask in CLI before executing)",
    );
  }

  const batches = planBatches(workflow.steps);
  const resultsById = new Map();
  const stepOutcomes = [];
  const startedAt = new Date(_deps.now()).toISOString();
  let anyFailure = false;

  for (const batch of batches) {
    // Respect maxParallel by slicing batch into chunks
    const chunks = [];
    for (let i = 0; i < batch.length; i += maxParallel) {
      chunks.push(batch.slice(i, i + maxParallel));
    }

    for (const chunk of chunks) {
      // Expand forEach / when into concrete tasks for this chunk
      const runnable = []; // { step, message, recordId, parentId }
      const preOutcomes = []; // outcomes produced synchronously (skipped)
      for (const step of chunk) {
        if (anyFailure && !continueOnError) {
          const outcome = {
            id: step.id,
            status: "skipped",
            taskId: null,
            result: { summary: "skipped due to earlier failure" },
          };
          resultsById.set(step.id, outcome);
          preOutcomes.push(outcome);
          continue;
        }
        // when-gate
        let runThis = true;
        try {
          runThis = shouldRunStep(step, resultsById);
        } catch (err) {
          anyFailure = true;
          const outcome = {
            id: step.id,
            status: "failed",
            taskId: null,
            result: { summary: err.message },
          };
          resultsById.set(step.id, outcome);
          preOutcomes.push(outcome);
          continue;
        }
        if (!runThis) {
          const outcome = {
            id: step.id,
            status: "skipped",
            taskId: null,
            result: { summary: "when-condition false" },
          };
          resultsById.set(step.id, outcome);
          preOutcomes.push(outcome);
          continue;
        }
        // forEach-expansion
        if (step.forEach !== undefined) {
          let items;
          try {
            items = resolveForEachItems(step.forEach, resultsById);
          } catch (err) {
            anyFailure = true;
            const outcome = {
              id: step.id,
              status: "failed",
              taskId: null,
              result: { summary: err.message },
            };
            resultsById.set(step.id, outcome);
            preOutcomes.push(outcome);
            continue;
          }
          if (items.length === 0) {
            const outcome = {
              id: step.id,
              status: "skipped",
              taskId: null,
              result: { summary: "forEach items empty" },
            };
            resultsById.set(step.id, outcome);
            preOutcomes.push(outcome);
            continue;
          }
          for (let k = 0; k < items.length; k++) {
            const childId = `${step.id}[${k}]`;
            const withItem = substituteItem(step.message, items[k]);
            const msg = substitutePlaceholders(withItem, resultsById);
            runnable.push({
              step,
              message: msg,
              recordId: childId,
              parentId: step.id,
            });
          }
          continue;
        }
        const message = substitutePlaceholders(step.message, resultsById);
        runnable.push({ step, message, recordId: step.id, parentId: null });
      }

      const promises = runnable.map(async ({ step, message, recordId }) => {
        if (onStepStart) onStepStart({ stepId: recordId, message });
        try {
          const entry = await _deps.runTask({
            templateId: step.templateId || null,
            userMessage: message,
            files: step.files || [],
            cwd,
            llmOptions,
          });
          const outcome = {
            id: recordId,
            status: entry.status,
            taskId: entry.taskId,
            result: entry.result,
          };
          resultsById.set(recordId, outcome);
          if (entry.status !== "completed") anyFailure = true;
          if (onStepComplete) onStepComplete(outcome);
          return outcome;
        } catch (err) {
          anyFailure = true;
          const outcome = {
            id: recordId,
            status: "failed",
            taskId: null,
            result: { summary: `Step threw: ${err.message}` },
          };
          resultsById.set(recordId, outcome);
          if (onStepComplete) onStepComplete(outcome);
          return outcome;
        }
      });

      const results = await Promise.all(promises);
      stepOutcomes.push(...preOutcomes, ...results);

      // Aggregate forEach children into a parent entry so downstream
      // `${step.<parent>.summary}` references still work.
      const byParent = new Map();
      for (let k = 0; k < runnable.length; k++) {
        const r = runnable[k];
        if (!r.parentId) continue;
        if (!byParent.has(r.parentId)) byParent.set(r.parentId, []);
        byParent.get(r.parentId).push(results[k]);
      }
      for (const [parentId, children] of byParent) {
        const allOk = children.every((c) => c.status === "completed");
        const anyOk = children.some((c) => c.status === "completed");
        const status = allOk ? "completed" : anyOk ? "partial" : "failed";
        resultsById.set(parentId, {
          id: parentId,
          status,
          taskId: null,
          result: {
            summary: children.map((c) => c.result?.summary ?? "").join("\n"),
            children: children.length,
          },
        });
      }
    }

    if (anyFailure && !continueOnError) break;
  }

  const finishedAt = new Date(_deps.now()).toISOString();
  const allCompleted = stepOutcomes.every((s) => s.status === "completed");
  const status = allCompleted
    ? "completed"
    : stepOutcomes.some((s) => s.status === "completed")
      ? "partial"
      : "failed";

  const record = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    status,
    steps: stepOutcomes,
    startedAt,
    finishedAt,
  };
  _appendHistory(cwd, record);
  return record;
}

function _appendHistory(cwd, record) {
  try {
    const dir = join(cwd, ".chainlesschain", "cowork");
    _deps.mkdirSync(dir, { recursive: true });
    _deps.appendFileSync(
      historyFile(cwd),
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  } catch (_e) {
    // best-effort
  }
}

// =====================================================================
// cowork-workflow V2 governance overlay (iter17)
// =====================================================================
export const CWWF_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const CWWF_STEP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _cwwfPTrans = new Map([
  [
    CWWF_PROFILE_MATURITY_V2.PENDING,
    new Set([
      CWWF_PROFILE_MATURITY_V2.ACTIVE,
      CWWF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CWWF_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      CWWF_PROFILE_MATURITY_V2.PAUSED,
      CWWF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    CWWF_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      CWWF_PROFILE_MATURITY_V2.ACTIVE,
      CWWF_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [CWWF_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _cwwfPTerminal = new Set([CWWF_PROFILE_MATURITY_V2.ARCHIVED]);
const _cwwfJTrans = new Map([
  [
    CWWF_STEP_LIFECYCLE_V2.QUEUED,
    new Set([CWWF_STEP_LIFECYCLE_V2.RUNNING, CWWF_STEP_LIFECYCLE_V2.CANCELLED]),
  ],
  [
    CWWF_STEP_LIFECYCLE_V2.RUNNING,
    new Set([
      CWWF_STEP_LIFECYCLE_V2.COMPLETED,
      CWWF_STEP_LIFECYCLE_V2.FAILED,
      CWWF_STEP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [CWWF_STEP_LIFECYCLE_V2.COMPLETED, new Set()],
  [CWWF_STEP_LIFECYCLE_V2.FAILED, new Set()],
  [CWWF_STEP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _cwwfPsV2 = new Map();
const _cwwfJsV2 = new Map();
let _cwwfMaxActive = 8,
  _cwwfMaxPending = 20,
  _cwwfIdleMs = 30 * 24 * 60 * 60 * 1000,
  _cwwfStuckMs = 60 * 1000;
function _cwwfPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _cwwfCheckP(from, to) {
  const a = _cwwfPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cwwf profile transition ${from} → ${to}`);
}
function _cwwfCheckJ(from, to) {
  const a = _cwwfJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid cwwf step transition ${from} → ${to}`);
}
function _cwwfCountActive(owner) {
  let c = 0;
  for (const p of _cwwfPsV2.values())
    if (p.owner === owner && p.status === CWWF_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _cwwfCountPending(profileId) {
  let c = 0;
  for (const j of _cwwfJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === CWWF_STEP_LIFECYCLE_V2.QUEUED ||
        j.status === CWWF_STEP_LIFECYCLE_V2.RUNNING)
    )
      c++;
  return c;
}
export function setMaxActiveCwwfProfilesPerOwnerV2(n) {
  _cwwfMaxActive = _cwwfPos(n, "maxActiveCwwfProfilesPerOwner");
}
export function getMaxActiveCwwfProfilesPerOwnerV2() {
  return _cwwfMaxActive;
}
export function setMaxPendingCwwfStepsPerProfileV2(n) {
  _cwwfMaxPending = _cwwfPos(n, "maxPendingCwwfStepsPerProfile");
}
export function getMaxPendingCwwfStepsPerProfileV2() {
  return _cwwfMaxPending;
}
export function setCwwfProfileIdleMsV2(n) {
  _cwwfIdleMs = _cwwfPos(n, "cwwfProfileIdleMs");
}
export function getCwwfProfileIdleMsV2() {
  return _cwwfIdleMs;
}
export function setCwwfStepStuckMsV2(n) {
  _cwwfStuckMs = _cwwfPos(n, "cwwfStepStuckMs");
}
export function getCwwfStepStuckMsV2() {
  return _cwwfStuckMs;
}
export function _resetStateCoworkWorkflowV2() {
  _cwwfPsV2.clear();
  _cwwfJsV2.clear();
  _cwwfMaxActive = 8;
  _cwwfMaxPending = 20;
  _cwwfIdleMs = 30 * 24 * 60 * 60 * 1000;
  _cwwfStuckMs = 60 * 1000;
}
export function registerCwwfProfileV2({ id, owner, mode, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_cwwfPsV2.has(id)) throw new Error(`cwwf profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    mode: mode || "sequential",
    status: CWWF_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cwwfPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  const isInitial = p.status === CWWF_PROFILE_MATURITY_V2.PENDING;
  _cwwfCheckP(p.status, CWWF_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _cwwfCountActive(p.owner) >= _cwwfMaxActive)
    throw new Error(`max active cwwf profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = CWWF_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  _cwwfCheckP(p.status, CWWF_PROFILE_MATURITY_V2.PAUSED);
  p.status = CWWF_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  _cwwfCheckP(p.status, CWWF_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = CWWF_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) throw new Error(`cwwf profile ${id} not found`);
  if (_cwwfPTerminal.has(p.status))
    throw new Error(`cannot touch terminal cwwf profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getCwwfProfileV2(id) {
  const p = _cwwfPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listCwwfProfilesV2() {
  return [..._cwwfPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createCwwfStepV2({ id, profileId, task, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_cwwfJsV2.has(id)) throw new Error(`cwwf step ${id} already exists`);
  if (!_cwwfPsV2.has(profileId))
    throw new Error(`cwwf profile ${profileId} not found`);
  if (_cwwfCountPending(profileId) >= _cwwfMaxPending)
    throw new Error(`max pending cwwf steps for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    task: task || "",
    status: CWWF_STEP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _cwwfJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function runningCwwfStepV2(id) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.RUNNING);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.RUNNING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeStepCwwfV2(id) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.COMPLETED);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.COMPLETED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failCwwfStepV2(id, reason) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelCwwfStepV2(id, reason) {
  const j = _cwwfJsV2.get(id);
  if (!j) throw new Error(`cwwf step ${id} not found`);
  _cwwfCheckJ(j.status, CWWF_STEP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = CWWF_STEP_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getCwwfStepV2(id) {
  const j = _cwwfJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listCwwfStepsV2() {
  return [..._cwwfJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleCwwfProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _cwwfPsV2.values())
    if (
      p.status === CWWF_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _cwwfIdleMs
    ) {
      p.status = CWWF_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckCwwfStepsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _cwwfJsV2.values())
    if (
      j.status === CWWF_STEP_LIFECYCLE_V2.RUNNING &&
      j.startedAt != null &&
      t - j.startedAt >= _cwwfStuckMs
    ) {
      j.status = CWWF_STEP_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getCoworkWorkflowGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(CWWF_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _cwwfPsV2.values()) profilesByStatus[p.status]++;
  const stepsByStatus = {};
  for (const v of Object.values(CWWF_STEP_LIFECYCLE_V2)) stepsByStatus[v] = 0;
  for (const j of _cwwfJsV2.values()) stepsByStatus[j.status]++;
  return {
    totalCwwfProfilesV2: _cwwfPsV2.size,
    totalCwwfStepsV2: _cwwfJsV2.size,
    maxActiveCwwfProfilesPerOwner: _cwwfMaxActive,
    maxPendingCwwfStepsPerProfile: _cwwfMaxPending,
    cwwfProfileIdleMs: _cwwfIdleMs,
    cwwfStepStuckMs: _cwwfStuckMs,
    profilesByStatus,
    stepsByStatus,
  };
}
