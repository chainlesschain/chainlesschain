/**
 * Terraform Manager — workspace management, plan/apply runs,
 * and infrastructure-as-code operations.
 */

import crypto from "crypto";

/* ── In-memory stores ──────────────────────────────────────── */
const _workspaces = new Map();
const _runs = new Map();

const RUN_STATUS = {
  PENDING: "pending",
  PLANNING: "planning",
  PLANNED: "planned",
  APPLYING: "applying",
  APPLIED: "applied",
  ERRORED: "errored",
};

const RUN_TYPES = { PLAN: "plan", APPLY: "apply", DESTROY: "destroy" };
const WORKSPACE_STATUS = {
  ACTIVE: "active",
  LOCKED: "locked",
  ARCHIVED: "archived",
};

/* ── Schema ────────────────────────────────────────────────── */

export function ensureTerraformTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS terraform_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      terraform_version TEXT DEFAULT '1.9.0',
      working_directory TEXT,
      auto_apply INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      last_run_id TEXT,
      last_run_at TEXT,
      state_version INTEGER DEFAULT 0,
      variables TEXT,
      providers TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS terraform_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      run_type TEXT DEFAULT 'plan',
      status TEXT DEFAULT 'pending',
      plan_output TEXT,
      apply_output TEXT,
      resources_added INTEGER DEFAULT 0,
      resources_changed INTEGER DEFAULT 0,
      resources_destroyed INTEGER DEFAULT 0,
      triggered_by TEXT,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/* ── Workspace Management ─────────────────────────────────── */

export function listWorkspaces(filter = {}) {
  let workspaces = [..._workspaces.values()];
  if (filter.status) {
    workspaces = workspaces.filter((w) => w.status === filter.status);
  }
  const limit = filter.limit || 50;
  return workspaces.slice(0, limit);
}

