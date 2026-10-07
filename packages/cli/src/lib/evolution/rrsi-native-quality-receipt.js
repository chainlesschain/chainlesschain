/** Live native quality assessment. No current assessment grants final or promotion authority. */
import { isProxy } from "node:util/types";
import { captureRrsiNativeBatchEvidence } from "./rrsi-native-batch-evidence.js";
import { captureRrsiHistoryLedgerAdapter } from "./rrsi-history-ledger-adapter.js";
import { analyzeRrsiNativeBatchGroupStatistics } from "./rrsi-native-group-statistics.js";
import { verifyRrsiNativeGroupStatisticsPlan } from "./rrsi-native-group-statistics-plan.js";
import {
  RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA,
  RRSI_NATIVE_QUALITY_UNVERIFIED_PREREQUISITES as UNVERIFIED,
  RRSI_NATIVE_QUALITY_REQUIRED_REASONS as REQUIRED_REASONS,
} from "./rrsi-native-quality-receipt-contracts.js";
import {
  snapshotRrsiData,
  rrsiCanonical,
  rrsiEnvelope,
  rrsiHash,
  rrsiFail,
} from "./rrsi-data.js";

export { RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA } from "./rrsi-native-quality-receipt-contracts.js";
const RECEIPTS = new WeakMap();
const ROW_CENSUS_DOMAIN = "chainlesschain.rrsi-native-quality-row-census/v1";
const FULL_ROWS_DOMAIN = "chainlesschain.rrsi-native-quality-full-rows/v1";

function ownOptions(input) {
  const names = ["batchEvidence", "plan"];
  if (
    !input ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Reflect.ownKeys(input).length !== names.length
  )
    rrsiFail("native quality requires only a live batch census and plan");
  return Object.fromEntries(
    names.map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (!field?.enumerable || !("value" in field))
        rrsiFail("native quality options cannot use accessors");
      return [name, field.value];
    }),
  );
}

function same(left, right, label) {
  if (rrsiCanonical(left) !== rrsiCanonical(right))
    rrsiFail(`${label} changed`, "CC_RRSI_QUALITY_STALE");
}

// Hash every retained row field, including fields not used by the numerical
// analysis. Missing children stay in the original authoritative denominator.
function rowCensus(census) {
  return census.batch.children.map((child) => {
    const block = census.childEvidence(child.childId);
    return {
      childId: child.childId,
      rowEvidenceDigest: block?.rowEvidenceDigest ?? null,
      finalReceiptDigest: block?.finalReceiptDigest ?? null,
      rowCount: block?.rows?.length ?? 0,
      fullRowsDigest: block?.rows
        ? rrsiHash(FULL_ROWS_DOMAIN, block.rows)
        : null,
    };
  });
}

function makeReceipt(census, history, plan, report) {
  const { batch, campaign, evidence } = census;
  const receipt = rrsiEnvelope(
    RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA,
    "qualityReceiptDigest",
    {
      assessmentKind: `${batch.stage}-required-quality`,
      stage: batch.stage,
      tenantId: campaign.tenantId,
      goalId: campaign.goalId,
      historyDescriptor: history.descriptor,
      auditHead: evidence.auditHead,
      campaignDigest: campaign.campaignDigest,
      campaignRootDigest: evidence.campaignRootDigest,
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
      nativeBatchEvidenceDigest: evidence.batchEvidenceDigest,
      statisticsPlanDigest: plan.statisticsPlanDigest,
      statisticsReportDigest: report.statisticsReportDigest,
      statisticsRegistration: evidence.statisticsRegistration ?? null,
      reservationRecord: evidence.reservationRecord,
      fullRowCensusDigest: rrsiHash(ROW_CENSUS_DOMAIN, rowCensus(census)),
      statisticalRowSetDigest: report.rowSetDigest,
      plannedActorObservations: report.plannedActorObservations,
      observedRowClaims: report.observedRowClaims,
      missingActorObservations: report.missingActorObservations,
      originalNativeGateVetoChildIds: evidence.nativeGateVetoChildIds,
      budget: {
        declaredBudgetSettlementComplete:
          evidence.declaredBudgetSettlementComplete,
        budgetOverrun: evidence.budgetOverrun,
        allocationBinding: batch.batchDigest,
        declaredAccountingOnly: true,
      },
      verifiedControlEvidence: {
        originalHistoryJournalBound: true,
        originalHistoryHeadReverified: true,
        originalReceiptInventoryReverified: true,
        signedReceiptFreshnessReverified: true,
        allCohortInventoriesAuthenticated:
          evidence.allCohortInventoriesAuthenticated,
        presentedFinalReceiptRowsAuthenticated:
          report.presentedFinalReceiptRowsAuthenticated,
        completeSignedRows: evidence.completeSignedRows,
        fullTriangleDenominatorRetained:
          evidence.fullTriangleDenominatorRetained,
        fullTriangleRowsPresent: report.fullTriangleRowsPresent,
        controlledHistoryRegistrationOrderVerified:
          report.controlledHistoryRegistrationOrderVerified === true,
      },
      unverifiedProductionPrerequisites: UNVERIFIED,
      blockingReasons: [
        ...new Set([...report.blockingReasons, ...REQUIRED_REASONS]),
      ].sort(),
      decision: "HOLD",
      qualityVerdictVerified: false,
      grantsFinalEvaluationAuthority: false,
      grantsMutationOrDispatchAuthority: false,
    },
  );
  snapshotRrsiData(receipt);
  return receipt;
}

