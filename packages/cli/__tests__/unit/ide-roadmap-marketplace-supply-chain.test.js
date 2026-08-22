import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENVIRONMENTS,
  FAULTS,
  REQUIRED_FILES,
  mainCampaign,
} from "../../scripts/ide-roadmap-marketplace-supply-chain.mjs";
import {
  AUDIT_FRAGMENT_SCHEMA,
  AUDIT_PRODUCER_PATHS,
  AUDIT_PROFILE_VERSION,
  AUDIT_TEST_IDS,
  AUDIT_THRESHOLDS,
  REQUIRED_OS,
  aggregateSupplyChainEvidence,
  buildPluginSourceAuditFragments,
  rehashPluginSourceAuditFragments,
  verifyCell,
  verifyPluginSourceAuditFragments,
  writePluginSourceAuditFragments,
} from "../../scripts/verify-ide-roadmap-marketplace-supply-chain.mjs";

const COMMIT = "a".repeat(40);
const roots = [];

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJson(directory, file, value) {
  fs.writeFileSync(path.join(directory, file), `${JSON.stringify(value)}\n`);
}

function createCell({
  operatingSystem = "linux",
  environment = "private-registry-tls",
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sc-cell-"));
  roots.push(directory);
  const osSuffix = { linux: "linux", darwin: "macos", win32: "windows" }[
    operatingSystem
  ];
  const provenance = {
    repository: "owner/repo",
    workflowRef: "owner/repo/.github/workflows/sc.yml@refs/heads/main",
    workflowSha: COMMIT,
    runId: "42",
    runAttempt: "1",
    job: "supply-chain",
    eventName: "workflow_dispatch",
    artifactName: `ide-marketplace-supply-chain-${osSuffix}-${environment}-1`,
  };
  writeJson(directory, "exact-commit.json", {
    releaseCommit: COMMIT,
    exactCommitBound: true,
  });
  writeJson(directory, "host-environment.json", {
    releaseCommit: COMMIT,
    operatingSystem,
    architecture: "x64",
    environment,
    nodeVersion: "v22.12.0",
    provenance,
  });
  writeJson(directory, "network-journeys.json", {
    environment,
    independentRuns: 100,
    registryTls: "private-ca",
    authentication: "bearer",
    registryRequestCount: 100,
    artifactRequestCount: 300,
    archiveRequestCount: 102,
    authenticatedRequestCount: environment === "air-gapped-cache" ? 4 : 400,
    proxyConnectCount: ["explicit-proxy", "pac"].includes(environment)
      ? 100
      : 0,
    proxyAuthenticatedConnectCount: environment === "explicit-proxy" ? 100 : 0,
    offlineNetworkRequestCount: 0,
    archiveTransport: "same-origin-https",
    archiveOnlineFetchCount: environment === "air-gapped-cache" ? 0 : 100,
    archivePreflightCandidateBytesFetched: false,
    archivePreflightRevision: "b".repeat(64),
    sourcePrecedence: "whole-entry-priority",
    selectedSourcePriority: 0,
    dynamicSourceStatus: "default-disabled",
    dynamicSourceProcessStartCount: 0,
  });
  writeJson(directory, "lifecycle-journeys.json", {
    installCount: 100,
    upgradeCount: 100,
    rollbackCount: 100,
    signatureVerifiedInstallCount: 200,
    rollbackFailureCount: 0,
    unverifiedActivationCount: 0,
    archiveMaterializationCount: environment === "air-gapped-cache" ? 102 : 202,
    archiveSourceInstallCount: 100,
  });
  writeJson(directory, "fault-injection.json", {
    faultsExercised: FAULTS,
    rejectionCount: FAULTS.length,
    unexpectedAcceptanceCount: 0,
    processTerminationCount: 2,
    recoveryFailureCount: 0,
    failureArtifactsComplete: true,
  });
  writeJson(directory, "cache-authority.json", {
    layers: [
      "registry",
      "signature",
      "public-key",
      "sbom",
      "archive-binary",
      "archive-source",
      "source-package",
    ],
    offlineReplayCount: 100,
    immutableCacheReadCount: 600,
    sourceCacheReadCount: 100,
    archiveCacheReadCount: 100,
    archiveSourceReadCount: 100,
    archiveCrashRecoveryCount: 1,
    corruptCacheActivationCount: 0,
    unauthorizedCacheFallbackCount: 0,
  });
  writeJson(directory, "redaction.json", {
    scannedJourneyCount: 100,
    credentialLeakCount: 0,
    privateKeyLeakCount: 0,
    querySecretLeakCount: 0,
    dynamicSourceSecretLeakCount: 0,
  });
  writeJson(directory, "outcome-observations.json", {
    success: true,
    independentRuns: 100,
    credentialLeakCount: 0,
    unauthorizedCacheFallbackCount: 0,
    unverifiedActivationCount: 0,
    staleAuthorityActivationCount: 0,
    corruptCacheActivationCount: 0,
    dependencyConflictActivationCount: 0,
    sourceSwitchWithoutApprovalCount: 0,
    revokedKeyActivationCount: 0,
    offlineNetworkRequestCount: 0,
    rollbackFailureCount: 0,
    archiveDigestMismatchAcceptanceCount: 0,
    dynamicSourceExecutionCount: 0,
    archivePreflightBypassCount: 0,
    failureArtifactsComplete: true,
    exactCommitBound: true,
  });
  const files = Object.fromEntries(
    REQUIRED_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(directory, file));
      return [file, { sha256: digest(bytes), bytes: bytes.length }];
    }),
  );
  writeJson(directory, "manifest.json", {
    schema: "chainlesschain.marketplace-supply-chain-manifest.v1",
    releaseCommit: COMMIT,
    operatingSystem,
    environment,
    files,
  });
  return { directory, provenance };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function verifiedCells() {
  const cells = [];
  for (const operatingSystem of REQUIRED_OS) {
    for (const environment of ENVIRONMENTS) {
      const { directory, provenance } = createCell({
        operatingSystem,
        environment,
      });
      cells.push(
        verifyCell(directory, {
          operatingSystem,
          environment,
          releaseCommit: COMMIT,
          provenance,
        }),
      );
    }
  }
  return cells;
}

