import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgendaRun } from "../../src/commands/agenda.js";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";
import {
  AGENDA_SCHEDULER_MONITOR_CAPABILITY,
  AGENDA_SCHEDULER_RETRY_DELAY_MS,
  AgendaSchedulerBridge,
  agendaEntrySnapshot,
  agendaEntrySnapshotDigest,
  agendaSchedulerJobId,
  buildAgendaSchedulerJob,
  enqueueAgendaEntry,
} from "../../src/lib/scheduler-kernel/agenda-adapter.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel agenda adapter", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture(start = Date.UTC(2026, 7, 11, 3, 0, 0)) {
    const dir = mkdtempSync(join(tmpdir(), "cc-scheduler-agenda-"));
    const agendaDir = join(dir, "agenda");
    const schedulerFile = join(dir, "scheduler.db");
    let now = start;
    const schedulerStores = [];
    const openAgenda = () =>
      new AgentScheduleStore({ dir: agendaDir, now: () => now });
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
      rmSync(dir, { recursive: true, force: true });
    });
    return {
      openAgenda,
      openScheduler,
      clock: () => now,
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  it("binds the full unattended policy while excluding transient lease evidence", () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const entry = agendaStore.scheduleWakeup({
      prompt: "bounded work",
      dueAt: f.now,
      permissionMode: "plan",
      worktree: true,
      maxTurns: 3,
      goalCondition: "exit-zero: npm test",
      goalMaxTokens: 10_000,
      goalMaxCost: 1.5,
      goalMaxTime: 60_000,
      maxOuterTurns: 2,
      unattendedAllowlist: ["publish"],
    });
    const withTransientState = {
      ...entry,
      executionLease: { owner: "legacy", expiresAt: f.now + 1_000 },
      schedulerExecution: { status: "failed" },
    };
    const snapshot = agendaEntrySnapshot(withTransientState);
    expect(snapshot).not.toHaveProperty("executionLease");
    expect(snapshot).not.toHaveProperty("schedulerExecution");
    expect(snapshot.runPolicy).toEqual(entry.runPolicy);
    const job = buildAgendaSchedulerJob(withTransientState);
    expect(job).toMatchObject({
      id: agendaSchedulerJobId(entry.id),
      kind: "agenda",
      maxAttempts: 3,
      payload: {
        entry: expect.objectContaining({ runPolicy: entry.runPolicy }),
      },
      authority: { requestedCapabilities: ["agent.execute"] },
    });
    expect(job.payload.snapshotDigest).toBe(agendaEntrySnapshotDigest(entry));
  });

  it("binds an explicit cron time zone into the immutable job trigger", () => {
    const f = fixture(Date.UTC(2026, 2, 2, 13, 30, 0));
    const entry = f.openAgenda().createCron({
      prompt: "New York standup",
      cron: "0 9 * * 1-5",
      timeZone: "America/New_York",
    });
    const job = buildAgendaSchedulerJob(entry);
    expect(job.trigger).toEqual({
      source: "agent-schedule-store",
      scheduleKind: "cron",
      expression: "0 9 * * 1-5",
      timeZone: "America/New_York",
    });
    expect(job.payload.entry.timeZone).toBe("America/New_York");
  });

  it("rejects a tampered cron time zone before enqueue", () => {
    const f = fixture(Date.UTC(2026, 2, 2, 13, 30, 0));
    const entry = f.openAgenda().createCron({
      prompt: "New York standup",
      cron: "0 9 * * 1-5",
      timeZone: "America/New_York",
    });
    expect(() =>
      buildAgendaSchedulerJob({ ...entry, timeZone: "Mars/Olympus_Mons" }),
    ).toThrow(
      expect.objectContaining({ code: "AGENDA_SCHEDULER_CRON_INVALID" }),
    );
  });

  it("advances an explicit time-zone cron across the repeated DST minute", async () => {
    const f = fixture(Date.UTC(2026, 10, 1, 4, 0, 0));
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.createCron({
      prompt: "fall-back check",
      cron: "30 1 * * *",
      timeZone: "America/New_York",
    });
    expect(entry.nextAt).toBe(Date.UTC(2026, 10, 1, 5, 30, 0));
    f.now = entry.nextAt;
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent: vi.fn(async () => 0),
      now: f.clock,
      ownerId: "agenda-dst-owner",
      leaseMs: 10_000,
    });
    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(agendaStore.get(entry.id)).toMatchObject({
      runs: 1,
      nextAt: Date.UTC(2026, 10, 1, 6, 30, 0),
      timeZone: "America/New_York",
    });
  });

  it("runs a due wakeup through the kernel and preserves its run policy", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.scheduleWakeup({
      prompt: "isolated",
      dueAt: f.now,
      permissionMode: "plan",
      worktree: true,
      maxTurns: 3,
    });
    const runAgent = vi.fn(async () => 0);
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "agenda-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        entry: entry.id,
        kind: "wakeup",
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "isolated",
        runPolicy: {
          permissionMode: "plan",
          worktree: true,
          maxTurns: 3,
        },
      }),
    );
    expect(agendaStore.get(entry.id)).toMatchObject({
      status: "fired",
      firedAt: f.now,
      schedulerExecution: { status: "succeeded", attempt: 1 },
    });
  });

  it("allows only one cron agent execution under two live drivers", async () => {
    const f = fixture();
    const firstAgenda = f.openAgenda();
    const cron = firstAgenda.createCron({
      prompt: "hourly",
      cron: "0 * * * *",
      maxTurns: 2,
    });
    f.now = cron.nextAt;
    const secondAgenda = f.openAgenda();
    const firstScheduler = f.openScheduler();
    const secondScheduler = f.openScheduler();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const runAgent = vi.fn(async () => {
      await gate;
    });
    const firstBridge = new AgendaSchedulerBridge({
      agendaStore: firstAgenda,
      schedulerStore: firstScheduler,
      runAgent,
      now: f.clock,
      ownerId: "agenda-contender-a",
      leaseMs: 10_000,
    });
    const secondBridge = new AgendaSchedulerBridge({
      agendaStore: secondAgenda,
      schedulerStore: secondScheduler,
      runAgent,
      now: f.clock,
      ownerId: "agenda-contender-b",
      leaseMs: 10_000,
    });

    const running = firstBridge.runDue();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    expect(secondAgenda.claimDue(f.now, 1_000)).toEqual([]);
    await expect(secondBridge.runDue()).resolves.toEqual([]);
    release();
    await expect(running).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(firstAgenda.get(cron.id)).toMatchObject({
      status: "active",
      runs: 1,
      lastRunAt: f.now,
      schedulerExecution: { status: "succeeded" },
    });
  });

  it("backs off when a legacy runner wins the claim race", async () => {
    const f = fixture();
    const schedulerAgenda = f.openAgenda();
    const legacyAgenda = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = schedulerAgenda.scheduleWakeup({
      prompt: "cross-version",
      dueAt: f.now,
    });
    const occurrence = enqueueAgendaEntry(schedulerStore, entry);
    const [legacyClaim] = legacyAgenda.claimDue(f.now, 5_000);
    const runAgent = vi.fn();
    const bridge = new AgendaSchedulerBridge({
      agendaStore: schedulerAgenda,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "agenda-new-runner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        entry: entry.id,
        recovered: true,
        result: expect.objectContaining({
          status: "retry_wait",
          error: expect.objectContaining({
            code: "AGENDA_SCHEDULER_LEGACY_CLAIM_ACTIVE",
          }),
        }),
      }),
    ]);
    expect(runAgent).not.toHaveBeenCalled();
    expect(schedulerAgenda.get(entry.id)).toMatchObject({
      executionLease: legacyClaim.executionLease,
    });
    expect(schedulerAgenda.get(entry.id)).not.toHaveProperty(
      "schedulerExecution",
    );
    expect(schedulerStore.getOccurrence(occurrence.id)).toMatchObject({
      status: "retry_wait",
      availableAt: legacyClaim.executionLease.expiresAt,
    });
  });

  it("recovers a completed abandoned claim without spawning the agent twice", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.scheduleWakeup({
      prompt: "once",
      dueAt: f.now,
    });
    const occurrence = enqueueAgendaEntry(schedulerStore, entry);
    const digest = occurrence.payload.snapshotDigest;
    const claimed = schedulerStore.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "crashed-agenda-owner",
      leaseMs: 1_000,
    });
    agendaStore.bindSchedulerExecution(entry.id, {
      occurrenceId: occurrence.id,
      snapshotDigest: digest,
      attempt: claimed.attempt,
      atMs: f.now,
    });
    const action = { id: entry.id, kind: "wakeup", action: "fired" };
    agendaStore.completeSchedulerExecution(entry.id, {
      occurrenceId: occurrence.id,
      snapshotDigest: digest,
      attempt: claimed.attempt,
      outcome: "succeeded",
      result: action,
      atMs: f.now,
    });
    f.now += 1_001;
    const runAgent = vi.fn();
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "agenda-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        entry: entry.id,
        recovered: true,
        result: expect.objectContaining({
          status: "succeeded",
          result: { ...action, recovered: true },
        }),
      }),
    ]);
    expect(runAgent).not.toHaveBeenCalled();
    expect(schedulerStore.getOccurrence(occurrence.id)).toMatchObject({
      status: "succeeded",
      attempt: 2,
    });
  });

  it("fails closed when an abandoned agent attempt has no terminal evidence", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.scheduleWakeup({
      prompt: "unknown",
      dueAt: f.now,
    });
    const occurrence = enqueueAgendaEntry(schedulerStore, entry);
    const claimed = schedulerStore.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "unknown-agenda-owner",
      leaseMs: 1_000,
    });
    agendaStore.bindSchedulerExecution(entry.id, {
      occurrenceId: occurrence.id,
      snapshotDigest: occurrence.payload.snapshotDigest,
      attempt: claimed.attempt,
      atMs: f.now,
    });
    f.now += 1_001;
    const runAgent = vi.fn();
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "unknown-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          status: "dead_letter",
          error: expect.objectContaining({
            code: "AGENDA_SCHEDULER_OUTCOME_UNKNOWN",
          }),
        }),
      }),
    ]);
    expect(runAgent).not.toHaveBeenCalled();
    expect(agendaStore.get(entry.id)).toMatchObject({
      status: "pending",
      schedulerExecution: { status: "running" },
      executionLease: { expiresAt: Number.MAX_SAFE_INTEGER },
    });
    expect(agendaStore.due("wakeup", f.now)).toEqual([]);
  });

  it("does not retry after the agent succeeds but outcome persistence fails", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.scheduleWakeup({
      prompt: "side effect completed",
      dueAt: f.now,
    });
    const runAgent = vi.fn(async () => 0);
    vi.spyOn(agendaStore, "completeSchedulerExecution").mockImplementation(
      () => {
        throw new Error("disk unavailable");
      },
    );
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "agenda-persist-failure-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        entry: entry.id,
        result: expect.objectContaining({
          status: "dead_letter",
          error: expect.objectContaining({
            code: "AGENDA_SCHEDULER_OUTCOME_UNKNOWN",
          }),
        }),
      }),
    ]);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(agendaStore.get(entry.id)).toMatchObject({
      status: "pending",
      schedulerExecution: { status: "running" },
      executionLease: { expiresAt: Number.MAX_SAFE_INTEGER },
    });
  });

  it("retries a known failed attempt after the bounded retry delay", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.scheduleWakeup({
      prompt: "retry",
      dueAt: f.now,
    });
    const runAgent = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(0);
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "agenda-retry-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "retry_wait" }),
      }),
    ]);
    expect(agendaStore.get(entry.id)).toMatchObject({
      status: "pending",
      schedulerExecution: { status: "failed", attempt: 1 },
    });
    f.now += AGENDA_SCHEDULER_RETRY_DELAY_MS;
    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        recovered: true,
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect(agendaStore.get(entry.id)).toMatchObject({
      status: "fired",
      schedulerExecution: { status: "succeeded", attempt: 2 },
    });
  });

  it("rejects a stale Agenda snapshot before spawning an agent", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.scheduleWakeup({
      prompt: "old",
      dueAt: f.now,
    });
    const occurrence = enqueueAgendaEntry(schedulerStore, entry);
    agendaStore._mutate("wakeup", entry.id, (current) => {
      current.prompt = "new";
    });
    const runAgent = vi.fn();
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "agenda-stale-owner",
      leaseMs: 10_000,
    });

    await expect(
      bridge.runtime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "AGENDA_SCHEDULER_STALE_SNAPSHOT" },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("routes the production Agenda wakeup path through SchedulerRuntime", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const entry = agendaStore.scheduleWakeup({
      prompt: "command path",
      dueAt: f.now,
      permissionMode: "acceptEdits",
      maxTurns: 4,
    });
    const spawnAgent = vi.fn(async () => 0);
    const logs = [];
    const code = await runAgendaRun(
      { json: true },
      {
        store: agendaStore,
        schedulerStore,
        useSchedulerKernel: true,
        schedulerOwnerId: "agenda-command-owner",
        spawnAgent,
        now: f.clock,
        log: (line) => logs.push(line),
      },
    );

    expect(code).toBe(0);
    expect(spawnAgent).toHaveBeenCalledWith("command path", {
      permissionMode: "acceptEdits",
      maxTurns: 4,
    });
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      due: 1,
      actions: [{ id: entry.id, kind: "wakeup", action: "fired" }],
    });
    expect(agendaStore.get(entry.id).status).toBe("fired");
  });

  it("binds monitor observations to a dedicated least-authority capability", () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const monitor = agendaStore.createMonitor({
      watchFile: "status.txt",
      intervalMs: 1_000,
      stopWhen: "ready",
    });
    const job = buildAgendaSchedulerJob(monitor);

    expect(job).toMatchObject({
      trigger: {
        scheduleKind: "monitor",
        expression: "every:1000",
      },
      authority: {
        requestedCapabilities: [AGENDA_SCHEDULER_MONITOR_CAPABILITY],
      },
    });
    expect(job.payload.entry).not.toHaveProperty("executionLease");
    expect(job.payload.entry).not.toHaveProperty("schedulerExecution");
  });

  it("records and rearms an unmatched monitor atomically with scheduler evidence", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const monitor = agendaStore.createMonitor({
      watchFile: "status.txt",
      intervalMs: 1_000,
      stopWhen: "ready",
    });
    f.now = monitor.nextAt;
    const runMonitor = vi.fn(async () => ({
      matched: false,
      mtimeMs: 123,
    }));
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent: vi.fn(),
      runMonitor,
      notifyMonitor: vi.fn(),
      now: f.clock,
      ownerId: "agenda-monitor-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        entry: monitor.id,
        kind: "monitor",
        result: expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({
            action: "checked",
            status: "active",
          }),
        }),
      }),
    ]);
    expect(runMonitor).toHaveBeenCalledTimes(1);
    expect(agendaStore.get(monitor.id)).toMatchObject({
      status: "active",
      checks: 1,
      lastMtimeMs: 123,
      nextAt: f.now + 1_000,
      schedulerExecution: { status: "succeeded", attempt: 1 },
    });
  });

  it("allows only one monitor observation under two live drivers", async () => {
    const f = fixture();
    const firstAgenda = f.openAgenda();
    const monitor = firstAgenda.createMonitor({
      watchFile: "status.txt",
      intervalMs: 1_000,
      stopWhen: "ready",
    });
    f.now = monitor.nextAt;
    const secondAgenda = f.openAgenda();
    const firstScheduler = f.openScheduler();
    const secondScheduler = f.openScheduler();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const runMonitor = vi.fn(async () => {
      await gate;
      return { matched: false, mtimeMs: 321 };
    });
    const firstBridge = new AgendaSchedulerBridge({
      agendaStore: firstAgenda,
      schedulerStore: firstScheduler,
      runAgent: vi.fn(),
      runMonitor,
      now: f.clock,
      ownerId: "agenda-monitor-contender-a",
      leaseMs: 10_000,
    });
    const secondBridge = new AgendaSchedulerBridge({
      agendaStore: secondAgenda,
      schedulerStore: secondScheduler,
      runAgent: vi.fn(),
      runMonitor,
      now: f.clock,
      ownerId: "agenda-monitor-contender-b",
      leaseMs: 10_000,
    });

    const running = firstBridge.runDue();
    await vi.waitFor(() => expect(runMonitor).toHaveBeenCalledTimes(1));
    expect(secondAgenda.claimDue(f.now, 1_000, "monitor")).toEqual([]);
    await expect(secondBridge.runDue()).resolves.toEqual([]);
    release();
    await expect(running).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runMonitor).toHaveBeenCalledTimes(1);
    expect(firstAgenda.get(monitor.id)).toMatchObject({
      status: "active",
      checks: 1,
      schedulerExecution: { status: "succeeded" },
    });
  });

  it("persists a matched monitor before best-effort notification", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const monitor = agendaStore.createMonitor({
      watchUrl: "https://example.test/health",
      intervalMs: 1_000,
    });
    f.now = monitor.nextAt;
    const notifyMonitor = vi.fn(async () => {
      expect(agendaStore.get(monitor.id)).toMatchObject({
        status: "matched",
        lastEventId: "event-501",
        schedulerExecution: { status: "succeeded" },
      });
      throw new Error("desktop unavailable");
    });
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent: vi.fn(),
      runMonitor: vi.fn(async () => ({
        matched: true,
        eventId: "event-501",
        authority: "SYSTEM",
        notification: {
          title: "Monitor matched",
          body: "healthy",
          level: "success",
        },
      })),
      notifyMonitor,
      now: f.clock,
      ownerId: "agenda-monitor-notify-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({
            action: "matched",
            status: "matched",
            event_id: "event-501",
            notifyError: "desktop unavailable",
          }),
        }),
      }),
    ]);
    expect(notifyMonitor).toHaveBeenCalledTimes(1);
    expect(agendaStore.get(monitor.id)).not.toHaveProperty("output");
  });

  it("recovers a persisted monitor check without observing or notifying twice", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const monitor = agendaStore.createMonitor({
      watchFile: "status.txt",
      intervalMs: 10_000,
      stopWhen: "ready",
    });
    f.now = monitor.nextAt;
    const occurrence = enqueueAgendaEntry(schedulerStore, monitor);
    const claimed = schedulerStore.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "crashed-monitor-owner",
      leaseMs: 1_000,
    });
    agendaStore.bindSchedulerExecution(monitor.id, {
      occurrenceId: occurrence.id,
      snapshotDigest: occurrence.payload.snapshotDigest,
      attempt: claimed.attempt,
      atMs: f.now,
    });
    agendaStore.completeSchedulerExecution(monitor.id, {
      occurrenceId: occurrence.id,
      snapshotDigest: occurrence.payload.snapshotDigest,
      attempt: claimed.attempt,
      outcome: "succeeded",
      result: { id: monitor.id, kind: "monitor", action: "checked" },
      monitorCheck: { matched: false, mtimeMs: 456 },
      atMs: f.now,
    });
    f.now += 1_001;
    const runMonitor = vi.fn();
    const notifyMonitor = vi.fn();
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent: vi.fn(),
      runMonitor,
      notifyMonitor,
      now: f.clock,
      ownerId: "agenda-monitor-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        recovered: true,
        result: expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({
            action: "checked",
            recovered: true,
          }),
        }),
      }),
    ]);
    expect(runMonitor).not.toHaveBeenCalled();
    expect(notifyMonitor).not.toHaveBeenCalled();
    expect(agendaStore.get(monitor.id).checks).toBe(1);
  });

  it("fails closed after a monitor crashes with an unknown observation outcome", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const monitor = agendaStore.createMonitor({
      watchUrl: "https://example.test/health",
      intervalMs: 1_000,
    });
    f.now = monitor.nextAt;
    const occurrence = enqueueAgendaEntry(schedulerStore, monitor);
    const claimed = schedulerStore.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "unknown-monitor-owner",
      leaseMs: 1_000,
    });
    agendaStore.bindSchedulerExecution(monitor.id, {
      occurrenceId: occurrence.id,
      snapshotDigest: occurrence.payload.snapshotDigest,
      attempt: claimed.attempt,
      atMs: f.now,
    });
    f.now += 1_001;
    const runMonitor = vi.fn();
    const notifyMonitor = vi.fn();
    const bridge = new AgendaSchedulerBridge({
      agendaStore,
      schedulerStore,
      runAgent: vi.fn(),
      runMonitor,
      notifyMonitor,
      now: f.clock,
      ownerId: "unknown-monitor-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({
          status: "dead_letter",
          error: expect.objectContaining({
            code: "AGENDA_SCHEDULER_OUTCOME_UNKNOWN",
          }),
        }),
      }),
    ]);
    expect(runMonitor).not.toHaveBeenCalled();
    expect(notifyMonitor).not.toHaveBeenCalled();
    expect(agendaStore.get(monitor.id)).toMatchObject({
      status: "active",
      checks: 0,
      schedulerExecution: { status: "running" },
      executionLease: { expiresAt: Number.MAX_SAFE_INTEGER },
    });
  });

  it("routes the production Agenda monitor path through SchedulerRuntime", async () => {
    const f = fixture();
    const agendaStore = f.openAgenda();
    const schedulerStore = f.openScheduler();
    const monitor = agendaStore.createMonitor({
      watchFile: "status.txt",
      intervalMs: 1_000,
      stopWhen: "ready",
    });
    f.now = monitor.nextAt;
    const notify = vi.fn(async () => ({}));
    const logs = [];
    const code = await runAgendaRun(
      { json: true },
      {
        store: agendaStore,
        schedulerStore,
        useSchedulerKernel: true,
        schedulerOwnerId: "agenda-monitor-command-owner",
        spawnAgent: vi.fn(),
        readWatchedFile: vi.fn(async () => ({
          exists: true,
          content: "ready: yes",
          mtimeMs: 789,
        })),
        notify,
        now: f.clock,
        log: (line) => logs.push(line),
      },
    );

    expect(code).toBe(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logs.join("\n"))).toMatchObject({
      due: 1,
      actions: [
        {
          id: monitor.id,
          kind: "monitor",
          action: "matched",
          status: "matched",
        },
      ],
    });
    expect(agendaStore.get(monitor.id)).toMatchObject({
      status: "matched",
      checks: 1,
      lastMtimeMs: 789,
      schedulerExecution: { status: "succeeded" },
    });
  });
});
