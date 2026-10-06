/** Preregistered synthetic coverage/power checks, not production calibration. */
import {
  computeRrsiBoundedClusterInterval,
  computeRrsiClusterEnvelopeInterval,
  RRSI_BOUNDED_CLUSTER_METHOD,
  RRSI_CLUSTER_ENVELOPE_METHOD,
} from "./rrsi-group-statistics.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiInteger,
  rrsiFinite,
  rrsiDigest,
  rrsiHash,
  rrsiCanonical,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_STATISTICS_SIMULATION_PLAN_SCHEMA =
  "chainlesschain.rrsi-statistics-simulation-plan/v1";
export const RRSI_STATISTICS_SIMULATION_REPORT_SCHEMA =
  "chainlesschain.rrsi-statistics-simulation-report/v1";
const KEYS = [
  "intervalMethod",
  "bootstrapSamples",
  "trialCount",
  "clusterCounts",
  "comparisonCount",
  "familyAlpha",
  "qualityThreshold",
  "targetPower",
  "randomnessSeedDigest",
];
const LAWS = [
  {
    id: "symmetric-null",
    negative: -1,
    positive: 1,
    positiveProbability: 0.5,
    mean: 0,
  },
  {
    id: "rare-negative-null",
    negative: -0.95,
    positive: 0.05,
    positiveProbability: 0.95,
    mean: 0,
  },
  {
    id: "moderate-positive",
    negative: -0.25,
    positive: 0.75,
    positiveProbability: 0.5,
    mean: 0.25,
  },
  {
    id: "strong-positive",
    negative: 0.6,
    positive: 1,
    positiveProbability: 0.5,
    mean: 0.8,
  },
];

export function buildRrsiStatisticsSimulationPlan(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, KEYS, "statistics simulation plan");
  rrsiInteger(value.trialCount, "Monte Carlo trials", 100, 10000);
  rrsiInteger(value.comparisonCount, "simulation comparison family", 1, 32);
  rrsiFinite(value.familyAlpha, "simulation family alpha", 0.0001, 0.05);
  rrsiFinite(value.qualityThreshold, "simulation quality threshold", 0, 0.5);
  rrsiFinite(value.targetPower, "simulation planned power", 0.8, 0.99);
  rrsiDigest(value.randomnessSeedDigest, "simulation randomness seed");
  if (
    ![RRSI_BOUNDED_CLUSTER_METHOD, RRSI_CLUSTER_ENVELOPE_METHOD].includes(
      value.intervalMethod,
    )
  )
    rrsiFail("simulation must freeze the actual interval method");
  const fullMethod = value.intervalMethod === RRSI_CLUSTER_ENVELOPE_METHOD;
  if (fullMethod) {
    rrsiInteger(
      value.bootstrapSamples,
      "simulation bootstrap samples",
      1000,
      1_000_000,
    );
    if (
      (value.bootstrapSamples * value.familyAlpha) / value.comparisonCount / 2 <
      25
    )
      rrsiFail("simulation has insufficient bootstrap tail resolution");
  } else if (value.bootstrapSamples !== null)
    rrsiFail("Hoeffding-only simulation must not claim bootstrap samples");
  if (
    !Array.isArray(value.clusterCounts) ||
    value.clusterCounts.length < 1 ||
    value.clusterCounts.length > 6
  )
    rrsiFail("simulation cluster counts must be a bounded nonempty grid");
  value.clusterCounts.forEach((count) =>
    rrsiInteger(count, "simulation cluster count", 20, 4000),
  );
  if (new Set(value.clusterCounts).size !== value.clusterCounts.length)
    rrsiFail("simulation sample grid has duplicate counts");
  const operations =
    value.trialCount *
    value.comparisonCount *
    LAWS.length *
    2 *
    value.clusterCounts.reduce((sum, count) => sum + count, 0) *
    (fullMethod ? value.bootstrapSamples : 1);
  // Full-method simulations use the direct production primitive, not a surrogate.
  const operationLimit = fullMethod ? 500_000_000 : 50_000_000;
  if (operations > operationLimit)
    rrsiFail(
      "Monte Carlo simulation exceeds frozen operation bound",
      "CC_RRSI_BUDGET_EXCEEDED",
    );
  return rrsiEnvelope(
    RRSI_STATISTICS_SIMULATION_PLAN_SCHEMA,
    "simulationPlanDigest",
    {
      ...value,
      clusterCounts: [...value.clusterCounts].sort((a, b) => a - b),
      laws: LAWS,
      weightProfiles: ["equal-task-counts", "one-dominant-component"],
      operations,
      operationLimit,
      bootstrapAlgorithm: fullMethod
        ? "direct-uniform-cluster-picks-xorshift32/v1"
        : null,
      monteCarloIntervalMethod: "wilson-score-95/v1",
      simultaneousMonteCarloMethod: "bonferroni-hoeffding-all-grid-rates-95/v1",
      simultaneousRateCount: value.clusterCounts.length * LAWS.length * 2 * 4,
      contrastJointLaw:
        "independent-synthetic-contrast-deltas-not-three-arm-outcomes",
      hypothesisScope: "one-synthetic-pool-and-variant-per-family",
      bootstrapIndexCoupling: "same-stream-for-contrasts-within-each-trial",
      stoppingRule: "run-every-preregistered-scenario-no-interim-selection",
    },
  );
}

