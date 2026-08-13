import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAutomationScheduled } from "../../src/commands/automation.js";
import {
  automationExecutionAuthoritySnapshot,
  setAutomationExecutionBudget,
} from "../../src/lib/automation-execution-authority.js";
import {
  EXECUTION_STATUS,
  FLOW_STATUS,
  TRIGGER_TYPE,
  automationEffectiveSchedulerFlow,
  automationMigrationSourceDigest,
  automationMigrationSourceSnapshot,
  createFlow,
  deleteFlow,
  ensureAutomationTables,
  executeFlow,
  getExecution,
  getFlow,
  getAutomationSchedulerMigration,
  listExecutions,
  listFlows,
  prepareAutomationSchedulerMigration,
  restoreAutomationSchedulerMigration,
  scheduleFlow,
  updateFlowStatus,
} from "../../src/lib/automation-engine.js";
import {
  grantPermission,
  revokePermission,
} from "../../src/lib/permission-engine.js";
import {
  AUTOMATION_SCHEDULER_CAPABILITY,
  AutomationSchedulerBridge,
  automationDatabaseIdentity,
  authorizeAutomationOccurrence,
  automationFlowSnapshotDigest,
  automationSchedulerExecutionId,
  buildAutomationSchedulerJob,
  createAutomationSchedulerAdapter,
  enqueueScheduledAutomation,
  migrateAutomationFlow,
  rollbackAutomationMigration,
} from "../../src/lib/scheduler-kernel/automation-adapter.js";
import { SchedulerRuntime } from "../../src/lib/scheduler-kernel/runtime.js";
import { bindSchedulerAuthorityPolicy } from "../../src/lib/scheduler-kernel/authority-resolver.js";
import { canonicalSchedulerSourcePath } from "../../src/lib/scheduler-kernel/source-locator-path.js";
import { openSchedulerStore } from "../../src/lib/scheduler-kernel/store.js";

