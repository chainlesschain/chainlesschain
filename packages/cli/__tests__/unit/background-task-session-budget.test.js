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
    vi.useRealTimers();
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

    const firstChild = manager.processes.get(first.id);
    firstChild.emit("message", { type: "result", data: "done" });
    expect(first.status).toBe(TaskStatus.COMPLETED);
    expect(budget.status()).toMatchObject({ active: 1, resources: 1 });
    expect(() => manager.start(second.id)).toThrow(
      expect.objectContaining({ budgetReason: "max-concurrent" }),
    );

    firstChild.exitCode = 0;
    firstChild.emit("exit", 0);
    expect(budget.status()).toMatchObject({ active: 0, resources: 0 });
    manager.start(second.id);
    expect(_deps.spawn).toHaveBeenCalledTimes(2);
    expect(budget.status()).toMatchObject({ active: 1, spawns: 2 });
  });

  it("kills the owned process tree immediately when a live budget is exhausted", () => {
    budget = new SessionResourceBudget({ maxTokens: 5 });
    const child = fakeChild(8001);
    _deps.spawn = vi.fn(() => child);
    _deps.killProcessTree = vi.fn(() => true);
    manager = new BackgroundTaskManager({
      sessionBudget: budget,
      killGraceMs: 60_000,
    });
    const task = manager.run({ command: "long-running" });
    expect(budget.status()).toMatchObject({ active: 1, resources: 1 });

    budget.recordUsage({ usage: { input_tokens: 5 } });

    expect(_deps.killProcessTree).toHaveBeenCalledWith(child, "SIGTERM");
    expect(task).toMatchObject({
      status: TaskStatus.FAILED,
      error: "Session budget exhausted: max-tokens",
    });
    expect(
      task.history.some((entry) => entry.event === "budget-stop-requested"),
    ).toBe(true);
    expect(budget.status()).toMatchObject({
      active: 1,
      resources: 0,
      reason: "max-tokens",
    });
    expect(manager.processes.get(task.id)).toBe(child);
    expect(manager._budgetLeases.size).toBe(1);
    expect(manager._budgetAbortCleanup.size).toBe(1);

    child.exitCode = 1;
    child.emit("exit", 1);
    expect(budget.status()).toMatchObject({ active: 0, resources: 0 });
    expect(manager._budgetLeases.size).toBe(0);
    expect(manager._budgetAbortCleanup.size).toBe(0);
  });

  it("keeps a stopped live worker against maxConcurrent until exit", () => {
    budget = new SessionResourceBudget({ maxConcurrent: 1, maxSpawns: 3 });
    const children = [fakeChild(8101), fakeChild(8102)];
    _deps.spawn = vi.fn(() => children.shift());
    _deps.killProcessTree = vi.fn(() => true);
    manager = new BackgroundTaskManager({
      sessionBudget: budget,
      killGraceMs: 60_000,
    });
    const first = manager.create({ command: "first" });
    const second = manager.create({ command: "second" });
    manager.start(first.id);
    const firstChild = manager.processes.get(first.id);

    manager.stop(first.id);

    expect(first).toMatchObject({
      status: TaskStatus.FAILED,
      error: "Stopped by user",
    });
    expect(budget.status()).toMatchObject({ active: 1, resources: 1 });
    expect(() => manager.start(second.id)).toThrow(
      expect.objectContaining({ budgetReason: "max-concurrent" }),
    );

    firstChild.exitCode = 1;
    firstChild.emit("exit", 1);
    expect(budget.status()).toMatchObject({ active: 0, resources: 0 });
    manager.start(second.id);
  });

  it("keeps a heartbeat-timed-out worker against maxConcurrent until exit", () => {
    vi.useFakeTimers();
    budget = new SessionResourceBudget({ maxConcurrent: 1, maxSpawns: 3 });
    const children = [fakeChild(8201), fakeChild(8202)];
    _deps.spawn = vi.fn(() => children.shift());
    _deps.killProcessTree = vi.fn(() => true);
    manager = new BackgroundTaskManager({
      sessionBudget: budget,
      heartbeatTimeout: 10,
    });
    const first = manager.create({ command: "first" });
    const second = manager.create({ command: "second" });
    manager.start(first.id);
    const firstChild = manager.processes.get(first.id);

    vi.advanceTimersByTime(15);

    expect(first).toMatchObject({
      status: TaskStatus.TIMEOUT,
      error: "Heartbeat timeout",
    });
    expect(_deps.killProcessTree).toHaveBeenCalledWith(firstChild, "SIGKILL");
    expect(budget.status()).toMatchObject({ active: 1, resources: 1 });
    expect(() => manager.start(second.id)).toThrow(
      expect.objectContaining({ budgetReason: "max-concurrent" }),
    );

    firstChild.exitCode = 1;
    firstChild.emit("exit", 1);
    expect(budget.status()).toMatchObject({ active: 0, resources: 0 });
    manager.start(second.id);
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