function auditOptions() {
  return {
    releaseCommit: COMMIT,
    workflowRef:
      "owner/repo/.github/workflows/ide-roadmap-marketplace-supply-chain.yml@refs/heads/main",
    runId: "42",
    jobId: "trusted-supply-chain-aggregate",
    aggregateArtifactName: "ide-marketplace-supply-chain-aggregate-1",
    producerDigests: Object.fromEntries(
      AUDIT_PRODUCER_PATHS.map((sourcePath, index) => [
        sourcePath,
        `sha256:${String(index + 1)
          .repeat(64)
          .slice(0, 64)}`,
      ]),
    ),
  };
}

describe("marketplace supply-chain Actions matrix", () => {
  it.each(ENVIRONMENTS)(
    "runs a real %s network, cache, lifecycle, and fault campaign",
    async (environment) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sc-live-"));
      roots.push(directory);
      const artifactDir = path.join(directory, "evidence");
      await mainCampaign(
        {
          releaseCommit: COMMIT,
          environment,
          artifactDir,
          artifactName: "local-marketplace-supply-chain",
          stateDir: path.join(directory, "state"),
        },
        { assertExactCheckout() {}, independentRuns: 2 },
      );
      const outcome = JSON.parse(
        fs.readFileSync(path.join(artifactDir, "outcome-observations.json")),
      );
      const faults = JSON.parse(
        fs.readFileSync(path.join(artifactDir, "fault-injection.json")),
      );
      expect(outcome).toMatchObject({ success: true, independentRuns: 2 });
      expect(faults.faultsExercised).toHaveLength(FAULTS.length);
      expect(faults.unexpectedAcceptanceCount).toBe(0);
    },
    120_000,
  );

  it("declares all twelve OS/environment cells and an always-run aggregate", () => {
    expect(ENVIRONMENTS).toEqual([
      "private-registry-tls",
      "explicit-proxy",
      "pac",
      "air-gapped-cache",
    ]);
    const workflow = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/workflows/ide-roadmap-marketplace-supply-chain.yml",
      ),
      "utf8",
    );
    for (const osName of ["ubuntu-24.04", "macos-15", "windows-2025"]) {
      expect(workflow.match(new RegExp(`os: ${osName}`, "gu"))).toHaveLength(4);
    }
    for (const environment of ENVIRONMENTS) {
      expect(
        workflow.match(new RegExp(`environment: ${environment}`, "gu")),
      ).toHaveLength(3);
    }
    expect(
      workflow.match(
        /npm install --include=optional --ignore-scripts --no-package-lock --no-save --prefix packages\/cli/gu,
      ),
    ).toHaveLength(1);
    expect(
      workflow.match(
        /npm install --omit=optional --ignore-scripts --no-package-lock --no-save --prefix packages\/cli/gu,
      ),
    ).toHaveLength(1);
    const focusedStepStart = workflow.indexOf(
      "- name: Run canonical marketplace policy regressions",
    );
    const focusedStepEnd = workflow.indexOf(
      "- name: Run authenticated supply-chain campaign",
      focusedStepStart,
    );
    expect(focusedStepStart).toBeGreaterThan(-1);
    expect(focusedStepEnd).toBeGreaterThan(focusedStepStart);
    const focusedStep = workflow.slice(focusedStepStart, focusedStepEnd);
    expect(focusedStep).toContain("working-directory: packages/cli");
    for (const testFile of [
      "plugin-marketplace-selection-command.test.js",
      "plugin-security.test.js",
      "plugin-runtime-install.test.js",
      "plugin-remote-source-security.test.js",
      "plugin-marketplace-source-cache.test.js",
    ]) {
      expect(focusedStep).toContain(`__tests__/unit/${testFile}`);
    }
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain(
      '--fragment-dir "$RUNNER_TEMP/marketplace-supply-chain-audit-fragments"',
    );
    expect(workflow).toContain(
      "${{ runner.temp }}/marketplace-supply-chain-audit-fragments/",
    );
  });

  it("rehashes a complete zero-violation producer", () => {
    const { directory, provenance } = createCell();
    expect(
      verifyCell(directory, {
        operatingSystem: "linux",
        environment: "private-registry-tls",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toMatchObject({
      operatingSystem: "linux",
      environment: "private-registry-tls",
    });
  });

  it("rejects evidence modified after producer manifest creation", () => {
    const { directory, provenance } = createCell();
    fs.appendFileSync(path.join(directory, "redaction.json"), " ");
    expect(() =>
      verifyCell(directory, {
        operatingSystem: "linux",
        environment: "private-registry-tls",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toThrow();
  });

  it("normalizes twelve rehashed cells into three exact-head required fragments", () => {
    const options = auditOptions();
    const fragments = buildPluginSourceAuditFragments(verifiedCells(), options);
    expect(fragments).toHaveLength(3);
    expect(fragments.map((fragment) => fragment.os).sort()).toEqual([
      "linux",
      "macos",
      "windows",
    ]);
    for (const fragment of fragments) {
      expect(fragment).toMatchObject({
        schema: AUDIT_FRAGMENT_SCHEMA,
        commitmentId: "PLUGIN-SOURCE",
        headSha: COMMIT,
        runtime: { name: "node", version: "22.12.0", arch: "x64" },
        profileVersion: AUDIT_PROFILE_VERSION,
        thresholds: AUDIT_THRESHOLDS,
        testIds: AUDIT_TEST_IDS,
        producerDigests: options.producerDigests,
        disposition: "required",
        outcome: "passed",
        source: {
          workflowId: options.workflowRef,
          runId: "42",
          jobId: "trusted-supply-chain-aggregate",
          artifactName: "ide-marketplace-supply-chain-aggregate-1",
        },
      });
      expect(fragment.measurements).toMatchObject({
        environmentCount: 4,
        independentRuns: 400,
        installUpgradeRollbackOperations: 1200,
        immutableCacheReadbacks: 2400,
        faultRejections: ENVIRONMENTS.length * FAULTS.length,
        failureCount: 0,
        credentialLeakCount: 0,
        dynamicSourceExecutionCount: 0,
        offlineNetworkRequestCount: 0,
      });
      expect(fragment.measurements.cells).toHaveLength(4);
    }
    expect(() =>
      verifyPluginSourceAuditFragments(fragments, {
        releaseCommit: COMMIT,
        producerDigests: options.producerDigests,
        source: fragments[0].source,
      }),
    ).not.toThrow();
  });

  it("rehashes emitted fragments and never counts advisory evidence as required", () => {
    const options = auditOptions();
    const fragments = buildPluginSourceAuditFragments(verifiedCells(), options);
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-sc-fragments-"),
    );
    roots.push(directory);
    const expected = {
      releaseCommit: COMMIT,
      producerDigests: options.producerDigests,
      source: fragments[0].source,
    };
    const records = writePluginSourceAuditFragments(
      directory,
      fragments,
      expected,
    );
    expect(records).toHaveLength(3);
    expect(
      records.every((record) => /^sha256:[a-f0-9]{64}$/u.test(record.sha256)),
    ).toBe(true);
    expect(rehashPluginSourceAuditFragments(directory, expected)).toEqual(
      records,
    );

    const advisoryReplacement = fragments.map((fragment) =>
      fragment.os === "windows"
        ? { ...fragment, disposition: "advisory" }
        : fragment,
    );
    expect(() =>
      verifyPluginSourceAuditFragments(advisoryReplacement, expected),
    ).toThrow(/missing required audit cells/u);
  });

  it("fails closed through the aggregate entry point and records fragment digests", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sc-aggregate-"));
    roots.push(root);
    const evidenceRoot = path.join(root, "evidence");
    fs.mkdirSync(evidenceRoot);
    const osSuffix = { linux: "linux", darwin: "macos", win32: "windows" };
    for (const operatingSystem of REQUIRED_OS) {
      for (const environment of ENVIRONMENTS) {
        const { directory } = createCell({ operatingSystem, environment });
        fs.renameSync(
          directory,
          path.join(
            evidenceRoot,
            `${osSuffix[operatingSystem]}-${environment}`,
          ),
        );
      }
    }
    const options = {
      ...auditOptions(),
      evidenceRoot,
      repository: "owner/repo",
      workflowRef: "owner/repo/.github/workflows/sc.yml@refs/heads/main",
      workflowSha: COMMIT,
      runAttempt: "1",
      eventName: "workflow_dispatch",
      fragmentDir: path.join(root, "fragments"),
      output: path.join(root, "aggregate.json"),
    };
    const result = aggregateSupplyChainEvidence(options, {
      producerDigests: () => options.producerDigests,
    });
    expect(result.output).toMatchObject({
      exactCommitBound: true,
      cellCount: 12,
      totalIndependentRuns: 1200,
    });
    expect(result.output.auditFragments).toHaveLength(3);
    for (const record of result.output.auditFragments) {
      const bytes = fs.readFileSync(
        path.join(options.fragmentDir, record.file),
      );
      expect(record.sha256).toBe(digest(bytes));
      expect(record.disposition).toBe("required");
    }
  });
});
