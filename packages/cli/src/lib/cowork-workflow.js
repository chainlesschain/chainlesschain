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
      const promises = chunk.map(async (step) => {
        if (anyFailure && !continueOnError) {
          return {
            id: step.id,
            status: "skipped",
            taskId: null,
            result: { summary: "skipped due to earlier failure" },
          };
        }
        const message = substitutePlaceholders(step.message, resultsById);
        if (onStepStart) onStepStart({ stepId: step.id, message });

        try {
          const entry = await _deps.runTask({
            templateId: step.templateId || null,
            userMessage: message,
            files: step.files || [],
            cwd,
            llmOptions,
          });
          const outcome = {
            id: step.id,
            status: entry.status,
            taskId: entry.taskId,
            result: entry.result,
          };
          resultsById.set(step.id, outcome);
          if (entry.status !== "completed") anyFailure = true;
          if (onStepComplete) onStepComplete(outcome);
          return outcome;
        } catch (err) {
          anyFailure = true;
          const outcome = {
            id: step.id,
            status: "failed",
            taskId: null,
            result: { summary: `Step threw: ${err.message}` },
          };
          resultsById.set(step.id, outcome);
          if (onStepComplete) onStepComplete(outcome);
          return outcome;
        }
      });

      const results = await Promise.all(promises);
      stepOutcomes.push(...results);
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
