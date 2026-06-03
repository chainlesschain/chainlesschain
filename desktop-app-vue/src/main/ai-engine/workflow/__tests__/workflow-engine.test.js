import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { WorkflowEngine } = require("../workflow-engine");

describe("WorkflowEngine", () => {
  let engine;
  let db;

  beforeEach(() => {
    engine = new WorkflowEngine();
    db = createMockDB();
    vi.clearAllMocks();
  });

  // --- Initialization ---

  it("should start with empty state", () => {
    expect(engine.initialized).toBe(false);
    expect(engine._workflows.size).toBe(0);
    expect(engine._templates.size).toBe(0);
  });

  it("should initialize with database and load default templates", async () => {
    await engine.initialize(db);
    expect(engine.initialized).toBe(true);
    expect(db.exec).toHaveBeenCalled();
    expect(engine._templates.size).toBe(5);
  });

  it("should skip double initialization", async () => {
    await engine.initialize(db);
    const callCount = db.exec.mock.calls.length;
    await engine.initialize(db);
    expect(db.exec.mock.calls.length).toBe(callCount);
  });

  // --- Create Workflow ---

  it("should create a valid workflow", async () => {
    await engine.initialize(db);
    const result = engine.createWorkflow({
      name: "My Workflow",
      stages: [
        { id: "s1", type: "action", name: "Step 1", next: ["s2"] },
        { id: "s2", type: "action", name: "Step 2", next: [] },
      ],
    });
    expect(result.id).toMatch(/^wf-/);
    expect(result.status).toBe("draft");
    expect(result.stages).toHaveLength(2);
    expect(engine._workflows.size).toBe(1);
  });

  it("should create a workflow with custom id", async () => {
    await engine.initialize(db);
    const result = engine.createWorkflow({
      id: "custom-wf",
      name: "Custom",
      stages: [],
    });
    expect(result.id).toBe("custom-wf");
  });

  it("should reject workflow with cycle in DAG", async () => {
    await engine.initialize(db);
    expect(() =>
      engine.createWorkflow({
        name: "Cyclic",
        stages: [
          { id: "a", next: ["b"] },
          { id: "b", next: ["c"] },
          { id: "c", next: ["a"] },
        ],
      }),
    ).toThrow("Invalid DAG: cycle detected");
  });

  it("should accept DAG without cycles", async () => {
    await engine.initialize(db);
    const result = engine.createWorkflow({
      name: "Linear",
      stages: [
        { id: "a", next: ["b"] },
        { id: "b", next: ["c"] },
        { id: "c", next: [] },
      ],
    });
    expect(result.stages).toHaveLength(3);
  });

  it("should accept diamond-shaped DAG", async () => {
    await engine.initialize(db);
    const result = engine.createWorkflow({
      name: "Diamond",
      stages: [
        { id: "a", next: ["b", "c"] },
        { id: "b", next: ["d"] },
        { id: "c", next: ["d"] },
        { id: "d", next: [] },
      ],
    });
    expect(result.stages).toHaveLength(4);
  });

  // --- Execution ---

  it("should execute a simple workflow", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-1",
      name: "Simple",
      stages: [
        { id: "s1", type: "action", name: "Step 1", next: ["s2"] },
        { id: "s2", type: "action", name: "Step 2", next: [] },
      ],
    });
    const exec = await engine.executeWorkflow("wf-1", { data: "test" });
    expect(exec.status).toBe("completed");
    expect(exec.log).toHaveLength(2);
    expect(exec.log[0].stageId).toBe("s1");
  });

  it("should throw when executing non-existent workflow", async () => {
    await engine.initialize(db);
    await expect(engine.executeWorkflow("no-wf")).rejects.toThrow(
      "Workflow 'no-wf' not found",
    );
  });

  it("should encounter approval gate and log it", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-approval",
      name: "With Approval",
      stages: [
        { id: "s1", type: "action", name: "Work", next: ["s2"] },
        { id: "s2", type: "approval", name: "Approve", next: ["s3"] },
        { id: "s3", type: "action", name: "Finish", next: [] },
      ],
    });
    const exec = await engine.executeWorkflow("wf-approval");
    // Approval stage is recorded in the log, stages after it are not executed
    expect(exec.log.some((e) => e.status === "awaiting_approval")).toBe(true);
    // s3 should not appear in log since approval halted further execution
    expect(exec.log.some((e) => e.stageId === "s3")).toBe(false);
  });

  // --- Pause / Resume / Rollback ---

  it("should pause an execution", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-1",
      name: "W",
      stages: [{ id: "s1", type: "action", name: "S1", next: [] }],
    });
    const exec = await engine.executeWorkflow("wf-1");
    const paused = engine.pauseExecution(exec.id);
    expect(paused.status).toBe("paused");
  });

  it("should resume a paused execution", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-1",
      name: "W",
      stages: [{ id: "s1", type: "action", name: "S1", next: [] }],
    });
    const exec = await engine.executeWorkflow("wf-1");
    engine.pauseExecution(exec.id);
    const resumed = engine.resumeExecution(exec.id);
    expect(resumed.status).toBe("running");
  });

  it("should return null when resuming non-paused execution", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-1",
      name: "W",
      stages: [{ id: "s1", type: "action", name: "S1", next: [] }],
    });
    const exec = await engine.executeWorkflow("wf-1");
    expect(engine.resumeExecution(exec.id)).toBeNull();
  });

  it("should rollback an execution", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-1",
      name: "W",
      stages: [{ id: "s1", type: "action", name: "S1", next: [] }],
    });
    const exec = await engine.executeWorkflow("wf-1");
    const rolled = engine.rollbackExecution(exec.id);
    expect(rolled.status).toBe("rolled_back");
    expect(rolled.log.every((e) => e.rolledBack === true)).toBe(true);
  });

  it("should return null for unknown execution operations", async () => {
    await engine.initialize(db);
    expect(engine.pauseExecution("fake")).toBeNull();
    expect(engine.resumeExecution("fake")).toBeNull();
    expect(engine.rollbackExecution("fake")).toBeNull();
  });

  // --- Templates ---

  it("should get default templates", async () => {
    await engine.initialize(db);
    const templates = engine.getTemplates();
    expect(templates.length).toBe(5);
    expect(templates.map((t) => t.id)).toContain("tmpl-data-pipeline");
    expect(templates.map((t) => t.id)).toContain("tmpl-code-review");
  });

  // --- Import / Export ---

  it("should import a workflow", async () => {
    await engine.initialize(db);
    const result = engine.importWorkflow({
      name: "Imported",
      stages: [{ id: "x", next: [] }],
    });
    expect(result.id).toBeDefined();
    expect(result.stages).toHaveLength(1);
  });

  it("should export a workflow", async () => {
    await engine.initialize(db);
    engine.createWorkflow({ id: "wf-exp", name: "Export Me", stages: [] });
    const exported = engine.exportWorkflow("wf-exp");
    expect(exported.name).toBe("Export Me");
    expect(exported.id).toBe("wf-exp");
  });

  it("should return null when exporting unknown workflow", async () => {
    await engine.initialize(db);
    expect(engine.exportWorkflow("nope")).toBeNull();
  });

  // --- Breakpoints & Execution Log ---

  it("should set a breakpoint and stop further stage execution at it", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-bp",
      name: "BP",
      stages: [
        { id: "s1", type: "action", name: "S1", next: ["s2"] },
        { id: "s2", type: "action", name: "S2", next: ["s3"] },
        { id: "s3", type: "action", name: "S3", next: [] },
      ],
    });
    engine.setBreakpoint("wf-bp", "s2");
    const handler = vi.fn();
    engine.on("workflow:paused", handler);
    const exec = await engine.executeWorkflow("wf-bp");
    // Breakpoint was hit during execution
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ stageId: "s2", reason: "breakpoint" }),
    );
    // s3 should not appear in log since breakpoint halted execution
    expect(exec.log.some((e) => e.stageId === "s3")).toBe(false);
  });

  it("should get execution log", async () => {
    await engine.initialize(db);
    engine.createWorkflow({
      id: "wf-1",
      name: "W",
      stages: [{ id: "s1", type: "action", name: "S1", next: [] }],
    });
    const exec = await engine.executeWorkflow("wf-1");
    const log = engine.getExecutionLog(exec.id);
    expect(Array.isArray(log)).toBe(true);
    expect(log.length).toBeGreaterThan(0);
  });

  it("should return null for unknown execution log", async () => {
    await engine.initialize(db);
    expect(engine.getExecutionLog("nope")).toBeNull();
  });
});
