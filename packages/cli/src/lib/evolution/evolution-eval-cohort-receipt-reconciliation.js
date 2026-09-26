/** Join a sealed admission inventory to presented final Eval receipts.
 * Missing receipts stay unresolved; a caller-supplied set cannot prove global coverage.
 */
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  resolveEvolutionEvalCohortEnrollment,
  resolveEvolutionEvalCohortReconciliation,
} from "./evolution-eval-cohort-enrollment.js";
import {
  computeEvolutionEvalContextDigest,
  computeEvolutionEvalLaunchRequestDigest,
  isEvolutionEvalReceiptVerifier,
  verifyEvolutionEvalReceipt,
} from "./evolution-eval-gate.js";
import { verifyPmExplorationEffectAttemptCohort } from "./pm-exploration-benchmark.js";

export const EVOLUTION_EVAL_COHORT_RECEIPT_RECONCILIATION_SCHEMA =
  "chainlesschain.evolution-eval-cohort-receipt-reconciliation/v1";
export const EVOLUTION_EVAL_COHORT_RECEIPT_RECONCILIATION_FAILED_CODE =
  "CC_EVOLUTION_EVAL_COHORT_RECEIPT_RECONCILIATION_FAILED";
export const PM_EXPLORATION_ADMISSION_BOUND_COHORT_SCHEMA =
  "chainlesschain.pm-exploration-admission-bound-cohort/v1";

function fail(message) {
  const error = new Error(message);
  error.code = EVOLUTION_EVAL_COHORT_RECEIPT_RECONCILIATION_FAILED_CODE;
  throw error;
}

function snapshot(value, budget = { nodes: 0, chars: 0 }, depth = 0) {
  if (++budget.nodes > 50_000 || depth > 50)
    fail("cohort receipt evidence exceeds structural limits");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    budget.chars += value.length;
    if (budget.chars > 4_000_000)
      fail("cohort receipt evidence exceeds size limit");
    return value;
  }
  if (!value || typeof value !== "object" || isProxy(value))
    fail("cohort receipt evidence must contain plain JSON data");
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      fail("cohort receipt array must be dense own data");
    return Array.from({ length: value.length }, (_, index) => {
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || !("value" in property))
        fail("cohort receipt array must be own data");
      return snapshot(property.value, budget, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail("cohort receipt evidence must be plain data");
  return Object.fromEntries(
    Reflect.ownKeys(value).map((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        !property?.enumerable ||
        !("value" in property)
      )
        fail("cohort receipt fields must be own data");
      budget.chars += key.length;
      if (budget.chars > 4_000_000)
        fail("cohort receipt evidence exceeds size limit");
      return [key, snapshot(property.value, budget, depth + 1)];
    }),
  );
}

function exact(value, keys, label) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail(`${label} must contain exactly its registered fields`);
  return value;
}

function captureRecord(value, keys, label) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    fail(`${label} must contain exactly its own data fields`);
  return Object.fromEntries(
    keys.map((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property?.enumerable || !("value" in property))
        fail(`${label} must contain exactly its own data fields`);
      return [key, property.value];
    }),
  );
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(
  value,
  schema = EVOLUTION_EVAL_COHORT_RECEIPT_RECONCILIATION_SCHEMA,
) {
  return `sha256:${createHash("sha256")
    .update(`${schema}\0${canonical(value)}`)
    .digest("hex")}`;
}

