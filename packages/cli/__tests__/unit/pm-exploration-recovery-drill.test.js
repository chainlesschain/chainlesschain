import { describe, expect, it, vi } from "vitest";

import {
  PM_EXPLORATION_RECOVERY_DRILL_SCHEMA,
  runPmExplorationRecoveryDrill,
} from "../../scripts/pm-exploration-recovery-drill.mjs";

describe("PM exploration recovery drill", () => {
  it("fails closed across restart, replica loss, forced exits and CAS races", async () => {
    const onProgress = vi.fn();
    const report = await runPmExplorationRecoveryDrill({ onProgress });
    expect(report).toMatchObject({
      schema: PM_EXPLORATION_RECOVERY_DRILL_SCHEMA,
      status: "passed",
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
    });
    expect(report.processCount).toBeGreaterThanOrEqual(24);
    expect(report.unverifiedConditions).toContain("physical-power-loss");
    expect(report.unverifiedConditions).toContain(
      "production-kms-hsm-pki-authority",
    );
    expect(report.unverifiedConditions).toContain("real-disk-full");
    expect(report.unverifiedConditions).toContain("real-read-only-filesystem");
    expect(report.unverifiedConditions).toContain(
      "real-remote-authority-timeout-and-disconnect",
    );
    expect(report.crashResults).toEqual({
      "after-retain": expect.objectContaining({ committed: false }),
      "after-segment": expect.objectContaining({ committed: false }),
      "after-witness": expect.objectContaining({ committed: true }),
    });
    expect(report.faultResults).toEqual({
      "artifact-erofs": expect.objectContaining({
        observedCode: "EROFS",
        committed: false,
      }),
      "authority-invalid-receipt": expect.objectContaining({
        observedCode: "CC_PM_EXPLORATION_LEDGER_CORRUPT",
        committed: false,
      }),
      "authority-resolve-timeout": expect.objectContaining({
        observedCode: "ETIMEDOUT",
        committed: true,
      }),
      "authority-retain-reset": expect.objectContaining({
        observedCode: "ECONNRESET",
        committed: false,
      }),
      "authority-retain-timeout": expect.objectContaining({
        observedCode: "ETIMEDOUT",
        committed: false,
      }),
      "ledger-enospc-after-segment": expect.objectContaining({
        observedCode: "ENOSPC",
        committed: false,
      }),
      "ledger-enospc-after-witness": expect.objectContaining({
        observedCode: "ENOSPC",
        committed: true,
      }),
    });
    expect(onProgress).toHaveBeenCalledWith(
      "checking identical concurrent idempotence",
    );
  }, 120_000);

  it("rejects a non-function progress observer before creating a drill", async () => {
    await expect(
      runPmExplorationRecoveryDrill({ onProgress: true }),
    ).rejects.toThrow(/onProgress/);
  });
});
