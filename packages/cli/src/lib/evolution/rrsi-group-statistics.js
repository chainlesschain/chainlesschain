/** Versioned descriptive statistics. Conditional bounds are not admission. */
import { verifyRrsiCampaign, RRSI_GROUP_DIMENSIONS } from "./rrsi-contracts.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiDigest,
  rrsiInteger,
  rrsiFinite,
  rrsiBoolean,
  rrsiId,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  freezeRrsiData,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_GROUP_STATISTICS_PLAN_SCHEMA =
  "chainlesschain.rrsi-group-statistics-plan/v1";
export const RRSI_GROUP_STATISTICS_REPORT_SCHEMA =
  "chainlesschain.rrsi-group-statistics-report/v1";
export const RRSI_BOUNDED_CLUSTER_METHOD =
  "weighted-independent-bounded-clusters-hoeffding-two-sided/v1";
export const RRSI_CLUSTER_ENVELOPE_METHOD =
  "outer-envelope-of-cluster-bootstrap-and-conditional-bounded-interval/v1";
const STAGES = {
  training: ["train"],
  selection: ["select"],
  generalization: ["gate-validation", "gate-test", "audit"],
};
const MAX_RESAMPLE_OPERATIONS = 50_000_000;
const OUTCOMES = ["succeeded", "failed", "cancelled", "not-started", "unknown"];

function components(campaign, partition) {
  const tasks = campaign.dataset.tasks.filter(
    (task) => task.partition === partition,
  );
  const parents = tasks.map((_, index) => index);
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const owners = new Map();
  tasks.forEach((task, index) => {
    for (const dimension of RRSI_GROUP_DIMENSIONS) {
      const key = `${dimension}:${task.groups[dimension]}`;
      if (owners.has(key)) parents[find(index)] = find(owners.get(key));
      else owners.set(key, index);
    }
  });
  const grouped = new Map();
  tasks.forEach((task, index) => {
    const root = find(index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(task);
  });
  return [...grouped.values()]
    .map((members) => {
      const ordered = members.sort((left, right) =>
        left.contentDigest < right.contentDigest ? -1 : 1,
      );
      return {
        componentDigest: rrsiHash(
          "chainlesschain.rrsi-statistical-component/v1",
          {
            partition,
            sources: ordered.map((task) => ({
              contentDigest: task.contentDigest,
              groups: task.groups,
            })),
          },
        ),
        taskIds: ordered.map((task) => task.id),
        taskCount: ordered.length,
        weight: ordered.length / tasks.length,
      };
    })
    .sort((left, right) =>
      left.componentDigest < right.componentDigest ? -1 : 1,
    );
}

/** Weights, hypotheses and population all derive before observing outcomes. */
export function buildRrsiGroupStatisticsPlan(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    ["campaign", "stage", "versions"],
    "group statistics plan input",
  );
  const campaign = verifyRrsiCampaign(value.campaign);
  if (!Object.hasOwn(STAGES, value.stage)) rrsiFail("unknown statistics stage");
  rrsiExact(
    value.versions,
    campaign.experiment.arms,
    "frozen statistical arm artifacts",
  );
  for (const arm of campaign.experiment.arms)
    rrsiDigest(value.versions[arm], `${arm} artifact digest`);
  const partitions = STAGES[value.stage];
  const variants =
    value.stage === "training"
      ? ["clean"]
      : ["clean", ...campaign.experiment.perturbations];
  if (campaign.experiment.perturbations.includes("clean"))
    rrsiFail("clean is a reserved statistical variant");
  const comparisons = campaign.experiment.comparisons.map((id) => {
    const pair = id.split("-vs-");
    if (
      pair.length !== 2 ||
      pair[0] === pair[1] ||
      pair.some((arm) => !campaign.experiment.arms.includes(arm))
    )
      rrsiFail("statistics comparison has no declared arm interpretation");
    return { id, leftArm: pair[0], rightArm: pair[1] };
  });
  const pools = partitions.map((partition) => ({
    partition,
    partitionDigest: campaign.dataset.pools[partition].partitionDigest,
    taskCount: campaign.dataset.pools[partition].taskCount,
    components: components(campaign, partition),
  }));
  const hypothesisCount =
    comparisons.length * partitions.length * variants.length;
  const alphaPerHypothesis = campaign.experiment.familyAlpha / hypothesisCount;
  const tailReplicates =
    (campaign.experiment.bootstrapSamples * alphaPerHypothesis) / 2;
  const resampleOperations =
    pools.reduce((sum, pool) => sum + pool.components.length, 0) *
    variants.length *
    comparisons.length *
    campaign.experiment.bootstrapSamples;
  if (resampleOperations > MAX_RESAMPLE_OPERATIONS)
    rrsiFail(
      "frozen statistical resampling exceeds operation limit",
      "CC_RRSI_BUDGET_EXCEEDED",
    );
  return rrsiEnvelope(
    RRSI_GROUP_STATISTICS_PLAN_SCHEMA,
    "statisticsPlanDigest",
    {
      campaignDigest: campaign.campaignDigest,
      parentReleaseDigest: campaign.parentReleaseDigest,
      stage: value.stage,
      versions: value.versions,
      seeds: campaign.experiment.seeds,
      variants,
      comparisons,
      pools,
      familyAlpha: campaign.experiment.familyAlpha,
      hypothesisCount,
      alphaPerHypothesis,
      bootstrapSamples: campaign.experiment.bootstrapSamples,
      bootstrapTailReplicates: tailReplicates,
      bootstrapTailResolutionSufficient: tailReplicates >= 25,
      randomnessCommitment: campaign.experiment.randomnessCommitment,
      resamplingUnit: "task-group-component",
      bootstrapMethod: "task-weighted-cluster-percentile/v1",
      boundedMethod: RRSI_BOUNDED_CLUSTER_METHOD,
      minimumIndependentGroups: campaign.policy.thresholds.minIndependentGroups,
      stoppingRule: "fixed-full-denominator-no-interim-acceptance",
      resampleOperations,
      sourceIndependenceVerified: false,
      perturbationSemanticsVerified: false,
    },
  );
}

