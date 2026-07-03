/**
 * @module ai-engine/workflow/workflow-engine
 * Phase 82: Agentic Workflow Engine with DAG execution
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

// Cap on retained in-memory executions. Each executeWorkflow() adds one entry
// that is persisted to the DB but never removed, so without a bound the
// _executions map grows forever. Only *terminal* executions are evicted (active
// ones must stay readable for pause/resume/rollback).
const MAX_EXECUTIONS = 500;
const TERMINAL_EXEC_STATES = new Set(["completed", "failed", "rolled_back"]);

/** Tolerant JSON column parse — a corrupt row must not abort the workflow load. */
function safeParse(raw, fallback) {
  if (raw == null || raw === "") {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`[WorkflowEngine] Bad JSON column, fallback: ${err.message}`);
    return fallback;
  }
}

class WorkflowEngine extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._workflows = new Map();
    this._executions = new Map();
    this.maxExecutions = MAX_EXECUTIONS;
    this._templates = new Map();
    this._breakpoints = new Set();
    this._config = {
      maxConcurrentWorkflows: 10,
      defaultTimeout: 600000,
      maxRetries: 3,
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._ensureTables();
    await this._loadWorkflows();
    this._loadDefaultTemplates();
    this.initialized = true;
    logger.info(
      `[WorkflowEngine] Initialized with ${this._workflows.size} workflows, ${this._templates.size} templates`,
    );
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          dag TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          status TEXT DEFAULT 'draft',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS workflow_executions (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          current_stage TEXT,
          input TEXT,
          output TEXT,
          log TEXT,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
      `);
    } catch (error) {
      logger.warn("[WorkflowEngine] Table creation warning:", error.message);
    }
  }

  async _loadWorkflows() {
    try {
      const rows = this.db.prepare("SELECT * FROM workflows").all();
      for (const row of rows) {
        this._workflows.set(row.id, {
          ...row,
          dag: safeParse(row.dag, {}),
        });
      }
    } catch (error) {
      logger.warn("[WorkflowEngine] Failed to load workflows:", error.message);
    }
  }

  _loadDefaultTemplates() {
    const templates = [
      {
        id: "tmpl-data-pipeline",
        name: "Data Pipeline",
        description: "ETL data processing workflow",
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
            next: ["load"],
          },
          { id: "load", type: "action", name: "Load Data", next: [] },
        ],
      },
      {
        id: "tmpl-code-review",
        name: "Code Review",
        description: "Automated code review workflow",
        stages: [
          { id: "lint", type: "action", name: "Lint Code", next: ["test"] },
          {
            id: "test",
            type: "action",
            name: "Run Tests",
            next: ["review"],
          },
          {
            id: "review",
            type: "action",
            name: "AI Review",
            next: ["approve"],
          },
          {
            id: "approve",
            type: "approval",
            name: "Human Approval",
            next: [],
          },
        ],
      },
      {
        id: "tmpl-content-gen",
        name: "Content Generation",
        description: "AI content generation pipeline",
        stages: [
          {
            id: "research",
            type: "action",
            name: "Research Topic",
            next: ["draft"],
          },
          {
            id: "draft",
            type: "action",
            name: "Generate Draft",
            next: ["review"],
          },
          {
            id: "review",
            type: "approval",
            name: "Review Draft",
            next: ["publish"],
          },
          { id: "publish", type: "action", name: "Publish", next: [] },
        ],
      },
      {
        id: "tmpl-onboarding",
        name: "Employee Onboarding",
        description: "New hire onboarding workflow",
        stages: [
          {
            id: "accounts",
            type: "action",
            name: "Create Accounts",
            next: ["welcome"],
          },
          {
            id: "welcome",
            type: "action",
            name: "Send Welcome Email",
            next: ["training"],
          },
          {
            id: "training",
            type: "action",
            name: "Schedule Training",
            next: [],
          },
        ],
      },
      {
        id: "tmpl-incident",
        name: "Incident Response",
        description: "IT incident response workflow",
        stages: [
          {
            id: "detect",
            type: "action",
            name: "Detect Incident",
            next: ["classify"],
          },
          {
            id: "classify",
            type: "action",
            name: "Classify Severity",
            next: ["respond", "notify"],
          },
          {
            id: "respond",
            type: "action",
            name: "Execute Response",
            next: ["postmortem"],
          },
          {
            id: "notify",
            type: "action",
            name: "Notify Stakeholders",
            next: ["postmortem"],
          },
          {
            id: "postmortem",
            type: "action",
            name: "Generate Postmortem",
            next: [],
          },
        ],
      },
    ];

    for (const tmpl of templates) {
      this._templates.set(tmpl.id, tmpl);
    }
  }

  // Workflow CRUD
  createWorkflow(definition) {
    const id =
      definition.id ||
      `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const workflow = {
      id,
      name: definition.name || "Untitled Workflow",
      description: definition.description || "",
      dag: {
        stages: definition.stages || [],
        edges: definition.edges || [],
        metadata: definition.metadata || {},
      },
      version: 1,
      status: "draft",
    };

    // Validate DAG (check for cycles)
    if (!this._validateDAG(workflow.dag)) {
      throw new Error("Invalid DAG: cycle detected");
    }

    this._workflows.set(id, workflow);
    this._persistWorkflow(workflow);
    this.emit("workflow:created", { id, name: workflow.name });
    return { id, status: workflow.status, stages: workflow.dag.stages };
  }

  _validateDAG(dag) {
    const stages = dag.stages || [];
    const visited = new Set();
    const inStack = new Set();

    const hasCycle = (stageId) => {
      visited.add(stageId);
      inStack.add(stageId);
      const stage = stages.find((s) => s.id === stageId);
      if (stage && stage.next) {
        for (const next of stage.next) {
          if (!visited.has(next)) {
            if (hasCycle(next)) {
              return true;
            }
          } else if (inStack.has(next)) {
            return true;
          }
        }
      }
      inStack.delete(stageId);
      return false;
    };

    for (const stage of stages) {
      if (!visited.has(stage.id)) {
        if (hasCycle(stage.id)) {
          return false;
        }
      }
    }
    return true;
  }

  _persistWorkflow(workflow) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO workflows (id, name, description, dag, version, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `,
        )
        .run(
          workflow.id,
          workflow.name,
          workflow.description,
          JSON.stringify(workflow.dag),
          workflow.version,
          workflow.status,
        );
    } catch (error) {
      logger.error(
        "[WorkflowEngine] Failed to persist workflow:",
        error.message,
      );
    }
  }

  // Execution
  async executeWorkflow(workflowId, input = {}) {
    const workflow = this._workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow '${workflowId}' not found`);
    }

    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const execution = {
      id: execId,
      workflowId,
      status: "running",
      currentStage: null,
      input,
      output: null,
      log: [],
      startedAt: Date.now(),
    };

    this._executions.set(execId, execution);
    this._evictOldExecutions();
    this.emit("workflow:started", { executionId: execId, workflowId });

    // Execute stages in topological order
    try {
      // Guard the execution boundary against a cyclic DAG. createWorkflow()
      // validates, but _loadWorkflows() rehydrates straight from the DB without
      // validation (older/looser builds or direct DB writes can persist a cycle).
      // Without this, _executeStages' recursion follows `next` forever →
      // RangeError: Maximum call stack size exceeded. Fail gracefully instead.
      if (!this._validateDAG(workflow.dag)) {
        throw new Error(
          `Workflow '${workflowId}' has a cyclic DAG; refusing to execute`,
        );
      }

      const stages = workflow.dag.stages || [];
      const entryStages = stages.filter((s) => {
        return !stages.some((other) => other.next && other.next.includes(s.id));
      });

      await this._executeStages(execution, entryStages, workflow.dag.stages);

      // _executeStages returns early on a breakpoint ("paused") or approval
      // gate ("waiting") — those runs are NOT complete. Only a run that made
      // it through the whole DAG (status still "running") may be finalized;
      // paused/waiting executions finish later via resumeExecution().
      if (execution.status === "running") {
        execution.status = "completed";
        execution.output = { stages: execution.log };
        this.emit("workflow:completed", { executionId: execId });
      }
    } catch (error) {
      execution.status = "failed";
      execution.output = { error: error.message };
      this.emit("workflow:failed", {
        executionId: execId,
        error: error.message,
      });
    }

    this._persistExecution(execution);
    return execution;
  }

  async _executeStages(execution, entryStages, allStages, opts = {}) {
    // In-degree (Kahn's) topological execution: each stage runs exactly ONCE,
    // only after ALL of its parents have completed. The previous recursive DFS
    // followed every `next` edge independently, so a convergence ("diamond")
    // node ran once per incoming edge — A→[B,C], B→D, C→D ran D twice; N
    // chained diamonds ran the join node 2^N times, double-firing side effects
    // and logs. A node only becomes "ready" when its in-degree reaches 0.
    //
    // opts.resume: rebuild the frontier from execution.log — stages already
    // completed in the prior run are replayed into the in-degree state (never
    // re-executed), so execution picks up exactly where the pause left off.
    // opts.skipBreakpointFor: stage id whose breakpoint is stepped over ONCE
    // (resuming from a breakpoint would otherwise immediately re-pause on it).
    const stagesById = new Map((allStages || []).map((s) => [s.id, s]));
    const inDegree = new Map();
    for (const s of allStages || []) {
      inDegree.set(s.id, 0);
    }
    for (const s of allStages || []) {
      for (const childId of s.next || []) {
        if (inDegree.has(childId)) {
          inDegree.set(childId, inDegree.get(childId) + 1);
        }
      }
    }

    const done = new Set();
    if (opts.resume) {
      for (const entry of execution.log) {
        if (entry.status === "completed" && stagesById.has(entry.stageId)) {
          done.add(entry.stageId);
        }
      }
      for (const id of done) {
        for (const childId of stagesById.get(id).next || []) {
          if (inDegree.has(childId)) {
            inDegree.set(childId, inDegree.get(childId) - 1);
          }
        }
      }
    }

    const ready = [];
    const enqueued = new Set(done);
    // A fresh run seeds from the DAG's entry stages; a resume must consider
    // EVERY not-yet-done stage whose parents have all completed (the paused
    // stage and any siblings that were ready but unexecuted at pause time).
    const seeds = opts.resume ? allStages : entryStages;
    for (const s of seeds || []) {
      if ((inDegree.get(s.id) || 0) === 0 && !enqueued.has(s.id)) {
        ready.push(s);
        enqueued.add(s.id);
      }
    }

    let skipBreakpointOnce = opts.skipBreakpointFor || null;
    while (ready.length > 0) {
      const stage = ready.shift();

      // Check for breakpoint (stepped over exactly once when resuming from it)
      if (
        this._breakpoints.has(`${execution.workflowId}:${stage.id}`) &&
        stage.id !== skipBreakpointOnce
      ) {
        execution.status = "paused";
        execution.currentStage = stage.id;
        this.emit("workflow:paused", {
          executionId: execution.id,
          stageId: stage.id,
          reason: "breakpoint",
        });
        return;
      }
      if (stage.id === skipBreakpointOnce) {
        skipBreakpointOnce = null;
      }

      execution.currentStage = stage.id;
      const logEntry = {
        stageId: stage.id,
        name: stage.name,
        status: "running",
        startedAt: Date.now(),
      };

      try {
        // Check if approval gate
        if (stage.type === "approval") {
          logEntry.status = "awaiting_approval";
          execution.status = "waiting";
          this.emit("workflow:approval-needed", {
            executionId: execution.id,
            stageId: stage.id,
            name: stage.name,
          });
          execution.log.push(logEntry);
          return;
        }

        // Execute the stage action
        logEntry.status = "completed";
        logEntry.completedAt = Date.now();
        logEntry.duration = logEntry.completedAt - logEntry.startedAt;
      } catch (error) {
        logEntry.status = "failed";
        logEntry.error = error.message;
        throw error;
      }

      execution.log.push(logEntry);

      // Mark this stage done: decrement each child's in-degree and enqueue any
      // whose parents have now ALL completed.
      for (const childId of stage.next || []) {
        if (!inDegree.has(childId)) {
          continue;
        }
        inDegree.set(childId, inDegree.get(childId) - 1);
        if (inDegree.get(childId) === 0 && !enqueued.has(childId)) {
          const child = stagesById.get(childId);
          if (child) {
            ready.push(child);
            enqueued.add(childId);
          }
        }
      }
    }
  }

  pauseExecution(executionId) {
    const execution = this._executions.get(executionId);
    if (!execution) {
      return null;
    }
    execution.status = "paused";
    this.emit("workflow:paused", { executionId });
    return execution;
  }

  async resumeExecution(executionId) {
    const execution = this._executions.get(executionId);
    // "paused" = breakpoint / manual pause; "waiting" = approval gate.
    // (Approval pauses set "waiting", so the old `!== "paused"` check made
    // approval workflows wholly unresumable.)
    if (
      !execution ||
      (execution.status !== "paused" && execution.status !== "waiting")
    ) {
      return null;
    }
    const workflow = this._workflows.get(execution.workflowId);
    if (!workflow) {
      return null; // DAG gone (workflow deleted) — nothing to re-drive
    }

    // Resuming a "waiting" execution IS the approval: complete the gate entry
    // so the frontier rebuild treats its children as unblocked.
    if (execution.status === "waiting") {
      const gate = execution.log.find((e) => e.status === "awaiting_approval");
      if (gate) {
        gate.status = "completed";
        gate.approved = true;
        gate.completedAt = Date.now();
        gate.duration = gate.completedAt - gate.startedAt;
      }
    }

    const resumedFromStage = execution.currentStage;
    execution.status = "running";
    this.emit("workflow:resumed", { executionId });

    // Re-drive the remaining stages (the old implementation only flipped the
    // status and returned — the workflow stayed stuck forever while the IPC
    // reported success).
    try {
      await this._executeStages(
        execution,
        workflow.dag.stages,
        workflow.dag.stages,
        { resume: true, skipBreakpointFor: resumedFromStage },
      );
      if (execution.status === "running") {
        execution.status = "completed";
        execution.output = { stages: execution.log };
        this.emit("workflow:completed", { executionId });
      }
    } catch (error) {
      execution.status = "failed";
      execution.output = { error: error.message };
      this.emit("workflow:failed", { executionId, error: error.message });
    }

    this._persistExecution(execution);
    return execution;
  }

  rollbackExecution(executionId) {
    const execution = this._executions.get(executionId);
    if (!execution) {
      return null;
    }
    const rollbackLog = execution.log.map((entry) => ({
      ...entry,
      rolledBack: true,
      rolledBackAt: Date.now(),
    }));
    execution.status = "rolled_back";
    execution.log = rollbackLog;
    this.emit("workflow:rolled-back", { executionId });
    return execution;
  }

  _persistExecution(execution) {
    try {
      this.db
        .prepare(
          `
        INSERT OR REPLACE INTO workflow_executions (id, workflow_id, status, current_stage, input, output, log, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          execution.id,
          execution.workflowId,
          execution.status,
          execution.currentStage,
          JSON.stringify(execution.input),
          JSON.stringify(execution.output),
          JSON.stringify(execution.log),
          execution.startedAt
            ? new Date(execution.startedAt).toISOString()
            : null,
          execution.status === "completed" ? new Date().toISOString() : null,
        );
    } catch (error) {
      logger.error(
        "[WorkflowEngine] Failed to persist execution:",
        error.message,
      );
    }
  }

  // Templates
  getTemplates() {
    return Array.from(this._templates.values());
  }

  importWorkflow(workflowData) {
    return this.createWorkflow(workflowData);
  }

  exportWorkflow(workflowId) {
    const workflow = this._workflows.get(workflowId);
    if (!workflow) {
      return null;
    }
    return { ...workflow };
  }

  getExecutionLog(executionId) {
    const execution = this._executions.get(executionId);
    if (!execution) {
      return null;
    }
    return execution.log;
  }

  // Bound the in-memory execution map. Evicts the oldest *terminal* executions
  // (completed/failed/rolled_back) once over MAX_EXECUTIONS; active executions
  // are never evicted so pause/resume/rollback keep working. Evicted executions
  // remain persisted in workflow_executions.
  _evictOldExecutions() {
    if (this._executions.size <= this.maxExecutions) {
      return;
    }
    for (const [id, exec] of this._executions) {
      if (!TERMINAL_EXEC_STATES.has(exec.status)) {
        continue; // keep active executions
      }
      this._executions.delete(id);
      if (this._executions.size <= this.maxExecutions) {
        break;
      }
    }
  }

  setBreakpoint(workflowId, stageId) {
    this._breakpoints.add(`${workflowId}:${stageId}`);
    return true;
  }

  removeBreakpoint(workflowId, stageId) {
    return this._breakpoints.delete(`${workflowId}:${stageId}`);
  }

  getAllWorkflows() {
    return Array.from(this._workflows.values()).map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status,
      version: w.version,
      stageCount: (w.dag.stages || []).length,
    }));
  }
}

let instance = null;
function getWorkflowEngine() {
  if (!instance) {
    instance = new WorkflowEngine();
  }
  return instance;
}

module.exports = { WorkflowEngine, getWorkflowEngine };
