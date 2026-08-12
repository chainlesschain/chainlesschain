import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
  _deps as coworkDeps,
  addSchedule,
  bindSchedulerScheduleFire,
  claimScheduleFire,
  completeSchedulerScheduleFire,
  getSchedule,
  saveSchedules,
  settleScheduleFire,
} from "../../src/lib/cowork-cron.js";
import {
  COWORK_CRON_SCHEDULER_RETRY_DELAY_MS,
  CoworkCronKernelScheduler,
  CoworkCronSchedulerBridge,
  buildCoworkCronSchedulerJob,
  coworkCronScheduleDigest,
  coworkCronScheduleSnapshot,
  enqueueCoworkCronSchedule,
} from "../../src/lib/scheduler-kernel/cowork-cron-adapter.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel Cowork cron adapter", () => {
  const cleanups = [];
  const originalNow = coworkDeps.now;
  const originalRenameSync = coworkDeps.renameSync;

  afterEach(() => {
    coworkDeps.now = originalNow;
    coworkDeps.renameSync = originalRenameSync;
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "cc-scheduler-cowork-cron-"));
    const cwd = join(root, "workspace");
    const schedulerFile = join(root, "scheduler.db");
    let now = new Date(2026, 7, 11, 14, 0, 0, 0).getTime();
    coworkDeps.now = () => new Date(now);
    const schedulerStores = [];
    const openScheduler = () => {
      const store = openSchedulerStore({
        file: schedulerFile,
        Database,
        clock: () => now,
      });
      schedulerStores.push(store);
      return store;
    };
    cleanups.push(() => {
      for (const store of schedulerStores) store.close();
      rmSync(root, { recursive: true, force: true });
    });
    return {
      root,
      cwd,
      openScheduler,
      clock: () => new Date(now),
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
      add(overrides = {}) {
        return addSchedule(cwd, {
          cron: "0 * * * * *",
          templateId: "doc-convert",
          userMessage: "scheduled cowork",
          files: [],
          ...overrides,
        });
      },
    };
  }

  it("binds definition state while excluding mutable delivery evidence", () => {
    const f = fixture();
    const schedule = f.add();
    const withRuntimeState = {
      ...schedule,
      activeDelivery: { ownerId: "legacy" },
      schedulerExecution: { status: "running" },
      lastDeliveryId: "old",
      lastRunAt: new Date(f.now).toISOString(),
      lastStatus: "completed",
      deliveryFence: 7,
    };

    const snapshot = coworkCronScheduleSnapshot(withRuntimeState);
    expect(snapshot).toEqual({
      id: schedule.id,
      cron: schedule.cron,
      missedRunPolicy: "collapse",
      templateId: "doc-convert",
      userMessage: "scheduled cowork",
      files: [],
      enabled: true,
      createdAt: schedule.createdAt,
    });
    const job = buildCoworkCronSchedulerJob(f.cwd, withRuntimeState);
    expect(job).toMatchObject({
      kind: "cowork-cron",
      maxAttempts: 3,
      trigger: { resolution: "second" },
      authority: { requestedCapabilities: ["cowork.task.execute"] },
      payload: { schedule: snapshot },
    });
    expect(job.payload.snapshotDigest).toBe(coworkCronScheduleDigest(schedule));
  });

  it("runs one due schedule through SchedulerRuntime", async () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const runTask = vi.fn(async () => ({
      taskId: "task-1",
      status: "completed",
    }));
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "cowork-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        schedule: schedule.id,
        result: expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({
            taskId: "task-1",
            status: "completed",
          }),
        }),
      }),
    ]);
    expect(runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: "doc-convert",
        userMessage: "scheduled cowork",
        cwd: expect.any(String),
        scheduleId: schedule.id,
        deliveryId: expect.stringContaining(schedule.id),
        schedulerOccurrenceId: expect.any(String),
      }),
    );
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      lastStatus: "completed",
      lastDeliveryId: expect.stringContaining(schedule.id),
      activeDelivery: null,
      schedulerExecution: { status: "succeeded", attempt: 1 },
    });
  });

  it("binds an IANA zone and collapses downtime to one latest occurrence", async () => {
    const f = fixture();
    f.now = Date.parse("2026-08-10T13:00:00Z");
    const schedule = f.add({
      cron: "0 9 * * *",
      timeZone: "America/New_York",
    });
    expect(buildCoworkCronSchedulerJob(f.cwd, schedule).trigger).toMatchObject({
      timeZone: "America/New_York",
      missedRunPolicy: "collapse",
    });

    f.now = Date.parse("2026-08-12T15:15:00Z");
    const schedulerStore = f.openScheduler();
    const runTask = vi.fn(async () => ({
      taskId: "task-catch-up",
      status: "completed",
    }));
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "catch-up-owner",
      leaseMs: 10_000,
    });

    const results = await bridge.runDue();
    expect(results).toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(
      schedulerStore.getOccurrence(results[0].occurrence).scheduledFor,
    ).toBe(Date.parse("2026-08-12T13:00:00Z"));
    expect(getSchedule(f.cwd, schedule.id).nextAt).toBe(
      Date.parse("2026-08-13T13:00:00Z"),
    );
  });

  it("executes both real fall-back instants with distinct occurrence identity", async () => {
    const f = fixture();
    f.now = Date.parse("2026-11-01T05:30:00Z");
    f.add({
      cron: "30 1 * * *",
      timeZone: "America/New_York",
    });
    const schedulerStore = f.openScheduler();
    const runTask = vi.fn(async () => ({
      taskId: "task-dst",
      status: "completed",
    }));
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "dst-owner",
      leaseMs: 10_000,
    });

    const first = await bridge.runDue();
    f.now = Date.parse("2026-11-01T06:30:00Z");
    const second = await bridge.runDue();
    expect(runTask).toHaveBeenCalledTimes(2);
    expect([
      schedulerStore.getOccurrence(first[0].occurrence).scheduledFor,
      schedulerStore.getOccurrence(second[0].occurrence).scheduledFor,
    ]).toEqual([
      Date.parse("2026-11-01T05:30:00Z"),
      Date.parse("2026-11-01T06:30:00Z"),
    ]);
  });

  it("does not treat an exhausted null cursor as an epoch-due occurrence", async () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 29 2 *" });
    saveSchedules(f.cwd, [{ ...schedule, nextAt: null }]);
    const schedulerStore = f.openScheduler();
    const runTask = vi.fn();
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "exhausted-owner",
    });
    await expect(bridge.runDue()).resolves.toEqual([]);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("keeps the foreground kernel scheduler alive until stop", async () => {
    const f = fixture();
    f.add();
    const schedulerStore = f.openScheduler();
    const scheduler = new CoworkCronKernelScheduler({
      cwd: f.cwd,
      schedulerStore,
      runTask: async () => ({ taskId: "task-service", status: "completed" }),
      now: f.clock,
      intervalMs: 60_000,
      ownerId: "foreground-owner",
      leaseMs: 10_000,
    });

    scheduler.start();
    await scheduler.tick();
    expect(scheduler._timer?.hasRef?.()).toBe(true);
    scheduler.stop();
    expect(scheduler._timer).toBeNull();
  });

  it("auto-tunes the foreground scheduler for six-field cron", async () => {
    const f = fixture();
    f.add({ cron: "0 * * * * *" });
    const schedulerStore = f.openScheduler();
    const scheduler = new CoworkCronKernelScheduler({
      cwd: f.cwd,
      schedulerStore,
      runTask: async () => ({ taskId: "task-seconds", status: "completed" }),
      now: f.clock,
      ownerId: "seconds-owner",
      leaseMs: 10_000,
    });

    scheduler.start();
    await scheduler.tick();
    expect(scheduler.intervalMs).toBe(1_000);
    scheduler.stop();
  });

  it("allows only one task under two live kernel drivers", async () => {
    const f = fixture();
    const schedule = f.add();
    const firstStore = f.openScheduler();
    const secondStore = f.openScheduler();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const runTask = vi.fn(async () => {
      await gate;
      return { taskId: "task-only", status: "completed" };
    });
    const first = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore: firstStore,
      runTask,
      now: f.clock,
      ownerId: "cowork-a",
      leaseMs: 10_000,
    });
    const second = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore: secondStore,
      runTask,
      now: f.clock,
      ownerId: "cowork-b",
      leaseMs: 10_000,
    });

    const running = first.runDue();
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1));
    expect(
      claimScheduleFire(f.cwd, schedule.id, "legacy-same-fire", {
        ownerId: "legacy",
        now: f.clock(),
        leaseMs: 1_000,
      }),
    ).toBeNull();
    await expect(second.runDue()).resolves.toEqual([]);
    release();
    await expect(running).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runTask).toHaveBeenCalledTimes(1);
  });

  it("does not recover queued Cowork work from another workspace", async () => {
    const f = fixture();
    const workspaceB = join(f.root, "workspace-b");
    const scheduleB = addSchedule(workspaceB, {
      cron: "0 * * * * *",
      templateId: "doc-convert",
      userMessage: "workspace B task",
      files: [],
    });
    const schedulerStore = f.openScheduler();
    const occurrenceB = enqueueCoworkCronSchedule(
      schedulerStore,
      workspaceB,
      scheduleB,
      f.clock(),
    );
    const runWorkspaceA = vi.fn();
    const bridgeA = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask: runWorkspaceA,
      now: f.clock,
      ownerId: "workspace-a-owner",
      leaseMs: 10_000,
    });

    await expect(bridgeA.runDue()).resolves.toEqual([]);
    expect(runWorkspaceA).not.toHaveBeenCalled();
    expect(schedulerStore.getOccurrence(occurrenceB.id).status).toBe("queued");

    const runWorkspaceB = vi.fn(async () => ({
      taskId: "task-workspace-b",
      status: "completed",
    }));
    const bridgeB = new CoworkCronSchedulerBridge({
      cwd: workspaceB,
      schedulerStore,
      runTask: runWorkspaceB,
      now: f.clock,
      ownerId: "workspace-b-owner",
      leaseMs: 10_000,
    });
    await expect(bridgeB.runDue()).resolves.toEqual([
      expect.objectContaining({
        schedule: scheduleB.id,
        recovered: true,
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runWorkspaceB).toHaveBeenCalledTimes(1);
  });

  it("backs off when the legacy driver wins after occurrence enqueue", async () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const occurrence = enqueueCoworkCronSchedule(
      schedulerStore,
      f.cwd,
      schedule,
      f.clock(),
    );
    const legacyClaim = claimScheduleFire(
      f.cwd,
      schedule.id,
      occurrence.triggerKey,
      {
        ownerId: "legacy-owner",
        now: f.clock(),
        leaseMs: 5_000,
      },
    );
    const runTask = vi.fn();
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "kernel-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        recovered: true,
        result: expect.objectContaining({
          status: "retry_wait",
          error: expect.objectContaining({
            code: "COWORK_SCHEDULER_LEGACY_CLAIM_ACTIVE",
          }),
        }),
      }),
    ]);
    expect(runTask).not.toHaveBeenCalled();
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      activeDelivery: legacyClaim,
    });
    expect(schedulerStore.getOccurrence(occurrence.id)).toMatchObject({
      status: "retry_wait",
      availableAt: Date.parse(legacyClaim.leaseExpiresAt),
    });
  });

  it("recovers legacy completion without replaying the same fire", async () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const occurrence = enqueueCoworkCronSchedule(
      schedulerStore,
      f.cwd,
      schedule,
      f.clock(),
    );
    const legacyClaim = claimScheduleFire(
      f.cwd,
      schedule.id,
      occurrence.triggerKey,
      {
        ownerId: "legacy-owner",
        now: f.clock(),
        leaseMs: 5_000,
      },
    );
    expect(
      settleScheduleFire(f.cwd, schedule.id, legacyClaim, {
        lastRunAt: f.clock().toISOString(),
        lastStatus: "completed",
      }),
    ).toBe(true);
    const runTask = vi.fn();
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "kernel-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        recovered: true,
        result: expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({
            legacyEvidence: true,
            recovered: true,
          }),
        }),
      }),
    ]);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("recovers completed evidence after the runtime owner crashes", async () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const occurrence = enqueueCoworkCronSchedule(
      schedulerStore,
      f.cwd,
      schedule,
      f.clock(),
    );
    const claimed = schedulerStore.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "crashed-owner",
      leaseMs: 1_000,
    });
    bindSchedulerScheduleFire(f.cwd, schedule.id, {
      deliveryId: occurrence.triggerKey,
      occurrenceId: occurrence.id,
      snapshotDigest: occurrence.payload.snapshotDigest,
      attempt: claimed.attempt,
      at: f.clock(),
    });
    completeSchedulerScheduleFire(f.cwd, schedule.id, {
      deliveryId: occurrence.triggerKey,
      occurrenceId: occurrence.id,
      snapshotDigest: occurrence.payload.snapshotDigest,
      attempt: claimed.attempt,
      outcome: "succeeded",
      result: {
        scheduleId: schedule.id,
        deliveryId: occurrence.triggerKey,
        taskId: "task-durable",
        status: "completed",
      },
      at: f.clock(),
    });
    f.now += 1_001;
    const runTask = vi.fn();
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "recovery-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        recovered: true,
        result: expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({
            taskId: "task-durable",
            recovered: true,
          }),
        }),
      }),
    ]);
    expect(runTask).not.toHaveBeenCalled();
  });

  it("fails closed when a crashed task has only start evidence", async () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const occurrence = enqueueCoworkCronSchedule(
      schedulerStore,
      f.cwd,
      schedule,
      f.clock(),
    );
    const claimed = schedulerStore.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "unknown-owner",
      leaseMs: 1_000,
    });
    bindSchedulerScheduleFire(f.cwd, schedule.id, {
      deliveryId: occurrence.triggerKey,
      occurrenceId: occurrence.id,
      snapshotDigest: occurrence.payload.snapshotDigest,
      attempt: claimed.attempt,
      at: f.clock(),
    });
    f.now += 1_001;
    const runTask = vi.fn();
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "unknown-recovery",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          status: "dead_letter",
          error: expect.objectContaining({
            code: "COWORK_CRON_OUTCOME_UNKNOWN",
          }),
        }),
      }),
    ]);
    expect(runTask).not.toHaveBeenCalled();
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      schedulerExecution: { status: "running" },
      activeDelivery: {
        leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
      },
    });
  });

  it("retries a known thrown failure after the bounded delay", async () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 14 * * *" });
    const schedulerStore = f.openScheduler();
    const runTask = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce({ taskId: "task-retry", status: "completed" });
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "retry-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "retry_wait" }),
      }),
    ]);
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      schedulerExecution: { status: "failed", attempt: 1 },
      activeDelivery: {
        leaseExpiresAt: new Date(
          f.now + COWORK_CRON_SCHEDULER_RETRY_DELAY_MS,
        ).toISOString(),
      },
    });
    f.now += COWORK_CRON_SCHEDULER_RETRY_DELAY_MS;
    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        recovered: true,
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      lastStatus: "completed",
      activeDelivery: null,
      schedulerExecution: { status: "succeeded", attempt: 2 },
    });
  });

  it("treats a returned failed task as a retryable execution failure", async () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 14 * * *" });
    const schedulerStore = f.openScheduler();
    const runTask = vi
      .fn()
      .mockResolvedValueOnce({
        taskId: "task-reported-failure",
        status: "failed",
        result: { summary: "agent exhausted its budget" },
      })
      .mockResolvedValueOnce({
        taskId: "task-recovered",
        status: "completed",
      });
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "reported-failure-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          status: "retry_wait",
          error: expect.objectContaining({
            code: "COWORK_CRON_TASK_REPORTED_FAILED",
            message: "agent exhausted its budget",
          }),
        }),
      }),
    ]);
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      lastRunAt: null,
      lastStatus: null,
      schedulerExecution: { status: "failed", attempt: 1 },
    });

    f.now += COWORK_CRON_SCHEDULER_RETRY_DELAY_MS;
    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        recovered: true,
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runTask).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale schedule snapshot before task execution", async () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const occurrence = enqueueCoworkCronSchedule(
      schedulerStore,
      f.cwd,
      schedule,
      f.clock(),
    );
    saveSchedules(f.cwd, [{ ...schedule, userMessage: "changed" }]);
    const runTask = vi.fn();
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "stale-owner",
      leaseMs: 10_000,
    });

    await expect(
      bridge.runtime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "COWORK_CRON_STALE_SNAPSHOT" },
    });
    expect(runTask).not.toHaveBeenCalled();
  });

  it("does not retry after task success when completion persistence fails", async () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const runTask = vi.fn(async () => {
      coworkDeps.renameSync = () => {
        throw new Error("disk unavailable");
      };
      return { taskId: "task-side-effect", status: "completed" };
    });
    const bridge = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "persist-failure-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          status: "dead_letter",
          error: expect.objectContaining({
            code: "COWORK_CRON_OUTCOME_UNKNOWN",
          }),
        }),
      }),
    ]);
    coworkDeps.renameSync = originalRenameSync;
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      schedulerExecution: { status: "running" },
      activeDelivery: {
        leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
      },
    });
  });
});
