/** Read-only native row collection; signed declarations are not execution proofs. */
import { isProxy } from "node:util/types";
import {
  isEvolutionEvalReceiptVerifier,
  verifyEvolutionEvalReceipt,
  verifyEvolutionEvalResultEvidence,
  assertEvolutionEvalReceiptSetFreshness,
} from "./evolution-eval-gate.js";
import {
  RRSI_EVAL_COHORT_ENROLLMENT_SCHEMA,
  resolveEvolutionEvalCohortEnrollment,
  resolveEvolutionEvalCohortReconciliation,
  assertRrsiEvalCohortHistoryComposition,
  createRrsiEvalCohortReadonlyAudit,
  resolveRrsiEvalCohortFromReadonlyAudit,
  assertRrsiEvalCohortReadonlyAuditUnchanged,
} from "./evolution-eval-cohort-enrollment.js";
import { buildRrsiNativeEvaluationPlan } from "./rrsi-native-evaluation-plan.js";
import {
  snapshotRrsiVariantContexts,
  buildRrsiEvaluationVariantMapping,
} from "./rrsi-evaluation-variants.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiCanonical,
  rrsiHash,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_ROW_EVIDENCE_SCHEMA =
  "chainlesschain.rrsi-native-eval-row-evidence/v1";
export const RRSI_NATIVE_COHORT_ROWS_SCHEMA =
  "chainlesschain.rrsi-native-eval-cohort-rows/v1";
const COLLECTORS = new WeakMap();
const COHORTS = new WeakMap();
const AUDIT_KEYS = new WeakMap();

function ownFields(input, keys, label) {
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== keys.length
  )
    rrsiFail(`${label} requires plain own fields`);
  return Object.fromEntries(
    keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      if (!field?.enumerable || !("value" in field))
        rrsiFail(`${label} cannot use accessors`);
      return [key, field.value];
    }),
  );
}

function same(a, b, label) {
  if (rrsiCanonical(a) !== rrsiCanonical(b)) rrsiFail(`${label} differs`);
}

/** Private suites stay in the collector. Callers cannot choose expected run bindings. */
export function createRrsiNativeEvalRowCollector(input) {
  const options = ownFields(
    input,
    ["cohortAuthority", "receiptVerifier", "planContext", "cohortId"],
    "native row collector composition",
  );
  if (!isEvolutionEvalReceiptVerifier(options.receiptVerifier))
    rrsiFail("native rows require a branded final Eval verifier");
  const lookup = snapshotRrsiData({ cohortId: options.cohortId });
  const enrollment = resolveEvolutionEvalCohortEnrollment(
    options.cohortAuthority,
    lookup,
  );
  if (enrollment.evidence.schema !== RRSI_EVAL_COHORT_ENROLLMENT_SCHEMA)
    rrsiFail("native rows require RRSI cohort enrollment v2");
  const plan = buildRrsiNativeEvaluationPlan(options.planContext);
  if (
    plan.nativeEvaluationPlanDigest !==
    enrollment.evidence.plan.nativeEvaluationPlanDigest
  )
    rrsiFail("native row context differs from signed measurement graph");
  const evaluationCase = plan.cases.find((entry) =>
    entry.slots.some((slot) => slot.cohortId === lookup.cohortId),
  );
  if (!evaluationCase) rrsiFail("native cohort is outside the frozen graph");
  const rawVariants = Object.getOwnPropertyDescriptor(
    options.planContext,
    "variants",
  ).value;
  const source = snapshotRrsiVariantContexts(rawVariants).find(
    (variant) => variant.variant === evaluationCase.variant,
  );
  const mapping = buildRrsiEvaluationVariantMapping(source);
  if (mapping.variantMappingDigest !== evaluationCase.variantMappingDigest)
    rrsiFail("native row variant differs from the frozen mapping");
  const role = mapping.roles.find(
    (entry) => entry.role === evaluationCase.role,
  );
  const slots = enrollment.evidence.slots.map((registered) => {
    const slot = evaluationCase.slots.find(
      (slot) => slot.slotId === registered.slotId,
    );
    const binding = enrollment.evidence.manifest.childBindings.find(
      (child) => child.slotId === registered.slotId,
    );
    const cell = evaluationCase.nativePlan.cells.find(
      (cell) => cell.cellId === registered.slotId,
    );
    if (!slot || !binding || !cell)
      rrsiFail("native cohort omits a frozen target slot");
    same(slot.expectedContext, binding.expectedContext, "native run context");
    return { slot, binding, cell };
  });
  if (slots.length !== evaluationCase.slots.length)
    rrsiFail("native cohort changes the complete target denominator");
  const collector = Object.freeze({
    schema: "chainlesschain.rrsi-native-eval-row-collector/v1",
    cohortId: lookup.cohortId,
  });
  COLLECTORS.set(collector, {
    authority: options.cohortAuthority,
    verifier: options.receiptVerifier,
    lookup,
    enrollment,
    plan,
    evaluationCase,
    role,
    slots,
    suite: source.suites[evaluationCase.role],
    policy: source.context.policies[evaluationCase.role],
  });
  return collector;
}

