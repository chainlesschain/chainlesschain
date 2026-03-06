/**
 * Terraform Provider Manager
 *
 * Infrastructure as Code workspace management:
 * - Workspace CRUD operations
 * - Plan/apply/destroy runs
 * - State management and tracking
 * - Provider configuration
 *
 * @module enterprise/terraform-manager
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// Constants
// ============================================================

const RUN_STATUS = {
  PENDING: "pending",
  PLANNING: "planning",
  PLANNED: "planned",
  APPLYING: "applying",
  APPLIED: "applied",
  DESTROYING: "destroying",
  DESTROYED: "destroyed",
  ERRORED: "errored",
  CANCELLED: "cancelled",
};

const RUN_TYPES = {
  PLAN: "plan",
  APPLY: "apply",
  DESTROY: "destroy",
};

const WORKSPACE_STATUS = {
  ACTIVE: "active",
  LOCKED: "locked",
  ARCHIVED: "archived",
};

// ============================================================
// TerraformManager
// ============================================================

class TerraformManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.initialized = false;
    this._workspaces = new Map();
    this._runs = new Map();
    this._maxConcurrentRuns = 3;
    this._activeRunCount = 0;
  }

  _ensureTables() {
    if (!this.database || !this.database.db) {
      return;
    }

    this.database.db.exec(`
      CREATE TABLE IF NOT EXISTS terraform_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        terraform_version TEXT DEFAULT '1.9.0',
        working_directory TEXT,
        auto_apply INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        last_run_id TEXT,
        last_run_at INTEGER,
        state_version INTEGER DEFAULT 0,
        variables TEXT,
        providers TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_terraform_workspaces_name ON terraform_workspaces(name);
      CREATE INDEX IF NOT EXISTS idx_terraform_workspaces_status ON terraform_workspaces(status);

      CREATE TABLE IF NOT EXISTS terraform_runs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        run_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        plan_output TEXT,
        apply_output TEXT,
        resources_added INTEGER DEFAULT 0,
        resources_changed INTEGER DEFAULT 0,
        resources_destroyed INTEGER DEFAULT 0,
        triggered_by TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        error_message TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_terraform_runs_workspace ON terraform_runs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_terraform_runs_status ON terraform_runs(status);
    `);
  }

  async initialize() {
    logger.info("[TerraformManager] Initializing Terraform manager...");
    this._ensureTables();

    if (this.database && this.database.db) {
      try {
        const workspaces = this.database.db
          .prepare(
            "SELECT * FROM terraform_workspaces WHERE status != 'archived'",
          )
          .all();
        for (const ws of workspaces) {
          this._workspaces.set(ws.id, {
            ...ws,
            variables: ws.variables ? JSON.parse(ws.variables) : {},
            providers: ws.providers ? JSON.parse(ws.providers) : [],
          });
        }
        logger.info(
          `[TerraformManager] Loaded ${workspaces.length} workspaces`,
        );
      } catch (err) {
        logger.error("[TerraformManager] Failed to load workspaces:", err);
      }
    }

    this.initialized = true;
    logger.info("[TerraformManager] Terraform manager initialized");
  }

  /**
   * List all workspaces
   * @param {Object} [filter]
   * @param {string} [filter.status] - Filter by status
   * @param {number} [filter.limit] - Max results
   * @returns {Array} Workspaces
   */
  async listWorkspaces(filter = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM terraform_workspaces WHERE 1=1";
        const params = [];

        if (filter.status) {
          sql += " AND status = ?";
          params.push(filter.status);
        } else {
          sql += " AND status != 'archived'";
        }

        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(filter.limit || 50);

        const rows = this.database.db.prepare(sql).all(...params);
        return rows.map((r) => ({
          ...r,
          variables: r.variables ? JSON.parse(r.variables) : {},
          providers: r.providers ? JSON.parse(r.providers) : [],
        }));
      } catch (err) {
        logger.error("[TerraformManager] Failed to list workspaces:", err);
      }
    }

    let workspaces = Array.from(this._workspaces.values());
    if (filter.status) {
      workspaces = workspaces.filter((w) => w.status === filter.status);
    }
    return workspaces.slice(0, filter.limit || 50);
  }

  /**
   * Create a new workspace
   * @param {Object} params
   * @param {string} params.name - Workspace name
   * @param {string} [params.description] - Description
   * @param {string} [params.terraformVersion] - Terraform version
   * @param {string} [params.workingDirectory] - Working directory
   * @param {boolean} [params.autoApply] - Auto-apply after plan
   * @param {Object} [params.variables] - Terraform variables
   * @param {Array} [params.providers] - Provider list
   * @returns {Object} Created workspace
   */
  async createWorkspace({
    name,
    description,
    terraformVersion,
    workingDirectory,
    autoApply,
    variables,
    providers,
  } = {}) {
    if (!name) {
      throw new Error("Workspace name is required");
    }

    // Check for duplicate name
    for (const ws of this._workspaces.values()) {
      if (ws.name === name) {
        throw new Error(`Workspace already exists: ${name}`);
      }
    }

    const id = uuidv4();
    const now = Date.now();

    const workspace = {
      id,
      name,
      description: description || "",
      terraform_version: terraformVersion || "1.9.0",
      working_directory: workingDirectory || `/terraform/${name}`,
      auto_apply: autoApply ? 1 : 0,
      status: WORKSPACE_STATUS.ACTIVE,
      last_run_id: null,
      last_run_at: null,
      state_version: 0,
      variables: variables || {},
      providers: providers || ["hashicorp/aws"],
      created_at: now,
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        INSERT INTO terraform_workspaces (id, name, description, terraform_version, working_directory, auto_apply, status, state_version, variables, providers, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          id,
          name,
          workspace.description,
          workspace.terraform_version,
          workspace.working_directory,
          workspace.auto_apply,
          workspace.status,
          0,
          JSON.stringify(workspace.variables),
          JSON.stringify(workspace.providers),
          now,
        );
    }

    this._workspaces.set(id, workspace);
    this.emit("workspace-created", workspace);
    logger.info(`[TerraformManager] Workspace created: ${name} (${id})`);
    return workspace;
  }

  /**
   * Execute a plan run for a workspace
   * @param {Object} params
   * @param {string} params.workspaceId - Workspace ID
   * @param {string} [params.runType] - Run type (plan/apply/destroy)
   * @param {string} [params.triggeredBy] - Who triggered the run
   * @returns {Object} Run result
   */
  async planRun({
    workspaceId,
    runType = RUN_TYPES.PLAN,
    triggeredBy = "manual",
  } = {}) {
    if (!workspaceId) {
      throw new Error("Workspace ID is required");
    }

    const workspace = this._workspaces.get(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    if (workspace.status === WORKSPACE_STATUS.LOCKED) {
      throw new Error(`Workspace is locked: ${workspace.name}`);
    }

    if (this._activeRunCount >= this._maxConcurrentRuns) {
      throw new Error(
        `Max concurrent runs (${this._maxConcurrentRuns}) exceeded`,
      );
    }

    const validTypes = Object.values(RUN_TYPES);
    if (!validTypes.includes(runType)) {
      throw new Error(
        `Invalid run type: ${runType}. Must be one of: ${validTypes.join(", ")}`,
      );
    }

    const runId = uuidv4();
    const now = Date.now();

    this._activeRunCount++;

    const run = {
      id: runId,
      workspace_id: workspaceId,
      run_type: runType,
      status: RUN_STATUS.PLANNING,
      plan_output: null,
      apply_output: null,
      resources_added: 0,
      resources_changed: 0,
      resources_destroyed: 0,
      triggered_by: triggeredBy,
      started_at: now,
      completed_at: null,
      error_message: null,
      created_at: now,
    };

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        INSERT INTO terraform_runs (id, workspace_id, run_type, status, triggered_by, started_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          runId,
          workspaceId,
          runType,
          RUN_STATUS.PLANNING,
          triggeredBy,
          now,
          now,
        );
    }

    this.emit("run-started", run);

    // Simulate plan output
    const added = Math.floor(Math.random() * 5) + 1;
    const changed = Math.floor(Math.random() * 3);
    const destroyed = runType === RUN_TYPES.DESTROY ? added : 0;

    run.plan_output = `Terraform will perform the following actions:\n  + ${added} to add\n  ~ ${changed} to change\n  - ${destroyed} to destroy`;
    run.resources_added = added;
    run.resources_changed = changed;
    run.resources_destroyed = destroyed;
    run.status =
      runType === RUN_TYPES.PLAN ? RUN_STATUS.PLANNED : RUN_STATUS.APPLIED;
    run.completed_at = Date.now();

    if (runType !== RUN_TYPES.PLAN) {
      run.apply_output = `Apply complete! Resources: ${added} added, ${changed} changed, ${destroyed} destroyed.`;
    }

    if (this.database && this.database.db) {
      this.database.db
        .prepare(
          `
        UPDATE terraform_runs SET status = ?, plan_output = ?, apply_output = ?, resources_added = ?, resources_changed = ?, resources_destroyed = ?, completed_at = ? WHERE id = ?
      `,
        )
        .run(
          run.status,
          run.plan_output,
          run.apply_output,
          run.resources_added,
          run.resources_changed,
          run.resources_destroyed,
          run.completed_at,
          runId,
        );

      // Update workspace last run
      this.database.db
        .prepare(
          "UPDATE terraform_workspaces SET last_run_id = ?, last_run_at = ?, state_version = state_version + 1 WHERE id = ?",
        )
        .run(runId, run.completed_at, workspaceId);
    }

    workspace.last_run_id = runId;
    workspace.last_run_at = run.completed_at;
    workspace.state_version = (workspace.state_version || 0) + 1;

    this._runs.set(runId, run);
    this._activeRunCount--;

    this.emit("run-completed", run);
    logger.info(
      `[TerraformManager] Run completed: ${runType} for ${workspace.name} (+${added} ~${changed} -${destroyed})`,
    );
    return run;
  }

  /**
   * List runs for a workspace
   * @param {Object} [params]
   * @param {string} [params.workspaceId] - Filter by workspace
   * @param {number} [params.limit] - Max results
   * @returns {Array} Runs
   */
  async listRuns({ workspaceId, limit = 20 } = {}) {
    if (this.database && this.database.db) {
      try {
        let sql = "SELECT * FROM terraform_runs WHERE 1=1";
        const params = [];

        if (workspaceId) {
          sql += " AND workspace_id = ?";
          params.push(workspaceId);
        }

        sql += " ORDER BY created_at DESC LIMIT ?";
        params.push(limit);

        return this.database.db.prepare(sql).all(...params);
      } catch (err) {
        logger.error("[TerraformManager] Failed to list runs:", err);
      }
    }

    let runs = Array.from(this._runs.values());
    if (workspaceId) {
      runs = runs.filter((r) => r.workspace_id === workspaceId);
    }
    return runs.slice(0, limit);
  }

  async close() {
    this.removeAllListeners();
    this._workspaces.clear();
    this._runs.clear();
    this._activeRunCount = 0;
    this.initialized = false;
    logger.info("[TerraformManager] Closed");
  }
}

// ============================================================
// Singleton
// ============================================================

let _instance = null;

function getTerraformManager(database) {
  if (!_instance) {
    _instance = new TerraformManager(database);
  }
  return _instance;
}

export {
  TerraformManager,
  getTerraformManager,
  RUN_STATUS,
  RUN_TYPES,
  WORKSPACE_STATUS,
};
export default TerraformManager;
