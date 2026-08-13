import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoutineStore } from "../../src/lib/routine-store.js";
import {
  ROUTINE_SCHEDULER_CHANNELS,
  RoutineSchedulerBridge,
  authorizeRoutineOccurrence,
  buildRoutineSchedulerJob,
  enqueueGithubRoutine,
  enqueueManualRoutine,
  enqueueScheduledRoutine,
  routineBridgeRunId,
  routineDefinitionDigest,
  routineGithubBatchDigest,
  routineSchedulerRunId,
  routineSnapshotDigest,
  syncRoutineSchedulerJob,
} from "../../src/lib/scheduler-kernel/routine-adapter.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel routine adapter", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture(start = Date.UTC(2026, 7, 11, 3, 0, 0)) {
    const dir = mkdtempSync(join(tmpdir(), "cc-scheduler-routine-"));
    const routineDir = join(dir, "routines");
    const schedulerFile = join(dir, "scheduler.db");
    let now = start;
    const routineStores = [];
    const schedulerStores = [];
    const openRoutine = () => {
      const store = new RoutineStore({ dir: routineDir, now: () => now });
      routineStores.push(store);
      return store;
    };
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
      openRoutine,
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

  it("binds scheduled state but keeps manual idempotency stable across fire state", () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const routine = routineStore.create({
      name: "nightly",
      prompt: "summarize",
      trigger: { kind: "cron", cron: "0 * * * *" },
    });
    const scheduled = buildRoutineSchedulerJob(routine, {
      channel: ROUTINE_SCHEDULER_CHANNELS.SCHEDULED,
    });
    const manual = buildRoutineSchedulerJob(routine, {
      channel: ROUTINE_SCHEDULER_CHANNELS.MANUAL,
    });
    expect(scheduled.payload.snapshotType).toBe("state");
    expect(manual.payload.snapshotType).toBe("definition");
    expect(scheduled.payload.snapshotDigest).toBe(
      routineSnapshotDigest(routine),
    );
    expect(manual.payload.snapshotDigest).toBe(
      routineDefinitionDigest(routine),
    );

    const firedState = { ...routine, lastFiredAt: f.now + 1_000 };
    expect(routineSnapshotDigest(firedState)).not.toBe(
      scheduled.payload.snapshotDigest,
    );
    expect(routineDefinitionDigest(firedState)).toBe(
      manual.payload.snapshotDigest,
    );
  });

  it("runs a due once routine through authority, claim, adapter, and settlement", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "one-shot",
      prompt: "produce report",
      trigger: { kind: "once", at: f.now - 1 },
    });
    const runAgent = vi.fn(async () => ({
      exitCode: 0,
      output: "done",
      usage: { total_tokens: 12 },
      costUsd: 0.01,
    }));
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "routine-owner",
      leaseMs: 10_000,
    });

    const [fired] = await bridge.runDue();
    expect(fired.result).toMatchObject({
      status: "succeeded",
      result: { status: "ok", exitCode: 0 },
    });
    expect(routineBridgeRunId(fired)).toMatch(/^run-/);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "produce report",
        routine: expect.objectContaining({ id: routine.id }),
      }),
    );
    expect(routineStore.get(routine.id)).toMatchObject({
      enabled: false,
      lastFiredAt: f.now,
    });
    expect(routineStore.listRuns({ routineId: routine.id })).toHaveLength(1);
    expect(
      schedulerStore.db
        .prepare("SELECT status, units FROM scheduler_authority_reservations")
        .get(),
    ).toEqual({ status: "succeeded", units: 1 });
    expect(
      schedulerStore
        .history({ occurrenceId: fired.occurrence })
        .map((event) => event.type),
    ).toEqual([
      "occurrence_succeeded",
      "occurrence_renewed",
      "occurrence_claimed",
      "occurrence_enqueued",
    ]);
  });

  it("deduplicates two drivers that observed the same due routine", async () => {
    const f = fixture();
    const firstRoutineStore = f.openRoutine();
    const routine = firstRoutineStore.create({
      name: "hourly",
      prompt: "run once",
      trigger: { kind: "cron", cron: "0 * * * *" },
    });
    f.now += 60 * 60_000;
    const secondRoutineStore = f.openRoutine();
    const firstSchedulerStore = f.openScheduler();
    const secondSchedulerStore = f.openScheduler();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const runAgent = vi.fn(async () => {
      await gate;
      return { exitCode: 0, output: "once" };
    });
    const firstBridge = new RoutineSchedulerBridge({
      routineStore: firstRoutineStore,
      schedulerStore: firstSchedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "routine-contender-a",
      leaseMs: 10_000,
    });
    const secondBridge = new RoutineSchedulerBridge({
      routineStore: secondRoutineStore,
      schedulerStore: secondSchedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "routine-contender-b",
      leaseMs: 10_000,
    });

    const firstRun = firstBridge.runDue();
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(1));
    const secondRun = await secondBridge.runDue();
    expect(secondRun).toHaveLength(1);
    expect(secondRun[0]).toMatchObject({
      routine: routine.id,
      deduplicated: true,
      result: { status: "busy" },
    });
    release();
    await expect(firstRun).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(firstRoutineStore.listRuns({ routineId: routine.id })).toHaveLength(
      1,
    );
  });

  it("resumes a durably enqueued routine after the scheduler handle restarts", async () => {
    const f = fixture();
    const setupRoutineStore = f.openRoutine();
    const routine = setupRoutineStore.create({
      name: "restartable",
      prompt: "resume after restart",
      trigger: { kind: "once", at: f.now - 1 },
    });
    const setupSchedulerStore = f.openScheduler();
    const occurrence = enqueueScheduledRoutine(setupSchedulerStore, routine);
    setupSchedulerStore.close();

    const resumedRoutineStore = f.openRoutine();
    const resumedSchedulerStore = f.openScheduler();
    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "resumed" }));
    const bridge = new RoutineSchedulerBridge({
      routineStore: resumedRoutineStore,
      schedulerStore: resumedSchedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "restart-owner",
      leaseMs: 10_000,
    });
    await expect(
      bridge.runtime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({
      status: "succeeded",
      result: { status: "ok" },
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(resumedRoutineStore.get(routine.id)).toMatchObject({
      enabled: false,
      lastFiredAt: f.now,
    });
  });

  it("recovers completed routine evidence without executing the agent twice", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "crash-recovery",
      prompt: "execute exactly once",
      trigger: { kind: "once", at: f.now - 1 },
    });
    const occurrence = enqueueScheduledRoutine(schedulerStore, routine);
    expect(
      schedulerStore.claimOccurrence({
        occurrenceId: occurrence.id,
        ownerId: "crashed-owner",
        leaseMs: 1_000,
      }),
    ).toMatchObject({ status: "running", attempt: 1 });
    const runId = routineSchedulerRunId(occurrence.id);
    routineStore.recordRunStart(routine.id, {
      runId,
      trigger: "once",
      schedulerOccurrenceId: occurrence.id,
      schedulerSnapshotDigest: occurrence.payload.snapshotDigest,
    });
    routineStore.recordRunEnd(runId, {
      status: "ok",
      exitCode: 0,
      summary: "agent completed before scheduler settlement",
    });
    // Simulate the crash window after routine state was updated but before the
    // occurrence was settled in the scheduler database.
    routineStore.update(routine.id, {
      enabled: false,
      lastFiredAt: f.now,
    });
    f.now += 1_001;
    const runAgent = vi.fn();
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "crash-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toEqual([
      expect.objectContaining({
        routine: routine.id,
        occurrence: occurrence.id,
        recovered: true,
        result: expect.objectContaining({
          status: "succeeded",
          result: expect.objectContaining({
            runId,
            status: "ok",
            recovered: true,
          }),
        }),
      }),
    ]);
    expect(runAgent).not.toHaveBeenCalled();
    expect(routineStore.listRuns({ routineId: routine.id })).toHaveLength(1);
    expect(schedulerStore.getOccurrence(occurrence.id)).toMatchObject({
      status: "succeeded",
      attempt: 2,
    });
  });

  it("fails closed when a prior routine run has an unknown outcome", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "unknown-outcome",
      prompt: "do not duplicate",
      trigger: { kind: "once", at: f.now - 1 },
    });
    const occurrence = enqueueScheduledRoutine(schedulerStore, routine);
    routineStore.recordRunStart(routine.id, {
      runId: routineSchedulerRunId(occurrence.id),
      trigger: "once",
      schedulerOccurrenceId: occurrence.id,
      schedulerSnapshotDigest: occurrence.payload.snapshotDigest,
    });
    const runAgent = vi.fn();
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "unknown-outcome-owner",
      leaseMs: 10_000,
    });

    await expect(
      bridge.runtime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "ROUTINE_RUN_OUTCOME_UNKNOWN" },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("preserves append-only evidence and retries once after adjudication", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "adjudicated-routine",
      prompt: "run once after verification",
      trigger: { kind: "once", at: f.now - 1 },
    });
    const occurrence = enqueueScheduledRoutine(schedulerStore, routine);
    const runId = routineSchedulerRunId(occurrence.id);
    routineStore.recordRunStart(routine.id, {
      runId,
      trigger: "once",
      schedulerOccurrenceId: occurrence.id,
      schedulerSnapshotDigest: occurrence.payload.snapshotDigest,
    });
    const firstBridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent: vi.fn(),
      now: f.clock,
      ownerId: "routine-fail-close-owner",
      leaseMs: 10_000,
    });
    await firstBridge.runtime.runOccurrence(occurrence.id);
    const candidate = schedulerStore.getAdjudicationCase(occurrence.id);
    schedulerStore.adjudicateOccurrence({
      occurrenceId: occurrence.id,
      decision: "confirmed_not_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: candidate.attempt,
      expectedFence: candidate.fence,
      reasonDigest: `sha256:${"1".repeat(64)}`,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "done" }));
    const recovered = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "routine-adjudication-owner",
      leaseMs: 10_000,
    });
    await expect(
      recovered.runtime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({ status: "succeeded", result: { runId } });
    expect(runAgent).toHaveBeenCalledOnce();
    expect(routineStore.getRun(runId)).toMatchObject({ status: "ok" });
    const runLines = routineStore.listRuns({
      routineId: routine.id,
      limit: 10,
    });
    expect(runLines).toHaveLength(1);
    expect(
      schedulerStore.getOccurrenceAdjudication(occurrence.id),
    ).toMatchObject({
      status: "applied",
    });
  });

  it("rejects routine run evidence bound to another scheduler occurrence", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "binding-mismatch",
      prompt: "never execute mismatched evidence",
      trigger: { kind: "once", at: f.now - 1 },
    });
    const occurrence = enqueueScheduledRoutine(schedulerStore, routine);
    const runId = routineSchedulerRunId(occurrence.id);
    routineStore.recordRunStart(routine.id, {
      runId,
      trigger: "once",
      schedulerOccurrenceId: "occurrence-wrong",
      schedulerSnapshotDigest: occurrence.payload.snapshotDigest,
    });
    routineStore.recordRunEnd(runId, { status: "ok", exitCode: 0 });
    const runAgent = vi.fn();
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "binding-mismatch-owner",
      leaseMs: 10_000,
    });

    await expect(
      bridge.runtime.runOccurrence(occurrence.id),
    ).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "SCHEDULER_ROUTINE_RUN_BINDING_MISMATCH" },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("allows an explicit manual trigger for a disabled routine and deduplicates its request", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "webhook",
      prompt: "manual only",
      trigger: { kind: "webhook" },
    });
    routineStore.setEnabled(routine.id, false);
    const current = routineStore.get(routine.id);
    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "manual" }));
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "manual-owner",
      leaseMs: 10_000,
    });

    const first = await bridge.trigger(current, { requestId: "request-1" });
    expect(first.result.status).toBe("succeeded");
    const second = await bridge.trigger(routineStore.get(routine.id), {
      requestId: "request-1",
    });
    expect(second.result).toMatchObject({
      status: "succeeded",
      alreadySettled: true,
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(routineStore.get(routine.id).enabled).toBe(false);
  });

  it("rejects a stale routine snapshot before a prompt can execute", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "mutable",
      prompt: "old prompt",
      trigger: { kind: "once", at: f.now - 1 },
    });
    const occurrence = enqueueScheduledRoutine(schedulerStore, routine);
    routineStore.update(routine.id, { prompt: "new prompt" });
    const runAgent = vi.fn();
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "stale-owner",
      leaseMs: 10_000,
    });

    const result = await bridge.runtime.runOccurrence(occurrence.id);
    expect(result).toMatchObject({
      status: "dead_letter",
      error: { code: "SCHEDULER_ROUTINE_STALE_SNAPSHOT" },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("records a failed agent run once and dead-letters without retry", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "failing",
      prompt: "fail",
      trigger: { kind: "webhook" },
    });
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent: async () => ({ exitCode: 7, output: "provider failed" }),
      now: f.clock,
      ownerId: "failure-owner",
      leaseMs: 10_000,
    });

    const fired = await bridge.trigger(routine, { requestId: "failure-1" });
    expect(fired.result).toMatchObject({
      status: "dead_letter",
      error: {
        code: "SCHEDULER_ROUTINE_EXECUTION_FAILED",
        details: { exitCode: 7 },
      },
    });
    expect(routineBridgeRunId(fired)).toMatch(/^run-/);
    expect(routineStore.listRuns({ routineId: routine.id })[0]).toMatchObject({
      status: "failed",
      exitCode: 7,
    });
    expect(
      schedulerStore.claimOccurrence({
        occurrenceId: fired.occurrence,
        ownerId: "retry-owner",
        leaseMs: 10_000,
      }),
    ).toBeNull();
  });

  it("syncs definition changes through expected-revision CAS", () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "versioned",
      prompt: "v1",
      trigger: { kind: "webhook" },
    });
    const first = syncRoutineSchedulerJob(schedulerStore, routine, {
      channel: ROUTINE_SCHEDULER_CHANNELS.MANUAL,
    });
    const changed = routineStore.update(routine.id, { prompt: "v2" });
    const second = syncRoutineSchedulerJob(schedulerStore, changed, {
      channel: ROUTINE_SCHEDULER_CHANNELS.MANUAL,
    });
    expect(second).toMatchObject({ revision: first.revision + 1 });
    expect(second.payload.routine.prompt).toBe("v2");

    const manual = enqueueManualRoutine(schedulerStore, changed, {
      now: f.now,
      requestId: "cas-request",
    });
    expect(manual.jobRevision).toBe(second.revision);
  });

  it("persists a GitHub event batch before advancing its cursor", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "github-watch",
      prompt: "inspect the push",
      trigger: { kind: "github", repo: "acme/app", events: ["PushEvent"] },
    });
    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "reviewed" }));
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "github-owner",
      leaseMs: 10_000,
    });
    const events = [
      {
        id: "102",
        type: "PushEvent",
        created_at: "2026-08-11T03:00:02.000Z",
      },
      {
        id: "101",
        type: "PushEvent",
        created_at: "2026-08-11T03:00:01.000Z",
      },
    ];

    const fired = await bridge.pollGithub(routine, {
      fetchEvents: vi.fn(async () => events),
    });
    expect(fired).toMatchObject({
      routine: routine.id,
      result: { status: "succeeded" },
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(routineStore.get(routine.id).lastSeenGithubEventId).toBe("102");
    expect(routineStore.getRun(routineBridgeRunId(fired))).toMatchObject({
      trigger: "github:PushEvent,PushEvent",
      status: "ok",
      schedulerOccurrenceId: fired.occurrence,
    });
    expect(fired.result.occurrence.payload).toMatchObject({
      channel: ROUTINE_SCHEDULER_CHANNELS.GITHUB,
      snapshotType: "definition",
      github: {
        repo: "acme/app",
        cursorBefore: null,
        cursorAfter: "102",
      },
    });
    expect(fired.result.occurrence.payload.githubDigest).toBe(
      routineGithubBatchDigest(fired.result.occurrence.payload.github),
    );
  });

  it("recovers the same GitHub occurrence when cursor persistence failed", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "github-cursor-crash",
      prompt: "inspect event",
      trigger: { kind: "github", repo: "acme/app" },
    });
    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "done" }));
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "cursor-owner",
      leaseMs: 10_000,
    });
    const events = [
      {
        id: "201",
        type: "IssuesEvent",
        created_at: "2026-08-11T03:00:03.000Z",
      },
    ];
    const originalUpdate = routineStore.update.bind(routineStore);
    let failCursor = true;
    routineStore.update = (id, patch) => {
      if (failCursor && patch.lastSeenGithubEventId) {
        failCursor = false;
        throw new Error("cursor disk unavailable");
      }
      return originalUpdate(id, patch);
    };

    await expect(
      bridge.pollGithub(routine, { fetchEvents: async () => events }),
    ).rejects.toThrow("cursor disk unavailable");
    expect(runAgent).not.toHaveBeenCalled();

    const recovered = await bridge.pollGithub(routineStore.get(routine.id), {
      fetchEvents: async () => events,
    });
    expect(recovered).toMatchObject({
      deduplicated: true,
      result: { status: "succeeded" },
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(routineStore.get(routine.id).lastSeenGithubEventId).toBe("201");
  });

  it("keeps an older queued GitHub batch executable after a newer batch", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "github-batches",
      prompt: "inspect batches",
      trigger: { kind: "github", repo: "acme/app" },
    });
    const firstOccurrence = enqueueGithubRoutine(
      schedulerStore,
      routine,
      [
        {
          id: "301",
          type: "PushEvent",
          created_at: "2026-08-11T03:00:04.000Z",
        },
      ],
      "301",
      { availableAt: f.now },
    );
    const advanced = routineStore.update(routine.id, {
      lastSeenGithubEventId: "301",
    });
    const secondOccurrence = enqueueGithubRoutine(
      schedulerStore,
      advanced,
      [
        {
          id: "302",
          type: "PullRequestEvent",
          created_at: "2026-08-11T03:00:05.000Z",
        },
      ],
      "302",
      { availableAt: f.now },
    );
    expect(firstOccurrence.jobId).not.toBe(secondOccurrence.jobId);

    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "done" }));
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "batch-owner",
      leaseMs: 10_000,
    });
    const recovered = await bridge.runDue();
    expect(recovered).toHaveLength(2);
    expect(recovered.map((entry) => entry.result.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("compares decimal GitHub event ids monotonically without rolling back", async () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "github-numeric-cursor",
      prompt: "inspect event",
      trigger: { kind: "github", repo: "acme/app" },
    });
    routineStore.update(routine.id, { lastSeenGithubEventId: "9" });
    const runAgent = vi.fn(async () => ({ exitCode: 0, output: "done" }));
    const bridge = new RoutineSchedulerBridge({
      routineStore,
      schedulerStore,
      runAgent,
      now: f.clock,
      ownerId: "numeric-owner",
      leaseMs: 10_000,
    });

    await expect(
      bridge.pollGithub(routineStore.get(routine.id), {
        fetchEvents: async () => [
          {
            id: "10",
            type: "PushEvent",
            created_at: "2026-08-11T03:00:06.000Z",
          },
        ],
      }),
    ).resolves.toMatchObject({ result: { status: "succeeded" } });
    await expect(
      bridge.pollGithub(routineStore.get(routine.id), {
        fetchEvents: async () => [
          {
            id: "8",
            type: "PushEvent",
            created_at: "2026-08-11T03:00:07.000Z",
          },
        ],
      }),
    ).resolves.toBeNull();
    expect(routineStore.get(routine.id).lastSeenGithubEventId).toBe("10");
    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("rejects a GitHub batch rebound to another repository", () => {
    const f = fixture();
    const routineStore = f.openRoutine();
    const schedulerStore = f.openScheduler();
    const routine = routineStore.create({
      name: "github-authority",
      prompt: "inspect event",
      trigger: { kind: "github", repo: "acme/app" },
    });
    const occurrence = enqueueGithubRoutine(
      schedulerStore,
      routine,
      [
        {
          id: "401",
          type: "PushEvent",
          created_at: "2026-08-11T03:00:08.000Z",
        },
      ],
      "401",
      { availableAt: f.now },
    );
    const github = { ...occurrence.payload.github, repo: "evil/app" };
    const rebound = {
      ...occurrence,
      payload: {
        ...occurrence.payload,
        github,
        githubDigest: routineGithubBatchDigest(github),
      },
    };

    expect(
      authorizeRoutineOccurrence({
        job: schedulerStore.getJob(occurrence.jobId),
        occurrence: rebound,
      }),
    ).toEqual({
      allowed: false,
      reason: "routine_authority_mismatch",
    });
  });
});
