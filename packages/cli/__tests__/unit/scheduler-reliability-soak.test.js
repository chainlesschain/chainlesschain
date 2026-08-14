import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  SCHEDULER_RELIABILITY_SOAK_AGGREGATE_SCHEMA,
  SCHEDULER_RELIABILITY_SOAK_SCHEMA,
  SCHEDULER_RELIABILITY_SOAK_SMOKE_AGGREGATE_SCHEMA,
  resolveSchedulerReliabilitySoakProfile,
  runSchedulerReliabilityCycle,
  runSchedulerReliabilityRunProbes,
  schedulerSoakCycleDelayMs,
  verifySchedulerReliabilitySoakEvidenceSet,
} from "../../scripts/scheduler-reliability-soak.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const releaseCommit = "a".repeat(40);

function cycleEvidence(index) {
  return {
    index,
    jobId: `scheduler-soak-${String(index).padStart(8, "0")}`,
    occurrenceId: `occ_${String(index + 1).padStart(64, "0")}`,
    deduplicatedEnqueues: 3,
    contentionRejected: true,
    staleLeaseRejected: true,
    leaseRenewed: true,
    retryPersisted: true,
    retryDueEnforced: true,
    pauseRequested: true,
    checkpointPersisted: true,
    pausedClaimRejected: true,
    resumed: true,
    deadLettered: true,
    deadLetterRequeued: true,
    restartPersistenceChecks: 3,
    finalStatus: "succeeded",
    finalAttempt: 2,
    finalFence: 2,
    occurrenceRowCount: 1,
    eventCount: 6,
    historyDigest: `sha256:${"b".repeat(64)}`,
    quickChecks: 3,
  };
}

function totals(cycles) {
  return {
    cycles,
    jobsCreated: cycles * 3,
    occurrencesCreated: cycles * 3,
    deduplicatedEnqueues: cycles * 3,
    claims: cycles * 6,
    contentionRejections: cycles,
    staleLeaseRejections: cycles,
    leaseRenewals: cycles,
    retriesScheduled: cycles,
    pauseRequests: cycles,
    checkpointsPersisted: cycles,
    pausedClaimRejections: cycles,
    resumes: cycles,
    deadLetters: cycles,
    deadLetterRequeues: cycles,
    restartPersistenceChecks: cycles * 3,
    successfulSettlements: cycles * 3,
    databaseQuickChecks: cycles * 3,
    storageFaultProbes: 1,
    incidentLifecycleProbes: 1,
    incidentObservations: 2,
    incidentResolutions: 2,
    duplicateExecutions: 0,
    invariantViolations: 0,
  };
}

function runProbeEvidence() {
  return {
    storageFault: {
      storageCode: "SQLITE_FULL",
      commitState: "not_committed",
      rollbackVerified: true,
      quickCheckVerified: true,
      reopenVerified: true,
      sanitizedErrorVerified: true,
    },
    automationIncident: {
      created: true,
      sameEvidenceDeduplicated: true,
      changedEvidenceObserved: true,
      observationCount: 2,
      persistenceVerified: true,
      resolvedCount: 2,
      resolutionCode: "EXECUTION_SUCCEEDED",
      resolutionPersisted: true,
      quickChecks: 2,
    },
  };
}

function soakEvidence(
  operatingSystem,
  { mode = "formal", cycles = 1_000, durationSeconds = 7_200 } = {},
) {
  return {
    schema: SCHEDULER_RELIABILITY_SOAK_SCHEMA,
    status: "passed",
    releaseCommit,
    headSha: releaseCommit,
    expectedSha: releaseCommit,
    exactShaVerified: true,
    qualifyingEvidence: mode === "formal",
    developmentOverride: false,
    source: {
      clean: true,
      changeCount: 0,
      finalClean: true,
      finalChangeCount: 0,
    },
    runner: { operatingSystem },
    profile: {
      mode,
      durationSeconds,
      cycles,
      checkpointIntervalSeconds: 1,
    },
    continuousDurationSeconds: durationSeconds,
    cycles: Array.from({ length: cycles }, (_, index) => cycleEvidence(index)),
    runProbes: runProbeEvidence(),
    totals: totals(cycles),
    violations: [],
  };
}

