/** Complete preregistered native measurement graph. No dispatch or billing authority. */
import { isProxy } from "node:util/types";
import { verifySkillTargetMatrixEvalPlan } from "./skill-target-matrix-eval.js";
import {
  verifySkillDependencyLock,
  verifySkillRuntimeManifest,
  verifySkillTargetMatrix,
} from "./skill-execution-manifest.js";
import {
  computeEvolutionEvalLaunchRequestDigest,
  computeEvolutionEvalContextDigest,
} from "./evolution-eval-gate.js";
import { verifyRrsiEvaluationMapping } from "./rrsi-evaluation-adapter.js";
import {
  buildRrsiEvaluationVariantMapping,
  assertRrsiVariantSetInputIsolation,
  snapshotRrsiVariantContexts,
} from "./rrsi-evaluation-variants.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiDigest,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_EVALUATION_PLAN_SCHEMA =
  "chainlesschain.rrsi-native-evaluation-plan/v1";
const PAIRS = [
  { id: "rrsi-vs-rsi", candidateArm: "rrsi", baselineArm: "rsi" },
  { id: "rrsi-vs-baseline", candidateArm: "rrsi", baselineArm: "baseline" },
  { id: "rsi-vs-baseline", candidateArm: "rsi", baselineArm: "baseline" },
];
const STAGES = { selection: ["selection"], generalization: ["gate", "audit"] };
const keyOf = (row) => JSON.stringify([row.role, row.variant, row.pairId]);

function ownInputs(input) {
  const keys = [
    "context",
    "mapping",
    "variants",
    "nativeCases",
    "stage",
    "lifecycleDigests",
    "executionContract",
  ];
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== keys.length
  )
    rrsiFail("native evaluation plan requires plain own fields");
  return Object.fromEntries(
    keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("native evaluation plan cannot use accessors");
      return [key, field.value];
    }),
  );
}

