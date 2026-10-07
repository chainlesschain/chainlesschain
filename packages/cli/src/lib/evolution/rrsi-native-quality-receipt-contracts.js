/** Historical assessment integrity only. This verifier never grants live authority. */
import { isProxy } from "node:util/types";
import {
  buildRrsiEvalCampaignPlan,
  buildRrsiNativeStatisticsRegistrationBindings,
} from "./rrsi-cohort-registration.js";
import { verifyRrsiNativeGroupStatisticsPlan } from "./rrsi-native-group-statistics-plan.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiDigest,
  rrsiInteger,
  rrsiBoolean,
  rrsiCanonical,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA =
  "chainlesschain.rrsi-native-required-quality-receipt/v1";
export const RRSI_NATIVE_QUALITY_UNVERIFIED_PREREQUISITES = Object.freeze({
  sourceIndependenceVerified: false,
  sourceProvenanceVerified: false,
  underlyingObservationTimeVerified: false,
  underlyingExecutionReceiptsReverified: false,
  nativeContentDerivationVerified: false,
  armLifecycleVerified: false,
  recipeExecutionVerified: false,
  requestCostGraphVerified: false,
  billingComplete: false,
  completeLifecycleCostVerified: false,
  cleanupVerified: false,
  statisticalProtocolValidated: false,
  calibrationVerified: false,
  crossSelectionQueryErrorRateControlled: false,
  manualRemediationMeasured: false,
  productionParentReadbackVerified: false,
});
export const RRSI_NATIVE_QUALITY_REQUIRED_REASONS = Object.freeze([
  "SOURCE_INDEPENDENCE_UNVERIFIED",
  "SOURCE_PROVENANCE_UNVERIFIED",
  "UNDERLYING_OBSERVATION_TIME_UNVERIFIED",
  "UNDERLYING_EXECUTION_RECEIPTS_UNVERIFIED",
  "NATIVE_CONTENT_DERIVATION_UNVERIFIED",
  "ARM_LIFECYCLE_UNVERIFIED",
  "RECIPE_EXECUTION_UNVERIFIED",
  "REQUEST_COST_GRAPH_UNVERIFIED",
  "BILLING_INCOMPLETE",
  "LIFECYCLE_COST_UNVERIFIED",
  "CLEANUP_UNVERIFIED",
  "STATISTICAL_PROTOCOL_UNVALIDATED",
  "CALIBRATION_UNVERIFIED",
  "CROSS_SELECTION_ERROR_RATE_UNCONTROLLED",
  "MANUAL_REMEDIATION_UNMEASURED",
  "PRODUCTION_PARENT_READBACK_UNVERIFIED",
]);
const FIELDS = [
  "assessmentKind",
  "stage",
  "tenantId",
  "goalId",
  "historyDescriptor",
  "auditHead",
  "campaignDigest",
  "campaignRootDigest",
  "batchDigest",
  "queryId",
  "candidate",
  "versions",
  "nativeCandidateContents",
  "parentIdentity",
  "targetIdentity",
  "lifecycleDigests",
  "nativeEvaluationPlanDigest",
  "evaluationMappingDigest",
  "nativeBatchEvidenceDigest",
  "statisticsPlanDigest",
  "statisticsReportDigest",
  "statisticsRegistration",
  "reservationRecord",
  "fullRowCensusDigest",
  "statisticalRowSetDigest",
  "plannedActorObservations",
  "observedRowClaims",
  "missingActorObservations",
  "originalNativeGateVetoChildIds",
  "budget",
  "verifiedControlEvidence",
  "unverifiedProductionPrerequisites",
  "blockingReasons",
  "decision",
  "qualityVerdictVerified",
  "grantsFinalEvaluationAuthority",
  "grantsMutationOrDispatchAuthority",
];
const CONTROL_FIELDS = [
  "originalHistoryJournalBound",
  "originalHistoryHeadReverified",
  "originalReceiptInventoryReverified",
  "signedReceiptFreshnessReverified",
  "allCohortInventoriesAuthenticated",
  "presentedFinalReceiptRowsAuthenticated",
  "completeSignedRows",
  "fullTriangleDenominatorRetained",
  "fullTriangleRowsPresent",
  "controlledHistoryRegistrationOrderVerified",
];
function same(left, right, label) {
  if (rrsiCanonical(left) !== rrsiCanonical(right))
    rrsiFail(`recorded quality ${label} differs`, "CC_RRSI_HISTORY_CORRUPT");
}

