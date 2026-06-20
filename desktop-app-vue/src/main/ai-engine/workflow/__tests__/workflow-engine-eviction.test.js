import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { WorkflowEngine } = require("../workflow-engine.js");

function exec(id, status) {
  return {
    id,
    workflowId: "w",
    status,
    currentStage: null,
    input: {},
    output: null,
    log: [],
    startedAt: Date.now(),
  };
}

describe("WorkflowEngine _evictOldExecutions", () => {
  let engine;

  beforeEach(() => {
    engine = new WorkflowEngine();
    engine.maxExecutions = 3;
  });

  it("evicts the oldest terminal executions when over the cap", () => {
    engine._executions.set("a", exec("a", "completed"));
    engine._executions.set("b", exec("b", "failed"));
    engine._executions.set("c", exec("c", "completed"));
    engine._executions.set("d", exec("d", "running")); // size 4 > 3

    engine._evictOldExecutions();

    expect(engine._executions.size).toBe(3);
    expect(engine._executions.has("a")).toBe(false); // oldest terminal evicted
    expect(engine._executions.has("d")).toBe(true); // active kept
  });

  it("never evicts active executions, even when over the cap", () => {
    engine._executions.set("a", exec("a", "running"));
    engine._executions.set("b", exec("b", "paused"));
    engine._executions.set("c", exec("c", "running"));
    engine._executions.set("d", exec("d", "waiting")); // 4 active, size 4 > 3

    engine._evictOldExecutions();

    expect(engine._executions.size).toBe(4); // nothing evicted
  });

  it("does nothing under the cap", () => {
    engine._executions.set("a", exec("a", "completed"));
    engine._executions.set("b", exec("b", "running"));
    engine._evictOldExecutions();
    expect(engine._executions.size).toBe(2);
  });

  it("evicted executions degrade gracefully on read; active ones stay readable", () => {
    engine._executions.set("a", exec("a", "completed"));
    engine._executions.set("b", exec("b", "completed"));
    engine._executions.set("c", exec("c", "completed"));
    engine._executions.set("d", exec("d", "running"));

    engine._evictOldExecutions(); // evicts "a"

    expect(engine.getExecutionLog("a")).toBeNull();
    expect(engine.pauseExecution("a")).toBeNull();
    expect(engine.getExecutionLog("d")).toEqual([]); // active execution kept
  });
});
