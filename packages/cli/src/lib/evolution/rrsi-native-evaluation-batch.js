/** Frozen native request inventory. Declarations do not authenticate provider billing. */
import { isProxy } from "node:util/types";
import {
  RRSI_BUDGET_FIELDS,
  verifyRrsiCampaign,
  verifyRrsiCandidate,
} from "./rrsi-contracts.js";
import { buildRrsiNativeEvaluationPlan } from "./rrsi-native-evaluation-plan.js";
import {
  computeEvolutionEvalLaunchRequestDigest,
  computeEvolutionEvalContextDigest,
} from "./evolution-eval-gate.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiId,
  rrsiDigest,
  rrsiInteger,
  rrsiHash,
  rrsiCanonical,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_BATCH_SCHEMA =
  "chainlesschain.rrsi-native-evaluation-batch/v1";
export const RRSI_NATIVE_RESERVATION_SCHEMA =
  "chainlesschain.rrsi-native-reservation/v1";
export const RRSI_NATIVE_SETTLEMENT_SCHEMA =
  "chainlesschain.rrsi-native-settlement/v1";
export const RRSI_NATIVE_EXECUTION_UNITS = Object.freeze([
  "actorInvocations",
  "gradeInvocations",
  "safetyInvocations",
  "resetOperations",
  "providerRequests",
]);
export const RRSI_NATIVE_BINDING_FIELDS = Object.freeze([
  "queryId",
  "childId",
  "batchDigest",
  "stage",
  "role",
  "variant",
  "pairId",
  "arm",
  "cohortId",
  "nativePlanDigest",
  "requestDigest",
  "evaluationContextDigest",
  "invocationDigest",
  "nativeArtifactId",
  "nativeContentDigest",
  "lifecycleDigest",
  "executionUnitsDigest",
  "costInventoryDigest",
]);
const PAIRS = {
  "rrsi-vs-rsi": ["rrsi", "rsi"],
  "rrsi-vs-baseline": ["rrsi", "baseline"],
  "rsi-vs-baseline": ["rsi", "baseline"],
};
const ROLES = { selection: ["selection"], generalization: ["gate", "audit"] };
const key = (value) =>
  JSON.stringify([value.role, value.variant, value.pairId, value.slotId]);
const childId = (queryId, cohortId, slotId) =>
  `child.${rrsiHash("chainlesschain.rrsi-native-child/v1", { queryId, cohortId, slotId }).slice(7)}`;
const same = (left, right, label) => {
  if (rrsiCanonical(left) !== rrsiCanonical(right))
    rrsiFail(`${label} differs`);
};

export function isRrsiNativeReservation(value) {
  return value.schema === RRSI_NATIVE_RESERVATION_SCHEMA;
}

export function rrsiNativeUnitCount(units) {
  return rrsiInteger(
    RRSI_NATIVE_EXECUTION_UNITS.reduce((sum, name) => sum + units[name], 0),
    "charged execution unit count",
  );
}

function textField(value, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256)
    rrsiFail(`${label} must be a bounded string`);
}

function allocation(value, actorCount) {
  rrsiExact(
    value,
    ["budget", "executionUnits", "costInventoryDigest"],
    "native per-arm allocation",
  );
  rrsiExact(value.budget, RRSI_BUDGET_FIELDS, "native resource ceilings");
  for (const field of RRSI_BUDGET_FIELDS)
    rrsiInteger(value.budget[field], field);
  rrsiExact(
    value.executionUnits,
    RRSI_NATIVE_EXECUTION_UNITS,
    "native execution units",
  );
  for (const name of RRSI_NATIVE_EXECUTION_UNITS)
    rrsiInteger(value.executionUnits[name], name);
  if (
    value.executionUnits.actorInvocations !== actorCount ||
    value.executionUnits.gradeInvocations !== actorCount ||
    value.executionUnits.safetyInvocations !== actorCount
  )
    rrsiFail(
      "native allocation must retain every actor, grade and safety invocation",
    );
  rrsiDigest(value.costInventoryDigest, "frozen per-arm cost inventory");
  if (value.budget.maxExecutions < rrsiNativeUnitCount(value.executionUnits))
    rrsiFail("native allocation cannot cover all charged execution units");
  return value;
}

