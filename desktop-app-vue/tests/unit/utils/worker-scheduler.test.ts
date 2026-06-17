/**
 * worker-scheduler 测试 — src/renderer/utils/worker-scheduler.ts
 *
 * PriorityMap constant, WorkerPool construction/stats, and TaskScheduler
 * registration/lookup/terminate. WorkerPool eagerly spawns `new Worker`, absent
 * in jsdom, so a minimal global Worker stub is installed. The message-driven
 * execute() round-trip is out of scope (no real worker results). logger mocked.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

class FakeWorker {
  script: string | URL;
  constructor(script: string | URL) {
    this.script = script;
  }
  addEventListener() {}
  removeEventListener() {}
  postMessage() {}
  terminate() {}
}

const originalWorker = (globalThis as any).Worker;
beforeAll(() => {
  (globalThis as any).Worker = FakeWorker;
});
afterAll(() => {
  (globalThis as any).Worker = originalWorker;
});

import { PriorityMap, WorkerPool, TaskScheduler } from "@/utils/worker-scheduler";

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

  it("terminate clears all pools", () => {
    const s = new TaskScheduler();
    s.registerPool("a", "worker.js", { size: 1 });
    s.terminate();
    expect(s.getPool("a")).toBeUndefined();
    expect(s.getAllStats()).toEqual({});
  });
});
