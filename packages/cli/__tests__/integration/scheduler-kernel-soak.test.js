import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runSchedulerKernelSoak } from "../../scripts/scheduler-kernel-soak.mjs";

const EXPECTED_SHA = "0123456789abcdef0123456789abcdef01234567";
const SEED = 1_592_598_566;
const CAMPAIGN = "scheduler-soak-integration-campaign";
const SMOKE_PROFILE = Object.freeze({
  mode: "smoke",
  durationSeconds: 1,
  rounds: 1,
  steadyOccurrencesPerRound: 4,
  leaseMs: 1_000,
  pollMs: 10,
  checkpointIntervalSeconds: 1,
  cleanupDeadlineMs: 10_000,
  maxRssGrowthMb: 256,
  maxResourceGrowth: 16,
});

describe("scheduler kernel soak coordinator", () => {
  const temporaryRoots = [];

  afterEach(() => {
    while (temporaryRoots.length > 0) {
      fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
    }
  });

  it("proves the real two-worker kill, fencing, renewal, DST, backlog, and cleanup matrix", async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-scheduler-kernel-soak-"),
    );
    temporaryRoots.push(root);
    const output = path.join(root, "scheduler-kernel-soak.json");
    const sourceProvider = vi.fn(async () => ({
      headSha: EXPECTED_SHA,
      changes: [],
    }));

    const report = await runSchedulerKernelSoak({
      profile: SMOKE_PROFILE,
      expectedSha: EXPECTED_SHA,
      seed: SEED,
      campaign: CAMPAIGN,
      output,
      sourceProvider,
    });

    expect(sourceProvider).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({
      schema: expect.any(String),
      status: "passed",
      releaseCommit: EXPECTED_SHA,
      headSha: EXPECTED_SHA,
      expectedSha: EXPECTED_SHA,
      exactShaVerified: true,
      seed: SEED,
      campaign: CAMPAIGN,
      source: {
        clean: true,
        changeCount: 0,
        finalClean: true,
        finalChangeCount: 0,
      },
      runner: { operatingSystem: expect.any(String) },
      profile: {
        ...SMOKE_PROFILE,
        steadyStateOccurrences: 4,
      },
      continuousDurationSeconds: expect.any(Number),
      invariants: {
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
      },
      metrics: {
        passed: true,
        workerProcessesSpawned: 2,
        productiveWorkers: 2,
        rssGrowthMb: expect.any(Number),
        resourceGrowth: expect.any(Number),
      },
      database: { quickCheck: "ok" },
      cleanup: {
        passed: true,
        deadlineMs: SMOKE_PROFILE.cleanupDeadlineMs,
        durationMs: expect.any(Number),
        processes: expect.any(Array),
      },
      violations: [],
    });

    expect(report.continuousDurationSeconds).toBeGreaterThanOrEqual(
      SMOKE_PROFILE.durationSeconds,
    );
    expect(report.rounds).toHaveLength(1);
    const [round] = report.rounds;
    expect(round.round).toBe(1);
    expect(round.steady.occurrenceIds).toHaveLength(4);
    expect(new Set(round.steady.occurrenceIds).size).toBe(4);
    expect(round.steady.contentionClaims).toHaveLength(2);
    expect(
      new Set(round.steady.contentionClaims.map(({ workerId }) => workerId))
        .size,
    ).toBe(2);
    expect(
      new Set(round.steady.contentionClaims.map(({ owner }) => owner)).size,
    ).toBe(2);
    expect(
      new Set(
        round.steady.contentionClaims.map(({ occurrence }) => occurrence.id),
      ).size,
    ).toBe(2);
    expect(
      round.steady.contentionClaims.every(({ occurrence }) =>
        round.steady.occurrenceIds.includes(occurrence.id),
      ),
    ).toBe(true);
    expect(round.steady.statuses).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(round.steady.effectOwners).toHaveLength(4);
    expect(new Set(round.steady.effectOwners).size).toBe(2);

    const beforeExecute = round.beforeExecute;
    expect(beforeExecute).toMatchObject({
      noEffectBeforeKill: true,
      finalStatus: "succeeded",
      effectCount: 1,
      hardKill: {
        passed: true,
        rootRetired: true,
        descendants: { available: true, pids: expect.any(Array) },
        descendantRetirements: expect.any(Array),
      },
      staleSettlement: {
        rejected: true,
        error: { code: "SCHEDULER_LEASE_LOST" },
      },
      replacementRetirement: { retired: true },
      passed: true,
    });
    expect(beforeExecute.firstClaim.id).toBe(beforeExecute.occurrenceId);
    expect(beforeExecute.replacementClaim.id).toBe(beforeExecute.occurrenceId);
    expect(beforeExecute.replacementClaim.attempt).toBeGreaterThan(
      beforeExecute.firstClaim.attempt,
    );
    expect(beforeExecute.replacementClaim.fence).toBeGreaterThan(
      beforeExecute.firstClaim.fence,
    );
    expect(beforeExecute.replacementClaim.leaseOwner).not.toBe(
      beforeExecute.firstClaim.leaseOwner,
    );
    expect(
      beforeExecute.hardKill.descendantRetirements.every(
        ({ retired }) => retired === true,
      ),
    ).toBe(true);
    expect(beforeExecute.effect).toMatchObject({
      occurrenceId: beforeExecute.occurrenceId,
      fence: beforeExecute.replacementClaim.fence,
      resultDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });

    const afterExecute = round.afterExecute;
    expect(afterExecute).toMatchObject({
      claim: { id: afterExecute.occurrenceId },
      hardKill: {
        passed: true,
        rootRetired: true,
        descendants: { available: true, pids: expect.any(Array) },
        descendantRetirements: expect.any(Array),
      },
      effect: {
        countBefore: 1,
        countAfter: 1,
        hashBefore: expect.stringMatching(/^[a-f0-9]{64}$/u),
        hashAfter: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      observerClaimed: false,
      finalStatus: "dead_letter",
      lastError: { code: "lease_expired" },
      observerRetirement: { retired: true },
      passed: true,
    });
    expect(afterExecute.effect.hashAfter).toBe(afterExecute.effect.hashBefore);
    expect(
      afterExecute.hardKill.descendantRetirements.every(
        ({ retired }) => retired === true,
      ),
    ).toBe(true);

    expect(report.heartbeat).toMatchObject({
      contenderClaimed: false,
      finalStatus: "succeeded",
      renewalEvents: expect.any(Number),
      effect: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      winnerRetirement: { retired: true },
      contenderRetirement: { retired: true },
      passed: true,
    });
    expect(report.heartbeat.renewalEvents).toBeGreaterThan(0);
    expect(report.heartbeat.renewedLeaseExpiresAt).toBeGreaterThan(
      report.heartbeat.initialLeaseExpiresAt,
    );
    expect(report.heartbeat.protectedLeaseExpiresAt).toBeGreaterThan(
      report.heartbeat.initialLeaseExpiresAt,
    );

    expect(report.temporal).toMatchObject({
      passed: true,
      fallBack: { distinctFireKeys: true },
    });
    expect(report.temporal.springForward.agenda).toBe(
      report.temporal.springForward.expected,
    );
    expect(report.temporal.springForward.cowork).toBe(
      report.temporal.springForward.expected,
    );
    expect(report.temporal.fallBack.first).not.toBe(
      report.temporal.fallBack.second,
    );
    expect(report.temporal.fallBack.coworkFirst).toBe(
      report.temporal.fallBack.first,
    );
    expect(report.temporal.fallBack.coworkSecond).toBe(
      report.temporal.fallBack.second,
    );
    expect(report.temporal.backlog.latest).toBe(
      report.temporal.backlog.expected,
    );

    expect(
      Object.values(report.invariants).every((value) => value === true),
    ).toBe(true);
    expect(report.metrics.rssGrowthMb).toBeLessThanOrEqual(
      SMOKE_PROFILE.maxRssGrowthMb,
    );
    expect(report.metrics.resourceGrowth).toBeLessThanOrEqual(
      SMOKE_PROFILE.maxResourceGrowth,
    );
    expect(report.cleanup.durationMs).toBeLessThanOrEqual(
      SMOKE_PROFILE.cleanupDeadlineMs,
    );
    expect(report.totals).toEqual({
      rounds: 1,
      steadyOccurrences: 4,
      hardKills: 2,
      effects: 7,
    });
    expect(report.database).toMatchObject({
      quickCheck: "ok",
      statusCounts: { succeeded: 6, dead_letter: 1 },
      totalOccurrences: 7,
    });
    expect(report.cleanup.processes).toHaveLength(2);
    expect(new Set(report.cleanup.processes.map(({ pid }) => pid)).size).toBe(
      2,
    );
    expect(
      report.cleanup.processes.every(
        ({ pid, retired, graceful, code, signal, error }) =>
          Number.isSafeInteger(pid) &&
          pid > 0 &&
          retired === true &&
          graceful === true &&
          code === 0 &&
          signal === null &&
          error === null,
      ),
    ).toBe(true);

    expect(fs.existsSync(output)).toBe(true);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual(report);
  }, 120_000);
});
