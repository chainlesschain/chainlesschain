/**
 * worker-scheduler 测试 — src/renderer/utils/worker-scheduler.ts
 *
 * PriorityMap constant, WorkerPool admission/lifecycle, and TaskScheduler
 * registration/recurring-task bounds. WorkerPool eagerly spawns `new Worker`,
 * absent in jsdom, so a minimal global Worker stub is installed. logger mocked.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

class FakeWorker {
  static instances: FakeWorker[] = [];
  static throwOnPost = false;

  script: string | URL;
  terminated = false;

  constructor(script: string | URL) {
    this.script = script;
    FakeWorker.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  postMessage() {
    if (FakeWorker.throwOnPost) {
      throw new Error("postMessage failed");
    }
  }
  terminate() {
    this.terminated = true;
  }
}

const originalWorker = (globalThis as any).Worker;
beforeAll(() => {
  (globalThis as any).Worker = FakeWorker;
});
afterAll(() => {
  (globalThis as any).Worker = originalWorker;
});
afterEach(() => {
  vi.useRealTimers();
  FakeWorker.instances = [];
  FakeWorker.throwOnPost = false;
});

import {
  HARD_WORKER_SCHEDULER_LIMITS,
  PriorityMap,
  WorkerPool,
  TaskScheduler,
} from "@/utils/worker-scheduler";

describe("worker-scheduler — PriorityMap", () => {
  it("maps named priorities to weights", () => {
    expect(PriorityMap).toEqual({ high: 3, normal: 2, low: 1 });
  });
});

describe("worker-scheduler — WorkerPool", () => {
  it("creates the requested number of workers and reports stats", () => {
    const pool = new WorkerPool("worker.js", { size: 2 });
    try {
      expect(pool.getStats()).toMatchObject({
        total: 2,
        available: 2,
        busy: 0,
        queued: 0,
      });
    } finally {
      pool.terminate();
    }
  });

  it("clamps oversized worker and queue configuration", () => {
    const pool = new WorkerPool("worker.js", {
      size: Number.MAX_SAFE_INTEGER,
      maxTasks: Number.MAX_SAFE_INTEGER,
    });
    try {
      expect(pool.getStats().total).toBe(
        HARD_WORKER_SCHEDULER_LIMITS.maxWorkers,
      );
    } finally {
      pool.terminate();
    }
  });

  it("rejects overload and settles queued and active tasks on termination", async () => {
    const pool = new WorkerPool("worker.js", { size: 1, maxTasks: 2 });
    const active = pool.execute({ id: 1 });
    const queuedA = pool.execute({ id: 2 });
    const queuedB = pool.execute({ id: 3 });
    const overloaded = pool.execute({ id: 4 });

    const overloadCheck = expect(overloaded).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "worker_tasks",
      limit: { maxQueuedTasks: 2 },
    });
    const cancellationChecks = [active, queuedA, queuedB].map((task) =>
      expect(task).rejects.toMatchObject({
        code: "CANCELED",
        scope: "worker_pool",
      }),
    );

    pool.terminate();

    await overloadCheck;
    await Promise.all(cancellationChecks);
    expect(pool.getStats()).toMatchObject({
      total: 0,
      available: 0,
      busy: 0,
      queued: 0,
    });
  });

  it("keeps a single replacement worker available after timeout", async () => {
    vi.useFakeTimers();
    const pool = new WorkerPool("worker.js", { size: 1 });
    const task = pool.execute({}, { timeout: 1 });
    const rejection = expect(task).rejects.toThrow("Task timeout");

    await vi.advanceTimersByTimeAsync(2);
    await rejection;

    expect(pool.getStats()).toMatchObject({
      total: 1,
      available: 1,
      busy: 0,
      queued: 0,
    });
    expect(FakeWorker.instances[0].terminated).toBe(true);
    pool.terminate();
  });

  it("releases a worker when postMessage throws", async () => {
    FakeWorker.throwOnPost = true;
    const pool = new WorkerPool("worker.js", { size: 1 });

    await expect(pool.execute({})).rejects.toThrow("postMessage failed");
    expect(pool.getStats()).toMatchObject({
      total: 1,
      available: 1,
      busy: 0,
      queued: 0,
    });
    pool.terminate();
  });
});

describe("worker-scheduler — TaskScheduler", () => {
  it("throws when scheduling on an unknown pool", async () => {
    const s = new TaskScheduler();
    await expect(s.schedule("nope", {})).rejects.toThrow(/not found/);
  });

  it("getPool/getAllStats are empty before registration", () => {
    const s = new TaskScheduler();
    expect(s.getPool("x")).toBeUndefined();
    expect(s.getAllStats()).toEqual({});
  });

  it("registerPool creates a pool; duplicate registration is a no-op", () => {
    const s = new TaskScheduler();
    try {
      s.registerPool("compute", "worker.js", { size: 1 });
      expect(s.getPool("compute")).toBeDefined();
      expect(s.getAllStats().compute).toMatchObject({ total: 1 });
      s.registerPool("compute", "worker.js", { size: 4 }); // ignored
      expect(s.getAllStats().compute.total).toBe(1); // still the first pool
    } finally {
      s.terminate();
    }
  });

  it("bounds pool registration and validates names", () => {
    const s = new TaskScheduler({ maxPools: 2, maxPoolNameChars: 4 });
    try {
      expect(s.registerPool("a", "worker.js", { size: 1 })).toMatchObject({
        accepted: true,
      });
      expect(s.registerPool("b", "worker.js", { size: 1 })).toMatchObject({
        accepted: true,
      });
      expect(s.registerPool("c", "worker.js", { size: 1 })).toMatchObject({
        accepted: false,
        code: "OVERLOADED",
        limit: { maxPools: 2 },
      });
      expect(s.registerPool("abcde", "worker.js")).toMatchObject({
        accepted: false,
        code: "INVALID_ARGUMENT",
        limit: { maxPoolNameChars: 4 },
      });
      expect(s.registerPool(123 as any, "worker.js")).toMatchObject({
        accepted: false,
        code: "INVALID_ARGUMENT",
      });
    } finally {
      s.terminate();
    }
  });

  it("bounds recurring tasks and prevents overlapping executions", async () => {
    vi.useFakeTimers();
    const s = new TaskScheduler({
      maxRecurringTasks: 1,
      minRecurringIntervalMs: 100,
    });
    s.registerPool("a", "worker.js", { size: 1 });

    const taskId = s.scheduleRecurring("a", {}, 1);
    const scheduledTask = (s as any).scheduledTasks.get(taskId);
    expect(scheduledTask.interval).toBe(100);
    expect(() => s.scheduleRecurring("a", {}, 100)).toThrowError(
      expect.objectContaining({
        code: "OVERLOADED",
        scope: "worker_recurring_tasks",
      }),
    );

    await vi.advanceTimersByTimeAsync(350);
    expect(scheduledTask.running).toBe(true);
    expect(scheduledTask.skippedRuns).toBe(3);

    s.cancelRecurring(taskId);
    s.terminate();
    await Promise.resolve();
  });

  it("returns structured cancellation after termination", async () => {
    const s = new TaskScheduler();
    s.terminate();

    expect(s.registerPool("a", "worker.js")).toMatchObject({
      accepted: false,
      code: "CANCELED",
      scope: "worker_scheduler",
    });
    await expect(s.schedule("a", {})).rejects.toMatchObject({
      code: "CANCELED",
      scope: "worker_scheduler",
    });
  });

  it("terminate clears all pools", () => {
    const s = new TaskScheduler();
    s.registerPool("a", "worker.js", { size: 1 });
    s.terminate();
    expect(s.getPool("a")).toBeUndefined();
    expect(s.getAllStats()).toEqual({});
  });
});
