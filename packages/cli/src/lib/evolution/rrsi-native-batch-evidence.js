/** Complete native census. Presented claims are distinct from execution proofs. */
import { isProxy } from "node:util/types";
import { captureRrsiHistoryLedgerAdapter } from "./rrsi-history-ledger-adapter.js";
import {
  createEvolutionEvalReadonlyAudit,
  captureEvolutionEvalReadonlyAudit,
} from "./evolution-eval-readonly-audit.js";
import {
  buildRrsiEvalCampaignPlan,
  buildRrsiNativeStatisticsRegistrationBindings,
} from "./rrsi-cohort-registration.js";
import {
  captureRrsiNativeEvalCohortEvidence,
  RRSI_NATIVE_ROW_CLAIM_FIELDS,
} from "./rrsi-native-eval-row-collector.js";
import { assertEvolutionEvalReceiptChunkSetFreshness } from "./evolution-eval-gate.js";
import {
  snapshotRrsiData,
  rrsiCanonical,
  rrsiDigest,
  rrsiEnvelope,
  rrsiFail,
} from "./rrsi-data.js";

export const RRSI_NATIVE_BATCH_EVIDENCE_SCHEMA =
  "chainlesschain.rrsi-native-batch-evidence/v1";
export const RRSI_NATIVE_BATCH_EVIDENCE_V2_SCHEMA =
  "chainlesschain.rrsi-native-batch-evidence/v2";
const BATCHES = new WeakMap();
const same = (a, b, label) => {
  if (rrsiCanonical(a) !== rrsiCanonical(b)) rrsiFail(`${label} differs`);
};

function ownFields(value) {
  const keys = ["historyAdapter", "batchDigest", "cohorts"];
  if (
    !value ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length
  )
    rrsiFail("native census composition requires plain own fields");
  return Object.fromEntries(
    keys.map((key) => {
      const field = Object.getOwnPropertyDescriptor(value, key);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("native census cannot use accessors");
      return [key, field.value];
    }),
  );
}

function captureCohorts(value, maximum) {
  if (
    !value ||
    isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    rrsiFail("native census requires a bounded dense cohort list");
  return Array.from({ length: value.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field?.enumerable || !("value" in field))
      rrsiFail("native census cohort list cannot use accessors");
    return captureRrsiNativeEvalCohortEvidence(field.value);
  });
}

function claim(value, used, label) {
  if (value === null) return;
  if (used.has(value))
    rrsiFail(`native batch repeats a presented ${label} claim`);
  used.add(value);
}

function checkBlock(
  block,
  child,
  reservation,
  batch,
  root,
  statisticsRegistration,
) {
  same(
    block.statisticsRegistration ?? null,
    statisticsRegistration,
    "native child statistics registration",
  );
  for (const field of [
    "childId",
    "cohortId",
    "slotId",
    "role",
    "variant",
    "pairId",
    "nativePlanDigest",
    "evaluationContextDigest",
    "variantMappingDigest",
    "recipeDigest",
  ])
    same(block[field], child[field], `native child ${field}`);
  same(block.batchDigest, batch.batchDigest, "native child batch");
  same(
    block.campaignRootDigest,
    root.campaignRootDigest,
    "native child campaign root",
  );
  same(
    block.nativeEvaluationPlanDigest,
    batch.nativeEvaluationPlanDigest,
    "native child graph",
  );
  same(
    block.runtimeId,
    child.expectedContext.runtimeId,
    "native child runtime",
  );
  same(
    block.targetEnvironmentRef,
    child.expectedContext.targetEnvironmentRef,
    "native child target",
  );
  same(block.versions, batch.versions, "native child versions");
  same(
    block.lifecycleDigests,
    batch.lifecycleDigests,
    "native child lifecycles",
  );
  same(
    block.reservationDigestsByArm,
    reservation.bindings.armReservationDigests,
    "native child reservations",
  );
  same(
    block.plannedObservationsPerArmByPartition,
    child.plannedObservationsPerArmByPartition,
    "native child denominator",
  );
}

function checkFreshness(groups) {
  return Object.freeze(
    [...groups].map(([verifier, group]) =>
      Object.freeze({
        cohortIds: Object.freeze([...group.cohortIds]),
        ...assertEvolutionEvalReceiptChunkSetFreshness(verifier, group.windows),
      }),
    ),
  );
}

