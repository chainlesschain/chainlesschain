import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createEvolutionLedgerReliabilityEvidence,
  runEvolutionLedgerReliabilitySoak,
  runEvolutionLedgerFaultCampaign,
  verifyEvolutionLedgerReliabilityEvidenceDirectory,
} from "../../scripts/evolution-ledger-reliability-soak.mjs";

describe("EvolutionLedger reliability soak driver", () => {
  it("recovers an actual process exit at each persistence boundary", async () => {
    const report = await runEvolutionLedgerFaultCampaign({ rounds: 6 });
    expect(report).toMatchObject({
      status: "passed",
      rounds: 6,
      falseSuccessReceipts: 0,
      powerLossVerified: false,
    });
    expect(Object.values(report.phaseCounts)).toEqual([1, 1, 1, 1, 1, 1]);
  }, 90_000);

  it("exercises the real subprocess/reopen/corruption path at smoke scale", async () => {
    const report = await runEvolutionLedgerReliabilitySoak({ events: 3 });
    expect(report).toMatchObject({
      status: "passed",
      events: 3,
      childHeapLimitMiB: 256,
      seedBatchSize: 256,
      segmentCorruptionRejected: true,
      witnessCorruptionRejected: true,
      productionAuthority: false,
    });
    expect(report.seedPid).not.toBe(report.reopenPid);
    expect(report.reopenMaxRssKiB).toBeGreaterThan(0);
    expect(report.reopenMs).toBeLessThan(60_000);
    expect(
      report.seedVerificationCounts["ledger-restart:domain-event"],
    ).toBeGreaterThanOrEqual(3);
    expect(
      report.seedVerificationCounts["witness-restart:evolution-ledger-witness"],
    ).toBeGreaterThan(0);
    expect(
      report.reopenVerificationCounts["ledger-restart:domain-event"] ?? 0,
    ).toBe(0);
    expect(
      report.reopenVerificationCounts["ledger-restart:state-snapshot"],
    ).toBeGreaterThan(0);
  }, 90_000);

  it.each([0, -1, 10_001, 1.5, NaN, Infinity, "1000"])(
    "rejects an invalid event count before starting workers: %s",
    async (events) => {
      await expect(
        runEvolutionLedgerReliabilitySoak({ events }),
      ).rejects.toThrow(/events must be an integer/u);
    },
  );

  it("accepts only a complete test-only three-platform evidence matrix", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "cc-ledger-evidence-matrix-"),
    );
    const revision = "a".repeat(40);
    try {
      for (const platform of ["linux", "win32", "darwin"]) {
        const eventEvidence = JSON.parse(
          JSON.stringify(
            createEvolutionLedgerReliabilityEvidence({
              mode: "events",
              now: () => "2026-09-09T00:00:00.000Z",
              report: {
                events: 100,
                productionAuthority: false,
                segmentCorruptionRejected: true,
                status: "passed",
                witnessCorruptionRejected: true,
              },
              sourceRevision: revision,
            }),
          ),
        );
        eventEvidence.runner.platform = platform;
        fs.writeFileSync(
          path.join(root, `events-${platform}.json`),
          JSON.stringify(eventEvidence),
        );

        const faultEvidence = JSON.parse(
          JSON.stringify(
            createEvolutionLedgerReliabilityEvidence({
              mode: "fault-campaign",
              now: () => "2026-09-09T00:00:00.000Z",
              report: {
                falseSuccessReceipts: 0,
                powerLossVerified: false,
                productionAuthority: false,
                rounds: 6,
                status: "passed",
              },
              sourceRevision: revision,
            }),
          ),
        );
        faultEvidence.runner.platform = platform;
        fs.writeFileSync(
          path.join(root, `faults-${platform}.json`),
          JSON.stringify(faultEvidence),
        );
      }

      expect(
        verifyEvolutionLedgerReliabilityEvidenceDirectory({
          evidenceDir: root,
          minimumEvents: 100,
          minimumFaultRounds: 6,
          releaseCommit: revision,
        }),
      ).toMatchObject({
        evidence: expect.arrayContaining([
          expect.objectContaining({ mode: "events", platform: "linux" }),
          expect.objectContaining({
            mode: "fault-campaign",
            platform: "darwin",
          }),
        ]),
        qualifiesForProduction: false,
        status: "passed",
        testAuthority: true,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
