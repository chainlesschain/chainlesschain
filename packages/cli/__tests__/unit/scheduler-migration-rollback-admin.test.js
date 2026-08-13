import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildSchedulerMigrationRollbackChallenge,
  rollbackSchedulerMigration,
  showSchedulerMigrationRollback,
} from "../../src/lib/scheduler-kernel/migration-rollback-admin.js";
import { createSchedulerMigrationAdminRepository } from "../../src/lib/scheduler-kernel/migration-admin.js";
import {
  openSchedulerStore,
  schedulerJobDefinitionDigest,
  schedulerMigrationScopeDigest,
  schedulerMigrationSourceDigest,
} from "../../src/lib/scheduler-kernel/store.js";
import {
  migrateSavedLoopSession,
  rollbackSavedLoopMigration,
} from "../../src/lib/scheduler-kernel/loop-adapter.js";
import { summarizeLoopEvents } from "../../src/lib/loop.js";
import {
  addSchedule,
  coworkCronMigrationSourceDigest,
  coworkCronMigrationSourceSnapshot,
  prepareCoworkSchedulerMigration,
  retireCoworkSchedulerMigration,
  saveSchedules,
} from "../../src/lib/cowork-cron.js";

const cleanups = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function fixture() {
  const scope = { store: "routines", directory: "C:\\safe-routines" };
  const snapshot = {
    id: "daily",
    name: "Daily",
    prompt: "status",
    trigger: { kind: "cron", cron: "0 9 * * *" },
    enabled: true,
  };
  const retirementSource = {
    ...snapshot,
    enabled: false,
    schedulerMigration: {
      schemaVersion: 1,
      state: "retired",
      migrationId: "scheduler-domain-migration-rollback-test",
      sourceDigest: "native-digest",
      targetJobId: "routine:daily",
      retirementToken: "retirement-test",
    },
  };
  const targetJob = {
    id: "routine:daily",
    kind: "routine",
    trigger: { channel: "cron", cron: "0 9 * * *" },
    payload: { routineId: "daily" },
    authority: {
      schemaVersion: 1,
      principal: { type: "routine", id: "daily" },
      tenantId: "tenant-test",
      workspaceId: "workspace-test",
      requestedCapabilities: ["agent.execute"],
      authorizationRefs: {
        decisionId: "decision-test",
        policyRevision: "policy-test",
        grantIds: [],
        approvalIds: [],
        delegationIds: [],
      },
    },
    enabled: true,
    maxAttempts: 3,
  };
  const migration = {
    id: "scheduler-domain-migration-rollback-test",
    state: "retired",
    entryCount: 1,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    createdAt: 100,
    updatedAt: 200,
    completedAt: 200,
    lastError: null,
    manifest: {
      entries: [
        {
          entryId: "scheduler-migration-entry-test",
          targetJob,
        },
      ],
    },
    entries: [
      {
        migrationId: "scheduler-domain-migration-rollback-test",
        entryId: "scheduler-migration-entry-test",
        domain: "routine",
        sourceId: "daily",
        sourceScopeDigest: schedulerMigrationScopeDigest(scope),
        sourceLocator: {
          schemaVersion: 1,
          type: "routine-store",
          directory: scope.directory,
        },
        sourceDigest: schedulerMigrationSourceDigest(snapshot),
        targetJobId: "routine:daily",
        targetJobDigest: schedulerJobDefinitionDigest(targetJob),
        rollbackStrategy: "disable",
        state: "retired",
        targetAction: "created",
        targetAppliedRevision: 3,
        targetAppliedAt: 150,
        targetOccurrenceCountBefore: 0,
        targetExecutionEventCountBefore: 0,
        targetRollbackRevision: 3,
        retirementToken: "retirement-test",
        sourceRetirementDigest:
          schedulerMigrationSourceDigest(retirementSource),
        sourceRestoredDigest: null,
        createdAt: 100,
        updatedAt: 200,
      },
    ],
  };
  const target = {
    jobId: "routine:daily",
    exists: true,
    revision: 3,
    enabled: true,
    occurrenceCount: 0,
    eventCount: 1,
    executionEventCount: 0,
    definitionDigest: schedulerJobDefinitionDigest({
      ...targetJob,
      enabled: false,
    }),
  };
  const repository = {
    get: vi.fn(() => migration),
    getTarget: vi.fn(() => target),
  };
  return {
    migration,
    repository,
    retirementSource,
    scope,
    snapshot,
    target,
  };
}

