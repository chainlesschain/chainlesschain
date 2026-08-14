import { describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGGREGATE_SCHEMA,
  RESULT_SCHEMA,
  evaluateSchedulerTemporalVectors,
  resolveSchedulerSoakProfile,
  schedulerSoakRoundDelayMs,
  validateSchedulerSoakEvidence,
  verifySchedulerSoakEvidenceSet,
} from "../../scripts/scheduler-kernel-soak.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const SEED = 1_592_598_566;
const CAMPAIGN = "p2-4-scheduler-long-soak-v1";
const STARTED_AT = "2026-08-14T00:00:00.000Z";
const COMPLETED_AT = "2026-08-14T02:00:00.000Z";
const OPERATING_SYSTEMS = ["linux", "macos", "windows"];
const COORDINATOR_PATH = fileURLToPath(
  new URL("../../scripts/scheduler-kernel-soak.mjs", import.meta.url),
);
const FORMAL_PROFILE = Object.freeze({
  mode: "formal",
  durationSeconds: 7_200,
  rounds: 100,
  steadyOccurrencesPerRound: 10,
  steadyStateOccurrences: 1_000,
  checkpointIntervalSeconds: 30,
  maxRssGrowthMb: 128,
  maxResourceGrowth: 8,
  cleanupDeadlineMs: 10_000,
  leaseMs: 1_000,
  pollMs: 50,
  executionDelayMs: 50,
  heartbeatDelayMs: 1_500,
});

const SMOKE_PROFILE = Object.freeze({
  mode: "smoke",
  durationSeconds: 15,
  rounds: 2,
  steadyOccurrencesPerRound: 4,
  steadyStateOccurrences: 8,
  checkpointIntervalSeconds: 1,
  maxRssGrowthMb: 128,
  maxResourceGrowth: 8,
  cleanupDeadlineMs: 10_000,
  leaseMs: 1_000,
  pollMs: 10,
  executionDelayMs: 25,
  heartbeatDelayMs: 1_500,
});

