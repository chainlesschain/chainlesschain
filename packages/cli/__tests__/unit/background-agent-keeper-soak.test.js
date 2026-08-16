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
import { afterEach, describe, expect, it } from "vitest";
import {
  BACKGROUND_KEEPER_SOAK_AGGREGATE_SCHEMA,
  BACKGROUND_KEEPER_SOAK_OPERATING_SYSTEMS,
  BACKGROUND_KEEPER_SOAK_RESULT_SCHEMA,
  BACKGROUND_KEEPER_SOAK_SMOKE_AGGREGATE_SCHEMA,
  BACKGROUND_KEEPER_SOAK_SMOKE_RESULT_SCHEMA,
  backgroundKeeperSoakDocumentSha256,
  createBackgroundKeeperSoakRoot,
  nearestRankPercentile,
  resolveBackgroundKeeperSoakProfile,
  sealBackgroundKeeperSoakDocument,
  shouldDeferHardKillCleanupIdentityProbe,
  summarizeKeeperSoakSamples,
  verifyBackgroundKeeperSoakEvidenceSet,
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
    readinessDeadlineMs: 60_000,
    maxHarnessRssGrowthMb: 192,
    maxHarnessResourceGrowth: 12,
  };
  const cycles = Array.from({ length: cycleCount }, (_, index) => ({
    cycle: index + 1,
    slot: index % agents,
    generation: Math.floor(index / agents) + 1,
    method: index % 2 === 0 ? "hard-kill" : "stop",
    readinessMs: 20,
    cleanupMs: 10,
    knownIdentityCount: 6,
    allKnownPidsRetired: true,
    recordRemoved: true,
    worktreeRetained: true,
    rssBytes: 1_024,
    resourceKind,
    resourceCount: 5,
  }));
  const slots = Array.from({ length: agents }, (_, index) => ({
    index,
    readinessMs: 20,
    reconnectVerified: true,
    finalCleanupMs: 10,
    allKnownPidsRetired: true,
    worktreeRemoved: true,
  }));
  const metrics = summarizeKeeperSoakSamples([
    ...cycles,
    ...slots.map((slot) => ({
      cleanupMs: slot.finalCleanupMs,
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
          readinessMs: 50,
          rssBytes: 100,
          resourceCount: 4,
        },
        {
          cleanupMs: 40,
          readinessMs: 70,
          rssBytes: 200,
          resourceCount: 6,
        },
      ]),
    ).toEqual({
      count: 2,
      cleanupP95Ms: 40,
      cleanupMaximumMs: 40,
      readinessP95Ms: 70,
      readinessMaximumMs: 70,
      rssMaximumBytes: 200,
      resourceMaximum: 6,
    });
  });
});

describe("background Agent keeper soak aggregate contract", () => {
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