describe("scheduler-kernel automation adapter", () => {
  const cleanups = [];
  const principalId = "did:test:automation-owner";

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function fixture() {
    const db = new Database(":memory:");
    ensureAutomationTables(db);
    let now = Date.now();
    const schedulerStore = openSchedulerStore({
      file: ":memory:",
      Database,
      clock: () => now,
    });
    cleanups.push(() => schedulerStore.close());
    cleanups.push(() => db.close());
    return {
      db,
      schedulerStore,
      clock: () => now,
      get now() {
        return now;
      },
      set now(value) {
        now = value;
      },
    };
  }

  function activeScheduledFlow(f, cron = "* * * * *") {
    const created = createFlow(f.db, {
      name: "scheduled flow",
      createdBy: principalId,
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
      ],
    });
    grantPermission(f.db, principalId, "automation:execute");
    grantPermission(f.db, principalId, "automation:connector:slack");
    setAutomationExecutionBudget(
      f.db,
      created.id,
      { windowMs: 60 * 60_000, maxRuns: 100, maxActionSteps: 100 },
      { now: f.clock },
    );
    scheduleFlow(f.db, created.id, cron);
    const active = updateFlowStatus(f.db, created.id, FLOW_STATUS.ACTIVE);
    f.now = Date.parse(active.updatedAt) + 10 * 60_000;
    return active;
  }

  function executionAuthority(f, flow) {
    return automationExecutionAuthoritySnapshot(f.db, flow);
  }

  it("uses a sql.js compatibility handle's canonical database path", () => {
    const databasePath = resolve(join(tmpdir(), "automation-sqljs.db"));
    const fake = {
      databasePath,
      prepare() {
        throw new Error("PRAGMA fallback must not be used");
      },
    };

    expect(automationDatabaseIdentity(fake)).toBe(
      process.platform === "win32" ? databasePath.toLowerCase() : databasePath,
    );
  });

  it("uses the same fully-qualified, case-folded Windows locator identity", () => {
    const fake = {
      databasePath: String.raw`C:/Users/Alice/../Data/FLOW.db`,
      prepare() {
        throw new Error("PRAGMA fallback must not be used");
      },
    };
    const options = {
      platform: "win32",
      basePath: String.raw`D:\Scheduler`,
    };

    expect(automationDatabaseIdentity(fake, options)).toBe(
      String.raw`c:\users\data\flow.db`,
    );
    expect(() =>
      automationDatabaseIdentity(
        { ...fake, databasePath: String.raw`\Data\FLOW.db` },
        options,
      ),
    ).toThrow(
      expect.objectContaining({ code: "SCHEDULER_SOURCE_PATH_INVALID" }),
    );
  });

  it("fails closed before starting an Automation migration on sql.js", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const wasm = Object.create(f.db);
    wasm.__isSqlJsCompat = true;

    expect(() =>
      migrateAutomationFlow({
        db: wasm,
        schedulerStore: f.schedulerStore,
        flow,
        executionAuthority: executionAuthority(f, flow),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_SCHEDULER_MIGRATION_DURABILITY_UNAVAILABLE",
      }),
    );
    expect(f.schedulerStore.listDomainMigrations()).toEqual([]);
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.ACTIVE,
      schedule: "* * * * *",
    });
  });

  function enqueue(f, flow, now = f.now) {
    return enqueueScheduledAutomation(
      f.schedulerStore,
      flow,
      now,
      executionAuthority(f, flow),
    );
  }

  it("binds a canonical flow snapshot and least-capability authority", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const job = buildAutomationSchedulerJob(flow, executionAuthority(f, flow));

    expect(job).toMatchObject({
      kind: "automation",
      enabled: true,
      maxAttempts: 3,
      trigger: { channel: "scheduled", cron: "* * * * *" },
      authority: {
        principal: { type: "user", id: principalId },
        requestedCapabilities: [
          "automation.connector.slack",
          AUTOMATION_SCHEDULER_CAPABILITY,
        ],
      },
      payload: {
        channel: "scheduled",
        flow: expect.objectContaining({ id: flow.id, status: "active" }),
      },
    });
    expect(job.payload.snapshotDigest).toBe(
      automationFlowSnapshotDigest(job.payload.flow),
    );
    const occurrence = {
      payload: job.payload,
      authority: job.authority,
    };
    expect(authorizeAutomationOccurrence({ job, occurrence })).toEqual({
      allowed: true,
      reason: "automation_snapshot_bound",
    });
    const schedulerBoundOccurrence = {
      ...occurrence,
      authority: {
        ...occurrence.authority,
        authorizationRefs: {
          ...occurrence.authority.authorizationRefs,
          schedulerPolicyRevision: "scheduler-authority:1",
        },
      },
    };
    expect(
      authorizeAutomationOccurrence({
        job,
        occurrence: schedulerBoundOccurrence,
      }),
    ).toEqual({
      allowed: true,
      reason: "automation_snapshot_bound",
    });
    expect(
      authorizeAutomationOccurrence({
        job,
        occurrence: {
          ...schedulerBoundOccurrence,
          authority: {
            ...schedulerBoundOccurrence.authority,
            authorizationRefs: {
              ...schedulerBoundOccurrence.authority.authorizationRefs,
              decisionId: "tampered-decision",
            },
          },
        },
      }),
    ).toEqual({
      allowed: false,
      reason: "automation_authority_mismatch",
    });
  });

  it("migrates Automation in one DB transaction and rolls it back safely", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const migrated = migrateAutomationFlow({
      db: f.db,
      schedulerStore: f.schedulerStore,
      flow,
      executionAuthority: executionAuthority(f, flow),
    });
    expect(migrated).toMatchObject({
      state: "retired",
      entries: [
        {
          domain: "automation",
          sourceId: flow.id,
          rollbackStrategy: "disable",
        },
      ],
    });
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.PAUSED,
      schedule: null,
    });
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toMatchObject({
      migrationId: migrated.id,
      state: "retired",
      retirementToken: migrated.entries[0].retirementToken,
    });
    expect(listFlows(f.db, { status: FLOW_STATUS.ACTIVE, limit: 100 })).toEqual(
      [],
    );
    expect(
      migrateAutomationFlow({
        db: f.db,
        schedulerStore: f.schedulerStore,
        flow: getFlow(f.db, flow.id),
        executionAuthority: executionAuthority(f, flow),
      }),
    ).toMatchObject({ id: migrated.id, state: "retired" });

    expect(
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: migrated.id,
      }),
    ).toMatchObject({ state: "rolled_back" });
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.ACTIVE,
    });
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toBeNull();
    expect(
      restoreAutomationSchedulerMigration(f.db, flow.id, {
        migrationId: migrated.id,
        sourceDigest: automationMigrationSourceDigest(flow),
        targetJobId: migrated.entries[0].targetJobId,
        retirementToken: migrated.entries[0].retirementToken,
      }),
    ).toMatchObject({
      status: FLOW_STATUS.ACTIVE,
      schedule: "* * * * *",
    });
    expect(
      f.schedulerStore.getJob(migrated.entries[0].targetJobId),
    ).toMatchObject({
      enabled: false,
    });
  });

  it("keeps the retired source inert across legacy activate and rejects new authority mutations", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const migrated = migrateAutomationFlow({
      db: f.db,
      schedulerStore: f.schedulerStore,
      flow,
      executionAuthority: executionAuthority(f, flow),
    });

    const marker = getAutomationSchedulerMigration(f.db, flow.id);
    expect(marker).toMatchObject({
      state: "retired",
      sourceSnapshot: {
        id: flow.id,
        status: FLOW_STATUS.ACTIVE,
        schedule: "* * * * *",
      },
    });
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.PAUSED,
      schedule: null,
    });

    // Simulate an older CLI's activate command, which knows nothing about the
    // migration marker. The durable empty schedule keeps its legacy driver inert.
    f.db
      .prepare(
        "UPDATE auto_flows SET status = 'active', updated_at = ? WHERE id = ?",
      )
      .run(new Date(f.now).toISOString(), flow.id);
    expect(
      listFlows(f.db, { status: FLOW_STATUS.ACTIVE, limit: 100 }).filter(
        (candidate) => candidate.schedule,
      ),
    ).toEqual([]);
    expect(
      automationEffectiveSchedulerFlow(f.db, getFlow(f.db, flow.id)),
    ).toMatchObject({
      status: FLOW_STATUS.ACTIVE,
      schedule: "* * * * *",
      schedulerMigration: { migrationId: migrated.id },
    });

    expect(() =>
      updateFlowStatus(f.db, flow.id, FLOW_STATUS.ACTIVE),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_SCHEDULER_MIGRATION_ACTIVE",
      }),
    );
    expect(() => scheduleFlow(f.db, flow.id, "*/2 * * * *")).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_SCHEDULER_MIGRATION_ACTIVE",
      }),
    );
    expect(() => deleteFlow(f.db, flow.id)).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_SCHEDULER_MIGRATION_ACTIVE",
      }),
    );

    expect(
      migrateAutomationFlow({
        db: f.db,
        schedulerStore: f.schedulerStore,
        flow: getFlow(f.db, flow.id),
        executionAuthority: executionAuthority(f, flow),
      }),
    ).toMatchObject({ id: migrated.id, state: "retired" });
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.PAUSED,
      schedule: null,
    });
  });

  it("rolls back a prepared source with a null retirement token", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const authority = executionAuthority(f, flow);
    const desired = buildAutomationSchedulerJob(flow, authority);
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const source = automationMigrationSourceSnapshot(flow);
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: flow.id,
          sourceScope: {
            store: "automation-engine",
            database: automationDatabaseIdentity(f.db),
          },
          sourceLocator: {
            schemaVersion: 1,
            type: "automation-database",
            database: automationDatabaseIdentity(f.db),
          },
          source,
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    prepareAutomationSchedulerMigration(f.db, flow.id, {
      migrationId: prepared.id,
      sourceDigest: automationMigrationSourceDigest(flow),
      targetJobId: desired.id,
    });

    expect(
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: prepared.id,
      }),
    ).toMatchObject({ state: "rolled_back" });
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toBeNull();
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.ACTIVE,
      schedule: "* * * * *",
    });
  });

  it("rolls back when retirement allocated a journal token before the Automation marker advanced", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const authority = executionAuthority(f, flow);
    const desired = buildAutomationSchedulerJob(flow, authority);
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const source = automationMigrationSourceSnapshot(flow);
    const database = automationDatabaseIdentity(f.db);
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: flow.id,
          sourceScope: { store: "automation-engine", database },
          sourceLocator: {
            schemaVersion: 1,
            type: "automation-database",
            database,
          },
          source,
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    prepareAutomationSchedulerMigration(f.db, flow.id, {
      migrationId: prepared.id,
      sourceDigest: automationMigrationSourceDigest(flow),
      targetJobId: desired.id,
    });
    const applied = f.schedulerStore.applyDomainMigration(prepared.id);
    f.schedulerStore.verifyDomainMigration(prepared.id, {
      sources: [{ entryId: applied.entries[0].entryId, source }],
    });
    const retiring = f.schedulerStore.beginDomainMigrationRetirement(
      prepared.id,
    );

    expect(retiring).toMatchObject({
      state: "retiring",
      entries: [{ retirementToken: expect.any(String) }],
    });
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toMatchObject({
      state: "prepared",
      migrationId: prepared.id,
      targetJobId: desired.id,
      retirementToken: null,
    });

    expect(
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: prepared.id,
      }),
    ).toMatchObject({ state: "rolled_back" });
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toBeNull();
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.ACTIVE,
      schedule: "* * * * *",
    });
    expect(f.schedulerStore.getJob(desired.id)).toMatchObject({
      enabled: false,
    });
  });

  it("rejects a wrong-domain journal before changing its state or target", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const desired = buildAutomationSchedulerJob(
      flow,
      executionAuthority(f, flow),
    );
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const directory = canonicalSchedulerSourcePath(
      resolve(join(tmpdir(), "automation-wrong-domain")),
    );
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "routine",
          sourceId: "wrong-domain-source",
          sourceScope: { store: "routines", directory },
          sourceLocator: {
            schemaVersion: 1,
            type: "routine-store",
            directory,
          },
          source: { id: "wrong-domain-source" },
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    f.schedulerStore.applyDomainMigration(prepared.id);
    const targetBefore = f.schedulerStore.getJob(desired.id);

    expect(() =>
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: prepared.id,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_SCHEDULER_MIGRATION_DOMAIN_MISMATCH",
      }),
    );
    expect(f.schedulerStore.getDomainMigration(prepared.id)).toMatchObject({
      state: "applied",
      entries: [{ state: "applied" }],
    });
    expect(f.schedulerStore.getJob(desired.id)).toEqual(targetBefore);
  });

  it("rejects a wrong source binding before changing its state or target", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const desired = buildAutomationSchedulerJob(
      flow,
      executionAuthority(f, flow),
    );
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const database = automationDatabaseIdentity(f.db);
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: "missing-automation-source",
          sourceScope: { store: "automation-engine", database },
          sourceLocator: {
            schemaVersion: 1,
            type: "automation-database",
            database,
          },
          source: automationMigrationSourceSnapshot(flow),
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    f.schedulerStore.applyDomainMigration(prepared.id);
    const targetBefore = f.schedulerStore.getJob(desired.id);

    expect(() =>
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: prepared.id,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "AUTOMATION_SCHEDULER_MIGRATION_SOURCE_CHANGED",
      }),
    );
    expect(f.schedulerStore.getDomainMigration(prepared.id)).toMatchObject({
      state: "applied",
      entries: [{ state: "applied" }],
    });
    expect(f.schedulerStore.getJob(desired.id)).toEqual(targetBefore);
  });

  it("resumes rollback after source restore succeeds before journal confirmation", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const migrated = migrateAutomationFlow({
      db: f.db,
      schedulerStore: f.schedulerStore,
      flow,
      executionAuthority: executionAuthority(f, flow),
    });
    const restore = f.schedulerStore.restoreDomainMigrationEntrySource;
    f.schedulerStore.restoreDomainMigrationEntrySource = (options) =>
      restore.call(f.schedulerStore, {
        ...options,
        restoreSource: () => {
          options.restoreSource();
          throw new Error("simulated crash after source restoration");
        },
      });
    expect(() =>
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: migrated.id,
      }),
    ).toThrow("simulated crash after source restoration");
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toBeNull();
    expect(getFlow(f.db, flow.id)).toMatchObject({
      status: FLOW_STATUS.ACTIVE,
      schedule: "* * * * *",
    });

    f.schedulerStore.restoreDomainMigrationEntrySource = restore.bind(
      f.schedulerStore,
    );
    expect(
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: migrated.id,
      }),
    ).toMatchObject({ state: "rolled_back" });
    expect(
      rollbackAutomationMigration({
        db: f.db,
        schedulerStore: f.schedulerStore,
        migrationId: migrated.id,
      }),
    ).toMatchObject({ state: "rolled_back", deduplicated: true });
  });

  it("resumes Automation migration after target staging and source retirement crashes", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const authority = executionAuthority(f, flow);
    const desired = buildAutomationSchedulerJob(flow, authority);
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const source = {
      createdAt: flow.createdAt,
      createdBy: flow.createdBy,
      description: flow.description,
      edges: flow.edges,
      id: flow.id,
      name: flow.name,
      nodes: flow.nodes,
      schedule: flow.schedule,
      sharedWith: flow.sharedWith,
      status: flow.status,
    };
    const database = automationDatabaseIdentity(f.db);
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: flow.id,
          sourceScope: { store: "automation-engine", database },
          sourceLocator: {
            schemaVersion: 1,
            type: "automation-database",
            database,
          },
          source,
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    prepareAutomationSchedulerMigration(f.db, flow.id, {
      migrationId: prepared.id,
      sourceDigest: automationMigrationSourceDigest(flow),
      targetJobId: desired.id,
    });
    f.schedulerStore.applyDomainMigration(prepared.id);
    f.schedulerStore.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries
         SET source_locator_json = NULL WHERE migration_id = ?`,
      )
      .run(prepared.id);
    expect(
      migrateAutomationFlow({
        db: f.db,
        schedulerStore: f.schedulerStore,
        flow: getFlow(f.db, flow.id),
        executionAuthority: authority,
      }),
    ).toMatchObject({
      id: prepared.id,
      state: "retired",
      entries: [
        {
          sourceLocator: {
            schemaVersion: 1,
            type: "automation-database",
            database,
          },
        },
      ],
    });
    const retired = f.schedulerStore.getDomainMigration(prepared.id);
    f.schedulerStore.db
      .prepare(
        `UPDATE scheduler_domain_migrations SET state = 'retiring',
         completed_at = NULL WHERE migration_id = ?`,
      )
      .run(prepared.id);
    f.schedulerStore.db
      .prepare(
        `UPDATE scheduler_domain_migration_entries SET state = 'retiring'
         WHERE migration_id = ?`,
      )
      .run(prepared.id);
    expect(
      migrateAutomationFlow({
        db: f.db,
        schedulerStore: f.schedulerStore,
        flow: getFlow(f.db, flow.id),
        executionAuthority: authority,
      }),
    ).toMatchObject({
      id: prepared.id,
      state: "retired",
      entries: [{ retirementToken: retired.entries[0].retirementToken }],
    });
  });

  it("resumes a v4 current-scope Automation journal through its source marker", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const authority = executionAuthority(f, flow);
    const desired = buildAutomationSchedulerJob(flow, authority);
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: flow.id,
          sourceScope: { store: "automation-engine", database: "current" },
          source: automationMigrationSourceSnapshot(flow),
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    const before = f.schedulerStore.db
      .prepare(
        `SELECT manifest_digest AS manifest_digest,
                manifest_json AS manifest_json
         FROM scheduler_domain_migrations WHERE migration_id = ?`,
      )
      .get(prepared.id);
    prepareAutomationSchedulerMigration(f.db, flow.id, {
      migrationId: prepared.id,
      sourceDigest: automationMigrationSourceDigest(flow),
      targetJobId: desired.id,
    });

    expect(
      migrateAutomationFlow({
        db: f.db,
        schedulerStore: f.schedulerStore,
        flow: getFlow(f.db, flow.id),
        executionAuthority: authority,
      }),
    ).toMatchObject({
      id: prepared.id,
      state: "retired",
      entries: [
        {
          entryId: prepared.entries[0].entryId,
          sourceLocator: {
            schemaVersion: 1,
            type: "automation-database",
            database: automationDatabaseIdentity(f.db),
          },
        },
      ],
    });
    expect(
      f.schedulerStore.db
        .prepare(
          `SELECT manifest_digest AS manifest_digest,
                  manifest_json AS manifest_json
           FROM scheduler_domain_migrations WHERE migration_id = ?`,
        )
        .get(prepared.id),
    ).toEqual(before);
  });

  it("fails closed when Automation authority drifts after the source marker is prepared", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const authority = executionAuthority(f, flow);
    const desired = buildAutomationSchedulerJob(flow, authority);
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const database = automationDatabaseIdentity(f.db);
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: flow.id,
          sourceScope: { store: "automation-engine", database },
          sourceLocator: {
            schemaVersion: 1,
            type: "automation-database",
            database,
          },
          source: automationMigrationSourceSnapshot(flow),
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });
    prepareAutomationSchedulerMigration(f.db, flow.id, {
      migrationId: prepared.id,
      sourceDigest: automationMigrationSourceDigest(flow),
      targetJobId: desired.id,
    });

    setAutomationExecutionBudget(
      f.db,
      flow.id,
      { windowMs: 60 * 60_000, maxRuns: 50, maxActionSteps: 50 },
      { now: f.clock },
    );

    expect(() =>
      migrateAutomationFlow({
        db: f.db,
        schedulerStore: f.schedulerStore,
        flow: getFlow(f.db, flow.id),
        executionAuthority: executionAuthority(f, flow),
      }),
    ).toThrow();
    expect(f.schedulerStore.getDomainMigration(prepared.id)).toMatchObject({
      state: "prepared",
      entries: [{ state: "prepared" }],
    });
    expect(f.schedulerStore.getJob(desired.id)).toBeNull();
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toMatchObject({
      migrationId: prepared.id,
      state: "prepared",
    });
  });

  it("fails closed when a legacy current-scope journal has no source marker", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const authority = executionAuthority(f, flow);
    const desired = buildAutomationSchedulerJob(flow, authority);
    desired.authority = bindSchedulerAuthorityPolicy(
      f.schedulerStore,
      desired.authority,
    );
    const prepared = f.schedulerStore.prepareDomainMigration({
      entries: [
        {
          domain: "automation",
          sourceId: flow.id,
          sourceScope: { store: "automation-engine", database: "current" },
          source: automationMigrationSourceSnapshot(flow),
          targetJob: desired,
          rollbackStrategy: "disable",
        },
      ],
    });

    expect(() =>
      migrateAutomationFlow({
        db: f.db,
        schedulerStore: f.schedulerStore,
        flow: getFlow(f.db, flow.id),
        executionAuthority: authority,
      }),
    ).toThrow();
    expect(f.schedulerStore.getDomainMigration(prepared.id)).toMatchObject({
      state: "prepared",
      entries: [{ state: "prepared", sourceLocator: null }],
    });
    expect(f.schedulerStore.getJob(desired.id)).toBeNull();
    expect(getAutomationSchedulerMigration(f.db, flow.id)).toBeNull();
  });

  it("runs one catch-up occurrence and records durable automation history", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const bridge = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-owner",
      leaseMs: 10_000,
    });

    const first = await bridge.runDue();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      flow: flow.id,
      result: { status: "succeeded" },
    });
    const executions = listExecutions(f.db, { flowId: flow.id });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      status: EXECUTION_STATUS.SUCCESS,
      triggerType: TRIGGER_TYPE.SCHEDULE,
    });
    expect(
      f.schedulerStore.db
        .prepare("SELECT status, units FROM scheduler_authority_reservations")
        .get(),
    ).toEqual({ status: "succeeded", units: 1 });

    await expect(bridge.runDue()).resolves.toEqual([]);
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("exposes the production run-scheduled command path", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const output = [];

    await expect(
      runAutomationScheduled(
        f.db,
        { json: true, leaseMs: 10_000 },
        {
          schedulerStore: f.schedulerStore,
          now: f.clock,
          ownerId: "automation-command-owner",
          log: (line) => output.push(line),
        },
      ),
    ).resolves.toBe(0);
    const summary = JSON.parse(output.join("\n"));
    expect(summary).toMatchObject({
      due: 1,
      executions: [
        {
          flow: flow.id,
          status: "succeeded",
          recovered: false,
        },
      ],
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("deduplicates two live drivers for the same logical cron occurrence", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const first = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-contender-a",
      leaseMs: 10_000,
    });
    const second = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-contender-b",
      leaseMs: 10_000,
    });

    await Promise.all([first.runDue(), second.runDue()]);
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("resets the cron cursor when a schedule definition is edited", () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const first = enqueue(f, flow);
    const editedAt = f.now + 60 * 60_000;
    f.db
      .prepare(
        "UPDATE auto_flows SET schedule = ?, updated_at = ? WHERE id = ?",
      )
      .run("* * * * *", new Date(editedAt).toISOString(), flow.id);
    f.now = editedAt + 2 * 60_000;

    const second = enqueue(f, getFlow(f.db, flow.id));
    expect(second.id).not.toBe(first.id);
    expect(second.scheduledFor).toBeGreaterThan(editedAt);
  });

  it("rejects a queued occurrence when the flow is paused before execution", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    updateFlowStatus(f.db, flow.id, FLOW_STATUS.PAUSED);
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-paused-owner",
      leaseMs: 10_000,
    });

    const result = await runtime.runOccurrence(occurrence.id);
    expect(result).toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_SCHEDULER_FLOW_NOT_ACTIVE" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("rejects a stale flow snapshot before connector execution", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    scheduleFlow(f.db, flow.id, "*/2 * * * *");
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-stale-owner",
      leaseMs: 10_000,
    });

    const result = await runtime.runOccurrence(occurrence.id);
    expect(result).toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_SCHEDULER_STALE_SNAPSHOT" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("recovers committed success without executing the flow twice", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    const executionId = automationSchedulerExecutionId(occurrence.id);
    executeFlow(f.db, flow.id, {
      triggerType: TRIGGER_TYPE.SCHEDULE,
      executionId,
    });
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-recovery-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "succeeded",
      result: { id: executionId },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("dead-letters a start-only execution as outcome unknown", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    const executionId = automationSchedulerExecutionId(occurrence.id);
    f.db
      .prepare(
        `INSERT INTO auto_executions
         (id, flow_id, trigger_type, input_data, output_data, status, steps_log,
          duration_ms, error, test_mode, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        executionId,
        flow.id,
        TRIGGER_TYPE.SCHEDULE,
        "{}",
        null,
        EXECUTION_STATUS.RUNNING,
        "[]",
        0,
        null,
        0,
        new Date(f.now).toISOString(),
        null,
      );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-unknown-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_SCHEDULER_OUTCOME_UNKNOWN" },
    });
    expect(getExecution(f.db, executionId)).toMatchObject({
      status: EXECUTION_STATUS.RUNNING,
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("removes only the bound running evidence before one adjudicated retry", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    const executionId = automationSchedulerExecutionId(occurrence.id);
    f.db
      .prepare(
        `INSERT INTO auto_executions
         (id, flow_id, trigger_type, input_data, output_data, status, steps_log,
          duration_ms, error, test_mode, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        executionId,
        flow.id,
        TRIGGER_TYPE.SCHEDULE,
        "{}",
        null,
        EXECUTION_STATUS.RUNNING,
        "[]",
        0,
        null,
        0,
        new Date(f.now).toISOString(),
        null,
      );
    const firstRuntime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-fail-close-owner",
      leaseMs: 10_000,
    });
    await firstRuntime.runOccurrence(occurrence.id);
    const candidate = f.schedulerStore.getAdjudicationCase(occurrence.id);
    f.schedulerStore.adjudicateOccurrence({
      occurrenceId: occurrence.id,
      decision: "confirmed_not_applied",
      expectedEvidenceDigest: candidate.evidenceDigest,
      expectedAttempt: candidate.attempt,
      expectedFence: candidate.fence,
      reasonDigest: `sha256:${"2".repeat(64)}`,
      operatorDigest: `sha256:${"9".repeat(64)}`,
    });
    const recovered = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-adjudication-owner",
      leaseMs: 10_000,
    });
    await expect(recovered.runOccurrence(occurrence.id)).resolves.toMatchObject(
      {
        status: "succeeded",
        result: { id: executionId, status: EXECUTION_STATUS.SUCCESS },
      },
    );
    const adjudicatedExecutions = listExecutions(f.db, { flowId: flow.id });
    expect(adjudicatedExecutions).toHaveLength(2);
    expect(adjudicatedExecutions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: executionId,
          status: EXECUTION_STATUS.SUCCESS,
        }),
        expect.objectContaining({ status: EXECUTION_STATUS.CANCELLED }),
      ]),
    );
    expect(
      f.schedulerStore.getOccurrenceAdjudication(occurrence.id),
    ).toMatchObject({
      status: "applied",
    });
  });

  it("rejects a tampered authority envelope before adapter execution", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    f.schedulerStore.db
      .prepare(
        "UPDATE occurrences SET authority_json = ? WHERE occurrence_id = ?",
      )
      .run(
        JSON.stringify({
          ...occurrence.authority,
          requestedCapabilities: ["automation.admin"],
        }),
        occurrence.id,
      );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-denied-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "SCHEDULER_RUNTIME_AUTHORIZATION_DENIED" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("rechecks live connector permission immediately before execution", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    revokePermission(f.db, principalId, "automation:connector:slack");
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db, now: f.clock })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-revoked-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_EXECUTION_PERMISSION_DENIED" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("rejects an unattended flow before enqueue when no budget is configured", async () => {
    const f = fixture();
    const created = createFlow(f.db, {
      name: "unconfigured scheduled flow",
      createdBy: principalId,
      nodes: [
        {
          id: "notify",
          type: "action",
          connector: "slack",
          action: "postMessage",
        },
      ],
    });
    grantPermission(f.db, principalId, "automation:execute");
    grantPermission(f.db, principalId, "automation:connector:slack");
    scheduleFlow(f.db, created.id, "* * * * *");
    const flow = updateFlowStatus(f.db, created.id, FLOW_STATUS.ACTIVE);
    f.now = Date.parse(flow.updatedAt) + 10 * 60_000;
    const bridge = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-unconfigured-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toMatchObject([
      {
        flow: flow.id,
        occurrence: null,
        rejected: true,
        result: {
          status: "rejected",
          error: { code: "AUTOMATION_EXECUTION_BUDGET_REQUIRED" },
        },
      },
    ]);
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });

  it("consumes one durable run/action budget and denies the next cron fire", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const windowMs = 60 * 60_000;
    f.now = Math.floor(f.now / windowMs) * windowMs + windowMs + 10 * 60_000;
    setAutomationExecutionBudget(
      f.db,
      flow.id,
      { windowMs, maxRuns: 1, maxActionSteps: 1 },
      { now: f.clock },
    );
    const bridge = new AutomationSchedulerBridge({
      db: f.db,
      schedulerStore: f.schedulerStore,
      now: f.clock,
      ownerId: "automation-budget-owner",
      leaseMs: 10_000,
    });

    await expect(bridge.runDue()).resolves.toMatchObject([
      { result: { status: "succeeded" } },
    ]);
    f.now += 60_000;
    await expect(bridge.runDue()).resolves.toMatchObject([
      {
        result: {
          status: "dead_letter",
          error: { code: "AUTOMATION_EXECUTION_BUDGET_EXHAUSTED" },
        },
      },
    ]);
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(1);
  });

  it("rejects an occurrence when its budget policy changes after enqueue", async () => {
    const f = fixture();
    const flow = activeScheduledFlow(f);
    const occurrence = enqueue(f, flow);
    setAutomationExecutionBudget(
      f.db,
      flow.id,
      { windowMs: 60 * 60_000, maxRuns: 50, maxActionSteps: 50 },
      { now: f.clock },
    );
    const runtime = new SchedulerRuntime({
      store: f.schedulerStore,
      adapters: [createAutomationSchedulerAdapter({ db: f.db, now: f.clock })],
      authorize: authorizeAutomationOccurrence,
      ownerId: "automation-stale-budget-owner",
      leaseMs: 10_000,
    });

    await expect(runtime.runOccurrence(occurrence.id)).resolves.toMatchObject({
      status: "dead_letter",
      error: { code: "AUTOMATION_EXECUTION_AUTHORITY_STALE" },
    });
    expect(listExecutions(f.db, { flowId: flow.id })).toHaveLength(0);
  });
});