function expectedReceipt(slot, cell, admission) {
  const context = slot.expectedContext;
  return {
    runId: admission.runId,
    runNonce: admission.runNonce,
    suiteDigest: context.suiteDigest,
    policyDigest: context.policyDigest,
    evaluationAuthorityRoot: context.evaluationAuthorityRoot,
    targetEnvironmentRef: context.targetEnvironmentRef,
    evaluationContextDigest: slot.evaluationContextDigest,
    candidateId: context.candidateId,
    baselineId: context.baselineId,
    environmentDigest: context.environmentDigest,
    tenantId: context.tenantId,
    provenanceAudience: cell.provenanceAudience,
    trainerAuthority: cell.trainerAuthority,
    trainerRevision: cell.trainerRevision,
  };
}

function mappedRows(state, evidence) {
  const tasks = new Map(
    state.role.mappings.map((task) => [task.pmTaskDigest, task]),
  );
  return ["validation", "test"].flatMap((split) =>
    ["baseline", "candidate"].flatMap((nativeArm) => {
      const arm = state.evaluationCase[`${nativeArm}Arm`];
      return evidence[split][nativeArm].map((row) => {
        const task = tasks.get(row.taskDigest);
        if (!task || task.split !== split)
          rrsiFail("signed native row has a foreign task source");
        return {
          rrsiTaskId: task.rrsiTaskId,
          rrsiPartition: task.rrsiPartition,
          pmTaskDigest: row.taskDigest,
          basePmTaskDigest: task.basePmTaskDigest,
          seed: row.seed,
          arm,
          reportedPass: row.pass,
          strictPass:
            row.pass &&
            row.securityViolations === 0 &&
            row.permissionViolations === 0,
          qualityScore: row.qualityScore,
          securityViolations: row.securityViolations,
          permissionViolations: row.permissionViolations,
          metrics: row.metrics,
          executionDigest: row.executionDigest,
          gradeDigest: row.gradeDigest,
          safetyDigest: row.safetyDigest,
          outputArtifactDigest: row.outputArtifactDigest,
          subjectBindingDigest: row.subjectBindingDigest,
          subjectReservationDigest: row.subjectReservationDigest,
          rowDigest: rrsiHash("chainlesschain.rrsi-native-signed-row/v1", row),
        };
      });
    }),
  );
}

export const RRSI_NATIVE_ROW_CLAIM_FIELDS = Object.freeze([
  "executionDigest",
  "gradeDigest",
  "safetyDigest",
  "subjectBindingDigest",
  "subjectReservationDigest",
]);

function assertUniqueClaims(rows, seen) {
  for (const row of rows)
    for (const field of RRSI_NATIVE_ROW_CLAIM_FIELDS) {
      if (seen[field].has(row[field]))
        rrsiFail(`native cohort repeats an underlying ${field} claim`);
      seen[field].add(row[field]);
    }
}