export function createWorkspace(db, name, opts = {}) {
  if (!name) throw new Error("Workspace name is required");

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const workspace = {
    id,
    name,
    description: opts.description || "",
    terraformVersion: opts.terraformVersion || "1.9.0",
    workingDirectory: opts.workingDirectory || ".",
    autoApply: opts.autoApply || false,
    status: WORKSPACE_STATUS.ACTIVE,
    lastRunId: null,
    lastRunAt: null,
    stateVersion: 0,
    variables: opts.variables || {},
    providers: opts.providers || ["hashicorp/aws"],
    createdAt: now,
  };

  _workspaces.set(id, workspace);

  db.prepare(
    `INSERT INTO terraform_workspaces (id, name, description, terraform_version, working_directory, auto_apply, status, last_run_id, last_run_at, state_version, variables, providers, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    workspace.description,
    workspace.terraformVersion,
    workspace.workingDirectory,
    workspace.autoApply ? 1 : 0,
    workspace.status,
    null,
    null,
    0,
    JSON.stringify(workspace.variables),
    JSON.stringify(workspace.providers),
    now,
  );

  return workspace;
}

/* ── Run Management ───────────────────────────────────────── */

export function planRun(db, workspaceId, opts = {}) {
  const workspace = _workspaces.get(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const runType = opts.runType || RUN_TYPES.PLAN;

  // Simulate resource changes
  const added = Math.floor(Math.random() * 5) + 1;
  const changed = Math.floor(Math.random() * 3);
  const destroyed =
    runType === RUN_TYPES.DESTROY ? Math.floor(Math.random() * 5) + 1 : 0;

  const run = {
    id,
    workspaceId,
    runType,
    status: RUN_STATUS.PLANNED,
    planOutput: `Plan: ${added} to add, ${changed} to change, ${destroyed} to destroy.`,
    applyOutput: null,
    resourcesAdded: added,
    resourcesChanged: changed,
    resourcesDestroyed: destroyed,
    triggeredBy: opts.triggeredBy || "cli-user",
    startedAt: now,
    completedAt: now,
    errorMessage: null,
    createdAt: now,
  };

  _runs.set(id, run);

  workspace.lastRunId = id;
  workspace.lastRunAt = now;
  workspace.stateVersion++;

  db.prepare(
    `INSERT INTO terraform_runs (id, workspace_id, run_type, status, plan_output, apply_output, resources_added, resources_changed, resources_destroyed, triggered_by, started_at, completed_at, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    runType,
    run.status,
    run.planOutput,
    null,
    run.resourcesAdded,
    run.resourcesChanged,
    run.resourcesDestroyed,
    run.triggeredBy,
    now,
    now,
    null,
    now,
  );

  return run;
}

export function listRuns(filter = {}) {
  let runs = [..._runs.values()];
  if (filter.workspaceId) {
    runs = runs.filter((r) => r.workspaceId === filter.workspaceId);
  }
  const limit = filter.limit || 20;
  return runs.slice(0, limit);
}

/* ── Reset (for testing) ───────────────────────────────────── */

export function _resetState() {
  _workspaces.clear();
  _runs.clear();
  _maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS;
}

/* ═══════════════════════════════════════════════════════════════
 * V2 Canonical Surface (Phase 56 — Terraform Manager)
 *   Strictly additive; legacy exports above remain unchanged.
 * ═══════════════════════════════════════════════════════════════ */

export const RUN_STATUS_V2 = Object.freeze({
  PENDING: "pending",
  PLANNING: "planning",
  PLANNED: "planned",
  APPLYING: "applying",
  APPLIED: "applied",
  DESTROYING: "destroying",
  DESTROYED: "destroyed",
  ERRORED: "errored",
  CANCELLED: "cancelled",
});

export const RUN_TYPE_V2 = Object.freeze({
  PLAN: "plan",
  APPLY: "apply",
  DESTROY: "destroy",
});

export const WORKSPACE_STATUS_V2 = Object.freeze({
  ACTIVE: "active",
  LOCKED: "locked",
  ARCHIVED: "archived",
});

const DEFAULT_MAX_CONCURRENT_RUNS = 5;
let _maxConcurrentRuns = DEFAULT_MAX_CONCURRENT_RUNS;

export const TERRAFORM_DEFAULT_MAX_CONCURRENT = DEFAULT_MAX_CONCURRENT_RUNS;

export function setMaxConcurrentRuns(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) {
    throw new Error("maxConcurrentRuns must be a positive integer");
  }
  _maxConcurrentRuns = Math.floor(n);
  return _maxConcurrentRuns;
}

export function getMaxConcurrentRuns() {
  return _maxConcurrentRuns;
}

const _activeRunStatuses = new Set([
  RUN_STATUS_V2.PENDING,
  RUN_STATUS_V2.PLANNING,
  RUN_STATUS_V2.APPLYING,
  RUN_STATUS_V2.DESTROYING,
]);

const _terminalRunStatuses = new Set([
  RUN_STATUS_V2.APPLIED,
  RUN_STATUS_V2.DESTROYED,
  RUN_STATUS_V2.ERRORED,
  RUN_STATUS_V2.CANCELLED,
]);

// run-status state machine
const _allowedRunTransitions = new Map([
  [
    RUN_STATUS_V2.PENDING,
    new Set([
      RUN_STATUS_V2.PLANNING,
      RUN_STATUS_V2.CANCELLED,
      RUN_STATUS_V2.ERRORED,
    ]),
  ],
  [
    RUN_STATUS_V2.PLANNING,
    new Set([
      RUN_STATUS_V2.PLANNED,
      RUN_STATUS_V2.ERRORED,
      RUN_STATUS_V2.CANCELLED,
    ]),
  ],
  [
    RUN_STATUS_V2.PLANNED,
    new Set([
      RUN_STATUS_V2.APPLYING,
      RUN_STATUS_V2.DESTROYING,
      RUN_STATUS_V2.CANCELLED,
      RUN_STATUS_V2.ERRORED,
    ]),
  ],
  [
    RUN_STATUS_V2.APPLYING,
    new Set([RUN_STATUS_V2.APPLIED, RUN_STATUS_V2.ERRORED]),
  ],
  [
    RUN_STATUS_V2.DESTROYING,
    new Set([RUN_STATUS_V2.DESTROYED, RUN_STATUS_V2.ERRORED]),
  ],
  [RUN_STATUS_V2.APPLIED, new Set([])],
  [RUN_STATUS_V2.DESTROYED, new Set([])],
  [RUN_STATUS_V2.ERRORED, new Set([])],
  [RUN_STATUS_V2.CANCELLED, new Set([])],
]);

