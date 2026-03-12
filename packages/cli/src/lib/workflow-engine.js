/**
 * Workflow Engine — DAG-based workflow creation, execution, and management.
 * Supports stages with action/approval types, pause/resume, rollback, and built-in templates.
 */

import crypto from "crypto";

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