/** Context must come from the actual applied History state, never receipt claims. */
export function verifyRecordedRrsiNativeQualityReceipt(input, contextInput) {
  const value = snapshotRrsiData(input);
  const names = [
    "descriptor",
    "rootResolution",
    "batchResolution",
    "statisticsPlan",
    "observedHead",
  ];
  if (
    !contextInput ||
    isProxy(contextInput) ||
    Object.getPrototypeOf(contextInput) !== Object.prototype ||
    Reflect.ownKeys(contextInput).length !== names.length
  )
    rrsiFail("recorded quality context requires plain own fields");
  // The independently bounded root, batch resolution and plan must not be
  // combined into one artificial two-MiB input document.
  const context = Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(contextInput, name);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("recorded quality context cannot use accessors");
      return [name, snapshotRrsiData(field.value)];
    }),
  );
  rrsiExact(
    value,
    [
      "schema",
      ...FIELDS,
      "structuralOnly",
      "authenticated",
      "readyForExecution",
      "qualifiesForPromotion",
      "qualityReceiptDigest",
    ],
    "recorded quality receipt",
  );
  const core = Object.fromEntries(FIELDS.map((field) => [field, value[field]]));
  same(
    value,
    rrsiEnvelope(
      RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA,
      "qualityReceiptDigest",
      core,
    ),
    "envelope",
  );
  const resolution = context.batchResolution,
    { batch, campaign } = resolution;
  if (!["selection", "generalization"].includes(batch.stage))
    rrsiFail("recorded quality stage is invalid");
  const plan = verifyRrsiNativeGroupStatisticsPlan(context.statisticsPlan, {
    campaign,
    batch,
  });
  const root = buildRrsiEvalCampaignPlan(context.rootResolution);
  const registration = resolution.statisticsRegistration
    ? buildRrsiNativeStatisticsRegistrationBindings(
        resolution.statisticsRegistration,
        resolution.reservationRecord,
      )
    : null;
  const expected = {
    assessmentKind: `${batch.stage}-required-quality`,
    stage: batch.stage,
    tenantId: campaign.tenantId,
    goalId: campaign.goalId,
    historyDescriptor: context.descriptor,
    auditHead: context.observedHead,
    campaignDigest: campaign.campaignDigest,
    campaignRootDigest: root.campaignRootDigest,
    batchDigest: batch.batchDigest,
    queryId: batch.queryId,
    candidate: batch.candidate,
    versions: batch.versions,
    nativeCandidateContents: batch.nativeCandidateContents,
    parentIdentity: batch.parentIdentity,
    targetIdentity: batch.targetIdentity,
    lifecycleDigests: batch.lifecycleDigests,
    nativeEvaluationPlanDigest: batch.nativeEvaluationPlanDigest,
    evaluationMappingDigest: batch.evaluationMappingDigest,
    statisticsPlanDigest: plan.statisticsPlanDigest,
    statisticsRegistration: registration,
    reservationRecord: resolution.reservationRecord,
    unverifiedProductionPrerequisites:
      RRSI_NATIVE_QUALITY_UNVERIFIED_PREREQUISITES,
    decision: "HOLD",
    qualityVerdictVerified: false,
    grantsFinalEvaluationAuthority: false,
    grantsMutationOrDispatchAuthority: false,
  };
  for (const [field, expectedValue] of Object.entries(expected))
    same(value[field], expectedValue, field);
  for (const field of [
    "nativeBatchEvidenceDigest",
    "statisticsReportDigest",
    "fullRowCensusDigest",
    "statisticalRowSetDigest",
  ])
    rrsiDigest(value[field], `quality ${field}`);
  const planned = batch.children.reduce(
    (sum, child) =>
      sum +
      Object.keys(child.byArm).length *
        Object.values(child.plannedObservationsPerArmByPartition).reduce(
          (total, count) => total + count,
          0,
        ),
    0,
  );
  same(value.plannedActorObservations, planned, "planned denominator");
  rrsiInteger(value.observedRowClaims, "quality observed rows", 0, planned);
  same(
    value.missingActorObservations,
    planned - value.observedRowClaims,
    "missing denominator",
  );
  same(
    value.budget,
    {
      declaredBudgetSettlementComplete: resolution.children.every((child) =>
        child.states.every((arm) => arm.status === "settled"),
      ),
      budgetOverrun: resolution.budgetOverrun,
      allocationBinding: batch.batchDigest,
      declaredAccountingOnly: true,
    },
    "budget snapshot",
  );
  rrsiExact(
    value.verifiedControlEvidence,
    CONTROL_FIELDS,
    "recorded quality controls",
  );
  for (const field of CONTROL_FIELDS)
    rrsiBoolean(
      value.verifiedControlEvidence[field],
      `quality control ${field}`,
    );
  for (const field of [
    "originalHistoryJournalBound",
    "originalHistoryHeadReverified",
    "originalReceiptInventoryReverified",
    "signedReceiptFreshnessReverified",
    "presentedFinalReceiptRowsAuthenticated",
    "fullTriangleDenominatorRetained",
  ])
    same(value.verifiedControlEvidence[field], true, field);
  same(
    value.verifiedControlEvidence.controlledHistoryRegistrationOrderVerified,
    registration !== null,
    "registration control",
  );
  same(
    value.verifiedControlEvidence.fullTriangleRowsPresent,
    value.missingActorObservations === 0,
    "row completeness",
  );
  if (
    value.verifiedControlEvidence.completeSignedRows &&
    !value.verifiedControlEvidence.fullTriangleRowsPresent
  )
    rrsiFail("recorded quality complete rows contradict denominator");
  if (
    !Array.isArray(value.originalNativeGateVetoChildIds) ||
    new Set(value.originalNativeGateVetoChildIds).size !==
      value.originalNativeGateVetoChildIds.length ||
    value.originalNativeGateVetoChildIds.some(
      (id) => !batch.children.some((child) => child.childId === id),
    )
  )
    rrsiFail("recorded quality Gate veto inventory differs");
  if (
    !Array.isArray(value.blockingReasons) ||
    value.blockingReasons.some(
      (reason) =>
        typeof reason !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(reason),
    )
  )
    rrsiFail("recorded quality blocking reasons are invalid");
  same(
    value.blockingReasons,
    [...new Set(value.blockingReasons)].sort(),
    "blocking reason order",
  );
  const reasons = [...RRSI_NATIVE_QUALITY_REQUIRED_REASONS];
  if (!value.verifiedControlEvidence.allCohortInventoriesAuthenticated)
    reasons.push("MISSING_COHORT_EVIDENCE");
  if (!registration) reasons.push("STATISTICAL_PROTOCOL_NOT_PREREGISTERED");
  if (value.missingActorObservations)
    reasons.push("INCOMPLETE_TRIANGLE_DENOMINATOR");
  if (!value.verifiedControlEvidence.completeSignedRows)
    reasons.push("MISSING_SIGNED_ROWS");
  if (value.originalNativeGateVetoChildIds.length)
    reasons.push("NATIVE_GATE_VETO");
  if (!value.budget.declaredBudgetSettlementComplete)
    reasons.push("UNSETTLED_NATIVE_BUDGET");
  if (value.budget.budgetOverrun) reasons.push("BUDGET_EXCEEDED");
  if (reasons.some((reason) => !value.blockingReasons.includes(reason)))
    rrsiFail("recorded quality drops required HOLD reasons");
  return rrsiEnvelope(
    RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA,
    "qualityReceiptDigest",
    core,
  );
}
