import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultSchedulerService,
  adjudicateSchedulerOccurrence,
  buildSchedulerAdjudicationChallenge,
  getSchedulerAdjudicationCase,
  getSchedulerAuthorityPolicy,
  parseSchedulerDomains,
  parseSchedulerIntervalMs,
  parseSchedulerCapabilities,
  runSchedulerDaemon,
  setSchedulerAuthorityPolicy,
} from "../../src/commands/scheduler-daemon.js";

describe("scheduler daemon command", () => {
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