// workspace-status state machine
const _allowedWorkspaceTransitions = new Map([
  [
    WORKSPACE_STATUS_V2.ACTIVE,
    new Set([WORKSPACE_STATUS_V2.LOCKED, WORKSPACE_STATUS_V2.ARCHIVED]),
  ],
  [
    WORKSPACE_STATUS_V2.LOCKED,
    new Set([WORKSPACE_STATUS_V2.ACTIVE, WORKSPACE_STATUS_V2.ARCHIVED]),
  ],
  [WORKSPACE_STATUS_V2.ARCHIVED, new Set([WORKSPACE_STATUS_V2.ACTIVE])],
]);

export function createWorkspaceV2(db, options = {}) {
  const {
    name,
    description,
    terraformVersion,
    workingDirectory,
    autoApply,
    variables,
    providers,
  } = options;

  if (!name) throw new Error("Workspace name is required");

  // Unique name check
  for (const existing of _workspaces.values()) {
    if (existing.name === name) {
      throw new Error(`Workspace name already exists: ${name}`);
    }
  }

  return createWorkspace(db, name, {
    description,
    terraformVersion,
    workingDirectory,
    autoApply,
    variables,
    providers,
  });
}

export function setWorkspaceStatus(db, workspaceId, newStatus) {
  const workspace = _workspaces.get(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const validStatuses = Object.values(WORKSPACE_STATUS_V2);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Unknown workspace status: ${newStatus}`);
  }

  const allowed = _allowedWorkspaceTransitions.get(workspace.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid workspace status transition: ${workspace.status} → ${newStatus}`,
    );
  }

  workspace.status = newStatus;
  db.prepare(`UPDATE terraform_workspaces SET status = ? WHERE id = ?`).run(
    newStatus,
    workspaceId,
  );

  return { workspaceId, status: newStatus };
}

export function archiveWorkspace(db, workspaceId) {
  return setWorkspaceStatus(db, workspaceId, WORKSPACE_STATUS_V2.ARCHIVED);
}

function _countActiveRuns() {
  let count = 0;
  for (const r of _runs.values()) {
    if (_activeRunStatuses.has(r.status)) count++;
  }
  return count;
}

