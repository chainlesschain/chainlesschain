import { describe, expect, it } from "vitest";
import {
  buildRrsiStatisticsSimulationPlan,
  runRrsiStatisticsSimulation,
} from "../../src/lib/evolution/rrsi-statistics-simulation.js";
import { rrsiFixtureDigest } from "../fixtures/rrsi-shadow-fixture.js";
import {
  RRSI_BOUNDED_CLUSTER_METHOD,
  RRSI_CLUSTER_ENVELOPE_METHOD,
} from "../../src/lib/evolution/rrsi-group-statistics.js";

const input = () => ({
  intervalMethod: RRSI_BOUNDED_CLUSTER_METHOD,
  bootstrapSamples: null,
  trialCount: 1000,
  clusterCounts: [20, 40],
  comparisonCount: 2,
  familyAlpha: 0.05,
  qualityThreshold: 0.05,
  targetPower: 0.8,
  randomnessSeedDigest: rrsiFixtureDigest("TEST ONLY simulation grid"),
});
describe("RRSI conditional coverage and power simulations", () => {
  it("runs every preregistered family and reports Monte Carlo uncertainty", () => {
    const plan = buildRrsiStatisticsSimulationPlan(input());
    const report = runRrsiStatisticsSimulation(plan);
    expect(report.scenarios).toHaveLength(16);
    expect(report).toMatchObject({
      coverageCheckedOnGrid: false,
      status: "hold",
      fullAnalysisMethodSimulated: false,
      hoeffdingOnlyPowerCannotSelectFullMethodSampleSize: true,
      productionCoverageValidated: false,
      productionPowerValidated: false,
      statisticalProtocolValidated: false,
      qualifiesForPromotion: false,
    });
    for (const scenario of report.scenarios) {
      expect(scenario.familyCoverage.trials).toBe(1000);
      expect(scenario.familyCoverage.monteCarlo95.lower).toBeGreaterThanOrEqual(
        0.95,
      );
      expect(scenario.familyCoverage.monteCarlo95.upper).toBeGreaterThanOrEqual(
        scenario.familyCoverage.estimate,
      );
    }
    const rare = report.scenarios.find(
      (row) =>
        row.groupCount === 20 &&
        row.weightProfile === "equal-task-counts" &&
        row.distribution === "rare-negative-null",
    );
    expect(rare.zeroSpreadDiagnosticMissRate.estimate).toBeGreaterThan(0.3);
    expect(rare.unsupportedPositiveFamilyRate.estimate).toBeLessThan(0.05);
    const simultaneousRadius = Math.sqrt(Math.log((2 * 64) / 0.05) / 2000);
    expect(rare.familyCoverage.simultaneousGrid95.lower).toBeCloseTo(
      rare.familyCoverage.estimate - simultaneousRadius,
    );
    const dominant = report.scenarios.find(
      (row) =>
        row.groupCount === 20 && row.weightProfile === "one-dominant-component",
    );
    expect(dominant.effectiveGroupCount).toBeLessThan(2);
    expect(
      report.powerEstimates.some(
        (row) => row.minimumGridGroupCountMeetingPower === null,
      ),
    ).toBe(true);
  });

  it("simulates the actual outer envelope and holds when Monte Carlo precision is insufficient", () => {
    const plan = buildRrsiStatisticsSimulationPlan({
      ...input(),
      intervalMethod: RRSI_CLUSTER_ENVELOPE_METHOD,
      bootstrapSamples: 2000,
      trialCount: 100,
      clusterCounts: [20],
    });
    expect(plan.operations).toBe(64_000_000);
    expect(plan.bootstrapIndexCoupling).toBe(
      "same-stream-for-contrasts-within-each-trial",
    );
    const report = runRrsiStatisticsSimulation(plan);
    expect(report).toMatchObject({
      intervalMethod: RRSI_CLUSTER_ENVELOPE_METHOD,
      fullAnalysisMethodSimulated: true,
      hoeffdingOnlyPowerCannotSelectFullMethodSampleSize: false,
      threeArmExperimentPowerValidated: false,
      coverageCheckedOnGrid: false,
      status: "hold",
    });
    expect(report.scenarios).toHaveLength(8);
    expect(
      report.powerEstimates.every(
        (row) => row.minimumGridGroupCountMeetingPower === null,
      ),
    ).toBe(true);
    expect(
      report.scenarios.every((row) => row.familyCoverage.estimate >= 0.95),
    ).toBe(true);
  }, 30000);

  it("cannot delete adverse distributions, change weights or retag synthetic calibration", () => {
    const plan = buildRrsiStatisticsSimulationPlan(input());
    for (const mutation of [
      (value) => value.laws.pop(),
      (value) => {
        value.weightProfiles = ["equal-task-counts"];
      },
      (value) => {
        value.statisticalProtocolValidated = true;
      },
    ]) {
      const value = structuredClone(plan);
      mutation(value);
      expect(() => runRrsiStatisticsSimulation(value)).toThrow(
        /frozen scenarios/,
      );
    }
  });

  it("freezes the sample grid and rejects unbounded simulation work", () => {
    expect(() =>
      buildRrsiStatisticsSimulationPlan({
        ...input(),
        clusterCounts: [20, 20],
      }),
    ).toThrow(/duplicate/);
    expect(() =>
      buildRrsiStatisticsSimulationPlan({
        ...input(),
        trialCount: 10000,
        clusterCounts: [4000],
      }),
    ).toThrow(/operation bound/);
    expect(() =>
      buildRrsiStatisticsSimulationPlan({ ...input(), trialCount: 99 }),
    ).toThrow(/range/);
    expect(() =>
      buildRrsiStatisticsSimulationPlan({
        ...input(),
        intervalMethod: RRSI_CLUSTER_ENVELOPE_METHOD,
        bootstrapSamples: 1000,
      }),
    ).toThrow(/tail resolution/);
    expect(() =>
      buildRrsiStatisticsSimulationPlan({
        ...input(),
        bootstrapSamples: 2000,
      }),
    ).toThrow(/must not claim/);
  });
});
