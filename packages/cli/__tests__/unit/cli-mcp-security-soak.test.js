import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseMcpExecutionContextVitestEvidence,
  resolveMcpSecuritySoakProfile,
  securitySoakCycleDelayMs,
  verifyMcpSecuritySoakEvidenceSet,
} from "../../scripts/cli-mcp-security-soak.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const releaseCommit = "a".repeat(40);
const executionContextTestRelativePath =
  "packages/cli/__tests__/integration/mcp-materialized-capsule-sandbox-live.test.js";
const executionContextReportFiles = {
  linux: "mcp-materialized-capsule-live-Linux.json",
  macos: "mcp-materialized-capsule-live-macOS.json",
  windows: "mcp-materialized-capsule-live-Windows.json",
};
const executionContextAssertions = [
  {
    ancestor: "live materialized MCP capsule sandbox chain",
    title:
      "denies host effects through the real Client -> Broker -> OS path or fails closed on macOS",
    expectedStatus: () => "passed",
  },
  {
    ancestor: "live materialized MCP capsule sandbox chain",
    title:
      "rejects a materialized capsule byte replacement before Broker spawn",
    expectedStatus: () => "passed",
  },
  {
    ancestor: "materialized MCP capsule host observer helpers",
    title: "compiles the Windows WMI observer with PowerShell 5.1 assemblies",
    expectedStatus: (operatingSystem) =>
      operatingSystem === "windows" ? "passed" : "skipped",
  },
  {
    ancestor: "materialized MCP capsule host observer helpers",
    title:
      "binds a nonce-bearing short-lived child start to its PID and parent",
    expectedStatus: (operatingSystem) =>
      operatingSystem === "windows" ? "passed" : "skipped",
  },
  {
    ancestor: "live materialized MCP capsule sandbox chain gate",
    title: "requires CC_SANDBOX_LIVE=1 on a supported platform",
    expectedStatus: () => "skipped",
  },
];

function executionContextVitestReport(operatingSystem) {
  const assertionResults = executionContextAssertions.map((assertion) => ({
    ancestorTitles: [assertion.ancestor],
    fullName: `${assertion.ancestor} ${assertion.title}`,
    status: assertion.expectedStatus(operatingSystem),
    title: assertion.title,
    failureMessages: [],
  }));
  const passedTests = assertionResults.filter(
    (assertion) => assertion.status === "passed",
  ).length;
  const skippedTests = assertionResults.length - passedTests;
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: assertionResults.length,
    numPassedTests: passedTests,
    numFailedTests: 0,
    numPendingTests: skippedTests,
    numTodoTests: 0,
    success: true,
    testResults: [
      {
        name: executionContextTestRelativePath,
        status: "passed",
        assertionResults,
      },
    ],
  };
}

function writeExecutionContextReport(directory, operatingSystem, report) {
  const filePath = join(
    directory,
    executionContextReportFiles[operatingSystem],
  );
  writeFileSync(
    filePath,
    JSON.stringify(report || executionContextVitestReport(operatingSystem)),
  );
  return filePath;
}

function writeFormalEvidenceSet(evidenceDirectory, rawDirectory) {
  for (const operatingSystem of ["linux", "macos", "windows"]) {
    const rawReport = writeExecutionContextReport(
      rawDirectory,
      operatingSystem,
    );
    const executionContextBoundary = parseMcpExecutionContextVitestEvidence({
      filePath: rawReport,
      operatingSystem,
    });
    writeFileSync(
      join(evidenceDirectory, `${operatingSystem}.json`),
      JSON.stringify(
        soakEvidence(operatingSystem, 100, {
          mode: "formal",
          executionContextBoundary,
        }),
      ),
    );
  }
}

