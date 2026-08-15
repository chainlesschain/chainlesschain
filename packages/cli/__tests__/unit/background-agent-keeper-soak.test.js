import { describe, expect, it } from "vitest";
import {
  nearestRankPercentile,
  resolveBackgroundKeeperSoakProfile,
  summarizeKeeperSoakSamples,
} from "../../scripts/background-agent-keeper-soak.mjs";

describe("background Agent keeper soak contract", () => {
  it("keeps smoke profiles small but non-trivial", () => {
    expect(
      resolveBackgroundKeeperSoakProfile({
        CC_BACKGROUND_KEEPER_SOAK_MODE: "smoke",
        CC_BACKGROUND_KEEPER_SOAK_AGENTS: "3",
        CC_BACKGROUND_KEEPER_SOAK_DURATION_SECONDS: "2",
        CC_BACKGROUND_KEEPER_SOAK_MIN_CYCLES: "2",
      }),
    ).toMatchObject({
      mode: "smoke",
      agents: 3,
      durationSeconds: 2,
      minimumCycles: 2,
    });
  });

  it("enforces the formal 20-Agent, two-hour and 1,000-turn floors", () => {
    expect(
      resolveBackgroundKeeperSoakProfile({
        CC_BACKGROUND_KEEPER_SOAK_MODE: "formal",
        CC_BACKGROUND_KEEPER_SOAK_AGENTS: "2",
        CC_BACKGROUND_KEEPER_SOAK_DURATION_SECONDS: "5",
        CC_BACKGROUND_KEEPER_SOAK_MIN_CYCLES: "1",
      }),
    ).toMatchObject({
      mode: "formal",
      agents: 20,
      durationSeconds: 7_200,
      minimumCycles: 1_000,
    });
  });

  it("uses nearest-rank percentiles and ignores non-finite samples", () => {
    expect(nearestRankPercentile([40, 10, Number.NaN, 20, 30], 95)).toBe(40);
    expect(nearestRankPercentile([], 95)).toBeNull();
  });

  it("summarizes cleanup, readiness, RSS and FD/handle evidence", () => {
    expect(
      summarizeKeeperSoakSamples([
        {
          cleanupMs: 20,
          readinessMs: 50,
          rssBytes: 100,
          resourceCount: 4,
        },
        {
          cleanupMs: 40,
          readinessMs: 70,
          rssBytes: 200,
          resourceCount: 6,
        },
      ]),
    ).toEqual({
      count: 2,
      cleanupP95Ms: 40,
      cleanupMaximumMs: 40,
      readinessP95Ms: 70,
      readinessMaximumMs: 70,
      rssMaximumBytes: 200,
      resourceMaximum: 6,
    });
  });
});