function validSource(
  { migration, retirementSource, scope, snapshot },
  rollback,
  { markerState = "retired" } = {},
) {
  const marker = {
    ...retirementSource.schedulerMigration,
    state: markerState,
    ...(markerState === "prepared" ? { retirementToken: undefined } : {}),
  };
  return {
    scope,
    snapshot,
    nativeSourceDigest: "native-digest",
    marker: { ...marker, migrationId: migration.id },
    retirementSource,
    rollback,
  };
}

function expectedDigest(repository, migrationId) {
  return showSchedulerMigrationRollback(repository, migrationId).rollback
    .evidenceDigest;
}

describe("scheduler migration rollback admin", () => {
  it("sanitizes recorded source inspection errors before they reach the CLI", async () => {
    const test = fixture();
    const privatePath = String.raw`C:\private\scheduler\routines.json`;
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          resolveSource: () => {
            throw new Error(`malformed scheduler source at ${privatePath}`);
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_INSPECT_FAILED",
      message:
        "Scheduler rollback could not inspect the recorded routine source",
    });

    try {
      await rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          resolveSource: () => {
            throw new Error(`malformed scheduler source at ${privatePath}`);
          },
        },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(privatePath);
    }
  });

  it("publishes a deterministic show-derived evidence digest", () => {
    const test = fixture();
    const first = showSchedulerMigrationRollback(
      test.repository,
      test.migration.id,
    );
    const second = showSchedulerMigrationRollback(
      test.repository,
      test.migration.id,
    );
    expect(first.rollback).toMatchObject({
      eligible: true,
      evidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(second.rollback.evidenceDigest).toBe(first.rollback.evidenceDigest);
  });

  it.each(["applied", "verified", "retiring"])(
    "accepts a prepared source marker while the journal is %s",
    async (state) => {
      const test = fixture();
      test.migration.state = state;
      test.migration.entries[0].state = state;
      test.migration.entries[0].sourceRetirementDigest = null;
      test.migration.entries[0].retirementToken =
        state === "retiring" ? "retirement-test" : null;
      const readChallenge = vi.fn(() => {
        const error = new Error("stop after source evidence");
        error.code = "TEST_SOURCE_EVIDENCE_ACCEPTED";
        throw error;
      });
      const mutateTarget = vi.fn();
      await expect(
        rollbackSchedulerMigration({
          schedulerStore: {},
          repository: test.repository,
          migrationId: test.migration.id,
          options: {
            expectedEvidenceDigest: expectedDigest(
              test.repository,
              test.migration.id,
            ),
          },
          dependencies: {
            stdin: { isTTY: true },
            stdout: { isTTY: true },
            readChallenge,
            resolveSource: () =>
              validSource(test, mutateTarget, { markerState: "prepared" }),
          },
        }),
      ).rejects.toMatchObject({ code: "TEST_SOURCE_EVIDENCE_ACCEPTED" });
      expect(readChallenge).toHaveBeenCalledOnce();
      expect(mutateTarget).not.toHaveBeenCalled();
    },
  );

  it("rejects changed retirement evidence before prompting or mutating", async () => {
    const test = fixture();
    const readChallenge = vi.fn();
    const mutateTarget = vi.fn();
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge,
          resolveSource: () => ({
            ...validSource(test, mutateTarget),
            retirementSource: {
              ...test.retirementSource,
              unexpectedRuntimeMutation: true,
            },
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_RETIREMENT_EVIDENCE_CHANGED",
    });
    expect(readChallenge).not.toHaveBeenCalled();
    expect(mutateTarget).not.toHaveBeenCalled();
  });

  it("rechecks retirement evidence after the typed challenge", async () => {
    const test = fixture();
    const mutateTarget = vi.fn();
    let sourceReads = 0;
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge: (challenge) => challenge,
          resolveSource: () => {
            sourceReads += 1;
            const evidence = validSource(test, mutateTarget);
            if (sourceReads === 2) {
              evidence.retirementSource = {
                ...test.retirementSource,
                changedAfterChallenge: true,
              };
            }
            return evidence;
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_RETIREMENT_EVIDENCE_CHANGED",
    });
    expect(sourceReads).toBe(2);
    expect(mutateTarget).not.toHaveBeenCalled();
  });

  it.each(["agenda", "cowork-cron", "routine", "automation"])(
    "resumes a %s rollback after the source was restored before journal confirmation",
    async (domain) => {
      const test = fixture();
      test.migration.state = "rolling_back";
      Object.assign(test.migration.entries[0], {
        domain,
        state: "rollback_target_disabled",
      });
      const rollback = vi.fn(() => {
        test.migration.state = "rolled_back";
        test.migration.entries[0].state = "rolled_back";
      });
      let reads = 0;
      const resolveSource = () => {
        reads += 1;
        return {
          ...validSource(test, rollback),
          marker: null,
          hasRetirementFence: false,
          retirementSource: test.snapshot,
        };
      };
      const digest = expectedDigest(test.repository, test.migration.id);

      const result = await rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: { expectedEvidenceDigest: digest },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge: (challenge) => challenge,
          resolveSource,
        },
      });

      expect(result.state).toBe("rolled_back");
      expect(reads).toBe(2);
      expect(rollback).toHaveBeenCalledOnce();
    },
  );

  it.each(["retired", "rolled_back"])(
    "resumes a Loop rollback with restored config and a %s marker",
    async (markerState) => {
      const test = fixture();
      test.migration.state = "rolling_back";
      Object.assign(test.migration.entries[0], {
        domain: "loop-iteration",
        state: "rollback_target_disabled",
      });
      const rollback = vi.fn(() => {
        test.migration.state = "rolled_back";
        test.migration.entries[0].state = "rolled_back";
      });
      const resolveSource = () => ({
        ...validSource(test, rollback),
        marker: {
          schemaVersion: 1,
          state: markerState,
          migrationId: test.migration.id,
          targetJobId: test.migration.entries[0].targetJobId,
          retirementToken: test.migration.entries[0].retirementToken,
        },
        hasRetirementFence: false,
        retirementSource: test.snapshot,
      });
      const digest = expectedDigest(test.repository, test.migration.id);

      const result = await rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: { expectedEvidenceDigest: digest },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge: (challenge) => challenge,
          resolveSource,
        },
      });

      expect(result.state).toBe("rolled_back");
      expect(rollback).toHaveBeenCalledOnce();
    },
  );

  it("blocks crash-resume before source restore when the rollback target changed", async () => {
    const test = fixture();
    test.migration.state = "rolling_back";
    test.migration.entries[0].state = "rollback_target_disabled";
    test.target.enabled = false;
    test.target.definitionDigest = `sha256:${"f".repeat(64)}`;
    const readChallenge = vi.fn();
    const resolveSource = vi.fn();
    const evidenceDigest = expectedDigest(test.repository, test.migration.id);

    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: { expectedEvidenceDigest: evidenceDigest },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge,
          resolveSource,
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_BLOCKED",
      details: {
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "TARGET_DEFINITION_CHANGED" }),
        ]),
      },
    });
    expect(resolveSource).not.toHaveBeenCalled();
    expect(readChallenge).not.toHaveBeenCalled();
  });

  it("resumes the production Loop rollback path after config restore but before the rolled_back marker", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-rollback-admin-loop-crash-"));
    const store = openSchedulerStore({
      file: ":memory:",
      Database,
    });
    cleanups.push(() => {
      store.close();
      rmSync(root, { recursive: true, force: true });
    });

    const sessionId = `loop-rollback-crash-${Date.now()}`;
    const sessionFilePath = (id) => join(root, "sessions", `${id}.jsonl`);
    const config = {
      execMode: true,
      operands: ["npm", "test"],
      dynamic: false,
      every: "1s",
      maxIterations: 3,
      untilExitZero: false,
      until: null,
      cwd: root,
    };
    const events = [{ type: "loop_config", data: config, hash: "head-0" }];
    const readSessionEvents = (id) => {
      expect(id).toBe(sessionId);
      return events.map((event) => structuredClone(event));
    };
    const appendSessionEvent = (id, type, data, expectedHeadHash) => {
      expect(id).toBe(sessionId);
      expect(expectedHeadHash).toBe(events.at(-1)?.hash || null);
      const event = {
        type,
        data: structuredClone(data),
        hash: `head-${events.length}`,
      };
      events.push(event);
      return structuredClone(event);
    };
    const migrated = migrateSavedLoopSession({
      schedulerStore: store,
      sessionId,
      config,
      definition: {
        executionId: sessionId,
        cwd: root,
        execMode: true,
        operands: ["npm", "test"],
        dynamic: false,
      },
      readEvents: readSessionEvents,
      appendEventIfHead: appendSessionEvent,
      sessionFilePath,
    });

    const crashBeforeMarker = (...args) => {
      if (
        args[1] === "loop_scheduler_migration" &&
        args[2]?.state === "rolled_back"
      ) {
        const error = new Error("simulated crash before rolled_back marker");
        error.code = "TEST_LOOP_ROLLBACK_CRASH";
        throw error;
      }
      return appendSessionEvent(...args);
    };
    expect(() =>
      rollbackSavedLoopMigration({
        schedulerStore: store,
        sessionId,
        config,
        migrationId: migrated.id,
        readEvents: readSessionEvents,
        appendEventIfHead: crashBeforeMarker,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEST_LOOP_ROLLBACK_CRASH" }),
    );

    expect(store.getDomainMigration(migrated.id)).toMatchObject({
      state: "rolling_back",
      entries: [{ state: "rollback_target_disabled" }],
    });
    const crashedEvents = readSessionEvents(sessionId);
    expect(
      crashedEvents.filter((event) => event.type === "loop_config").at(-1).data,
    ).toEqual(config);
    expect(summarizeLoopEvents(crashedEvents).schedulerMigration).toMatchObject(
      {
        state: "retired",
        migrationId: migrated.id,
      },
    );

    const repository = createSchedulerMigrationAdminRepository(store);
    const evidenceDigest = showSchedulerMigrationRollback(
      repository,
      migrated.id,
    ).rollback.evidenceDigest;
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: store,
        repository,
        migrationId: migrated.id,
        options: { expectedEvidenceDigest: evidenceDigest },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge: (challenge) => challenge,
          readEvents: readSessionEvents,
          appendEventIfHead: appendSessionEvent,
          sessionPath: sessionFilePath,
        },
      }),
    ).resolves.toMatchObject({
      state: "rolled_back",
      journal: { entries: [{ state: "rolled_back" }] },
    });
    expect(readSessionEvents(sessionId).at(-1)).toMatchObject({
      type: "loop_scheduler_migration",
      data: { state: "rolled_back", migrationId: migrated.id },
    });
    expect(store.getJob(migrated.entries[0].targetJobId).enabled).toBe(false);
  });

  it("rejects an expired Cowork retirement lease before target mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "cc-rollback-admin-cowork-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const workspacePath = join(root, "workspace");
    const workspace =
      process.platform === "win32"
        ? resolve(workspacePath).toLowerCase()
        : resolve(workspacePath);
    const schedule = addSchedule(workspace, {
      cron: "0 * * * * *",
      templateId: "doc-convert",
      userMessage: "scheduled cowork",
      files: [],
    });
    const migrationId = "scheduler-domain-migration-cowork-lease";
    const targetJobId = "cowork-cron:lease-test";
    const nativeSourceDigest = coworkCronMigrationSourceDigest(schedule);
    prepareCoworkSchedulerMigration(workspace, schedule.id, {
      migrationId,
      sourceDigest: nativeSourceDigest,
      targetJobId,
    });
    const retired = retireCoworkSchedulerMigration(workspace, schedule.id, {
      migrationId,
      sourceDigest: nativeSourceDigest,
      targetJobId,
      retirementToken: "cowork-retirement-test",
    });
    saveSchedules(workspace, [
      {
        ...retired,
        activeDelivery: {
          ...retired.activeDelivery,
          leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
        },
      },
    ]);
    const sourceScope = { store: "cowork-schedules", workspace };
    const migration = {
      id: migrationId,
      state: "retiring",
      entryCount: 1,
      manifestDigest: `sha256:${"a".repeat(64)}`,
      createdAt: 100,
      updatedAt: 200,
      completedAt: null,
      lastError: null,
      entries: [
        {
          migrationId,
          entryId: "scheduler-migration-entry-cowork-lease",
          domain: "cowork-cron",
          sourceId: schedule.id,
          sourceScopeDigest: schedulerMigrationScopeDigest(sourceScope),
          sourceLocator: {
            schemaVersion: 1,
            type: "cowork-workspace",
            workspace,
          },
          sourceDigest: schedulerMigrationSourceDigest(
            coworkCronMigrationSourceSnapshot(schedule),
          ),
          targetJobId,
          targetJobDigest: `sha256:${"d".repeat(64)}`,
          rollbackStrategy: "disable",
          state: "retiring",
          targetAction: "created",
          targetAppliedRevision: 3,
          targetAppliedAt: 150,
          targetOccurrenceCountBefore: 0,
          targetExecutionEventCountBefore: 0,
          targetRollbackRevision: null,
          retirementToken: "cowork-retirement-test",
          sourceRetirementDigest: null,
          sourceRestoredDigest: null,
          createdAt: 100,
          updatedAt: 200,
        },
      ],
    };
    const repository = {
      get: () => migration,
      getTarget: () => ({
        jobId: targetJobId,
        exists: true,
        revision: 3,
        enabled: true,
        occurrenceCount: 0,
        eventCount: 1,
        executionEventCount: 0,
      }),
    };
    const beginDomainMigrationRollback = vi.fn();
    const readChallenge = vi.fn();
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: { beginDomainMigrationRollback },
        repository,
        migrationId,
        options: {
          expectedEvidenceDigest: expectedDigest(repository, migrationId),
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge,
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_FENCE_MISMATCH",
    });
    expect(readChallenge).not.toHaveBeenCalled();
    expect(beginDomainMigrationRollback).not.toHaveBeenCalled();
  });

  it("opens an Automation locator with native fileMustExist semantics and sanitizes failures", async () => {
    const test = fixture();
    const database =
      process.platform === "win32"
        ? resolve("C:\\automation\\missing.db").toLowerCase()
        : resolve("/automation/missing.db");
    Object.assign(test.migration.entries[0], {
      domain: "automation",
      sourceId: "flow-missing",
      sourceScopeDigest: schedulerMigrationScopeDigest({
        store: "automation-engine",
        database,
      }),
      sourceLocator: {
        schemaVersion: 1,
        type: "automation-database",
        database,
      },
      sourceRetirementDigest: null,
    });
    const openAutomationDatabase = vi
      .fn()
      .mockRejectedValue(new Error(`could not open ${database}`));
    const readChallenge = vi.fn();

    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge,
          openAutomationDatabase,
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_OPEN_FAILED",
      message:
        "Automation rollback could not open the recorded source database",
    });
    expect(openAutomationDatabase).toHaveBeenCalledWith(database, {
      fileMustExist: true,
    });
    expect(readChallenge).not.toHaveBeenCalled();
  });

  it("closes an owned Automation runtime when source inspection fails", async () => {
    const test = fixture();
    const database =
      process.platform === "win32"
        ? resolve("C:\\automation\\existing.db").toLowerCase()
        : resolve("/automation/existing.db");
    Object.assign(test.migration.entries[0], {
      domain: "automation",
      sourceId: "flow-inspection-error",
      sourceScopeDigest: schedulerMigrationScopeDigest({
        store: "automation-engine",
        database,
      }),
      sourceLocator: {
        schemaVersion: 1,
        type: "automation-database",
        database,
      },
      sourceRetirementDigest: null,
    });
    const inspectionError = new Error("source query failed");
    const automationDb = {
      prepare(sql) {
        if (sql === "PRAGMA database_list") {
          return { all: () => [{ name: "main", file: database }] };
        }
        throw inspectionError;
      },
    };
    const close = vi.fn().mockResolvedValue(undefined);
    const openAutomationDatabase = vi
      .fn()
      .mockResolvedValue({ db: automationDb, close });
    const readChallenge = vi.fn();

    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge,
          openAutomationDatabase,
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_INSPECTION_FAILED",
      message:
        "Automation rollback could not inspect the recorded source database",
    });
    expect(close).toHaveBeenCalledOnce();
    expect(readChallenge).not.toHaveBeenCalled();
  });

  it("fails closed and shuts down when Automation resolves to sql.js", async () => {
    const test = fixture();
    const database =
      process.platform === "win32"
        ? resolve("C:\\automation\\wasm.db").toLowerCase()
        : resolve("/automation/wasm.db");
    Object.assign(test.migration.entries[0], {
      domain: "automation",
      sourceId: "flow-wasm",
      sourceScopeDigest: schedulerMigrationScopeDigest({
        store: "automation-engine",
        database,
      }),
      sourceLocator: {
        schemaVersion: 1,
        type: "automation-database",
        database,
      },
      sourceRetirementDigest: null,
    });
    const close = vi.fn().mockResolvedValue(undefined);
    const openAutomationDatabase = vi.fn().mockResolvedValue({
      db: {
        __isSqlJsCompat: true,
        databasePath: database,
        prepare: vi.fn(),
      },
      close,
    });
    const readChallenge = vi.fn();

    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge,
          openAutomationDatabase,
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_DURABILITY_UNAVAILABLE",
    });
    expect(close).toHaveBeenCalledOnce();
    expect(readChallenge).not.toHaveBeenCalled();
  });

  it("fails non-TTY authorization before any rollback mutation", async () => {
    const test = fixture();
    const mutateTarget = vi.fn();
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          stdin: { isTTY: false },
          stdout: { isTTY: true },
          resolveSource: () => validSource(test, mutateTarget),
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_NON_INTERACTIVE",
    });
    expect(mutateTarget).not.toHaveBeenCalled();
  });

  it("fails a source digest mismatch before prompting or mutating", async () => {
    const test = fixture();
    const readChallenge = vi.fn();
    const mutateTarget = vi.fn();
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge,
          resolveSource: () => ({
            ...validSource(test, mutateTarget),
            snapshot: { ...test.snapshot, prompt: "changed" },
          }),
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_SOURCE_CHANGED",
    });
    expect(readChallenge).not.toHaveBeenCalled();
    expect(mutateTarget).not.toHaveBeenCalled();
  });

  it("fails a wrong locator context before target mutation", async () => {
    const test = fixture();
    const mutateTarget = vi.fn();
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: {
          expectedEvidenceDigest: expectedDigest(
            test.repository,
            test.migration.id,
          ),
          sourceDirectory: "C:\\wrong-routines",
        },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readChallenge: vi.fn(),
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_CONTEXT_MISMATCH",
    });
    expect(mutateTarget).not.toHaveBeenCalled();
  });

  it("rechecks target evidence after the typed challenge", async () => {
    const test = fixture();
    const mutateTarget = vi.fn();
    const digest = expectedDigest(test.repository, test.migration.id);
    await expect(
      rollbackSchedulerMigration({
        schedulerStore: {},
        repository: test.repository,
        migrationId: test.migration.id,
        options: { expectedEvidenceDigest: digest },
        dependencies: {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          resolveSource: () => validSource(test, mutateTarget),
          readChallenge: (challenge) => {
            test.target.revision += 1;
            return challenge;
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ROLLBACK_EVIDENCE_STALE",
    });
    expect(mutateTarget).not.toHaveBeenCalled();
  });

  it("executes only after exact evidence and returns a sanitized post-rollback show", async () => {
    const test = fixture();
    const rawResult = {
      id: test.migration.id,
      state: "rolled_back",
      manifest: {
        entries: [
          {
            targetJob: {
              payload: { secret: "raw-payload-secret" },
              authority: { secret: "raw-authority-secret" },
            },
          },
        ],
      },
      entries: [
        {
          ...test.migration.entries[0],
          targetBefore: { payload: { secret: "raw-target-before-secret" } },
          retirementToken: "raw-retirement-token",
          sourceLocator: {
            schemaVersion: 1,
            type: "routine-store",
            directory: "C:\\raw-private-routines",
          },
        },
      ],
    };
    const mutateTarget = vi.fn(() => {
      test.migration.state = "rolled_back";
      test.migration.updatedAt = 300;
      test.migration.completedAt = 300;
      Object.assign(test.migration.entries[0], {
        state: "rolled_back",
        targetRollbackRevision: 4,
        sourceRestoredDigest: test.migration.entries[0].sourceDigest,
        updatedAt: 300,
      });
      test.target.revision = 4;
      test.target.enabled = false;
      return rawResult;
    });
    const digest = expectedDigest(test.repository, test.migration.id);
    const result = await rollbackSchedulerMigration({
      schedulerStore: { kind: "test-store" },
      repository: test.repository,
      migrationId: test.migration.id,
      options: { expectedEvidenceDigest: digest },
      dependencies: {
        stdin: { isTTY: true },
        stdout: { isTTY: true },
        resolveSource: () => validSource(test, mutateTarget),
        readChallenge: (challenge) => {
          expect(challenge).toBe(
            buildSchedulerMigrationRollbackChallenge({
              migrationId: test.migration.id,
              evidenceDigest: digest,
              sourceScopeDigest: test.migration.entries[0].sourceScopeDigest,
            }),
          );
          return challenge;
        },
      },
    });
    expect(result).toMatchObject({
      id: test.migration.id,
      state: "rolled_back",
      journal: {
        entries: [
          expect.objectContaining({
            state: "rolled_back",
            sourceLocatorAvailable: true,
          }),
        ],
      },
      rollback: {
        eligible: false,
        blockers: [
          expect.objectContaining({ code: "MIGRATION_ALREADY_ROLLED_BACK" }),
        ],
      },
    });
    expect(mutateTarget).toHaveBeenCalledOnce();
    expect(mutateTarget).toHaveBeenCalledWith({ kind: "test-store" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("raw-payload-secret");
    expect(serialized).not.toContain("raw-authority-secret");
    expect(serialized).not.toContain("raw-target-before-secret");
    expect(serialized).not.toContain("raw-retirement-token");
    expect(serialized).not.toContain("raw-private-routines");
    expect(serialized).not.toContain('"manifest":');
    expect(serialized).not.toContain('"targetBefore":');
    expect(serialized).not.toContain('"retirementToken":');
    expect(serialized).not.toContain('"sourceLocator":');
  });
});
