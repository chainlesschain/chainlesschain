import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPrivateKey } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";
import {
  rrsiNativeBatchFixture,
  signNativeChildSettlement,
} from "../fixtures/rrsi-native-batch.js";
import { collectRrsiNativeBatchEvidence } from "../../src/lib/evolution/rrsi-native-batch-evidence.js";
import { buildRrsiNativeQualityReceipt } from "../../src/lib/evolution/rrsi-native-quality-receipt.js";
import {
  RRSI_HISTORY_EVENT_SCHEMA,
  RRSI_HISTORY_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { rrsiEnvelope, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const roots = [],
  tempRoot = fs.realpathSync.native(os.tmpdir()),
  input = rrsiNativeBatchFixture();
function fixture(crashHook = null) {
  const root = fs.mkdtempSync(path.join(tempRoot, "rrsi-quality-recovery-"));
  roots.push(root);
  const value = openRrsiHistoryStore(root, { initialize: true, crashHook });
  value.adapter.registerCampaign(input.planContext.context.campaign);
  value.adapter.registerNativeStatisticsScope({
    execution: input.planContext.executionContract,
  });
  const plan = value.adapter.registerNativeStatisticsPlan(input).statisticsPlan;
  const reservation = value.adapter.reserveNativeBatchV2(input);
  return { ...value, root, plan, reservation };
}
async function receiptFor(value) {
  return buildRrsiNativeQualityReceipt({
    batchEvidence: await collectRrsiNativeBatchEvidence({
      historyAdapter: value.adapter,
      batchDigest: value.reservation.batchDigest,
      cohorts: [],
    }),
    plan: value.plan,
  });
}
function appendPreQualityFreeze(value) {
  const ledger = value.store.backend.ledger,
    head = ledger.verify(),
    last = ledger.read({ afterSequence: 0, limit: 1000 }).at(-1);
  const previous = JSON.parse(
    value.store
      .resolver({
        epoch: head.epoch,
        ledgerId: head.ledgerId,
        ref: last.subjectRef,
        tenantId: "rrsi-artifacts",
      })
      .bytes.toString("utf8"),
  ).value;
  const campaign = input.planContext.context.campaign,
    operationId = `freeze.${campaign.campaignDigest.slice(7)}`,
    timestamp = new Date(value.store.clock()).toISOString();
  const record = rrsiEnvelope(RRSI_HISTORY_EVENT_SCHEMA, "recordDigest", {
    descriptor: value.adapter.descriptor,
    ledgerId: head.ledgerId,
    epoch: head.epoch,
    operationId,
    kind: "freeze",
    payload: {
      campaignDigest: campaign.campaignDigest,
      contentDigest: input.candidate.contentDigest,
    },
    previousRecordDigest: previous.recordDigest,
    acceptedAt: timestamp,
  });
  const published = value.store.artifactPorts.putCanonical(
    "rrsi-history-event",
    record,
    {
      audience: value.adapter.descriptor.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    },
  );
  const scopeDigest = rrsiHash(
    "chainlesschain.rrsi-history-descriptor/v1",
    value.adapter.descriptor,
  );
  ledger.appendDomainEvent(
    {
      type: RRSI_HISTORY_EVENT_TYPE,
      eventId: `rrsi.${rrsiHash("chainlesschain.rrsi-history-operation/v1", { scopeDigest, operationId }).slice(7)}`,
      tenantId: campaign.tenantId,
      artifactTenantId: "rrsi-artifacts",
      correlationId: value.adapter.descriptor.scopeId,
      skillName: campaign.goalId,
      decision: "accepted",
      reason:
        "TEST ONLY genuine pre-quality freeze intent, never a quality verdict",
      sourceRefs: [],
      subjectRef: published.ref,
      timestamp,
    },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
  );
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      path.dirname(target) !== tempRoot ||
      !path.basename(target).startsWith("rrsi-quality-recovery-")
    )
      throw new Error("unsafe recovery fixture cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("native required-quality crash and compatibility controls", () => {
  it("recovers an actual append response lost after head commit without replaying its stale census", async () => {
    let armed = false;
    const value = fixture((phase) => {
      if (armed && phase === "after-head")
        throw new Error("TEST quality response lost");
    });
    const receipt = await receiptFor(value),
      before = value.store.backend.ledger.verify();
    armed = true;
    await expect(
      value.adapter.recordNativeQualityReceipt({ qualityReceipt: receipt }),
    ).rejects.toThrow(/requires readback/);
    armed = false;
    const recovered = await value.adapter.recordNativeQualityReceipt({
      qualityReceipt: receipt,
    });
    expect(recovered).toMatchObject({
      newlyCommitted: false,
      historicalSnapshotOnly: true,
      qualityVerdictVerified: false,
      grantsFinalEvaluationAuthority: false,
    });
    expect(recovered.qualityReceipt).toEqual(receipt);
    expect(value.store.backend.ledger.verify().sequence).toBe(
      before.sequence + 1,
    );
    const reopened = openRrsiHistoryStore(
      value.root,
    ).adapter.resolveNativeQualityReceipt({
      qualityReceiptDigest: receipt.qualityReceiptDigest,
    });
    expect(reopened.qualityReceipt).toEqual(receipt);
    expect(reopened.currentReceiptFreshnessVerified).toBe(false);
  }, 180000);

  it("keeps an authenticated older freeze readable but never upgrades settlement success into v2 final authority", async () => {
    const value = fixture(),
      key = createPrivateKey(
        fs.readFileSync(
          path.join(value.root, "test-control", "settlement-private.pem"),
        ),
      );
    for (const child of value.reservation.children) {
      value.adapter.recordNativeDispatch(child);
      value.adapter.settle(signNativeChildSettlement(value, child, key));
    }
    const receipt = await receiptFor(value);
    expect(receipt.budget.declaredBudgetSettlementComplete).toBe(true);
    expect(receipt.qualityVerdictVerified).toBe(false);
    expect(() =>
      value.adapter.freezeCandidate({
        campaignDigest: input.planContext.context.campaign.campaignDigest,
        contentDigest: input.candidate.contentDigest,
      }),
    ).toThrow(/quality receipt/);
    appendPreQualityFreeze(value);
    const reopened = openRrsiHistoryStore(value.root).adapter;
    expect(
      reopened
        .inspect()
        .executions.every((entry) => entry.status === "settled"),
    ).toBe(true);
    expect(
      reopened.freezeCandidate({
        campaignDigest: input.planContext.context.campaign.campaignDigest,
        contentDigest: input.candidate.contentDigest,
      }),
    ).toBe(false);
    const finalInput = rrsiNativeBatchFixture({ stage: "generalization" });
    reopened.registerNativeStatisticsPlan(finalInput);
    const head = value.store.backend.ledger.verify();
    expect(() => reopened.reserveNativeBatchV2(finalInput)).toThrow(
      /quality receipt/,
    );
    expect(() => reopened.reserveNativeBatch(finalInput)).toThrow(
      /prohibits legacy native/,
    );
    expect(value.store.backend.ledger.verify().sequence).toBe(head.sequence);
    expect(reopened.inspect().selectionQueries).toBe(1);
  }, 240000);
});