function verifyPlan(input) {
  const value = snapshotRrsiData(input);
  const rebuilt = buildRrsiStatisticsSimulationPlan(
    Object.fromEntries(KEYS.map((key) => [key, value[key]])),
  );
  if (rrsiCanonical(value) !== rrsiCanonical(rebuilt))
    rrsiFail("simulation plan differs from frozen scenarios");
  return rebuilt;
}

function random(digest) {
  let state = Number.parseInt(digest.slice(7, 15), 16) || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function rate(successes, trials, rateCount) {
  const value = successes / trials,
    z = 1.959963984540054;
  const denominator = 1 + (z * z) / trials;
  const center = (value + (z * z) / (2 * trials)) / denominator;
  const margin =
    (z *
      Math.sqrt(
        (value * (1 - value)) / trials + (z * z) / (4 * trials * trials),
      )) /
    denominator;
  const simultaneousMargin = Math.sqrt(
    Math.log((2 * rateCount) / 0.05) / (2 * trials),
  );
  return {
    successes,
    trials,
    estimate: value,
    monteCarlo95: {
      lower: Math.max(0, center - margin),
      upper: Math.min(1, center + margin),
    },
    simultaneousGrid95: {
      lower: Math.max(0, value - simultaneousMargin),
      upper: Math.min(1, value + simultaneousMargin),
    },
  };
}

export function runRrsiStatisticsSimulation(input) {
  const plan = verifyPlan(input);
  const scenarios = [];
  for (const groupCount of plan.clusterCounts)
    for (const weightProfile of plan.weightProfiles)
      for (const law of plan.laws) {
        const taskCounts = Array(groupCount).fill(1);
        if (weightProfile === "one-dominant-component") taskCounts[0] = 100;
        const generator = random(
          rrsiHash("chainlesschain.rrsi-simulation-random/v1", {
            seed: plan.randomnessSeedDigest,
            groupCount,
            weightProfile,
            law: law.id,
          }),
        );
        let coverage = 0,
          power = 0,
          unsupportedPositive = 0,
          degenerateMiss = 0;
        let effectiveGroupCount = null;
        for (let trial = 0; trial < plan.trialCount; trial++) {
          let familyCovered = true,
            allAboveThreshold = true,
            anyUnsupportedPositive = false,
            anyDegenerateMiss = false;
          for (
            let comparison = 0;
            comparison < plan.comparisonCount;
            comparison++
          ) {
            const values = taskCounts.map(() =>
              generator() < law.positiveProbability
                ? law.positive
                : law.negative,
            );
            const intervalInput = {
              values,
              taskCounts,
              alpha: plan.familyAlpha / plan.comparisonCount,
            };
            const fullMethod =
              plan.intervalMethod === RRSI_CLUSTER_ENVELOPE_METHOD;
            const result = fullMethod
              ? computeRrsiClusterEnvelopeInterval({
                  ...intervalInput,
                  bootstrapSamples: plan.bootstrapSamples,
                  randomnessSeedDigest: rrsiHash(
                    "chainlesschain.rrsi-simulation-bootstrap/v1",
                    {
                      seed: plan.randomnessSeedDigest,
                      groupCount,
                      weightProfile,
                      law: law.id,
                      trial,
                    },
                  ),
                })
              : computeRrsiBoundedClusterInterval(intervalInput);
            const interval = fullMethod ? result.confidenceInterval : result;
            effectiveGroupCount = fullMethod
              ? result.boundedInterval.effectiveGroupCount
              : result.effectiveGroupCount;
            familyCovered &&=
              interval.lower <= law.mean + 1e-12 &&
              interval.upper >= law.mean - 1e-12;
            allAboveThreshold &&= interval.lower >= plan.qualityThreshold;
            anyUnsupportedPositive ||= law.mean <= 0 && interval.lower > 0;
            anyDegenerateMiss ||=
              values.every((value) => value === values[0]) &&
              Math.abs(values[0] - law.mean) > 1e-12;
          }
          if (familyCovered) coverage++;
          if (allAboveThreshold) power++;
          if (anyUnsupportedPositive) unsupportedPositive++;
          if (anyDegenerateMiss) degenerateMiss++;
        }
        scenarios.push({
          groupCount,
          weightProfile,
          distribution: law.id,
          trueDelta: law.mean,
          effectiveGroupCount,
          taskCount: taskCounts.reduce((sum, count) => sum + count, 0),
          familyCoverage: rate(
            coverage,
            plan.trialCount,
            plan.simultaneousRateCount,
          ),
          familyThresholdPower: rate(
            power,
            plan.trialCount,
            plan.simultaneousRateCount,
          ),
          unsupportedPositiveFamilyRate: rate(
            unsupportedPositive,
            plan.trialCount,
            plan.simultaneousRateCount,
          ),
          zeroSpreadDiagnosticMissRate: rate(
            degenerateMiss,
            plan.trialCount,
            plan.simultaneousRateCount,
          ),
        });
      }
  const powerEstimates = plan.laws
    .filter((law) => law.mean > plan.qualityThreshold)
    .flatMap((law) =>
      plan.weightProfiles.map((profile) => {
        const eligible = scenarios.filter(
          (row) =>
            row.distribution === law.id &&
            row.weightProfile === profile &&
            row.familyThresholdPower.simultaneousGrid95.lower >=
              plan.targetPower,
        );
        return {
          distribution: law.id,
          weightProfile: profile,
          minimumGridGroupCountMeetingPower: eligible[0]?.groupCount ?? null,
        };
      }),
    );
  const coverageCheckedOnGrid = scenarios.every(
    (row) =>
      row.familyCoverage.simultaneousGrid95.lower >= 1 - plan.familyAlpha,
  );
  return rrsiEnvelope(
    RRSI_STATISTICS_SIMULATION_REPORT_SCHEMA,
    "simulationReportDigest",
    {
      simulationPlanDigest: plan.simulationPlanDigest,
      scope: "preregistered-synthetic-independent-cluster-grid-only",
      intervalMethod: plan.intervalMethod,
      fullAnalysisMethodSimulated:
        plan.intervalMethod === RRSI_CLUSTER_ENVELOPE_METHOD,
      hoeffdingOnlyPowerCannotSelectFullMethodSampleSize:
        plan.intervalMethod === RRSI_BOUNDED_CLUSTER_METHOD,
      familyAlpha: plan.familyAlpha,
      comparisonCount: plan.comparisonCount,
      trialCountPerScenario: plan.trialCount,
      status: coverageCheckedOnGrid ? "synthetic-grid-supported" : "hold",
      scenarios,
      powerEstimates,
      coverageCheckedOnGrid,
      monteCarloIntervalsAreApproximate: true,
      pointwiseWilsonIntervalsAreNotSimultaneous: true,
      sampleGridSelectionUsesSimultaneousBounds: true,
      simultaneousBoundsConditionalOnIndependentMonteCarloTrials: true,
      syntheticRngIsNotProductionEvidence: true,
      threeArmExperimentPowerValidated: false,
      mathematicalGuaranteeConditionalOnIndependentBoundedClusters: true,
      productionCoverageValidated: false,
      productionPowerValidated: false,
      sourceIndependenceVerified: false,
      statisticalProtocolValidated: false,
    },
  );
}