function innerEvidence(operatingSystem) {
  const race =
    operatingSystem === "linux"
      ? {
          required: true,
          pass: true,
          backend: "linux-fd-code-snapshot",
          mechanism: "verified-o_tmpfile-copy-inherited-fd-module-compile-v1",
          handleAtomic: true,
          entrySnapshotAtomic: true,
          runtimeLaunchAtomic: true,
          sharedLibraryClosure: false,
          requiredRuns: 1,
          sampleCount: 1,
          passCount: 1,
          sourceReplacementObserved: true,
          originalSnapshotExecuted: true,
          maliciousPathExecuted: false,
          exitCode: 0,
          stdoutBytes: 16,
          stderrBytes: 0,
          samples: [
            {
              id: "code-snapshot-race-0",
              iteration: 0,
              pass: true,
              sourceReplacementObserved: true,
              originalSnapshotExecuted: true,
              maliciousPathExecuted: false,
              exitCode: 0,
              stdoutBytes: 16,
              stderrBytes: 0,
            },
          ],
        }
      : operatingSystem === "macos"
        ? {
            required: false,
            pass: true,
            reason: "macos-atomic-runtime-exec-unavailable-fail-closed",
            failClosed: true,
            candidateBackend: "macos-fd-code-snapshot",
            adapterReason: "macos_atomic_runtime_exec_unavailable",
            runtimeProbeReason: "public_api_has_no_descriptor_bound_exec",
            entrySnapshotAtomic: false,
            runtimeLaunchAtomic: false,
            requiredRuns: 0,
            sampleCount: 0,
            passCount: 0,
            samples: [],
          }
        : {
            required: false,
            pass: true,
            reason:
              "windows-code-snapshot-covered-by-separate-strict-gate-not-evaluated",
            requiredRuns: 0,
            sampleCount: 0,
            passCount: 0,
            samples: [],
          };
  return {
    schema: "chainlesschain.ide-roadmap-mcp-security-evidence.v4",
    releaseCommit,
    result: "passed",
    runner: { operatingSystem },
    matrix: {
      requiredRunsPerTool: 1,
      sampleCount: 3,
      passCount: 3,
      unapprovedTransportCallCount: 0,
      unapprovedMutationCount: 0,
      unapprovedLedgerRecordCount: 0,
      samples: Array.from({ length: 3 }, () => ({
        pass: true,
        mutationCount: 0,
        ledgerRecordCount: 0,
      })),
    },
    approvedProbe: {
      pass: true,
      transportCallCount: 1,
    },
    staleHostReadPolicyProbe: {
      pass: true,
      sampleCount: 2,
      transportCallCount: 0,
      mutationCount: 0,
      ledgerRecordCount: 0,
    },
    codeSnapshotRaceProbe: race,
    invariants: {
      annotationsAreHintsOnly: true,
      defaultConfirmationRequired: true,
      hostAuthorizationRequiredForTrustedRead: true,
      unapprovedEffectsBeforeTransport: 0,
      unapprovedMutations: 0,
      unapprovedLedgerWrites: 0,
      claimedReadRemainsUnknownWithoutHostAuthorization: true,
      staleHostReadCannotDowngradeRisk: true,
    },
  };
}

function soakEvidence(
  operatingSystem,
  cycles = 2,
  { mode = "smoke", executionContextBoundary } = {},
) {
  const codeSnapshotRaceSamples = operatingSystem === "linux" ? cycles : 0;
  const codeSnapshotFailClosedProbes = operatingSystem === "macos" ? cycles : 0;
  const formal = mode === "formal";
  return {
    schema: formal
      ? "chainlesschain.cli-mcp-security-soak-formal.v2"
      : "chainlesschain.cli-mcp-security-soak-smoke-non-qualifying.v1",
    status: "passed",
    qualifyingEvidence: formal,
    releaseGateEligible: formal,
    releaseCommit,
    headSha: releaseCommit,
    expectedSha: releaseCommit,
    exactShaVerified: true,
    source: {
      clean: true,
      changeCount: 0,
      finalClean: true,
      finalChangeCount: 0,
    },
    runner: { operatingSystem },
    profile: {
      mode,
      durationSeconds: formal ? 7_200 : 5,
      cycles,
      checkpointIntervalSeconds: formal ? 60 : 1,
    },
    continuousDurationSeconds: formal ? 7_200 : 5,
    cycles: Array.from({ length: cycles }, (_, index) => ({
      index,
      evidence: innerEvidence(operatingSystem),
    })),
    totals: {
      hostCycles: cycles,
      unapprovedEffectSamples: cycles * 3,
      unapprovedTransportCalls: 0,
      unapprovedMutations: 0,
      unapprovedLedgerWrites: 0,
      approvedMutationProbes: cycles,
      staleHostReadPolicySamples: cycles * 2,
      codeSnapshotRaceSamples,
      codeSnapshotFailClosedProbes,
      atomicPathReplacementEscapes: 0,
    },
    executionContextBoundary: executionContextBoundary || {
      schema: "chainlesschain.cli-mcp-execution-context-live-sample.v1",
      result: "not_run_non_qualifying_smoke",
      scope: "pr-smoke-without-live-execution-context-sample",
      sampleCount: 0,
      longRunning: false,
      qualifyingForSingleLiveSample: false,
      qualifyingForLongRunningMatrix: false,
    },
    violations: [],
  };
}

