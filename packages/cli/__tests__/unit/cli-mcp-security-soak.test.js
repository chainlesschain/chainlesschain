import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveMcpSecuritySoakProfile,
  securitySoakCycleDelayMs,
  verifyMcpSecuritySoakEvidenceSet,
} from "../../scripts/cli-mcp-security-soak.mjs";

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const releaseCommit = "a".repeat(40);

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

function soakEvidence(operatingSystem, cycles = 2) {
  const codeSnapshotRaceSamples = operatingSystem === "linux" ? cycles : 0;
  const codeSnapshotFailClosedProbes = operatingSystem === "macos" ? cycles : 0;
  return {
    schema: "chainlesschain.cli-mcp-security-soak.v1",
    status: "passed",
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
      mode: "smoke",
      durationSeconds: 5,
      cycles,
      checkpointIntervalSeconds: 1,
    },
    continuousDurationSeconds: 5,
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

  it("verifies exactly three platforms and aggregates content-free counts", () => {
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
      });
      expect(aggregate).toMatchObject({
        result: "passed",
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
    } finally {
      rmSync(directory, { recursive: true, force: true });
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
  });
});
