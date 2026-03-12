import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureWorkflowTables,
  createWorkflow,
  getWorkflow,
  listWorkflows,
  deleteWorkflow,
  executeWorkflow,
  pauseExecution,
  resumeExecution,
  rollbackExecution,
  getExecutionLog,
  getTemplates,
  validateDAG,
} from "../../src/lib/workflow-engine.js";

describe("workflow-engine", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureWorkflowTables ──────────────────────────────

  describe("ensureWorkflowTables", () => {
    it("creates workflows table", () => {
      ensureWorkflowTables(db);
      expect(db.tables.has("workflows")).toBe(true);
    });

    it("creates workflow_executions table", () => {
      ensureWorkflowTables(db);
      expect(db.tables.has("workflow_executions")).toBe(true);
    });

    it("is idempotent", () => {
      ensureWorkflowTables(db);
      ensureWorkflowTables(db);
      expect(db.tables.has("workflows")).toBe(true);
    });
  });

  // ─── validateDAG ──────────────────────────────────────

  describe("validateDAG", () => {
    it("accepts a valid linear DAG", () => {
      const stages = [
        { id: "a", name: "A", type: "action", next: ["b"] },
        { id: "b", name: "B", type: "action", next: ["c"] },
        { id: "c", name: "C", type: "action", next: [] },
      ];
      expect(validateDAG(stages)).toBe(true);
    });

    it("accepts a valid diamond DAG", () => {
      const stages = [
        { id: "a", name: "A", type: "action", next: ["b", "c"] },
        { id: "b", name: "B", type: "action", next: ["d"] },
        { id: "c", name: "C", type: "action", next: ["d"] },
        { id: "d", name: "D", type: "action", next: [] },
      ];
      expect(validateDAG(stages)).toBe(true);
    });

    it("rejects a cyclic graph", () => {
      const stages = [
        { id: "a", name: "A", type: "action", next: ["b"] },
        { id: "b", name: "B", type: "action", next: ["c"] },
        { id: "c", name: "C", type: "action", next: ["a"] },
      ];
      expect(validateDAG(stages)).toBe(false);
    });

    it("rejects a self-loop", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: ["a"] }];
      expect(validateDAG(stages)).toBe(false);
    });

    it("rejects empty stages array", () => {
      expect(validateDAG([])).toBe(false);
    });

    it("rejects null input", () => {
      expect(validateDAG(null)).toBe(false);
    });

    it("rejects stages with missing id", () => {
      const stages = [{ name: "A", type: "action", next: [] }];
      expect(validateDAG(stages)).toBe(false);
    });

    it("rejects stages referencing non-existent targets", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: ["z"] }];
      expect(validateDAG(stages)).toBe(false);
    });

    it("accepts a single stage with no next", () => {
      const stages = [{ id: "only", name: "Only", type: "action", next: [] }];
      expect(validateDAG(stages)).toBe(true);
    });
  });

  // ─── createWorkflow ──────────────────────────────────

  describe("createWorkflow", () => {
    const validStages = [
      { id: "s1", name: "Step 1", type: "action", next: ["s2"] },
      { id: "s2", name: "Step 2", type: "action", next: [] },
    ];

    it("creates a workflow with valid DAG", () => {
      const result = createWorkflow(db, {
        name: "Test Workflow",
        description: "A test",
        stages: validStages,
      });
      expect(result.id).toMatch(/^wf-/);
      expect(result.status).toBe("active");
      expect(result.stages).toHaveLength(2);
    });

    it("throws for missing name", () => {
      expect(() => createWorkflow(db, { stages: validStages })).toThrow(
        "Workflow name is required",
      );
    });

    it("throws for missing stages", () => {
      expect(() => createWorkflow(db, { name: "No stages" })).toThrow(
        "Workflow must have at least one stage",
      );
    });

    it("throws for cyclic DAG", () => {
      const cyclicStages = [
        { id: "a", name: "A", type: "action", next: ["b"] },
        { id: "b", name: "B", type: "action", next: ["a"] },
      ];
      expect(() =>
        createWorkflow(db, { name: "Cyclic", stages: cyclicStages }),
      ).toThrow("Invalid DAG");
    });

    it("stores workflow in database", () => {
      const result = createWorkflow(db, {
        name: "Stored WF",
        stages: validStages,
      });
      const fetched = getWorkflow(db, result.id);
      expect(fetched).not.toBeNull();
      expect(fetched.name).toBe("Stored WF");
    });
  });

  // ─── getWorkflow ──────────────────────────────────────

  describe("getWorkflow", () => {
    it("returns null for non-existent workflow", () => {
      const result = getWorkflow(db, "wf-nonexistent");
      expect(result).toBeNull();
    });

    it("returns workflow with parsed DAG", () => {
      const stages = [{ id: "x", name: "X", type: "action", next: [] }];
      const created = createWorkflow(db, { name: "W", stages });
      const fetched = getWorkflow(db, created.id);
      expect(fetched.dag).toEqual(stages);
    });
  });

  // ─── listWorkflows ────────────────────────────────────

  describe("listWorkflows", () => {
    it("returns empty array when no workflows", () => {
      const result = listWorkflows(db);
      expect(result).toEqual([]);
    });

    it("returns all workflows", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      createWorkflow(db, { name: "WF1", stages });
      createWorkflow(db, { name: "WF2", stages });
      const result = listWorkflows(db);
      expect(result).toHaveLength(2);
    });
  });

  // ─── deleteWorkflow ───────────────────────────────────

  describe("deleteWorkflow", () => {
    it("deletes existing workflow", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const created = createWorkflow(db, { name: "ToDelete", stages });
      const result = deleteWorkflow(db, created.id);
      expect(result.deleted).toBe(true);
    });

    it("returns deleted false for non-existent", () => {
      const result = deleteWorkflow(db, "wf-nope");
      expect(result.deleted).toBe(false);
    });
  });

  // ─── executeWorkflow ──────────────────────────────────

  describe("executeWorkflow", () => {
    it("executes workflow and returns completed status", () => {
      const stages = [
        { id: "s1", name: "Step 1", type: "action", next: ["s2"] },
        { id: "s2", name: "Step 2", type: "approval", next: [] },
      ];
      const wf = createWorkflow(db, { name: "Exec WF", stages });
      const exec = executeWorkflow(db, wf.id);
      expect(exec.status).toBe("completed");
      expect(exec.id).toMatch(/^exec-/);
      expect(exec.log).toHaveLength(2);
    });

    it("records execution log with stage details", () => {
      const stages = [{ id: "a", name: "Action A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "Log WF", stages });
      const exec = executeWorkflow(db, wf.id);
      expect(exec.log[0].stageId).toBe("a");
      expect(exec.log[0].stageName).toBe("Action A");
      expect(exec.log[0].type).toBe("action");
      expect(exec.log[0].status).toBe("completed");
    });

    it("throws for non-existent workflow", () => {
      expect(() => executeWorkflow(db, "wf-missing")).toThrow(
        "Workflow not found",
      );
    });

    it("accepts optional input", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "Input WF", stages });
      const exec = executeWorkflow(db, wf.id, { key: "value" });
      expect(exec.status).toBe("completed");
    });
  });

  // ─── pauseExecution ───────────────────────────────────

  describe("pauseExecution", () => {
    it("pauses a completed execution", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "Pause WF", stages });
      const exec = executeWorkflow(db, wf.id);
      const result = pauseExecution(db, exec.id);
      expect(result.status).toBe("paused");
    });

    it("throws for non-existent execution", () => {
      expect(() => pauseExecution(db, "exec-nope")).toThrow(
        "Execution not found",
      );
    });
  });

  // ─── resumeExecution ──────────────────────────────────

  describe("resumeExecution", () => {
    it("resumes a paused execution", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "Resume WF", stages });
      const exec = executeWorkflow(db, wf.id);
      pauseExecution(db, exec.id);
      const result = resumeExecution(db, exec.id);
      expect(result.status).toBe("running");
    });

    it("throws for non-paused execution", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "WF", stages });
      const exec = executeWorkflow(db, wf.id);
      expect(() => resumeExecution(db, exec.id)).toThrow("Cannot resume");
    });
  });

  // ─── rollbackExecution ────────────────────────────────

  describe("rollbackExecution", () => {
    it("rolls back an execution", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "Rollback WF", stages });
      const exec = executeWorkflow(db, wf.id);
      const result = rollbackExecution(db, exec.id);
      expect(result.status).toBe("rolled_back");
    });

    it("throws when already rolled back", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "WF", stages });
      const exec = executeWorkflow(db, wf.id);
      rollbackExecution(db, exec.id);
      expect(() => rollbackExecution(db, exec.id)).toThrow(
        "already rolled back",
      );
    });

    it("throws for non-existent execution", () => {
      expect(() => rollbackExecution(db, "exec-nope")).toThrow(
        "Execution not found",
      );
    });
  });

  // ─── getExecutionLog ──────────────────────────────────

  describe("getExecutionLog", () => {
    it("returns execution log with metadata", () => {
      const stages = [{ id: "a", name: "A", type: "action", next: [] }];
      const wf = createWorkflow(db, { name: "Log WF", stages });
      const exec = executeWorkflow(db, wf.id);
      const log = getExecutionLog(db, exec.id);
      expect(log.id).toBe(exec.id);
      expect(log.workflowId).toBe(wf.id);
      expect(log.status).toBe("completed");
      expect(Array.isArray(log.log)).toBe(true);
    });

    it("throws for non-existent execution", () => {
      expect(() => getExecutionLog(db, "exec-nope")).toThrow(
        "Execution not found",
      );
    });
  });

  // ─── getTemplates ─────────────────────────────────────

  describe("getTemplates", () => {
    it("returns 5 built-in templates", () => {
      const templates = getTemplates();
      expect(templates).toHaveLength(5);
    });

    it("each template has required fields", () => {
      const templates = getTemplates();
      for (const tpl of templates) {
        expect(tpl.id).toBeTruthy();
        expect(tpl.name).toBeTruthy();
        expect(tpl.description).toBeTruthy();
        expect(Array.isArray(tpl.stages)).toBe(true);
        expect(tpl.stages.length).toBeGreaterThan(0);
      }
    });

    it("all templates have valid DAGs", () => {
      const templates = getTemplates();
      for (const tpl of templates) {
        expect(validateDAG(tpl.stages)).toBe(true);
      }
    });

    it("includes Data Pipeline template", () => {
      const templates = getTemplates();
      const dp = templates.find((t) => t.id === "data-pipeline");
      expect(dp).toBeDefined();
      expect(dp.name).toBe("Data Pipeline");
    });

    it("includes Incident Response template", () => {
      const templates = getTemplates();
      const ir = templates.find((t) => t.id === "incident-response");
      expect(ir).toBeDefined();
      expect(ir.stages).toHaveLength(4);
    });
  });
});
