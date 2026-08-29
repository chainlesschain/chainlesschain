import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGGREGATE_SCHEMA,
  FORMAL_DURATION_MS,
  FORMAL_QUEUE_WAIT_SLO_MS,
  RESULT_SCHEMA,
  resolveTeamFairnessProfile,
  runTeamFairnessSoak,
  validateTeamFairnessEvidence,
  verifyTeamFairnessEvidenceSet,
} from "../../scripts/team-fairness-soak.mjs";

const RELEASE_COMMIT = "a".repeat(40);
const temporaryDirectories = [];

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function signEvidence(value) {
  const copy = structuredClone(value);
  delete copy.evidenceDigest;
  value.evidenceDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(stableValue(copy)), "utf8")
    .digest("hex")}`;
  return value;
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "cc-team-fairness-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function formalEvidence(operatingSystem) {
  const profile = {
    mode: "formal",
    queueWaitSloMs: 10_000,
    durationMs: 30_000,
    agingWindowMs: 2_500,
    producerIntervalMs: 50,
    highTaskDelayMs: 25,
    highTasksPerTick: 2,
    initialHighTasks: 20,
    scopeHoldMs: 8_000,
    teammates: 3,
  };
  return signEvidence({
    schema: RESULT_SCHEMA,
    status: "passed",
    releaseCommit: RELEASE_COMMIT,
    headSha: RELEASE_COMMIT,
    expectedSha: RELEASE_COMMIT,
    exactShaVerified: true,
    startedAt: "2026-08-29T00:00:00.000Z",
    completedAt: "2026-08-29T00:00:31.000Z",
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
      workflow: "CLI Team Fairness Soak",
      eventName: "workflow_dispatch",
      runId: "33190589429",
      runAttempt: 1,
      controlPlaneSha: RELEASE_COMMIT,
      runUrl:
        "https://github.com/chainlesschain/chainlesschain/actions/runs/33190589429/attempts/1",
    },
    profile,
    continuousDurationMs: 30_050,
    workload: {
      highTasksAdded: 1_220,
      highTasksCompleted: 1_220,
      highClaimsDuringProducer: 1_200,
      highServiceSpanMs: 29_900,
      maxHighServiceGapMs: 75,
    },
    observations: {
      dependencyLow: {
        queueWaitMs: 5,
        schedulingPriority: { donation: 2, criticalPathBoost: 1 },
      },
      scopeWaiter: { queueWaitMs: 8_010 },
      independentLow: {
        claimedAt: "2026-08-29T00:00:05.100Z",
        queueWaitMs: 7_550,
        schedulingPriority: { sloUrgent: true, aging: 3, total: 3 },
      },
      scopeDonationCount: 1,
      firstScopeDonation: {
        holderKey: "20-scope-holder",
        waiterKey: "21-scope-waiter-high",
      },
    },
    invariants: {
      durationAtLeastThreeSlo: true,
      dependencyPriorityDonated: true,
      dependencyServedWithinSlo: true,
      scopePriorityDonated: true,
      scopeWaiterServedWithinSlo: true,
      nonConflictingLowAged: true,
      nonConflictingLowServedWithinSlo: true,
      sustainedHighPriorityService: true,
      everyHighTaskSettled: true,
      scopeOwnershipReleased: true,
    },
    summary: { done: true },
    violations: [],
  });
}

describe("Team fairness soak", () => {
  it("freezes a formal 10-second SLO and at least 3x observation window", () => {
    const profile = resolveTeamFairnessProfile({
      CC_TEAM_FAIRNESS_MODE: "formal",
      CC_TEAM_FAIRNESS_QUEUE_WAIT_SLO_MS: "1",
      CC_TEAM_FAIRNESS_DURATION_MS: "1",
      CC_TEAM_FAIRNESS_AGING_WINDOW_MS: "999999",
    });

    expect(profile).toMatchObject({
      mode: "formal",
      queueWaitSloMs: FORMAL_QUEUE_WAIT_SLO_MS,
      durationMs: FORMAL_DURATION_MS,
      agingWindowMs: 2_500,
      teammates: 3,
    });
    expect(profile.durationMs).toBeGreaterThanOrEqual(
      profile.queueWaitSloMs * 3,
    );
  });

  it(
    "runs the real dependency, scope-conflict, and sustained-priority smoke workload",
    { timeout: 10_000 },
    async () => {
      const directory = temporaryDirectory();
      const output = join(directory, "smoke.json");
      const report = await runTeamFairnessSoak({
        env: {
          CC_TEAM_FAIRNESS_MODE: "smoke",
          CC_TEAM_FAIRNESS_EXPECTED_SHA: RELEASE_COMMIT,
          CC_TEAM_FAIRNESS_WORKFLOW_SHA: RELEASE_COMMIT,
        },
        output,
        sourceProvider: () => ({ headSha: RELEASE_COMMIT, changes: [] }),
      });

      expect(report.status).toBe("passed");
      expect(report.continuousDurationMs).toBeGreaterThanOrEqual(1_200);
      expect(Object.values(report.invariants).every(Boolean)).toBe(true);
      expect(report.observations).toMatchObject({
        dependencyLow: {
          schedulingPriority: { donation: 2, criticalPathBoost: 1 },
        },
        independentLow: {
          schedulingPriority: { aging: expect.any(Number) },
        },
        scopeDonationCount: expect.any(Number),
      });
      expect(
        report.observations.independentLow.schedulingPriority.aging,
      ).toBeGreaterThan(0);
      expect(
        report.observations.independentLow.schedulingPriority.total,
      ).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(report);
    },
  );

  it("rejects a forged passing boolean when the queue wait exceeded the SLO", () => {
    const evidence = formalEvidence("linux");
    evidence.observations.independentLow.queueWaitMs = 10_001;
    signEvidence(evidence);

    expect(() =>
      validateTeamFairnessEvidence(evidence, {
        releaseCommit: RELEASE_COMMIT,
        mode: "formal",
      }),
    ).toThrow(/aging observation/u);
  });

  it("rejects an aging claim made before one complete aging window", () => {
    const evidence = formalEvidence("linux");
    evidence.observations.independentLow.queueWaitMs = 2_499;
    signEvidence(evidence);

    expect(() =>
      validateTeamFairnessEvidence(evidence, {
        releaseCommit: RELEASE_COMMIT,
        mode: "formal",
      }),
    ).toThrow(/aging observation/u);
  });

  it("aggregates exactly one same-identity Linux, macOS, and Windows set", () => {
    const directory = temporaryDirectory();
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      writeFileSync(
        join(directory, `${operatingSystem}.json`),
        JSON.stringify(formalEvidence(operatingSystem)),
      );
    }

    const aggregate = verifyTeamFairnessEvidenceSet(directory, {
      releaseCommit: RELEASE_COMMIT,
      mode: "formal",
    });
    expect(aggregate).toMatchObject({
      schema: AGGREGATE_SCHEMA,
      status: "passed",
      releaseCommit: RELEASE_COMMIT,
      operatingSystems: [
        { operatingSystem: "linux" },
        { operatingSystem: "macos" },
        { operatingSystem: "windows" },
      ],
    });
  });
});
