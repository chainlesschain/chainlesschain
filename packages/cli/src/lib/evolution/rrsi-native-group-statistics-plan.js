/** Pure native statistical plans. Structural declarations never prove preregistration. */
import { isProxy } from "node:util/types";
import { verifyRrsiCampaign } from "./rrsi-contracts.js";
import { normalizeRrsiNativeEvaluationBatch } from "./rrsi-native-evaluation-batch.js";
import { buildRrsiGroupStatisticsPlan } from "./rrsi-group-statistics.js";
import {
  snapshotRrsiData,
  rrsiCanonical,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_GROUP_STATISTICS_PLAN_SCHEMA =
  "chainlesschain.rrsi-native-group-statistics-plan/v2";
const MAX_RESAMPLE_OPERATIONS = 50_000_000;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function fields(input, names, label) {
  if (
    !input ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== names.length
  )
    rrsiFail(`${label} requires plain own fields`);
  return Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        rrsiFail(`${label} cannot use accessors`);
      return [name, field.value];
    }),
  );
}

/** Build before reservation; this structural plan does not prove preregistration. */
export function buildRrsiNativeGroupStatisticsPlan(input) {
  const options = fields(
    input,
    ["campaign", "batch"],
    "native statistics plan",
  );
  const campaign = verifyRrsiCampaign(options.campaign);
  const batch = normalizeRrsiNativeEvaluationBatch(options.batch, campaign);
  if (campaign.experiment.bootstrapSamples > 1_000_000)
    rrsiFail("native statistical protocol exceeds the interval kernel bound");
  const base = buildRrsiGroupStatisticsPlan({
    campaign,
    stage: batch.stage,
    versions: batch.versions,
  });
  // Reuse the original source components and weights. Targets and replicas
  // enlarge the frozen observation family, never the independent population.
  const targets = batch.targetIdentity
    .map(([slotId, runtimeId, targetEnvironmentRef, environmentDigest]) => ({
      slotId,
      runtimeId,
      targetEnvironmentRef,
      environmentDigest,
    }))
    .sort((a, b) => compare(a.slotId, b.slotId));
  const hypothesisCount = base.hypothesisCount * targets.length;
  const alphaPerHypothesis = base.familyAlpha / hypothesisCount;
  const tailReplicates = (base.bootstrapSamples * alphaPerHypothesis) / 2;
  const resampleOperations = base.resampleOperations * targets.length;
  if (resampleOperations > MAX_RESAMPLE_OPERATIONS)
    rrsiFail(
      "complete native statistical family exceeds resampling operation limit",
      "CC_RRSI_BUDGET_EXCEEDED",
    );
  const plan = rrsiEnvelope(
    RRSI_NATIVE_GROUP_STATISTICS_PLAN_SCHEMA,
    "statisticsPlanDigest",
    {
      campaignDigest: campaign.campaignDigest,
      batchDigest: batch.batchDigest,
      nativeEvaluationPlanDigest: batch.nativeEvaluationPlanDigest,
      parentReleaseDigest: campaign.parentReleaseDigest,
      stage: batch.stage,
      versions: batch.versions,
      lifecycleDigests: batch.lifecycleDigests,
      targetMatrixRoot: batch.parentIdentity.targetMatrixRoot,
      seeds: base.seeds,
      variants: base.variants,
      comparisons: base.comparisons,
      pools: base.pools,
      targets,
      fixedPairReplicasPerTaskSeedArm: 2,
      aggregationMethod:
        "mean-fixed-pair-replicas-then-seeds-then-task-weighted-source-components/v2",
      successDefinition:
        "reported-pass-and-zero-security-and-permission-violations/v2",
      manualRemediationMeasured: false,
      familyAlpha: base.familyAlpha,
      hypothesisCount,
      alphaPerHypothesis,
      bootstrapSamples: base.bootstrapSamples,
      bootstrapTailReplicates: tailReplicates,
      bootstrapTailResolutionSufficient: tailReplicates >= 25,
      randomnessCommitment: base.randomnessCommitment,
      resamplingUnit: base.resamplingUnit,
      bootstrapMethod: base.bootstrapMethod,
      boundedMethod: base.boundedMethod,
      minimumIndependentGroups: base.minimumIndependentGroups,
      stoppingRule: base.stoppingRule,
      resampleOperations,
      preObservationRegistrationVerified: false,
      sourceIndependenceVerified: false,
      perturbationSemanticsVerified: false,
    },
  );
  snapshotRrsiData(plan);
  return plan;
}

export function verifyRrsiNativeGroupStatisticsPlan(plan, context) {
  const rebuilt = buildRrsiNativeGroupStatisticsPlan(context);
  if (rrsiCanonical(snapshotRrsiData(plan)) !== rrsiCanonical(rebuilt))
    rrsiFail("native statistics plan or frozen protocol differs");
  return rebuilt;
}
