import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOOP_AGENT_CAPABILITY,
  LOOP_PROCESS_CAPABILITY,
  LoopSchedulerBridge,
  buildLoopSchedulerJob,
  enqueueLoopIteration,
  loopExecutionDigest,
  loopExecutionSnapshot,
} from "../../src/lib/scheduler-kernel/loop-adapter.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel Loop adapter", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "cc-scheduler-loop-"));
    const schedulerFile = join(root, "scheduler.db");
    let now = Date.UTC(2026, 7, 11, 8, 0, 0, 0);
    const stores = [];
    const open = () => {
      const store = openSchedulerStore({
        file: schedulerFile,
        Database,
        clock: () => now,
      });
      stores.push(store);
      return store;
    };
    cleanups.push(() => {
      for (const store of stores) store.close();
      rmSync(root, { recursive: true, force: true });
    });
    return {
      root,
      open,
      definition(overrides = {}) {
        return {
          executionId: "loop-session-1",
          cwd: root,
          execMode: true,
          operands: ["npm", "test"],
          dynamic: false,
          ...overrides,
        };
      },
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  it("binds the execution definition and least capability", () => {
    const f = fixture();
    const processDefinition = f.definition();
    const processJob = buildLoopSchedulerJob(processDefinition);
    expect(processJob).toMatchObject({
      kind: "loop-iteration",
      trigger: { source: "loop", mode: "interval" },
      maxAttempts: 2,
      payload: { definition: loopExecutionSnapshot(processDefinition) },
      authority: { requestedCapabilities: [LOOP_PROCESS_CAPABILITY] },
    });
    expect(processJob.payload.snapshotDigest).toBe(
      loopExecutionDigest(processDefinition),
    );

    expect(
      buildLoopSchedulerJob(
        f.definition({ execMode: false, operands: ["check CI"] }),
      ).authority.requestedCapabilities,
    ).toEqual([LOOP_AGENT_CAPABILITY]);
  });

  it("runs and durably settles one iteration", async () => {
    const f = fixture();
    const store = f.open();
    const runIteration = vi.fn(async () => ({
      exitCode: 2,
      output: "still failing",
      durationMs: 25,
      done: false,
      nextDelayMs: 1_000,
      matchedUntil: false,
    }));
    const bridge = new LoopSchedulerBridge({
      schedulerStore: store,
      definition: f.definition(),
      runIteration,
      ownerId: "loop-owner",
      leaseMs: 1_000,
    });

    await expect(
      bridge.runIteration(1, { scheduledFor: f.now }),
    ).resolves.toMatchObject({
      iteration: 1,
      exitCode: 2,
      output: "still failing",
      outputBytes: 13,
      outputDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      schedulerOccurrenceId: expect.any(String),
    });
    expect(runIteration).toHaveBeenCalledTimes(1);
    expect(
      store.getOccurrence(
        enqueueLoopIteration(store, f.definition(), 1, {
          scheduledFor: f.now,
        }).id,
      ),
    ).toMatchObject({
      status: "succeeded",
      attempt: 1,
      result: { iteration: 1, exitCode: 2, outputBytes: 13 },
    });
  });

  it("recovers a settled iteration without replaying its child", async () => {
    const f = fixture();
    const store = f.open();
    const firstRunner = vi.fn(async () => ({
      exitCode: 0,
      output: "READY",
      durationMs: 5,
      matchedUntil: true,
    }));
    const first = new LoopSchedulerBridge({
      schedulerStore: store,
      definition: f.definition(),
      runIteration: firstRunner,
      ownerId: "first-owner",
      leaseMs: 1_000,
    });
    await first.runIteration(1, { scheduledFor: f.now });

    const recoveryRunner = vi.fn();
    const recovered = new LoopSchedulerBridge({
      schedulerStore: store,
      definition: f.definition(),
      runIteration: recoveryRunner,
      ownerId: "recovery-owner",
      leaseMs: 1_000,
    });
    await expect(
      recovered.runIteration(1, { scheduledFor: f.now }),
    ).resolves.toMatchObject({
      iteration: 1,
      exitCode: 0,
      matchedUntil: true,
      recovered: true,
      output: "",
    });
    expect(firstRunner).toHaveBeenCalledTimes(1);
    expect(recoveryRunner).not.toHaveBeenCalled();
  });

  it("allows only one live driver to execute an iteration", async () => {
    const f = fixture();
    const firstStore = f.open();
    const secondStore = f.open();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const runIteration = vi.fn(async () => {
      await gate;
      return { exitCode: 0, output: "done", durationMs: 1 };
    });
    const first = new LoopSchedulerBridge({
      schedulerStore: firstStore,
      definition: f.definition(),
      runIteration,
      ownerId: "driver-a",
      leaseMs: 10_000,
    });
    const second = new LoopSchedulerBridge({
      schedulerStore: secondStore,
      definition: f.definition(),
      runIteration,
      ownerId: "driver-b",
      leaseMs: 10_000,
    });

    const running = first.runIteration(1, { scheduledFor: f.now });
    await vi.waitFor(() => expect(runIteration).toHaveBeenCalledTimes(1));
    await expect(
      second.runIteration(1, { scheduledFor: f.now }),
    ).rejects.toMatchObject({ code: "LOOP_SCHEDULER_BUSY" });
    release();
    await expect(running).resolves.toMatchObject({ exitCode: 0 });
    expect(runIteration).toHaveBeenCalledTimes(1);
  });

  it("fails closed after a claimed iteration loses its owner", async () => {
    const f = fixture();
    const store = f.open();
    const definition = f.definition();
    const occurrence = enqueueLoopIteration(store, definition, 1, {
      scheduledFor: f.now,
    });
    expect(
      store.claimOccurrence({
        occurrenceId: occurrence.id,
        ownerId: "crashed-owner",
        leaseMs: 1_000,
      }),
    ).toMatchObject({ status: "running", attempt: 1 });
    f.now += 1_001;
    const runIteration = vi.fn();
    const bridge = new LoopSchedulerBridge({
      schedulerStore: store,
      definition,
      runIteration,
      ownerId: "recovery-owner",
      leaseMs: 1_000,
    });

    await expect(
      bridge.runIteration(1, { scheduledFor: occurrence.scheduledFor }),
    ).rejects.toMatchObject({ code: "LOOP_SCHEDULER_OUTCOME_UNKNOWN" });
    expect(runIteration).not.toHaveBeenCalled();
    expect(store.getOccurrence(occurrence.id)).toMatchObject({
      status: "dead_letter",
      attempt: 2,
      lastError: { code: "LOOP_SCHEDULER_OUTCOME_UNKNOWN" },
    });
  });

  it("refuses to rewrite a saved execution definition", () => {
    const f = fixture();
    const store = f.open();
    new LoopSchedulerBridge({
      schedulerStore: store,
      definition: f.definition(),
      runIteration: async () => ({ exitCode: 0 }),
    });
    expect(
      () =>
        new LoopSchedulerBridge({
          schedulerStore: store,
          definition: f.definition({ operands: ["npm", "run", "build"] }),
          runIteration: async () => ({ exitCode: 0 }),
        }),
    ).toThrowError(
      expect.objectContaining({ code: "LOOP_SCHEDULER_DEFINITION_CONFLICT" }),
    );
  });
});
