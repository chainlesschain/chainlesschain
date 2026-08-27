vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const {
  getProgressEmitterInstance,
  registerProgressEmitterIPC,
  unregisterProgressEmitterIPC,
} = require("../../../src/main/utils/progress-emitter-ipc.js");

function createHarness(progressEmitterConfig = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler)),
    removeHandler: vi.fn((channel) => handlers.delete(channel)),
  };
  const ipcGuard = {
    registered: false,
    isModuleRegistered: vi.fn(() => ipcGuard.registered),
    markModuleRegistered: vi.fn(() => {
      ipcGuard.registered = true;
    }),
    unmarkModuleRegistered: vi.fn(() => {
      ipcGuard.registered = false;
    }),
  };
  registerProgressEmitterIPC({
    ipcMain,
    ipcGuard,
    progressEmitterConfig,
  });
  return {
    handlers,
    invoke: (channel, ...args) => handlers.get(channel)({}, ...args),
    ipcGuard,
    ipcMain,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded progress emitter IPC", () => {
  it("returns structured overload metadata and evicts retained terminal tasks", async () => {
    const harness = createHarness({ maxTasks: 2 });
    try {
      expect(await harness.invoke("progress:create-task", "one")).toMatchObject(
        {
          success: true,
        },
      );
      expect(await harness.invoke("progress:create-task", "two")).toMatchObject(
        {
          success: true,
        },
      );
      expect(
        await harness.invoke("progress:create-task", "overflow"),
      ).toMatchObject({
        success: false,
        code: "OVERLOADED",
        scope: "progress_tasks",
        limit: { maxTasks: 2 },
      });

      expect(await harness.invoke("progress:complete", "one")).toMatchObject({
        success: true,
        stage: "completed",
      });
      expect(
        await harness.invoke("progress:create-task", "replacement"),
      ).toMatchObject({ success: true });

      const config = await harness.invoke("progress:get-config");
      expect(config).toMatchObject({
        success: true,
        trackerCount: 2,
        boundary: {
          taskCount: 2,
          cleanupTimerCount: 0,
          limits: { maxTasks: 2 },
        },
      });
    } finally {
      unregisterProgressEmitterIPC(harness);
    }
  });

  it("bounds IDs and keeps terminal cleanup timers visible and clearable", async () => {
    const harness = createHarness({
      maxTaskIdBytes: 4,
      maxResultBytes: 8,
    });
    try {
      expect(
        await harness.invoke("progress:create-task", "你好"),
      ).toMatchObject({
        success: false,
        code: "OVERLOADED",
        scope: "progress_task_id",
      });

      await harness.invoke("progress:create-task", "ok");
      await harness.invoke("progress:complete", "ok", {
        value: "oversized",
      });
      expect(
        (await harness.invoke("progress:get-config")).boundary,
      ).toMatchObject({
        taskCount: 1,
        cleanupTimerCount: 1,
        droppedPayloads: 1,
      });

      expect(await harness.invoke("progress:clear-all")).toMatchObject({
        success: true,
        clearedCount: 1,
      });
      expect(getProgressEmitterInstance().getStats()).toMatchObject({
        taskCount: 0,
        cleanupTimerCount: 0,
      });
    } finally {
      unregisterProgressEmitterIPC(harness);
    }
  });

  it("releases IPC trackers when hierarchical cleanup removes tasks", async () => {
    const harness = createHarness();
    try {
      await harness.invoke("progress:create-task", "parent");
      await harness.invoke("progress:create-task", "child", {
        parentTaskId: "parent",
      });
      await harness.invoke("progress:complete", "child");

      expect((await harness.invoke("progress:get-config")).trackerCount).toBe(
        1,
      );
      vi.advanceTimersByTime(5000);

      expect(await harness.invoke("progress:get-config")).toMatchObject({
        trackerCount: 0,
        boundary: {
          taskCount: 0,
          cleanupTimerCount: 0,
        },
      });
    } finally {
      unregisterProgressEmitterIPC(harness);
    }
  });
});
