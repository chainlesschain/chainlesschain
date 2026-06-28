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

  it("runs each diamond node EXACTLY ONCE (no per-branch double-execution)", async () => {
    // A→[B,C], B→D, C→D — the join node D must run once, after B and C.
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

    const ids = execution.log.map((e) => e.stageId);
    // Each of the 4 stages logged exactly once (DFS bug ran D twice → 5 entries).
    expect(ids.sort()).toEqual(["A", "B", "C", "D"]);
    expect(ids.filter((id) => id === "D")).toHaveLength(1);
    // D (the join) must come after both its parents B and C.
    expect(ids.indexOf("D")).toBeGreaterThan(ids.indexOf("B"));
    expect(ids.indexOf("D")).toBeGreaterThan(ids.indexOf("C"));
    // A (the entry) runs first.
    expect(ids[0]).toBe("A");
  });

  it("does not blow up exponentially on N chained diamonds (each node once)", async () => {
    // 3 chained diamonds: the recursive DFS bug ran join nodes 2^N times.
    const stages = [];
    for (let i = 0; i < 3; i++) {
      const a = `a${i}`;
      const b = `b${i}`;
      const c = `c${i}`;
      const j = `j${i}`; // join, also the next diamond's entry
      stages.push({ id: a, type: "action", name: a, next: [b, c] });
      stages.push({ id: b, type: "action", name: b, next: [j] });
      stages.push({ id: c, type: "action", name: c, next: [j] });
      const nextEntry = i < 2 ? [`a${i + 1}`] : [];
      stages.push({ id: j, type: "action", name: j, next: nextEntry });
    }
    engine._workflows.set("chained-wf", {
      id: "chained-wf",
      name: "Chained",
      dag: { stages },
    });

    const execution = await engine.executeWorkflow("chained-wf", {});
    expect(execution.status).toBe("completed");
    // Exactly 12 stages, each logged once (DFS would log far more).
    expect(execution.log).toHaveLength(12);
    const counts = {};
    for (const e of execution.log) {
      counts[e.stageId] = (counts[e.stageId] || 0) + 1;
    }
    expect(Object.values(counts).every((n) => n === 1)).toBe(true);
  });
});
