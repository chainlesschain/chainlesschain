import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openRrsiNativeQualityStore } from "../fixtures/rrsi-native-quality-store.js";
import { rrsiNativeBatchFixture } from "../fixtures/rrsi-native-batch.js";
import {
  buildRrsiNativeQualityReceipt,
  captureRrsiNativeQualityReceipt,
  RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA,
} from "../../src/lib/evolution/rrsi-native-quality-receipt.js";
import { rrsiCanonical, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const roots = [];
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture(options) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "rrsi-quality-receipt-"),
  );
  roots.push(root);
  return openRrsiNativeQualityStore(root, options);
}
afterAll(() => {
  const expectedParent = fs.realpathSync.native(os.tmpdir());
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== expectedParent ||
      !path.basename(resolved).startsWith("rrsi-quality-receipt-")
    )
      throw new Error("quality test cleanup escaped its temporary root");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("live native required-quality receipts", () => {
  let value, census, receipt;
  beforeAll(async () => {
    value = fixture();
    ({ census, receipt } = await value.collectReceipt());
  }, 180000);

  it("binds actual registered selection census and retains every missing row as HOLD", () => {
    expect(receipt).toMatchObject({
      schema: RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA,
      assessmentKind: "selection-required-quality",
      stage: "selection",
      campaignDigest: value.campaign.campaignDigest,
      batchDigest: value.batch.batchDigest,
      candidate: value.batch.candidate,
      parentIdentity: value.batch.parentIdentity,
      versions: value.batch.versions,
      targetIdentity: value.batch.targetIdentity,
      statisticsRegistration: census.statisticsRegistration,
      auditHead: census.auditHead,
      nativeBatchEvidenceDigest: census.batchEvidenceDigest,
      observedRowClaims: 0,
      missingActorObservations: 2880,
      decision: "HOLD",
      qualityVerdictVerified: false,
      qualifiesForPromotion: false,
      grantsFinalEvaluationAuthority: false,
      grantsMutationOrDispatchAuthority: false,
      verifiedControlEvidence: {
        originalHistoryJournalBound: true,
        originalReceiptInventoryReverified: true,
        controlledHistoryRegistrationOrderVerified: true,
        completeSignedRows: false,
        fullTriangleRowsPresent: false,
      },
      budget: { declaredBudgetSettlementComplete: false },
    });
    expect(Object.values(receipt.unverifiedProductionPrerequisites)).toEqual(
      Object.values(receipt.unverifiedProductionPrerequisites).map(() => false),
    );
    expect(receipt.blockingReasons).toEqual(
      expect.arrayContaining([
        "MISSING_SIGNED_ROWS",
        "INCOMPLETE_TRIANGLE_DENOMINATOR",
        "UNSETTLED_NATIVE_BUDGET",
        "SOURCE_INDEPENDENCE_UNVERIFIED",
        "CALIBRATION_UNVERIFIED",
        "CLEANUP_UNVERIFIED",
      ]),
    );
  });

  it("retains live census, original canonical bytes, report and genuine journal", () => {
    const captured = captureRrsiNativeQualityReceipt(receipt);
    expect(captured.batchEvidence).toBe(census);
    expect(captured.historyLedger).toBe(value.store.backend.ledger);
    expect(captured.receiptBytes).toBe(rrsiCanonical(receipt));
    expect(captured.statisticsReportBytes).toBe(
      rrsiCanonical(captured.statisticsReport),
    );
    expect(captured.statisticsReport.statisticsReportDigest).toBe(
      receipt.statisticsReportDigest,
    );
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(receipt.candidate)).toBe(true);
  });

  it("rejects JSON copies, prototype copies, proxies and rehashed PASS claims", () => {
    const passed = clone(receipt);
    passed.decision = "PASS";
    passed.qualityVerdictVerified = true;
    passed.qualifiesForPromotion = true;
    delete passed.qualityReceiptDigest;
    passed.qualityReceiptDigest = rrsiHash(
      RRSI_NATIVE_QUALITY_RECEIPT_SCHEMA,
      passed,
    );
    let traps = 0;
    const proxy = new Proxy(receipt, {
      get() {
        traps++;
        throw new Error("must not read proxy");
      },
    });
    for (const candidate of [
      clone(receipt),
      Object.create(receipt),
      proxy,
      passed,
    ])
      expect(() => captureRrsiNativeQualityReceipt(candidate)).toThrow(
        /live branded/,
      );
    expect(traps).toBe(0);
  });

  it("rejects injected report, quality claims and callbacks without invoking them", async () => {
    let calls = 0;
    const base = { batchEvidence: census, plan: value.statisticsPlan };
    for (const extra of [
      { statisticsReport: {} },
      { qualityVerdictVerified: true },
      { verify: () => calls++ },
      { now: () => calls++ },
    ])
      await expect(
        buildRrsiNativeQualityReceipt({ ...base, ...extra }),
      ).rejects.toThrow(/only a live batch census and plan/);
    const accessor = { ...base };
    Object.defineProperty(accessor, "plan", {
      enumerable: true,
      get() {
        calls++;
        return value.statisticsPlan;
      },
    });
    await expect(buildRrsiNativeQualityReceipt(accessor)).rejects.toThrow(
      /accessors/,
    );
    await expect(
      buildRrsiNativeQualityReceipt(new Proxy(base, {})),
    ).rejects.toThrow(/only a live/);
    expect(calls).toBe(0);
  });

  it("cannot mint from a copied census or substituted statistical plan", async () => {
    await expect(
      buildRrsiNativeQualityReceipt({
        batchEvidence: clone(census),
        plan: value.statisticsPlan,
      }),
    ).rejects.toThrow(/live branded/);
    const plan = clone(value.statisticsPlan);
    plan.batchDigest = `sha256:${"0".repeat(64)}`;
    await expect(
      buildRrsiNativeQualityReceipt({ batchEvidence: census, plan }),
    ).rejects.toThrow();
  });

  it("revalidates through another genuine adapter of the exact original journal", async () => {
    const captured = captureRrsiNativeQualityReceipt(receipt);
    const adapter = value.makeAdapter(value.store);
    await expect(captured.assertCurrentHistory(adapter)).resolves.toBe(receipt);
  }, 180000);

  it("rejects another genuine journal and fake History, even with the same scope", async () => {
    const captured = captureRrsiNativeQualityReceipt(receipt);
    const foreign = fixture({ reserve: false });
    await expect(
      captured.assertCurrentHistory(foreign.adapter),
    ).rejects.toThrow(/another genuine History journal/);
    await expect(
      captured.assertCurrentHistory({ ...value.adapter }),
    ).rejects.toThrow(/branded RRSI history/);
    await expect(
      captured.assertCurrentHistory(new Proxy(value.adapter, {})),
    ).rejects.toThrow(/branded RRSI history/);
  }, 180000);

  it("does not upgrade an unregistered legacy census to preregistered quality", async () => {
    const legacy = fixture({ preregistered: false });
    const result = await legacy.collectReceipt();
    expect(result.receipt.statisticsRegistration).toBeNull();
    expect(
      result.receipt.verifiedControlEvidence
        .controlledHistoryRegistrationOrderVerified,
    ).toBe(false);
    expect(result.receipt.blockingReasons).toContain(
      "STATISTICAL_PROTOCOL_NOT_PREREGISTERED",
    );
    expect(result.receipt.qualityVerdictVerified).toBe(false);
  }, 180000);

  it("invalidates a receipt when the original History head advances", async () => {
    const captured = captureRrsiNativeQualityReceipt(receipt);
    const second = rrsiNativeBatchFixture();
    second.queryId = "quality-another-registered-query";
    value.adapter.registerNativeStatisticsPlan(second);
    await expect(
      captured.assertCurrentHistory(value.adapter),
    ).rejects.toThrow();
    await expect(captured.assertCurrentHistory(value.adapter)).rejects.toThrow(
      /invalidated/,
    );
    await expect(
      buildRrsiNativeQualityReceipt({
        batchEvidence: census,
        plan: value.statisticsPlan,
      }),
    ).rejects.toThrow();
  }, 180000);
});