/** No report, verdict, verifier callback, or caller-supplied clock is accepted. */
export async function buildRrsiNativeQualityReceipt(input) {
  const options = ownOptions(input);
  const census = captureRrsiNativeBatchEvidence(options.batchEvidence);
  if (
    !census.historyAdapter ||
    typeof census.assertCurrentHistory !== "function"
  )
    rrsiFail("native quality requires census original History revalidation");
  const history = captureRrsiHistoryLedgerAdapter(census.historyAdapter);
  const assertHistory = census.assertCurrentHistory;
  const plan = verifyRrsiNativeGroupStatisticsPlan(
    snapshotRrsiData(options.plan),
    { campaign: census.campaign, batch: census.batch },
  );
  if (!["selection", "generalization"].includes(census.batch.stage))
    rrsiFail("native quality requires a selection or generalization batch");
  await assertHistory(census.historyAdapter);
  const rootResolution = history.resolveCampaignRoot();
  const batchResolution = history.resolveNativeBatch({
    batchDigest: census.batch.batchDigest,
  });
  const report = analyzeRrsiNativeBatchGroupStatistics({
    batchEvidence: options.batchEvidence,
    plan,
  });
  const receipt = makeReceipt(census, history, plan, report);
  const receiptBytes = rrsiCanonical(receipt);
  const reportBytes = rrsiCanonical(report);
  await assertHistory(census.historyAdapter);
  same(history.resolveCampaignRoot(), rootResolution, "quality History root");
  same(
    history.resolveNativeBatch({ batchDigest: census.batch.batchDigest }),
    batchResolution,
    "quality History batch",
  );
  census.assertCurrentFreshness();

  let invalidated = false;
  const captured = Object.freeze({
    receipt,
    receiptBytes,
    statisticsReport: report,
    statisticsReportBytes: reportBytes,
    batchEvidence: options.batchEvidence,
    plan,
    campaign: census.campaign,
    batch: census.batch,
    historyLedger: history.ledger,
    historyDescriptor: history.descriptor,
    rootResolution,
    batchResolution,
    auditHead: receipt.auditHead,
    // History calls this again under its write lock, after any expensive
    // revalidation. A failed validity check cannot revive this live receipt.
    assertCurrentFreshness() {
      if (invalidated)
        rrsiFail("quality receipt was invalidated", "CC_RRSI_QUALITY_STALE");
      try {
        return census.assertCurrentFreshness();
      } catch (error) {
        invalidated = true;
        throw error;
      }
    },
    async assertCurrentHistory(historyAdapter) {
      const current = captureRrsiHistoryLedgerAdapter(historyAdapter);
      if (current.ledger !== history.ledger)
        rrsiFail("quality receipt belongs to another genuine History journal");
      same(
        current.descriptor,
        history.descriptor,
        "quality History descriptor",
      );
      if (invalidated)
        rrsiFail("quality receipt was invalidated", "CC_RRSI_QUALITY_STALE");
      try {
        await assertHistory(historyAdapter);
        same(
          current.resolveCampaignRoot(),
          rootResolution,
          "quality History root",
        );
        same(
          current.resolveNativeBatch({ batchDigest: census.batch.batchDigest }),
          batchResolution,
          "quality History batch",
        );
        const recheckedReport = analyzeRrsiNativeBatchGroupStatistics({
          batchEvidence: options.batchEvidence,
          plan,
        });
        if (rrsiCanonical(recheckedReport) !== reportBytes)
          rrsiFail("quality original statistical report changed");
        if (
          rrsiCanonical(makeReceipt(census, current, plan, recheckedReport)) !==
          receiptBytes
        )
          rrsiFail("quality original census or receipt changed");
        await assertHistory(historyAdapter);
        census.assertCurrentFreshness();
        return receipt;
      } catch (error) {
        invalidated = true;
        throw error;
      }
    },
  });
  RECEIPTS.set(receipt, captured);
  return receipt;
}

/** JSON copies remain observations and cannot recover this live capability. */
export function captureRrsiNativeQualityReceipt(receipt) {
  const captured = RECEIPTS.get(receipt);
  if (!captured)
    rrsiFail("a live branded native required-quality receipt is required");
  return captured;
}