export function verifyRrsiGroupStatisticsPlan(plan, context) {
  const rebuilt = buildRrsiGroupStatisticsPlan(context);
  if (rrsiCanonical(snapshotRrsiData(plan)) !== rrsiCanonical(rebuilt))
    rrsiFail("group statistics plan or frozen protocol differs");
  return rebuilt;
}

function boundedInterval(values, counts, alpha) {
  const count = counts.reduce((sum, value) => sum + value, 0);
  const weights = counts.map((value) => value / count);
  const squaredWeightSum = weights.reduce(
    (sum, value) => sum + value * value,
    0,
  );
  const mean = Math.max(
    -1,
    Math.min(
      1,
      values.reduce((sum, value, index) => sum + value * counts[index], 0) /
        count,
    ),
  );
  const halfWidth = Math.sqrt(2 * squaredWeightSum * Math.log(2 / alpha));
  return {
    mean,
    lower: Math.max(-1, mean - halfWidth),
    upper: Math.min(1, mean + halfWidth),
    halfWidth,
    effectiveGroupCount: 1 / squaredWeightSum,
  };
}

/** Mathematical primitive only; caller must preregister weights and prove independence. */
export function computeRrsiBoundedClusterInterval(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    ["values", "taskCounts", "alpha"],
    "conditional cluster interval",
  );
  if (
    !Array.isArray(value.values) ||
    value.values.length < 1 ||
    !Array.isArray(value.taskCounts) ||
    value.values.length !== value.taskCounts.length
  )
    rrsiFail("cluster values and frozen task counts differ");
  value.values.forEach((entry) => rrsiFinite(entry, "cluster delta", -1, 1));
  value.taskCounts.forEach((entry) =>
    rrsiInteger(entry, "cluster task count", 1, 5000),
  );
  if (value.taskCounts.reduce((sum, entry) => sum + entry, 0) > 5000)
    rrsiFail("cluster population exceeds task bound");
  rrsiFinite(value.alpha, "cluster alpha", 0.00000001, 0.05);
  return freezeRrsiData({
    method: RRSI_BOUNDED_CLUSTER_METHOD,
    ...boundedInterval(value.values, value.taskCounts, value.alpha),
    conditionalOnIndependentBoundedClusters: true,
    independenceVerified: false,
    qualifiesForPromotion: false,
  });
}

function randomFromDigest(digest) {
  let state = Number.parseInt(digest.slice(7, 15), 16) || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function quantile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index),
    upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function clusterEnvelope(values, counts, alpha, bootstrapSamples, seedDigest) {
  const random = randomFromDigest(seedDigest);
  const totals = values.map((value, index) => value * counts[index]);
  const samples = new Array(bootstrapSamples);
  for (let sample = 0; sample < samples.length; sample++) {
    let sum = 0,
      count = 0;
    for (let pick = 0; pick < values.length; pick++) {
      const index = Math.floor(random() * values.length);
      sum += totals[index];
      count += counts[index];
    }
    samples[sample] = sum / count;
  }
  samples.sort((left, right) => left - right);
  const bootstrapInterval = {
    lower: quantile(samples, alpha / 2),
    upper: quantile(samples, 1 - alpha / 2),
  };
  const bounded = boundedInterval(values, counts, alpha);
  return {
    bootstrapInterval,
    boundedInterval: bounded,
    confidenceInterval: {
      mean: bounded.mean,
      lower: Math.min(bounded.lower, bootstrapInterval.lower),
      upper: Math.max(bounded.upper, bootstrapInterval.upper),
    },
  };
}