export function planRunV2(db, options = {}) {
  const { workspaceId, runType, triggeredBy } = options;
  const workspace = _workspaces.get(workspaceId);
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  const validRunTypes = Object.values(RUN_TYPE_V2);
  const effectiveType = runType || RUN_TYPE_V2.PLAN;
  if (!validRunTypes.includes(effectiveType)) {
    throw new Error(`Unknown run type: ${effectiveType}`);
  }

  if (workspace.status === WORKSPACE_STATUS_V2.ARCHIVED) {
    throw new Error(`Cannot plan run on archived workspace: ${workspaceId}`);
  }

  const activeCount = _countActiveRuns();
  if (activeCount >= _maxConcurrentRuns) {
    throw new Error(
      `Max concurrent runs reached: ${activeCount}/${_maxConcurrentRuns}`,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const run = {
    id,
    workspaceId,
    runType: effectiveType,
    status: RUN_STATUS_V2.PENDING,
    planOutput: null,
    applyOutput: null,
    resourcesAdded: 0,
    resourcesChanged: 0,
    resourcesDestroyed: 0,
    triggeredBy: triggeredBy || "manual",
    startedAt: now,
    completedAt: null,
    errorMessage: null,
    createdAt: now,
  };

  _runs.set(id, run);

  db.prepare(
    `INSERT INTO terraform_runs (id, workspace_id, run_type, status, plan_output, apply_output, resources_added, resources_changed, resources_destroyed, triggered_by, started_at, completed_at, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    workspaceId,
    effectiveType,
    run.status,
    null,
    null,
    0,
    0,
    0,
    run.triggeredBy,
    now,
    null,
    null,
    now,
  );

  return run;
}

export function setRunStatus(db, runId, newStatus, patch = {}) {
  const run = _runs.get(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const validStatuses = Object.values(RUN_STATUS_V2);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Unknown run status: ${newStatus}`);
  }

  const allowed = _allowedRunTransitions.get(run.status);
  if (!allowed || !allowed.has(newStatus)) {
    throw new Error(
      `Invalid run status transition: ${run.status} → ${newStatus}`,
    );
  }

  run.status = newStatus;
  if (typeof patch.planOutput === "string") run.planOutput = patch.planOutput;
  if (typeof patch.applyOutput === "string")
    run.applyOutput = patch.applyOutput;
  if (typeof patch.resourcesAdded === "number")
    run.resourcesAdded = patch.resourcesAdded;
  if (typeof patch.resourcesChanged === "number")
    run.resourcesChanged = patch.resourcesChanged;
  if (typeof patch.resourcesDestroyed === "number")
    run.resourcesDestroyed = patch.resourcesDestroyed;
  if (typeof patch.errorMessage === "string")
    run.errorMessage = patch.errorMessage;
  if (_terminalRunStatuses.has(newStatus)) {
    run.completedAt = new Date().toISOString();
  }

  db.prepare(
    `UPDATE terraform_runs SET status = ?, plan_output = ?, apply_output = ?, resources_added = ?, resources_changed = ?, resources_destroyed = ?, error_message = ?, completed_at = ? WHERE id = ?`,
  ).run(
    run.status,
    run.planOutput,
    run.applyOutput,
    run.resourcesAdded,
    run.resourcesChanged,
    run.resourcesDestroyed,
    run.errorMessage,
    run.completedAt,
    runId,
  );

  // Bump workspace state version on terminal apply/destroy
  if (
    newStatus === RUN_STATUS_V2.APPLIED ||
    newStatus === RUN_STATUS_V2.DESTROYED
  ) {
    const workspace = _workspaces.get(run.workspaceId);
    if (workspace) {
      workspace.stateVersion++;
      workspace.lastRunId = runId;
      workspace.lastRunAt = new Date().toISOString();
    }
  }

  return run;
}

export function cancelRun(db, runId) {
  return setRunStatus(db, runId, RUN_STATUS_V2.CANCELLED);
}

export function failRun(db, runId, errorMessage) {
  return setRunStatus(db, runId, RUN_STATUS_V2.ERRORED, { errorMessage });
}

export function getActiveRunCount() {
  return _countActiveRuns();
}

export function getTerraformStatsV2() {
  const workspaces = [..._workspaces.values()];
  const runs = [..._runs.values()];

  const wsByStatus = {};
  for (const s of Object.values(WORKSPACE_STATUS_V2)) wsByStatus[s] = 0;
  for (const w of workspaces)
    wsByStatus[w.status] = (wsByStatus[w.status] || 0) + 1;

  const runsByStatus = {};
  for (const s of Object.values(RUN_STATUS_V2)) runsByStatus[s] = 0;
  for (const r of runs)
    runsByStatus[r.status] = (runsByStatus[r.status] || 0) + 1;

  const runsByType = {};
  for (const t of Object.values(RUN_TYPE_V2)) runsByType[t] = 0;
  for (const r of runs)
    runsByType[r.runType] = (runsByType[r.runType] || 0) + 1;

  const totalResources = runs.reduce(
    (acc, r) => ({
      added: acc.added + (r.resourcesAdded || 0),
      changed: acc.changed + (r.resourcesChanged || 0),
      destroyed: acc.destroyed + (r.resourcesDestroyed || 0),
    }),
    { added: 0, changed: 0, destroyed: 0 },
  );

  return {
    totalWorkspaces: workspaces.length,
    totalRuns: runs.length,
    activeRuns: _countActiveRuns(),
    maxConcurrentRuns: _maxConcurrentRuns,
    workspacesByStatus: wsByStatus,
    runsByStatus,
    runsByType,
    totalResources,
  };
}
