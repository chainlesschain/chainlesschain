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
import { verifyCell } from "../../scripts/verify-ide-roadmap-marketplace-supply-chain.mjs";

const COMMIT = "a".repeat(40);
const roots = [];

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJson(directory, file, value) {
  fs.writeFileSync(path.join(directory, file), `${JSON.stringify(value)}\n`);
}

function createCell() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-sc-cell-"));
  roots.push(directory);
  const provenance = {
    repository: "owner/repo",
    workflowRef: "owner/repo/.github/workflows/sc.yml@refs/heads/main",
    workflowSha: COMMIT,
    runId: "42",
    runAttempt: "1",
    job: "supply-chain",
    eventName: "workflow_dispatch",
    artifactName: "ide-marketplace-supply-chain-linux-private-registry-tls-1",
  };
  writeJson(directory, "exact-commit.json", {
    releaseCommit: COMMIT,
    exactCommitBound: true,
  });
  writeJson(directory, "host-environment.json", {
    releaseCommit: COMMIT,
    operatingSystem: "linux",
    environment: "private-registry-tls",
    provenance,
  });
  writeJson(directory, "network-journeys.json", {
    environment: "private-registry-tls",
    independentRuns: 100,
    registryTls: "private-ca",
    authentication: "bearer",
    registryRequestCount: 100,
    artifactRequestCount: 300,
    authenticatedRequestCount: 400,
    proxyConnectCount: 0,
    proxyAuthenticatedConnectCount: 0,
    offlineNetworkRequestCount: 0,
  });
  writeJson(directory, "lifecycle-journeys.json", {
    installCount: 100,
    upgradeCount: 100,
    rollbackCount: 100,
    signatureVerifiedInstallCount: 200,
    rollbackFailureCount: 0,
    unverifiedActivationCount: 0,
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
    layers: ["registry", "signature", "public-key", "sbom", "source-package"],
    offlineReplayCount: 100,
    immutableCacheReadCount: 500,
    sourceCacheReadCount: 100,
    corruptCacheActivationCount: 0,
    unauthorizedCacheFallbackCount: 0,
  });
  writeJson(directory, "redaction.json", {
    scannedJourneyCount: 100,
    credentialLeakCount: 0,
    privateKeyLeakCount: 0,
    querySecretLeakCount: 0,
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
    operatingSystem: "linux",
    environment: "private-registry-tls",
    files,
  });
  return { directory, provenance };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
        /npm install --omit=optional --ignore-scripts --no-package-lock --no-save --prefix packages\/cli/gu,
      ),
    ).toHaveLength(2);
    expect(workflow).toContain("if: always()");
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
});