/** The live API always compiles the contextual native graph with its static validators. */
export function buildRrsiNativeEvaluationBatch(input) {
  const fields = ["planContext", "candidate", "queryId", "allocations"];
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== fields.length
  )
    rrsiFail("native batch requires plain own fields");
  const options = Object.fromEntries(
    fields.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("native batch cannot use accessors");
      return [name, field.value];
    }),
  );
  const plan = buildRrsiNativeEvaluationPlan(options.planContext);
  const campaign = verifyRrsiCampaign(options.planContext.context.campaign);
  const candidate = verifyRrsiCandidate(campaign, options.candidate);
  const queryId = rrsiId(options.queryId, "native query ID");
  const allocations = snapshotRrsiData(options.allocations);
  if (!Array.isArray(allocations))
    rrsiFail("native allocations must be an array");
  const bySlot = new Map();
  for (const value of allocations) {
    rrsiExact(
      value,
      ["cohortId", "slotId", "byArm"],
      "native child allocation",
    );
    const id = JSON.stringify([value.cohortId, value.slotId]);
    if (bySlot.has(id)) rrsiFail("native allocations duplicate a child");
    bySlot.set(id, value.byArm);
  }
  const nativeCandidateContents = Object.fromEntries(
    ["rsi", "rrsi"].map((arm) => [
      arm,
      plan.cases.find((entry) => entry.candidateArm === arm).nativePlan
        .candidateContentDigest,
    ]),
  );
  const children = plan.cases.flatMap((entry) =>
    entry.slots.map((slot, index) => {
      const cell = entry.nativePlan.cells[index];
      const arms = bySlot.get(JSON.stringify([slot.cohortId, slot.slotId]));
      if (!arms) rrsiFail("native allocation omits a complete paired attempt");
      return {
        childId: childId(queryId, slot.cohortId, slot.slotId),
        role: entry.role,
        variant: entry.variant,
        pairId: entry.pairId,
        candidateArm: entry.candidateArm,
        baselineArm: entry.baselineArm,
        variantMappingDigest: entry.variantMappingDigest,
        recipeDigest: entry.recipeDigest,
        ...slot,
        invocationDigest: rrsiHash("chainlesschain.rrsi-native-invocation/v1", {
          invocationId: cell.invocationId,
          invocationNonce: cell.invocationNonce,
        }),
        invocationIdDigest: rrsiHash(
          "chainlesschain.rrsi-native-invocation-id/v1",
          cell.invocationId,
        ),
        invocationNonceDigest: rrsiHash(
          "chainlesschain.rrsi-native-invocation-nonce/v1",
          cell.invocationNonce,
        ),
        byArm: arms,
      };
    }),
  );
  if (bySlot.size !== children.length)
    rrsiFail("native allocation includes foreign attempts");
  const result = rrsiEnvelope(RRSI_NATIVE_BATCH_SCHEMA, "batchDigest", {
    queryId,
    campaignDigest: plan.campaignDigest,
    candidate,
    nativeEvaluationPlanDigest: plan.nativeEvaluationPlanDigest,
    evaluationMappingDigest: plan.evaluationMappingDigest,
    stage: plan.stage,
    versions: plan.versions,
    nativeCandidateContents,
    lifecycleDigests: plan.lifecycleDigests,
    parentIdentity: plan.parentIdentity,
    targetIdentity: plan.targetIdentity,
    children,
    costAttribution: "frozen-per-arm-request-inventory/v1",
    executionCountSemantics: "actor-grade-safety-reset-and-provider-nodes/v1",
    legacyCostsChargedToEveryArm: true,
    nativeContentDerivationVerified: false,
    requestCostGraphVerified: false,
    billingComplete: false,
    lifecycleProvenanceVerified: false,
    sourceProvenanceVerified: false,
    readyForNativeAdmission: false,
  });
  return normalizeRrsiNativeEvaluationBatch(result, campaign);
}

