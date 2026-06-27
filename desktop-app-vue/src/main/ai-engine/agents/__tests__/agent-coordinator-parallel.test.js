/**
 * AgentCoordinator._executeParallel — dependency-aware parallel scheduler.
 *
 * Regression coverage for the rewrite: the old scheduler advanced a single
 * `index` cursor and `subtasks.push()`-ed dep-blocked tasks back onto the SAME
 * array it used as the loop bound — so any subtask WITH a dependency (deps
 * complete asynchronously, never synchronously) was re-deferred every pass,
 * growing the array in lockstep with the cursor: an infinite loop / unbounded
 * memory + out-of-bounds writes to `results` + duplicate execution.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { AgentCoordinator } = require("../agent-coordinator.js");

function sub(id, deps = []) {
  return {
    subtaskId: id,
    id,
    agentType: "worker",
    subtask: `do ${id}`,
    dependencies: deps,
    proposedAgent: { id: `agent-${id}` },
  };
}

describe("AgentCoordinator._executeParallel", () => {
  let coord;
  beforeEach(() => {
    coord = new AgentCoordinator();
    coord.assignTask = vi.fn(async (agentId) => ({
      success: true,
      data: agentId,
    }));
  });

  it("runs independent subtasks and returns one result per subtask, in order", async () => {
    const results = await coord._executeParallel("s", [
      sub("a"),
      sub("b"),
      sub("c"),
    ]);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.subtaskId)).toEqual(["a", "b", "c"]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(coord.assignTask).toHaveBeenCalledTimes(3);
  });

  it("runs a dependent subtask AFTER its dependency — no infinite loop, no OOB", async () => {
    const order = [];
    coord.assignTask = vi.fn(async (agentId) => {
      order.push(agentId);
      return { success: true, data: agentId };
    });
    // b depends on a, listed FIRST so the old cursor hit it before a.
    const results = await coord._executeParallel("s", [
      sub("b", ["a"]),
      sub("a"),
    ]);

    expect(results).toHaveLength(2); // exactly n — no array growth / OOB
    const byId = Object.fromEntries(results.map((r) => [r.subtaskId, r]));
    expect(byId.a.success).toBe(true);
    expect(byId.b.success).toBe(true);
    // dependency ordering: a ran before b
    expect(order.indexOf("agent-a")).toBeLessThan(order.indexOf("agent-b"));
    // each subtask ran exactly once (no duplicate execution)
    expect(coord.assignTask).toHaveBeenCalledTimes(2);
  });

  it("handles a dependency chain a→b→c in order", async () => {
    const order = [];
    coord.assignTask = vi.fn(async (agentId) => {
      order.push(agentId);
      return { success: true, data: agentId };
    });
    const results = await coord._executeParallel("s", [
      sub("c", ["b"]),
      sub("b", ["a"]),
      sub("a"),
    ]);
    expect(results.every((r) => r.success)).toBe(true);
    expect(order).toEqual(["agent-a", "agent-b", "agent-c"]);
  });

  it("resolves a CIRCULAR dependency as errors instead of hanging", async () => {
    const results = await coord._executeParallel("s", [
      sub("a", ["b"]),
      sub("b", ["a"]),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success === false)).toBe(true);
    expect(coord.assignTask).not.toHaveBeenCalled();
  });

  it("errors a subtask with an unknown dependency id (no hang)", async () => {
    const results = await coord._executeParallel("s", [sub("a", ["ghost"])]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
  });

  it("returns [] for no subtasks", async () => {
    expect(await coord._executeParallel("s", [])).toEqual([]);
  });
});
