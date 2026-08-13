import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultSchedulerService,
  adjudicateSchedulerOccurrence,
  buildSchedulerAdjudicationChallenge,
  getSchedulerAdjudicationCase,
  getSchedulerAuthorityPolicy,
  listSchedulerMigrationJournal,
  parseSchedulerDomains,
  parseSchedulerIntervalMs,
  parseSchedulerCapabilities,
  runSchedulerDaemon,
  setSchedulerAuthorityPolicy,
  showSchedulerMigrationJournal,
} from "../../src/commands/scheduler-daemon.js";

describe("scheduler daemon command", () => {
  const migrationFixture = () => ({
    id: "scheduler-domain-migration-test",
    state: "retired",
    entryCount: 1,
    manifestDigest: `sha256:${"a".repeat(64)}`,
    manifest: {
      entries: [
        {
          targetJob: {
            payload: { secret: "do-not-expose" },
            authority: { secret: "do-not-expose-authority" },
          },
        },
      ],
    },
    createdAt: 100,
    updatedAt: 200,
    completedAt: 200,
    lastError: { code: "TEST_ERROR", details: { secret: "hidden" } },
    entries: [
      {
        entryId: "scheduler-migration-entry-test",
        domain: "routine",
        sourceId: "daily",
        sourceScopeDigest: `sha256:${"b".repeat(64)}`,
        sourceLocator: {
          schemaVersion: 1,
          type: "routine-store",
          directory: "C:\\do-not-expose-routines",
        },
        sourceDigest: `sha256:${"c".repeat(64)}`,
        targetJobId: "routine:test",
        targetJobDigest: `sha256:${"d".repeat(64)}`,
        rollbackStrategy: "disable",
        state: "retired",
        targetAction: "created",
        targetBefore: { payload: { secret: "also-hidden" } },
        targetAppliedRevision: 3,
        targetAppliedAt: 150,
        targetOccurrenceCountBefore: 0,
        targetExecutionEventCountBefore: 0,
        targetRollbackRevision: null,
        retirementToken: "do-not-expose-token",
        sourceRetirementDigest: `sha256:${"e".repeat(64)}`,
        sourceRestoredDigest: null,
        sourceSnapshot: { prompt: "do-not-expose-prompt" },
        createdAt: 100,
        updatedAt: 200,
      },
    ],
  });

  it("lists sanitized migration summaries with strict filters", async () => {
    const list = vi.fn(() => [migrationFixture()]);
    await expect(
      listSchedulerMigrationJournal(
        { state: "RETIRED", domain: "ROUTINE", limit: "20" },
        { migrationRepository: { list } },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "scheduler-domain-migration-test",
        state: "retired",
        domains: ["routine"],
        entryCount: 1,
      }),
    ]);
    expect(list).toHaveBeenCalledWith({
      state: "retired",
      domain: "routine",
      limit: 20,
    });
    await expect(
      listSchedulerMigrationJournal(
        { domain: "unknown" },
        { migrationRepository: { list } },
      ),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_ADMIN_INVALID_ARGUMENT",
    });
  });

  it("shows a payload-free journal, target counters and rollback blockers", async () => {
    const repository = {
      get: vi.fn(() => migrationFixture()),
      getTarget: vi.fn(() => ({
        jobId: "routine:test",
        exists: true,
        revision: 4,
        enabled: true,
        occurrenceCount: 1,
        eventCount: 5,
        executionEventCount: 1,
      })),
    };
    const result = await showSchedulerMigrationJournal(
      "scheduler-domain-migration-test",
      { migrationRepository: repository },
    );
    expect(result).toMatchObject({
      journal: {
        lastError: { code: "TEST_ERROR" },
        entries: [
          {
            domain: "routine",
            sourceLocatorAvailable: true,
            targetJobId: "routine:test",
            targetAppliedRevision: 3,
          },
        ],
      },
      targets: [
        {
          revision: 4,
          enabled: true,
          occurrenceCount: 1,
          eventCount: 5,
          executionEventCount: 1,
        },
      ],
      rollback: {
        eligible: false,
        blockers: expect.arrayContaining([
          expect.objectContaining({ code: "TARGET_REVISION_CHANGED" }),
          expect.objectContaining({ code: "TARGET_OCCURRENCES_OBSERVED" }),
          expect.objectContaining({ code: "TARGET_EXECUTION_EVENTS_OBSERVED" }),
        ]),
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("do-not-expose");
    expect(serialized).not.toContain("sourceSnapshot");
    expect(serialized).not.toContain("targetBefore");
    expect(serialized).not.toContain("retirementToken");

    repository.getTarget.mockReturnValue({
      jobId: "routine:test",
      exists: true,
      revision: 3,
      enabled: true,
      occurrenceCount: 0,
      eventCount: 2,
      executionEventCount: 0,
    });
    await expect(
      showSchedulerMigrationJournal("scheduler-domain-migration-test", {
        migrationRepository: repository,
      }),
    ).resolves.toMatchObject({ rollback: { eligible: true, blockers: [] } });
  });

  it("reports management and locator blockers without exposing locator values", async () => {
    const migration = migrationFixture();
    migration.entryCount = 2;
    migration.entries[0].sourceLocator = null;
    migration.entries.push({
      ...migration.entries[0],
      entryId: "scheduler-migration-entry-second",
      sourceId: "weekly",
      sourceLocator: {
        schemaVersion: 1,
        type: "routine-store",
        directory: "C:\\second-private-routines",
      },
      targetJobId: "routine:second",
    });
    const result = await showSchedulerMigrationJournal(migration.id, {
      migrationRepository: {
        get: () => migration,
        getTarget: (targetJobId) => ({
          jobId: targetJobId,
          exists: true,
          revision: 3,
          enabled: true,
          occurrenceCount: 0,
          eventCount: 2,
          executionEventCount: 0,
        }),
      },
    });

    expect(result.journal.entries).toEqual([
      expect.objectContaining({ sourceLocatorAvailable: false }),
      expect.objectContaining({ sourceLocatorAvailable: true }),
    ]);
    expect(result.rollback).toMatchObject({
      eligible: false,
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: "MULTI_ENTRY_UNSUPPORTED",
          entryCount: 2,
        }),
        expect.objectContaining({
          code: "SOURCE_LOCATOR_UNAVAILABLE",
          entryId: "scheduler-migration-entry-test",
        }),
      ]),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("do-not-expose-routines");
    expect(serialized).not.toContain("second-private-routines");
    expect(serialized).not.toContain('"sourceLocator":');
  });

  it("uses a stable error code for a missing migration journal", async () => {
    await expect(
      showSchedulerMigrationJournal("missing", {
        migrationRepository: { get: () => null, getTarget: vi.fn() },
      }),
    ).rejects.toMatchObject({
      code: "SCHEDULER_MIGRATION_NOT_FOUND",
      message: "Scheduler domain migration does not exist: missing",
    });
  });

  it("normalizes exact scheduler capabilities without allowing a wildcard", () => {
    expect(
      parseSchedulerCapabilities("agent.execute, network.read,agent.execute"),
    ).toEqual(["agent.execute", "network.read"]);
    expect(() => parseSchedulerCapabilities("*")).toThrow(/exact/u);
    expect(() => parseSchedulerCapabilities(" , ")).toThrow(/exact/u);
  });

  it("reads and CAS-updates a scheduler permission and budget policy", async () => {
    const close = vi.fn();
    const getAuthorityPolicy = vi.fn(() => ({
      principal: { type: "agenda", id: "daily" },
      revision: 3,
    }));
    const setAuthorityPolicy = vi.fn(() => ({
      principal: { type: "agenda", id: "daily" },
      revision: 4,
      enabled: false,
    }));
    const dependencies = {
      openSchedulerStore: () => ({
        close,
        getAuthorityPolicy,
        setAuthorityPolicy,
      }),
    };

    await expect(
      getSchedulerAuthorityPolicy("agenda", "daily", dependencies),
    ).resolves.toMatchObject({ revision: 3 });
    await expect(
      setSchedulerAuthorityPolicy(
        "agenda",
        "daily",
        {
          capabilities: "agent.execute",
          windowSeconds: "3600",
          maxRuns: "5",
          maxUnits: "20",
          expectedRevision: "3",
          disable: true,
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ revision: 4, enabled: false });
    expect(setAuthorityPolicy).toHaveBeenCalledWith(
      { type: "agenda", id: "daily" },
      {
        capabilities: ["agent.execute"],
        windowMs: 3_600_000,
        maxRuns: 5,
        maxUnits: 20,
        enabled: false,
        expectedRevision: 3,
      },
    );
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("reads a scheduler adjudication case without exposing occurrence payload", async () => {
    const close = vi.fn();
    const getAdjudicationCase = vi.fn(() => ({
      occurrenceId: "occ_test",
      eligible: true,
      evidenceDigest: `sha256:${"a".repeat(64)}`,
    }));
    await expect(
      getSchedulerAdjudicationCase("occ_test", {
        openSchedulerStore: () => ({ close, getAdjudicationCase }),
      }),
    ).resolves.toMatchObject({ eligible: true });
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires a TTY typed challenge before recording scheduler adjudication", async () => {
    const evidenceDigest = `sha256:${"b".repeat(64)}`;
    const request = {
      occurrenceId: "occ_test",
      decision: "confirmed_not_applied",
      evidenceDigest,
      expectedAttempt: 2,
      expectedFence: 3,
    };
    const challenge = buildSchedulerAdjudicationChallenge(request);
    const adjudicateOccurrence = vi.fn((input) => ({
      occurrenceId: input.occurrenceId,
      adjudication: { decision: input.decision },
    }));
    const close = vi.fn();
    await expect(
      adjudicateSchedulerOccurrence(
        "occ_test",
        {
          decision: request.decision,
          expectedEvidenceDigest: evidenceDigest,
          expectedAttempt: "2",
          expectedFence: "3",
        },
        {
          stdin: { isTTY: true },
          stdout: { isTTY: true },
          readReason: async () => "operator verified remote result",
          readChallenge: async () => challenge,
          operatorIdentity: {
            username: "tester",
            hostname: "test-host",
            uid: 1,
          },
          openSchedulerStore: () => ({ close, adjudicateOccurrence }),
        },
      ),
    ).resolves.toMatchObject({
      occurrenceId: "occ_test",
      adjudication: { decision: "confirmed_not_applied" },
    });
    expect(adjudicateOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrenceId: "occ_test",
        expectedAttempt: 2,
        expectedFence: 3,
        reasonDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        operatorDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(close).toHaveBeenCalledOnce();

    await expect(
      adjudicateSchedulerOccurrence(
        "occ_test",
        {
          decision: request.decision,
          expectedEvidenceDigest: evidenceDigest,
          expectedAttempt: "2",
          expectedFence: "3",
        },
        { stdin: { isTTY: false }, stdout: { isTTY: true } },
      ),
    ).rejects.toMatchObject({
      code: "SCHEDULER_ADJUDICATION_NON_INTERACTIVE",
    });
  });

  it("normalizes a strict, deterministic domain selection", () => {
    expect(parseSchedulerDomains(" cowork,agenda,cowork ")).toEqual([
      "agenda",
      "cowork",
    ]);
    expect(() => parseSchedulerDomains("agenda,unknown")).toThrow(
      /selected from/u,
    );
    expect(() => parseSchedulerDomains(" ")).toThrow(/selected from/u);
  });

  it("accepts bounded fractional-second polling intervals", () => {
    expect(parseSchedulerIntervalMs("0.25")).toBe(250);
    expect(parseSchedulerIntervalMs("5")).toBe(5_000);
    expect(() => parseSchedulerIntervalMs("0.1")).toThrow(/between/u);
    expect(() => parseSchedulerIntervalMs("NaN")).toThrow(/between/u);
  });

  it("builds Agenda and Cowork drivers over one scheduler store", async () => {
    const schedulerStore = { close: vi.fn() };
    const agendaRun = vi.fn(async (_options, deps) => {
      expect(deps.schedulerStore).toBe(schedulerStore);
      deps.log(JSON.stringify({ due: 1, retired: [], actions: [] }));
      return 0;
    });
    const coworkRun = vi.fn(async () => [{ schedule: "daily" }]);
    class FakeAgendaStore {}
    class FakeCoworkBridge {
      constructor(options) {
        expect(options.schedulerStore).toBe(schedulerStore);
        expect(options.runTask).toBe(runtime.runCoworkTask);
      }

      runDue(options) {
        return coworkRun(options);
      }
    }
    const runtime = {
      AgentScheduleStore: FakeAgendaStore,
      CoworkCronSchedulerBridge: FakeCoworkBridge,
      openSchedulerStore: () => schedulerStore,
      runAgendaRun: agendaRun,
      runCoworkTask: vi.fn(),
    };
    const service = await createDefaultSchedulerService({
      cwd: "C:\\repo",
      runtime,
    });

    const result = await service.runOnce();

    expect(result).toMatchObject({
      status: "succeeded",
      results: [
        { driver: "agenda", value: { due: 1 } },
        { driver: "cowork", value: [{ schedule: "daily" }] },
      ],
    });
    expect(agendaRun).toHaveBeenCalledTimes(1);
    expect(coworkRun).toHaveBeenCalledTimes(1);
    await service.close();
    expect(schedulerStore.close).toHaveBeenCalledTimes(1);
  });

  it("turns an Agenda action failure into a visible degraded driver result", async () => {
    const runtime = {
      AgentScheduleStore: class {},
      CoworkCronSchedulerBridge: class {},
      openSchedulerStore: () => ({ close: vi.fn() }),
      runAgendaRun: async (_options, deps) => {
        deps.log(
          JSON.stringify({
            due: 1,
            retired: [],
            actions: [{ action: "error", errorCode: "POLICY_DENIED" }],
          }),
        );
        return 1;
      },
      runCoworkTask: vi.fn(),
    };
    const service = await createDefaultSchedulerService({
      domains: ["agenda"],
      runtime,
    });

    await expect(service.runOnce()).resolves.toMatchObject({
      status: "degraded",
      results: [
        {
          driver: "agenda",
          status: "failed",
          error: {
            code: "SCHEDULER_DAEMON_AGENDA_FAILED",
            details: {
              due: 1,
              retired: [],
              actions: [{ action: "error", errorCode: "POLICY_DENIED" }],
            },
          },
        },
      ],
    });
    await service.close();
  });

  it("runs once, reports NDJSON, removes signal listeners and closes", async () => {
    const lines = [];
    const processRef = new EventEmitter();
    const close = vi.fn();
    const service = {
      run: vi.fn(async ({ once, intervalMs }) => {
        expect(once).toBe(true);
        expect(intervalMs).toBe(1_500);
        return {
          status: "succeeded",
          ticks: 1,
          omittedSummaries: 0,
          summaries: [],
        };
      }),
      close,
    };
    const createDefaultService = vi.fn(async ({ domains, onEvent }) => {
      expect(domains).toEqual(["agenda"]);
      onEvent({ type: "scheduler-service-started", drivers: domains });
      return service;
    });

    await expect(
      runSchedulerDaemon(
        {
          once: true,
          interval: "1.5",
          domains: "agenda",
          json: true,
        },
        {
          createDefaultService,
          processRef,
          log: (line) => lines.push(line),
        },
      ),
    ).resolves.toBe(0);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { type: "scheduler-service-started", drivers: ["agenda"] },
      {
        type: "scheduler-run-summary",
        status: "succeeded",
        ticks: 1,
        omittedSummaries: 0,
        summaries: [],
      },
    ]);
    expect(processRef.listenerCount("SIGINT")).toBe(0);
    expect(processRef.listenerCount("SIGTERM")).toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns failure for a degraded tick without hiding the incident", async () => {
    const service = {
      run: vi.fn(async () => ({
        status: "degraded",
        ticks: 1,
        omittedSummaries: 0,
        summaries: [],
      })),
      close: vi.fn(),
    };
    const lines = [];

    await expect(
      runSchedulerDaemon(
        { once: true, interval: "5", domains: "agenda", json: false },
        {
          createDefaultService: async () => service,
          processRef: new EventEmitter(),
          log: (line) => lines.push(String(line)),
        },
      ),
    ).resolves.toBe(1);
    expect(lines.join("\n")).toMatch(/with failures/u);
  });
});
