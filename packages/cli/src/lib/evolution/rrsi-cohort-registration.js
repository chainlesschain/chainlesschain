/** Derive enrollment declarations only from a genuine History resolver at composition. */
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
  rrsiInteger,
  rrsiCanonical,
  freezeRrsiData,
} from "./rrsi-data.js";
import { normalizeRrsiNativeEvaluationBatch } from "./rrsi-native-evaluation-batch.js";

export const RRSI_COHORT_REGISTRATION_SCHEMA =
  "chainlesschain.rrsi-cohort-registration/v1";
export const RRSI_COHORT_PLAN_SCHEMA = "chainlesschain.rrsi-cohort-plan/v1";
export const RRSI_COHORT_PLAN_V2_SCHEMA = "chainlesschain.rrsi-cohort-plan/v2";
export const RRSI_COHORT_MANIFEST_SCHEMA =
  "chainlesschain.rrsi-cohort-manifest/v1";
export const RRSI_COHORT_MANIFEST_V2_SCHEMA =
  "chainlesschain.rrsi-cohort-manifest/v2";
export const RRSI_EVAL_CAMPAIGN_PLAN_SCHEMA =
  "chainlesschain.rrsi-eval-campaign-plan/v1";

/** Structural provenance only. Consumers obtain the registration from genuine History. */
export function buildRrsiNativeStatisticsRegistrationBindings(
  registrationInput,
  reservationRecordInput,
) {
  const registration = snapshotRrsiData(registrationInput);
  const reservationRecord = snapshotRrsiData(reservationRecordInput);
  if (
    registration.schema !==
      "chainlesschain.rrsi-native-statistics-registration-resolution/v1" ||
    registration.historyAuthenticated !== true ||
    registration.preObservationRegistrationVerified !== true ||
    registration.reservationKind !== "reserve-native-batch-v2" ||
    registration.statisticsPlanDigest !==
      registration.statisticsPlan?.statisticsPlanDigest ||
    rrsiCanonical(registration.reservationRecord) !==
      rrsiCanonical(reservationRecord) ||
    !(
      registration.binding.rootRegistrationRecord.sequence <
        registration.scopeRegistrationRecord.sequence &&
      registration.scopeRegistrationRecord.sequence <
        registration.planRegistrationRecord.sequence &&
      registration.planRegistrationRecord.sequence < reservationRecord.sequence
    )
  )
    rrsiFail("native statistics registration provenance or sequence differs");
  return freezeRrsiData({
    schema: "chainlesschain.rrsi-native-statistics-registration-bindings/v1",
    binding: registration.binding,
    protocolDigest: registration.protocolDigest,
    statisticsPlanDigest: registration.statisticsPlanDigest,
    scopeRegistrationRecord: registration.scopeRegistrationRecord,
    planRegistrationRecord: registration.planRegistrationRecord,
    reservationRecord,
    reservationKind: registration.reservationKind,
  });
}

export function buildRrsiEvalCampaignPlan(rootInput) {
  const root = snapshotRrsiData(rootInput);
  return rrsiEnvelope(RRSI_EVAL_CAMPAIGN_PLAN_SCHEMA, "campaignRootDigest", {
    historyScopeId: root.descriptor.scopeId,
    historyDescriptorDigest: rrsiHash(
      "chainlesschain.rrsi-history-descriptor/v1",
      root.descriptor,
    ),
    ledgerIdentity: root.identity,
    rootCampaignDigest: root.campaign.campaignDigest,
    rootRegistrationRecord: root.registrationRecord,
    policyDigest: root.campaign.policy.policyDigest,
    executionDigest: rrsiHash(
      "chainlesschain.rrsi-execution-bindings/v1",
      root.campaign.execution,
    ),
    budgetDigest: rrsiHash(
      "chainlesschain.rrsi-root-budget/v1",
      root.campaign.budget,
    ),
    experimentDigest: rrsiHash(
      "chainlesschain.rrsi-root-experiment/v1",
      root.campaign.experiment,
    ),
    maxSelectionQueries: root.campaign.policy.limits.maxSelectionQueries,
    querySlotPolicy: "global-history-ordinal-and-stage/v1",
    productionBudgetAuthorityVerified: false,
  });
}

export function rrsiEvalQueryStreamId(root, resolution) {
  rrsiInteger(
    resolution.queryOrdinal,
    "global History query ordinal",
    1,
    root.maxSelectionQueries,
  );
  return `rrsi-query.${rrsiHash("chainlesschain.rrsi-eval-query-stream/v1", { campaignRootDigest: root.campaignRootDigest, queryOrdinal: resolution.queryOrdinal, stage: resolution.batch.stage }).slice(7)}`;
}

/** Immutable plan/manifest bytes exclude changing budget statuses and current head digests. */
export function buildRrsiCohortRegistration(
  rootInput,
  resolutionInput,
  cohortId,
) {
  return prepareRrsiCohortRegistration(rootInput, resolutionInput).build(
    cohortId,
  );
}

