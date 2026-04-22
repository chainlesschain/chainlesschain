import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const {
  AUTONOMOUS_CHANNELS,
  AUTONOMOUS_FORWARD_EVENTS,
  createRendererSender,
  registerAutonomousIPC,
  unregisterAutonomousIPC,
} = require("../../../../src/main/ai-engine/autonomous/autonomous-ipc.js");

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn((channel) => {
      delete handlers[channel];
    }),
  };
}

function createRunner() {
  const runner = new EventEmitter();
  runner.initialized = true;
  runner.submitGoal = vi.fn().mockResolvedValue({ success: true, goalId: "goal-1" });
  runner.pauseGoal = vi.fn().mockResolvedValue({ success: true, paused: true });
  runner.resumeGoal = vi.fn().mockResolvedValue({ success: true, resumed: true });
  runner.cancelGoal = vi.fn().mockResolvedValue({ success: true, cancelled: true });
  runner.provideUserInput = vi
    .fn()
    .mockResolvedValue({ success: true, accepted: true });
  runner.getGoalStatus = vi
    .fn()
    .mockResolvedValue({ success: true, data: { status: "running" } });
  runner.getActiveGoals = vi.fn().mockResolvedValue({ success: true, data: [] });
  runner.getGoalHistory = vi
    .fn()
    .mockResolvedValue({ success: true, data: [{ id: "goal-1" }] });
  runner.getGoalSteps = vi
    .fn()
    .mockResolvedValue({ success: true, data: [{ id: "step-1" }] });
  runner.updateConfig = vi.fn().mockReturnValue({ success: true, updated: true });
  runner.getConfig = vi.fn().mockReturnValue({ success: true, maxConcurrent: 3 });
  runner.getStats = vi.fn().mockResolvedValue({ success: true, totals: { completed: 1 } });
  runner.clearHistory = vi.fn().mockResolvedValue({ success: true, deleted: 4 });
  runner.exportGoal = vi.fn().mockResolvedValue({ success: true, path: "/tmp/goal.json" });
  runner.retryGoal = vi.fn().mockResolvedValue({ success: true, goalId: "goal-2" });
  runner.getGoalLogs = vi
    .fn()
    .mockResolvedValue({ success: true, data: [{ level: "info" }] });
  return runner;
}

