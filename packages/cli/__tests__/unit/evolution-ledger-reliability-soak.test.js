import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createEvolutionLedgerReliabilityEvidence,
  createEvolutionLedgerReliabilityFailureEvidence,
  runEvolutionLedgerReliabilitySoak,
  runEvolutionLedgerFaultCampaign,
  verifyEvolutionLedgerReliabilityEvidenceDirectory,
} from "../../scripts/evolution-ledger-reliability-soak.mjs";

describe("EvolutionLedger reliability soak driver", () => {
  it("preserves bounded test-only diagnostics when an event run fails", () => {
    const evidence = createEvolutionLedgerReliabilityFailureEvidence({
      mode: "events",
      now: () => "2026-09-13T00:00:00.000Z",
      report: {
        completedEvents: 1024,
        elapsedMs: 60_000,
        events: 10_000,
        failureCode: null,
        failureMessage: "backend process exceeded its seed deadline",
        productionAuthority: false,
        seedDiskBytesAtFailure: 8192,
        seedDiskFileCountAtFailure: 8,
        seedResourceSamples: [],
        status: "failed",
      },
      sourceRevision: "b".repeat(40),
    });
    expect(evidence).toMatchObject({
      mode: "events",
      qualifiesForProduction: false,
      report: {
        completedEvents: 1024,
        status: "failed",
      },
      sourceRevision: "b".repeat(40),
      testAuthority: true,
    });
    expect(evidence.unverifiedConditions).toContain("physical-power-loss");
  });

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
    expect(report.seedCheckpointMs).toBeGreaterThanOrEqual(0);
    expect(report.seedDiskBytes).toBeGreaterThan(0);
    expect(report.seedDiskFileCount).toBeGreaterThan(0);
    expect(report.seedMaxRssKiB).toBeGreaterThan(0);
    expect(report.seedResourceSamples).toEqual([
      expect.objectContaining({
        eventCount: 3,
        phase: "append",
        disk: expect.objectContaining({ bytes: expect.any(Number) }),
      }),
      expect.objectContaining({
        checkpointMs: report.seedCheckpointMs,
        eventCount: 3,
        phase: "checkpoint",
        disk: expect.objectContaining({
          bytes: report.seedDiskBytes,
          files: report.seedDiskFileCount,
        }),
      }),
    ]);
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
                reopenMaxRssKiB: 2048,
                reopenMs: 20,
                seedCheckpointMs: 2,
                seedDiskBytes: 4096,
                seedDiskFileCount: 4,
                seedMaxRssKiB: 4096,
                seedMs: 100,
                seedResourceSamples: [
                  {
                    disk: { bytes: 2048, files: 3 },
                    elapsedMs: 80,
                    eventCount: 100,
                    maxRssKiB: 4096,
                    phase: "append",
                  },
                  {
                    checkpointMs: 2,
                    disk: { bytes: 4096, files: 4 },
                    elapsedMs: 100,
                    eventCount: 100,
                    maxRssKiB: 4096,
                    phase: "checkpoint",
                  },
                ],
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
