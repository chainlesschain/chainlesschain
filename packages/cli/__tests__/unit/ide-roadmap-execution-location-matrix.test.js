import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_FILES,
  sumTrajectoryCounters,
} from "../../scripts/ide-roadmap-execution-location-matrix.mjs";
import {
  AUDIT_FRAGMENT_SCHEMA,
  PRODUCER_PATHS,
  PROFILE_VERSION,
  REQUIRED_OPERATING_SYSTEMS,
  REQUIRED_REMOTE_TRANSPORTS,
  REQUIRED_TRANSPORTS,
  TEST_IDS,
  THRESHOLDS,
  assertCanonicalAuditFragment,
  buildCanonicalAuditFragments,
  verifyCell,
} from "../../scripts/verify-ide-roadmap-execution-location.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const roots = [];

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function trajectory(reconnect = false) {
  return {
    schema: "chainlesschain.execution-location-trajectory.v1",
    sessionIdDigest: DIGEST,
    sourceHeadDigest: DIGEST,
    sourceEventCount: 3,
    attestationDigest: DIGEST,
    targetHandoffAttestationDigest: `sha256:${"c".repeat(64)}`,
    targetFactsDigest: DIGEST,
    handoffId: DIGEST,
    resumeDigest: DIGEST,
    reconnectResumeDigest: reconnect ? DIGEST : null,
    collectionDigest: DIGEST,
    settlementDigest: DIGEST,
    reviewDigest: DIGEST,
    importDigest: DIGEST,
    leaseReceiptDigest: DIGEST,
    targetPreflightReceiptDigest: DIGEST,
    lifecycleAttestationDigest: DIGEST,
    postSessionHookReceiptDigest: DIGEST,
    leaseGeneration: 1,
    finalRunnerGeneration: 5,
    finalRunnerState: "accepting",
    sigtermDrainCount: 1,
    postSessionHookCount: 1,
    reclaimCount: 1,
    launchCount: 1,
    resumeCount: reconnect ? 2 : 1,
    reconnectCount: reconnect ? 1 : 0,
    resultCollectCount: 1,
    resultReviewCount: 1,
    resultImportCount: 1,
    secretTransferCount: 0,
    silentFallbackCount: 0,
    duplicateHandoffCount: 0,
    duplicateResultSettlementCount: 0,
  };
}

function writeJson(directory, file, value) {
  fs.writeFileSync(
    path.join(directory, file),
    `${JSON.stringify(value)}\n`,
    "utf8",
  );
}

