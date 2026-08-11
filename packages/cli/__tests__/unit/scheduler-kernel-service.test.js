import { describe, expect, it, vi } from "vitest";
import {
  MAX_SERVICE_SUMMARIES,
  SchedulerService,
  createSchedulerService,
} from "../../src/lib/scheduler-kernel/service.js";

describe("scheduler kernel service", () => {
  it("runs registered domains in stable order and emits bounded lifecycle events", async () => {
    let time = 100;
    const calls = [];
    const events = [];
    const service = createSchedulerService({
      drivers: [
        {
          name: "agenda",
          run: async ({ tick }) => {
            calls.push(`agenda:${tick}`);
            return { due: 1 };
          },
        },
        {
          name: "cowork",
          run: async ({ tick }) => {
            calls.push(`cowork:${tick}`);
            return [];
          },
        },
      ],
      now: () => time++,
      onEvent: (event) => events.push(event),
    });

    const result = await service.runOnce();

    expect(result).toMatchObject({
      status: "succeeded",
      tick: 1,
      results: [
        { driver: "agenda", status: "succeeded", value: { due: 1 } },
        { driver: "cowork", status: "succeeded", value: [] },
      ],
    });
    expect(calls).toEqual(["agenda:1", "cowork:1"]);
    expect(events.map((event) => event.type)).toEqual([
      "scheduler-tick-started",
      "scheduler-driver-completed",
      "scheduler-driver-completed",
      "scheduler-tick-completed",
    ]);
  });

  it("serializes concurrent ticks instead of overlapping driver side effects", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => gate);
    const service = new SchedulerService({
      drivers: [{ name: "agenda", run }],
    });

    const first = service.runOnce();
    const second = service.runOnce();
    expect(second).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);

    release({ due: 0 });
    await expect(first).resolves.toMatchObject({
      status: "succeeded",
      tick: 1,
    });
    await service.runOnce();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("isolates a failed domain and marks the tick visibly degraded", async () => {
    const cowork = vi.fn(async () => ["completed"]);
    const service = new SchedulerService({
      drivers: [
        {
          name: "agenda",
          run: async () => {
            const error = new Error("policy unavailable");
            error.code = "AGENDA_POLICY_UNAVAILABLE";
            throw error;
          },
        },
        { name: "cowork", run: cowork },
      ],
    });

    const result = await service.runOnce();

    expect(result).toMatchObject({
      status: "degraded",
      results: [
        {
          driver: "agenda",
          status: "failed",
          error: {
            code: "AGENDA_POLICY_UNAVAILABLE",
            message: "policy unavailable",
          },
        },
        { driver: "cowork", status: "succeeded" },
      ],
    });
    expect(cowork).toHaveBeenCalledTimes(1);
  });

  it("runs a bounded resident loop without overlapping ticks", async () => {
    const run = vi.fn(async ({ tick }) => tick);
    const sleep = vi.fn(async () => {});
    const service = new SchedulerService({
      drivers: [{ name: "agenda", run }],
      sleep,
    });

    const result = await service.run({ intervalMs: 250, maxTicks: 3 });

    expect(result).toMatchObject({ status: "succeeded", ticks: 3 });
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("bounds retained summaries for long-running services", async () => {
    const service = new SchedulerService({
      drivers: [{ name: "agenda", run: ({ tick }) => tick }],
      sleep: async () => {},
    });

    const result = await service.run({
      intervalMs: 250,
      maxTicks: MAX_SERVICE_SUMMARIES + 2,
    });

    expect(result.ticks).toBe(MAX_SERVICE_SUMMARIES + 2);
    expect(result.omittedSummaries).toBe(2);
    expect(result.summaries).toHaveLength(MAX_SERVICE_SUMMARIES);
    expect(result.summaries[0].tick).toBe(3);
  });

  it("stops before a tick when already aborted and disposes resources once", async () => {
    const run = vi.fn();
    const close = vi.fn();
    const dispose = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const service = new SchedulerService({
      drivers: [{ name: "agenda", run, close }],
      dispose,
    });

    await expect(
      service.run({ intervalMs: 250, signal: controller.signal }),
    ).resolves.toMatchObject({ status: "aborted", ticks: 0 });
    expect(run).not.toHaveBeenCalled();

    await service.close();
    await service.close();
    expect(close).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("waits for an active tick before closing drivers and shared resources", async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const lifecycle = [];
    const service = new SchedulerService({
      drivers: [
        {
          name: "agenda",
          run: async () => {
            lifecycle.push("run:start");
            await gate;
            lifecycle.push("run:end");
          },
          close: async () => lifecycle.push("driver:close"),
        },
      ],
      dispose: async () => lifecycle.push("store:close"),
    });

    const tick = service.runOnce();
    const closing = service.close();
    await Promise.resolve();
    expect(lifecycle).toEqual(["run:start"]);

    release();
    await Promise.all([tick, closing]);
    expect(lifecycle).toEqual([
      "run:start",
      "run:end",
      "driver:close",
      "store:close",
    ]);
  });

  it("rejects duplicate drivers and unsafe timer bounds", async () => {
    expect(
      () =>
        new SchedulerService({
          drivers: [
            { name: "agenda", run() {} },
            { name: "agenda", run() {} },
          ],
        }),
    ).toThrow(/more than once/u);

    const service = new SchedulerService({
      drivers: [{ name: "agenda", run() {} }],
    });
    await expect(service.run({ intervalMs: 249, once: true })).rejects.toThrow(
      /intervalMs/u,
    );
  });
});
