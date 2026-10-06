/** Derive enrollment declarations only from a genuine History resolver at composition. */
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
  rrsiInteger,
  rrsiCanonical,
} from "./rrsi-data.js";
import { normalizeRrsiNativeEvaluationBatch } from "./rrsi-native-evaluation-batch.js";

export const RRSI_COHORT_REGISTRATION_SCHEMA =
  "chainlesschain.rrsi-cohort-registration/v1";
export const RRSI_COHORT_PLAN_SCHEMA = "chainlesschain.rrsi-cohort-plan/v1";
export const RRSI_COHORT_MANIFEST_SCHEMA =
  "chainlesschain.rrsi-cohort-manifest/v1";
export const RRSI_EVAL_CAMPAIGN_PLAN_SCHEMA =
  "chainlesschain.rrsi-eval-campaign-plan/v1";

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
  const root = snapshotRrsiData(rootInput),
    resolution = snapshotRrsiData(resolutionInput);
  const batch = normalizeRrsiNativeEvaluationBatch(
    resolution.batch,
    resolution.campaign,
  );
  if (rrsiCanonical(root.ledgerIdentity) !== rrsiCanonical(resolution.identity))
    rrsiFail("RRSI cohort belongs to another History journal");
  const children = batch.children
    .filter((child) => child.cohortId === cohortId)
    .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
  if (!children.length)
    rrsiFail("RRSI cohort is outside the committed native batch");
  const first = children[0];
  const queryStreamId = rrsiEvalQueryStreamId(root, resolution);
  const plan = rrsiEnvelope(RRSI_COHORT_PLAN_SCHEMA, "planDigest", {
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
  });
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
    const group = resolution.children.find(
      (group) => group.bindings.childId === child.childId,
    );
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
  const manifest = rrsiEnvelope(RRSI_COHORT_MANIFEST_SCHEMA, "manifestDigest", {
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
  });
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