function makeCell(
  transport = "ssh",
  operatingSystem = transport === "wsl" ? "windows" : "linux",
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-location-evidence-"),
  );
  roots.push(directory);
  const provenance = {
    repository: "owner/repo",
    workflowRef: "owner/repo/.github/workflows/location.yml@refs/heads/main",
    workflowSha: COMMIT,
    runId: "42",
    runAttempt: "1",
    eventName: "workflow_dispatch",
    job:
      transport === "local"
        ? "local-execution-location"
        : `${transport}-execution-location`,
    artifactName:
      transport === "local"
        ? `ide-execution-location-local-${operatingSystem}-1`
        : `ide-execution-location-${transport}-1`,
  };
  const reconnect = trajectory(true);
  const campaign = Array.from({ length: 99 }, () => trajectory(false));
  const windowsLocalSigtermUnsupported =
    transport === "local" && operatingSystem === "windows";
  writeJson(directory, "bootstrap.json", {
    schema: "chainlesschain.execution-location-bootstrap.v1",
    releaseCommit: COMMIT,
    transport,
    nodeVersion: "v22.12.0",
    platform: { linux: "linux", macos: "darwin", windows: "win32" }[
      operatingSystem
    ],
    architecture: "x64",
    provenance,
  });
  writeJson(directory, "reconnect-prepared.json", {
    schema: "chainlesschain.execution-location-reconnect-prepared.v1",
    transport,
    prepared: true,
    sessionIdDigest: DIGEST,
    targetFactsDigest: DIGEST,
    handoffId: DIGEST,
    resumeDigest: DIGEST,
  });
  writeJson(directory, "network-fault.json", {
    schema: "chainlesschain.execution-location-network-fault.v1",
    injectedOutageCount: 1,
    unavailableProbeFailureCount: 1,
    unavailableProbeSuccessCount: 0,
    credentialLeakCount: 0,
    diagnostic: { messageDigest: DIGEST },
  });
  writeJson(directory, "lifecycle-faults.json", {
    schema: "chainlesschain.execution-location-lifecycle-faults.v1",
    releaseCommit: COMMIT,
    transport,
    sigterm: {
      sigtermCapability: windowsLocalSigtermUnsupported
        ? "unsupported-terminate-process"
        : "graceful-sigterm",
      targetReceiptDigest: windowsLocalSigtermUnsupported ? null : DIGEST,
      preflightReceiptDigest: DIGEST,
      signalDeliveryCount: windowsLocalSigtermUnsupported ? 0 : 1,
      sourceSignalRequested: "SIGTERM",
      sourceDrainingState: "draining",
      sourceAcceptingAfterDrain: false,
      postDrainLeaseAcceptanceCount: 0,
      sourceParkedState: "parked",
      hookReceiptDigest: DIGEST,
      reclaimedState: "accepting",
      targetProcessExitObserved: true,
      orphanProcessCount: 0,
    },
    lostPoll: {
      stalePollAcceptanceCount: 0,
      parkedState: "parked",
      parkedLeaseCount: 1,
    },
    tokenRotation: {
      staleTokenAcceptanceCount: 0,
      staleTargetLaunchAcceptanceCount: 0,
      refreshedPollRevision: 2,
      refreshedTargetPreflightReceiptDigest: DIGEST,
      reclaimedState: "accepting",
    },
    checkoutFailure: {
      parkedState: "parked",
      parkReason: "checkout-failure",
      reclaimedState: "accepting",
    },
    resources: ["cpu", "memory"].map((kind) => ({
      kind,
      targetReceiptDigest: DIGEST,
      preflightReceiptDigest: DIGEST,
      enforcementScope: "target-workload",
      termination: { kind: "exit-status", value: 137 },
      parkedState: "parked",
      parkReason: "resource-limit",
      reclaimedState: "accepting",
    })),
    staleAuthorityAcceptanceCount: 0,
    secretTransferCount: 0,
  });
  writeJson(directory, "reconnect-completed.json", {
    schema: "chainlesschain.execution-location-reconnect-completed.v1",
    trajectory: reconnect,
  });
  writeJson(directory, "campaign.json", {
    schema: "chainlesschain.execution-location-campaign.v1",
    iterations: 99,
    trajectories: campaign,
  });
  writeJson(directory, "outcome-observations.json", {
    schema: "chainlesschain.execution-location-outcome.v1",
    success: true,
    exactCommitBound: true,
    trajectoryCount: 100,
    ...sumTrajectoryCounters([reconnect, ...campaign]),
    injectedOutageCount: 1,
    unavailableProbeFailureCount: 1,
    sigtermCapability: windowsLocalSigtermUnsupported
      ? "unsupported-terminate-process"
      : "graceful-sigterm",
    sigtermSignalDeliveryCount: windowsLocalSigtermUnsupported ? 0 : 1,
    sourceFencedDrainCount: 1,
    unexpectedUnsupportedSigtermCount: 0,
    lostPollParkCount: 1,
    tokenRotationCount: 1,
    checkoutFailureParkCount: 1,
    targetResourceTerminationCount: 2,
    targetResourceParkCount: 2,
    staleAuthorityAcceptanceCount: 0,
    orphanProcessCount: 0,
  });
  writeJson(directory, "exact-commit.json", {
    schema: "chainlesschain.execution-location-exact-commit.v1",
    releaseCommit: COMMIT,
    exactCommitBound: true,
  });
  writeJson(directory, "provenance.json", {
    schema: "chainlesschain.execution-location-provenance.v1",
    releaseCommit: COMMIT,
    transport,
    ...provenance,
  });
  const files = Object.fromEntries(
    EVIDENCE_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(directory, file));
      return [file, { sha256: digest(bytes), bytes: bytes.length }];
    }),
  );
  writeJson(directory, "manifest.json", {
    schema: "chainlesschain.execution-location-manifest.v1",
    releaseCommit: COMMIT,
    transport,
    files,
  });
  return { directory, provenance };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("IDE roadmap execution-location matrix", () => {
  it("requires Local on three OS plus genuine WSL, Container, and strict SSH", () => {
    expect(REQUIRED_TRANSPORTS).toEqual(["local", "wsl", "container", "ssh"]);
    expect(REQUIRED_REMOTE_TRANSPORTS).toEqual(["wsl", "container", "ssh"]);
    expect(REQUIRED_OPERATING_SYSTEMS).toEqual(["linux", "macos", "windows"]);
    expect(AUDIT_FRAGMENT_SCHEMA).toBe(
      "chainlesschain.claude-code-increment-audit-fragment.v1",
    );
    const workflow = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/workflows/ide-roadmap-execution-location.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain("WSL production location trajectory x100");
    expect(workflow).toContain("Local production location trajectory x100");
    expect(workflow).toContain("Container production location trajectory x100");
    expect(workflow).toContain(
      "Strict SSH production location trajectory x100",
    );
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain('test "$WSL_RESULT" = success');
    expect(workflow).toContain('test "$LOCAL_RESULT" = success');
    expect(workflow).toContain("require all 600 trajectories");
    expect(workflow).toContain("claude-code-increment-audit-location-drain");
    expect(
      workflow.match(/runner\.temp \}\}\/location-drain-audit-fragments\//gu),
    ).toHaveLength(2);
    expect(
      workflow.match(
        /npm install --omit=optional --ignore-scripts --no-package-lock --no-save --prefix packages\/cli/gu,
      ),
    ).toHaveLength(4);
    const linuxRunner = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/scripts/run-ide-roadmap-execution-location-linux.sh",
      ),
      "utf8",
    );
    const wslRunner = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/scripts/run-ide-roadmap-execution-location-wsl.ps1",
      ),
      "utf8",
    );
    expect(linuxRunner).toContain("run_matrix campaign --iterations 99");
    expect(linuxRunner).toContain("run_matrix lifecycle-faults");
    expect(linuxRunner).toContain("--cpus 2 --memory 4g");
    expect(linuxRunner).toContain(
      "export PATH=/opt/node-22.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    expect(
      linuxRunner.match(
        /npm install --omit=optional --ignore-scripts --no-package-lock --no-save/gu,
      ),
    ).toHaveLength(1);
    expect(linuxRunner).toContain(
      '"$run_root/target-node/bin/npm" install --omit=optional --ignore-scripts --no-package-lock --no-save',
    );
    expect(linuxRunner).toContain(
      'export PATH="$run_root/target-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"',
    );
    expect(linuxRunner).toContain("UsePAM yes");
    expect(linuxRunner).not.toContain("UsePAM no");
    expect(wslRunner).toContain(
      'Invoke-Matrix "campaign" @("--iterations", "99")',
    );
    expect(wslRunner).toContain('Invoke-Matrix "lifecycle-faults"');
    expect(wslRunner).toContain(
      "export PATH=/opt/node-22.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    const localRunner = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/scripts/run-ide-roadmap-execution-location-local.mjs",
      ),
      "utf8",
    );
    expect(localRunner).toContain('"--transport",\n    "local"');
    expect(localRunner).toContain('runMatrix(commonArguments, "campaign"');
    expect(localRunner).toContain("fs.renameSync(targetCli, offlineCli)");
    const sessionStore = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../src/harness/jsonl-session-store.js",
      ),
      "utf8",
    );
    expect(sessionStore).toContain(
      '!["local", "wsl", "ssh", "container"].includes(collection.target)',
    );
  });

  it("rehashes a 100-trajectory cell and accepts one fail-closed reconnect", () => {
    const { directory, provenance } = makeCell("ssh");
    expect(
      verifyCell(directory, {
        transport: "ssh",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toMatchObject({ transport: "ssh", trajectoryCount: 100 });
  });

  it("rejects a modified producer file instead of trusting its manifest", () => {
    const { directory, provenance } = makeCell("container");
    fs.appendFileSync(path.join(directory, "campaign.json"), " ", "utf8");
    expect(() =>
      verifyCell(directory, {
        transport: "container",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toThrow(/digest drift/u);
  });

  it("rehashes a genuine Local cell with OS-bound provenance", () => {
    const { directory, provenance } = makeCell("local", "windows");
    expect(
      verifyCell(directory, {
        transport: "local",
        os: "windows",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toMatchObject({
      transport: "local",
      os: "windows",
      trajectoryCount: 100,
      runtime: { name: "node", version: "v22.12.0", arch: "x64" },
    });
  });

  it("keeps LOCATION-DRAIN evidence on the unified 13-key fragment schema", () => {
    const fragment = {
      schema: AUDIT_FRAGMENT_SCHEMA,
      commitmentId: "LOCATION-DRAIN",
      headSha: COMMIT,
      os: "linux",
      runtime: { name: "node", version: "v22.12.0", arch: "x64" },
      profileVersion: PROFILE_VERSION,
      thresholds: THRESHOLDS,
      measurements: { totalTrajectoryCount: 600 },
      testIds: TEST_IDS,
      producerDigests: Object.fromEntries(
        PRODUCER_PATHS.map((producerPath) => [producerPath, DIGEST]),
      ),
      disposition: "required",
      source: {
        workflowId:
          "owner/repo/.github/workflows/ide-roadmap-execution-location.yml@refs/heads/main",
        runId: "42",
        jobId: "trusted-execution-location-aggregate",
        artifactName: "claude-code-increment-audit-location-drain-1",
      },
      outcome: "passed",
    };
    expect(assertCanonicalAuditFragment(fragment)).toBe(fragment);
    expect(Object.keys(fragment)).toHaveLength(13);
    expect(() =>
      assertCanonicalAuditFragment({ ...fragment, unexpected: true }),
    ).toThrow(/keys drifted/u);
  });

  it("emits one same-profile required fragment per OS from all six target cells", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const runtime = { name: "node", version: "v22.12.0", arch: "x64" };
    const commonCounters = {
      sigtermDrainCount: 100,
      sourceFencedDrainCount: 1,
      unexpectedUnsupportedSigtermCount: 0,
      lostPollParkCount: 1,
      tokenRotationCount: 1,
      checkoutFailureParkCount: 1,
      resultCollectCount: 100,
      targetResourceTerminationCount: 0,
      targetResourceParkCount: 0,
      staleAuthorityAcceptanceCount: 0,
      secretTransferCount: 0,
      orphanProcessCount: 0,
    };
    const cells = [
      ...REQUIRED_OPERATING_SYSTEMS.map((operatingSystem) => ({
        transport: "local",
        os: operatingSystem,
        runtime,
        trajectoryCount: 100,
        counters: {
          ...commonCounters,
          sigtermCapability:
            operatingSystem === "windows"
              ? "unsupported-terminate-process"
              : "graceful-sigterm",
          sigtermSignalDeliveryCount: operatingSystem === "windows" ? 0 : 1,
        },
      })),
      ...REQUIRED_REMOTE_TRANSPORTS.map((transport) => ({
        transport,
        os: transport === "wsl" ? "windows" : "linux",
        runtime,
        trajectoryCount: 100,
        counters: {
          ...commonCounters,
          sigtermCapability: "graceful-sigterm",
          sigtermSignalDeliveryCount: 1,
          targetResourceTerminationCount: 2,
          targetResourceParkCount: 2,
        },
      })),
    ];
    const fragments = buildCanonicalAuditFragments({
      cells,
      releaseCommit: COMMIT,
      repositoryRoot: "unused-in-test",
      provenance: {
        workflowRef:
          "owner/repo/.github/workflows/ide-roadmap-execution-location.yml@refs/heads/main",
        runId: "42",
        job: "trusted-execution-location-aggregate",
      },
      artifactName: "claude-code-increment-audit-location-drain-1",
      resolveProducerDigests: () =>
        Object.fromEntries(
          PRODUCER_PATHS.map((producerPath) => [producerPath, DIGEST]),
        ),
    });
    expect(fragments.map((fragment) => fragment.os)).toEqual([
      "linux",
      "macos",
      "windows",
    ]);
    expect(
      new Set(fragments.map((fragment) => JSON.stringify(fragment.thresholds)))
        .size,
    ).toBe(1);
    expect(
      new Set(fragments.map((fragment) => JSON.stringify(fragment.testIds)))
        .size,
    ).toBe(1);
    for (const fragment of fragments) {
      expect(fragment).toMatchObject({
        commitmentId: "LOCATION-DRAIN",
        disposition: "required",
        outcome: "passed",
        profileVersion: PROFILE_VERSION,
        thresholds: THRESHOLDS,
        testIds: TEST_IDS,
        measurements: {
          requiredCellCount: 6,
          totalTrajectoryCount: 600,
          remoteTargetResourceTerminationCount: 6,
          remoteTargetResourceParkCount: 6,
          gracefulSigtermCellCount: 5,
          unsupportedSigtermCells: ["local-windows"],
          sourceFencedDrainCellCount: 6,
          unexpectedUnsupportedSigtermCount: 0,
        },
      });
      expect(Object.keys(fragment)).toHaveLength(13);
    }
    expect(PRODUCER_PATHS).toContain(
      "packages/cli/src/lib/execution-location-target.js",
    );
    expect(PRODUCER_PATHS).toEqual([...PRODUCER_PATHS].sort());
  });

  it("keeps target resume on the production CLI with a bounded exit input", () => {
    const wrapper = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/scripts/ide-roadmap-execution-location-target.sh",
      ),
      "utf8",
    );
    expect(wrapper).toContain('"${1:-}" == "session"');
    expect(wrapper).toContain("printf '/exit\\n'");
    expect(wrapper).toContain(
      '"$CC_IDE_TARGET_NODE" "$CC_IDE_TARGET_ENTRY" "$@"',
    );
    expect(wrapper).toContain("execution-location-local-supervisor.mjs");
    expect(wrapper).toContain('ulimit -t "$CC_EXECUTION_LOCATION_CPU_SECONDS"');
    expect(wrapper).not.toContain("ulimit -v");
    const supervisor = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../src/lib/execution-location-local-supervisor.mjs",
      ),
      "utf8",
    );
    expect(supervisor).toContain(
      'const CPU_LIMIT_SIGNALS = new Set(["SIGKILL", "SIGXCPU"]);',
    );
    expect(supervisor).toContain(
      "cpuLimitReached || CPU_LIMIT_SIGNALS.has(result.signal)",
    );
  });
});
