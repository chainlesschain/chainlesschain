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

describe("WorkflowEngine.executeWorkflow cyclic-DAG guard", () => {
  let engine;
  let db;

  beforeEach(async () => {
    engine = new WorkflowEngine();
    db = createMockDB();
    await engine.initialize(db);
  });

  it("fails gracefully (no stack overflow) on a cyclic DAG loaded outside createWorkflow", async () => {
    // Simulate a workflow rehydrated from the DB via _loadWorkflows(), which
    // does NOT validate — inject a cycle directly, bypassing createWorkflow().
    engine._workflows.set("cyclic-wf", {
      id: "cyclic-wf",
      name: "Cyclic",
      dag: {
        stages: [
          { id: "a", type: "action", name: "A", next: ["b"] },
          { id: "b", type: "action", name: "B", next: ["a"] }, // cycle a→b→a
        ],
      },
    });

    const execution = await engine.executeWorkflow("cyclic-wf", {});

    expect(execution.status).toBe("failed");
    expect(execution.output.error).toMatch(/cyclic/i);
  });

  it("still executes a valid linear workflow to completion", async () => {
    engine._workflows.set("linear-wf", {
      id: "linear-wf",
      name: "Linear",
      dag: {
        stages: [
          { id: "s1", type: "action", name: "Step 1", next: ["s2"] },
          { id: "s2", type: "action", name: "Step 2", next: [] },
        ],
      },
    });

    const execution = await engine.executeWorkflow("linear-wf", {});
    expect(execution.status).toBe("completed");
  });

  it("does not reject a valid diamond DAG (the guard only blocks cycles)", async () => {
    // A→[B,C], B→D, C→D — acyclic, must pass validation and complete.
    engine._workflows.set("diamond-wf", {
      id: "diamond-wf",
      name: "Diamond",
      dag: {
        stages: [
          { id: "A", type: "action", name: "A", next: ["B", "C"] },
          { id: "B", type: "action", name: "B", next: ["D"] },
          { id: "C", type: "action", name: "C", next: ["D"] },
          { id: "D", type: "action", name: "D", next: [] },
        ],
      },
    });

    const execution = await engine.executeWorkflow("diamond-wf", {});
    expect(execution.status).toBe("completed");
  });
});
