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
const WORKSPACE_STATUS = { ACTIVE: "active", LOCKED: "locked", ARCHIVED: "archived" };

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
  const destroyed = runType === RUN_TYPES.DESTROY ? Math.floor(Math.random() * 5) + 1 : 0;

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
}
