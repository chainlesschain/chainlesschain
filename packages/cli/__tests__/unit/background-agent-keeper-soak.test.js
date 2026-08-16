import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_KEEPER_SOAK_AGGREGATE_SCHEMA,
  BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS,
  BACKGROUND_KEEPER_SOAK_RESULT_SCHEMA,
  BACKGROUND_KEEPER_SOAK_SMOKE_AGGREGATE_SCHEMA,
  BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA,
  assertKeeperCleanupWithinDeadline,
  backgroundKeeperSoakDocumentSha256,
  confirmKeeperSoakWorktreeRemoval,
  createBackgroundKeeperSoakRoot,
  hasSettledCooperativeStopCleanup,
  keeperCleanupTiming,
  nearestRankPercentile,
  pollUntil,
  resolveBackgroundKeeperSoakProfile,
  sealBackgroundKeeperSoakDocument,
  shouldDeferHardKillCleanupIdentityProbe,
  summarizeKeeperSoakSamples,
  terminateSlotBatch,
  verifyBackgroundKeeperSoakEvidenceSet,
  waitForCleanup,
} from "../../scripts/background-agent-keeper-soak.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(TEST_DIR, "../../../..");
const RELEASE_COMMIT = "a".repeat(40);
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureEvidence(operatingSystem, mode = "formal") {
  const formal = mode === "formal";
  const agents = formal ? 20 : 3;
  const cycleCount = formal ? 1_000 : 2;
  const durationSeconds = formal ? 7_200 : 5;
  const platform = {
    linux: "linux",
    macos: "darwin",
    windows: "win32",
  }[operatingSystem];
  const resourceKind = operatingSystem === "windows" ? "handle" : "fd";
  const profile = {
    mode,
    agents,
    durationSeconds,
    minimumCycles: cycleCount,
    cleanupDeadlineMs: 30_000,
    cleanupObserverDeadlineMs: formal ? 140_000 : 60_000,
    readinessDeadlineMs: 60_000,
    maxHarnessRssGrowthMb: 192,
    maxHarnessResourceGrowth: 12,
  };
  const cycles = Array.from({ length: cycleCount }, (_, index) => {
    const hardKill = index % 2 === 0;
    const terminationRequestedAt = 1_000_000 + index * 100;
    const durableCleanupRequestedAt = terminationRequestedAt + 2;
    const cleanupConfirmedAt = terminationRequestedAt + 10;
    return {
      cycle: index + 1,
      slot: index % agents,
      generation: Math.floor(index / agents) + 1,
      method: hardKill ? "hard-kill" : "stop",
      readinessMs: 20,
      cleanupMs: 10,
      durableCleanupMs: 8,
      cleanupObservationMs: 12,
      terminationRequestedAt,
      durableCleanupRequestedAt,
      cleanupConfirmedAt,
      cleanupReason: hardKill ? "worker-disconnected" : null,
      knownIdentityCount: 6,
      allKnownPidsRetired: true,
      recordRemoved: true,
      worktreeRetained: true,
      rssBytes: 1_024,
      resourceKind,
      resourceCount: 5,
    };
  });
  const slots = Array.from({ length: agents }, (_, index) => {
    const hardKill = index % 2 === 0;
    const finalTerminationRequestedAt = 2_000_000 + index * 100;
    const finalDurableCleanupRequestedAt = finalTerminationRequestedAt + 2;
    const finalCleanupConfirmedAt = finalTerminationRequestedAt + 10;
    return {
      index,
      readinessMs: 20,
      reconnectVerified: true,
      finalMethod: hardKill ? "hard-kill" : "stop",
      finalCleanupMs: 10,
      finalDurableCleanupMs: 8,
      finalCleanupObservationMs: 12,
      finalTerminationRequestedAt,
      finalDurableCleanupRequestedAt,
      finalCleanupConfirmedAt,
      finalCleanupReason: hardKill ? "worker-disconnected" : null,
      allKnownPidsRetired: true,
      worktreeRemoved: true,
    };
  });
  const metrics = summarizeKeeperSoakSamples([
    ...cycles,
    ...slots.map((slot) => ({
      cleanupMs: slot.finalCleanupMs,
      durableCleanupMs: slot.finalDurableCleanupMs,
      cleanupObservationMs: slot.finalCleanupObservationMs,
      readinessMs: slot.readinessMs,
      rssBytes: null,
      resourceCount: null,
    })),
  ]);
  const startedAt = new Date("2026-08-15T00:00:00.000Z");
  const report = {
    schema: formal
      ? BACKGROUND_KEEPER_SOAK_RESULT_SCHEMA
      : BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA,
    status: "passed",
    qualifyingEvidence: formal,
    releaseGateEligible: formal,
    releaseCommit: RELEASE_COMMIT,
    headSha: RELEASE_COMMIT,
    expectedSha: RELEASE_COMMIT,
    exactShaVerified: true,
    source: {
      clean: true,
      changeCount: 0,
      finalClean: true,
      finalChangeCount: 0,
    },
    platform,
    arch: "x64",
    node: "v22.12.0",
    runner: {
      operatingSystem,
      platform,
      architecture: "x64",
      nodeVersion: "v22.12.0",
    },
    profile,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(
      startedAt.getTime() + durationSeconds * 1_000,
    ).toISOString(),
    continuousDurationSeconds: durationSeconds,
    slots,
    cycles,
    violations: [],
    metrics: {
      ...metrics,
      harness: {
        before: {
          rssBytes: 10_000,
          resource: { kind: resourceKind, count: 5 },
        },
        after: {
          rssBytes: 10_000,
          resource: { kind: resourceKind, count: 5 },
        },
        rssGrowthBytes: 0,
        resourceGrowth: 0,
      },
    },
  };
  return sealBackgroundKeeperSoakDocument(report);
}

