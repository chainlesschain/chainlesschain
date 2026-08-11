import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgendaRun } from "../../src/commands/agenda.js";
import { AgentScheduleStore } from "../../src/lib/agent-schedule-store.js";
import {
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
});
