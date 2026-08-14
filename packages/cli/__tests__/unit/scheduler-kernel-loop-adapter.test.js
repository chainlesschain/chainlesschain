import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOOP_AGENT_CAPABILITY,
  LOOP_PROCESS_CAPABILITY,
  LoopSchedulerBridge,
  authorizeLoopOccurrence,
  buildLoopSchedulerJob,
  createLoopSchedulerAdapter,
  enqueueLoopIteration,
  loopExecutionDigest,
  loopExecutionSnapshot,
  migrateSavedLoopSession,
  rollbackSavedLoopMigration,
} from "../../src/lib/scheduler-kernel/loop-adapter.js";
import { SchedulerRuntime } from "../../src/lib/scheduler-kernel/runtime.js";
import { summarizeLoopEvents } from "../../src/lib/loop.js";
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

  function savedSession(
    sessionId = "loop-session-1",
    sessionDirectory = join(tmpdir(), "sessions"),
  ) {
    const events = [
      {
        type: "loop_config",
        data: {
          execMode: true,
          operands: ["npm", "test"],
          dynamic: false,
          every: "1s",
          maxIterations: 3,
          untilExitZero: false,
          until: null,
          cwd: "C:/workspace",
        },
        hash: "head-0",
      },
    ];
    return {
      sessionId,
      sessionFilePath: (id) => join(sessionDirectory, `${id}.jsonl`),
      config: events[0].data,
      readEvents: () => events.map((event) => structuredClone(event)),
      appendEventIfHead: (id, type, data, expectedHeadHash) => {
        expect(id).toBe(sessionId);
        const actualHeadHash = events[events.length - 1]?.hash || null;
        if (actualHeadHash !== expectedHeadHash) {
          const error = new Error("stale loop session head");
          error.code = "SESSION_REVISION_STALE";
          throw error;
        }
        const event = {
          type,
          data: structuredClone(data),
          hash: `head-${events.length}`,
        };
        events.push(event);
        return structuredClone(event);
      },
      events,
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

  it("migrates and safely rolls back one saved Loop session", () => {
    const f = fixture();
    const store = f.open();
    const session = savedSession();
    const definition = f.definition({ cwd: "C:/workspace" });

    const migrated = migrateSavedLoopSession({
      schedulerStore: store,
      definition,
      ...session,
    });
    expect(migrated).toMatchObject({
      state: "retired",
      entries: [
        {
          domain: "loop-iteration",
          sourceId: session.sessionId,
          rollbackStrategy: "disable",
        },
      ],
    });
    expect(store.getJob(migrated.entries[0].targetJobId)).toMatchObject({
      enabled: true,
    });
    expect(
      session.events.filter(
        (event) => event.type === "loop_scheduler_migration",
      ),
    ).toHaveLength(1);
    const legacyConfig = session.events
      .filter((event) => event.type === "loop_config")
      .at(-1).data;
    expect(legacyConfig.operands).toEqual([]);
    expect(legacyConfig.schedulerMigrationFence).toMatchObject({
      state: "retired",
      migrationId: migrated.id,
      originalConfig: session.config,
    });
    expect(summarizeLoopEvents(session.events)).toMatchObject({
      config: session.config,
      schedulerMigration: { state: "retired", migrationId: migrated.id },
    });
    expect(session.events.at(-1).data).toMatchObject({
      state: "retired",
      migrationId: migrated.id,
      compatibility: "legacy-config-fenced",
    });

    expect(
      migrateSavedLoopSession({
        schedulerStore: store,
        definition,
        ...session,
      }),
    ).toMatchObject({ id: migrated.id, state: "retired" });
    expect(
      session.events.filter(
        (event) => event.type === "loop_scheduler_migration",
      ),
    ).toHaveLength(1);
    expect(
      session.events.filter((event) => event.type === "loop_config"),
    ).toHaveLength(2);

    const rolledBack = rollbackSavedLoopMigration({
      schedulerStore: store,
      migrationId: migrated.id,
      ...session,
    });
    expect(rolledBack.state).toBe("rolled_back");
    expect(store.getJob(migrated.entries[0].targetJobId).enabled).toBe(false);
    expect(session.events.at(-1).data).toMatchObject({
      state: "rolled_back",
      migrationId: migrated.id,
    });
    expect(
      session.events.filter((event) => event.type === "loop_config").at(-1)
        .data,
    ).toEqual(session.config);
    expect(
      rollbackSavedLoopMigration({
        schedulerStore: store,
        migrationId: migrated.id,
        ...session,
      }),
    ).toMatchObject({ state: "rolled_back", id: migrated.id });
  });

  it("uses semantic CAS instead of overwriting a concurrent Loop config", () => {
    const f = fixture();
    const store = f.open();
    const session = savedSession();
    const originalAppend = session.appendEventIfHead;
    let raced = false;
    session.appendEventIfHead = (...args) => {
      if (!raced && args[1] === "loop_config") {
        raced = true;
        originalAppend(
          session.sessionId,
          "loop_config",
          { ...session.config, every: "10s" },
          args[3],
        );
        const error = new Error("stale loop session head");
        error.code = "SESSION_REVISION_STALE";
        throw error;
      }
      return originalAppend(...args);
    };

    expect(() =>
      migrateSavedLoopSession({
        schedulerStore: store,
        definition: f.definition({ cwd: "C:/workspace" }),
        ...session,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "LOOP_SCHEDULER_MIGRATION_SOURCE_CHANGED",
      }),
    );
    expect(
      session.events.filter((event) => event.type === "loop_config").at(-1)
        .data,
    ).toMatchObject({ every: "10s", operands: ["npm", "test"] });
  });

  it("recovers Loop migration after the session marker write", () => {
    const f = fixture();
    const store = f.open();
    const session = savedSession();
    const definition = f.definition({ cwd: "C:/workspace" });
    const migrated = migrateSavedLoopSession({
      schedulerStore: store,
      definition,
      ...session,
    });
    store.db
      .prepare(
        `UPDATE scheduler_domain_migrations SET state = 'retiring',
         completed_at = NULL WHERE migration_id = ?`,
      )
      .run(migrated.id);
    store.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries SET state = 'retiring'
         WHERE migration_id = ?`,
      )
      .run(migrated.id);

    expect(
      migrateSavedLoopSession({
        schedulerStore: store,
        definition,
        ...session,
      }),
    ).toMatchObject({ id: migrated.id, state: "retired" });
    expect(
      session.events.filter(
        (event) => event.type === "loop_scheduler_migration",
      ),
    ).toHaveLength(1);
    expect(store.getJob(migrated.entries[0].targetJobId).enabled).toBe(true);
  });

  it("does not bind an unlocated legacy migration from a same-id session in another directory", () => {
    const f = fixture();
    const store = f.open();
    const original = savedSession("loop-session-1", join(f.root, "original"));
    const definition = f.definition({ cwd: "C:/workspace" });
    const migrated = migrateSavedLoopSession({
      schedulerStore: store,
      definition,
      ...original,
    });
    store.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries
         SET source_locator_json = NULL WHERE migration_id = ?`,
      )
      .run(migrated.id);
    const other = savedSession("loop-session-1", join(f.root, "other"));

    expect(() =>
      migrateSavedLoopSession({
        schedulerStore: store,
        definition,
        ...other,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "LOOP_SCHEDULER_MIGRATION_LOCATOR_UNPROVEN",
      }),
    );
    expect(
      store.getDomainMigration(migrated.id).entries[0].sourceLocator,
    ).toBeNull();
  });

  it("rejects a wrong rollback session before changing journal or target", () => {
    const f = fixture();
    const store = f.open();
    const session = savedSession();
    const migrated = migrateSavedLoopSession({
      schedulerStore: store,
      definition: f.definition({ cwd: "C:/workspace" }),
      ...session,
    });
    const targetBefore = store.getJob(migrated.entries[0].targetJobId);

    expect(() =>
      rollbackSavedLoopMigration({
        schedulerStore: store,
        migrationId: migrated.id,
        ...session,
        sessionId: "different-loop-session",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "LOOP_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
      }),
    );
    expect(store.getDomainMigration(migrated.id)).toMatchObject({
      state: "retired",
      entries: [{ state: "retired" }],
    });
    expect(store.getJob(migrated.entries[0].targetJobId)).toEqual(targetBefore);
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
    expect(
      store.db
        .prepare("SELECT status, units FROM scheduler_authority_reservations")
        .get(),
    ).toEqual({ status: "succeeded", units: 1 });
  });

  it("pauses before the external runner and resumes the same attempt exactly once", async () => {
    const f = fixture();
    const store = f.open();
    const definition = f.definition();
    const occurrence = enqueueLoopIteration(store, definition, 1, {
      scheduledFor: f.now,
    });
    const runIteration = vi.fn(async () => ({
      exitCode: 0,
      output: "done",
      durationMs: 1,
    }));
    const productionAdapter = createLoopSchedulerAdapter({ runIteration });
    let pauseBeforeCheckpoint = true;
    const adapter = {
      ...productionAdapter,
      async execute(context) {
        if (pauseBeforeCheckpoint) {
          pauseBeforeCheckpoint = false;
          store.requestOccurrencePause({
            occurrenceId: context.occurrence.id,
            expectedFence: context.occurrence.fence,
            requestId: "loop-adapter-checkpoint-pause",
            capability: productionAdapter.runtimeControl,
          });
        }
        return productionAdapter.execute(context);
      },
    };
    const runtime = new SchedulerRuntime({
      store,
      adapters: [adapter],
      authorize: authorizeLoopOccurrence,
      ownerId: "loop-checkpoint-owner",
      leaseMs: 1_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "paused",
      occurrence: { id: occurrence.id, status: "retry_wait", attempt: 1 },
      control: {
        state: "paused",
        checkpoint: {
          safePoint: "adapter_checkpoint",
          data: { iteration: 1, phase: "before_runner" },
        },
      },
    });
    expect(runIteration).not.toHaveBeenCalled();

    const pausedControl = store.getOccurrenceControl(occurrence.id);
    const resumed = store.resumeOccurrence({
      occurrenceId: occurrence.id,
      expectedRevision: pausedControl.revision,
      requestId: "loop-adapter-checkpoint-resume",
    });
    expect(resumed.occurrence.id).toBe(occurrence.id);
    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      occurrence: { id: occurrence.id, attempt: 1 },
      result: { iteration: 1, exitCode: 0 },
    });
    expect(runIteration).toHaveBeenCalledTimes(1);

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      alreadySettled: true,
      occurrence: { id: occurrence.id, attempt: 1 },
    });
    expect(runIteration).toHaveBeenCalledTimes(1);
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

  it("runs exactly once after confirmed-not-applied adjudication", async () => {
    const f = fixture();
    const store = f.open();
    const definition = f.definition();
    const occurrence = enqueueLoopIteration(store, definition, 1, {
      scheduledFor: f.now,
    });
    store.claimOccurrence({
      occurrenceId: occurrence.id,
      ownerId: "crashed-owner",
      leaseMs: 1_000,
    });
    f.now += 1_001;
    const failClosed = new LoopSchedulerBridge({
      schedulerStore: store,
      definition,
      runIteration: vi.fn(),
      ownerId: "fail-close-owner",
      leaseMs: 1_000,
    });
    await expect(
      failClosed.runIteration(1, { scheduledFor: occurrence.scheduledFor }),
    ).rejects.toMatchObject({ code: "LOOP_SCHEDULER_OUTCOME_UNKNOWN" });
    const candidate = store.getAdjudicationCase(occurrence.id);
    store.adjudicateOccurrence({
      occurrenceId: occurrence.id,
      decision: "confirmed_not_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: candidate.attempt,
      expectedFence: candidate.fence,
      reasonDigest: `sha256:${"e".repeat(64)}`,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    const runIteration = vi.fn(async () => ({
      exitCode: 0,
      output: "adjudicated retry",
      durationMs: 2,
    }));
    const recovered = new LoopSchedulerBridge({
      schedulerStore: store,
      definition,
      runIteration,
      ownerId: "adjudication-owner",
      leaseMs: 1_000,
    });
    await expect(
      recovered.runIteration(1, { scheduledFor: occurrence.scheduledFor }),
    ).resolves.toMatchObject({ exitCode: 0, output: "adjudicated retry" });
    expect(runIteration).toHaveBeenCalledOnce();
    expect(store.getOccurrence(occurrence.id)).toMatchObject({
      status: "succeeded",
      attempt: 3,
      maxAttempts: 3,
    });
    expect(store.getOccurrenceAdjudication(occurrence.id)).toMatchObject({
      status: "applied",
      decision: "confirmed_not_applied",
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