const PASSED_INVARIANTS = Object.freeze({
  twoWorkerContention: true,
  beforeExecuteHigherFence: true,
  staleSettlementRejected: true,
  afterExecuteDeadLettered: true,
  afterExecuteNoReplay: true,
  heartbeatRenewed: true,
  dstSemantics: true,
  backlogDrained: true,
  databaseQuickCheck: true,
  allProcessesRetired: true,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function schedulerEvidence(operatingSystem) {
  return {
    schema: RESULT_SCHEMA,
    status: "passed",
    releaseCommit: RELEASE_COMMIT,
    headSha: RELEASE_COMMIT,
    expectedSha: RELEASE_COMMIT,
    exactShaVerified: true,
    seed: SEED,
    campaign: CAMPAIGN,
    startedAt: STARTED_AT,
    completedAt: COMPLETED_AT,
    source: {
      clean: true,
      changeCount: 0,
      finalClean: true,
      finalChangeCount: 0,
    },
    runner: { operatingSystem },
    execution: {
      provider: "github-actions",
      repository: "chainlesschain/chainlesschain",
      workflow: "CLI Scheduler Kernel Soak",
      eventName: "workflow_dispatch",
      runId: "31150275109",
      runAttempt: 1,
      controlPlaneSha: RELEASE_COMMIT,
      runUrl:
        "https://github.com/chainlesschain/chainlesschain/actions/runs/31150275109/attempts/1",
    },
    profile: clone(FORMAL_PROFILE),
    continuousDurationSeconds: FORMAL_PROFILE.durationSeconds,
    invariants: clone(PASSED_INVARIANTS),
    metrics: {
      passed: true,
      rounds: FORMAL_PROFILE.rounds,
      steadyStateOccurrences: FORMAL_PROFILE.steadyStateOccurrences,
      workerProcessesSpawned: 2,
      productiveWorkers: 2,
      rssGrowthMb: 8,
      resourceGrowth: 0,
      sampleCount: 3,
      targets: ["coordinator", "steady-1", "steady-2"].map((label) => ({
        label,
        sampleCount: 3,
        rss: { peakGrowthBytes: 8 * 1024 * 1024 },
        resources: { peakGrowth: 0 },
        passed: true,
      })),
    },
    totals: {
      rounds: FORMAL_PROFILE.rounds,
      steadyOccurrences: FORMAL_PROFILE.steadyStateOccurrences,
      hardKills: FORMAL_PROFILE.rounds * 2,
      effects:
        FORMAL_PROFILE.steadyStateOccurrences + FORMAL_PROFILE.rounds * 2 + 1,
    },
    database: {
      quickCheck: "ok",
      statusCounts: {
        succeeded:
          FORMAL_PROFILE.steadyStateOccurrences + FORMAL_PROFILE.rounds + 1,
        dead_letter: FORMAL_PROFILE.rounds,
      },
      totalOccurrences:
        FORMAL_PROFILE.steadyStateOccurrences + FORMAL_PROFILE.rounds * 2 + 1,
    },
    cleanup: {
      passed: true,
      deadlineMs: FORMAL_PROFILE.cleanupDeadlineMs,
      durationMs: 25,
      processes: [
        {
          pid: 101,
          retired: true,
          graceful: true,
          code: 0,
          signal: null,
        },
        {
          pid: 102,
          retired: true,
          graceful: true,
          code: 0,
          signal: null,
        },
      ],
    },
    violations: [],
  };
}

function withEvidenceDirectory(callback) {
  const directory = mkdtempSync(join(tmpdir(), "cc-scheduler-soak-unit-"));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeEvidence(directory, filename, evidence) {
  writeFileSync(join(directory, filename), JSON.stringify(evidence));
}

function writeEvidenceSet(directory, mutate = () => {}) {
  for (const operatingSystem of OPERATING_SYSTEMS) {
    const evidence = schedulerEvidence(operatingSystem);
    mutate(evidence, operatingSystem);
    writeEvidence(directory, `${operatingSystem}.json`, evidence);
  }
}

function applyEvidenceProfile(evidence, profile) {
  evidence.profile = clone(profile);
  evidence.continuousDurationSeconds = profile.durationSeconds;
  evidence.metrics.rounds = profile.rounds;
  evidence.metrics.steadyStateOccurrences = profile.steadyStateOccurrences;
  evidence.totals = {
    rounds: profile.rounds,
    steadyOccurrences: profile.steadyStateOccurrences,
    hardKills: profile.rounds * 2,
    effects: profile.steadyStateOccurrences + profile.rounds * 2 + 1,
  };
}

function verifyOptions(evidenceDir, overrides = {}) {
  return {
    evidenceDir,
    releaseCommit: RELEASE_COMMIT,
    seed: SEED,
    campaign: CAMPAIGN,
    profile: FORMAL_PROFILE,
    ...overrides,
  };
}

describe("scheduler kernel soak coordinator", () => {
  it("publishes stable result and aggregate evidence schemas", () => {
    expect(RESULT_SCHEMA).toBe("chainlesschain.scheduler-kernel-soak.v1");
    expect(AGGREGATE_SCHEMA).toBe(
      "chainlesschain.scheduler-kernel-soak-aggregate.v1",
    );
  });

  it("keeps the formal two-hour, one-hundred-round, and one-thousand-occurrence floors", () => {
    const profile = resolveSchedulerSoakProfile({
      CC_SCHEDULER_SOAK_MODE: "formal",
      CC_SCHEDULER_SOAK_DURATION_SECONDS: "1",
      CC_SCHEDULER_SOAK_ROUNDS: "1",
      CC_SCHEDULER_SOAK_STEADY_OCCURRENCES_PER_ROUND: "1",
      CC_SCHEDULER_SOAK_CHECKPOINT_INTERVAL_SECONDS: "500",
      CC_SCHEDULER_SOAK_MAX_RSS_GROWTH_MB: "128",
      CC_SCHEDULER_SOAK_MAX_RESOURCE_GROWTH: "8",
      CC_SCHEDULER_SOAK_CLEANUP_DEADLINE_MS: "50000",
    });

    expect(profile).toMatchObject({
      mode: "formal",
      durationSeconds: 7_200,
      rounds: 100,
      steadyOccurrencesPerRound: 10,
      steadyStateOccurrences: 1_000,
      maxRssGrowthMb: 128,
      maxResourceGrowth: 8,
    });
    expect(profile.durationSeconds).toBeGreaterThanOrEqual(7_200);
    expect(profile.rounds).toBeGreaterThanOrEqual(100);
    expect(profile.steadyStateOccurrences).toBe(
      profile.rounds * profile.steadyOccurrencesPerRound,
    );
    expect(profile.steadyStateOccurrences).toBeGreaterThanOrEqual(1_000);
  });

  it("runs the first round immediately and pins the last round to the duration floor", () => {
    expect(schedulerSoakRoundDelayMs(0, 100, 7_200_000, 0)).toBe(0);
    expect(schedulerSoakRoundDelayMs(99, 100, 7_200_000, 7_000_000)).toBe(
      200_000,
    );
    expect(schedulerSoakRoundDelayMs(1, 1, 7_200_000, 0)).toBe(0);
  });

  it("evaluates deterministic spring-forward, fall-back, and long-backlog vectors", () => {
    const evaluation = evaluateSchedulerTemporalVectors();

    expect(evaluation).toEqual({
      passed: true,
      timeZone: "America/New_York",
      springForward: {
        from: "2026-03-08T06:59:00.000Z",
        expected: "2026-03-09T06:30:00.000Z",
        agenda: "2026-03-09T06:30:00.000Z",
        cowork: "2026-03-09T06:30:00.000Z",
      },
      fallBack: {
        first: "2026-11-01T05:30:00.000Z",
        second: "2026-11-01T06:30:00.000Z",
        coworkFirst: "2026-11-01T05:30:00.000Z",
        coworkSecond: "2026-11-01T06:30:00.000Z",
        distinctFireKeys: true,
      },
      backlog: {
        first: "2026-01-01T00:00:00.000Z",
        through: "2026-08-12T12:34:56.789Z",
        latest: "2026-08-12T12:34:56.000Z",
        expected: "2026-08-12T12:34:56.000Z",
      },
    });
  });

  it("accepts one exact-SHA formal evidence document", () => {
    const evidence = schedulerEvidence("linux");
    expect(
      validateSchedulerSoakEvidence(evidence, {
        releaseCommit: RELEASE_COMMIT,
        seed: SEED,
        campaign: CAMPAIGN,
        profile: FORMAL_PROFILE,
      }),
    ).toBe(evidence);
  });

  it.each([
    {
      label: "a non-integer seed",
      mutate: (evidence) => {
        evidence.seed = "not-an-integer";
      },
      expected: /seed/i,
    },
    {
      label: "an empty campaign",
      mutate: (evidence) => {
        evidence.campaign = " ";
      },
      expected: /campaign/i,
    },
  ])("rejects $label", ({ mutate, expected }) => {
    const evidence = schedulerEvidence("linux");
    mutate(evidence);
    expect(() => validateSchedulerSoakEvidence(evidence)).toThrow(expected);
  });

  it("aggregates exactly one successful evidence document from each platform", () => {
    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory);
      const output = join(directory, "aggregate-output.json");
      const aggregate = verifySchedulerSoakEvidenceSet(
        verifyOptions(directory, { output }),
      );

      expect(aggregate).toMatchObject({
        schema: AGGREGATE_SCHEMA,
        result: "passed",
        releaseCommit: RELEASE_COMMIT,
        seed: SEED,
        campaign: CAMPAIGN,
        operatingSystems: OPERATING_SYSTEMS,
        profile: FORMAL_PROFILE,
      });
      expect(aggregate.evidence).toHaveLength(3);
      expect(
        aggregate.evidence.map((entry) => entry.operatingSystem).sort(),
      ).toEqual(OPERATING_SYSTEMS);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(aggregate);
    });
  });

  it("rejects a missing or duplicate platform", () => {
    withEvidenceDirectory((directory) => {
      for (const operatingSystem of ["linux", "macos"]) {
        writeEvidence(
          directory,
          `${operatingSystem}.json`,
          schedulerEvidence(operatingSystem),
        );
      }
      expect(() =>
        verifySchedulerSoakEvidenceSet(verifyOptions(directory)),
      ).toThrow(/exactly.*linux.*macos.*windows|platform/i);
    });

    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory);
      writeEvidence(directory, "linux-copy.json", schedulerEvidence("linux"));
      expect(() =>
        verifySchedulerSoakEvidenceSet(verifyOptions(directory)),
      ).toThrow(/exactly.*linux.*macos.*windows|duplicate.*linux|platform/i);
    });
  });

  it.each([
    {
      label: "SHA",
      mutate: (evidence) => {
        evidence.headSha = "b".repeat(40);
      },
      expected: /sha|commit/i,
    },
    {
      label: "seed",
      mutate: (evidence) => {
        evidence.seed = SEED + 1;
      },
      expected: /seed/i,
    },
    {
      label: "campaign",
      mutate: (evidence) => {
        evidence.campaign = "different-campaign";
      },
      expected: /campaign/i,
    },
    {
      label: "run identity",
      mutate: (evidence) => {
        evidence.execution.runId = "different-run";
      },
      expected: /run metadata|run identity/i,
    },
  ])("rejects a mismatched $label", ({ mutate, expected }) => {
    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory, (evidence, operatingSystem) => {
        if (operatingSystem === "windows") mutate(evidence);
      });
      expect(() =>
        verifySchedulerSoakEvidenceSet(verifyOptions(directory)),
      ).toThrow(expected);
    });
  });

  it("rejects profiles that differ across platforms", () => {
    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory, (evidence, operatingSystem) => {
        if (operatingSystem !== "windows") return;
        evidence.profile.rounds = 101;
        evidence.profile.steadyStateOccurrences = 1_010;
      });
      expect(() =>
        verifySchedulerSoakEvidenceSet(verifyOptions(directory)),
      ).toThrow(/profile/i);
    });
  });

  it.each([
    {
      label: "a common smoke profile in a formal aggregate",
      evidenceProfile: SMOKE_PROFILE,
      expectedProfile: FORMAL_PROFILE,
    },
    {
      label: "a common two-hour profile for a requested four-hour aggregate",
      evidenceProfile: FORMAL_PROFILE,
      expectedProfile: { ...FORMAL_PROFILE, durationSeconds: 14_400 },
    },
  ])("rejects $label", ({ evidenceProfile, expectedProfile }) => {
    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory, (evidence) => {
        applyEvidenceProfile(evidence, evidenceProfile);
      });
      expect(() =>
        verifySchedulerSoakEvidenceSet(
          verifyOptions(directory, { profile: expectedProfile }),
        ),
      ).toThrow(/profile|duration|formal/i);
    });
  });

  it("binds the aggregate CLI to the requested formal duration", () => {
    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory);
      const output = join(directory, "unexpected-aggregate.json");
      const result = spawnSync(
        process.execPath,
        [
          COORDINATOR_PATH,
          "--verify-evidence-dir",
          directory,
          "--release-commit",
          RELEASE_COMMIT,
          "--seed",
          String(SEED),
          "--campaign",
          CAMPAIGN,
          "--output",
          output,
        ],
        {
          encoding: "utf8",
          timeout: 30_000,
          env: {
            ...process.env,
            CC_SCHEDULER_SOAK_MODE: "formal",
            CC_SCHEDULER_SOAK_DURATION_SECONDS: "14400",
            CC_SCHEDULER_SOAK_ROUNDS: "100",
            CC_SCHEDULER_SOAK_STEADY_OCCURRENCES_PER_ROUND: "10",
            CC_SCHEDULER_SOAK_LEASE_MS: "1000",
            CC_SCHEDULER_SOAK_POLL_MS: "50",
            CC_SCHEDULER_SOAK_CHECKPOINT_INTERVAL_SECONDS: "30",
            CC_SCHEDULER_SOAK_CLEANUP_DEADLINE_MS: "10000",
            CC_SCHEDULER_SOAK_MAX_RSS_GROWTH_MB: "128",
            CC_SCHEDULER_SOAK_MAX_RESOURCE_GROWTH: "8",
            CC_SCHEDULER_SOAK_EXECUTION_DELAY_MS: "50",
            CC_SCHEDULER_SOAK_HEARTBEAT_DELAY_MS: "1500",
          },
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/expected profile|requested profile/i);
      expect(existsSync(output)).toBe(false);
    });
  });

  it("rejects a common formal profile and evidence duration below two hours", () => {
    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory, (evidence) => {
        evidence.profile.durationSeconds = 7_199;
        evidence.continuousDurationSeconds = 7_199;
      });
      expect(() =>
        verifySchedulerSoakEvidenceSet(
          verifyOptions(directory, { profile: undefined }),
        ),
      ).toThrow(/duration|7.?200|formal|profile floors/i);
    });
  });

  it.each([
    {
      label: "status",
      mutate: (evidence) => {
        evidence.status = "failed";
        evidence.violations = [{ message: "scheduler scenario failed" }];
      },
      expected: /status|violations/i,
    },
    {
      label: "workflow control-plane identity",
      mutate: (evidence) => {
        evidence.execution.controlPlaneSha = "not-a-sha";
      },
      expected: /run metadata|workflow|sha/i,
    },
    {
      label: "wall-clock duration",
      mutate: (evidence) => {
        evidence.completedAt = "2026-08-14T01:59:59.000Z";
      },
      expected: /wall.clock|duration|time/i,
    },
    {
      label: "resource metrics",
      mutate: (evidence) => {
        evidence.metrics.passed = false;
        evidence.metrics.rssGrowthMb = 129;
      },
      expected: /metrics|resource|rss/i,
    },
    {
      label: "self-inconsistent resource metrics",
      mutate: (evidence) => {
        evidence.metrics.passed = true;
        evidence.metrics.rssGrowthMb = evidence.profile.maxRssGrowthMb + 1;
        evidence.metrics.resourceGrowth =
          evidence.profile.maxResourceGrowth + 1;
      },
      expected: /metrics|resource|rss/i,
    },
    {
      label: "incomplete formal workload totals",
      mutate: (evidence) => {
        evidence.metrics.rounds = evidence.profile.rounds - 1;
        evidence.metrics.steadyStateOccurrences =
          evidence.profile.steadyStateOccurrences - 1;
        evidence.totals.rounds = evidence.profile.rounds - 1;
        evidence.totals.steadyOccurrences =
          evidence.profile.steadyStateOccurrences - 1;
      },
      expected: /metrics|totals|rounds|steady/i,
    },
    {
      label: "two-worker participation metrics",
      mutate: (evidence) => {
        evidence.metrics.workerProcessesSpawned = 1;
        evidence.metrics.productiveWorkers = 1;
        evidence.metrics.targets = evidence.metrics.targets.slice(0, 2);
      },
      expected: /metrics|workers|targets|contention/i,
    },
    {
      label: "hard-kill and effect totals",
      mutate: (evidence) => {
        evidence.totals.hardKills -= 1;
        evidence.totals.effects -= 1;
      },
      expected: /totals|hard.?kills|effects/i,
    },
    {
      label: "a scheduler invariant",
      mutate: (evidence) => {
        evidence.invariants.staleSettlementRejected = false;
      },
      expected: /invariant|staleSettlementRejected/i,
    },
    {
      label: "a missing required scheduler invariant",
      mutate: (evidence) => {
        delete evidence.invariants.afterExecuteNoReplay;
      },
      expected: /invariant|afterExecuteNoReplay/i,
    },
    {
      label: "process cleanup",
      mutate: (evidence) => {
        evidence.cleanup.passed = false;
        evidence.cleanup.processes[0].retired = false;
      },
      expected: /cleanup|process|retired/i,
    },
    {
      label: "self-inconsistent process cleanup",
      mutate: (evidence) => {
        evidence.cleanup.passed = true;
        evidence.cleanup.processes[0].retired = false;
      },
      expected: /cleanup|process|retired/i,
    },
    {
      label: "cleanup deadline overrun",
      mutate: (evidence) => {
        evidence.cleanup.passed = true;
        evidence.cleanup.durationMs = evidence.cleanup.deadlineMs + 1;
      },
      expected: /cleanup|deadline|duration/i,
    },
  ])("rejects failed $label evidence", ({ mutate, expected }) => {
    withEvidenceDirectory((directory) => {
      writeEvidenceSet(directory, (evidence, operatingSystem) => {
        if (operatingSystem === "macos") mutate(evidence);
      });
      expect(() =>
        verifySchedulerSoakEvidenceSet(verifyOptions(directory)),
      ).toThrow(expected);
    });
  });
});
