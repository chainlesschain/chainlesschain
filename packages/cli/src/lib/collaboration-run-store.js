/**
 * Durable, secret-free governance records for short-lived `cc team` / `cc
 * batch` worktree runs.
 *
 * These are deliberately separate from background-agent state: a team/batch
 * task is not independently attachable or stoppable, and pretending otherwise
 * could make `cc daemon stop` kill the shared coordinator process. The daemon
 * JSON view may project these records read-only for IDE task rows.
 *
 * Prompts, argv, tool arguments, model output, credentials, and side-effect
 * metadata never enter this store.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { getHomeDir } from "./paths.js";

export const COLLABORATION_RUN_VERSION = 1;
const RUN_KINDS = new Set(["team", "batch"]);
const PERMISSION_MODES = new Set([
  "manual",
  "auto",
  "dontAsk",
  "default",
  "plan",
  "acceptEdits",
  "bypassPermissions",
]);
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
const UNIT_STATUSES = new Set([
  "pending",
  "running",
  "completed",
  "failed",
  "test-failed",
  "no-changes",
  "cancelled",
]);

export const _deps = {
  now: () => Date.now(),
  randomHex: () => randomBytes(3).toString("hex"),
};

function boundedString(value, max) {
  if (value === null || value === undefined) return null;
  const clean = String(value)
    .replace(/\p{Cc}/gu, "")
    .trim();
  return clean ? clean.slice(0, max) : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function safeKind(kind) {
  const value = String(kind || "");
  if (!RUN_KINDS.has(value)) {
    throw new Error(
      `Unsupported collaboration run kind: ${value || "(empty)"}`,
    );
  }
  return value;
}

function safeRunId(id) {
  const value = String(id || "");
  if (value.length > 160 || !/^(team|batch)-[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid collaboration run id: ${value || "(empty)"}`);
  }
  return value;
}

export function collaborationRunsDir() {
  const dir =
    process.env.CC_COLLABORATION_RUNS_DIR ||
    join(getHomeDir(), "collaboration-runs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function createCollaborationRunId(kind) {
  const normalizedKind = safeKind(kind);
  return `${normalizedKind}-${Math.floor(_deps.now())}-${_deps.randomHex()}`;
}

export function createCollaborationSessionId(runId, key) {
  const safeId = safeRunId(runId);
  const digest = createHash("sha256")
    .update(String(key || "unit"))
    .digest("hex")
    .slice(0, 12);
  return `session-${safeId}-${digest}`.slice(0, 256);
}

export function collaborationRunPath(id) {
  return join(collaborationRunsDir(), `${safeRunId(id)}.json`);
}

function normalizeBudget(resourceBudget) {
  const source =
    resourceBudget && typeof resourceBudget === "object" ? resourceBudget : {};
  return {
    maxTurns: positiveNumber(source.maxTurns),
    maxCostUsd: positiveNumber(source.maxCostUsd),
    maxTasks: positiveNumber(source.maxTasks),
    maxTokens: positiveNumber(source.maxTokens),
    maxWallMs: positiveNumber(source.maxWallMs),
  };
}

function summarizeSideEffects(source) {
  const ops =
    source && typeof source.list === "function"
      ? source.list()
      : Array.isArray(source?.ops)
        ? source.ops
        : null;
  if (ops) {
    const count = (state) => ops.filter((op) => op?.state === state).length;
    return {
      total: ops.length,
      unsettled: ops.filter(
        (op) => op?.state === "prepared" || op?.state === "started",
      ).length,
      unknown: count("unknown"),
      committed: count("committed"),
      failed: count("failed"),
    };
  }
  const value = source && typeof source === "object" ? source : {};
  return {
    total: nonNegativeInteger(value.total),
    unsettled: nonNegativeInteger(value.unsettled),
    unknown: nonNegativeInteger(value.unknown),
    committed: nonNegativeInteger(value.committed),
    failed: nonNegativeInteger(value.failed),
  };
}

function normalizeUnit(unit, run) {
  const key = boundedString(unit?.key, 256);
  if (!key) throw new Error("Collaboration unit key is required");
  const status = UNIT_STATUSES.has(unit?.status) ? unit.status : "pending";
  const sessionId = boundedString(unit?.sessionId, 256);
  return {
    key,
    owner: `${run.kind}:${run.id}:${key}`.slice(0, 512),
    sessionId,
    branch: boundedString(unit?.branch, 512),
    worktreePath: boundedString(unit?.worktreePath, 4096),
    status,
    startedAt: positiveNumber(unit?.startedAt),
    endedAt: positiveNumber(unit?.endedAt),
    sideEffects: summarizeSideEffects(unit?.sideEffects),
  };
}

function normalizeRun(input) {
  const kind = safeKind(input?.kind);
  const id = safeRunId(input?.id);
  if (!id.startsWith(`${kind}-`)) {
    throw new Error(
      `Collaboration run id "${id}" does not match kind "${kind}"`,
    );
  }
  const permissionMode = PERMISSION_MODES.has(input?.permissionMode)
    ? input.permissionMode
    : "default";
  const status = new Set(["running", ...TERMINAL_RUN_STATUSES]).has(
    input?.status,
  )
    ? input.status
    : "running";
  const startedAt = positiveNumber(input?.startedAt) || _deps.now();
  const run = {
    version: COLLABORATION_RUN_VERSION,
    id,
    kind,
    owner: `${kind}:${id}`,
    status,
    repoRoot: boundedString(input?.repoRoot, 4096),
    permissionMode,
    resourceBudget: normalizeBudget(input?.resourceBudget),
    startedAt,
    updatedAt: positiveNumber(input?.updatedAt) || startedAt,
    endedAt: TERMINAL_RUN_STATUSES.has(status)
      ? positiveNumber(input?.endedAt) || startedAt
      : null,
    units: [],
  };
  const seen = new Set();
  for (const unit of Array.isArray(input?.units)
    ? input.units.slice(0, 1000)
    : []) {
    const normalized = normalizeUnit(unit, run);
    if (seen.has(normalized.key)) {
      throw new Error(`Duplicate collaboration unit key: ${normalized.key}`);
    }
    seen.add(normalized.key);
    run.units.push(normalized);
  }
  return run;
}

export function writeCollaborationRun(input) {
  const run = normalizeRun(input);
  const target = collaborationRunPath(run.id);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(run, null, 2), { mode: 0o600 });
  renameSync(temp, target);
  return run;
}

export function createCollaborationRun(input) {
  const kind = safeKind(input?.kind);
  const id = input?.id ? safeRunId(input.id) : createCollaborationRunId(kind);
  if (existsSync(collaborationRunPath(id))) {
    throw new Error(`Collaboration run already exists: ${id}`);
  }
  return writeCollaborationRun({
    ...input,
    id,
    kind,
    status: "running",
    startedAt: input?.startedAt || _deps.now(),
  });
}

export function readCollaborationRun(id) {
  const target = collaborationRunPath(id);
  if (!existsSync(target)) return null;
  try {
    return normalizeRun(JSON.parse(readFileSync(target, "utf8")));
  } catch {
    return null;
  }
}

export function updateCollaborationRun(id, updater) {
  const current = readCollaborationRun(id);
  if (!current) throw new Error(`Collaboration run not found: ${id}`);
  const draft = JSON.parse(JSON.stringify(current));
  const changed =
    typeof updater === "function"
      ? updater(draft) || draft
      : { ...draft, ...updater };
  return writeCollaborationRun({
    ...changed,
    id: current.id,
    kind: current.kind,
  });
}

export function updateCollaborationUnit(runId, key, patch = {}) {
  const targetKey = boundedString(key, 256);
  return updateCollaborationRun(runId, (run) => {
    const index = run.units.findIndex((unit) => unit.key === targetKey);
    if (index < 0) {
      throw new Error(`Collaboration unit not found: ${targetKey}`);
    }
    const current = run.units[index];
    const status = UNIT_STATUSES.has(patch.status)
      ? patch.status
      : current.status;
    run.units[index] = {
      ...current,
      ...(patch.branch !== undefined
        ? { branch: boundedString(patch.branch, 512) }
        : {}),
      ...(patch.worktreePath !== undefined
        ? { worktreePath: boundedString(patch.worktreePath, 4096) }
        : {}),
      status,
      startedAt:
        patch.startedAt !== undefined
          ? positiveNumber(patch.startedAt)
          : current.startedAt,
      endedAt:
        patch.endedAt !== undefined
          ? positiveNumber(patch.endedAt)
          : current.endedAt,
      sideEffects:
        patch.sideEffects !== undefined
          ? summarizeSideEffects(patch.sideEffects)
          : current.sideEffects,
    };
    run.updatedAt = _deps.now();
    return run;
  });
}

export function finalizeCollaborationRun(id, status = "completed") {
  if (!TERMINAL_RUN_STATUSES.has(status)) {
    throw new Error(`Invalid terminal collaboration status: ${status}`);
  }
  return updateCollaborationRun(id, (run) => {
    run.status = status;
    run.updatedAt = _deps.now();
    run.endedAt = run.updatedAt;
    return run;
  });
}

export function listCollaborationRuns({ limit = 200 } = {}) {
  const capped = Math.max(1, Math.min(1000, Number(limit) || 200));
  return readdirSync(collaborationRunsDir())
    .filter((name) => /^(team|batch)-[a-zA-Z0-9._-]+\.json$/.test(name))
    .map((name) => readCollaborationRun(name.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, capped);
}

/**
 * Project run units into the bounded shape consumed by IDE worktree task rows.
 * The caller can publish this as `managedTasks`; no control operation consumes
 * these records.
 */
export function projectCollaborationTasks(runs) {
  const rows = [];
  for (const run of Array.isArray(runs) ? runs.slice(0, 200) : []) {
    for (const unit of Array.isArray(run?.units)
      ? run.units.slice(0, 1000)
      : []) {
      if (!unit.branch && !unit.worktreePath) continue;
      rows.push({
        managedTaskId: `${run.id}:${unit.key}`.slice(0, 512),
        runId: run.id,
        runKind: run.kind,
        branch: unit.branch,
        worktreePath: unit.worktreePath,
        status: unit.status,
        governance: {
          version: 1,
          owner: unit.owner,
          sessionId: unit.sessionId,
          permissionMode: run.permissionMode,
          resourceBudget: run.resourceBudget,
        },
        sideEffects: summarizeSideEffects(unit.sideEffects),
      });
      if (rows.length >= 1000) return rows;
    }
  }
  return rows;
}
