import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  PM_EXPLORATION_RECOVERY_AGGREGATE_SCHEMA,
  PM_EXPLORATION_RECOVERY_DRILL_SCHEMA,
  PM_EXPLORATION_RECOVERY_EVIDENCE_SCHEMA,
  createPmExplorationRecoveryEvidence,
  verifyPmExplorationRecoveryEvidenceDirectory,
} from "../../scripts/pm-exploration-recovery-drill.mjs";

const SHA = "a".repeat(40);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function report() {
  return {
    schema: PM_EXPLORATION_RECOVERY_DRILL_SCHEMA,
    status: "passed",
    processCount: 31,
    freshProcessRestartRecovered: true,
    localCacheLossRecoveredFromAuthority: true,
    authorityLossRejected: true,
    forcedExitAfterRetainRejected: true,
    uncommittedLedgerExitRejected: true,
    committedLedgerExitRecovered: true,
    divergentCasConflictRejected: true,
    identicalCasCommitIdempotent: true,
    artifactReadOnlyFailureRejected: true,
    authorityRetainTimeoutRejected: true,
    authorityDisconnectRejected: true,
    invalidDurabilityReceiptRejected: true,
    authorityResolveTimeoutRejected: true,
    preWitnessDiskFullRejected: true,
    postWitnessDiskFullRecovered: true,
    falseSuccessReceipts: 0,
    testAuthority: true,
    productionAuthority: false,
    physicalPowerLossVerified: false,
    syntheticFaultInjection: true,
    realDiskFullVerified: false,
    realReadOnlyFilesystemVerified: false,
    realRemoteAuthorityVerified: false,
    qualifiesForProduction: false,
    unverifiedConditions: [
      "physical-power-loss",
      "production-kms-hsm-pki-authority",
      "independent-remote-fault-domain",
      "production-filesystem-and-device-cache-semantics",
      "real-disk-full",
      "real-read-only-filesystem",
      "real-remote-authority-timeout-and-disconnect",
    ],
    crashResults: {
      "after-retain": { crashPid: 101, recoveredPid: 102, committed: false },
      "after-segment": { crashPid: 103, recoveredPid: 104, committed: false },
      "after-witness": { crashPid: 105, recoveredPid: 106, committed: true },
    },
    faultResults: {
      "artifact-erofs": {
        faultPid: 201,
        recoveryPid: 202,
        observedCode: "EROFS",
        committed: false,
      },
      "authority-invalid-receipt": {
        faultPid: 203,
        recoveryPid: 204,
        observedCode: "CC_PM_EXPLORATION_LEDGER_CORRUPT",
        committed: false,
      },
      "authority-resolve-timeout": {
        faultPid: 205,
        recoveryPid: 206,
        observedCode: "ETIMEDOUT",
        committed: true,
      },
      "authority-retain-reset": {
        faultPid: 207,
        recoveryPid: 208,
        observedCode: "ECONNRESET",
        committed: false,
      },
      "authority-retain-timeout": {
        faultPid: 209,
        recoveryPid: 210,
        observedCode: "ETIMEDOUT",
        committed: false,
      },
      "ledger-enospc-after-segment": {
        faultPid: 211,
        recoveryPid: 212,
        observedCode: "ENOSPC",
        committed: false,
      },
      "ledger-enospc-after-witness": {
        faultPid: 213,
        recoveryPid: 214,
        observedCode: "ENOSPC",
        committed: true,
      },
    },
  };
}

function evidenceDirectory(overrides = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-pm-evidence-"),
  );
  roots.push(root);
  const source = createPmExplorationRecoveryEvidence({
    report: report(),
    sourceRevision: SHA,
    now: () => "2026-09-17T12:00:00.000Z",
  });
  for (const [index, platform] of ["darwin", "linux", "win32"].entries()) {
    const value = structuredClone(source);
    value.runner.platform = platform;
    Object.assign(value, overrides[platform] ?? {});
    fs.writeFileSync(
      path.join(root, `${index}-${platform}.json`),
      `${JSON.stringify(value)}\n`,
    );
  }
  return root;
}

