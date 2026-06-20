import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { AgentCoordinator, TASK_STATUS } = require("../agent-coordinator.js");

function task(id, status) {
  return { id, agentId: "agent-1", status, description: "d", assignedAt: Date.now() };
}

describe("AgentCoordinator._evictTerminalTasks", () => {
  let coord;

  beforeEach(() => {
    coord = new AgentCoordinator();
    coord.maxActiveTasks = 3;
  });

  it("evicts the oldest terminal tasks when over the cap, keeps active", () => {
    coord.activeTasks.set("a", task("a", TASK_STATUS.COMPLETED));
    coord.activeTasks.set("b", task("b", TASK_STATUS.FAILED));
    coord.activeTasks.set("c", task("c", TASK_STATUS.COMPLETED));
    coord.activeTasks.set("d", task("d", TASK_STATUS.RUNNING)); // size 4 > 3

    coord._evictTerminalTasks();

    expect(coord.activeTasks.size).toBe(3);
    expect(coord.activeTasks.has("a")).toBe(false); // oldest terminal evicted
    expect(coord.activeTasks.has("d")).toBe(true); // active kept
  });

  it("never evicts active tasks, even over the cap", () => {
    coord.activeTasks.set("a", task("a", TASK_STATUS.RUNNING));
    coord.activeTasks.set("b", task("b", TASK_STATUS.ASSIGNED));
    coord.activeTasks.set("c", task("c", TASK_STATUS.PENDING));
    coord.activeTasks.set("d", task("d", TASK_STATUS.RUNNING)); // 4 active, > cap 3

    coord._evictTerminalTasks();

    expect(coord.activeTasks.size).toBe(4); // nothing evicted
  });

  it("is a no-op under the cap", () => {
    coord.activeTasks.set("a", task("a", TASK_STATUS.COMPLETED));
    coord.activeTasks.set("b", task("b", TASK_STATUS.RUNNING));
    coord._evictTerminalTasks();
    expect(coord.activeTasks.size).toBe(2);
  });

  it("getTaskStatus returns null shape for an unknown id (no DB) — evicted tasks degrade gracefully", () => {
    const res = coord.getTaskStatus("gone");
    expect(res.success).toBe(false);
  });
});
