import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ENTRYPOINTS,
  REQUIRED_FILES,
  mainCampaign,
} from "../../scripts/ide-roadmap-context-permission-matrix.mjs";
import { verifyCell } from "../../scripts/verify-ide-roadmap-context-permission.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = `sha256:${"b".repeat(64)}`;
const roots = [];

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function writeJson(directory, file, value) {
  fs.writeFileSync(path.join(directory, file), `${JSON.stringify(value)}\n`);
}

function createCell() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cp-cell-"));
  roots.push(directory);
  const provenance = {
    repository: "owner/repo",
    workflowRef: "owner/repo/.github/workflows/cp.yml@refs/heads/main",
    workflowSha: COMMIT,
    runId: "42",
    runAttempt: "1",
    job: "context-permission",
    eventName: "workflow_dispatch",
    artifactName: "ide-context-permission-linux-1",
  };
  writeJson(directory, "exact-commit.json", {
    releaseCommit: COMMIT,
    exactCommitBound: true,
  });
  writeJson(directory, "host-environment.json", {
    releaseCommit: COMMIT,
    operatingSystem: "linux",
    provenance,
  });
  writeJson(directory, "concurrency-authority.json", {
    addCount: 100,
    revokeCount: 100,
    finalGeneration: 201,
    lostUpdateCount: 0,
    duplicateRuleIdCount: 0,
    staleRevisionAcceptanceCount: 0,
    managedDenyRelaxationCount: 0,
    stateDigest: DIGEST,
  });
  writeJson(directory, "fault-injection.json", {
    corruptAuthorityRejectedCount: 1,
    processTerminationCount: 1,
    processTerminationStateDriftCount: 0,
    networkUnknownRecoveryClaimCount: 0,
    failureArtifactsComplete: true,
  });
  writeJson(directory, "cross-entry-projections.json", {
    entrypoints: ENTRYPOINTS.map((entrypoint) => ({
      entrypoint,
      independentRuns: 100,
      contextDigest: DIGEST,
      projectionSetDigest: DIGEST,
    })),
    totalProjectionRuns: ENTRYPOINTS.length * 100,
  });
  writeJson(directory, "redaction-and-recovery.json", {
    scannedProjectionCount: ENTRYPOINTS.length * 100,
    credentialValueLeakCount: 0,
    fullCommandLeakCount: 0,
    externalResourceRollbackOverclaimCount: 0,
    deterministicContextMismatchCount: 0,
  });
  writeJson(directory, "outcome-observations.json", {
    success: true,
    concurrentMutationCount: 200,
    crossEntryProjectionCount: ENTRYPOINTS.length * 100,
    credentialLeakCount: 0,
    fullCommandLeakCount: 0,
    managedDenyRelaxationCount: 0,
    checkpointRecoveryOverclaimCount: 0,
    corruptAuthorityAcceptanceCount: 0,
    orphanProcessCount: 0,
    requiredMeasurementsComplete: true,
    exactCommitBound: true,
  });
  const files = Object.fromEntries(
    REQUIRED_FILES.map((file) => {
      const bytes = fs.readFileSync(path.join(directory, file));
      return [file, { sha256: digest(bytes), bytes: bytes.length }];
    }),
  );
  writeJson(directory, "manifest.json", {
    schema: "chainlesschain.context-permission-manifest.v1",
    releaseCommit: COMMIT,
    operatingSystem: "linux",
    files,
  });
  return { directory, provenance };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("context/permission Actions matrix", () => {
  it("runs the production concurrency and cross-entry campaign locally", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cc-cp-live-"));
    roots.push(directory);
    const artifactDir = path.join(directory, "evidence");
    await mainCampaign(
      {
        releaseCommit: COMMIT,
        artifactDir,
        artifactName: "local-context-permission",
        stateDir: path.join(directory, "state"),
      },
      { assertExactCheckout() {} },
    );
    const host = JSON.parse(
      fs.readFileSync(path.join(artifactDir, "host-environment.json"), "utf8"),
    );
    expect(
      verifyCell(artifactDir, {
        operatingSystem: process.platform,
        releaseCommit: COMMIT,
        provenance: host.provenance,
      }),
    ).toMatchObject({ operatingSystem: process.platform });
  }, 120_000);

  it("binds all seven product entrypoints to 100 runs", () => {
    expect(ENTRYPOINTS).toEqual([
      "repl",
      "headless",
      "stream",
      "websocket",
      "vscode",
      "jetbrains",
      "desktop",
    ]);
    const workflow = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../../../.github/workflows/ide-roadmap-context-permission.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain("ubuntu-24.04");
    expect(workflow).toContain("macos-15");
    expect(workflow).toContain("windows-2025");
    expect(workflow).toContain("ContextCenterTest");
    expect(workflow).toContain("PolicyViewerTest");
    expect(workflow).toContain(
      "npm install --include=optional --ignore-scripts --no-package-lock --no-save --prefix packages/cli",
    );
    expect(workflow).not.toMatch(/npm install[^\n]*--omit=optional/u);
    expect(workflow).toContain("if: always()");
  });

  it("rehashes all evidence and accepts only complete zero-leak outcomes", () => {
    const { directory, provenance } = createCell();
    expect(
      verifyCell(directory, {
        operatingSystem: "linux",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toMatchObject({ operatingSystem: "linux" });
  });

  it("rejects a producer artifact modified after its manifest", () => {
    const { directory, provenance } = createCell();
    fs.appendFileSync(path.join(directory, "redaction-and-recovery.json"), " ");
    expect(() =>
      verifyCell(directory, {
        operatingSystem: "linux",
        releaseCommit: COMMIT,
        provenance,
      }),
    ).toThrow();
  });
});