/** Every enrolled slot is presented, including explicit missing receipts/rows. */
export async function collectRrsiNativeEvalCohortEvidence(collector, input) {
  const state = COLLECTORS.get(collector);
  if (!state) rrsiFail("a branded native row collector is required");
  const raw = ownFields(input, ["slots"], "native cohort receipt source").slots;
  if (
    !raw ||
    isProxy(raw) ||
    !Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Array.prototype ||
    raw.length !== state.slots.length ||
    Reflect.ownKeys(raw).length !== raw.length + 1
  )
    rrsiFail("native row source must cover every enrolled target slot");
  // Capture each chunk independently before any await; never enlarge the data
  // bounds or clip targets merely because several valid chunks share a cohort.
  const source = {
    slots: Array.from({ length: raw.length }, (_, position) => {
      const field = Object.getOwnPropertyDescriptor(raw, String(position));
      if (!field?.enumerable || !("value" in field))
        rrsiFail("native row source slots cannot use accessors");
      return snapshotRrsiData(field.value);
    }),
  };
  for (const [index, entry] of source.slots.entries()) {
    rrsiExact(
      entry,
      ["slotId", "receipt", "resultEvidence"],
      "native row source slot",
    );
    if (entry.slotId !== state.slots[index].slot.slotId)
      rrsiFail("native row source differs from enrolled target order");
    if (entry.receipt === null && entry.resultEvidence !== null)
      rrsiFail("missing native receipt cannot carry substituted rows");
  }
  const audit = createRrsiEvalCohortReadonlyAudit(state.authority);
  const audited = await resolveRrsiEvalCohortFromReadonlyAudit(
    state.authority,
    state.lookup,
    audit,
  );
  const enrollment = audited.enrollment;
  same(enrollment, state.enrollment, "native enrollment readback");
  const sealed = audited.reconciliation;
  const admissions = new Map(
    sealed.inventory.admissions.map((entry) => [entry.slotId, entry]),
  );
  const blocks = new Map();
  const index = [];
  const claims = Object.fromEntries(
    RRSI_NATIVE_ROW_CLAIM_FIELDS.map((field) => [field, new Set()]),
  );
  const receipts = [];
  for (const [position, entry] of source.slots.entries()) {
    const { slot, cell, binding } = state.slots[position];
    const admission = admissions.get(slot.slotId);
    if (admission && admission.requestDigest !== slot.requestDigest)
      rrsiFail("native admission differs from the original launch request");
    let rows = null;
    if (entry.receipt !== null) {
      if (!admission) rrsiFail("signed native receipt has no sealed admission");
      const expected = expectedReceipt(slot, cell, admission);
      if (
        entry.receipt.trainingPartitionDigest !==
        state.role.pmTrainingPartitionDigest
      )
        rrsiFail("signed native receipt changes the training partition");
      if (entry.receipt.confidenceZ !== state.policy.confidenceZ)
        rrsiFail(
          "signed native receipt changes the frozen confidence parameter",
        );
      same(
        entry.receipt.splitCounts,
        state.role.splitCounts,
        "signed native split denominator",
      );
      if (entry.resultEvidence !== null) {
        const verified = await verifyEvolutionEvalResultEvidence(
          state.verifier,
          {
            receipt: entry.receipt,
            resultEvidence: entry.resultEvidence,
            suite: state.suite,
            policy: state.policy,
          },
          expected,
        );
        rows = mappedRows(state, verified);
        assertUniqueClaims(rows, claims);
      } else {
        await verifyEvolutionEvalReceipt(
          state.verifier,
          entry.receipt,
          expected,
        );
      }
      receipts.push(entry.receipt);
    }
    const status =
      entry.receipt === null
        ? admission
          ? "receipt-unavailable"
          : "unadmitted"
        : rows === null
          ? entry.receipt.validation === null || entry.receipt.test === null
            ? "signed-terminal-no-rows"
            : "signed-receipt-rows-unavailable"
          : "signed-rows";
    const block = rrsiEnvelope(
      RRSI_NATIVE_ROW_EVIDENCE_SCHEMA,
      "rowEvidenceDigest",
      {
        campaignRootDigest: enrollment.evidence.plan.campaignRootDigest,
        batchDigest: enrollment.evidence.plan.batchDigest,
        nativeEvaluationPlanDigest: state.plan.nativeEvaluationPlanDigest,
        enrollmentDigest: enrollment.enrollmentDigest,
        sealDigest: sealed.sealDigest,
        cohortId: state.lookup.cohortId,
        childId: binding.childId,
        slotId: slot.slotId,
        nativePlanDigest: slot.nativePlanDigest,
        evaluationContextDigest: slot.evaluationContextDigest,
        variantMappingDigest: state.evaluationCase.variantMappingDigest,
        recipeDigest: state.evaluationCase.recipeDigest,
        role: state.evaluationCase.role,
        variant: state.evaluationCase.variant,
        pairId: state.evaluationCase.pairId,
        runtimeId: cell.runtimeId,
        targetEnvironmentRef: cell.targetEnvironmentRef,
        versions: state.plan.versions,
        lifecycleDigests: state.plan.lifecycleDigests,
        reservationDigestsByArm: binding.reservationDigestsByArm,
        plannedObservationsPerArmByPartition:
          slot.plannedObservationsPerArmByPartition,
        admissionDigest: admission?.admissionDigest ?? null,
        runId: admission?.runId ?? null,
        runNonce: admission?.runNonce ?? null,
        finalReceiptDigest: entry.receipt?.receiptDigest ?? null,
        receiptIssuedAt: entry.receipt?.issuedAt ?? null,
        receiptExpiresAt: entry.receipt?.expiresAt ?? null,
        resultEvidenceDigest: entry.resultEvidence?.evidenceDigest ?? null,
        originalNativeGateDecision: entry.receipt?.decision ?? null,
        originalNativeGateReasonCodes: entry.receipt?.reasonCodes ?? null,
        signedUsage: entry.receipt?.usage ?? null,
        status,
        rows,
        finalReceiptAuthenticated: entry.receipt !== null,
        finalReceiptRowsAuthenticated: rows !== null,
        admissionInventoryAuthenticated: true,
        frozenLifecycleReferencesBound: true,
        armLifecycleVerified: false,
        recipeExecutionVerified: false,
        sourceProvenanceVerified: false,
        underlyingExecutionReceiptsReverified: false,
        completeLifecycleCostVerified: false,
        cleanupReverified: false,
        qualityVerdictVerified: false,
      },
    );
    snapshotRrsiData(block);
    blocks.set(slot.slotId, block);
    index.push({
      slotId: slot.slotId,
      childId: binding.childId,
      status,
      rowEvidenceDigest: block.rowEvidenceDigest,
      finalReceiptDigest: block.finalReceiptDigest,
      originalNativeGateDecision: block.originalNativeGateDecision,
    });
  }
  const finalSeal = (
    await resolveRrsiEvalCohortFromReadonlyAudit(
      state.authority,
      state.lookup,
      audit,
    )
  ).reconciliation;
  same(
    sealed,
    finalSeal,
    "sealed native inventory during signature verification",
  );
  const result = rrsiEnvelope(
    RRSI_NATIVE_COHORT_ROWS_SCHEMA,
    "cohortRowsDigest",
    {
      cohortId: state.lookup.cohortId,
      batchDigest: enrollment.evidence.plan.batchDigest,
      nativeEvaluationPlanDigest: state.plan.nativeEvaluationPlanDigest,
      campaignRootDigest: enrollment.evidence.plan.campaignRootDigest,
      enrollmentDigest: enrollment.enrollmentDigest,
      sealDigest: sealed.sealDigest,
      role: state.evaluationCase.role,
      variant: state.evaluationCase.variant,
      pairId: state.evaluationCase.pairId,
      allCohortIds: enrollment.evidence.manifest.allCohortIds,
      plannedObservationsPerArmByPartition:
        sealed.plannedObservationsPerArmByPartition,
      slots: index,
      completeSignedRows: index.every((slot) => slot.status === "signed-rows"),
      admissionInventoryAuthenticated: true,
      originalNativeGateDecisionsPreserved: true,
      fullCohortSlotDenominatorRetained: true,
      batchTriangleCompletenessVerified: false,
      underlyingExecutionClaimsUniqueWithinCohort: true,
      crossCohortExecutionClaimsVerified: false,
      receiptFreshnessCheckedBeforePublication: true,
      sourceProvenanceVerified: false,
      statisticalProtocolValidated: false,
      qualityVerdictVerified: false,
    },
  );
  snapshotRrsiData(result);
  assertRrsiEvalCohortReadonlyAuditUnchanged(audit);
  const freshness = assertEvolutionEvalReceiptSetFreshness(
    state.verifier,
    receipts,
  );
  if (!AUDIT_KEYS.has(state.authority))
    AUDIT_KEYS.set(state.authority, Object.freeze({}));
  COHORTS.set(
    result,
    Object.freeze({
      evidence: result,
      freshness,
      auditKey: AUDIT_KEYS.get(state.authority),
      createReadonlyAudit(ledgerAudit) {
        return createRrsiEvalCohortReadonlyAudit(state.authority, ledgerAudit);
      },
      receiptVerifier: state.verifier,
      validityWindows: Object.freeze(
        receipts.map((receipt) =>
          Object.freeze({
            issuedAt: receipt.issuedAt,
            expiresAt: receipt.expiresAt,
          }),
        ),
      ),
      async assertCurrentInventory(historyAdapter, session = null) {
        assertRrsiEvalCohortHistoryComposition(state.authority, historyAdapter);
        if (session) {
          // This verifies the pending snapshot only. The enclosing batch must
          // finish its shared audit with assertUnchanged before publication.
          const audited = await resolveRrsiEvalCohortFromReadonlyAudit(
            state.authority,
            state.lookup,
            session,
          );
          same(
            audited.enrollment,
            enrollment,
            "native enrollment during batch census",
          );
          same(
            audited.reconciliation,
            sealed,
            "sealed native inventory during batch census",
          );
          return audited.reconciliation;
        }
        same(
          resolveEvolutionEvalCohortEnrollment(state.authority, state.lookup),
          enrollment,
          "native enrollment during batch census",
        );
        const current = await resolveEvolutionEvalCohortReconciliation(
          state.authority,
          state.lookup,
        );
        same(current, sealed, "sealed native inventory during batch census");
        return current;
      },
      assertCurrentFreshness() {
        return assertEvolutionEvalReceiptSetFreshness(state.verifier, receipts);
      },
      childEvidence(slotId) {
        const child = blocks.get(slotId);
        if (!child) rrsiFail("native child is outside the collected cohort");
        return child;
      },
    }),
  );
  return result;
}

/** JSON exports need fresh verification; only live collected chunks carry this brand. */
export function captureRrsiNativeEvalCohortEvidence(value) {
  const captured = COHORTS.get(value);
  if (!captured)
    rrsiFail("a live branded native cohort row result is required");
  return captured;
}