export function buildRrsiNativeEvaluationPlan(input) {
  const ports = ownInputs(input);
  const context = snapshotRrsiData(ports.context);
  const base = verifyRrsiEvaluationMapping(ports.mapping, context);
  const campaign = context.campaign;
  if (typeof ports.stage !== "string" || !Object.hasOwn(STAGES, ports.stage))
    rrsiFail("unknown native evaluation stage");
  if (campaign.candidateKind !== "skill")
    rrsiFail(
      "native Skill matrix cannot authenticate a Memory-policy experiment",
    );
  // Native manifest normalizers legitimately use null-prototype JSON objects.
  // Capture outer own fields, then let their original strict validators copy
  // every nested value; never stringify unverified input to bridge prototypes.
  const rawExecution = ports.executionContract;
  const executionKeys = ["dependencyLock", "runtimeManifest", "targetMatrix"];
  if (
    !rawExecution ||
    typeof rawExecution !== "object" ||
    isProxy(rawExecution) ||
    Object.getPrototypeOf(rawExecution) !== Object.prototype ||
    Reflect.ownKeys(rawExecution).length !== executionKeys.length
  )
    rrsiFail("native execution contract requires plain own fields");
  const execution = Object.fromEntries(
    executionKeys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(rawExecution, key);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("native execution contract cannot use accessors");
      return [key, field.value];
    }),
  );
  const dependencyLock = verifySkillDependencyLock(execution.dependencyLock);
  const runtimeManifest = verifySkillRuntimeManifest(execution.runtimeManifest);
  if (
    !execution.targetMatrix ||
    typeof execution.targetMatrix !== "object" ||
    isProxy(execution.targetMatrix)
  )
    rrsiFail("native target matrix requires own data fields");
  const nativeRoot = Object.getOwnPropertyDescriptor(
    execution.targetMatrix,
    "targetMatrixRoot",
  );
  const nativeCells = Object.getOwnPropertyDescriptor(
    execution.targetMatrix,
    "cells",
  );
  if (
    !nativeRoot ||
    !("value" in nativeRoot) ||
    !nativeCells ||
    !("value" in nativeCells)
  )
    rrsiFail("native target matrix cannot use accessors");
  const targetMatrix = verifySkillTargetMatrix(execution.targetMatrix, {
    dependencyLock,
    runtimeManifest,
    expectedTargetMatrixRoot: nativeRoot.value,
    expectedEnvironmentBindings: nativeCells.value,
  });
  if (targetMatrix.tenantId !== campaign.tenantId)
    rrsiFail("native execution contract belongs to another tenant");
  if (
    campaign.experiment.comparisons.some(
      (id) => !PAIRS.some((pair) => pair.id === id),
    )
  )
    rrsiFail("native design cannot silently discard a registered comparison");
  const lifecycles = snapshotRrsiData(ports.lifecycleDigests);
  rrsiExact(
    lifecycles,
    campaign.experiment.arms,
    "frozen arm lifecycle references",
  );
  for (const arm of campaign.experiment.arms)
    rrsiDigest(lifecycles[arm], `${arm} lifecycle digest`);
  const sources = snapshotRrsiVariantContexts(ports.variants);
  // Each individual derivation and the aggregate must be checked before launch.
  const variantMappings = sources.map(buildRrsiEvaluationVariantMapping);
  const expectedVariants = [
    "clean",
    ...campaign.experiment.perturbations,
  ].sort();
  if (
    rrsiCanonical(variantMappings.map((mapping) => mapping.variant).sort()) !==
      rrsiCanonical(expectedVariants) ||
    variantMappings.some(
      (mapping) =>
        mapping.evaluationMappingDigest !== base.evaluationMappingDigest,
    )
  )
    rrsiFail(
      "native plan must include exactly all frozen variants of this mapping",
    );
  assertRrsiVariantSetInputIsolation(sources);
  const byVariant = new Map(
    variantMappings.map((mapping) => [mapping.variant, mapping]),
  );
  const nativeCases = snapshotRrsiData(ports.nativeCases);
  const roles = STAGES[ports.stage];
  if (
    !Array.isArray(nativeCases) ||
    nativeCases.length !== roles.length * expectedVariants.length * PAIRS.length
  )
    rrsiFail("native plan omits part of the triangle measurement denominator");
  const seen = new Set(),
    invocationIds = new Set(),
    invocationNonces = new Set();
  const candidateContents = new Map(),
    planDigests = new Set();
  let parentIdentity = null,
    targetIdentity = null;
  const observations = Object.fromEntries(
    campaign.experiment.arms.map((arm) => [arm, 0]),
  );
  const partitions = new Set();
  const compiled = nativeCases
    .map((entry) => {
      rrsiExact(
        entry,
        ["role", "variant", "pairId", "plan"],
        "native evaluation case",
      );
      const pair = PAIRS.find((pair) => pair.id === entry.pairId);
      const variant = byVariant.get(entry.variant);
      if (
        !roles.includes(entry.role) ||
        !pair ||
        !variant ||
        seen.has(keyOf(entry))
      )
        rrsiFail("native measurement case is foreign or duplicated");
      seen.add(keyOf(entry));
      const nativePlan = verifySkillTargetMatrixEvalPlan(entry.plan);
      if (
        nativePlan.dependencyLockDigest !==
          dependencyLock.dependencyLockDigest ||
        nativePlan.runtimeManifestDigest !==
          runtimeManifest.runtimeManifestDigest ||
        nativePlan.targetMatrixRoot !== targetMatrix.targetMatrixRoot ||
        nativePlan.cells.length !== targetMatrix.cells.length ||
        nativePlan.cells.some((cell, index) =>
          [
            "cellId",
            "runtimeId",
            "targetEnvironmentRef",
            "environmentDigest",
          ].some((key) => cell[key] !== targetMatrix.cells[index][key]),
        )
      )
        rrsiFail(
          "native plan changes the complete declared target matrix or execution contract",
        );
      if (planDigests.has(nativePlan.planDigest))
        rrsiFail("native variants cannot reuse the same original plan");
      planDigests.add(nativePlan.planDigest);
      const role = variant.roles.find((role) => role.role === entry.role);
      if (
        nativePlan.tenantId !== campaign.tenantId ||
        nativePlan.skillName !== campaign.goalId ||
        nativePlan.candidateId !== base.versions[pair.candidateArm] ||
        nativePlan.baselineId !== base.versions[pair.baselineArm]
      )
        rrsiFail(
          "native plan changes the frozen tenant, target or arm artifact",
        );
      if (
        pair.baselineArm === "baseline" &&
        nativePlan.baselineReleaseDigest !== campaign.parentReleaseDigest
      )
        rrsiFail("native stable baseline changes the parent release");
      if (
        candidateContents.has(pair.candidateArm) &&
        candidateContents.get(pair.candidateArm) !==
          nativePlan.candidateContentDigest
      )
        rrsiFail("native cases change the same candidate's content");
      candidateContents.set(
        pair.candidateArm,
        nativePlan.candidateContentDigest,
      );
      const parent = {
        contentDigest: nativePlan.expectedActiveContentDigest,
        revision: nativePlan.expectedActiveRevision,
        dependencyLockDigest: nativePlan.dependencyLockDigest,
        runtimeManifestDigest: nativePlan.runtimeManifestDigest,
        targetMatrixRoot: nativePlan.targetMatrixRoot,
      };
      parentIdentity ??= parent;
      if (rrsiCanonical(parent) !== rrsiCanonical(parentIdentity))
        rrsiFail("native cases disagree on parent, execution or target scope");
      const targets = nativePlan.cells
        .map((cell) => [
          cell.cellId,
          cell.runtimeId,
          cell.targetEnvironmentRef,
          cell.environmentDigest,
        ])
        .sort((a, b) =>
          rrsiCanonical(a) < rrsiCanonical(b)
            ? -1
            : rrsiCanonical(a) > rrsiCanonical(b)
              ? 1
              : 0,
        );
      targetIdentity ??= targets;
      if (rrsiCanonical(targets) !== rrsiCanonical(targetIdentity))
        rrsiFail("native cases do not cover the same frozen target matrix");
      const counts = {};
      for (const task of role.mappings.filter(
        (task) => task.split !== "training",
      )) {
        counts[task.rrsiPartition] =
          (counts[task.rrsiPartition] ?? 0) + campaign.experiment.seeds.length;
        partitions.add(task.rrsiPartition);
      }
      const cohortId = `rrsi-eval.${rrsiHash(
        "chainlesschain.rrsi-native-cohort-identity/v1",
        {
          campaignDigest: campaign.campaignDigest,
          stage: ports.stage,
          role: entry.role,
          variant: entry.variant,
          pairId: entry.pairId,
          nativePlanDigest: nativePlan.planDigest,
        },
      ).slice(7)}`;
      const slots = nativePlan.cells.map((cell) => {
        if (
          cell.suiteDigest !== role.suiteDigest ||
          cell.policyDigest !== role.policyDigest ||
          cell.environmentDigest !== campaign.execution.environmentDigest
        )
          rrsiFail(
            "native cell changes the variant Suite, policy or environment",
          );
        if (
          invocationIds.has(cell.invocationId) ||
          invocationNonces.has(cell.invocationNonce)
        )
          rrsiFail("native attempts reuse an invocation identity");
        invocationIds.add(cell.invocationId);
        invocationNonces.add(cell.invocationNonce);
        const evaluationContext = {
          planDigest: nativePlan.planDigest,
          targetMatrixRoot: nativePlan.targetMatrixRoot,
          cellId: cell.cellId,
          runtimeId: cell.runtimeId,
        };
        const request = {
          suiteRef: cell.suiteRef,
          candidateId: nativePlan.candidateId,
          baselineId: nativePlan.baselineId,
          targetEnvironmentRef: cell.targetEnvironmentRef,
          evaluationContext,
        };
        const expectedContext = {
          ...evaluationContext,
          tenantId: nativePlan.tenantId,
          targetEnvironmentRef: cell.targetEnvironmentRef,
          environmentDigest: cell.environmentDigest,
          candidateId: nativePlan.candidateId,
          baselineId: nativePlan.baselineId,
          suiteDigest: cell.suiteDigest,
          policyDigest: cell.policyDigest,
          evaluationAuthorityRoot: cell.evaluationAuthorityRoot,
        };
        const planned = Object.values(counts).reduce(
          (sum, count) => sum + count,
          0,
        );
        observations[pair.baselineArm] += planned;
        observations[pair.candidateArm] += planned;
        return {
          cohortId,
          slotId: cell.cellId,
          nativePlanDigest: nativePlan.planDigest,
          request,
          requestDigest: computeEvolutionEvalLaunchRequestDigest(request),
          expectedContext,
          evaluationContextDigest:
            computeEvolutionEvalContextDigest(expectedContext),
          plannedObservationsPerArmByPartition: counts,
          pmTrainingPartitionDigest: role.pmTrainingPartitionDigest,
        };
      });
      return {
        role: entry.role,
        variant: entry.variant,
        pairId: entry.pairId,
        candidateArm: pair.candidateArm,
        baselineArm: pair.baselineArm,
        contributesToConfirmatoryArmMeans: true,
        isRegisteredContrast: campaign.experiment.comparisons.includes(pair.id),
        variantMappingDigest: variant.variantMappingDigest,
        recipeDigest: variant.recipeDigest,
        nativePlan,
        slots,
      };
    })
    .sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
  if (new Set(Object.values(observations)).size !== 1)
    rrsiFail("native triangle does not balance planned arm observations");
  const budget =
    ports.stage === "selection"
      ? campaign.budget.selectionPerExploringArm
      : campaign.budget.finalEvaluationPerArm;
  if (Object.values(observations).some((count) => count > budget.maxExecutions))
    rrsiFail(
      "frozen RRSI budget cannot cover complete native actor observations",
      "CC_RRSI_BUDGET_EXCEEDED",
    );
  const result = rrsiEnvelope(
    RRSI_NATIVE_EVALUATION_PLAN_SCHEMA,
    "nativeEvaluationPlanDigest",
    {
      campaignDigest: campaign.campaignDigest,
      evaluationMappingDigest: base.evaluationMappingDigest,
      parentReleaseDigest: campaign.parentReleaseDigest,
      anchorReleaseDigest: campaign.anchorReleaseDigest,
      stage: ports.stage,
      versions: base.versions,
      lifecycleDigests: lifecycles,
      seeds: campaign.experiment.seeds,
      variants: expectedVariants,
      parentIdentity,
      targetIdentity,
      cases: compiled,
      plannedActorObservationsByArm: observations,
      hypothesisCount:
        campaign.experiment.comparisons.length *
        expectedVariants.length *
        partitions.size *
        targetIdentity.length,
      estimand:
        "frozen-triangle-arm-task-means-then-source-component-deltas/v1",
      repeatedObservationsDoNotAddIndependentComponents: true,
      preservesOriginalNativeGateQualityAndEfficiencyRequirements: true,
      nativePlansReplacedWithRrsiDigests: false,
      declaredTargetMatrixComplete: true,
      targetMatrixAuthorityVerified: false,
      fullRequestCostGraphVerified: false,
      billingComplete: false,
      lifecycleProvenanceVerified: false,
      recipeExecutionVerified: false,
      sourceProvenanceVerified: false,
      nativePlanAuthoritiesVerified: false,
      admissionInventoryVerified: false,
      statisticalProtocolValidated: false,
    },
  );
  // Reject oversized graphs before returning an artifact that could not be
  // independently reopened with the same RRSI data limits. Never trim cells.
  snapshotRrsiData(result);
  return result;
}

/** Independent contextual readback; a JSON plan never grants a launch capability. */
export function verifyRrsiNativeEvaluationPlan(plan, context) {
  const rebuilt = buildRrsiNativeEvaluationPlan(context);
  if (rrsiCanonical(snapshotRrsiData(plan)) !== rrsiCanonical(rebuilt))
    rrsiFail("native RRSI plan differs from the frozen measurement graph");
  return rebuilt;
}