describe("PM exploration recovery evidence", () => {
  it("binds a passed test-only drill to an exact source revision", () => {
    const evidence = createPmExplorationRecoveryEvidence({
      report: report(),
      sourceRevision: SHA.toUpperCase(),
      now: () => "2026-09-17T12:00:00.000Z",
    });
    expect(evidence).toMatchObject({
      schema: PM_EXPLORATION_RECOVERY_EVIDENCE_SCHEMA,
      status: "passed",
      sourceRevision: SHA,
      issuedAt: "2026-09-17T12:00:00.000Z",
      testAuthority: true,
      productionAuthority: false,
      physicalPowerLossVerified: false,
      syntheticFaultInjection: true,
      realDiskFullVerified: false,
      realReadOnlyFilesystemVerified: false,
      realRemoteAuthorityVerified: false,
      qualifiesForProduction: false,
      runner: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
      },
    });
  });

  it("aggregates exactly one Linux, Windows and macOS record for one SHA", () => {
    const aggregate = verifyPmExplorationRecoveryEvidenceDirectory({
      evidenceDir: evidenceDirectory(),
      releaseCommit: SHA,
      now: () => "2026-09-17T13:00:00.000Z",
    });
    expect(aggregate).toMatchObject({
      schema: PM_EXPLORATION_RECOVERY_AGGREGATE_SCHEMA,
      status: "passed",
      releaseCommit: SHA,
      verifiedAt: "2026-09-17T13:00:00.000Z",
      falseSuccessReceipts: 0,
      testAuthority: true,
      productionAuthority: false,
      physicalPowerLossVerified: false,
      syntheticFaultInjection: true,
      realDiskFullVerified: false,
      realReadOnlyFilesystemVerified: false,
      realRemoteAuthorityVerified: false,
      qualifiesForProduction: false,
    });
    expect(aggregate.platforms.map((entry) => entry.platform)).toEqual([
      "darwin",
      "linux",
      "win32",
    ]);
    expect(
      aggregate.platforms.every((entry) =>
        /^sha256:[a-f0-9]{64}$/u.test(entry.evidenceDigest),
      ),
    ).toBe(true);
  });

  it("rejects incomplete, duplicate, wrong-SHA or production-claim evidence", () => {
    const incomplete = evidenceDirectory();
    fs.rmSync(path.join(incomplete, "2-win32.json"));
    expect(() =>
      verifyPmExplorationRecoveryEvidenceDirectory({
        evidenceDir: incomplete,
        releaseCommit: SHA,
      }),
    ).toThrow(/exactly three/);

    const wrongSha = evidenceDirectory({
      linux: { sourceRevision: "b".repeat(40) },
    });
    expect(() =>
      verifyPmExplorationRecoveryEvidenceDirectory({
        evidenceDir: wrongSha,
        releaseCommit: SHA,
      }),
    ).toThrow(/invalid.*envelope/);

    const productionClaim = evidenceDirectory({
      darwin: { productionAuthority: true },
    });
    expect(() =>
      verifyPmExplorationRecoveryEvidenceDirectory({
        evidenceDir: productionClaim,
        releaseCommit: SHA,
      }),
    ).toThrow(/invalid.*envelope/);

    const duplicate = evidenceDirectory();
    const win = path.join(duplicate, "2-win32.json");
    const value = JSON.parse(fs.readFileSync(win, "utf8"));
    value.runner.platform = "linux";
    fs.writeFileSync(win, `${JSON.stringify(value)}\n`);
    expect(() =>
      verifyPmExplorationRecoveryEvidenceDirectory({
        evidenceDir: duplicate,
        releaseCommit: SHA,
      }),
    ).toThrow(/invalid.*envelope|incomplete/);
  });

  it("rejects a forged success or malformed source revision", () => {
    expect(() =>
      createPmExplorationRecoveryEvidence({
        report: { ...report(), falseSuccessReceipts: 1 },
        sourceRevision: SHA,
      }),
    ).toThrow(/passed test-only drill/);
    expect(() =>
      createPmExplorationRecoveryEvidence({
        report: report(),
        sourceRevision: "main",
      }),
    ).toThrow(/40-character/);
    const incompleteFaults = report();
    delete incompleteFaults.faultResults["artifact-erofs"];
    expect(() =>
      createPmExplorationRecoveryEvidence({
        report: incompleteFaults,
        sourceRevision: SHA,
      }),
    ).toThrow(/fault evidence is incomplete/);
  });

  it("is an exact-SHA three-platform gate in the authoritative CLI CI", () => {
    const workflow = fs.readFileSync(
      path.join(REPOSITORY_ROOT, ".github", "workflows", "cli-ci.yml"),
      "utf8",
    );
    const verifyStart = workflow.indexOf("  verify-cli:");
    const aggregateStart = workflow.indexOf(
      "  pm-exploration-recovery-aggregate:",
    );
    const nextJob = workflow.indexOf("  pack-linux-dryrun:", aggregateStart);
    expect(verifyStart).toBeGreaterThan(-1);
    expect(aggregateStart).toBeGreaterThan(verifyStart);
    expect(nextJob).toBeGreaterThan(aggregateStart);

    const verifyJob = workflow.slice(verifyStart, aggregateStart);
    expect(verifyJob).toContain(
      "os: [ubuntu-latest, windows-latest, macos-latest]",
    );
    expect(verifyJob).toContain("pm-exploration-recovery-drill.mjs");
    expect(verifyJob).toContain(
      '--source-revision "${{ github.event.pull_request.head.sha || github.sha }}"',
    );
    expect(verifyJob).toContain("${{ github.run_attempt }}");
    expect(verifyJob).toContain("if-no-files-found: error");

    const aggregateJob = workflow.slice(aggregateStart, nextJob);
    expect(aggregateJob).toContain("if: always()");
    expect(aggregateJob).toContain("needs: verify-cli");
    expect(aggregateJob).toContain("if: needs.verify-cli.result != 'success'");
    expect(aggregateJob).toContain("actions/download-artifact@v7");
    expect(aggregateJob).toContain("merge-multiple: true");
    expect(aggregateJob).toContain("--verify-evidence-dir");
    expect(aggregateJob).toContain(
      '--release-commit "$CC_PM_RECOVERY_EXPECTED_SHA"',
    );
    expect(aggregateJob).toContain("retention-days: 90");
  });
});