/** Static readback of a declaration accepted by the contextual compiler and retained in History. */
export function normalizeRrsiNativeEvaluationBatch(input, campaignInput) {
  const value = snapshotRrsiData(input);
  const campaign = verifyRrsiCampaign(campaignInput);
  const coreFields = [
    "queryId",
    "campaignDigest",
    "candidate",
    "nativeEvaluationPlanDigest",
    "evaluationMappingDigest",
    "stage",
    "versions",
    "nativeCandidateContents",
    "lifecycleDigests",
    "parentIdentity",
    "targetIdentity",
    "children",
    "costAttribution",
    "executionCountSemantics",
    "legacyCostsChargedToEveryArm",
    "nativeContentDerivationVerified",
    "requestCostGraphVerified",
    "billingComplete",
    "lifecycleProvenanceVerified",
    "sourceProvenanceVerified",
    "readyForNativeAdmission",
  ];
  rrsiExact(
    value,
    [
      "schema",
      ...coreFields,
      "structuralOnly",
      "authenticated",
      "readyForExecution",
      "qualifiesForPromotion",
      "batchDigest",
    ],
    "native batch declaration",
  );
  rrsiId(value.queryId, "native query ID");
  if (
    value.campaignDigest !== campaign.campaignDigest ||
    campaign.candidateKind !== "skill"
  )
    rrsiFail("native batch campaign differs");
  verifyRrsiCandidate(campaign, value.candidate);
  for (const name of ["nativeEvaluationPlanDigest", "evaluationMappingDigest"])
    rrsiDigest(value[name], name);
  if (typeof value.stage !== "string" || !Object.hasOwn(ROLES, value.stage))
    rrsiFail("native batch stage differs");
  if (
    value.costAttribution !== "frozen-per-arm-request-inventory/v1" ||
    value.executionCountSemantics !==
      "actor-grade-safety-reset-and-provider-nodes/v1" ||
    value.legacyCostsChargedToEveryArm !== true
  )
    rrsiFail("native batch accounting protocol differs");
  for (const name of [
    "nativeContentDerivationVerified",
    "requestCostGraphVerified",
    "billingComplete",
    "lifecycleProvenanceVerified",
    "sourceProvenanceVerified",
    "readyForNativeAdmission",
  ])
    if (value[name] !== false)
      rrsiFail("native declaration cannot claim execution authority");
  for (const name of ["versions", "lifecycleDigests"]) {
    rrsiExact(value[name], campaign.experiment.arms, name);
    for (const arm of campaign.experiment.arms)
      rrsiDigest(value[name][arm], `${name}.${arm}`);
  }
  rrsiExact(
    value.nativeCandidateContents,
    ["rsi", "rrsi"],
    "native candidate content identities",
  );
  for (const digest of Object.values(value.nativeCandidateContents))
    rrsiDigest(digest, "native content digest");
  rrsiExact(
    value.parentIdentity,
    [
      "contentDigest",
      "revision",
      "dependencyLockDigest",
      "runtimeManifestDigest",
      "targetMatrixRoot",
    ],
    "native parent identity",
  );
  for (const [name, field] of Object.entries(value.parentIdentity))
    if (name === "revision") rrsiInteger(field, name);
    else rrsiDigest(field, name);
  if (!Array.isArray(value.targetIdentity) || !value.targetIdentity.length)
    rrsiFail("native target identities are missing");
  const targets = new Map();
  for (const target of value.targetIdentity) {
    if (!Array.isArray(target) || target.length !== 4 || targets.has(target[0]))
      rrsiFail("native target identities are duplicated or invalid");
    target
      .slice(0, 3)
      .forEach((field) => textField(field, "native target identity"));
    rrsiDigest(target[3], "target environment digest");
    targets.set(target[0], target);
  }
  const variants = ["clean", ...campaign.experiment.perturbations];
  if (
    !Array.isArray(value.children) ||
    value.children.length !==
      ROLES[value.stage].length *
        variants.length *
        Object.keys(PAIRS).length *
        targets.size
  )
    rrsiFail("native batch omits the full triangle denominator");
  const seen = new Set(),
    invocations = new Set(),
    invocationIds = new Set(),
    invocationNonces = new Set(),
    plans = new Map();
  const childFields = [
    "childId",
    "role",
    "variant",
    "pairId",
    "candidateArm",
    "baselineArm",
    "variantMappingDigest",
    "recipeDigest",
    "cohortId",
    "slotId",
    "nativePlanDigest",
    "request",
    "requestDigest",
    "expectedContext",
    "evaluationContextDigest",
    "plannedObservationsPerArmByPartition",
    "pmTrainingPartitionDigest",
    "invocationDigest",
    "invocationIdDigest",
    "invocationNonceDigest",
    "byArm",
  ];
  const totals = Object.fromEntries(
    campaign.experiment.arms.map((arm) => [
      arm,
      Object.fromEntries(RRSI_BUDGET_FIELDS.map((name) => [name, 0])),
    ]),
  );
  for (const child of value.children) {
    rrsiExact(child, childFields, "native paired child");
    if (
      !ROLES[value.stage].includes(child.role) ||
      !variants.includes(child.variant) ||
      !Object.hasOwn(PAIRS, child.pairId) ||
      !targets.has(child.slotId) ||
      seen.has(key(child))
    )
      rrsiFail("native batch contains foreign or duplicate children");
    seen.add(key(child));
    same(
      [child.candidateArm, child.baselineArm],
      PAIRS[child.pairId],
      "native pair arms",
    );
    for (const name of [
      "variantMappingDigest",
      "recipeDigest",
      "nativePlanDigest",
      "requestDigest",
      "evaluationContextDigest",
      "pmTrainingPartitionDigest",
      "invocationDigest",
      "invocationIdDigest",
      "invocationNonceDigest",
    ])
      rrsiDigest(child[name], name);
    const caseKey = JSON.stringify([child.role, child.variant, child.pairId]);
    const cohortId = `rrsi-eval.${rrsiHash("chainlesschain.rrsi-native-cohort-identity/v1", { campaignDigest: value.campaignDigest, stage: value.stage, role: child.role, variant: child.variant, pairId: child.pairId, nativePlanDigest: child.nativePlanDigest }).slice(7)}`;
    if (
      child.cohortId !== cohortId ||
      child.childId !== childId(value.queryId, cohortId, child.slotId)
    )
      rrsiFail("native child identity differs");
    if (plans.has(caseKey) && plans.get(caseKey) !== child.nativePlanDigest)
      rrsiFail("native target children change their original plan");
    if (
      !plans.has(caseKey) &&
      [...plans.values()].includes(child.nativePlanDigest)
    )
      rrsiFail("native cases reuse their original plan");
    plans.set(caseKey, child.nativePlanDigest);
    if (
      invocations.has(child.invocationDigest) ||
      invocationIds.has(child.invocationIdDigest) ||
      invocationNonces.has(child.invocationNonceDigest)
    )
      rrsiFail("native children reuse invocation identities");
    invocations.add(child.invocationDigest);
    invocationIds.add(child.invocationIdDigest);
    invocationNonces.add(child.invocationNonceDigest);
    const target = targets.get(child.slotId);
    const context = {
      planDigest: child.nativePlanDigest,
      targetMatrixRoot: value.parentIdentity.targetMatrixRoot,
      cellId: child.slotId,
      runtimeId: target[1],
    };
    rrsiExact(
      child.request,
      [
        "suiteRef",
        "candidateId",
        "baselineId",
        "targetEnvironmentRef",
        "evaluationContext",
      ],
      "native launch request",
    );
    textField(child.request.suiteRef, "native suite reference");
    same(child.request.evaluationContext, context, "native request context");
    if (
      child.request.candidateId !== value.versions[child.candidateArm] ||
      child.request.baselineId !== value.versions[child.baselineArm] ||
      child.request.targetEnvironmentRef !== target[2]
    )
      rrsiFail("native request changes its arm or target");
    if (
      computeEvolutionEvalLaunchRequestDigest(child.request) !==
      child.requestDigest
    )
      rrsiFail("native launch request digest differs");
    rrsiExact(
      child.expectedContext,
      [
        "planDigest",
        "targetMatrixRoot",
        "cellId",
        "runtimeId",
        "tenantId",
        "targetEnvironmentRef",
        "environmentDigest",
        "candidateId",
        "baselineId",
        "suiteDigest",
        "policyDigest",
        "evaluationAuthorityRoot",
      ],
      "native expected context",
    );
    const expected = {
      ...context,
      tenantId: campaign.tenantId,
      targetEnvironmentRef: target[2],
      environmentDigest: target[3],
      candidateId: child.request.candidateId,
      baselineId: child.request.baselineId,
    };
    for (const [name, field] of Object.entries(expected))
      if (child.expectedContext[name] !== field)
        rrsiFail("native expected context changes request scope");
    for (const name of [
      "suiteDigest",
      "policyDigest",
      "evaluationAuthorityRoot",
    ])
      rrsiDigest(child.expectedContext[name], name);
    if (
      computeEvolutionEvalContextDigest(child.expectedContext) !==
      child.evaluationContextDigest
    )
      rrsiFail("native evaluation context digest differs");
    const partitions =
      child.role === "gate"
        ? ["gate-validation", "gate-test"]
        : child.role === "selection"
          ? ["select"]
          : ["audit"];
    rrsiExact(
      child.plannedObservationsPerArmByPartition,
      partitions,
      "native partition denominator",
    );
    for (const partition of partitions)
      if (
        child.plannedObservationsPerArmByPartition[partition] !==
        campaign.dataset.pools[partition].taskCount *
          campaign.experiment.seeds.length
      )
        rrsiFail("native partition observation denominator differs");
    const actorCount = Object.values(
      child.plannedObservationsPerArmByPartition,
    ).reduce((sum, count) => sum + count, 0);
    rrsiExact(child.byArm, PAIRS[child.pairId], "native child arms");
    for (const [arm, entry] of Object.entries(child.byArm)) {
      allocation(entry, actorCount);
      for (const field of RRSI_BUDGET_FIELDS)
        totals[arm][field] = rrsiInteger(
          totals[arm][field] + entry.budget[field],
          "native per-arm total",
        );
    }
  }
  const cap =
    value.stage === "selection"
      ? campaign.budget.selectionPerExploringArm
      : campaign.budget.finalEvaluationPerArm;
  for (const arm of campaign.experiment.arms)
    for (const name of RRSI_BUDGET_FIELDS)
      if (
        totals[arm][name] > cap[name] ||
        totals[arm][name] > campaign.budget.totalPerArm[name]
      )
        rrsiFail(
          "native batch exceeds a frozen per-arm budget",
          "CC_RRSI_BUDGET_EXCEEDED",
        );
  const rebuilt = rrsiEnvelope(
    RRSI_NATIVE_BATCH_SCHEMA,
    "batchDigest",
    Object.fromEntries(coreFields.map((name) => [name, value[name]])),
  );
  same(value, rebuilt, "native batch envelope");
  return rebuilt;
}