describe("scheduler reliability soak gate", () => {
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()();
  });

  function temporaryDirectory(prefix) {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
    return directory;
  }

  it("keeps the formal two-hour and one-thousand-cycle floors", () => {
    expect(
      resolveSchedulerReliabilitySoakProfile({
        CC_CLI_SCHEDULER_SOAK_MODE: "formal",
        CC_CLI_SCHEDULER_SOAK_DURATION_SECONDS: "1",
        CC_CLI_SCHEDULER_SOAK_CYCLES: "1",
        CC_CLI_SCHEDULER_SOAK_CHECKPOINT_INTERVAL_SECONDS: "500",
      }),
    ).toEqual({
      mode: "formal",
      durationSeconds: 7_200,
      cycles: 1_000,
      checkpointIntervalSeconds: 60,
    });
  });

  it("runs the first cycle immediately and places the final cycle at the duration floor", () => {
    expect(schedulerSoakCycleDelayMs(0, 1_000, 7_200_000, 0)).toBe(0);
    expect(schedulerSoakCycleDelayMs(999, 1_000, 7_200_000, 7_000_000)).toBe(
      200_000,
    );
    expect(schedulerSoakCycleDelayMs(0, 1, 7_200_000, 0)).toBe(0);
  });

  it("exercises real persistence, restart, lease, retry, and deduplication", () => {
    const directory = temporaryDirectory("cc-scheduler-soak-cycle-");
    const result = runSchedulerReliabilityCycle({
      databaseFile: join(directory, "scheduler.db"),
      index: 0,
      logicalNow: 1_786_500_000_000,
    });

    expect(result).toMatchObject({
      index: 0,
      jobId: "scheduler-soak-00000000",
      occurrenceId: expect.stringMatching(/^occ_[0-9a-f]{64}$/u),
      deduplicatedEnqueues: 3,
      contentionRejected: true,
      staleLeaseRejected: true,
      leaseRenewed: true,
      retryPersisted: true,
      retryDueEnforced: true,
      pauseRequested: true,
      checkpointPersisted: true,
      pausedClaimRejected: true,
      resumed: true,
      deadLettered: true,
      deadLetterRequeued: true,
      restartPersistenceChecks: 3,
      finalStatus: "succeeded",
      finalAttempt: 2,
      finalFence: 2,
      occurrenceRowCount: 1,
      eventCount: 6,
      historyDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      quickChecks: 3,
    });
  });

  it("probes native SQLITE_FULL rollback and a durable incident lifecycle", () => {
    const directory = temporaryDirectory("cc-scheduler-soak-run-probes-");
    const schedulerDatabaseFile = join(directory, "scheduler.db");
    runSchedulerReliabilityCycle({
      databaseFile: schedulerDatabaseFile,
      index: 0,
      logicalNow: 1_786_500_000_000,
    });

    const probes = runSchedulerReliabilityRunProbes({
      schedulerDatabaseFile,
      incidentDatabaseFile: join(directory, "automation-incidents.db"),
      anchorJobId: "scheduler-soak-00000000",
      logicalNow: 1_786_500_100_000,
    });
    expect(probes).toEqual(runProbeEvidence());
    expect(JSON.stringify(probes)).not.toContain(directory);
    expect(JSON.stringify(probes)).not.toContain("message");
  });

  it("verifies exactly three exact-SHA platform artifacts and aggregates counters", () => {
    const directory = temporaryDirectory("cc-scheduler-soak-evidence-");
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      writeFileSync(
        join(directory, `${operatingSystem}.json`),
        JSON.stringify(soakEvidence(operatingSystem)),
      );
    }

    const aggregate = verifySchedulerReliabilitySoakEvidenceSet({
      evidenceDir: directory,
      releaseCommit,
    });
    expect(aggregate).toMatchObject({
      schema: SCHEDULER_RELIABILITY_SOAK_AGGREGATE_SCHEMA,
      name: "scheduler-reliability-formal-aggregate",
      result: "passed",
      qualifyingEvidence: true,
      releaseGateEligible: true,
      releaseCommit,
      operatingSystems: ["linux", "macos", "windows"],
      totals: {
        cycles: 3_000,
        jobsCreated: 9_000,
        occurrencesCreated: 9_000,
        deduplicatedEnqueues: 9_000,
        claims: 18_000,
        pauseRequests: 3_000,
        checkpointsPersisted: 3_000,
        pausedClaimRejections: 3_000,
        resumes: 3_000,
        deadLetters: 3_000,
        deadLetterRequeues: 3_000,
        restartPersistenceChecks: 9_000,
        successfulSettlements: 9_000,
        databaseQuickChecks: 9_000,
        storageFaultProbes: 3,
        incidentLifecycleProbes: 3,
        incidentObservations: 6,
        incidentResolutions: 6,
        duplicateExecutions: 0,
        invariantViolations: 0,
      },
      invariants: {
        exactShaPlatformCount: 3,
        duplicateExecutions: 0,
        invariantViolations: 0,
        completePlatformMatrix: true,
      },
    });
    expect(aggregate.evidence).toHaveLength(3);
  });

  it("rejects smoke by default and isolates explicitly allowed smoke aggregates", () => {
    const directory = temporaryDirectory("cc-scheduler-soak-smoke-");
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      writeFileSync(
        join(directory, `${operatingSystem}.json`),
        JSON.stringify(
          soakEvidence(operatingSystem, {
            mode: "smoke",
            cycles: 2,
            durationSeconds: 1,
          }),
        ),
      );
    }
    expect(() =>
      verifySchedulerReliabilitySoakEvidenceSet({
        evidenceDir: directory,
        releaseCommit,
      }),
    ).toThrow(/formal evidence|profile floors/u);

    expect(
      verifySchedulerReliabilitySoakEvidenceSet({
        evidenceDir: directory,
        releaseCommit,
        allowSmoke: true,
      }),
    ).toMatchObject({
      schema: SCHEDULER_RELIABILITY_SOAK_SMOKE_AGGREGATE_SCHEMA,
      name: "scheduler-reliability-smoke-aggregate-non-qualifying",
      result: "non_qualifying_smoke_passed",
      qualifyingEvidence: false,
      releaseGateEligible: false,
      profile: { mode: "smoke", durationSeconds: 1, cycles: 2 },
    });

    for (const operatingSystem of ["linux", "macos", "windows"]) {
      writeFileSync(
        join(directory, `${operatingSystem}.json`),
        JSON.stringify(
          soakEvidence(operatingSystem, {
            mode: "formal",
            cycles: 2,
            durationSeconds: 1,
          }),
        ),
      );
    }
    expect(() =>
      verifySchedulerReliabilitySoakEvidenceSet({
        evidenceDir: directory,
        releaseCommit,
      }),
    ).toThrow(/profile floors/u);
  });

  it("rejects dirty, non-exact, incomplete, or invariant-breaking evidence", () => {
    const directory = temporaryDirectory("cc-scheduler-soak-invalid-");
    for (const operatingSystem of ["linux", "macos", "windows"]) {
      const evidence = soakEvidence(operatingSystem);
      if (operatingSystem === "windows") {
        evidence.exactShaVerified = false;
        evidence.qualifyingEvidence = false;
        evidence.source.clean = false;
        evidence.source.changeCount = 1;
        evidence.cycles[0].leaseRenewed = false;
        evidence.runProbes.storageFault.commitState = "unknown";
        evidence.runProbes.automationIncident.resolutionPersisted = false;
      }
      writeFileSync(
        join(directory, `${operatingSystem}.json`),
        JSON.stringify(evidence),
      );
    }
    expect(() =>
      verifySchedulerReliabilitySoakEvidenceSet({
        evidenceDir: directory,
        releaseCommit,
      }),
    ).toThrow(
      /exact SHA verification|clean source|lease renewal|storage fault commit state|incident resolution persistence/u,
    );

    rmSync(join(directory, "windows.json"));
    expect(() =>
      verifySchedulerReliabilitySoakEvidenceSet({
        evidenceDir: directory,
        releaseCommit,
      }),
    ).toThrow(/exactly linux, macos, windows/u);
  });

  it("declares package scripts and a parallel exact-SHA three-platform aggregate gate", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/cli-reliability-soak.yml"),
      "utf8",
    );
    const rootPackage = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    );
    const cliPackage = JSON.parse(
      readFileSync(
        resolve(repositoryRoot, "packages/cli/package.json"),
        "utf8",
      ),
    );

    expect(rootPackage.scripts["test:cli-scheduler-reliability-soak"]).toBe(
      "node packages/cli/scripts/scheduler-reliability-soak.mjs",
    );
    expect(cliPackage.scripts["test:scheduler-reliability-soak"]).toBe(
      "node scripts/scheduler-reliability-soak.mjs",
    );
    expect(workflow).toContain("scheduler-reliability-soak:");
    expect(workflow).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(workflow).toContain("CC_CLI_SCHEDULER_SOAK_EXPECTED_SHA");
    expect(workflow).toContain("CC_CLI_SCHEDULER_SOAK_CYCLES");
    expect(workflow).toContain("test:cli-scheduler-reliability-soak");
    expect(workflow).toContain("scheduler-reliability-soak-aggregate:");
    expect(workflow).toContain("actions/download-artifact@v7");
    expect(workflow).toContain("--verify-evidence-dir");
    expect(workflow).toContain("--allow-smoke");
    expect(workflow).toContain("smoke-non-qualifying");
    for (const workflowPath of [
      "packages/cli/src/lib/automation-center-incidents.js",
      "packages/cli/src/lib/automation-center-runtime.js",
      "packages/cli/src/lib/automation-center.js",
      "packages/cli/src/lib/automation-engine.js",
      "packages/cli/src/lib/automation-execution-authority.js",
      "packages/cli/src/lib/automation-execution-incident.js",
      "packages/cli/src/commands/automation.js",
      "packages/cli/__tests__/unit/automation-center-incidents.test.js",
      "packages/cli/__tests__/unit/automation-center-runtime.test.js",
      "packages/cli/__tests__/unit/automation-center.test.js",
      "packages/cli/__tests__/unit/automation-engine.test.js",
      "packages/cli/__tests__/unit/automation-execution-authority.test.js",
      "packages/cli/__tests__/unit/automation-execution-incident.test.js",
      "packages/cli/__tests__/unit/scheduler-kernel-*.test.js",
      "packages/cli/__tests__/unit/vscode-ext-automation-center.test.js",
      "packages/vscode-extension/src/automation-center.js",
      "packages/vscode-extension/src/ui/automation-center-view.js",
      "packages/vscode-extension/test/automation-center.test.cjs",
      "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/AutomationCenter.java",
      "packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/AutomationCenterToolWindowFactory.java",
      "packages/jetbrains-plugin/src/test/java/com/chainlesschain/ide/AutomationCenterTest.java",
    ]) {
      expect(workflow).toContain(`"${workflowPath}"`);
    }
    expect(workflow).toContain(
      '"packages/cli/__tests__/unit/scheduler-kernel-store.test.js"',
    );
  });
});
