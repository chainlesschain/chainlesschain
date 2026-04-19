/**
 * Workflow Engine — DAG-based workflow creation, execution, and management.
 * Supports stages with action/approval types, pause/resume, rollback, built-in templates,
 * breakpoint debugging, checkpoint snapshots, and JSON import/export (Phase 82 port).
 */

import crypto from "crypto";

// ─── Frozen enums (Phase 82 spec) ─────────────────────────────

export const WORKFLOW_STATUS = Object.freeze({
  CREATED: "created",
  ACTIVE: "active",
  RUNNING: "running",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  ROLLING_BACK: "rolling_back",
  ROLLED_BACK: "rolled_back",
  ARCHIVED: "archived",
});

export const NODE_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
  WAITING_APPROVAL: "waiting_approval",
});

export const TEMPLATE_TYPE = Object.freeze({
  CI_CD: "ci_cd",
  DATA_PIPELINE: "data_pipeline",
  CODE_REVIEW: "code_review",
  DEPLOYMENT: "deployment",
  TEST_SUITE: "test_suite",
});

/**
 * Ensure workflow tables exist in the database.
 */
export function ensureWorkflowTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      dag TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      input TEXT,
      log TEXT DEFAULT '[]',
      current_stage TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_checkpoints (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      state_snapshot TEXT,
      node_states TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_breakpoints (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      condition TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Validate a DAG (directed acyclic graph) of stages using DFS cycle detection.
 * @param {Array} stages - Array of { id, type, name, next }
 * @returns {boolean} true if the DAG is valid (no cycles), false otherwise
 */
export function validateDAG(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return false;

  const stageMap = new Map();
  for (const stage of stages) {
    if (!stage.id || !stage.name) return false;
    stageMap.set(stage.id, stage);
  }

  // Check all next references point to valid stages
  for (const stage of stages) {
    if (stage.next) {
      for (const nextId of stage.next) {
        if (!stageMap.has(nextId)) return false;
      }
    }
  }

  // DFS cycle detection
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map();
  for (const stage of stages) {
    color.set(stage.id, WHITE);
  }

  function dfs(nodeId) {
    color.set(nodeId, GRAY);
    const node = stageMap.get(nodeId);
    const neighbors = node.next || [];
    for (const nextId of neighbors) {
      if (color.get(nextId) === GRAY) return true; // cycle found
      if (color.get(nextId) === WHITE && dfs(nextId)) return true;
    }
    color.set(nodeId, BLACK);
    return false;
  }

  for (const stage of stages) {
    if (color.get(stage.id) === WHITE) {
      if (dfs(stage.id)) return false; // has cycle
    }
  }

  return true;
}

/**
 * Create a new workflow with DAG validation.
 * @param {object} db - Database instance
 * @param {object} definition - { name, description, stages }
 * @returns {{ id, status, stages }}
 */
export function createWorkflow(db, definition) {
  ensureWorkflowTables(db);

  const { name, description, stages } = definition;
  if (!name) {
    throw new Error("Workflow name is required");
  }
  if (!stages || !Array.isArray(stages) || stages.length === 0) {
    throw new Error("Workflow must have at least one stage");
  }

  if (!validateDAG(stages)) {
    throw new Error(
      "Invalid DAG: stages contain a cycle or invalid references",
    );
  }

  const id = `wf-${crypto.randomBytes(8).toString("hex")}`;

  db.prepare(
    `INSERT INTO workflows (id, name, description, dag, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, name, description || null, JSON.stringify(stages), "active");

  return { id, status: "active", stages };
}

/**
 * Get a single workflow by ID.
 */
export function getWorkflow(db, workflowId) {
  ensureWorkflowTables(db);
  const row = db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(workflowId);
  if (!row) return null;
  return { ...row, dag: JSON.parse(row.dag) };
}

/**
 * List all workflows with basic info.
 */
export function listWorkflows(db) {
  ensureWorkflowTables(db);
  const rows = db
    .prepare("SELECT * FROM workflows ORDER BY created_at DESC")
    .all();
  return rows.map((row) => ({
    ...row,
    dag: JSON.parse(row.dag),
  }));
}

/**
 * Delete a workflow by ID.
 */
export function deleteWorkflow(db, workflowId) {
  ensureWorkflowTables(db);
  const result = db
    .prepare("DELETE FROM workflows WHERE id = ?")
    .run(workflowId);
  return { deleted: result.changes > 0 };
}

/**
 * Execute a workflow, running through stages in topological order.
 * @returns {{ id, workflowId, status, log }}
 */
export function executeWorkflow(db, workflowId, input = {}) {
  ensureWorkflowTables(db);

  const workflow = getWorkflow(db, workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const execId = `exec-${crypto.randomBytes(8).toString("hex")}`;
  const stages = workflow.dag;
  const log = [];

  // Topological sort for execution order
  const order = topologicalSort(stages);

  // Execute each stage
  for (const stageId of order) {
    const stage = stages.find((s) => s.id === stageId);
    log.push({
      stageId: stage.id,
      stageName: stage.name,
      type: stage.type || "action",
      status: "completed",
      timestamp: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);

  db.prepare(
    `INSERT INTO workflow_executions (id, workflow_id, status, input, log, current_stage, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    execId,
    workflowId,
    "completed",
    JSON.stringify(input),
    JSON.stringify(log),
    order[order.length - 1] || null,
    now,
    now,
  );

  return { id: execId, workflowId, status: "completed", log };
}

/**
 * Topological sort of stages using Kahn's algorithm.
 */
function topologicalSort(stages) {
  const inDegree = new Map();
  const adjacency = new Map();

  for (const stage of stages) {
    inDegree.set(stage.id, 0);
    adjacency.set(stage.id, stage.next || []);
  }

  for (const stage of stages) {
    for (const nextId of stage.next || []) {
      inDegree.set(nextId, (inDegree.get(nextId) || 0) + 1);
    }
  }

  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order = [];
  while (queue.length > 0) {
    const current = queue.shift();
    order.push(current);
    for (const nextId of adjacency.get(current) || []) {
      inDegree.set(nextId, inDegree.get(nextId) - 1);
      if (inDegree.get(nextId) === 0) queue.push(nextId);
    }
  }

  return order;
}

/**
 * Pause a running or pending execution.
 */
export function pauseExecution(db, executionId) {
  ensureWorkflowTables(db);
  const exec = db
    .prepare("SELECT * FROM workflow_executions WHERE id = ?")
    .get(executionId);
  if (!exec) {
    throw new Error(`Execution not found: ${executionId}`);
  }
  if (
    exec.status !== "running" &&
    exec.status !== "pending" &&
    exec.status !== "completed"
  ) {
    throw new Error(`Cannot pause execution in status: ${exec.status}`);
  }

  db.prepare("UPDATE workflow_executions SET status = ? WHERE id = ?").run(
    "paused",
    executionId,
  );

  const log = JSON.parse(exec.log || "[]");
  log.push({
    action: "paused",
    timestamp: new Date().toISOString(),
  });
  db.prepare("UPDATE workflow_executions SET log = ? WHERE id = ?").run(
    JSON.stringify(log),
    executionId,
  );

  return { id: executionId, status: "paused" };
}

/**
 * Resume a paused execution.
 */
export function resumeExecution(db, executionId) {
  ensureWorkflowTables(db);
  const exec = db
    .prepare("SELECT * FROM workflow_executions WHERE id = ?")
    .get(executionId);
  if (!exec) {
    throw new Error(`Execution not found: ${executionId}`);
  }
  if (exec.status !== "paused") {
    throw new Error(`Cannot resume execution in status: ${exec.status}`);
  }

  db.prepare("UPDATE workflow_executions SET status = ? WHERE id = ?").run(
    "running",
    executionId,
  );

  const log = JSON.parse(exec.log || "[]");
  log.push({
    action: "resumed",
    timestamp: new Date().toISOString(),
  });
  db.prepare("UPDATE workflow_executions SET log = ? WHERE id = ?").run(
    JSON.stringify(log),
    executionId,
  );

  return { id: executionId, status: "running" };
}

/**
 * Rollback an execution.
 */
export function rollbackExecution(db, executionId) {
  ensureWorkflowTables(db);
  const exec = db
    .prepare("SELECT * FROM workflow_executions WHERE id = ?")
    .get(executionId);
  if (!exec) {
    throw new Error(`Execution not found: ${executionId}`);
  }
  if (exec.status === "rolled_back") {
    throw new Error("Execution already rolled back");
  }

  db.prepare("UPDATE workflow_executions SET status = ? WHERE id = ?").run(
    "rolled_back",
    executionId,
  );

  const log = JSON.parse(exec.log || "[]");
  log.push({
    action: "rolled_back",
    timestamp: new Date().toISOString(),
  });
  db.prepare("UPDATE workflow_executions SET log = ? WHERE id = ?").run(
    JSON.stringify(log),
    executionId,
  );

  return { id: executionId, status: "rolled_back" };
}

/**
 * Get the execution log for a given execution ID.
 */
export function getExecutionLog(db, executionId) {
  ensureWorkflowTables(db);
  const exec = db
    .prepare("SELECT * FROM workflow_executions WHERE id = ?")
    .get(executionId);
  if (!exec) {
    throw new Error(`Execution not found: ${executionId}`);
  }
  return {
    id: exec.id,
    workflowId: exec.workflow_id,
    status: exec.status,
    log: JSON.parse(exec.log || "[]"),
    startedAt: exec.started_at,
    completedAt: exec.completed_at,
  };
}

/**
 * Return 5 built-in workflow templates.
 */
export function getTemplates() {
  return [
    {
      id: "data-pipeline",
      name: "Data Pipeline",
      description: "Extract, transform, and load data with validation",
      stages: [
        {
          id: "extract",
          type: "action",
          name: "Extract Data",
          next: ["transform"],
        },
        {
          id: "transform",
          type: "action",
          name: "Transform Data",
          next: ["validate"],
        },
        {
          id: "validate",
          type: "action",
          name: "Validate Output",
          next: ["load"],
        },
        { id: "load", type: "action", name: "Load to Target", next: [] },
      ],
    },
    {
      id: "code-review",
      name: "Code Review",
      description: "Automated code review with human approval gate",
      stages: [
        { id: "lint", type: "action", name: "Lint Check", next: ["test"] },
        { id: "test", type: "action", name: "Run Tests", next: ["review"] },
        {
          id: "review",
          type: "approval",
          name: "Human Review",
          next: ["merge"],
        },
        { id: "merge", type: "action", name: "Merge to Main", next: [] },
      ],
    },
    {
      id: "content-generation",
      name: "Content Generation",
      description: "AI-assisted content creation with editorial review",
      stages: [
        { id: "draft", type: "action", name: "Generate Draft", next: ["edit"] },
        {
          id: "edit",
          type: "action",
          name: "AI Edit & Polish",
          next: ["approve"],
        },
        {
          id: "approve",
          type: "approval",
          name: "Editorial Approval",
          next: ["publish"],
        },
        { id: "publish", type: "action", name: "Publish Content", next: [] },
      ],
    },
    {
      id: "employee-onboarding",
      name: "Employee Onboarding",
      description: "New employee onboarding workflow with approvals",
      stages: [
        {
          id: "account",
          type: "action",
          name: "Create Accounts",
          next: ["equipment"],
        },
        {
          id: "equipment",
          type: "action",
          name: "Provision Equipment",
          next: ["training"],
        },
        {
          id: "training",
          type: "action",
          name: "Schedule Training",
          next: ["verify"],
        },
        {
          id: "verify",
          type: "approval",
          name: "Manager Verification",
          next: [],
        },
      ],
    },
    {
      id: "incident-response",
      name: "Incident Response",
      description: "Automated incident detection, triage, and resolution",
      stages: [
        {
          id: "detect",
          type: "action",
          name: "Detect Incident",
          next: ["triage"],
        },
        {
          id: "triage",
          type: "action",
          name: "Triage & Classify",
          next: ["respond"],
        },
        {
          id: "respond",
          type: "action",
          name: "Execute Response",
          next: ["postmortem"],
        },
        {
          id: "postmortem",
          type: "approval",
          name: "Postmortem Review",
          next: [],
        },
      ],
    },
  ];
}

// ─── Canonical Phase 82 templates (keyed by TEMPLATE_TYPE) ────

/**
 * Return the 5 canonical Phase 82 templates keyed by TEMPLATE_TYPE.
 * These are distinct from `getTemplates()` which returns human-friendly slugs.
 */
export function listTemplates() {
  return [
    {
      id: TEMPLATE_TYPE.CI_CD,
      name: "CI/CD Pipeline",
      description: "Lint → test → build → deploy with human gate before deploy",
      stages: [
        { id: "lint", type: "action", name: "Lint", next: ["test"] },
        { id: "test", type: "action", name: "Test", next: ["build"] },
        { id: "build", type: "action", name: "Build", next: ["approve"] },
        {
          id: "approve",
          type: "approval",
          name: "Deploy Approval",
          next: ["deploy"],
        },
        { id: "deploy", type: "action", name: "Deploy", next: [] },
      ],
    },
    {
      id: TEMPLATE_TYPE.DATA_PIPELINE,
      name: "Data Pipeline",
      description: "Extract → transform → validate → load",
      stages: [
        {
          id: "extract",
          type: "action",
          name: "Extract",
          next: ["transform"],
        },
        {
          id: "transform",
          type: "action",
          name: "Transform",
          next: ["validate"],
        },
        { id: "validate", type: "action", name: "Validate", next: ["load"] },
        { id: "load", type: "action", name: "Load", next: [] },
      ],
    },
    {
      id: TEMPLATE_TYPE.CODE_REVIEW,
      name: "Code Review",
      description: "Lint + tests gated by human review before merge",
      stages: [
        { id: "lint", type: "action", name: "Lint Check", next: ["test"] },
        { id: "test", type: "action", name: "Run Tests", next: ["review"] },
        {
          id: "review",
          type: "approval",
          name: "Human Review",
          next: ["merge"],
        },
        { id: "merge", type: "action", name: "Merge to Main", next: [] },
      ],
    },
    {
      id: TEMPLATE_TYPE.DEPLOYMENT,
      name: "Deployment",
      description: "Pre-check → deploy → smoke-test → finalize",
      stages: [
        {
          id: "precheck",
          type: "action",
          name: "Pre-deploy Check",
          next: ["deploy"],
        },
        { id: "deploy", type: "action", name: "Deploy", next: ["smoke"] },
        {
          id: "smoke",
          type: "action",
          name: "Smoke Test",
          next: ["finalize"],
        },
        {
          id: "finalize",
          type: "approval",
          name: "Finalize Release",
          next: [],
        },
      ],
    },
    {
      id: TEMPLATE_TYPE.TEST_SUITE,
      name: "Test Suite",
      description: "Unit → integration → e2e → report",
      stages: [
        {
          id: "unit",
          type: "action",
          name: "Unit Tests",
          next: ["integration"],
        },
        {
          id: "integration",
          type: "action",
          name: "Integration Tests",
          next: ["e2e"],
        },
        { id: "e2e", type: "action", name: "E2E Tests", next: ["report"] },
        { id: "report", type: "action", name: "Generate Report", next: [] },
      ],
    },
  ];
}

// ─── Checkpoints ──────────────────────────────────────────────

/**
 * Create a checkpoint snapshot of an execution's current state.
 */
export function createCheckpoint(db, executionId) {
  ensureWorkflowTables(db);
  const exec = db
    .prepare("SELECT * FROM workflow_executions WHERE id = ?")
    .get(executionId);
  if (!exec) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  const id = `cp-${crypto.randomBytes(8).toString("hex")}`;
  const snapshot = {
    executionId,
    workflowId: exec.workflow_id,
    status: exec.status,
    currentStage: exec.current_stage,
    capturedAt: new Date().toISOString(),
  };
  const nodeStates = JSON.parse(exec.log || "[]");

  db.prepare(
    `INSERT INTO workflow_checkpoints (id, execution_id, workflow_id, state_snapshot, node_states, created_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    id,
    executionId,
    exec.workflow_id,
    JSON.stringify(snapshot),
    JSON.stringify(nodeStates),
  );

  db.prepare(
    "UPDATE workflow_executions SET updated_at = datetime('now') WHERE id = ?",
  ).run(executionId);

  return { id, executionId, workflowId: exec.workflow_id, snapshot };
}

/**
 * List checkpoints for an execution (newest first).
 */
export function listCheckpoints(db, executionId) {
  ensureWorkflowTables(db);
  const rows = db
    .prepare(
      "SELECT * FROM workflow_checkpoints WHERE execution_id = ? ORDER BY created_at DESC",
    )
    .all(executionId);
  return rows.map((row) => ({
    id: row.id,
    executionId: row.execution_id,
    workflowId: row.workflow_id,
    snapshot: JSON.parse(row.state_snapshot || "{}"),
    nodeStates: JSON.parse(row.node_states || "[]"),
    createdAt: row.created_at,
  }));
}

/**
 * Rollback an execution to a specific checkpoint, restoring log & status.
 */
export function rollbackToCheckpoint(db, executionId, checkpointId) {
  ensureWorkflowTables(db);
  const cp = db
    .prepare(
      "SELECT * FROM workflow_checkpoints WHERE id = ? AND execution_id = ?",
    )
    .get(checkpointId, executionId);
  if (!cp) {
    throw new Error(
      `Checkpoint ${checkpointId} not found for execution ${executionId}`,
    );
  }
  const exec = db
    .prepare("SELECT * FROM workflow_executions WHERE id = ?")
    .get(executionId);
  if (!exec) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  const snapshot = JSON.parse(cp.state_snapshot || "{}");
  const nodeStates = JSON.parse(cp.node_states || "[]");

  const restoredLog = [
    ...nodeStates,
    {
      action: "rolled_back_to_checkpoint",
      checkpointId,
      timestamp: new Date().toISOString(),
    },
  ];

  db.prepare(
    "UPDATE workflow_executions SET status = ?, current_stage = ?, log = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(
    WORKFLOW_STATUS.ROLLED_BACK,
    snapshot.currentStage || null,
    JSON.stringify(restoredLog),
    executionId,
  );

  return {
    id: executionId,
    checkpointId,
    status: WORKFLOW_STATUS.ROLLED_BACK,
    restoredStage: snapshot.currentStage || null,
  };
}

// ─── Breakpoints ──────────────────────────────────────────────

/**
 * Set a breakpoint on a workflow node, optionally with a condition.
 * Condition is a simple expression like `input.priority > 5` evaluated
 * against the execution's input object (NO eval — regex-safe parse).
 */
export function setBreakpoint(db, workflowId, nodeId, condition = null) {
  ensureWorkflowTables(db);
  const workflow = getWorkflow(db, workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }
  const nodeExists = workflow.dag.some((s) => s.id === nodeId);
  if (!nodeExists) {
    throw new Error(`Node ${nodeId} not in workflow ${workflowId}`);
  }
  if (condition !== null && condition !== undefined) {
    if (!_isValidCondition(condition)) {
      throw new Error(`Invalid breakpoint condition: ${condition}`);
    }
  }

  const id = `bp-${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(
    `INSERT INTO workflow_breakpoints (id, workflow_id, node_id, condition, enabled, created_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))`,
  ).run(id, workflowId, nodeId, condition || null);

  return { id, workflowId, nodeId, condition: condition || null };
}

/**
 * List breakpoints for a workflow.
 */
export function listBreakpoints(db, workflowId) {
  ensureWorkflowTables(db);
  const rows = db
    .prepare(
      "SELECT * FROM workflow_breakpoints WHERE workflow_id = ? ORDER BY created_at ASC",
    )
    .all(workflowId);
  return rows.map((row) => ({
    id: row.id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    condition: row.condition,
    enabled: row.enabled === 1,
  }));
}

/**
 * Remove a breakpoint.
 */
export function removeBreakpoint(db, breakpointId) {
  ensureWorkflowTables(db);
  const result = db
    .prepare("DELETE FROM workflow_breakpoints WHERE id = ?")
    .run(breakpointId);
  return { removed: result.changes > 0 };
}

/**
 * Determine whether a breakpoint should trigger for a given node and input.
 * Unconditional breakpoints always trigger; conditional ones evaluate safely.
 */
export function shouldBreakpointTrigger(breakpoint, input = {}) {
  if (!breakpoint || breakpoint.enabled === false) return false;
  if (!breakpoint.condition) return true;
  return _evaluateCondition(breakpoint.condition, input);
}

/**
 * Validate a condition string is parseable (no arbitrary eval).
 * Accepts: `input.<path> OP <literal>` where OP ∈ {==, !=, <, <=, >, >=}.
 */
function _isValidCondition(expr) {
  if (typeof expr !== "string") return false;
  const trimmed = expr.trim();
  if (!trimmed) return false;
  return /^input(?:\.[a-zA-Z_][\w]*)+\s*(==|!=|<=|>=|<|>)\s*(.+)$/.test(
    trimmed,
  );
}

function _evaluateCondition(expr, input) {
  const m = expr
    .trim()
    .match(/^input((?:\.[a-zA-Z_][\w]*)+)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (!m) return false;
  const path = m[1].slice(1).split(".");
  const op = m[2];
  let rhs = m[3].trim();

  let lhs = input;
  for (const key of path) {
    if (lhs == null) return false;
    lhs = lhs[key];
  }

  let rhsParsed;
  if (/^-?\d+(\.\d+)?$/.test(rhs)) {
    rhsParsed = Number(rhs);
  } else if (rhs === "true") {
    rhsParsed = true;
  } else if (rhs === "false") {
    rhsParsed = false;
  } else if (rhs === "null") {
    rhsParsed = null;
  } else if (
    (rhs.startsWith('"') && rhs.endsWith('"')) ||
    (rhs.startsWith("'") && rhs.endsWith("'"))
  ) {
    rhsParsed = rhs.slice(1, -1);
  } else {
    rhsParsed = rhs;
  }

  switch (op) {
    case "==":
      return lhs === rhsParsed;
    case "!=":
      return lhs !== rhsParsed;
    case "<":
      return lhs < rhsParsed;
    case "<=":
      return lhs <= rhsParsed;
    case ">":
      return lhs > rhsParsed;
    case ">=":
      return lhs >= rhsParsed;
    default:
      return false;
  }
}

// ─── Import / Export ──────────────────────────────────────────

/**
 * Export a workflow as a portable JSON definition.
 */
export function exportWorkflow(db, workflowId) {
  const workflow = getWorkflow(db, workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }
  return {
    name: workflow.name,
    description: workflow.description || "",
    stages: workflow.dag,
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

/**
 * Import a workflow from an exported JSON definition.
 * Creates a new workflow row with fresh ID.
 */
export function importWorkflow(db, definition) {
  if (!definition || typeof definition !== "object") {
    throw new Error("Definition must be an object");
  }
  if (!definition.name) {
    throw new Error("Definition missing name");
  }
  if (!Array.isArray(definition.stages) || definition.stages.length === 0) {
    throw new Error("Definition must include non-empty stages array");
  }
  return createWorkflow(db, {
    name: definition.name,
    description: definition.description || "",
    stages: definition.stages,
  });
}

// ===== V2 Surface (cli 0.130.0) — in-memory governance =====
export const WORKFLOW_MATURITY_V2 = Object.freeze({
  DRAFT: "draft",
  ACTIVE: "active",
  PAUSED: "paused",
  RETIRED: "retired",
});
export const RUN_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

const _WM_V2 = WORKFLOW_MATURITY_V2;
const _RL_V2 = RUN_LIFECYCLE_V2;
const _WM_TRANS_V2 = new Map([
  [_WM_V2.DRAFT, new Set([_WM_V2.ACTIVE, _WM_V2.RETIRED])],
  [_WM_V2.ACTIVE, new Set([_WM_V2.PAUSED, _WM_V2.RETIRED])],
  [_WM_V2.PAUSED, new Set([_WM_V2.ACTIVE, _WM_V2.RETIRED])],
  [_WM_V2.RETIRED, new Set()],
]);
const _RL_TRANS_V2 = new Map([
  [_RL_V2.QUEUED, new Set([_RL_V2.RUNNING, _RL_V2.CANCELLED])],
  [
    _RL_V2.RUNNING,
    new Set([_RL_V2.COMPLETED, _RL_V2.FAILED, _RL_V2.CANCELLED]),
  ],
  [_RL_V2.COMPLETED, new Set()],
  [_RL_V2.FAILED, new Set()],
  [_RL_V2.CANCELLED, new Set()],
]);
const _RL_TERM_V2 = new Set([
  _RL_V2.COMPLETED,
  _RL_V2.FAILED,
  _RL_V2.CANCELLED,
]);

const WF_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_OWNER = 12;
const WF_DEFAULT_MAX_PENDING_RUNS_PER_WORKFLOW = 8;
const WF_DEFAULT_WORKFLOW_IDLE_MS = 60 * 24 * 60 * 60 * 1000;
const WF_DEFAULT_RUN_STUCK_MS = 10 * 60 * 1000;

const _wfWorkflowsV2 = new Map();
const _wfRunsV2 = new Map();
let _wfConfigV2 = {
  maxActiveWorkflowsPerOwner: WF_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_OWNER,
  maxPendingRunsPerWorkflow: WF_DEFAULT_MAX_PENDING_RUNS_PER_WORKFLOW,
  workflowIdleMs: WF_DEFAULT_WORKFLOW_IDLE_MS,
  runStuckMs: WF_DEFAULT_RUN_STUCK_MS,
};

function _wfPosIntV2(n, label) {
  if (typeof n !== "number" || !isFinite(n) || isNaN(n))
    throw new Error(`${label} must be positive integer`);
  const v = Math.floor(n);
  if (v <= 0) throw new Error(`${label} must be positive integer`);
  return v;
}

export function _resetStateWorkflowEngineV2() {
  _wfWorkflowsV2.clear();
  _wfRunsV2.clear();
  _wfConfigV2 = {
    maxActiveWorkflowsPerOwner: WF_DEFAULT_MAX_ACTIVE_WORKFLOWS_PER_OWNER,
    maxPendingRunsPerWorkflow: WF_DEFAULT_MAX_PENDING_RUNS_PER_WORKFLOW,
    workflowIdleMs: WF_DEFAULT_WORKFLOW_IDLE_MS,
    runStuckMs: WF_DEFAULT_RUN_STUCK_MS,
  };
}

export function setMaxActiveWorkflowsPerOwnerV2(n) {
  _wfConfigV2.maxActiveWorkflowsPerOwner = _wfPosIntV2(
    n,
    "maxActiveWorkflowsPerOwner",
  );
}
export function setMaxPendingRunsPerWorkflowV2(n) {
  _wfConfigV2.maxPendingRunsPerWorkflow = _wfPosIntV2(
    n,
    "maxPendingRunsPerWorkflow",
  );
}
export function setWorkflowIdleMsV2(n) {
  _wfConfigV2.workflowIdleMs = _wfPosIntV2(n, "workflowIdleMs");
}
export function setRunStuckMsV2(n) {
  _wfConfigV2.runStuckMs = _wfPosIntV2(n, "runStuckMs");
}
export function getMaxActiveWorkflowsPerOwnerV2() {
  return _wfConfigV2.maxActiveWorkflowsPerOwner;
}
export function getMaxPendingRunsPerWorkflowV2() {
  return _wfConfigV2.maxPendingRunsPerWorkflow;
}
export function getWorkflowIdleMsV2() {
  return _wfConfigV2.workflowIdleMs;
}
export function getRunStuckMsV2() {
  return _wfConfigV2.runStuckMs;
}

function _copyWorkflowV2(w) {
  return { ...w, metadata: { ...(w.metadata || {}) } };
}
function _copyRunV2(r) {
  return { ...r, metadata: { ...(r.metadata || {}) } };
}

export function registerWorkflowV2({ id, owner, name, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!owner || typeof owner !== "string") throw new Error("owner required");
  if (_wfWorkflowsV2.has(id))
    throw new Error(`workflow ${id} already registered`);
  const now = Date.now();
  const w = {
    id,
    owner,
    name: name || id,
    status: _WM_V2.DRAFT,
    activatedAt: null,
    retiredAt: null,
    lastSeenAt: now,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _wfWorkflowsV2.set(id, w);
  return _copyWorkflowV2(w);
}

function _activeWorkflowCountForOwnerV2(owner) {
  let c = 0;
  for (const w of _wfWorkflowsV2.values())
    if (w.owner === owner && w.status === _WM_V2.ACTIVE) c++;
  return c;
}

function _transitionWorkflowV2(id, next) {
  const w = _wfWorkflowsV2.get(id);
  if (!w) throw new Error(`workflow ${id} not found`);
  const allowed = _WM_TRANS_V2.get(w.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${w.status} -> ${next}`);
  if (next === _WM_V2.ACTIVE && w.status === _WM_V2.DRAFT) {
    if (
      _activeWorkflowCountForOwnerV2(w.owner) >=
      _wfConfigV2.maxActiveWorkflowsPerOwner
    ) {
      throw new Error(
        `owner ${w.owner} active-workflow cap reached (${_wfConfigV2.maxActiveWorkflowsPerOwner})`,
      );
    }
  }
  const now = Date.now();
  w.status = next;
  if (next === _WM_V2.ACTIVE && !w.activatedAt) w.activatedAt = now;
  if (next === _WM_V2.RETIRED && !w.retiredAt) w.retiredAt = now;
  w.lastSeenAt = now;
  return _copyWorkflowV2(w);
}

export function activateWorkflowV2(id) {
  return _transitionWorkflowV2(id, _WM_V2.ACTIVE);
}
export function pauseWorkflowV2(id) {
  return _transitionWorkflowV2(id, _WM_V2.PAUSED);
}
export function retireWorkflowV2(id) {
  return _transitionWorkflowV2(id, _WM_V2.RETIRED);
}
export function touchWorkflowV2(id) {
  const w = _wfWorkflowsV2.get(id);
  if (!w) throw new Error(`workflow ${id} not found`);
  w.lastSeenAt = Date.now();
  return _copyWorkflowV2(w);
}
export function getWorkflowV2(id) {
  const w = _wfWorkflowsV2.get(id);
  return w ? _copyWorkflowV2(w) : null;
}
export function listWorkflowsV2({ owner, status } = {}) {
  const out = [];
  for (const w of _wfWorkflowsV2.values()) {
    if (owner && w.owner !== owner) continue;
    if (status && w.status !== status) continue;
    out.push(_copyWorkflowV2(w));
  }
  return out;
}

function _pendingRunCountForWorkflowV2(workflowId) {
  let c = 0;
  for (const r of _wfRunsV2.values()) {
    if (r.workflowId !== workflowId) continue;
    if (r.status === _RL_V2.QUEUED || r.status === _RL_V2.RUNNING) c++;
  }
  return c;
}

export function createRunV2({ id, workflowId, trigger, metadata } = {}) {
  if (!id || typeof id !== "string") throw new Error("id required");
  if (!workflowId || typeof workflowId !== "string")
    throw new Error("workflowId required");
  if (_wfRunsV2.has(id)) throw new Error(`run ${id} already exists`);
  const wf = _wfWorkflowsV2.get(workflowId);
  if (!wf) throw new Error(`workflow ${workflowId} not found`);
  if (wf.status === _WM_V2.RETIRED)
    throw new Error(`workflow ${workflowId} retired`);
  if (
    _pendingRunCountForWorkflowV2(workflowId) >=
    _wfConfigV2.maxPendingRunsPerWorkflow
  ) {
    throw new Error(
      `workflow ${workflowId} pending-run cap reached (${_wfConfigV2.maxPendingRunsPerWorkflow})`,
    );
  }
  const now = Date.now();
  const r = {
    id,
    workflowId,
    trigger: trigger || "manual",
    status: _RL_V2.QUEUED,
    startedAt: null,
    settledAt: null,
    createdAt: now,
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
  _wfRunsV2.set(id, r);
  return _copyRunV2(r);
}

function _transitionRunV2(id, next, extra = {}) {
  const r = _wfRunsV2.get(id);
  if (!r) throw new Error(`run ${id} not found`);
  const allowed = _RL_TRANS_V2.get(r.status);
  if (!allowed || !allowed.has(next))
    throw new Error(`invalid transition ${r.status} -> ${next}`);
  const now = Date.now();
  r.status = next;
  if (next === _RL_V2.RUNNING && !r.startedAt) r.startedAt = now;
  if (_RL_TERM_V2.has(next) && !r.settledAt) r.settledAt = now;
  if (extra.error) r.metadata.error = extra.error;
  return _copyRunV2(r);
}

export function startRunV2(id) {
  return _transitionRunV2(id, _RL_V2.RUNNING);
}
export function completeRunV2(id) {
  return _transitionRunV2(id, _RL_V2.COMPLETED);
}
export function failRunV2(id, error) {
  return _transitionRunV2(id, _RL_V2.FAILED, { error });
}
export function cancelRunV2(id) {
  return _transitionRunV2(id, _RL_V2.CANCELLED);
}

export function getRunV2(id) {
  const r = _wfRunsV2.get(id);
  return r ? _copyRunV2(r) : null;
}
export function listRunsV2({ workflowId, status, trigger } = {}) {
  const out = [];
  for (const r of _wfRunsV2.values()) {
    if (workflowId && r.workflowId !== workflowId) continue;
    if (status && r.status !== status) continue;
    if (trigger && r.trigger !== trigger) continue;
    out.push(_copyRunV2(r));
  }
  return out;
}

export function autoPauseIdleWorkflowsV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const w of _wfWorkflowsV2.values()) {
    if (w.status !== _WM_V2.ACTIVE) continue;
    if (t - w.lastSeenAt > _wfConfigV2.workflowIdleMs) {
      w.status = _WM_V2.PAUSED;
      w.lastSeenAt = t;
      flipped.push(_copyWorkflowV2(w));
    }
  }
  return flipped;
}

export function autoFailStuckRunsV2({ now } = {}) {
  const t = typeof now === "number" ? now : Date.now();
  const flipped = [];
  for (const r of _wfRunsV2.values()) {
    if (r.status !== _RL_V2.RUNNING) continue;
    if (r.startedAt && t - r.startedAt > _wfConfigV2.runStuckMs) {
      r.status = _RL_V2.FAILED;
      r.settledAt = t;
      r.metadata.error = "stuck-timeout";
      flipped.push(_copyRunV2(r));
    }
  }
  return flipped;
}

export function getWorkflowEngineStatsV2() {
  const workflowsByStatus = {};
  for (const s of Object.values(_WM_V2)) workflowsByStatus[s] = 0;
  for (const w of _wfWorkflowsV2.values()) workflowsByStatus[w.status]++;
  const runsByStatus = {};
  for (const s of Object.values(_RL_V2)) runsByStatus[s] = 0;
  for (const r of _wfRunsV2.values()) runsByStatus[r.status]++;
  return {
    totalWorkflowsV2: _wfWorkflowsV2.size,
    totalRunsV2: _wfRunsV2.size,
    maxActiveWorkflowsPerOwner: _wfConfigV2.maxActiveWorkflowsPerOwner,
    maxPendingRunsPerWorkflow: _wfConfigV2.maxPendingRunsPerWorkflow,
    workflowIdleMs: _wfConfigV2.workflowIdleMs,
    runStuckMs: _wfConfigV2.runStuckMs,
    workflowsByStatus,
    runsByStatus,
  };
}

// =====================================================================
// workflow-engine V2 governance overlay (iter21)
// =====================================================================
export const WFGOV_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  PAUSED: "paused",
  ARCHIVED: "archived",
});
export const WFGOV_STEP_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued",
  EXECUTING: "executing",
  EXECUTED: "executed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});
const _wfgovPTrans = new Map([
  [
    WFGOV_PROFILE_MATURITY_V2.PENDING,
    new Set([
      WFGOV_PROFILE_MATURITY_V2.ACTIVE,
      WFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WFGOV_PROFILE_MATURITY_V2.ACTIVE,
    new Set([
      WFGOV_PROFILE_MATURITY_V2.PAUSED,
      WFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [
    WFGOV_PROFILE_MATURITY_V2.PAUSED,
    new Set([
      WFGOV_PROFILE_MATURITY_V2.ACTIVE,
      WFGOV_PROFILE_MATURITY_V2.ARCHIVED,
    ]),
  ],
  [WFGOV_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _wfgovPTerminal = new Set([WFGOV_PROFILE_MATURITY_V2.ARCHIVED]);
const _wfgovJTrans = new Map([
  [
    WFGOV_STEP_LIFECYCLE_V2.QUEUED,
    new Set([
      WFGOV_STEP_LIFECYCLE_V2.EXECUTING,
      WFGOV_STEP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [
    WFGOV_STEP_LIFECYCLE_V2.EXECUTING,
    new Set([
      WFGOV_STEP_LIFECYCLE_V2.EXECUTED,
      WFGOV_STEP_LIFECYCLE_V2.FAILED,
      WFGOV_STEP_LIFECYCLE_V2.CANCELLED,
    ]),
  ],
  [WFGOV_STEP_LIFECYCLE_V2.EXECUTED, new Set()],
  [WFGOV_STEP_LIFECYCLE_V2.FAILED, new Set()],
  [WFGOV_STEP_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _wfgovPsV2 = new Map();
const _wfgovJsV2 = new Map();
let _wfgovMaxActive = 8,
  _wfgovMaxPending = 20,
  _wfgovIdleMs = 30 * 24 * 60 * 60 * 1000,
  _wfgovStuckMs = 60 * 1000;
function _wfgovPos(n, label) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0)
    throw new Error(`${label} must be positive integer`);
  return v;
}
function _wfgovCheckP(from, to) {
  const a = _wfgovPTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wfgov profile transition ${from} → ${to}`);
}
function _wfgovCheckJ(from, to) {
  const a = _wfgovJTrans.get(from);
  if (!a || !a.has(to))
    throw new Error(`invalid wfgov step transition ${from} → ${to}`);
}
function _wfgovCountActive(owner) {
  let c = 0;
  for (const p of _wfgovPsV2.values())
    if (p.owner === owner && p.status === WFGOV_PROFILE_MATURITY_V2.ACTIVE) c++;
  return c;
}
function _wfgovCountPending(profileId) {
  let c = 0;
  for (const j of _wfgovJsV2.values())
    if (
      j.profileId === profileId &&
      (j.status === WFGOV_STEP_LIFECYCLE_V2.QUEUED ||
        j.status === WFGOV_STEP_LIFECYCLE_V2.EXECUTING)
    )
      c++;
  return c;
}
export function setMaxActiveWfgovProfilesPerOwnerV2(n) {
  _wfgovMaxActive = _wfgovPos(n, "maxActiveWfgovProfilesPerOwner");
}
export function getMaxActiveWfgovProfilesPerOwnerV2() {
  return _wfgovMaxActive;
}
export function setMaxPendingWfgovStepsPerProfileV2(n) {
  _wfgovMaxPending = _wfgovPos(n, "maxPendingWfgovStepsPerProfile");
}
export function getMaxPendingWfgovStepsPerProfileV2() {
  return _wfgovMaxPending;
}
export function setWfgovProfileIdleMsV2(n) {
  _wfgovIdleMs = _wfgovPos(n, "wfgovProfileIdleMs");
}
export function getWfgovProfileIdleMsV2() {
  return _wfgovIdleMs;
}
export function setWfgovStepStuckMsV2(n) {
  _wfgovStuckMs = _wfgovPos(n, "wfgovStepStuckMs");
}
export function getWfgovStepStuckMsV2() {
  return _wfgovStuckMs;
}
export function _resetStateWorkflowEngineGovV2() {
  _wfgovPsV2.clear();
  _wfgovJsV2.clear();
  _wfgovMaxActive = 8;
  _wfgovMaxPending = 20;
  _wfgovIdleMs = 30 * 24 * 60 * 60 * 1000;
  _wfgovStuckMs = 60 * 1000;
}
export function registerWfgovProfileV2({ id, owner, kind, metadata } = {}) {
  if (!id || !owner) throw new Error("id and owner required");
  if (_wfgovPsV2.has(id)) throw new Error(`wfgov profile ${id} already exists`);
  const now = Date.now();
  const p = {
    id,
    owner,
    kind: kind || "sequential",
    status: WFGOV_PROFILE_MATURITY_V2.PENDING,
    createdAt: now,
    updatedAt: now,
    lastTouchedAt: now,
    activatedAt: null,
    archivedAt: null,
    metadata: { ...(metadata || {}) },
  };
  _wfgovPsV2.set(id, p);
  return { ...p, metadata: { ...p.metadata } };
}
export function activateWfgovProfileV2(id) {
  const p = _wfgovPsV2.get(id);
  if (!p) throw new Error(`wfgov profile ${id} not found`);
  const isInitial = p.status === WFGOV_PROFILE_MATURITY_V2.PENDING;
  _wfgovCheckP(p.status, WFGOV_PROFILE_MATURITY_V2.ACTIVE);
  if (isInitial && _wfgovCountActive(p.owner) >= _wfgovMaxActive)
    throw new Error(`max active wfgov profiles for owner ${p.owner} reached`);
  const now = Date.now();
  p.status = WFGOV_PROFILE_MATURITY_V2.ACTIVE;
  p.updatedAt = now;
  p.lastTouchedAt = now;
  if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function pauseWfgovProfileV2(id) {
  const p = _wfgovPsV2.get(id);
  if (!p) throw new Error(`wfgov profile ${id} not found`);
  _wfgovCheckP(p.status, WFGOV_PROFILE_MATURITY_V2.PAUSED);
  p.status = WFGOV_PROFILE_MATURITY_V2.PAUSED;
  p.updatedAt = Date.now();
  return { ...p, metadata: { ...p.metadata } };
}
export function archiveWfgovProfileV2(id) {
  const p = _wfgovPsV2.get(id);
  if (!p) throw new Error(`wfgov profile ${id} not found`);
  _wfgovCheckP(p.status, WFGOV_PROFILE_MATURITY_V2.ARCHIVED);
  const now = Date.now();
  p.status = WFGOV_PROFILE_MATURITY_V2.ARCHIVED;
  p.updatedAt = now;
  if (!p.archivedAt) p.archivedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function touchWfgovProfileV2(id) {
  const p = _wfgovPsV2.get(id);
  if (!p) throw new Error(`wfgov profile ${id} not found`);
  if (_wfgovPTerminal.has(p.status))
    throw new Error(`cannot touch terminal wfgov profile ${id}`);
  const now = Date.now();
  p.lastTouchedAt = now;
  p.updatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function getWfgovProfileV2(id) {
  const p = _wfgovPsV2.get(id);
  if (!p) return null;
  return { ...p, metadata: { ...p.metadata } };
}
export function listWfgovProfilesV2() {
  return [..._wfgovPsV2.values()].map((p) => ({
    ...p,
    metadata: { ...p.metadata },
  }));
}
export function createWfgovStepV2({ id, profileId, stepName, metadata } = {}) {
  if (!id || !profileId) throw new Error("id and profileId required");
  if (_wfgovJsV2.has(id)) throw new Error(`wfgov step ${id} already exists`);
  if (!_wfgovPsV2.has(profileId))
    throw new Error(`wfgov profile ${profileId} not found`);
  if (_wfgovCountPending(profileId) >= _wfgovMaxPending)
    throw new Error(`max pending wfgov steps for profile ${profileId} reached`);
  const now = Date.now();
  const j = {
    id,
    profileId,
    stepName: stepName || "",
    status: WFGOV_STEP_LIFECYCLE_V2.QUEUED,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    settledAt: null,
    metadata: { ...(metadata || {}) },
  };
  _wfgovJsV2.set(id, j);
  return { ...j, metadata: { ...j.metadata } };
}
export function executingWfgovStepV2(id) {
  const j = _wfgovJsV2.get(id);
  if (!j) throw new Error(`wfgov step ${id} not found`);
  _wfgovCheckJ(j.status, WFGOV_STEP_LIFECYCLE_V2.EXECUTING);
  const now = Date.now();
  j.status = WFGOV_STEP_LIFECYCLE_V2.EXECUTING;
  j.updatedAt = now;
  if (!j.startedAt) j.startedAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function completeStepWfgovV2(id) {
  const j = _wfgovJsV2.get(id);
  if (!j) throw new Error(`wfgov step ${id} not found`);
  _wfgovCheckJ(j.status, WFGOV_STEP_LIFECYCLE_V2.EXECUTED);
  const now = Date.now();
  j.status = WFGOV_STEP_LIFECYCLE_V2.EXECUTED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  return { ...j, metadata: { ...j.metadata } };
}
export function failWfgovStepV2(id, reason) {
  const j = _wfgovJsV2.get(id);
  if (!j) throw new Error(`wfgov step ${id} not found`);
  _wfgovCheckJ(j.status, WFGOV_STEP_LIFECYCLE_V2.FAILED);
  const now = Date.now();
  j.status = WFGOV_STEP_LIFECYCLE_V2.FAILED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.failReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function cancelWfgovStepV2(id, reason) {
  const j = _wfgovJsV2.get(id);
  if (!j) throw new Error(`wfgov step ${id} not found`);
  _wfgovCheckJ(j.status, WFGOV_STEP_LIFECYCLE_V2.CANCELLED);
  const now = Date.now();
  j.status = WFGOV_STEP_LIFECYCLE_V2.CANCELLED;
  j.updatedAt = now;
  if (!j.settledAt) j.settledAt = now;
  if (reason) j.metadata.cancelReason = String(reason);
  return { ...j, metadata: { ...j.metadata } };
}
export function getWfgovStepV2(id) {
  const j = _wfgovJsV2.get(id);
  if (!j) return null;
  return { ...j, metadata: { ...j.metadata } };
}
export function listWfgovStepsV2() {
  return [..._wfgovJsV2.values()].map((j) => ({
    ...j,
    metadata: { ...j.metadata },
  }));
}
export function autoPauseIdleWfgovProfilesV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const p of _wfgovPsV2.values())
    if (
      p.status === WFGOV_PROFILE_MATURITY_V2.ACTIVE &&
      t - p.lastTouchedAt >= _wfgovIdleMs
    ) {
      p.status = WFGOV_PROFILE_MATURITY_V2.PAUSED;
      p.updatedAt = t;
      flipped.push(p.id);
    }
  return { flipped, count: flipped.length };
}
export function autoFailStuckWfgovStepsV2({ now } = {}) {
  const t = now ?? Date.now();
  const flipped = [];
  for (const j of _wfgovJsV2.values())
    if (
      j.status === WFGOV_STEP_LIFECYCLE_V2.EXECUTING &&
      j.startedAt != null &&
      t - j.startedAt >= _wfgovStuckMs
    ) {
      j.status = WFGOV_STEP_LIFECYCLE_V2.FAILED;
      j.updatedAt = t;
      if (!j.settledAt) j.settledAt = t;
      j.metadata.failReason = "auto-fail-stuck";
      flipped.push(j.id);
    }
  return { flipped, count: flipped.length };
}
export function getWorkflowEngineGovStatsV2() {
  const profilesByStatus = {};
  for (const v of Object.values(WFGOV_PROFILE_MATURITY_V2))
    profilesByStatus[v] = 0;
  for (const p of _wfgovPsV2.values()) profilesByStatus[p.status]++;
  const stepsByStatus = {};
  for (const v of Object.values(WFGOV_STEP_LIFECYCLE_V2)) stepsByStatus[v] = 0;
  for (const j of _wfgovJsV2.values()) stepsByStatus[j.status]++;
  return {
    totalWfgovProfilesV2: _wfgovPsV2.size,
    totalWfgovStepsV2: _wfgovJsV2.size,
    maxActiveWfgovProfilesPerOwner: _wfgovMaxActive,
    maxPendingWfgovStepsPerProfile: _wfgovMaxPending,
    wfgovProfileIdleMs: _wfgovIdleMs,
    wfgovStepStuckMs: _wfgovStuckMs,
    profilesByStatus,
    stepsByStatus,
  };
}
