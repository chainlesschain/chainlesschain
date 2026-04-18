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
  WORKFLOW_STATUS,
  NODE_STATUS,
  TEMPLATE_TYPE,
  listTemplates,
  createCheckpoint,
  listCheckpoints,
  rollbackToCheckpoint,
  setBreakpoint,
  listBreakpoints,
  removeBreakpoint,
  shouldBreakpointTrigger,
  exportWorkflow,
  importWorkflow,
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

  // ─── Phase 82: Frozen enums ───────────────────────────

  describe("WORKFLOW_STATUS / NODE_STATUS / TEMPLATE_TYPE", () => {
    it("WORKFLOW_STATUS is frozen", () => {
      expect(Object.isFrozen(WORKFLOW_STATUS)).toBe(true);
    });

    it("NODE_STATUS is frozen", () => {
      expect(Object.isFrozen(NODE_STATUS)).toBe(true);
    });

    it("TEMPLATE_TYPE is frozen", () => {
      expect(Object.isFrozen(TEMPLATE_TYPE)).toBe(true);
    });

    it("WORKFLOW_STATUS contains Phase 82 spec values", () => {
      expect(WORKFLOW_STATUS.CREATED).toBe("created");
      expect(WORKFLOW_STATUS.RUNNING).toBe("running");
      expect(WORKFLOW_STATUS.PAUSED).toBe("paused");
      expect(WORKFLOW_STATUS.COMPLETED).toBe("completed");
      expect(WORKFLOW_STATUS.FAILED).toBe("failed");
      expect(WORKFLOW_STATUS.ROLLING_BACK).toBe("rolling_back");
    });

    it("NODE_STATUS contains Phase 82 spec values", () => {
      expect(NODE_STATUS.PENDING).toBe("pending");
      expect(NODE_STATUS.RUNNING).toBe("running");
      expect(NODE_STATUS.COMPLETED).toBe("completed");
      expect(NODE_STATUS.FAILED).toBe("failed");
      expect(NODE_STATUS.SKIPPED).toBe("skipped");
      expect(NODE_STATUS.WAITING_APPROVAL).toBe("waiting_approval");
    });

    it("TEMPLATE_TYPE contains Phase 82 spec values", () => {
      expect(TEMPLATE_TYPE.CI_CD).toBe("ci_cd");
      expect(TEMPLATE_TYPE.DATA_PIPELINE).toBe("data_pipeline");
      expect(TEMPLATE_TYPE.CODE_REVIEW).toBe("code_review");
      expect(TEMPLATE_TYPE.DEPLOYMENT).toBe("deployment");
      expect(TEMPLATE_TYPE.TEST_SUITE).toBe("test_suite");
    });
  });

  // ─── Phase 82: listTemplates (canonical) ──────────────

  describe("listTemplates (canonical Phase 82)", () => {
    it("returns 5 canonical templates", () => {
      expect(listTemplates()).toHaveLength(5);
    });

    it("all templates are keyed by TEMPLATE_TYPE", () => {
      const types = listTemplates().map((t) => t.id);
      expect(types).toContain(TEMPLATE_TYPE.CI_CD);
      expect(types).toContain(TEMPLATE_TYPE.DATA_PIPELINE);
      expect(types).toContain(TEMPLATE_TYPE.CODE_REVIEW);
      expect(types).toContain(TEMPLATE_TYPE.DEPLOYMENT);
      expect(types).toContain(TEMPLATE_TYPE.TEST_SUITE);
    });

    it("all canonical templates have valid DAGs", () => {
      for (const tpl of listTemplates()) {
        expect(validateDAG(tpl.stages)).toBe(true);
      }
    });

    it("CI_CD has deploy approval gate", () => {
      const cicd = listTemplates().find((t) => t.id === TEMPLATE_TYPE.CI_CD);
      const approve = cicd.stages.find((s) => s.id === "approve");
      expect(approve).toBeDefined();
      expect(approve.type).toBe("approval");
    });

    it("DEPLOYMENT has smoke test stage", () => {
      const dep = listTemplates().find(
        (t) => t.id === TEMPLATE_TYPE.DEPLOYMENT,
      );
      expect(dep.stages.some((s) => s.id === "smoke")).toBe(true);
    });
  });

  // ─── Phase 82: Checkpoints ────────────────────────────

  describe("createCheckpoint / listCheckpoints / rollbackToCheckpoint", () => {
    const stages = [
      { id: "s1", name: "Step 1", type: "action", next: ["s2"] },
      { id: "s2", name: "Step 2", type: "action", next: [] },
    ];

    it("creates a checkpoint for a running execution", () => {
      const wf = createWorkflow(db, { name: "CP WF", stages });
      const exec = executeWorkflow(db, wf.id, { x: 1 });
      const cp = createCheckpoint(db, exec.id);
      expect(cp.id).toMatch(/^cp-/);
      expect(cp.executionId).toBe(exec.id);
      expect(cp.workflowId).toBe(wf.id);
      expect(cp.snapshot.status).toBe("completed");
    });

    it("throws for non-existent execution", () => {
      expect(() => createCheckpoint(db, "exec-nope")).toThrow("not found");
    });

    it("listCheckpoints returns newest first", () => {
      const wf = createWorkflow(db, { name: "Multi CP", stages });
      const exec = executeWorkflow(db, wf.id);
      const cp1 = createCheckpoint(db, exec.id);
      const cp2 = createCheckpoint(db, exec.id);
      const list = listCheckpoints(db, exec.id);
      expect(list.length).toBeGreaterThanOrEqual(2);
      const ids = list.map((c) => c.id);
      expect(ids).toContain(cp1.id);
      expect(ids).toContain(cp2.id);
    });

    it("listCheckpoints returns empty for unknown exec", () => {
      expect(listCheckpoints(db, "exec-missing")).toEqual([]);
    });

    it("rollbackToCheckpoint sets rolled_back status", () => {
      const wf = createWorkflow(db, { name: "RB CP", stages });
      const exec = executeWorkflow(db, wf.id);
      const cp = createCheckpoint(db, exec.id);
      const result = rollbackToCheckpoint(db, exec.id, cp.id);
      expect(result.status).toBe(WORKFLOW_STATUS.ROLLED_BACK);
      expect(result.checkpointId).toBe(cp.id);
    });

    it("rollbackToCheckpoint throws for unknown checkpoint", () => {
      const wf = createWorkflow(db, { name: "Bad CP", stages });
      const exec = executeWorkflow(db, wf.id);
      expect(() => rollbackToCheckpoint(db, exec.id, "cp-nope")).toThrow(
        "not found",
      );
    });

    it("rollbackToCheckpoint preserves checkpoint's node states in log", () => {
      const wf = createWorkflow(db, { name: "Log CP", stages });
      const exec = executeWorkflow(db, wf.id);
      const cp = createCheckpoint(db, exec.id);
      rollbackToCheckpoint(db, exec.id, cp.id);
      const after = getExecutionLog(db, exec.id);
      expect(after.log.at(-1).action).toBe("rolled_back_to_checkpoint");
      expect(after.log.at(-1).checkpointId).toBe(cp.id);
    });
  });

  // ─── Phase 82: Breakpoints ────────────────────────────

  describe("setBreakpoint / listBreakpoints / removeBreakpoint", () => {
    const stages = [
      { id: "a", name: "A", type: "action", next: ["b"] },
      { id: "b", name: "B", type: "action", next: [] },
    ];

    it("sets an unconditional breakpoint", () => {
      const wf = createWorkflow(db, { name: "BP WF", stages });
      const bp = setBreakpoint(db, wf.id, "a");
      expect(bp.id).toMatch(/^bp-/);
      expect(bp.nodeId).toBe("a");
      expect(bp.condition).toBeNull();
    });

    it("sets a conditional breakpoint with valid condition", () => {
      const wf = createWorkflow(db, { name: "Cond BP", stages });
      const bp = setBreakpoint(db, wf.id, "b", "input.priority > 5");
      expect(bp.condition).toBe("input.priority > 5");
    });

    it("rejects invalid conditions (no input prefix)", () => {
      const wf = createWorkflow(db, { name: "Bad Cond", stages });
      expect(() => setBreakpoint(db, wf.id, "a", "foo.bar > 1")).toThrow(
        "Invalid breakpoint condition",
      );
    });

    it("rejects conditions with dangerous operators", () => {
      const wf = createWorkflow(db, { name: "Dangerous", stages });
      expect(() =>
        setBreakpoint(db, wf.id, "a", "input.x; require('fs')"),
      ).toThrow("Invalid breakpoint condition");
    });

    it("throws for unknown workflow", () => {
      expect(() => setBreakpoint(db, "wf-nope", "a")).toThrow(
        "Workflow not found",
      );
    });

    it("throws for unknown node", () => {
      const wf = createWorkflow(db, { name: "Unknown Node", stages });
      expect(() => setBreakpoint(db, wf.id, "z")).toThrow(
        "Node z not in workflow",
      );
    });

    it("listBreakpoints returns all breakpoints for workflow", () => {
      const wf = createWorkflow(db, { name: "List BP", stages });
      setBreakpoint(db, wf.id, "a");
      setBreakpoint(db, wf.id, "b", "input.x == 1");
      const list = listBreakpoints(db, wf.id);
      expect(list).toHaveLength(2);
      expect(list.every((b) => b.enabled === true)).toBe(true);
    });

    it("listBreakpoints returns empty for workflow with none", () => {
      expect(listBreakpoints(db, "wf-empty")).toEqual([]);
    });

    it("removeBreakpoint deletes it", () => {
      const wf = createWorkflow(db, { name: "Remove BP", stages });
      const bp = setBreakpoint(db, wf.id, "a");
      const result = removeBreakpoint(db, bp.id);
      expect(result.removed).toBe(true);
      expect(listBreakpoints(db, wf.id)).toHaveLength(0);
    });

    it("removeBreakpoint returns removed=false for unknown id", () => {
      expect(removeBreakpoint(db, "bp-nope").removed).toBe(false);
    });
  });

  // ─── Phase 82: shouldBreakpointTrigger ────────────────

  describe("shouldBreakpointTrigger", () => {
    it("unconditional breakpoint always triggers", () => {
      const bp = { enabled: true, condition: null };
      expect(shouldBreakpointTrigger(bp, {})).toBe(true);
    });

    it("disabled breakpoint never triggers", () => {
      const bp = { enabled: false, condition: null };
      expect(shouldBreakpointTrigger(bp, {})).toBe(false);
    });

    it("numeric > condition triggers when true", () => {
      const bp = { enabled: true, condition: "input.priority > 5" };
      expect(shouldBreakpointTrigger(bp, { priority: 10 })).toBe(true);
      expect(shouldBreakpointTrigger(bp, { priority: 3 })).toBe(false);
    });

    it("numeric == condition", () => {
      const bp = { enabled: true, condition: "input.count == 7" };
      expect(shouldBreakpointTrigger(bp, { count: 7 })).toBe(true);
      expect(shouldBreakpointTrigger(bp, { count: 6 })).toBe(false);
    });

    it("string == condition with quotes", () => {
      const bp = { enabled: true, condition: 'input.env == "prod"' };
      expect(shouldBreakpointTrigger(bp, { env: "prod" })).toBe(true);
      expect(shouldBreakpointTrigger(bp, { env: "dev" })).toBe(false);
    });

    it("boolean == condition", () => {
      const bp = { enabled: true, condition: "input.active == true" };
      expect(shouldBreakpointTrigger(bp, { active: true })).toBe(true);
      expect(shouldBreakpointTrigger(bp, { active: false })).toBe(false);
    });

    it("nested path condition", () => {
      const bp = { enabled: true, condition: "input.user.role == 'admin'" };
      expect(shouldBreakpointTrigger(bp, { user: { role: "admin" } })).toBe(
        true,
      );
      expect(shouldBreakpointTrigger(bp, { user: { role: "viewer" } })).toBe(
        false,
      );
    });

    it("returns false when path doesn't exist in input", () => {
      const bp = { enabled: true, condition: "input.missing.deep > 5" };
      expect(shouldBreakpointTrigger(bp, {})).toBe(false);
    });

    it("supports !=, <=, >= operators", () => {
      expect(
        shouldBreakpointTrigger(
          { enabled: true, condition: "input.n != 1" },
          { n: 2 },
        ),
      ).toBe(true);
      expect(
        shouldBreakpointTrigger(
          { enabled: true, condition: "input.n <= 5" },
          { n: 5 },
        ),
      ).toBe(true);
      expect(
        shouldBreakpointTrigger(
          { enabled: true, condition: "input.n >= 10" },
          { n: 10 },
        ),
      ).toBe(true);
    });
  });

  // ─── Phase 82: Import / Export ────────────────────────

  describe("exportWorkflow / importWorkflow", () => {
    const stages = [
      { id: "a", name: "A", type: "action", next: ["b"] },
      { id: "b", name: "B", type: "action", next: [] },
    ];

    it("exports a workflow as JSON definition", () => {
      const wf = createWorkflow(db, {
        name: "Exp WF",
        description: "to export",
        stages,
      });
      const exp = exportWorkflow(db, wf.id);
      expect(exp.name).toBe("Exp WF");
      expect(exp.description).toBe("to export");
      expect(exp.stages).toEqual(stages);
      expect(exp.schemaVersion).toBe(1);
      expect(exp.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("exportWorkflow throws for unknown workflow", () => {
      expect(() => exportWorkflow(db, "wf-nope")).toThrow("not found");
    });

    it("imports a workflow from a definition", () => {
      const def = { name: "Imp WF", description: "from json", stages };
      const result = importWorkflow(db, def);
      expect(result.id).toMatch(/^wf-/);
      const fetched = getWorkflow(db, result.id);
      expect(fetched.name).toBe("Imp WF");
      expect(fetched.dag).toEqual(stages);
    });

    it("round-trips through export then import", () => {
      const original = createWorkflow(db, {
        name: "RT WF",
        description: "rt",
        stages,
      });
      const exp = exportWorkflow(db, original.id);
      const imp = importWorkflow(db, exp);
      expect(imp.id).not.toBe(original.id);
      const restored = getWorkflow(db, imp.id);
      expect(restored.name).toBe("RT WF");
      expect(restored.dag).toEqual(stages);
    });

    it("importWorkflow throws for non-object definition", () => {
      expect(() => importWorkflow(db, null)).toThrow(
        "Definition must be an object",
      );
      expect(() => importWorkflow(db, "string")).toThrow(
        "Definition must be an object",
      );
    });

    it("importWorkflow throws for missing name", () => {
      expect(() => importWorkflow(db, { stages })).toThrow(
        "Definition missing name",
      );
    });

    it("importWorkflow throws for empty stages", () => {
      expect(() => importWorkflow(db, { name: "Empty", stages: [] })).toThrow(
        "non-empty stages",
      );
    });

    it("importWorkflow rejects cyclic definitions", () => {
      const cyclic = [
        { id: "a", name: "A", type: "action", next: ["b"] },
        { id: "b", name: "B", type: "action", next: ["a"] },
      ];
      expect(() =>
        importWorkflow(db, { name: "Cyclic", stages: cyclic }),
      ).toThrow("Invalid DAG");
    });
  });
});

// ===== V2 Surface Tests (cli 0.130.0) =====
import { describe, it, expect, beforeEach } from "vitest";
import {
  WORKFLOW_MATURITY_V2,
  RUN_LIFECYCLE_V2,
  registerWorkflowV2,
  activateWorkflowV2,
  pauseWorkflowV2,
  retireWorkflowV2,
  touchWorkflowV2,
  getWorkflowV2,
  listWorkflowsV2,
  createRunV2,
  startRunV2,
  completeRunV2,
  failRunV2,
  cancelRunV2,
  getRunV2,
  listRunsV2,
  autoPauseIdleWorkflowsV2,
  autoFailStuckRunsV2,
  getWorkflowEngineStatsV2,
  setMaxActiveWorkflowsPerOwnerV2,
  setMaxPendingRunsPerWorkflowV2,
  setWorkflowIdleMsV2,
  setRunStuckMsV2,
  getMaxActiveWorkflowsPerOwnerV2,
  getMaxPendingRunsPerWorkflowV2,
  getWorkflowIdleMsV2,
  getRunStuckMsV2,
  _resetStateWorkflowEngineV2,
} from "../../src/lib/workflow-engine.js";

describe("Workflow Engine V2", () => {
  beforeEach(() => _resetStateWorkflowEngineV2());

  describe("enums", () => {
    it("workflow maturity has 4 states", () => {
      expect(Object.keys(WORKFLOW_MATURITY_V2).sort()).toEqual([
        "ACTIVE",
        "DRAFT",
        "PAUSED",
        "RETIRED",
      ]);
    });
    it("run lifecycle has 5 states", () => {
      expect(Object.keys(RUN_LIFECYCLE_V2).sort()).toEqual([
        "CANCELLED",
        "COMPLETED",
        "FAILED",
        "QUEUED",
        "RUNNING",
      ]);
    });
    it("enums are frozen", () => {
      expect(Object.isFrozen(WORKFLOW_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(RUN_LIFECYCLE_V2)).toBe(true);
    });
  });

  describe("workflow lifecycle", () => {
    it("registers in draft", () => {
      const w = registerWorkflowV2({ id: "w1", owner: "alice" });
      expect(w.status).toBe("draft");
      expect(w.activatedAt).toBeNull();
    });
    it("rejects duplicate id", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      expect(() => registerWorkflowV2({ id: "w1", owner: "bob" })).toThrow();
    });
    it("rejects missing required fields", () => {
      expect(() => registerWorkflowV2({})).toThrow();
      expect(() => registerWorkflowV2({ id: "w1" })).toThrow();
    });
    it("activates draft → active", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      const w = activateWorkflowV2("w1");
      expect(w.status).toBe("active");
      expect(w.activatedAt).toBeGreaterThan(0);
    });
    it("pauses active → paused", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      activateWorkflowV2("w1");
      expect(pauseWorkflowV2("w1").status).toBe("paused");
    });
    it("recovers paused → active (preserves activatedAt)", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      const first = activateWorkflowV2("w1").activatedAt;
      pauseWorkflowV2("w1");
      const r = activateWorkflowV2("w1");
      expect(r.activatedAt).toBe(first);
    });
    it("retires (terminal)", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      const w = retireWorkflowV2("w1");
      expect(w.retiredAt).toBeGreaterThan(0);
      expect(() => activateWorkflowV2("w1")).toThrow();
    });
    it("rejects invalid transition draft → paused", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      expect(() => pauseWorkflowV2("w1")).toThrow();
    });
    it("touches lastSeenAt", async () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      const before = getWorkflowV2("w1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      const after = touchWorkflowV2("w1").lastSeenAt;
      expect(after).toBeGreaterThan(before);
    });
  });

  describe("active-workflow cap", () => {
    it("enforces per-owner cap on draft → active", () => {
      setMaxActiveWorkflowsPerOwnerV2(2);
      ["a", "b", "c"].forEach((id) =>
        registerWorkflowV2({ id, owner: "alice" }),
      );
      activateWorkflowV2("a");
      activateWorkflowV2("b");
      expect(() => activateWorkflowV2("c")).toThrow(/cap reached/);
    });
    it("does not apply to other owners", () => {
      setMaxActiveWorkflowsPerOwnerV2(1);
      registerWorkflowV2({ id: "a", owner: "alice" });
      registerWorkflowV2({ id: "b", owner: "bob" });
      activateWorkflowV2("a");
      expect(activateWorkflowV2("b").status).toBe("active");
    });
    it("recovery exempt", () => {
      setMaxActiveWorkflowsPerOwnerV2(1);
      registerWorkflowV2({ id: "a", owner: "alice" });
      activateWorkflowV2("a");
      pauseWorkflowV2("a");
      registerWorkflowV2({ id: "b", owner: "alice" });
      activateWorkflowV2("b");
      expect(activateWorkflowV2("a").status).toBe("active");
    });
  });

  describe("run lifecycle", () => {
    beforeEach(() => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      activateWorkflowV2("w1");
    });
    it("creates queued", () => {
      const r = createRunV2({ id: "R1", workflowId: "w1" });
      expect(r.status).toBe("queued");
      expect(r.trigger).toBe("manual");
    });
    it("rejects on retired workflow", () => {
      retireWorkflowV2("w1");
      expect(() => createRunV2({ id: "R1", workflowId: "w1" })).toThrow(
        /retired/,
      );
    });
    it("starts queued → running", () => {
      createRunV2({ id: "R1", workflowId: "w1" });
      const r = startRunV2("R1");
      expect(r.status).toBe("running");
      expect(r.startedAt).toBeGreaterThan(0);
    });
    it("completes (terminal)", () => {
      createRunV2({ id: "R1", workflowId: "w1" });
      startRunV2("R1");
      const r = completeRunV2("R1");
      expect(r.status).toBe("completed");
      expect(r.settledAt).toBeGreaterThan(0);
      expect(() => failRunV2("R1", "x")).toThrow();
    });
    it("fails (terminal) with error", () => {
      createRunV2({ id: "R1", workflowId: "w1" });
      startRunV2("R1");
      const r = failRunV2("R1", "broken");
      expect(r.metadata.error).toBe("broken");
    });
    it("cancels from queued", () => {
      createRunV2({ id: "R1", workflowId: "w1" });
      const r = cancelRunV2("R1");
      expect(r.status).toBe("cancelled");
    });
  });

  describe("pending-run cap", () => {
    beforeEach(() => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      activateWorkflowV2("w1");
    });
    it("enforces at create time", () => {
      setMaxPendingRunsPerWorkflowV2(2);
      createRunV2({ id: "R1", workflowId: "w1" });
      createRunV2({ id: "R2", workflowId: "w1" });
      expect(() => createRunV2({ id: "R3", workflowId: "w1" })).toThrow(
        /cap reached/,
      );
    });
    it("frees up after terminal", () => {
      setMaxPendingRunsPerWorkflowV2(2);
      createRunV2({ id: "R1", workflowId: "w1" });
      createRunV2({ id: "R2", workflowId: "w1" });
      startRunV2("R1");
      completeRunV2("R1");
      expect(createRunV2({ id: "R3", workflowId: "w1" }).status).toBe("queued");
    });
  });

  describe("auto-flip", () => {
    it("auto-pause idle workflows", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      activateWorkflowV2("w1");
      const flipped = autoPauseIdleWorkflowsV2({
        now: Date.now() + 65 * 24 * 60 * 60 * 1000,
      });
      expect(flipped.length).toBe(1);
      expect(flipped[0].status).toBe("paused");
    });
    it("auto-fail stuck runs", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      activateWorkflowV2("w1");
      createRunV2({ id: "R1", workflowId: "w1" });
      startRunV2("R1");
      const flipped = autoFailStuckRunsV2({ now: Date.now() + 20 * 60 * 1000 });
      expect(flipped.length).toBe(1);
      expect(flipped[0].metadata.error).toBe("stuck-timeout");
    });
  });

  describe("config setters", () => {
    it("rejects bad inputs", () => {
      expect(() => setMaxActiveWorkflowsPerOwnerV2(0)).toThrow();
      expect(() => setMaxPendingRunsPerWorkflowV2(-2)).toThrow();
      expect(() => setWorkflowIdleMsV2(NaN)).toThrow();
      expect(() => setRunStuckMsV2("x")).toThrow();
    });
    it("floors floats", () => {
      setMaxActiveWorkflowsPerOwnerV2(11.7);
      expect(getMaxActiveWorkflowsPerOwnerV2()).toBe(11);
    });
    it("setters update config", () => {
      setMaxPendingRunsPerWorkflowV2(20);
      setWorkflowIdleMsV2(12345);
      setRunStuckMsV2(6789);
      expect(getMaxPendingRunsPerWorkflowV2()).toBe(20);
      expect(getWorkflowIdleMsV2()).toBe(12345);
      expect(getRunStuckMsV2()).toBe(6789);
    });
  });

  describe("listing & defensive copy", () => {
    it("filters work", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      registerWorkflowV2({ id: "w2", owner: "bob" });
      activateWorkflowV2("w1");
      createRunV2({ id: "R1", workflowId: "w1", trigger: "schedule" });
      expect(listWorkflowsV2({ owner: "alice" }).length).toBe(1);
      expect(listWorkflowsV2({ status: "active" }).length).toBe(1);
      expect(listRunsV2({ trigger: "schedule" }).length).toBe(1);
    });
    it("deep copy on read", () => {
      registerWorkflowV2({ id: "w1", owner: "alice", metadata: { tag: "x" } });
      const w = getWorkflowV2("w1");
      w.metadata.tag = "MUT";
      expect(getWorkflowV2("w1").metadata.tag).toBe("x");
    });
  });

  describe("stats", () => {
    it("zero-initializes all enum keys", () => {
      const s = getWorkflowEngineStatsV2();
      expect(s.workflowsByStatus.draft).toBe(0);
      expect(s.workflowsByStatus.retired).toBe(0);
      expect(s.runsByStatus.completed).toBe(0);
    });
    it("counts match state", () => {
      registerWorkflowV2({ id: "w1", owner: "alice" });
      activateWorkflowV2("w1");
      createRunV2({ id: "R1", workflowId: "w1" });
      const s = getWorkflowEngineStatsV2();
      expect(s.totalWorkflowsV2).toBe(1);
      expect(s.workflowsByStatus.active).toBe(1);
      expect(s.runsByStatus.queued).toBe(1);
    });
  });

  describe("reset", () => {
    it("clears + restores defaults", () => {
      setMaxActiveWorkflowsPerOwnerV2(99);
      registerWorkflowV2({ id: "w1", owner: "alice" });
      _resetStateWorkflowEngineV2();
      expect(getMaxActiveWorkflowsPerOwnerV2()).toBe(12);
      expect(listWorkflowsV2({}).length).toBe(0);
    });
  });
});