/** Missing cohorts remain visible with their whole authoritative denominator. */
export async function collectRrsiNativeBatchEvidence(input) {
  const options = ownFields(input);
  const history = captureRrsiHistoryLedgerAdapter(options.historyAdapter);
  rrsiDigest(options.batchDigest, "native census batch digest");
  const ledgerAudit = createEvolutionEvalReadonlyAudit(history.ledger);
  const shared = captureEvolutionEvalReadonlyAudit(ledgerAudit, history.ledger);
  const before = shared.identity;
  const rootResolution = history.resolveCampaignRoot();
  const root = buildRrsiEvalCampaignPlan(rootResolution);
  const resolution = history.resolveNativeBatch({
    batchDigest: options.batchDigest,
  });
  const { batch, campaign } = resolution;
  const statisticsRegistration = resolution.statisticsRegistration
    ? buildRrsiNativeStatisticsRegistrationBindings(
        resolution.statisticsRegistration,
        resolution.reservationRecord,
      )
    : null;
  const cohortIds = [
    ...new Set(batch.children.map((child) => child.cohortId)),
  ].sort();
  const captures = captureCohorts(options.cohorts, cohortIds.length);
  const presented = new Map();
  for (const captured of captures) {
    const evidence = captured.evidence;
    same(
      evidence.statisticsRegistration ?? null,
      statisticsRegistration,
      "cohort statistics registration",
    );
    if (
      !cohortIds.includes(evidence.cohortId) ||
      presented.has(evidence.cohortId)
    )
      rrsiFail("native census contains a foreign or repeated cohort");
    same(evidence.batchDigest, batch.batchDigest, "cohort batch");
    same(evidence.campaignRootDigest, root.campaignRootDigest, "cohort root");
    same(
      evidence.nativeEvaluationPlanDigest,
      batch.nativeEvaluationPlanDigest,
      "cohort native graph",
    );
    same(evidence.allCohortIds, cohortIds, "cohort complete sibling inventory");
    const expected = batch.children
      .filter((child) => child.cohortId === evidence.cohortId)
      .sort((a, b) => (a.slotId < b.slotId ? -1 : a.slotId > b.slotId ? 1 : 0));
    same(
      evidence.slots.map((slot) => [slot.childId, slot.slotId]),
      expected.map((child) => [child.childId, child.slotId]),
      "cohort child inventory",
    );
    presented.set(evidence.cohortId, captured);
  }
  // All caller graphs and capabilities have been captured before the first await.
  const sessions = new Map();
  for (const captured of captures) {
    if (!sessions.has(captured.auditKey))
      sessions.set(
        captured.auditKey,
        captured.createReadonlyAudit(ledgerAudit),
      );
    await captured.assertCurrentInventory(
      options.historyAdapter,
      sessions.get(captured.auditKey),
    );
  }
  const claims = Object.fromEntries(
    RRSI_NATIVE_ROW_CLAIM_FIELDS.map((field) => [field, new Set()]),
  );
  const runIds = new Set(),
    runNonces = new Set(),
    receiptDigests = new Set();
  const blocks = new Map(),
    denominators = new Map(),
    clockGroups = new Map();
  const sources = new Map(
    campaign.dataset.tasks.map((task) => [task.id, task]),
  );
  const reservations = new Map(
    resolution.children.map((child) => [child.bindings.childId, child]),
  );
  const childIndex = [],
    vetoes = [];
  for (const captured of captures)
    if (captured.validityWindows.length) {
      let group = clockGroups.get(captured.receiptVerifier);
      if (!group)
        clockGroups.set(
          captured.receiptVerifier,
          (group = { cohortIds: [], windows: [] }),
        );
      group.cohortIds.push(captured.evidence.cohortId);
      group.windows.push(captured.validityWindows);
    }
  for (const child of batch.children) {
    const captured = presented.get(child.cohortId);
    const block = captured ? captured.childEvidence(child.slotId) : null;
    if (block) {
      checkBlock(
        block,
        child,
        reservations.get(child.childId),
        batch,
        root,
        statisticsRegistration,
      );
      claim(block.runId, runIds, "runId");
      claim(block.runNonce, runNonces, "runNonce");
      claim(block.finalReceiptDigest, receiptDigests, "final receipt");
      blocks.set(child.childId, block);
      if (
        child.pairId.startsWith("rrsi-vs-") &&
        block.originalNativeGateDecision !== null &&
        block.originalNativeGateDecision !== "accepted"
      )
        vetoes.push(child.childId);
    }
    const observed = new Map(),
      successes = new Map();
    for (const row of block?.rows ?? []) {
      const source = sources.get(row.rrsiTaskId);
      if (
        !source ||
        source.partition !== row.rrsiPartition ||
        !Object.hasOwn(
          child.plannedObservationsPerArmByPartition,
          row.rrsiPartition,
        ) ||
        !Object.hasOwn(child.byArm, row.arm) ||
        !campaign.experiment.seeds.includes(row.seed)
      )
        rrsiFail("native batch row changes the frozen task, seed or arm scope");
      for (const field of RRSI_NATIVE_ROW_CLAIM_FIELDS)
        claim(row[field], claims[field], field);
      const key = JSON.stringify([row.arm, row.rrsiPartition]);
      observed.set(key, (observed.get(key) ?? 0) + 1);
      successes.set(key, (successes.get(key) ?? 0) + Number(row.strictPass));
    }
    for (const arm of Object.keys(child.byArm))
      for (const [partition, planned] of Object.entries(
        child.plannedObservationsPerArmByPartition,
      )) {
        const rowKey = JSON.stringify([arm, partition]);
        const count = observed.get(rowKey) ?? 0;
        if (block?.rows !== null && block && count !== planned)
          rrsiFail(
            "native batch signed rows change the complete child denominator",
          );
        const key = JSON.stringify([
          child.role,
          child.variant,
          child.slotId,
          arm,
          partition,
        ]);
        let denominator = denominators.get(key);
        if (!denominator)
          denominators.set(
            key,
            (denominator = {
              role: child.role,
              variant: child.variant,
              slotId: child.slotId,
              runtimeId: child.expectedContext.runtimeId,
              targetEnvironmentRef: child.expectedContext.targetEnvironmentRef,
              arm,
              partition,
              plannedActorObservations: 0,
              observedSignedRows: 0,
              knownStrictPasses: 0,
              missingActorObservations: 0,
            }),
          );
        denominator.plannedActorObservations += planned;
        denominator.observedSignedRows += count;
        denominator.knownStrictPasses += successes.get(rowKey) ?? 0;
        denominator.missingActorObservations += planned - count;
      }
    childIndex.push({
      childId: child.childId,
      cohortId: child.cohortId,
      slotId: child.slotId,
      role: child.role,
      variant: child.variant,
      pairId: child.pairId,
      status: block?.status ?? "cohort-evidence-unavailable",
      rowEvidenceDigest: block?.rowEvidenceDigest ?? null,
      finalReceiptDigest: block?.finalReceiptDigest ?? null,
      originalNativeGateDecision: block?.originalNativeGateDecision ?? null,
      plannedObservationsPerArmByPartition:
        child.plannedObservationsPerArmByPartition,
    });
  }
  const missingCohortIds = cohortIds.filter((id) => !presented.has(id));
  const completeSignedRows = childIndex.every(
    (child) => child.status === "signed-rows",
  );
  const declaredBudgetSettlementComplete = resolution.children.every((child) =>
    child.states.every((arm) => arm.status === "settled"),
  );
  const blockingReasons = [];
  if (missingCohortIds.length) blockingReasons.push("MISSING_COHORT_EVIDENCE");
  if (!completeSignedRows) blockingReasons.push("MISSING_SIGNED_ROWS");
  if (vetoes.length) blockingReasons.push("NATIVE_GATE_VETO");
  if (!declaredBudgetSettlementComplete)
    blockingReasons.push("UNSETTLED_NATIVE_BUDGET");
  if (resolution.budgetOverrun) blockingReasons.push("BUDGET_EXCEEDED");
  blockingReasons.push("STATISTICAL_PROTOCOL_UNVALIDATED");
  for (const captured of captures)
    await captured.assertCurrentInventory(
      options.historyAdapter,
      sessions.get(captured.auditKey),
    );
  same(
    history.resolveCampaignRoot(),
    rootResolution,
    "History root during batch census",
  );
  same(
    history.resolveNativeBatch({ batchDigest: options.batchDigest }),
    resolution,
    "History batch during census",
  );
  const result = rrsiEnvelope(
    statisticsRegistration
      ? RRSI_NATIVE_BATCH_EVIDENCE_V2_SCHEMA
      : RRSI_NATIVE_BATCH_EVIDENCE_SCHEMA,
    "batchEvidenceDigest",
    {
      batchDigest: batch.batchDigest,
      campaignDigest: batch.campaignDigest,
      campaignRootDigest: root.campaignRootDigest,
      nativeEvaluationPlanDigest: batch.nativeEvaluationPlanDigest,
      evaluationMappingDigest: batch.evaluationMappingDigest,
      stage: batch.stage,
      versions: batch.versions,
      lifecycleDigests: batch.lifecycleDigests,
      auditHead: before,
      reservationRecord: resolution.reservationRecord,
      allCohortIds: cohortIds,
      missingCohortIds,
      cohorts: cohortIds.map((id) => ({
        cohortId: id,
        cohortRowsDigest: presented.get(id)?.evidence.cohortRowsDigest ?? null,
      })),
      children: childIndex,
      denominators: [...denominators.values()].sort((a, b) => {
        const left = rrsiCanonical(a),
          right = rrsiCanonical(b);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
      fullTriangleDenominatorRetained: true,
      allCohortInventoriesAuthenticated: missingCohortIds.length === 0,
      completeSignedRows,
      presentedExecutionClaimsUnique: true,
      presentedRunAndReceiptClaimsUnique: true,
      nativeGateVetoChildIds: vetoes,
      declaredBudgetSettlementComplete,
      budgetOverrun: resolution.budgetOverrun,
      receiptValidityDomainCount: clockGroups.size,
      singleTrustedClockInstant: clockGroups.size === 1,
      receiptFreshnessDetailsInLiveCapture: true,
      decision: "HOLD",
      blockingReasons,
      sourceProvenanceVerified: false,
      armLifecycleVerified: false,
      recipeExecutionVerified: false,
      underlyingExecutionReceiptsReverified: false,
      completeLifecycleCostVerified: false,
      statisticalProtocolValidated: false,
      qualityVerdictVerified: false,
      ...(statisticsRegistration
        ? {
            statisticsRegistration,
            preObservationRegistrationVerified: true,
            controlledHistoryRegistrationOrderVerified: true,
            underlyingObservationTimeVerified: false,
          }
        : {}),
    },
  );
  snapshotRrsiData(result);
  shared.assertUnchanged();
  const freshness = checkFreshness(clockGroups);
  BATCHES.set(
    result,
    Object.freeze({
      evidence: result,
      freshness,
      campaign,
      batch,
      statisticsRegistration: resolution.statisticsRegistration ?? null,
      historyAdapter: options.historyAdapter,
      async assertCurrentHistory(historyAdapter) {
        const current = captureRrsiHistoryLedgerAdapter(historyAdapter);
        if (
          current.ledger !== history.ledger ||
          current.artifactPorts !== history.artifactPorts ||
          current.ledgerArtifactResolver !== history.ledgerArtifactResolver
        )
          rrsiFail("native census belongs to another genuine History journal");
        same(
          current.descriptor,
          history.descriptor,
          "native census History descriptor",
        );
        checkFreshness(clockGroups);
        shared.assertUnchanged();
        // A fresh session must reread retained bytes. The original session has
        // immutable snapshot caches and cannot detect later artifact damage.
        const currentAudit = createEvolutionEvalReadonlyAudit(history.ledger);
        const currentShared = captureEvolutionEvalReadonlyAudit(
          currentAudit,
          history.ledger,
        );
        same(
          currentShared.identity,
          before,
          "native census original audit head",
        );
        const currentSessions = new Map();
        for (const captured of captures) {
          if (!currentSessions.has(captured.auditKey))
            currentSessions.set(
              captured.auditKey,
              captured.createReadonlyAudit(currentAudit),
            );
          await captured.assertCurrentInventory(
            historyAdapter,
            currentSessions.get(captured.auditKey),
          );
        }
        same(
          current.resolveCampaignRoot(),
          rootResolution,
          "native census original History root",
        );
        same(
          current.resolveNativeBatch({ batchDigest: batch.batchDigest }),
          resolution,
          "native census original History batch",
        );
        checkFreshness(clockGroups);
        currentShared.assertUnchanged();
        shared.assertUnchanged();
        return result;
      },
      childEvidence(childId) {
        if (!batch.children.some((child) => child.childId === childId))
          rrsiFail("native child is outside the censused batch");
        return blocks.get(childId) ?? null;
      },
      assertCurrentFreshness() {
        return checkFreshness(clockGroups);
      },
    }),
  );
  return result;
}

export function captureRrsiNativeBatchEvidence(value) {
  const captured = BATCHES.get(value);
  if (!captured) rrsiFail("a live branded native batch census is required");
  return captured;
}
