import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
  _deps as coworkDeps,
  addSchedule,
  bindSchedulerScheduleFire,
  claimScheduleFire,
  completeSchedulerScheduleFire,
  coworkCronMigrationSourceDigest,
  coworkCronMigrationSourceSnapshot,
  getSchedule,
  prepareCoworkSchedulerMigration,
  restoreCoworkSchedulerMigration,
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
  migrateCoworkCronSchedule,
  rollbackCoworkCronMigration,
} from "../../src/lib/scheduler-kernel/cowork-cron-adapter.js";
import { canonicalSchedulerSourcePath } from "../../src/lib/scheduler-kernel/source-locator-path.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel Cowork cron adapter", () => {
  const cleanups = [];
  const originalNow = coworkDeps.now;
  const originalPersistenceDeps = {
    closeSync: coworkDeps.closeSync,
    fsyncSync: coworkDeps.fsyncSync,
    openSync: coworkDeps.openSync,
    renameSync: coworkDeps.renameSync,
    unlinkSync: coworkDeps.unlinkSync,
    writeSync: coworkDeps.writeSync,
  };

  afterEach(() => {
    coworkDeps.now = originalNow;
    Object.assign(coworkDeps, originalPersistenceDeps);
    while (cleanups.length > 0) cleanups.pop()();
  });

  function coworkSourcePaths(cwd) {
    const directory = join(cwd, ".chainlesschain", "cowork");
    return {
      directory,
      file: join(directory, "schedules.jsonl"),
    };
  }

  function coworkTemporaryFiles(cwd) {
    const { directory } = coworkSourcePaths(cwd);
    return readdirSync(directory).filter(
      (entry) => entry.startsWith("schedules.jsonl.") && entry.endsWith(".tmp"),
    );
  }

  function fsFailure(code, message) {
    return Object.assign(new Error(message), { code });
  }

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
      activeDelivery: {
        ownerId: expect.stringMatching(/^scheduler-migration:/),
        leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
      },
      schedulerExecution: { status: "succeeded", attempt: 1 },
    });
    expect(
      schedulerStore.db
        .prepare("SELECT status, units FROM scheduler_authority_reservations")
        .get(),
    ).toEqual({ status: "succeeded", units: 1 });
  });

  it("migrates Cowork with an old-version delivery fence and rolls it back", () => {
    const f = fixture();
    const schedule = f.add();
    const schedulerStore = f.openScheduler();
    const migrated = migrateCoworkCronSchedule({
      cwd: f.cwd,
      schedulerStore,
      schedule,
    });
    expect(migrated).toMatchObject({
      state: "retired",
      entries: [
        {
          domain: "cowork-cron",
          sourceId: schedule.id,
          rollbackStrategy: "disable",
        },
      ],
    });
    const retired = getSchedule(f.cwd, schedule.id);
    expect(retired).toMatchObject({
      schedulerMigration: { migrationId: migrated.id, state: "retired" },
      activeDelivery: {
        ownerId: `scheduler-migration:${migrated.entries[0].retirementToken}`,
        leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
      },
    });
    expect(
      claimScheduleFire(f.cwd, schedule.id, "legacy-fire", {
        ownerId: "legacy",
        now: f.clock(),
      }),
    ).toBeNull();
    expect(
      migrateCoworkCronSchedule({
        cwd: f.cwd,
        schedulerStore,
        schedule: retired,
      }),
    ).toMatchObject({ id: migrated.id, state: "retired" });

    schedulerStore.beginDomainMigrationRollback(migrated.id);
    const rollbackSource = getSchedule(f.cwd, schedule.id);
    restoreCoworkSchedulerMigration(f.cwd, schedule.id, {
      migrationId: migrated.id,
      sourceDigest: coworkCronMigrationSourceDigest(rollbackSource),
      targetJobId: migrated.entries[0].targetJobId,
      retirementToken: migrated.entries[0].retirementToken,
    });
    expect(schedulerStore.getDomainMigration(migrated.id)).toMatchObject({
      state: "rolling_back",
    });
    expect(
      rollbackCoworkCronMigration({
        cwd: f.cwd,
        schedulerStore,
        migrationId: migrated.id,
      }),
    ).toMatchObject({ state: "rolled_back" });
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      enabled: true,
      activeDelivery: null,
    });
    expect(getSchedule(f.cwd, schedule.id)).not.toHaveProperty(
      "schedulerMigration",
    );
    expect(
      schedulerStore.getJob(migrated.entries[0].targetJobId),
    ).toMatchObject({
      enabled: false,
    });
    expect(
      claimScheduleFire(f.cwd, schedule.id, "legacy-fire", {
        ownerId: "legacy",
        now: f.clock(),
      }),
    ).not.toBeNull();
    expect(
      rollbackCoworkCronMigration({
        cwd: f.cwd,
        schedulerStore,
        migrationId: migrated.id,
      }),
    ).toMatchObject({ state: "rolled_back", deduplicated: true });
  });

  it("keeps the Cowork source intact on migration ENOSPC and converges after restart", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const { file } = coworkSourcePaths(f.cwd);
    const before = readFileSync(file, "utf8");
    const schedulerStore = f.openScheduler();
    coworkDeps.writeSync = () => {
      throw fsFailure("ENOSPC", "fault injection: disk full");
    };

    expect(() =>
      migrateCoworkCronSchedule({
        cwd: f.cwd,
        schedulerStore,
        schedule,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ENOSPC",
        commitState: "not-committed",
      }),
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(getSchedule(f.cwd, schedule.id)).not.toHaveProperty(
      "schedulerMigration",
    );
    expect(coworkTemporaryFiles(f.cwd)).toEqual([]);

    coworkDeps.writeSync = originalPersistenceDeps.writeSync;
    const restartedStore = f.openScheduler();
    expect(
      migrateCoworkCronSchedule({
        cwd: f.cwd,
        schedulerStore: restartedStore,
        schedule: getSchedule(f.cwd, schedule.id),
      }),
    ).toMatchObject({ state: "retired" });
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      schedulerMigration: { state: "retired" },
      activeDelivery: {
        leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
      },
    });
  });

  it("completes repeated short writes before atomically replacing the Cowork source", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    let writeCalls = 0;
    coworkDeps.writeSync = (descriptor, buffer, offset, length, position) => {
      writeCalls += 1;
      return originalPersistenceDeps.writeSync(
        descriptor,
        buffer,
        offset,
        Math.min(7, length),
        position,
      );
    };

    prepareCoworkSchedulerMigration(f.cwd, schedule.id, {
      migrationId: "migration-short-write",
      sourceDigest: coworkCronMigrationSourceDigest(schedule),
      targetJobId: "job-short-write",
    });

    expect(writeCalls).toBeGreaterThan(1);
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      schedulerMigration: {
        migrationId: "migration-short-write",
        state: "prepared",
      },
    });
    expect(coworkTemporaryFiles(f.cwd)).toEqual([]);
  });

  it("discards a partial rollback temp file, stays fenced, and resumes cleanly", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const schedulerStore = f.openScheduler();
    const migrated = migrateCoworkCronSchedule({
      cwd: f.cwd,
      schedulerStore,
      schedule,
    });
    const { file } = coworkSourcePaths(f.cwd);
    const retiredSource = readFileSync(file, "utf8");
    let writeCalls = 0;
    coworkDeps.writeSync = (descriptor, buffer, offset, length, position) => {
      writeCalls += 1;
      if (writeCalls === 1) {
        return originalPersistenceDeps.writeSync(
          descriptor,
          buffer,
          offset,
          Math.max(1, Math.floor(length / 3)),
          position,
        );
      }
      throw fsFailure("EIO", "fault injection: partial write");
    };

    expect(() =>
      rollbackCoworkCronMigration({
        cwd: f.cwd,
        schedulerStore,
        migrationId: migrated.id,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "SCHEDULER_STORAGE_UNAVAILABLE",
        details: {
          phase: "write",
          storageCode: "EIO",
          commitState: "not_committed",
          retryable: false,
        },
      }),
    );
    expect(readFileSync(file, "utf8")).toBe(retiredSource);
    expect(coworkTemporaryFiles(f.cwd)).toEqual([]);
    expect(
      claimScheduleFire(f.cwd, schedule.id, "must-remain-fenced", {
        ownerId: "legacy-after-partial-write",
        now: f.clock(),
      }),
    ).toBeNull();

    coworkDeps.writeSync = originalPersistenceDeps.writeSync;
    expect(
      rollbackCoworkCronMigration({
        cwd: f.cwd,
        schedulerStore: f.openScheduler(),
        migrationId: migrated.id,
      }),
    ).toMatchObject({ state: "rolled_back" });
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      enabled: true,
      activeDelivery: null,
    });
    expect(getSchedule(f.cwd, schedule.id)).not.toHaveProperty(
      "schedulerMigration",
    );
  });

  it("uses a private exclusive temp and cleans it when file fsync fails", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const { file } = coworkSourcePaths(f.cwd);
    const before = readFileSync(file, "utf8");
    const openCalls = [];
    coworkDeps.openSync = (...args) => {
      openCalls.push(args);
      return originalPersistenceDeps.openSync(...args);
    };
    coworkDeps.closeSync = vi.fn(originalPersistenceDeps.closeSync);
    coworkDeps.fsyncSync = () => {
      throw fsFailure("EIO", "fault injection: file fsync");
    };

    expect(() =>
      prepareCoworkSchedulerMigration(f.cwd, schedule.id, {
        migrationId: "migration-file-fsync",
        sourceDigest: coworkCronMigrationSourceDigest(schedule),
        targetJobId: "job-file-fsync",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "EIO",
        commitState: "not-committed",
      }),
    );
    expect(openCalls).toEqual([
      [expect.stringMatching(/schedules\.jsonl\..+\.tmp$/), "wx", 0o600],
    ]);
    expect(coworkDeps.closeSync).toHaveBeenCalledOnce();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(coworkTemporaryFiles(f.cwd)).toEqual([]);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("keeps the authoritative migration source when atomic rename fails", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const { file } = coworkSourcePaths(f.cwd);
    const before = readFileSync(file, "utf8");
    coworkDeps.renameSync = () => {
      throw fsFailure("EACCES", "fault injection: rename denied");
    };

    expect(() =>
      prepareCoworkSchedulerMigration(f.cwd, schedule.id, {
        migrationId: "migration-rename",
        sourceDigest: coworkCronMigrationSourceDigest(schedule),
        targetJobId: "job-rename",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "EACCES",
        commitState: "not-committed",
      }),
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(getSchedule(f.cwd, schedule.id)).not.toHaveProperty(
      "schedulerMigration",
    );
    expect(coworkTemporaryFiles(f.cwd)).toEqual([]);
  });

  it.runIf(process.platform !== "win32")(
    "reports unknown commit after directory fsync and converges from the complete source",
    () => {
      const f = fixture();
      const schedule = f.add({ cron: "0 0 1 1 *" });
      const schedulerStore = f.openScheduler();
      let fsyncCalls = 0;
      coworkDeps.fsyncSync = (descriptor) => {
        fsyncCalls += 1;
        if (fsyncCalls === 2) {
          throw fsFailure("EIO", "fault injection: directory fsync");
        }
        return originalPersistenceDeps.fsyncSync(descriptor);
      };

      expect(() =>
        migrateCoworkCronSchedule({
          cwd: f.cwd,
          schedulerStore,
          schedule,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "EIO",
          commitState: "unknown",
        }),
      );
      expect(fsyncCalls).toBe(2);
      expect(coworkTemporaryFiles(f.cwd)).toEqual([]);
      expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
        schedulerMigration: { state: "prepared" },
      });

      coworkDeps.fsyncSync = originalPersistenceDeps.fsyncSync;
      expect(
        migrateCoworkCronSchedule({
          cwd: f.cwd,
          schedulerStore: f.openScheduler(),
          schedule: getSchedule(f.cwd, schedule.id),
        }),
      ).toMatchObject({ state: "retired" });
      expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
        schedulerMigration: { state: "retired" },
        activeDelivery: {
          leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
        },
      });
    },
  );

  it("resumes Cowork migration from fresh bridges after staging and retirement crashes", async () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const schedulerStore = f.openScheduler();
    const workspace = canonicalSchedulerSourcePath(f.cwd);
    const desired = buildCoworkCronSchedulerJob(f.cwd, schedule);
    const source = {
      createdAt: schedule.createdAt,
      cron: schedule.cron,
      enabled: schedule.enabled,
      files: schedule.files,
      id: schedule.id,
      templateId: schedule.templateId,
      userMessage: schedule.userMessage,
    };
    const prepared = schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "cowork-cron",
          sourceId: schedule.id,
          sourceScope: {
            store: "cowork-schedules",
            workspace,
          },
          source,
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    expect(prepared.entries[0].sourceLocator).toBeNull();
    prepareCoworkSchedulerMigration(f.cwd, schedule.id, {
      migrationId: prepared.id,
      sourceDigest: coworkCronMigrationSourceDigest(schedule),
      targetJobId: desired.id,
    });
    schedulerStore.applyDomainMigration(prepared.id);
    expect(schedulerStore.getJob(desired.id)).toMatchObject({ enabled: false });

    const afterStagingCrash = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore: f.openScheduler(),
      runTask: vi.fn(),
      now: f.clock,
      ownerId: "cowork-migration-restart-a",
      leaseMs: 10_000,
    });
    await expect(afterStagingCrash.runDue()).resolves.toEqual([]);
    expect(schedulerStore.getDomainMigration(prepared.id)).toMatchObject({
      id: prepared.id,
      state: "retired",
      entries: [
        {
          sourceLocator: {
            schemaVersion: 1,
            type: "cowork-workspace",
            workspace,
          },
        },
      ],
    });
    const retired = schedulerStore.getDomainMigration(prepared.id);
    schedulerStore.db
      .prepare(
        `UPDATE scheduler_domain_migrations SET state = 'retiring',
         completed_at = NULL WHERE migration_id = ?`,
      )
      .run(prepared.id);
    schedulerStore.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries SET state = 'retiring'
         WHERE migration_id = ?`,
      )
      .run(prepared.id);
    const afterRetirementCrash = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore: f.openScheduler(),
      runTask: vi.fn(),
      now: f.clock,
      ownerId: "cowork-migration-restart-b",
      leaseMs: 10_000,
    });
    await expect(afterRetirementCrash.runDue()).resolves.toEqual([]);
    expect(schedulerStore.getDomainMigration(prepared.id)).toMatchObject({
      id: prepared.id,
      state: "retired",
      entries: [{ retirementToken: retired.entries[0].retirementToken }],
    });
    expect(schedulerStore.getJob(desired.id)).toMatchObject({ enabled: true });
  });

  it("rolls back a staged Cowork target before retirement assigns a token", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const schedulerStore = f.openScheduler();
    const desired = buildCoworkCronSchedulerJob(f.cwd, schedule);
    const workspace = canonicalSchedulerSourcePath(f.cwd);
    const prepared = schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "cowork-cron",
          sourceId: schedule.id,
          sourceScope: {
            store: "cowork-schedules",
            workspace,
          },
          sourceLocator: {
            schemaVersion: 1,
            type: "cowork-workspace",
            workspace,
          },
          source: coworkCronMigrationSourceSnapshot(schedule),
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    prepareCoworkSchedulerMigration(f.cwd, schedule.id, {
      migrationId: prepared.id,
      sourceDigest: coworkCronMigrationSourceDigest(schedule),
      targetJobId: desired.id,
    });
    const applied = schedulerStore.applyDomainMigration(prepared.id);
    expect(applied.entries[0].retirementToken).toBeNull();

    expect(
      rollbackCoworkCronMigration({
        cwd: f.cwd,
        schedulerStore,
        migrationId: prepared.id,
      }),
    ).toMatchObject({ state: "rolled_back" });
    expect(getSchedule(f.cwd, schedule.id)).not.toHaveProperty(
      "schedulerMigration",
    );
    expect(schedulerStore.getJob(desired.id)).toMatchObject({ enabled: false });
  });

  it("rejects a foreign-domain rollback before changing its journal or target", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const schedulerStore = f.openScheduler();
    const desired = buildCoworkCronSchedulerJob(f.cwd, schedule);
    const directory = canonicalSchedulerSourcePath(f.cwd);
    const prepared = schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "agenda",
          sourceId: schedule.id,
          sourceScope: { store: "agent-schedule", directory },
          sourceLocator: {
            schemaVersion: 1,
            type: "agenda-store",
            directory,
          },
          source: coworkCronMigrationSourceSnapshot(schedule),
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    schedulerStore.applyDomainMigration(prepared.id);
    const beforeMigration = schedulerStore.getDomainMigration(prepared.id);
    const beforeTarget = schedulerStore.getJob(desired.id);

    expect(() =>
      rollbackCoworkCronMigration({
        cwd: f.cwd,
        schedulerStore,
        migrationId: prepared.id,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "COWORK_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
      }),
    );
    expect(schedulerStore.getDomainMigration(prepared.id).state).toBe(
      beforeMigration.state,
    );
    expect(schedulerStore.getJob(desired.id).revision).toBe(
      beforeTarget.revision,
    );
  });

  it("rejects a Cowork rollback from another workspace before changing its journal or target", () => {
    const f = fixture();
    const schedule = f.add({ cron: "0 0 1 1 *" });
    const schedulerStore = f.openScheduler();
    const migrated = migrateCoworkCronSchedule({
      cwd: f.cwd,
      schedulerStore,
      schedule,
    });
    const beforeMigration = schedulerStore.getDomainMigration(migrated.id);
    const beforeTarget = schedulerStore.getJob(migrated.entries[0].targetJobId);

    expect(() =>
      rollbackCoworkCronMigration({
        cwd: join(f.root, "wrong-workspace"),
        schedulerStore,
        migrationId: migrated.id,
      }),
    ).toThrow(
      expect.objectContaining({
        code: "COWORK_SCHEDULER_MIGRATION_SOURCE_UNBOUND",
      }),
    );
    expect(schedulerStore.getDomainMigration(migrated.id).state).toBe(
      beforeMigration.state,
    );
    expect(
      schedulerStore.getJob(migrated.entries[0].targetJobId).revision,
    ).toBe(beforeTarget.revision);
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

  it("clears the permanent delivery fence before one adjudicated retry", async () => {
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
      ownerId: "crashed-cowork-owner",
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
    const failClosed = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask: vi.fn(),
      now: f.clock,
      ownerId: "cowork-fail-close-owner",
      leaseMs: 10_000,
    });
    await failClosed.runDue();
    const candidate = schedulerStore.getAdjudicationCase(occurrence.id);
    schedulerStore.adjudicateOccurrence({
      occurrenceId: occurrence.id,
      decision: "confirmed_not_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: candidate.attempt,
      expectedFence: candidate.fence,
      reasonDigest: `sha256:${"3".repeat(64)}`,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    const runTask = vi.fn(async () => ({
      taskId: "task-adjudicated",
      status: "completed",
    }));
    const recovered = new CoworkCronSchedulerBridge({
      cwd: f.cwd,
      schedulerStore,
      runTask,
      now: f.clock,
      ownerId: "cowork-adjudication-owner",
      leaseMs: 10_000,
    });
    await expect(recovered.runDue()).resolves.toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "succeeded" }),
      }),
    ]);
    expect(runTask).toHaveBeenCalledOnce();
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      lastDeliveryId: occurrence.triggerKey,
      schedulerExecution: { status: "succeeded", attempt: 3 },
      activeDelivery: {
        ownerId: expect.stringMatching(/^scheduler-migration:/),
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
      activeDelivery: {
        ownerId: expect.stringMatching(/^scheduler-migration:/),
        leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
      },
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
    coworkDeps.renameSync = originalPersistenceDeps.renameSync;
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(getSchedule(f.cwd, schedule.id)).toMatchObject({
      schedulerExecution: { status: "running" },
      activeDelivery: {
        leaseExpiresAt: COWORK_SCHEDULER_UNKNOWN_LEASE_EXPIRES_AT,
      },
    });
  });
});
