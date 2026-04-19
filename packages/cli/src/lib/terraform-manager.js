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

// =====================================================================
// terraform-manager V2 governance overlay (iter16)
// =====================================================================
export const TFGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  DRIFTED: "drifted",
  ARCHIVED: "archived",
});
export const TFGOV_APPLY_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  APPLYING: "applying",
  APPLIED: "applied",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _tfgovPTrans = new Map([
  [
    TFGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      TFGOV_PROFILE_MATURITY_V2.ACTIVE,
      TFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TFGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      TFGOV_PROFILE_MATURITY_V2.DRIFTED,
      TFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    TFGOV_PROFILE_MATURITY_V2.DRIFTED,
    new Set([
      TFGOV_PROFILE_MATURITY_V2.ACTIVE,
      TFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [TFGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _tfgovPTerminal = new Set([TFGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _tfgovJTrans = new Map([
  [
    TFGOV_APPLY_LIFECYCLE_V2.QUEUED,
    new Set([
      TFGOV_APPLY_LIFECYCLE_V2.APPLYING,
      TFGOV_APPLY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    TFGOV_APPLY_LIFECYCLE_V2.APPLYING,
    new Set([
      TFGOV_APPLY_LIFECYCLE_V2.APPLIED,
      TFGOV_APPLY_LIFECYCLE_V2.FAILED,
      TFGOV_APPLY_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [TFGOV_APPLY_LIFECYCLE_V2.APPLIED, new Set()],
  [TFGOV_APPLY_LIFECYCLE_V2.FAILED, new Set()],
  [TFGOV_APPLY_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _tfgovPsV2 = new Map();
const _tfgovJsV2 = new Map();
let _tfgovMaxActive = 6,
  _tfgovMaxPending = 12,
  _tfgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _tfgovStuckMs = 60 * 1000;
function _tfgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _tfgovCheckP(from, to) {
  const a = _tfgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid tfgov profile transition ${from} → ${to}`);
}
function _tfgovCheckJ(from, to) {
  const a = _tfgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid tfgov apply transition ${from} → ${to}`);
}
function _tfgovCountActive(owner) {
  let c = 0;
  for (const p of _tfgovPsV2.values())
    if (p.owner === owner && p.status === TFGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _tfgovCountPending(profileId) {
  let c = 0;
  for (const j of _tfgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === TFGOV_APPLY_LIFECYCLE_V2.QUEUED ||
        j.status === TFGOV_APPLY_LIFECYCLE_V2.APPLYING)
    )
      c++;
  return c;
}
export function setMaxActiveTfgovProfilesPerOwnerV2(n) {
  _tfgovMaxActive = _tfgovPos(n, "maxActiveTfgovProfilesPerOwner");
}
export function getMaxActiveTfgovProfilesPerOwnerV2() {
  return _tfgovMaxActive;
}
export function setMaxPendingTfgovApplysPerProfileV2(n) {
  _tfgovMaxPending = _tfgovPos(n, "maxPendingTfgovApplysPerProfile");
}
export function getMaxPendingTfgovApplysPerProfileV2() {
  return _tfgovMaxPending;
}
export function setTfgovProfileIdleMsV2(n) {
  _tfgovIdleMs = _tfgovPos(n, "tfgovProfileIdleMs");
}
export function getTfgovProfileIdleMsV2() {
  return _tfgovIdleMs;
}
export function setTfgovApplyStuckMsV2(n) {
  _tfgovStuckMs = _tfgovPos(n, "tfgovApplyStuckMs");
}
export function getTfgovApplyStuckMsV2() {
  return _tfgovStuckMs;
}
export function _resetStateTerraformManagerV2() {
  _tfgovPsV2.clear();
  _tfgovJsV2.clear();
  _tfgovMaxActive = 6;
  _tfgovMaxPending = 12;
  _tfgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _tfgovStuckMs = 60 * 1000;
}
export function registerTfgovProfileV2({ id, owner, provider, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_tfgovPsV2.has(id)) throw new Error(`tfgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    provider: provider || "aws",
    status: TFGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _tfgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateTfgovProfileV2(id) {
  const p = _tfgovPsV2.get(id);
  if (!p) throw new Error(`tfgov profile ${id} not found`);
  const isInitial = p.status === TFGOV_PROFILE_MATURITY_V2.PENDING;
  _tfgovCheckP(p.status, TFGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _tfgovCountActive(p.owner) >= _tfgovMaxActive)
    throw new Error(`max active tfgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = TFGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function driftTfgovProfileV2(id) {
  const p = _tfgovPsV2.get(id);
  if (!p) throw new Error(`tfgov profile ${id} not found`);
  _tfgovCheckP(p.status, TFGOV_PROFILE_MATURITY_V2.DRIFTED);
  p.status = TFGOV_PROFILE_MATURITY_V2.DRIFTED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveTfgovProfileV2(id) {
  const p = _tfgovPsV2.get(id);
  if (!p) throw new Error(`tfgov profile ${id} not found`);
  _tfgovCheckP(p.status, TFGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = TFGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchTfgovProfileV2(id) {
  const p = _tfgovPsV2.get(id);
  if (!p) throw new Error(`tfgov profile ${id} not found`);
  if (_tfgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal tfgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getTfgovProfileV2(id) {
  const p = _tfgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listTfgovProfilesV2() {
  return [..._tfgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createTfgovApplyV2({ id, profileId, resource, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_tfgovJsV2.has(id)) throw new Error(`tfgov apply ${id} already exists`);
  if (!_tfgovPsV2.has(profileId))
    throw new Error(`tfgov profile ${profileId} not found`);
  if (_tfgovCountPending(profileId) >= _tfgovMaxPending)
    throw new Error(
      `max pending tfgov applys for profile ${profileId} reached`,
    );
  const now = Date.now();
  const j = {
    id,
    profileId,
    resource: resource || "",
    status: TFGOV_APPLY_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _tfgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function applyingTfgovApplyV2(id) {
  const j = _tfgovJsV2.get(id);
  if (!j) throw new Error(`tfgov apply ${id} not found`);
  _tfgovCheckJ(j.status, TFGOV_APPLY_LIFECYCLE_V2.APPLYING);
  const now = Date.now();
  j.status = TFGOV_APPLY_LIFECYCLE_V2.APPLYING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeApplyTfgovV2(id) {
  const j = _tfgovJsV2.get(id);
  if (!j) throw new Error(`tfgov apply ${id} not found`);
  _tfgovCheckJ(j.status, TFGOV_APPLY_LIFECYCLE_V2.APPLIED);
  const now = Date.now();
  j.status = TFGOV_APPLY_LIFECYCLE_V2.APPLIED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failTfgovApplyV2(id, reason) {
  const j = _tfgovJsV2.get(id);
  if (!j) throw new Error(`tfgov apply ${id} not found`);
  _tfgovCheckJ(j.status, TFGOV_APPLY_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = TFGOV_APPLY_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelTfgovApplyV2(id, reason) {
  const j = _tfgovJsV2.get(id);
  if (!j) throw new Error(`tfgov apply ${id} not found`);
  _tfgovCheckJ(j.status, TFGOV_APPLY_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = TFGOV_APPLY_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getTfgovApplyV2(id) {
  const j = _tfgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listTfgovApplysV2() {
  return [..._tfgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoDriftIdleTfgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _tfgovPsV2.values())
    if (
      p.status === TFGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _tfgovIdleMs
    ) {
      p.status = TFGOV_PROFILE_MATURITY_V2.DRIFTED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckTfgovApplysV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _tfgovJsV2.values())
    if (
      j.status === TFGOV_APPLY_LIFECYCLE_V2.APPLYING &&
      j.startedAt != null &&
      t - j.startedAt >= _tfgovStuckMs
    ) {
      j.status = TFGOV_APPLY_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getTerraformManagerGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(TFGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _tfgovPsV2.values()) profilesByStatus[p.status]++;
  const applysByStatus = {};
  for (const v of Object.values(TFGOV_APPLY_LIFECYCLE_V2))
    applysByStatus[v] = 0;
  for (const j of _tfgovJsV2.values()) applysByStatus[j.status]++;
  return {
    totalTfgovProfilesV2: _tfgovPsV2.size,
    totalTfgovApplysV2: _tfgovJsV2.size,
    maxActiveTfgovProfilesPerOwner: _tfgovMaxActive,
    maxPendingTfgovApplysPerProfile: _tfgovMaxPending,
    tfgovProfileIdleMs: _tfgovIdleMs,
    tfgovApplyStuckMs: _tfgovStuckMs,
    profilesByStatus,
    applysByStatus,
  };
}