function writeEvidenceSet(evidence) {
  const directory = mkdtempSync(join(tmpdir(), "keeper-soak-evidence-"));
  temporaryDirectories.push(directory);
  evidence.forEach((entry, index) => {
    writeFileSync(
      join(directory, `${index}-${entry.runner.operatingSystem}.json`),
      `${JSON.stringify(entry, null, 2)}\n`,
      "utf8",
    );
  });
  return directory;
}

function completeEvidenceSet(mode = "formal") {
  return BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS.map((operatingSystem) =>
    fixtureEvidence(operatingSystem, mode),
  );
}

function refreshEvidenceMetrics(report) {
  const metrics = summarizeKeeperSoakSamples([
    ...report.cycles,
    ...report.slots.map((slot) => ({
      cleanupMs: slot.finalCleanupMs,
      durableCleanupMs: slot.finalDurableCleanupMs,
      cleanupObservationMs: slot.finalCleanupObservationMs,
      readinessMs: slot.readinessMs,
      rssBytes: null,
      resourceCount: null,
    })),
  ]);
  report.metrics = { ...report.metrics, ...metrics };
  return sealBackgroundKeeperSoakDocument(report);
}

describe("background Agent keeper soak contract", () => {
  it("canonicalizes a filesystem alias above owner-only soak state", () => {
    const parent = mkdtempSync(join(tmpdir(), "cc-keeper-root-alias-"));
    temporaryDirectories.push(parent);
    const canonical = join(parent, "canonical");
    const alias = join(parent, "alias");
    mkdirSync(canonical);
    symlinkSync(
      canonical,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );

    const root = createBackgroundKeeperSoakRoot(alias);

    expect(root).toBe(realpathSync(root));
    expect(root.startsWith(`${realpathSync(canonical)}${sep}`)).toBe(true);
  });

  it("keeps smoke profiles small but non-trivial", () => {
    expect(
      resolveBackgroundKeeperSoakProfile({
        CC_BACKGROUND_KEEPER_SOAK_MODE: "smoke",
        CC_BACKGROUND_KEEPER_SOAK_AGENTS: "3",
        CC_BACKGROUND_KEEPER_SOAK_DURATION_SECONDS: "2",
        CC_BACKGROUND_KEEPER_SOAK_MIN_CYCLES: "2",
      }),
    ).toMatchObject({
      mode: "smoke",
      agents: 3,
      durationSeconds: 2,
      minimumCycles: 2,
      cleanupObserverDeadlineMs: 60_000,
    });
  });

  it("enforces the formal 20-Agent, two-hour and 1,000-turn floors", () => {
    expect(
      resolveBackgroundKeeperSoakProfile({
        CC_BACKGROUND_KEEPER_SOAK_MODE: "formal",
        CC_BACKGROUND_KEEPER_SOAK_AGENTS: "2",
        CC_BACKGROUND_KEEPER_SOAK_DURATION_SECONDS: "5",
        CC_BACKGROUND_KEEPER_SOAK_MIN_CYCLES: "1",
      }),
    ).toMatchObject({
      mode: "formal",
      agents: 20,
      durationSeconds: 7_200,
      minimumCycles: 1_000,
      cleanupObserverDeadlineMs: 140_000,
    });
  });

  it("allows a 120-second formal readiness budget without widening smoke evidence", () => {
    const formalReports = completeEvidenceSet();
    for (const report of formalReports) {
      report.profile.readinessDeadlineMs = 120_000;
      sealBackgroundKeeperSoakDocument(report);
    }
    expect(
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir: writeEvidenceSet(formalReports),
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toMatchObject({ result: "passed", releaseGateEligible: true });

    const smokeReports = completeEvidenceSet("smoke");
    for (const report of smokeReports) {
      report.profile.readinessDeadlineMs = 120_000;
      sealBackgroundKeeperSoakDocument(report);
    }
    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir: writeEvidenceSet(smokeReports),
        releaseCommit: RELEASE_COMMIT,
        allowSmoke: true,
      }),
    ).toThrow(/profile floors/u);
  });

  it("accepts an idempotently absent final worktree path", async () => {
    const finish = vi.fn();
    const result = await confirmKeeperSoakWorktreeRemoval(
      { path: "/owned/worktree" },
      {
        worktree: {
          removed: false,
          kept: false,
          reason: "worktree path already missing",
        },
      },
      { pathExists: () => false, finishAgentWorktree: finish },
    );

    expect(result).toMatchObject({
      removed: true,
      initialRemoved: false,
      fallbackAttempts: 0,
      reason: "worktree path already missing",
    });
    expect(finish).not.toHaveBeenCalled();
  });

  it("retries only through the verified worktree cleanup seam", async () => {
    let pathPresent = true;
    const worktree = { path: "/owned/worktree" };
    const finish = vi
      .fn()
      .mockReturnValueOnce({
        removed: false,
        kept: true,
        reason: "cleanup failed: transient",
      })
      .mockImplementationOnce(() => {
        pathPresent = false;
        return { removed: true, kept: false, reason: "no changes" };
      });

    const result = await confirmKeeperSoakWorktreeRemoval(worktree, null, {
      pathExists: () => pathPresent,
      finishAgentWorktree: finish,
      timeoutMs: 100,
      intervalMs: 1,
    });

    expect(result).toMatchObject({
      removed: true,
      initialRemoved: false,
      fallbackAttempts: 2,
      reason: "no changes",
    });
    expect(finish).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenNthCalledWith(1, worktree);
    expect(finish).toHaveBeenNthCalledWith(2, worktree);
  });

  it("fails closed when the cleanup result claims removal but the path survives", async () => {
    const worktree = { path: "/owned/worktree" };
    const finish = vi.fn(() => ({
      removed: true,
      kept: false,
      reason: "synthetic stale projection",
    }));

    await expect(
      confirmKeeperSoakWorktreeRemoval(worktree, null, {
        pathExists: () => true,
        finishAgentWorktree: finish,
        timeoutMs: 5,
        intervalMs: 1,
      }),
    ).rejects.toThrow(/cleanup timed out/u);
    expect(finish).toHaveBeenCalled();
  });

  it("uses nearest-rank percentiles and ignores non-finite samples", () => {
    expect(nearestRankPercentile([40, 10, Number.NaN, 20, 30], 95)).toBe(40);
    expect(nearestRankPercentile([], 95)).toBeNull();
  });

  it("defers expensive hard-kill identity probes until the keeper is durably terminal", () => {
    expect(
      shouldDeferHardKillCleanupIdentityProbe(
        {
          turnKeeperStatus: "cleanup-requested",
          keeperStatus: "ready",
        },
        "hard-kill",
      ),
    ).toBe(true);
    expect(
      shouldDeferHardKillCleanupIdentityProbe(
        {
          turnKeeperStatus: "retired",
          turnKeeperCleanupConfirmedAt: Date.now(),
          keeperStatus: "worker-disconnected",
          keeperEndedAt: Date.now(),
        },
        "hard-kill",
      ),
    ).toBe(false);
    expect(shouldDeferHardKillCleanupIdentityProbe({}, "stop")).toBe(false);
  });

  it("summarizes cleanup, readiness, RSS and FD/handle evidence", () => {
    expect(
      summarizeKeeperSoakSamples([
        {
          cleanupMs: 20,
          durableCleanupMs: 15,
          cleanupObservationMs: 25,
          readinessMs: 50,
          rssBytes: 100,
          resourceCount: 4,
        },
        {
          cleanupMs: 40,
          durableCleanupMs: 30,
          cleanupObservationMs: 45,
          readinessMs: 70,
          rssBytes: 200,
          resourceCount: 6,
        },
      ]),
    ).toEqual({
      count: 2,
      cleanupP95Ms: 40,
      cleanupMaximumMs: 40,
      durableCleanupP95Ms: 30,
      durableCleanupMaximumMs: 30,
      cleanupObservationP95Ms: 45,
      cleanupObservationMaximumMs: 45,
      readinessP95Ms: 70,
      readinessMaximumMs: 70,
      rssMaximumBytes: 200,
      resourceMaximum: 6,
    });
  });

  it("runs every prepare before any trigger and every trigger before observation", async () => {
    const events = [];
    const plans = Array.from({ length: 3 }, (_, index) => ({
      cycleNumber: index + 1,
      slot: { index },
      method: index % 2 === 0 ? "hard-kill" : "stop",
    }));
    let monotonic = 0;
    const settlements = await terminateSlotBatch(
      plans,
      { cleanupObserverDeadlineMs: 140_000 },
      {
        epochNow: () => 1_000 + monotonic,
        monotonicNow: () => monotonic++,
        prepareTermination(plan) {
          events.push(`prepare:${plan.slot.index}`);
          return { key: { slot: plan.slot.index }, ...plan };
        },
        triggerTermination(prepared) {
          events.push(`trigger:${prepared.key.slot}`);
          return {
            ...prepared,
            terminationRequestedAt: 1_000,
            terminationStartedAtMonotonicMs: 0,
            triggerError: null,
          };
        },
        async observeTermination(attempt) {
          events.push(`observe:${attempt.key.slot}`);
          return { slot: attempt.key.slot };
        },
      },
    );
    expect(events).toEqual([
      "prepare:0",
      "prepare:1",
      "prepare:2",
      "trigger:0",
      "trigger:2",
      "trigger:1",
      "observe:0",
      "observe:1",
      "observe:2",
    ]);
    expect(settlements).toEqual([{ slot: 0 }, { slot: 1 }, { slot: 2 }]);
  });

  it("repairs the first cooperative stop after all twenty triggers dispatch", async () => {
    const events = [];
    const slots = Array.from({ length: 20 }, (_, index) => ({
      index,
      state: { id: `bg-batch-stop-proof-${index}` },
      evidence: null,
      knownIdentities: new Map(),
    }));
    const plans = slots.map((slot, index) => ({
      cycleNumber: index + 1,
      slot,
      method: index % 2 === 0 ? "hard-kill" : "stop",
    }));
    let stopState = {
      id: slots[1].state.id,
      status: "stopped",
      stopRequestedAt: 1_001,
    };
    const stop = vi.fn(() => {
      stopState = { ...stopState, stopCleanupConfirmedAt: 1_010 };
      return stopState;
    });

    const settlements = await terminateSlotBatch(
      plans,
      { cleanupDeadlineMs: 1_000, cleanupObserverDeadlineMs: 1_000 },
      {
        epochNow: () => 1_000,
        monotonicNow: () => 20,
        prepareTermination(plan) {
          return {
            key: {
              id: plan.slot.state.id,
              slot: plan.slot.index,
              cycle: plan.cycleNumber,
            },
            ...plan,
          };
        },
        triggerTermination(prepared) {
          events.push(`trigger:${prepared.key.slot}`);
          return {
            ...prepared,
            terminationRequestedAt: 1_000,
            terminationStartedAtMonotonicMs: 0,
            triggerError: null,
          };
        },
        async observeTermination(attempt) {
          events.push(`observe:${attempt.key.slot}`);
          if (attempt.key.slot !== 1) return { slot: attempt.key.slot };
          attempt.slot.state = stopState;
          await waitForCleanup(
            attempt.slot,
            { cleanupDeadlineMs: 1_000 },
            attempt.terminationStartedAtMonotonicMs,
            attempt.method,
            {
              readBackgroundAgentState: () => stopState,
              processIdentities: () => [
                { role: "worker", pid: 123, startedAt: 900 },
              ],
              ownedIdentityAlive: () => false,
              stopBackgroundAgent: stop,
              readBackgroundAgentLog: () => "",
            },
          );
          return keeperCleanupTiming(attempt, stopState, 20);
        },
      },
    );

    expect(events.slice(0, 20)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `trigger:${index * 2}`),
      ...Array.from({ length: 10 }, (_, index) => `trigger:${index * 2 + 1}`),
    ]);
    expect(events.slice(20)).toEqual(
      Array.from({ length: 20 }, (_, index) => `observe:${index}`),
    );
    expect(stop).toHaveBeenCalledOnce();
    expect(settlements[1]).toMatchObject({
      terminationRequestedAt: 1_000,
      durableCleanupRequestedAt: 1_001,
      cleanupConfirmedAt: 1_010,
    });
  });

  it("observes every trigger attempt before reporting a trigger failure", async () => {
    const events = [];
    const plans = [0, 1].map((index) => ({
      slot: { index },
      method: "hard-kill",
    }));
    await expect(
      terminateSlotBatch(
        plans,
        { cleanupObserverDeadlineMs: 140_000 },
        {
          epochNow: () => 1_000,
          monotonicNow: () => 10,
          prepareTermination(plan) {
            return { key: { slot: plan.slot.index }, ...plan };
          },
          triggerTermination(prepared) {
            events.push(`trigger:${prepared.key.slot}`);
            if (prepared.key.slot === 0) {
              throw new Error("signal outcome unknown");
            }
            return { ...prepared, triggerError: null };
          },
          async observeTermination(attempt) {
            events.push(`observe:${attempt.key.slot}`);
            return { slot: attempt.key.slot };
          },
        },
      ),
    ).rejects.toThrow("keeper soak termination batch failed");
    expect(events).toEqual([
      "trigger:0",
      "trigger:1",
      "observe:0",
      "observe:1",
    ]);
  });

  it("takes a final terminal probe after observer expiry and rejects late durable cleanup", async () => {
    let now = 0;
    let probes = 0;
    const terminal = { turnKeeperStatus: "retired" };
    const observed = await pollUntil(
      () => {
        probes += 1;
        return probes === 2 ? terminal : null;
      },
      30,
      "late terminal",
      10,
      {
        now: () => now,
        wait: async () => {
          now = 31;
        },
      },
    );
    expect(observed).toBe(terminal);
    const timing = keeperCleanupTiming(
      {
        key: { slot: 0 },
        method: "hard-kill",
        terminationRequestedAt: 1_000,
        terminationStartedAtMonotonicMs: 0,
      },
      {
        turnKeeperCleanupRequestedAt: 1_000,
        turnKeeperCleanupConfirmedAt: 31_001,
      },
      31_100,
    );
    expect(timing).toMatchObject({
      cleanupMs: 30_001,
      durableCleanupMs: 30_001,
      cleanupObservationMs: 31_100,
    });
    expect(() =>
      assertKeeperCleanupWithinDeadline(timing, {
        cleanupDeadlineMs: 30_000,
      }),
    ).toThrow(/durableCleanupMs 30001ms/u);
  });

  it("does not use an early worker endedAt as cooperative-stop cleanup proof", () => {
    const attempt = {
      key: { slot: 0 },
      method: "stop",
      terminationRequestedAt: 1_000,
      terminationStartedAtMonotonicMs: 0,
    };
    expect(() =>
      keeperCleanupTiming(
        attempt,
        {
          stopRequestedAt: 1_000,
          endedAt: 1_010,
        },
        45_000,
      ),
    ).toThrow(/invalid stop cleanup timestamps/u);

    const timing = keeperCleanupTiming(
      attempt,
      {
        stopRequestedAt: 1_000,
        endedAt: 1_010,
        stopCleanupConfirmedAt: 46_000,
      },
      45_000,
    );
    expect(timing).toMatchObject({
      cleanupMs: 45_000,
      durableCleanupMs: 45_000,
      cleanupObservationMs: 45_000,
    });
    expect(() =>
      assertKeeperCleanupWithinDeadline(timing, {
        cleanupDeadlineMs: 30_000,
      }),
    ).toThrow(/durableCleanupMs 45000ms/u);
  });

  it("requires durable proof before a cooperative stop is considered settled", () => {
    expect(
      hasSettledCooperativeStopCleanup({
        status: "stopped",
        stopRequestedAt: 1_000,
      }),
    ).toBe(false);
    expect(
      hasSettledCooperativeStopCleanup({
        status: "stopped",
        stopRequestedAt: 1_000,
        stopCleanupConfirmedAt: 999,
      }),
    ).toBe(false);
    expect(
      hasSettledCooperativeStopCleanup({
        status: "stopped",
        stopRequestedAt: 1_000,
        stopCleanupConfirmedAt: 1_001,
      }),
    ).toBe(true);
  });

  it("retries an all-retired unconfirmed stop until durable proof is published", async () => {
    const unconfirmed = {
      id: "bg-delayed-stop-proof",
      status: "stopped",
      stopRequestedAt: 1_000,
    };
    const confirmed = {
      ...unconfirmed,
      stopCleanupConfirmedAt: 1_010,
    };
    let current = unconfirmed;
    const stop = vi.fn(() => {
      current = confirmed;
      return current;
    });
    const slot = {
      index: 1,
      state: unconfirmed,
      evidence: null,
      knownIdentities: new Map(),
    };

    await waitForCleanup(slot, { cleanupDeadlineMs: 1_000 }, 0, "stop", {
      readBackgroundAgentState: () => current,
      processIdentities: () => [{ role: "worker", pid: 123, startedAt: 900 }],
      ownedIdentityAlive: () => false,
      stopBackgroundAgent: stop,
      readBackgroundAgentLog: () => "",
    });

    expect(stop).toHaveBeenCalledOnce();
    expect(slot.state).toBe(confirmed);
    expect(hasSettledCooperativeStopCleanup(slot.state)).toBe(true);
  });

  it("re-enters a live unconfirmed stop before waiting for retirement", async () => {
    const unconfirmed = {
      id: "bg-live-delayed-stop-proof",
      status: "stopped",
      stopRequestedAt: 2_000,
    };
    const confirmed = {
      ...unconfirmed,
      stopCleanupConfirmedAt: 2_010,
    };
    let current = unconfirmed;
    let alive = true;
    const stop = vi.fn(() => {
      alive = false;
      current = confirmed;
      return current;
    });
    const slot = {
      index: 1,
      state: unconfirmed,
      evidence: null,
      knownIdentities: new Map(),
    };

    await waitForCleanup(slot, { cleanupDeadlineMs: 1_000 }, 0, "stop", {
      readBackgroundAgentState: () => current,
      processIdentities: () => [{ role: "worker", pid: 456, startedAt: 1_900 }],
      ownedIdentityAlive: () => alive,
      stopBackgroundAgent: stop,
      readBackgroundAgentLog: () => "",
    });

    expect(stop).toHaveBeenCalledOnce();
    expect(alive).toBe(false);
    expect(slot.state).toBe(confirmed);
    expect(hasSettledCooperativeStopCleanup(slot.state)).toBe(true);
  });

  it("re-enters a live running stop fence before waiting for retirement", async () => {
    const pending = {
      id: "bg-live-running-stop-fence",
      status: "running",
      phase: "stop_waiting_for_exit",
      stopRequestedAt: 3_000,
      stopPending: true,
      stopPendingReason: "process-exit",
    };
    const confirmed = {
      ...pending,
      status: "stopped",
      phase: null,
      stopPending: false,
      stopPendingReason: null,
      stopCleanupConfirmedAt: 3_010,
    };
    let current = pending;
    let alive = true;
    const stop = vi.fn(() => {
      alive = false;
      current = confirmed;
      return current;
    });
    const slot = {
      index: 1,
      state: pending,
      evidence: null,
      knownIdentities: new Map(),
    };

    await waitForCleanup(slot, { cleanupDeadlineMs: 1_000 }, 0, "stop", {
      readBackgroundAgentState: () => current,
      processIdentities: () => [{ role: "worker", pid: 789, startedAt: 2_900 }],
      ownedIdentityAlive: () => alive,
      stopBackgroundAgent: stop,
      readBackgroundAgentLog: () => "",
    });

    expect(stop).toHaveBeenCalledOnce();
    expect(alive).toBe(false);
    expect(slot.state).toBe(confirmed);
    expect(hasSettledCooperativeStopCleanup(slot.state)).toBe(true);
  });

  it("repairs but rejects a lost terminal stop fence as non-qualifying", async () => {
    const pending = {
      id: "bg-lost-stop-fence",
      status: "lost",
      lostReason: "pid-reused",
      stopRequestedAt: 4_000,
    };
    const repaired = {
      ...pending,
      stopCleanupConfirmedAt: 4_010,
    };
    let current = pending;
    const stop = vi.fn(() => {
      current = repaired;
      return current;
    });
    const slot = {
      index: 2,
      state: pending,
      evidence: null,
      knownIdentities: new Map(),
    };

    await expect(
      waitForCleanup(slot, { cleanupDeadlineMs: 1_000 }, 0, "stop", {
        readBackgroundAgentState: () => current,
        processIdentities: () => [
          { role: "worker", pid: 890, startedAt: 3_900 },
        ],
        ownedIdentityAlive: () => false,
        stopBackgroundAgent: stop,
        readBackgroundAgentLog: () => "",
      }),
    ).rejects.toThrow(
      /retained unexpected terminal status "lost" after stop cleanup proof/u,
    );

    expect(stop).toHaveBeenCalledOnce();
    expect(hasSettledCooperativeStopCleanup(repaired)).toBe(false);
  });

  it("includes the rejected stop proof tuple in the failure diagnostic", () => {
    expect(() =>
      keeperCleanupTiming(
        {
          key: { id: "bg-invalid-stop-proof", slot: 1 },
          method: "stop",
          terminationRequestedAt: 1_000,
          terminationStartedAtMonotonicMs: 0,
        },
        {
          id: "bg-invalid-stop-proof",
          status: "stopped",
          stopRequestedAt: 1_001,
        },
        10,
      ),
    ).toThrow(
      /"id":"bg-invalid-stop-proof".*"status":"stopped".*"terminationRequestedAt":1000.*"durableCleanupRequestedAt":1001.*"cleanupConfirmedAt":null/u,
    );
  });

  it("fails closed when the independent observer budget finds no terminal state", async () => {
    let now = 0;
    let probes = 0;
    await expect(
      pollUntil(
        () => {
          probes += 1;
          return null;
        },
        30,
        "missing terminal",
        10,
        {
          now: () => now,
          wait: async (delayMs) => {
            now += delayMs;
          },
        },
      ),
    ).rejects.toThrow("missing terminal timed out after 30ms");
    expect(probes).toBe(5);
  });
});

