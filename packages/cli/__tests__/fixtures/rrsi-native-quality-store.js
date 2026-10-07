/** Genuine v2 journal and retained artifacts; no production quality authority. */
import { rrsiNativeBatchFixture } from "./rrsi-native-batch.js";
import { openLedgerV2Fixture } from "./evolution-ledger-v2-store.js";
import { createRrsiHistoryLedgerAdapter } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { buildRrsiNativeEvaluationBatch } from "../../src/lib/evolution/rrsi-native-evaluation-batch.js";
import { buildRrsiNativeGroupStatisticsPlan } from "../../src/lib/evolution/rrsi-native-group-statistics-plan.js";
import { collectRrsiNativeBatchEvidence } from "../../src/lib/evolution/rrsi-native-batch-evidence.js";
import { buildRrsiNativeQualityReceipt } from "../../src/lib/evolution/rrsi-native-quality-receipt.js";

export function openRrsiNativeQualityStore(
  root,
  {
    input = rrsiNativeBatchFixture(),
    preregistered = true,
    reserve = true,
  } = {},
) {
  const campaign = input.planContext.context.campaign;
  const storeOptions = {
    tenantId: campaign.tenantId,
    artifactTenantId: "rrsi-artifacts",
    audience: "rrsi-runtime",
  };
  const makeAdapter = (store) =>
    createRrsiHistoryLedgerAdapter({
      backend: store.backend,
      artifactPorts: store.artifactPorts,
      ledgerArtifactResolver: store.resolver,
      descriptor: {
        ...storeOptions,
        goalId: campaign.goalId,
        purpose: "evolution-ledger",
      },
      settlementVerifier: null,
      now: store.clock,
    });
  const store = openLedgerV2Fixture(root, storeOptions);
  const adapter = makeAdapter(store);
  adapter.registerCampaign(campaign);
  const batch = buildRrsiNativeEvaluationBatch(input);
  const statisticsPlan = buildRrsiNativeGroupStatisticsPlan({
    campaign,
    batch,
  });
  if (preregistered) {
    adapter.registerNativeStatisticsScope({
      execution: input.planContext.executionContract,
    });
    adapter.registerNativeStatisticsPlan(input);
  }
  const reservation = reserve
    ? preregistered
      ? adapter.reserveNativeBatchV2(input)
      : adapter.reserveNativeBatch(input)
    : null;
  return {
    input,
    campaign,
    store,
    adapter,
    batch,
    statisticsPlan,
    reservation,
    makeAdapter,
    reopen: () => makeAdapter(openLedgerV2Fixture(root, storeOptions)),
    async collectReceipt({ cohorts = [] } = {}) {
      const census = await collectRrsiNativeBatchEvidence({
        historyAdapter: adapter,
        batchDigest: batch.batchDigest,
        cohorts,
      });
      const receipt = await buildRrsiNativeQualityReceipt({
        batchEvidence: census,
        plan: statisticsPlan,
      });
      return { census, receipt };
    },
  };
}