describe("autonomous-ipc", () => {
  let ipcMainMock;
  let runner;
  let taskQueue;
  let sendToRenderer;

  beforeEach(() => {
    ipcMainMock = createMockIpcMain();
    runner = createRunner();
    taskQueue = {
      initialized: true,
      getQueueStatus: vi.fn().mockResolvedValue({
        success: true,
        data: { pending: 1, active: 1 },
      }),
    };
    sendToRenderer = vi.fn();

    registerAutonomousIPC({
      runner,
      taskQueue,
      ipcMain: ipcMainMock,
      sendToRenderer,
    });
  });

  it("registers all channels, removes stale handlers, and wires event forwarders", () => {
    expect(Object.keys(ipcMainMock.handlers)).toHaveLength(AUTONOMOUS_CHANNELS.length);
    expect(ipcMainMock.removeHandler).toHaveBeenCalledTimes(AUTONOMOUS_CHANNELS.length);

    AUTONOMOUS_FORWARD_EVENTS.forEach((eventName) => {
      runner.emit(eventName, { id: eventName });
    });

    expect(sendToRenderer).toHaveBeenCalledTimes(AUTONOMOUS_FORWARD_EVENTS.length);
    expect(sendToRenderer).toHaveBeenCalledWith("agent:goal-progress", {
      id: "goal-progress",
    });
  });

  it("supports alias dependency names used by the phase registry", () => {
    const aliasIpc = createMockIpcMain();
    const result = registerAutonomousIPC({
      autonomousRunner: runner,
      agentTaskQueue: taskQueue,
      ipcMain: aliasIpc,
      sendToRenderer,
    });

    expect(result.handlerCount).toBe(AUTONOMOUS_CHANNELS.length);
    expect(Object.keys(aliasIpc.handlers)).toHaveLength(AUTONOMOUS_CHANNELS.length);
  });

  it("returns early when runner is missing", () => {
    const emptyIpc = createMockIpcMain();
    const result = registerAutonomousIPC({ ipcMain: emptyIpc });

    expect(result).toEqual({ handlerCount: 0, forwarderCount: 0 });
    expect(Object.keys(emptyIpc.handlers)).toHaveLength(0);
  });

  it("delegates goal lifecycle handlers to the runner", async () => {
    await expect(
      ipcMainMock.handlers["agent:submit-goal"]({}, { title: "Ship" }),
    ).resolves.toEqual({
      success: true,
      goalId: "goal-1",
    });
    expect(runner.submitGoal).toHaveBeenCalledWith({ title: "Ship" });

    await expect(
      ipcMainMock.handlers["agent:pause-goal"]({}, "goal-1"),
    ).resolves.toEqual({
      success: true,
      paused: true,
    });
    await expect(
      ipcMainMock.handlers["agent:resume-goal"]({}, "goal-1"),
    ).resolves.toEqual({
      success: true,
      resumed: true,
    });
    await expect(
      ipcMainMock.handlers["agent:cancel-goal"]({}, "goal-1"),
    ).resolves.toEqual({
      success: true,
      cancelled: true,
    });
    await expect(
      ipcMainMock.handlers["agent:provide-input"]({}, {
        goalId: "goal-1",
        input: "continue",
      }),
    ).resolves.toEqual({
      success: true,
      accepted: true,
    });
    await expect(
      ipcMainMock.handlers["agent:get-goal-status"]({}, "goal-1"),
    ).resolves.toEqual({
      success: true,
      data: { status: "running" },
    });
    await expect(ipcMainMock.handlers["agent:get-active-goals"]({})).resolves.toEqual({
      success: true,
      data: [],
    });
    await expect(
      ipcMainMock.handlers["agent:get-goal-history"]({}, { limit: 10, offset: 5 }),
    ).resolves.toEqual({
      success: true,
      data: [{ id: "goal-1" }],
    });
    expect(runner.getGoalHistory).toHaveBeenCalledWith(10, 5);

    await expect(
      ipcMainMock.handlers["agent:get-goal-steps"]({}, "goal-1"),
    ).resolves.toEqual({
      success: true,
      data: [{ id: "step-1" }],
    });
  });

  it("handles queue/config/statistics/history/export/retry/logs handlers", async () => {
    await expect(ipcMainMock.handlers["agent:get-queue-status"]({})).resolves.toEqual({
      success: true,
      data: { pending: 1, active: 1 },
    });
    expect(taskQueue.getQueueStatus).toHaveBeenCalled();

    await expect(
      ipcMainMock.handlers["agent:update-config"]({}, { maxConcurrent: 5 }),
    ).resolves.toEqual({
      success: true,
      updated: true,
    });
    expect(runner.updateConfig).toHaveBeenCalledWith({ maxConcurrent: 5 });

    await expect(ipcMainMock.handlers["agent:get-config"]({})).resolves.toEqual({
      success: true,
      maxConcurrent: 3,
    });
    await expect(ipcMainMock.handlers["agent:get-stats"]({})).resolves.toEqual({
      success: true,
      totals: { completed: 1 },
    });
    await expect(
      ipcMainMock.handlers["agent:clear-history"]({}, { before: "2026-01-01" }),
    ).resolves.toEqual({
      success: true,
      deleted: 4,
    });
    expect(runner.clearHistory).toHaveBeenCalledWith("2026-01-01");

    await expect(
      ipcMainMock.handlers["agent:export-goal"]({}, "goal-1"),
    ).resolves.toEqual({
      success: true,
      path: "/tmp/goal.json",
    });
    await expect(
      ipcMainMock.handlers["agent:retry-goal"]({}, "goal-1"),
    ).resolves.toEqual({
      success: true,
      goalId: "goal-2",
    });
    await expect(
      ipcMainMock.handlers["agent:get-goal-logs"]({}, { goalId: "goal-1" }),
    ).resolves.toEqual({
      success: true,
      data: [{ level: "info" }],
    });
    expect(runner.getGoalLogs).toHaveBeenCalledWith("goal-1", 100);
  });

  it("returns a fallback queue snapshot when task queue is unavailable", async () => {
    const fallbackIpc = createMockIpcMain();
    registerAutonomousIPC({
      runner,
      taskQueue: { initialized: false, getQueueStatus: vi.fn() },
      ipcMain: fallbackIpc,
      sendToRenderer,
    });

    const result = await fallbackIpc.handlers["agent:get-queue-status"]({});
    expect(result).toEqual({
      success: true,
      data: {
        pending: 0,
        active: 0,
        total: 0,
        maxConcurrent: 3,
        canAcceptMore: true,
        byPriority: {},
        items: [],
        historical: { totalProcessed: 0, totalCompleted: 0, totalFailed: 0 },
      },
    });
  });

  it("guards runner-dependent handlers when the runner is not initialized", async () => {
    runner.initialized = false;

    const result = await ipcMainMock.handlers["agent:submit-goal"]({}, { title: "Ship" });
    expect(result).toEqual({
      success: false,
      error: "AutonomousAgentRunner not initialized",
    });
    expect(runner.submitGoal).not.toHaveBeenCalled();
  });

  it("validates and aggregates batch cancellation requests", async () => {
    await expect(ipcMainMock.handlers["agent:batch-cancel"]({}, [])).resolves.toEqual({
      success: false,
      error: "goalIds must be a non-empty array",
    });

    runner.cancelGoal
      .mockResolvedValueOnce({ success: true, cancelled: true })
      .mockRejectedValueOnce(new Error("boom"));

    const result = await ipcMainMock.handlers["agent:batch-cancel"]({}, [
      "goal-1",
      "goal-2",
    ]);

    expect(result).toEqual({
      success: true,
      data: {
        results: [
          { goalId: "goal-1", success: true, cancelled: true },
          { goalId: "goal-2", success: false, error: "boom" },
        ],
        totalRequested: 2,
        totalCancelled: 1,
      },
    });
  });

  it("normalizes thrown handler errors", async () => {
    runner.getStats.mockRejectedValueOnce(new Error("stats failed"));

    const result = await ipcMainMock.handlers["agent:get-stats"]({});
    expect(result).toEqual({
      success: false,
      error: "stats failed",
    });
  });

  it("createRendererSender only sends to healthy windows", () => {
    const goodSend = vi.fn();
    const sender = createRendererSender(() => [
      {
        isDestroyed: () => false,
        webContents: { send: goodSend },
      },
      {
        isDestroyed: () => true,
        webContents: { send: vi.fn() },
      },
      null,
    ]);

    sender("agent:goal-progress", { goalId: "goal-1" });
    expect(goodSend).toHaveBeenCalledWith("agent:goal-progress", {
      goalId: "goal-1",
    });
  });

  it("tolerates IPC cleanup and renderer send edge cases", () => {
    const noRemoveIpc = {
      handlers: {},
      handle: vi.fn((channel, handler) => {
        noRemoveIpc.handlers[channel] = handler;
      }),
    };
    expect(() =>
      registerAutonomousIPC({
        runner,
        taskQueue,
        ipcMain: noRemoveIpc,
        sendToRenderer,
      }),
    ).not.toThrow();

    const throwingRemoveIpc = {
      handle: vi.fn(),
      removeHandler: vi.fn(() => {
        throw new Error("missing");
      }),
    };
    expect(() =>
      registerAutonomousIPC({
        runner,
        taskQueue,
        ipcMain: throwingRemoveIpc,
        sendToRenderer,
      }),
    ).not.toThrow();

    const sender = createRendererSender(() => {
      throw new Error("window list unavailable");
    });
    expect(() => sender("agent:goal-progress", { goalId: "goal-1" })).not.toThrow();
  });

  it("unregisters all autonomous handlers", () => {
    const testIpc = createMockIpcMain();
    unregisterAutonomousIPC({ ipcMain: testIpc });
    expect(testIpc.removeHandler).toHaveBeenCalledTimes(AUTONOMOUS_CHANNELS.length);
  });
});
