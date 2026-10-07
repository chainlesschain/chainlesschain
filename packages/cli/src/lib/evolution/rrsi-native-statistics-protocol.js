/** Candidate-independent statistical scope. History must authenticate its registration. */
import { isProxy } from "node:util/types";
import { verifyRrsiCampaign } from "./rrsi-contracts.js";
import {
  verifySkillDependencyLock,
  verifySkillRuntimeManifest,
  verifySkillTargetMatrix,
} from "./skill-execution-manifest.js";
import {
  buildRrsiGroupStatisticsSourceComponents,
  RRSI_BOUNDED_CLUSTER_METHOD,
  RRSI_CLUSTER_ENVELOPE_METHOD,
} from "./rrsi-group-statistics.js";
import { normalizeRrsiNativeEvaluationBatch } from "./rrsi-native-evaluation-batch.js";
import { buildRrsiNativeGroupStatisticsPlan } from "./rrsi-native-group-statistics-plan.js";
import {
  snapshotRrsiData,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  freezeRrsiData,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_STATISTICS_SCOPE_PROTOCOL_SCHEMA =
  "chainlesschain.rrsi-native-statistics-scope-protocol/v1";
const MAX_BOOTSTRAP_SAMPLES = 1_000_000;
const MAX_RESAMPLE_OPERATIONS = 50_000_000;
const STAGES = {
  training: ["train"],
  selection: ["select"],
  generalization: ["gate-validation", "gate-test", "audit"],
};
const COMPARISONS = new Set([
  "rrsi-vs-rsi",
  "rrsi-vs-baseline",
  "rsi-vs-baseline",
]);
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

function verifiedExecutionContract(input, campaign) {
  const execution = fields(
    input,
    ["dependencyLock", "runtimeManifest", "targetMatrix"],
    "native statistics execution contract",
  );
  // Original manifest validators accept their own null-prototype records and
  // copy descriptors without executing caller accessors or Proxy traps.
  const dependencyLock = verifySkillDependencyLock(execution.dependencyLock);
  const runtimeManifest = verifySkillRuntimeManifest(execution.runtimeManifest);
  if (
    !execution.targetMatrix ||
    typeof execution.targetMatrix !== "object" ||
    isProxy(execution.targetMatrix)
  )
    rrsiFail("native statistics target matrix requires own data fields");
  const root = Object.getOwnPropertyDescriptor(
    execution.targetMatrix,
    "targetMatrixRoot",
  );
  const cells = Object.getOwnPropertyDescriptor(
    execution.targetMatrix,
    "cells",
  );
  if (!root || !("value" in root) || !cells || !("value" in cells))
    rrsiFail("native statistics target matrix cannot use accessors");
  const targetMatrix = verifySkillTargetMatrix(execution.targetMatrix, {
    dependencyLock,
    runtimeManifest,
    expectedTargetMatrixRoot: root.value,
    expectedEnvironmentBindings: cells.value,
  });
  if (targetMatrix.tenantId !== campaign.tenantId)
    rrsiFail("native statistics execution contract belongs to another tenant");
  return { dependencyLock, runtimeManifest, targetMatrix };
}

function executionProjection(input, campaign) {
  const { dependencyLock, runtimeManifest, targetMatrix } =
    verifiedExecutionContract(input, campaign);
  return {
    dependencyLockDigest: dependencyLock.dependencyLockDigest,
    runtimeManifestDigest: runtimeManifest.runtimeManifestDigest,
    targetMatrixRoot: targetMatrix.targetMatrixRoot,
    targets: targetMatrix.cells
      .map((cell) => ({
        slotId: cell.cellId,
        runtimeId: cell.runtimeId,
        targetEnvironmentRef: cell.targetEnvironmentRef,
        environmentDigest: cell.environmentDigest,
      }))
      .sort((a, b) => compare(a.slotId, b.slotId)),
  };
}

/** Convert only independent validator outputs, never stringify caller objects. */
export function normalizeRrsiNativeStatisticsExecutionContract(input) {
  const options = fields(
    input,
    ["campaign", "execution"],
    "statistics execution normalization",
  );
  const campaign = verifyRrsiCampaign(options.campaign);
  const verified = verifiedExecutionContract(options.execution, campaign);
  return freezeRrsiData(snapshotRrsiData(JSON.parse(JSON.stringify(verified))));
}

function stageDesign(campaign, stage, partitions, targetCount) {
  const variants =
    stage === "training"
      ? ["clean"]
      : ["clean", ...campaign.experiment.perturbations];
  const comparisons = campaign.experiment.comparisons.map((id) => {
    const [leftArm, rightArm] = id.split("-vs-");
    return { id, leftArm, rightArm };
  });
  const pools = partitions.map((partition) => ({
    partition,
    partitionDigest: campaign.dataset.pools[partition].partitionDigest,
    taskCount: campaign.dataset.pools[partition].taskCount,
    components: buildRrsiGroupStatisticsSourceComponents(campaign, partition),
  }));
  const hypothesisCount =
    comparisons.length * partitions.length * variants.length * targetCount;
  const alphaPerHypothesis = campaign.experiment.familyAlpha / hypothesisCount;
  const tailReplicates =
    (campaign.experiment.bootstrapSamples * alphaPerHypothesis) / 2;
  const resampleOperations =
    pools.reduce((sum, pool) => sum + pool.components.length, 0) *
    variants.length *
    comparisons.length *
    campaign.experiment.bootstrapSamples *
    targetCount;
  if (resampleOperations > MAX_RESAMPLE_OPERATIONS)
    rrsiFail(
      `complete native statistics ${stage} family exceeds resampling operation limit`,
      "CC_RRSI_BUDGET_EXCEEDED",
    );
  return {
    stage,
    seeds: campaign.experiment.seeds,
    variants,
    comparisons,
    pools,
    familyDefinition:
      "comparisons-times-partitions-times-variants-times-targets/v1",
    familyAlpha: campaign.experiment.familyAlpha,
    hypothesisCount,
    alphaPerHypothesis,
    bootstrapSamples: campaign.experiment.bootstrapSamples,
    bootstrapTailReplicates: tailReplicates,
    bootstrapTailResolutionSufficient: tailReplicates >= 25,
    resampleOperations,
    decision: "HOLD",
    blockingReasons:
      tailReplicates >= 25 ? [] : ["INSUFFICIENT_BOOTSTRAP_TAIL_RESOLUTION"],
  };
}

function scopeProtocol(campaign, execution) {
  if (campaign.candidateKind !== "skill")
    rrsiFail("native statistics scope requires a Skill campaign");
  if (campaign.experiment.bootstrapSamples > MAX_BOOTSTRAP_SAMPLES)
    rrsiFail("native statistical protocol exceeds the interval kernel bound");
  if (
    campaign.experiment.perturbations.includes("clean") ||
    campaign.experiment.comparisons.some((id) => !COMPARISONS.has(id))
  )
    rrsiFail(
      "native statistics scope has an unsupported variant or comparison",
    );
  if (
    execution.targets.some(
      (target) =>
        target.environmentDigest !== campaign.execution.environmentDigest,
    )
  )
    rrsiFail("native statistics target environment differs from campaign");
  const stages = Object.fromEntries(
    Object.entries(STAGES).map(([stage, partitions]) => [
      stage,
      stageDesign(campaign, stage, partitions, execution.targets.length),
    ]),
  );
  const protocol = rrsiEnvelope(
    RRSI_NATIVE_STATISTICS_SCOPE_PROTOCOL_SCHEMA,
    "protocolDigest",
    {
      // Campaign aliases and per-query candidate/native plan identities do not
      // create a new scope. Every fixed scientific and execution input does.
      campaignScope: {
        tenantId: campaign.tenantId,
        goalId: campaign.goalId,
        candidateKind: campaign.candidateKind,
        sourceCommitSha: campaign.sourceCommitSha,
        parentReleaseDigest: campaign.parentReleaseDigest,
        anchorReleaseDigest: campaign.anchorReleaseDigest,
        policyDigest: campaign.policy.policyDigest,
        datasetDigest: campaign.dataset.datasetDigest,
        execution: campaign.execution,
        budgetDigest: rrsiHash(
          "chainlesschain.rrsi-root-budget/v1",
          campaign.budget,
        ),
        experiment: campaign.experiment,
      },
      execution,
      stages,
      fixedPairReplicasPerTaskSeedArm: 2,
      aggregationMethod:
        "mean-fixed-pair-replicas-then-seeds-then-task-weighted-source-components/v2",
      successDefinition:
        "reported-pass-and-zero-security-and-permission-violations/v2",
      manualRemediationMeasured: false,
      randomnessCommitment: campaign.experiment.randomnessCommitment,
      resamplingUnit: "task-group-component",
      bootstrapMethod: "task-weighted-cluster-percentile/v1",
      boundedMethod: RRSI_BOUNDED_CLUSTER_METHOD,
      intervalMethod: RRSI_CLUSTER_ENVELOPE_METHOD,
      minimumIndependentGroups: campaign.policy.thresholds.minIndependentGroups,
      stoppingRule: "fixed-full-denominator-no-interim-acceptance",
      maxBootstrapSamples: MAX_BOOTSTRAP_SAMPLES,
      maxResampleOperations: MAX_RESAMPLE_OPERATIONS,
      operationLimitScope: "complete-family-per-stage/v1",
      alphaControlScope: "per-stage-family-not-across-adaptive-queries/v1",
      decision: "HOLD",
      preObservationRegistrationVerified: false,
      sourceIndependenceVerified: false,
      perturbationSemanticsVerified: false,
      statisticalProtocolValidated: false,
    },
  );
  snapshotRrsiData(protocol);
  return protocol;
}

/** Works before preparation: no candidate, batch, native plan or result is accepted. */
export function buildRrsiNativeStatisticsScopeProtocol(input) {
  const options = fields(input, ["campaign", "execution"], "statistics scope");
  const campaign = verifyRrsiCampaign(options.campaign);
  return scopeProtocol(
    campaign,
    executionProjection(options.execution, campaign),
  );
}

export function verifyRrsiNativeStatisticsScopeProtocol(protocol, context) {
  const rebuilt = buildRrsiNativeStatisticsScopeProtocol(context);
  if (rrsiCanonical(snapshotRrsiData(protocol)) !== rrsiCanonical(rebuilt))
    rrsiFail("native statistics scope protocol differs");
  return rebuilt;
}

/** Structural match only. Genuine History separately proves registration order. */
export function assertRrsiNativeStatisticsScopeBatch(protocol, context) {
  const options = fields(
    context,
    ["campaign", "batch"],
    "statistics scope batch",
  );
  const campaign = verifyRrsiCampaign(options.campaign);
  const batch = normalizeRrsiNativeEvaluationBatch(options.batch, campaign);
  const expected = scopeProtocol(campaign, {
    dependencyLockDigest: batch.parentIdentity.dependencyLockDigest,
    runtimeManifestDigest: batch.parentIdentity.runtimeManifestDigest,
    targetMatrixRoot: batch.parentIdentity.targetMatrixRoot,
    targets: batch.targetIdentity
      .map(([slotId, runtimeId, targetEnvironmentRef, environmentDigest]) => ({
        slotId,
        runtimeId,
        targetEnvironmentRef,
        environmentDigest,
      }))
      .sort((a, b) => compare(a.slotId, b.slotId)),
  });
  if (rrsiCanonical(snapshotRrsiData(protocol)) !== rrsiCanonical(expected))
    rrsiFail("native batch changes the frozen statistics scope protocol");
  const plan = buildRrsiNativeGroupStatisticsPlan({ campaign, batch });
  for (const field of [
    "seeds",
    "variants",
    "comparisons",
    "pools",
    "familyAlpha",
    "hypothesisCount",
    "alphaPerHypothesis",
    "bootstrapSamples",
    "bootstrapTailReplicates",
    "bootstrapTailResolutionSufficient",
    "resampleOperations",
  ])
    if (
      rrsiCanonical(plan[field]) !==
      rrsiCanonical(expected.stages[batch.stage][field])
    )
      rrsiFail(`native statistics plan changes the frozen ${field}`);
  for (const field of [
    "fixedPairReplicasPerTaskSeedArm",
    "aggregationMethod",
    "successDefinition",
    "manualRemediationMeasured",
    "randomnessCommitment",
    "resamplingUnit",
    "bootstrapMethod",
    "boundedMethod",
    "minimumIndependentGroups",
    "stoppingRule",
  ])
    if (rrsiCanonical(plan[field]) !== rrsiCanonical(expected[field]))
      rrsiFail(`native statistics plan changes the frozen ${field}`);
  return plan;
}