/** The same direct resampling method used by analysis and synthetic simulation. */
export function computeRrsiClusterEnvelopeInterval(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(
    value,
    [
      "values",
      "taskCounts",
      "alpha",
      "bootstrapSamples",
      "randomnessSeedDigest",
    ],
    "cluster outer envelope",
  );
  computeRrsiBoundedClusterInterval({
    values: value.values,
    taskCounts: value.taskCounts,
    alpha: value.alpha,
  });
  rrsiInteger(value.bootstrapSamples, "bootstrap samples", 1000, 1_000_000);
  rrsiDigest(value.randomnessSeedDigest, "bootstrap seed");
  if ((value.bootstrapSamples * value.alpha) / 2 < 25)
    rrsiFail("insufficient bootstrap tail resolution");
  if (value.values.length * value.bootstrapSamples > MAX_RESAMPLE_OPERATIONS)
    rrsiFail(
      "cluster bootstrap exceeds operation limit",
      "CC_RRSI_BUDGET_EXCEEDED",
    );
  return freezeRrsiData({
    method: RRSI_CLUSTER_ENVELOPE_METHOD,
    ...clusterEnvelope(
      value.values,
      value.taskCounts,
      value.alpha,
      value.bootstrapSamples,
      value.randomnessSeedDigest,
    ),
    independenceVerified: false,
    qualifiesForPromotion: false,
  });
}

function slotKey(taskId, seed, arm, variant) {
  return JSON.stringify([taskId, seed, arm, variant]);
}