describe("background Agent keeper soak aggregate contract", () => {
  it("uses v2 contracts and rejects resealed legacy v1 evidence", () => {
    expect([
      BACKGROUND_KEEPER_SOAK_RESULT_SCHEMA,
      BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA,
      BACKGROUND_KEEPER_SOAK_AGGREGATE_SCHEMA,
      BACKGROUND_KEEPER_SOAK_SMOKE_AGGREGATE_SCHEMA,
    ]).toEqual([
      "chainlesschain.background-agent-keeper-soak.v2",
      "chainlesschain.background-agent-keeper-soak-smoke.v2",
      "chainlesschain.background-agent-keeper-soak-aggregate.v2",
      "chainlesschain.background-agent-keeper-soak-smoke-aggregate.v2",
    ]);

    const reports = completeEvidenceSet();
    reports[0].schema = "chainlesschain.background-agent-keeper-soak.v1";
    sealBackgroundKeeperSoakDocument(reports[0]);
    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir: writeEvidenceSet(reports),
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/schema/u);
  });

  it("accepts exactly three sealed formal reports bound to one exact SHA", () => {
    const evidenceDir = writeEvidenceSet(completeEvidenceSet());
    const output = join(evidenceDir, "..", `aggregate-${Date.now()}.json`);
    temporaryDirectories.push(output);

    const aggregate = verifyBackgroundKeeperSoakEvidenceSet({
      evidenceDir,
      releaseCommit: RELEASE_COMMIT,
      output,
    });

    expect(aggregate).toMatchObject({
      schema: BACKGROUND_KEEPER_SOAK_AGGREGATE_SCHEMA,
      result: "passed",
      qualifyingEvidence: true,
      releaseGateEligible: true,
      releaseCommit: RELEASE_COMMIT,
      headSha: RELEASE_COMMIT,
      expectedSha: RELEASE_COMMIT,
      exactShaVerified: true,
      operatingSystems: ["linux", "macos", "windows"],
      totals: {
        agents: 60,
        cycles: 3_000,
        violations: 0,
        survivingPids: 0,
        survivingWorktrees: 0,
        resourceTrendViolations: 0,
      },
    });
    expect(aggregate.evidence).toHaveLength(3);
    expect(
      aggregate.evidence.every(
        (entry) =>
          entry.durationSeconds >= 7_200 &&
          entry.agents >= 20 &&
          entry.cycles >= 1_000 &&
          entry.violations === 0 &&
          entry.survivingPids === 0 &&
          entry.survivingWorktrees === 0 &&
          entry.resourceTrendViolations === 0,
      ),
    ).toBe(true);
    expect(
      aggregate.evidence.every((entry) => /^[0-9a-f]{64}$/u.test(entry.sha256)),
    ).toBe(true);
    expect(aggregate.integrity.digest).toBe(
      backgroundKeeperSoakDocumentSha256(aggregate),
    );
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(aggregate);
  });

  it("refuses smoke by default and only emits explicit non-qualifying output when allowed", () => {
    const evidenceDir = writeEvidenceSet(completeEvidenceSet("smoke"));

    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir,
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/requires formal evidence/u);

    const aggregate = verifyBackgroundKeeperSoakEvidenceSet({
      evidenceDir,
      releaseCommit: RELEASE_COMMIT,
      allowSmoke: true,
    });
    expect(aggregate).toMatchObject({
      schema: BACKGROUND_KEEPER_SOAK_SMOKE_AGGREGATE_SCHEMA,
      result: "non_qualifying_smoke_passed",
      qualifyingEvidence: false,
      releaseGateEligible: false,
      exactShaVerified: true,
    });
  });

  it("rejects missing and duplicate operating-system evidence", () => {
    const missing = writeEvidenceSet(completeEvidenceSet().slice(0, 2));
    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir: missing,
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/exactly three JSON files/u);

    const duplicateReports = completeEvidenceSet();
    duplicateReports[2] = fixtureEvidence("linux");
    const duplicate = writeEvidenceSet(duplicateReports);
    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir: duplicate,
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/exactly linux, macos, windows/u);
  });

  it("rejects byte-level report tampering even when semantic gate fields are untouched", () => {
    const reports = completeEvidenceSet();
    reports[0].runner.architecture = "tampered";
    const evidenceDir = writeEvidenceSet(reports);

    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir,
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/integrity digest/u);
  });

  it("rejects resealed reports below formal floors or with cleanup/resource violations", () => {
    const mutations = [
      (report) => {
        report.profile.durationSeconds = 7_199;
        report.continuousDurationSeconds = 7_199;
      },
      (report) => {
        report.profile.agents = 19;
        report.slots.pop();
      },
      (report) => {
        report.profile.minimumCycles = 999;
        report.cycles.pop();
      },
      (report) => {
        report.violations.push("synthetic violation");
      },
      (report) => {
        for (const cycle of report.cycles) {
          cycle.method = "hard-kill";
          cycle.cleanupReason = "worker-disconnected";
        }
      },
      (report) => {
        report.slots[0].allKnownPidsRetired = false;
      },
      (report) => {
        report.metrics.harness.after.resource.count = 18;
        report.metrics.harness.resourceGrowth = 13;
      },
      (report) => {
        report.expectedSha = "b".repeat(40);
      },
    ];

    for (const mutate of mutations) {
      const reports = completeEvidenceSet();
      mutate(reports[0]);
      sealBackgroundKeeperSoakDocument(reports[0]);
      const evidenceDir = writeEvidenceSet(reports);
      expect(() =>
        verifyBackgroundKeeperSoakEvidenceSet({
          evidenceDir,
          releaseCommit: RELEASE_COMMIT,
        }),
      ).toThrow(/invalid background Agent keeper soak evidence/u);
    }
  });

  it("rejects one over-deadline cycle even when p95 remains below the deadline", () => {
    const reports = completeEvidenceSet();
    const slow = reports[0].cycles.at(-1);
    slow.durableCleanupRequestedAt = slow.terminationRequestedAt;
    slow.cleanupConfirmedAt = slow.terminationRequestedAt + 30_001;
    slow.cleanupMs = 30_001;
    slow.durableCleanupMs = 30_001;
    slow.cleanupObservationMs = 30_100;
    refreshEvidenceMetrics(reports[0]);
    expect(reports[0].metrics.cleanupP95Ms).toBe(10);
    expect(reports[0].metrics.cleanupMaximumMs).toBe(30_001);
    const evidenceDir = writeEvidenceSet(reports);
    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir,
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/cycle count, metrics or cleanup/u);
  });

  it("rejects one over-deadline final cleanup even when p95 remains below the deadline", () => {
    const reports = completeEvidenceSet();
    const slow = reports[0].slots.at(-1);
    slow.finalDurableCleanupRequestedAt = slow.finalTerminationRequestedAt;
    slow.finalCleanupConfirmedAt = slow.finalTerminationRequestedAt + 30_001;
    slow.finalCleanupMs = 30_001;
    slow.finalDurableCleanupMs = 30_001;
    slow.finalCleanupObservationMs = 30_100;
    refreshEvidenceMetrics(reports[0]);
    expect(reports[0].metrics.cleanupP95Ms).toBe(10);
    expect(reports[0].metrics.cleanupMaximumMs).toBe(30_001);
    const evidenceDir = writeEvidenceSet(reports);
    expect(() =>
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir,
        releaseCommit: RELEASE_COMMIT,
      }),
    ).toThrow(/final PID\/worktree cleanup/u);
  });

  it("accepts an exact 30-second cleanup boundary", () => {
    const reports = completeEvidenceSet();
    const boundary = reports[0].cycles.at(-1);
    boundary.durableCleanupRequestedAt = boundary.terminationRequestedAt;
    boundary.cleanupConfirmedAt = boundary.terminationRequestedAt + 30_000;
    boundary.cleanupMs = 30_000;
    boundary.durableCleanupMs = 30_000;
    boundary.cleanupObservationMs = 30_050;
    refreshEvidenceMetrics(reports[0]);
    const evidenceDir = writeEvidenceSet(reports);
    expect(
      verifyBackgroundKeeperSoakEvidenceSet({
        evidenceDir,
        releaseCommit: RELEASE_COMMIT,
      }).result,
    ).toBe("passed");
  });

  it("downloads the exact-SHA matrix and verifies it in an always-run aggregate job", () => {
    const workflow = readFileSync(
      join(
        REPOSITORY_ROOT,
        ".github/workflows/cli-background-agent-keeper-soak.yml",
      ),
      "utf8",
    );
    const aggregateJob = workflow.slice(
      workflow.indexOf("  keeper-soak-aggregate:"),
    );

    expect(workflow).toContain(
      'CC_BACKGROUND_KEEPER_SOAK_CLEANUP_DEADLINE_MS: "30000"',
    );
    expect(workflow).toContain(
      "CC_BACKGROUND_KEEPER_SOAK_CLEANUP_OBSERVER_DEADLINE_MS: ${{ github.event_name == 'pull_request' && '60000' || '140000' }}",
    );
    expect(workflow).toContain(
      "CC_BACKGROUND_KEEPER_SOAK_READINESS_DEADLINE_MS: ${{ github.event_name == 'pull_request' && '60000' || '120000' }}",
    );
    expect(aggregateJob).toContain("if: always()");
    expect(aggregateJob).toContain("needs: keeper-soak");
    expect(aggregateJob).toContain("needs.keeper-soak.result != 'success'");
    expect(aggregateJob).toContain("actions/download-artifact@v7");
    expect(aggregateJob).toContain("merge-multiple: true");
    expect(aggregateJob).toContain("--verify-evidence-dir");
    expect(aggregateJob).toContain("--release-commit");
    expect(aggregateJob).toContain("--allow-smoke");
    expect(aggregateJob).toContain("smoke-non-qualifying");
    expect(aggregateJob).toContain("formal-aggregate");
  });
});
