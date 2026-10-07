/** Native triangle statistics. Descriptive evidence never grants admission. */
import { isProxy } from "node:util/types";
import { verifyRrsiCampaign } from "./rrsi-contracts.js";
import { normalizeRrsiNativeEvaluationBatch } from "./rrsi-native-evaluation-batch.js";
import { captureRrsiNativeBatchEvidence } from "./rrsi-native-batch-evidence.js";
import {
  buildRrsiGroupStatisticsPlan,
  computeRrsiClusterEnvelopeInterval,
  RRSI_BOUNDED_CLUSTER_METHOD,
  RRSI_CLUSTER_ENVELOPE_METHOD,
} from "./rrsi-group-statistics.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiBoolean,
  rrsiInteger,
  rrsiDigest,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_GROUP_STATISTICS_PLAN_SCHEMA =
  "chainlesschain.rrsi-native-group-statistics-plan/v2";
export const RRSI_NATIVE_GROUP_STATISTICS_REPORT_SCHEMA =
  "chainlesschain.rrsi-native-group-statistics-report/v2";
const MAX_RESAMPLE_OPERATIONS = 50_000_000;
const key = (...parts) => JSON.stringify(parts);
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

function captureChunks(input, maximum) {
  if (
    !input ||
    isProxy(input) ||
    !Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Array.prototype ||
    input.length > maximum ||
    Reflect.ownKeys(input).length !== input.length + 1
  )
    rrsiFail("native statistical chunks require a bounded dense list");
  return Array.from({ length: input.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(input, String(index));
    if (!field?.enumerable || !("value" in field))
      rrsiFail("native statistical chunks cannot use accessors");
    // Each complete child retains the original per-document limits.
    return snapshotRrsiData(field.value);
  });
}