function frozen(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** Re-audit the sealed admission set after signature checks. */
export async function reconcileEvolutionEvalCohortReceipts(
  authority,
  verifier,
  input,
) {
  if (!isEvolutionEvalReceiptVerifier(verifier))
    fail("a branded final Eval receipt verifier is required");
  const source = exact(
    snapshot(input),
    ["cohortId", "slots"],
    "cohort receipt source",
  );
  if (
    typeof source.cohortId !== "string" ||
    !Array.isArray(source.slots) ||
    source.slots.length > 32
  )
    fail("cohort receipt slots are invalid");
  const lookup = { cohortId: source.cohortId };
  const enrollment = resolveEvolutionEvalCohortEnrollment(authority, lookup);
  const sealed = await resolveEvolutionEvalCohortReconciliation(
    authority,
    lookup,
  );
  if (source.slots.length !== enrollment.evidence.slots.length)
    fail("cohort receipt source must cover every enrolled slot");
  const admitted = new Map(
    sealed.inventory.admissions.map((entry) => [entry.slotId, entry]),
  );
  const slots = [];
  let signedReceiptCount = 0;
  let receiptUnavailableCount = 0;
  for (const [index, item] of source.slots.entries()) {
    const entry = exact(
      item,
      ["slotId", "launchRequest", "receipt", "receiptContext"],
      "cohort receipt slot",
    );
    const registered = enrollment.evidence.slots[index];
    if (entry.slotId !== registered.slotId)
      fail("cohort receipt slots differ from enrolled order");
    const admission = admitted.get(entry.slotId);
    if (entry.receipt === null) {
      if (entry.launchRequest !== null || entry.receiptContext !== null)
        fail("missing receipt cannot carry a substituted source");
      if (admission) receiptUnavailableCount += 1;
      slots.push({
        slotId: entry.slotId,
        status: admission ? "receipt-unavailable" : "unadmitted",
        admissionDigest: admission?.admissionDigest ?? null,
        runId: admission?.runId ?? null,
        receiptDigest: null,
        decision: null,
      });
      continue;
    }
    if (!admission || !entry.launchRequest || !entry.receiptContext)
      fail("signed receipt has no matching admitted slot or context");
    const request = exact(
      entry.launchRequest,
      [
        "suiteRef",
        "candidateId",
        "baselineId",
        "targetEnvironmentRef",
        "evaluationContext",
      ],
      "cohort launch request",
    );
    const context = exact(
      entry.receiptContext,
      [
        "runId",
        "runNonce",
        "suiteDigest",
        "policyDigest",
        "evaluationAuthorityRoot",
        "targetEnvironmentRef",
        "evaluationContextDigest",
        "candidateId",
        "baselineId",
        "environmentDigest",
        "tenantId",
        "provenanceAudience",
        "trainerAuthority",
        "trainerRevision",
      ],
      "cohort receipt context",
    );
    const run = exact(
      request.evaluationContext,
      ["planDigest", "targetMatrixRoot", "cellId", "runtimeId"],
      "cohort evaluation context",
    );
    if (
      computeEvolutionEvalLaunchRequestDigest(request) !==
        admission.requestDigest ||
      run.planDigest !== registered.evaluationPlanDigest ||
      run.cellId !== entry.slotId ||
      request.candidateId !== context.candidateId ||
      request.baselineId !== context.baselineId ||
      request.targetEnvironmentRef !== context.targetEnvironmentRef ||
      context.runId !== admission.runId ||
      context.runNonce !== admission.runNonce ||
      context.tenantId !== enrollment.evidence.descriptor.tenantId ||
      context.policyDigest !== registered.policyDigest ||
      context.evaluationAuthorityRoot !== registered.evaluationAuthorityRoot ||
      context.evaluationContextDigest !==
        computeEvolutionEvalContextDigest({
          ...run,
          tenantId: context.tenantId,
          targetEnvironmentRef: context.targetEnvironmentRef,
          environmentDigest: context.environmentDigest,
          candidateId: context.candidateId,
          baselineId: context.baselineId,
          suiteDigest: context.suiteDigest,
          policyDigest: context.policyDigest,
          evaluationAuthorityRoot: context.evaluationAuthorityRoot,
        })
    )
      fail("signed receipt differs from admitted request or enrolled cell");
    const verified = await verifyEvolutionEvalReceipt(
      verifier,
      entry.receipt,
      context,
    );
    signedReceiptCount += 1;
    slots.push({
      slotId: entry.slotId,
      status: "signed-receipt",
      admissionDigest: admission.admissionDigest,
      runId: admission.runId,
      receiptDigest: verified.receiptDigest,
      decision: verified.decision,
    });
  }
  const finalSeal = await resolveEvolutionEvalCohortReconciliation(
    authority,
    lookup,
  );
  if (canonical(finalSeal) !== canonical(sealed))
    fail("sealed Ledger inventory changed during receipt verification");
  const core = {
    schema: EVOLUTION_EVAL_COHORT_RECEIPT_RECONCILIATION_SCHEMA,
    cohortId: source.cohortId,
    enrollmentDigest: sealed.enrollmentDigest,
    sealDigest: sealed.sealDigest,
    admissionInventoryAuthenticated: true,
    signedReceiptCount,
    receiptUnavailableCount,
    unadmittedSlotCount: sealed.inventory.unadmittedSlotIds.length,
    slots,
    presentedReceiptsAuthenticated: true,
    receiptSetCompletenessAuthenticated: false,
    executionCoverageAuthenticated: false,
    cohortCompletenessAuthenticated: false,
    promotionAuthority: false,
  };
  return frozen({ ...core, reconciliationDigest: hash(core) });
}

/** Bind the independently verified PM denominator to the signed admission/receipt census. */
export async function reconcilePmExplorationAdmissionBoundCohort(
  authority,
  verifier,
  input,
) {
  if (!isEvolutionEvalReceiptVerifier(verifier))
    fail("a branded final Eval receipt verifier is required");
  const source = captureRecord(
    input,
    ["cohortId", "receiptSlots", "cohortSource", "cohort", "registration"],
    "PM admission-bound cohort source",
  );
  const receiptSlots = snapshot(source.receiptSlots);
  const registration = exact(
    snapshot(source.registration),
    ["cohortId", "planDigest", "slots"],
    "PM cohort registration",
  );
  // This verifier snapshots its source and expected context before its first await.
  const pm = await verifyPmExplorationEffectAttemptCohort(
    verifier,
    { source: source.cohortSource, cohort: source.cohort },
    registration,
  );
  const joined = await reconcileEvolutionEvalCohortReceipts(
    authority,
    verifier,
    { cohortId: source.cohortId, slots: receiptSlots },
  );
  const enrollment = resolveEvolutionEvalCohortEnrollment(authority, {
    cohortId: source.cohortId,
  });
  if (
    pm.cohortId !== source.cohortId ||
    registration.cohortId !== source.cohortId ||
    pm.planDigest !== enrollment.evidence.plan.planDigest ||
    registration.planDigest !== pm.planDigest ||
    pm.registeredSlotCount !== enrollment.evidence.manifest.slotIds.length ||
    pm.perArmDenominator !==
      enrollment.evidence.manifest.plannedTestObservationsPerArm ||
    canonical(registration.slots.map((slot) => slot.slotId)) !==
      canonical(enrollment.evidence.manifest.slotIds)
  )
    fail("PM denominator differs from signed cohort enrollment");
  for (const [index, attempt] of pm.attempts.entries()) {
    const admitted = joined.slots[index];
    if (
      attempt.slotId !== admitted.slotId ||
      (admitted.status === "signed-receipt" &&
        (attempt.kind === "receipt-unavailable" ||
          attempt.runId !== admitted.runId ||
          attempt.receiptDigest !== admitted.receiptDigest)) ||
      (admitted.status !== "signed-receipt" &&
        (attempt.kind !== "receipt-unavailable" ||
          attempt.runId !== null ||
          attempt.receiptDigest !== null))
    )
      fail("PM attempt differs from its sealed admission and final receipt");
  }
  if (
    pm.authenticatedAttemptCount !== joined.signedReceiptCount ||
    (pm.missingReceiptCount ?? 0) !==
      joined.receiptUnavailableCount + joined.unadmittedSlotCount
  )
    fail("PM attempt counts differ from sealed admission inventory");
  const core = {
    schema: PM_EXPLORATION_ADMISSION_BOUND_COHORT_SCHEMA,
    cohortId: source.cohortId,
    planDigest: pm.planDigest,
    enrollmentDigest: joined.enrollmentDigest,
    sealDigest: joined.sealDigest,
    receiptReconciliationDigest: joined.reconciliationDigest,
    attemptCohortDigest: pm.cohortDigest,
    registeredSlotCount: pm.registeredSlotCount,
    signedReceiptCount: joined.signedReceiptCount,
    admittedMissingReceiptCount: joined.receiptUnavailableCount,
    unadmittedSlotCount: joined.unadmittedSlotCount,
    perArmDenominator: pm.perArmDenominator,
    baseline: pm.baseline,
    candidate: pm.candidate,
    admissionAndAttemptBindingAuthenticated: true,
    receiptSetCompletenessAuthenticated: false,
    executionCoverageAuthenticated: false,
    cohortCompletenessAuthenticated: false,
    reportAuthenticated: false,
    requiresIndependentPilotApproval: true,
    qualifiesForPromotion: false,
  };
  return frozen({
    ...core,
    bindingDigest: hash(core, PM_EXPLORATION_ADMISSION_BOUND_COHORT_SCHEMA),
  });
}