describe("CLI malicious MCP security soak", () => {
  it("keeps the formal two-hour and one-hundred-cycle floors", () => {
    expect(
      resolveMcpSecuritySoakProfile({
        CC_CLI_MCP_SECURITY_SOAK_MODE: "formal",
        CC_CLI_MCP_SECURITY_SOAK_DURATION_SECONDS: "1",
        CC_CLI_MCP_SECURITY_SOAK_CYCLES: "1",
        CC_CLI_MCP_SECURITY_SOAK_CHECKPOINT_INTERVAL_SECONDS: "500",
      }),
    ).toEqual({
      mode: "formal",
      durationSeconds: 7_200,
      cycles: 100,
      checkpointIntervalSeconds: 60,
    });
  });

  it("runs the first cycle immediately and the last at the duration floor", () => {
    expect(securitySoakCycleDelayMs(0, 100, 7_200_000, 0)).toBe(0);
    expect(securitySoakCycleDelayMs(99, 100, 7_200_000, 7_000_000)).toBe(
      200_000,
    );
    expect(securitySoakCycleDelayMs(1, 1, 7_200_000, 0)).toBe(0);
  });

  it("keeps PR smoke explicitly non-qualifying and opt-in", () => {
    const directory = mkdtempSync(join(tmpdir(), "cc-mcp-security-soak-test-"));
    try {
      for (const operatingSystem of ["linux", "macos", "windows"]) {
        writeFileSync(
          join(directory, `${operatingSystem}.json`),
          JSON.stringify(soakEvidence(operatingSystem)),
        );
      }
      const aggregate = verifyMcpSecuritySoakEvidenceSet({
        evidenceDir: directory,
        releaseCommit,
        allowSmoke: true,
      });
      expect(aggregate).toMatchObject({
        schema:
          "chainlesschain.cli-mcp-security-soak-smoke-aggregate-non-qualifying.v1",
        result: "non_qualifying_smoke_passed",
        qualifyingEvidence: false,
        releaseGateEligible: false,
        executionContextBoundary: {
          sampleCount: 0,
          longRunning: false,
          qualifyingForSingleLiveSample: false,
          qualifyingForLongRunningMatrix: false,
        },
        hostCycles: 6,
        unapprovedEffectSamples: 18,
        unapprovedTransportCalls: 0,
        unapprovedMutations: 0,
        unapprovedLedgerWrites: 0,
        approvedMutationProbes: 6,
        staleHostReadPolicySamples: 12,
        codeSnapshotRaceOperatingSystems: ["linux"],
        codeSnapshotRaceSamples: 2,
        codeSnapshotFailClosedOperatingSystems: ["macos"],
        codeSnapshotFailClosedProbes: 2,
        atomicPathReplacementEscapes: 0,
      });
      expect(aggregate.evidence).toHaveLength(3);
      expect(() =>
        verifyMcpSecuritySoakEvidenceSet({
          evidenceDir: directory,
          releaseCommit,
        }),
      ).toThrow("requires formal evidence");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("strictly parses and hashes a platform-bound single live sample", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "cc-mcp-execution-context-test-"),
    );
    try {
      const filePath = writeExecutionContextReport(directory, "windows");
      expect(
        parseMcpExecutionContextVitestEvidence({
          filePath,
          operatingSystem: "windows",
        }),
      ).toMatchObject({
        result: "passed",
        scope: "single-live-sample-before-time-based-host-race-soak",
        sampleCount: 1,
        longRunning: false,
        qualifyingForSingleLiveSample: true,
        qualifyingForLongRunningMatrix: false,
        rawReportFile: executionContextReportFiles.windows,
        rawReportSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        reporter: {
          totalTestSuites: 1,
          passedTestSuites: 1,
          totalTests: 5,
          passedTests: 4,
          skippedTests: 1,
          failedTests: 0,
        },
        requiredAssertions: expect.arrayContaining([
          expect.objectContaining({
            id: "windows-live-observer-calibration",
            status: "passed",
          }),
          expect.objectContaining({
            id: "live-mode-negative-gate",
            status: "skipped",
          }),
        ]),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a live report whose platform sentinel did not pass", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "cc-mcp-execution-context-test-"),
    );
    try {
      const report = executionContextVitestReport("windows");
      const sentinel = report.testResults[0].assertionResults.find(
        (assertion) =>
          assertion.title ===
          "binds a nonce-bearing short-lived child start to its PID and parent",
      );
      sentinel.status = "skipped";
      report.numPassedTests -= 1;
      report.numPendingTests += 1;
      const filePath = writeExecutionContextReport(
        directory,
        "windows",
        report,
      );
      expect(() =>
        parseMcpExecutionContextVitestEvidence({
          filePath,
          operatingSystem: "windows",
        }),
      ).toThrow("windows-live-observer-calibration status skipped");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("binds a formal aggregate to the three raw live reports", () => {
    const evidenceDirectory = mkdtempSync(
      join(tmpdir(), "cc-mcp-security-soak-test-"),
    );
    const rawDirectory = mkdtempSync(
      join(tmpdir(), "cc-mcp-execution-context-test-"),
    );
    try {
      writeFormalEvidenceSet(evidenceDirectory, rawDirectory);
      const aggregate = verifyMcpSecuritySoakEvidenceSet({
        evidenceDir: evidenceDirectory,
        executionContextEvidenceDir: rawDirectory,
        releaseCommit,
      });
      expect(aggregate).toMatchObject({
        schema: "chainlesschain.cli-mcp-security-soak-formal-aggregate.v2",
        result: "passed",
        qualifyingEvidence: true,
        releaseGateEligible: true,
        hostCycles: 300,
        executionContextBoundary: {
          scope:
            "single-live-sample-per-platform-before-time-based-host-race-soak",
          sampleCount: 3,
          samplesPerOperatingSystem: 1,
          longRunning: false,
          qualifyingForSingleLiveSample: true,
          qualifyingForLongRunningMatrix: false,
          operatingSystems: ["linux", "macos", "windows"],
          evidence: [
            expect.objectContaining({ operatingSystem: "linux" }),
            expect.objectContaining({ operatingSystem: "macos" }),
            expect.objectContaining({ operatingSystem: "windows" }),
          ],
        },
      });

      writeFileSync(
        join(rawDirectory, executionContextReportFiles.linux),
        `${JSON.stringify(executionContextVitestReport("linux"))}\n`,
      );
      expect(() =>
        verifyMcpSecuritySoakEvidenceSet({
          evidenceDir: evidenceDirectory,
          executionContextEvidenceDir: rawDirectory,
          releaseCommit,
        }),
      ).toThrow(
        "linux execution-context raw report does not match its platform soak evidence",
      );
    } finally {
      rmSync(evidenceDirectory, { recursive: true, force: true });
      rmSync(rawDirectory, { recursive: true, force: true });
    }
  });

  it("rejects macOS evidence that claims a non-atomic snapshot succeeded", () => {
    const directory = mkdtempSync(join(tmpdir(), "cc-mcp-security-soak-test-"));
    try {
      for (const operatingSystem of ["linux", "macos", "windows"]) {
        const evidence = soakEvidence(operatingSystem);
        if (operatingSystem === "macos") {
          evidence.cycles[0].evidence.codeSnapshotRaceProbe.failClosed = false;
        }
        writeFileSync(
          join(directory, `${operatingSystem}.json`),
          JSON.stringify(evidence),
        );
      }
      expect(() =>
        verifyMcpSecuritySoakEvidenceSet({
          evidenceDir: directory,
          releaseCommit,
          allowSmoke: true,
        }),
      ).toThrow("macOS fail-closed snapshot probe");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("declares a scheduled/manual exact-SHA three-platform aggregate gate", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/cli-reliability-soak.yml"),
      "utf8",
    );
    const jobsStart = workflow.indexOf("\njobs:");
    expect(jobsStart).toBeGreaterThan(0);
    const triggers = workflow.slice(0, jobsStart);
    const mcpJobStart = workflow.indexOf("\n  mcp-security-soak:", jobsStart);
    const aggregateJobStart = workflow.indexOf(
      "\n  mcp-security-soak-aggregate:",
      mcpJobStart,
    );
    expect(mcpJobStart).toBeGreaterThan(jobsStart);
    expect(aggregateJobStart).toBeGreaterThan(mcpJobStart);
    const mcpJob = workflow.slice(mcpJobStart, aggregateJobStart);
    const aggregateJob = workflow.slice(aggregateJobStart);
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(mcpJob).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(mcpJob).toContain("CC_CLI_MCP_SECURITY_SOAK_EXPECTED_SHA");
    expect(mcpJob).toContain("CC_CLI_MCP_SECURITY_SOAK_CYCLES");
    expect(mcpJob).toContain("npm run test:cli-mcp-security-soak");
    expect(mcpJob).toContain(
      "Run exact-SHA materialized capsule execution-context boundary",
    );
    expect(mcpJob).toContain("if: github.event_name != 'pull_request'");
    expect(mcpJob).toContain('CC_SANDBOX_LIVE: "1"');
    expect(mcpJob).toContain(
      "CC_CLI_MCP_SECURITY_SOAK_EXECUTION_CONTEXT_RESULT: ${{ runner.temp }}/mcp-materialized-capsule-live-${{ runner.os }}.json",
    );
    expect(mcpJob).toContain(
      "__tests__/integration/mcp-materialized-capsule-sandbox-live.test.js",
    );
    expect(mcpJob).toContain(
      "cli-mcp-execution-context-live-${{ matrix.os }}-${{ env.CC_CLI_MCP_SECURITY_SOAK_EXPECTED_SHA }}-${{ github.run_attempt }}",
    );
    for (const source of [
      "packages/cli/__tests__/integration/mcp-materialized-capsule-sandbox-live.test.js",
      "packages/cli/__tests__/fixtures/mcp-materialized-capsule-live-server.cjs",
      "packages/cli/__tests__/fixtures/mcp-materialized-capsule-child-contract.cjs",
    ]) {
      expect(triggers).toContain(`- "${source}"`);
    }
    expect(workflow).toContain("mcp-security-soak-aggregate");
    expect(workflow).toContain("actions/download-artifact@v7");
    expect(workflow).toContain("actions/upload-artifact@v6");
    expect(aggregateJob).toContain(
      "pattern: cli-mcp-execution-context-live-*-${{ env.CC_CLI_MCP_SECURITY_SOAK_EXPECTED_SHA }}-${{ github.run_attempt }}",
    );
    expect(aggregateJob).toContain(
      '--execution-context-evidence-dir "${RUNNER_TEMP}/cli-mcp-execution-context-live-evidence"',
    );
    expect(aggregateJob).toContain("--allow-smoke");
    expect(aggregateJob).toContain(
      "'smoke-non-qualifying' || 'formal-aggregate'",
    );
  });
});