/** Plain row claims are useful for analysis and tests, but cannot authenticate themselves. */
export function analyzeRrsiNativeGroupStatistics(input) {
  const options = fields(
    input,
    ["campaign", "batch", "plan", "childRows"],
    "native statistics analysis",
  );
  const campaign = verifyRrsiCampaign(options.campaign);
  const batch = normalizeRrsiNativeEvaluationBatch(options.batch, campaign);
  const plan = verifyRrsiNativeGroupStatisticsPlan(options.plan, {
    campaign,
    batch,
  });
  const chunks = captureChunks(options.childRows, batch.children.length);
  const children = new Map(
    batch.children.map((child) => [child.childId, child]),
  );
  const tasks = new Map(campaign.dataset.tasks.map((task) => [task.id, task]));
  const seenChildren = new Set(),
    rowClaims = new Map(),
    receiptOwners = new Set(),
    chunkIndex = new Map();
  for (const chunk of chunks) {
    rrsiExact(chunk, ["childId", "rows"], "native statistical child chunk");
    const child = children.get(chunk.childId);
    if (!child || seenChildren.has(chunk.childId) || !Array.isArray(chunk.rows))
      rrsiFail(
        "native statistical child is foreign, repeated or not a row list",
      );
    seenChildren.add(chunk.childId);
    for (const row of chunk.rows) {
      rrsiExact(
        row,
        [
          "taskId",
          "partition",
          "seed",
          "arm",
          "reportedPass",
          "securityViolations",
          "permissionViolations",
          "resultDigest",
        ],
        "native statistical row claim",
      );
      const task = tasks.get(row.taskId);
      if (
        !task ||
        row.partition !== task.partition ||
        !Object.hasOwn(
          child.plannedObservationsPerArmByPartition,
          row.partition,
        ) ||
        !Object.hasOwn(child.byArm, row.arm) ||
        !plan.seeds.includes(row.seed)
      )
        rrsiFail(
          "native statistical row changes task, partition, seed or arm scope",
        );
      rrsiBoolean(row.reportedPass, "reported native pass");
      rrsiInteger(row.securityViolations, "native security violations");
      rrsiInteger(row.permissionViolations, "native permission violations");
      rrsiDigest(row.resultDigest, "native row result digest");
      if (receiptOwners.has(row.resultDigest))
        rrsiFail("one native row result cannot pay multiple observation slots");
      receiptOwners.add(row.resultDigest);
      const rowKey = key(
        row.partition,
        child.variant,
        child.slotId,
        row.taskId,
        row.seed,
        row.arm,
        child.pairId,
      );
      if (rowClaims.has(rowKey))
        rrsiFail("duplicate native statistical replica slot");
      rowClaims.set(rowKey, row);
    }
    chunkIndex.set(chunk.childId, {
      rowCount: chunk.rows.length,
      rowClaimsDigest: rrsiHash(
        "chainlesschain.rrsi-native-statistical-child-claims/v2",
        [...chunk.rows].sort((a, b) =>
          compare(rrsiCanonical(a), rrsiCanonical(b)),
        ),
      ),
    });
  }
  const pairs = new Map();
  for (const child of batch.children)
    for (const arm of Object.keys(child.byArm))
      for (const partition of Object.keys(
        child.plannedObservationsPerArmByPartition,
      )) {
        const pairKey = key(partition, child.variant, child.slotId, arm);
        let replicas = pairs.get(pairKey);
        if (!replicas) pairs.set(pairKey, (replicas = []));
        replicas.push(child.pairId);
      }
  for (const replicas of pairs.values())
    if (replicas.length !== 2 || new Set(replicas).size !== 2)
      rrsiFail(
        "native statistical arm lacks its two fixed distinct pair replicas",
      );

  function summary(pool, variant, target, arm) {
    const replicas = pairs.get(
      key(pool.partition, variant, target.slotId, arm),
    );
    const taskScores = new Map();
    let observed = 0,
      successes = 0,
      reportedPasses = 0,
      securityViolations = 0,
      permissionViolations = 0,
      completeTaskMeans = 0;
    for (const component of pool.components)
      for (const taskId of component.taskIds) {
        let complete = true,
          taskScore = 0;
        for (const seed of plan.seeds) {
          let seedScore = 0;
          for (const pairId of replicas) {
            const row = rowClaims.get(
              key(
                pool.partition,
                variant,
                target.slotId,
                taskId,
                seed,
                arm,
                pairId,
              ),
            );
            if (!row) {
              complete = false;
              continue;
            }
            observed++;
            reportedPasses += Number(row.reportedPass);
            securityViolations += row.securityViolations;
            permissionViolations += row.permissionViolations;
            const success = Number(
              row.reportedPass &&
                row.securityViolations === 0 &&
                row.permissionViolations === 0,
            );
            successes += success;
            seedScore += success;
          }
          taskScore += seedScore / replicas.length;
        }
        // Missing observations are never silently imputed or renormalized.
        taskScores.set(taskId, complete ? taskScore / plan.seeds.length : null);
        completeTaskMeans += Number(complete);
      }
    const planned = pool.taskCount * plan.seeds.length * 2;
    return {
      plannedActorObservations: planned,
      observedRowClaims: observed,
      missingActorObservations: planned - observed,
      knownStrictPasses: successes,
      knownReportedPasses: reportedPasses,
      declaredSecurityViolations: securityViolations,
      declaredPermissionViolations: permissionViolations,
      completeTaskMeans,
      meanStrictPassRate: observed === planned ? successes / planned : null,
      taskScores,
    };
  }
  const analyses = [],
    summaries = [];
  for (const pool of plan.pools)
    for (const variant of plan.variants)
      for (const target of plan.targets) {
        const arms = new Map(
          campaign.experiment.arms.map((arm) => [
            arm,
            summary(pool, variant, target, arm),
          ]),
        );
        summaries.push(...arms.values());
        for (const comparison of plan.comparisons) {
          const left = arms.get(comparison.leftArm),
            right = arms.get(comparison.rightArm);
          const reasons = [];
          if (left.missingActorObservations || right.missingActorObservations)
            reasons.push("INSUFFICIENT_EVIDENCE");
          if (pool.components.length < plan.minimumIndependentGroups)
            reasons.push("INSUFFICIENT_INDEPENDENT_GROUPS");
          if (!plan.bootstrapTailResolutionSufficient)
            reasons.push("INSUFFICIENT_BOOTSTRAP_TAIL_RESOLUTION");
          let interval = null;
          if (!reasons.length)
            interval = computeRrsiClusterEnvelopeInterval({
              values: pool.components.map(
                (component) =>
                  component.taskIds.reduce(
                    (sum, taskId) =>
                      sum +
                      left.taskScores.get(taskId) -
                      right.taskScores.get(taskId),
                    0,
                  ) / component.taskCount,
              ),
              taskCounts: pool.components.map(
                (component) => component.taskCount,
              ),
              alpha: plan.alphaPerHypothesis,
              bootstrapSamples: plan.bootstrapSamples,
              randomnessSeedDigest: rrsiHash(
                "chainlesschain.rrsi-native-cluster-bootstrap-random/v2",
                {
                  randomnessCommitment: plan.randomnessCommitment,
                  partition: pool.partition,
                  target,
                  variant,
                  comparisonId: comparison.id,
                  components: pool.components.map((component) => ({
                    componentDigest: component.componentDigest,
                    taskCount: component.taskCount,
                  })),
                },
              ),
            });
          const publicSummary = (entry) =>
            Object.fromEntries(
              Object.entries(entry).filter(([name]) => name !== "taskScores"),
            );
          analyses.push({
            partition: pool.partition,
            variant,
            ...target,
            comparisonId: comparison.id,
            leftArm: comparison.leftArm,
            rightArm: comparison.rightArm,
            plannedTaskCount: pool.taskCount,
            independentDeclaredGroupCount: pool.components.length,
            alpha: plan.alphaPerHypothesis,
            left: publicSummary(left),
            right: publicSummary(right),
            meanDifference:
              left.meanStrictPassRate === null ||
              right.meanStrictPassRate === null
                ? null
                : left.meanStrictPassRate - right.meanStrictPassRate,
            bootstrapInterval: interval?.bootstrapInterval ?? null,
            boundedInterval: interval?.boundedInterval ?? null,
            confidenceInterval: interval?.confidenceInterval ?? null,
            status: reasons.length ? "hold" : "descriptive-complete",
            reasons,
          });
        }
      }
  const planned = summaries.reduce(
    (sum, entry) => sum + entry.plannedActorObservations,
    0,
  );
  const observed = summaries.reduce(
    (sum, entry) => sum + entry.observedRowClaims,
    0,
  );
  const blockingReasons = [];
  if (observed !== planned)
    blockingReasons.push("INCOMPLETE_TRIANGLE_DENOMINATOR");
  for (const reason of new Set(analyses.flatMap((entry) => entry.reasons)))
    blockingReasons.push(reason);
  blockingReasons.push(
    "STATISTICAL_PROTOCOL_NOT_PREREGISTERED",
    "STATISTICAL_PROTOCOL_UNVALIDATED",
  );
  const report = rrsiEnvelope(
    RRSI_NATIVE_GROUP_STATISTICS_REPORT_SCHEMA,
    "statisticsReportDigest",
    {
      statisticsPlanDigest: plan.statisticsPlanDigest,
      campaignDigest: plan.campaignDigest,
      batchDigest: plan.batchDigest,
      rowSetDigest: rrsiHash(
        "chainlesschain.rrsi-native-statistical-row-set/v2",
        batch.children
          .map((child) => ({
            childId: child.childId,
            ...(chunkIndex.get(child.childId) ?? {
              rowCount: 0,
              rowClaimsDigest: null,
            }),
          }))
          .sort((a, b) => compare(a.childId, b.childId)),
      ),
      stage: plan.stage,
      familyAlpha: plan.familyAlpha,
      hypothesisCount: plan.hypothesisCount,
      plannedActorObservations: planned,
      observedRowClaims: observed,
      missingActorObservations: planned - observed,
      fullTriangleRowsPresent: observed === planned,
      status:
        analyses.some((entry) => entry.status === "hold") ||
        observed !== planned
          ? "hold"
          : "descriptive-complete",
      decision: "HOLD",
      blockingReasons,
      analyses,
      aggregationMethod: plan.aggregationMethod,
      successDefinition: plan.successDefinition,
      manualRemediationMeasured: false,
      intervalMethod: RRSI_CLUSTER_ENVELOPE_METHOD,
      coverageGuaranteeSource: RRSI_BOUNDED_CLUSTER_METHOD,
      conditionalOnIndependentBoundedClusters: true,
      preObservationRegistrationVerified: false,
      sourceIndependenceVerified: false,
      resultAuthenticityVerified: false,
      costEvidenceVerified: false,
      statisticalProtocolValidated: false,
      qualityVerdictVerified: false,
    },
  );
  snapshotRrsiData(report);
  return report;
}

