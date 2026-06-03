/**
 * @module ai-engine/workflow/workflow-engine
 * Phase 82: Agentic Workflow Engine with DAG execution
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class WorkflowEngine extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._workflows = new Map();
    this._executions = new Map();
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
          dag: JSON.parse(row.dag || "{}"),
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
    this.emit("workflow:started", { executionId: execId, workflowId });

    // Execute stages in topological order
    try {
      const stages = workflow.dag.stages || [];
      const entryStages = stages.filter((s) => {
        return !stages.some((other) => other.next && other.next.includes(s.id));
      });

      await this._executeStages(execution, entryStages, workflow.dag.stages);

      execution.status = "completed";
      execution.output = { stages: execution.log };
      this.emit("workflow:completed", { executionId: execId });
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

  async _executeStages(execution, stages, allStages) {
    for (const stage of stages) {
      // Check for breakpoint
      if (this._breakpoints.has(`${execution.workflowId}:${stage.id}`)) {
        execution.status = "paused";
        execution.currentStage = stage.id;
        this.emit("workflow:paused", {
          executionId: execution.id,
          stageId: stage.id,
          reason: "breakpoint",
        });
        return;
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

      // Execute next stages
      if (stage.next && stage.next.length > 0) {
        const nextStages = stage.next
          .map((id) => allStages.find((s) => s.id === id))
          .filter(Boolean);
        await this._executeStages(execution, nextStages, allStages);
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

  resumeExecution(executionId) {
    const execution = this._executions.get(executionId);
    if (!execution || execution.status !== "paused") {
      return null;
    }
    execution.status = "running";
    this.emit("workflow:resumed", { executionId });
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