/** Structural preparation only; trusted audit callers supply genuine History data. */
export function prepareRrsiCohortRegistration(rootInput, resolutionInput) {
  const root = snapshotRrsiData(rootInput),
    resolution = snapshotRrsiData(resolutionInput);
  const batch = normalizeRrsiNativeEvaluationBatch(
    resolution.batch,
    resolution.campaign,
  );
  if (rrsiCanonical(root.ledgerIdentity) !== rrsiCanonical(resolution.identity))
    rrsiFail("RRSI cohort belongs to another History journal");
  const childrenByCohort = new Map();
  for (const child of batch.children) {
    if (!childrenByCohort.has(child.cohortId))
      childrenByCohort.set(child.cohortId, []);
    childrenByCohort.get(child.cohortId).push(child);
  }
  const groups = new Map();
  for (const group of resolution.children)
    if (!groups.has(group.bindings.childId))
      groups.set(group.bindings.childId, group);
  const statisticsRegistration = resolution.statisticsRegistration
    ? buildRrsiNativeStatisticsRegistrationBindings(
        resolution.statisticsRegistration,
        resolution.reservationRecord,
      )
    : null;
  return Object.freeze({
    build(cohortId) {
      return deriveRrsiCohortRegistration(
        root,
        resolution,
        batch,
        childrenByCohort.get(cohortId) ?? [],
        groups,
        cohortId,
        statisticsRegistration,
      );
    },
  });
}

function deriveRrsiCohortRegistration(
  root,
  resolution,
  batch,
  sourceChildren,
  groups,
  cohortId,
  statisticsRegistration,
) {
  const children = [...sourceChildren].sort((a, b) =>
    a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0,
  );
  if (!children.length)
    rrsiFail("RRSI cohort is outside the committed native batch");
  const first = children[0];
  const queryStreamId = rrsiEvalQueryStreamId(root, resolution);
  const plan = rrsiEnvelope(
    statisticsRegistration
      ? RRSI_COHORT_PLAN_V2_SCHEMA
      : RRSI_COHORT_PLAN_SCHEMA,
    "planDigest",
    {
      campaignRootDigest: root.campaignRootDigest,
      campaignDigest: batch.campaignDigest,
      batchDigest: batch.batchDigest,
      nativeEvaluationPlanDigest: batch.nativeEvaluationPlanDigest,
      evaluationMappingDigest: batch.evaluationMappingDigest,
      nativePlanDigest: first.nativePlanDigest,
      candidateDigest: batch.candidate.candidateDigest,
      rrsiAggregateContentDigest: batch.candidate.contentDigest,
      nativeCandidateContents: batch.nativeCandidateContents,
      versions: batch.versions,
      lifecycleDigests: batch.lifecycleDigests,
      queryOrdinal: resolution.queryOrdinal,
      queryStreamId,
      stage: batch.stage,
      role: first.role,
      variant: first.variant,
      pairId: first.pairId,
      variantMappingDigest: first.variantMappingDigest,
      recipeDigest: first.recipeDigest,
      costAttribution: batch.costAttribution,
      executionCountSemantics: batch.executionCountSemantics,
      productionAdmissionVerified: false,
      ...(statisticsRegistration ? { statisticsRegistration } : {}),
    },
  );
  const denominator = Object.fromEntries(
    Object.keys(first.byArm).map((arm) => [
      arm,
      Object.fromEntries(
        Object.keys(first.plannedObservationsPerArmByPartition).map(
          (partition) => [
            partition,
            children.reduce(
              (sum, child) =>
                sum + child.plannedObservationsPerArmByPartition[partition],
              0,
            ),
          ],
        ),
      ),
    ]),
  );
  const childBindings = children.map((child) => {
    const group = groups.get(child.childId);
    if (!group) rrsiFail("RRSI cohort has no reserved paired child");
    return {
      slotId: child.slotId,
      childId: child.childId,
      bindings: group.bindings,
      expectedContext: child.expectedContext,
      evaluationContextDigest: child.evaluationContextDigest,
      reservationDigestsByArm: group.bindings.armReservationDigests,
    };
  });
  const manifest = rrsiEnvelope(
    statisticsRegistration
      ? RRSI_COHORT_MANIFEST_V2_SCHEMA
      : RRSI_COHORT_MANIFEST_SCHEMA,
    "manifestDigest",
    {
      cohortId,
      planDigest: plan.planDigest,
      batchDigest: batch.batchDigest,
      campaignRootDigest: root.campaignRootDigest,
      queryOrdinal: resolution.queryOrdinal,
      queryStreamId,
      reservationRecord: resolution.reservationRecord,
      slotIds: children.map((child) => child.slotId),
      childBindings,
      allCohortIds: [
        ...new Set(batch.children.map((child) => child.cohortId)),
      ].sort(),
      plannedObservationsPerArmByPartition: denominator,
      denominatorSemantics: "complete-validation-and-test-paired-attempts/v1",
      nativeExecutionDenominatorVerified: false,
      ...(statisticsRegistration ? { statisticsRegistration } : {}),
    },
  );
  const slots = children.map((child) => ({
    slotId: child.slotId,
    evaluationPlanDigest: child.nativePlanDigest,
    requestDigest: child.requestDigest,
    policyDigest: child.expectedContext.policyDigest,
    evaluationAuthorityRoot: child.expectedContext.evaluationAuthorityRoot,
  }));
  return { plan, manifest, slots };
}

export function normalizeRrsiCohortLookup(input) {
  const lookup = snapshotRrsiData(input);
  rrsiExact(
    lookup,
    ["schema", "batchDigest", "cohortId"],
    "RRSI cohort registration reference",
  );
  if (lookup.schema !== RRSI_COHORT_REGISTRATION_SCHEMA)
    rrsiFail("RRSI registration schema differs");
  return lookup;
}
