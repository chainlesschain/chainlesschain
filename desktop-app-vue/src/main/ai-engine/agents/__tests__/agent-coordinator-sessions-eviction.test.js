import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { AgentCoordinator, TASK_STATUS } = require("../agent-coordinator.js");

function session(id, status) {
  return { id, status, taskDescription: "t" };
}

describe("AgentCoordinator._evictTerminalSessions", () => {
  let coord;

  beforeEach(() => {
    coord = new AgentCoordinator();
    coord.maxOrchestrationSessions = 3;
  });

  it("evicts the oldest terminal sessions over the cap, keeps active", () => {
    coord.orchestrationSessions.set("a", session("a", TASK_STATUS.COMPLETED));
    coord.orchestrationSessions.set("b", session("b", TASK_STATUS.FAILED));
    coord.orchestrationSessions.set("c", session("c", TASK_STATUS.COMPLETED));
    coord.orchestrationSessions.set("d", session("d", TASK_STATUS.RUNNING)); // size 4 > 3

    coord._evictTerminalSessions();

    expect(coord.orchestrationSessions.size).toBe(3);
    expect(coord.orchestrationSessions.has("a")).toBe(false); // oldest terminal evicted
    expect(coord.orchestrationSessions.has("d")).toBe(true); // active kept
  });

  it("never evicts active (running) sessions, even over the cap", () => {
    coord.orchestrationSessions.set("a", session("a", TASK_STATUS.RUNNING));
    coord.orchestrationSessions.set("b", session("b", TASK_STATUS.RUNNING));
    coord.orchestrationSessions.set("c", session("c", TASK_STATUS.RUNNING));
    coord.orchestrationSessions.set("d", session("d", TASK_STATUS.RUNNING));

    coord._evictTerminalSessions();

    expect(coord.orchestrationSessions.size).toBe(4);
  });

  it("is a no-op under the cap", () => {
    coord.orchestrationSessions.set("a", session("a", TASK_STATUS.COMPLETED));
    coord._evictTerminalSessions();
    expect(coord.orchestrationSessions.size).toBe(1);
  });
});
