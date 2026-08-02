import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testDir = join(
  tmpdir(),
  `cc-bg-session-budget-${process.pid}-${Date.now()}`,
);

vi.mock("../../src/lib/paths.js", () => ({
  getHomeDir: () => testDir,
}));

const { _deps, BackgroundTaskManager, TaskStatus } =
  await import("../../src/lib/background-task-manager.js");
const { SessionResourceBudget } =
  await import("../../src/lib/session-resource-budget.js");

const original = {
  spawn: _deps.spawn,
  platform: _deps.platform,
  killProcessTree: _deps.killProcessTree,
};

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

describe("BackgroundTaskManager session budget", () => {
  let manager;
  let budget;

  beforeEach(() => {
    mkdirSync(join(testDir, "tasks"), { recursive: true });
    _deps.platform = "linux";
  });

  afterEach(() => {
    manager?.destroy();
    budget?.dispose();
    _deps.spawn = original.spawn;
    _deps.platform = original.platform;
    _deps.killProcessTree = original.killProcessTree;
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it("shares the session concurrency cap across background launches", () => {
    budget = new SessionResourceBudget({
      maxConcurrent: 1,
      maxSpawns: 3,
    });
    const children = [fakeChild(7001), fakeChild(7002)];
    _deps.spawn = vi.fn(() => children.shift());
    _deps.killProcessTree = vi.fn(() => true);
    manager = new BackgroundTaskManager({ sessionBudget: budget });
    const first = manager.create({ command: "first" });
    const second = manager.create({ command: "second" });

    manager.start(first.id);
    expect(() => manager.start(second.id)).toThrow(
      expect.objectContaining({
        code: "ERR_SESSION_RESOURCE_BUDGET",
        budgetReason: "max-concurrent",
      }),
    );
    expect(second.status).toBe(TaskStatus.PENDING);
    expect(_deps.spawn).toHaveBeenCalledTimes(1);

    manager.processes.get(first.id).emit("exit", 0);
    manager.start(second.id);
    expect(_deps.spawn).toHaveBeenCalledTimes(2);
    expect(budget.status()).toMatchObject({ active: 1, spawns: 2 });
  });

  it("kills the owned process tree immediately when a live budget is exhausted", () => {
    budget = new SessionResourceBudget({ maxTokens: 5 });
    const child = fakeChild(8001);
    const tree = { workerAlive: true, descendantAlive: true };
    _deps.spawn = vi.fn(() => child);
    _deps.killProcessTree = vi.fn(() => {
      tree.workerAlive = false;
      tree.descendantAlive = false;
      return true;
    });
    manager = new BackgroundTaskManager({
      sessionBudget: budget,
      killGraceMs: 60_000,
    });
    const task = manager.run({ command: "long-running" });
    expect(budget.status()).toMatchObject({ active: 1, resources: 1 });

    budget.recordUsage({ usage: { input_tokens: 5 } });

    expect(_deps.killProcessTree).toHaveBeenCalledWith(child, "SIGTERM");
    expect(tree).toEqual({ workerAlive: false, descendantAlive: false });
    expect(task).toMatchObject({
      status: TaskStatus.FAILED,
      error: "Session budget exhausted: max-tokens",
    });
    expect(
      task.history.some((entry) => entry.event === "budget-stop-requested"),
    ).toBe(true);
    expect(budget.status()).toMatchObject({
      active: 0,
      resources: 0,
      reason: "max-tokens",
    });
    child.exitCode = 1;
  });

  it("does not refresh the total-spawn cap after a task settles", () => {
    budget = new SessionResourceBudget({ maxSpawns: 1 });
    const child = fakeChild(9001);
    _deps.spawn = vi.fn(() => child);
    _deps.killProcessTree = vi.fn(() => true);
    manager = new BackgroundTaskManager({ sessionBudget: budget });
    const first = manager.run({ command: "first" });
    child.emit("exit", 0);
    expect(first.status).toBe(TaskStatus.COMPLETED);
    const second = manager.create({ command: "second" });

    expect(() => manager.start(second.id)).toThrow(
      expect.objectContaining({ budgetReason: "max-spawns" }),
    );
    expect(second.status).toBe(TaskStatus.PENDING);
    expect(_deps.spawn).toHaveBeenCalledTimes(1);
  });
});
