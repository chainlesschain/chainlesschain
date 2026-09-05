import { describe, expect, it } from "vitest";
import {
  runEvolutionLedgerReliabilitySoak,
  runEvolutionLedgerFaultCampaign,
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
      segmentCorruptionRejected: true,
      witnessCorruptionRejected: true,
      productionAuthority: false,
    });
    expect(report.seedPid).not.toBe(report.reopenPid);
    expect(report.reopenMaxRssKiB).toBeGreaterThan(0);
    expect(report.reopenMs).toBeLessThan(60_000);
  }, 90_000);

  it.each([0, -1, 10_001, 1.5, NaN, Infinity, "1000"])(
    "rejects an invalid event count before starting workers: %s",
    async (events) => {
      await expect(
        runEvolutionLedgerReliabilitySoak({ events }),
      ).rejects.toThrow(/events must be an integer/u);
    },
  );
});