/** Input rows are descriptive claims until an independent adapter authenticates them. */
export function analyzeRrsiGroupStatistics(input) {
  const value = snapshotRrsiData(input);
  rrsiExact(value, ["campaign", "plan", "rows"], "group statistics analysis");
  const plan = verifyRrsiGroupStatisticsPlan(value.plan, {
    campaign: value.campaign,
    stage: value.plan.stage,
    versions: value.plan.versions,
  });
  if (!Array.isArray(value.rows))
    rrsiFail("statistical rows must be a bounded list");
  const tasks = new Map(
    plan.pools.flatMap((pool) =>
      pool.components.flatMap((group) =>
        group.taskIds.map((id) => [id, pool.partition]),
      ),
    ),
  );
  const rows = new Map(),
    receiptOwners = new Map();
  for (const row of value.rows) {
    rrsiExact(
      row,
      [
        "taskId",
        "seed",
        "arm",
        "versionDigest",
        "variant",
        "outcome",
        "passed",
        "manualRemediation",
        "resultDigest",
      ],
      "statistical slot row",
    );
    rrsiId(row.taskId, "statistical task ID");
    rrsiInteger(row.seed, "statistical seed");
    if (
      !tasks.has(row.taskId) ||
      !plan.seeds.includes(row.seed) ||
      !Object.hasOwn(plan.versions, row.arm) ||
      !plan.variants.includes(row.variant) ||
      row.versionDigest !== plan.versions[row.arm]
    )
      rrsiFail(
        "statistical row differs from frozen task, seed, variant or version",
      );
    if (!OUTCOMES.includes(row.outcome))
      rrsiFail("unknown statistical outcome");
    if (row.passed !== null) rrsiBoolean(row.passed, "statistical success");
    rrsiBoolean(row.manualRemediation, "manual remediation");
    if (row.outcome !== "succeeded" && row.passed === true)
      rrsiFail("non-successful slot cannot report success");
    const key = slotKey(row.taskId, row.seed, row.arm, row.variant);
    if (rows.has(key)) rrsiFail("duplicate statistical slot");
    if (row.resultDigest !== null) {
      rrsiDigest(row.resultDigest, "result evidence digest");
      if (receiptOwners.has(row.resultDigest))
        rrsiFail("one result receipt cannot pay multiple statistical slots");
      receiptOwners.set(row.resultDigest, key);
    }
    rows.set(key, row);
  }
  function summary(pool, arm, variant) {
    let terminal = 0,
      passed = 0,
      manual = 0,
      missing = 0;
    const taskScores = new Map();
    for (const group of pool.components)
      for (const id of group.taskIds) {
        let taskPasses = 0;
        for (const seed of plan.seeds) {
          const row = rows.get(slotKey(id, seed, arm, variant));
          const complete =
            row &&
            row.resultDigest !== null &&
            row.outcome !== "unknown" &&
            (row.outcome !== "succeeded" || row.passed !== null);
          if (!complete) {
            missing++;
            continue;
          }
          terminal++;
          if (row.manualRemediation) manual++;
          if (
            row.outcome === "succeeded" &&
            row.passed &&
            !row.manualRemediation
          ) {
            passed++;
            taskPasses++;
          }
        }
        taskScores.set(id, taskPasses / plan.seeds.length);
      }
    return {
      plannedSlots: pool.taskCount * plan.seeds.length,
      declaredTerminalSlots: terminal,
      strictSuccessSlots: passed,
      manualRemediationSlots: manual,
      missingSlots: missing,
      strictCompletionRate: passed / (pool.taskCount * plan.seeds.length),
      taskScores,
    };
  }
  const analyses = [];
  for (const pool of plan.pools)
    for (const variant of plan.variants) {
      const summaries = new Map(
        Object.keys(plan.versions).map((arm) => [
          arm,
          summary(pool, arm, variant),
        ]),
      );
      for (const comparison of plan.comparisons) {
        const left = summaries.get(comparison.leftArm),
          right = summaries.get(comparison.rightArm);
        const reasons = [];
        if (left.missingSlots || right.missingSlots)
          reasons.push("INSUFFICIENT_EVIDENCE");
        if (pool.components.length < plan.minimumIndependentGroups)
          reasons.push("INSUFFICIENT_INDEPENDENT_GROUPS");
        if (!plan.bootstrapTailResolutionSufficient)
          reasons.push("INSUFFICIENT_BOOTSTRAP_TAIL_RESOLUTION");
        let bootstrapInterval = null,
          bounded = null,
          confidenceInterval = null;
        if (!reasons.length) {
          const totals = pool.components.map((group) =>
            group.taskIds.reduce(
              (sum, id) =>
                sum + left.taskScores.get(id) - right.taskScores.get(id),
              0,
            ),
          );
          const interval = clusterEnvelope(
            totals.map((sum, index) => sum / pool.components[index].taskCount),
            pool.components.map((group) => group.taskCount),
            plan.alphaPerHypothesis,
            plan.bootstrapSamples,
            // Repeat count, caller ordering and task IDs cannot change the RNG.
            rrsiHash("chainlesschain.rrsi-cluster-bootstrap-random/v1", {
              randomnessCommitment: plan.randomnessCommitment,
              partition: pool.partition,
              components: pool.components.map((group) => ({
                componentDigest: group.componentDigest,
                taskCount: group.taskCount,
              })),
            }),
          );
          bootstrapInterval = interval.bootstrapInterval;
          bounded = interval.boundedInterval;
          confidenceInterval = interval.confidenceInterval;
        }
        const publicSummary = (entry) =>
          Object.fromEntries(
            Object.entries(entry).filter(([key]) => key !== "taskScores"),
          );
        analyses.push({
          partition: pool.partition,
          variant,
          comparisonId: comparison.id,
          leftArm: comparison.leftArm,
          rightArm: comparison.rightArm,
          plannedTaskCount: pool.taskCount,
          independentDeclaredGroupCount: pool.components.length,
          alpha: plan.alphaPerHypothesis,
          left: publicSummary(left),
          right: publicSummary(right),
          conservativeDifference: {
            lower:
              (left.strictSuccessSlots -
                right.strictSuccessSlots -
                right.missingSlots) /
              left.plannedSlots,
            upper:
              (left.strictSuccessSlots +
                left.missingSlots -
                right.strictSuccessSlots) /
              left.plannedSlots,
          },
          bootstrapInterval,
          boundedInterval: bounded,
          confidenceInterval,
          status: reasons.length ? "hold" : "descriptive-complete",
          reasons,
        });
      }
    }
  return rrsiEnvelope(
    RRSI_GROUP_STATISTICS_REPORT_SCHEMA,
    "statisticsReportDigest",
    {
      statisticsPlanDigest: plan.statisticsPlanDigest,
      campaignDigest: plan.campaignDigest,
      rowSetDigest: rrsiHash(
        "chainlesschain.rrsi-statistical-slot-claims/v1",
        [...rows.values()].sort((a, b) =>
          slotKey(a.taskId, a.seed, a.arm, a.variant) <
          slotKey(b.taskId, b.seed, b.arm, b.variant)
            ? -1
            : 1,
        ),
      ),
      stage: plan.stage,
      familyAlpha: plan.familyAlpha,
      hypothesisCount: plan.hypothesisCount,
      status: analyses.some((entry) => entry.status === "hold")
        ? "hold"
        : "descriptive-complete",
      analyses,
      intervalMethod: RRSI_CLUSTER_ENVELOPE_METHOD,
      coverageGuaranteeSource: RRSI_BOUNDED_CLUSTER_METHOD,
      conditionalOnIndependentBoundedClusters: true,
      sourceIndependenceVerified: false,
      resultAuthenticityVerified: false,
      costEvidenceVerified: false,
      statisticalProtocolValidated: false,
      qualityVerdictVerified: false,
    },
  );
}