/** Only a live branded census may supply authenticated final-receipt row chunks. */
export function analyzeRrsiNativeBatchGroupStatistics(input) {
  const options = fields(
    input,
    ["batchEvidence", "plan"],
    "native census statistics",
  );
  const captured = captureRrsiNativeBatchEvidence(options.batchEvidence);
  captured.assertCurrentFreshness();
  const childRows = captured.batch.children.flatMap((child) => {
    const block = captured.childEvidence(child.childId);
    return block?.rows
      ? [
          {
            childId: child.childId,
            rows: block.rows.map((row) => ({
              taskId: row.rrsiTaskId,
              partition: row.rrsiPartition,
              seed: row.seed,
              arm: row.arm,
              reportedPass: row.reportedPass,
              securityViolations: row.securityViolations,
              permissionViolations: row.permissionViolations,
              resultDigest: row.rowDigest,
            })),
          },
        ]
      : [];
  });
  const descriptive = analyzeRrsiNativeGroupStatistics({
    campaign: captured.campaign,
    batch: captured.batch,
    plan: options.plan,
    childRows,
  });
  const core = Object.fromEntries(
    Object.entries(descriptive).filter(
      ([name]) => !["schema", "statisticsReportDigest"].includes(name),
    ),
  );
  const result = rrsiEnvelope(
    RRSI_NATIVE_GROUP_STATISTICS_REPORT_SCHEMA,
    "statisticsReportDigest",
    {
      ...core,
      nativeBatchEvidenceDigest: captured.evidence.batchEvidenceDigest,
      auditHead: captured.evidence.auditHead,
      historicalBatchSnapshotOnly: true,
      presentedFinalReceiptRowsAuthenticated: true,
      underlyingExecutionReceiptsReverified: false,
      originalNativeGateVetoChildIds: captured.evidence.nativeGateVetoChildIds,
      blockingReasons: [
        ...new Set([
          ...descriptive.blockingReasons,
          ...captured.evidence.blockingReasons,
        ]),
      ],
    },
  );
  snapshotRrsiData(result);
  // Interval computation does not extend the signed receipt validity window.
  captured.assertCurrentFreshness();
  return result;
}
