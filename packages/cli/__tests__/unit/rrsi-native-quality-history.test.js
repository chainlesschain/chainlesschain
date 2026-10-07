import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openRrsiNativeQualityStore } from "../fixtures/rrsi-native-quality-store.js";
import {
  rrsiNativeBatchFixture,
  rotateNativeBatchCandidate,
} from "../fixtures/rrsi-native-batch.js";
import { captureRrsiNativeQualityReceipt } from "../../src/lib/evolution/rrsi-native-quality-receipt.js";
import { verifyRecordedRrsiNativeQualityReceipt } from "../../src/lib/evolution/rrsi-native-quality-receipt-contracts.js";
import {
  rrsiCanonical,
  rrsiEnvelope,
} from "../../src/lib/evolution/rrsi-data.js";

const roots = [],
  tempRoot = fs.realpathSync.native(os.tmpdir());
const input = rrsiNativeBatchFixture();
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture() {
  const root = fs.mkdtempSync(path.join(tempRoot, "rrsi-quality-history-"));
  roots.push(root);
  return { ...openRrsiNativeQualityStore(root, { input }), root };
}
function context(receipt) {
  const captured = captureRrsiNativeQualityReceipt(receipt);
  return {
    descriptor: captured.historyDescriptor,
    rootResolution: captured.rootResolution,
    batchResolution: captured.batchResolution,
    statisticsPlan: captured.plan,
    observedHead: captured.auditHead,
  };
}
function rehash(value) {
  const {
    schema,
    qualityReceiptDigest: ignored,
    structuralOnly: a,
    authenticated: b,
    readyForExecution: c,
    qualifiesForPromotion: d,
    ...core
  } = value;
  void ignored;
  void a;
  void b;
  void c;
  void d;
  return rrsiEnvelope(schema, "qualityReceiptDigest", core);
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      path.dirname(target) !== tempRoot ||
      !path.basename(target).startsWith("rrsi-quality-history-")
    )
      throw new Error("unsafe quality history cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("native required-quality durable boundary", () => {
  it("records the live HOLD assessment with actual sources and reopens only as a historical snapshot", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt();
    expect(
      verifyRecordedRrsiNativeQualityReceipt(receipt, context(receipt)),
    ).toEqual(receipt);
    const before = value.store.backend.ledger.verify();
    const recorded = await value.adapter.recordNativeQualityReceipt({
      qualityReceipt: receipt,
    });
    expect(recorded).toMatchObject({
      newlyCommitted: true,
      historicalSnapshotOnly: true,
      qualityVerdictVerified: false,
      qualifiesForPromotion: false,
    });
    expect(recorded.qualityReceipt).toEqual(receipt);
    const event = value.store.backend.ledger
      .read({ afterSequence: 0, limit: 1000 })
      .at(-1);
    expect(event.sequence).toBe(before.sequence + 1);
    expect(event.sourceRefs).toEqual(
      [
        receipt.statisticsRegistration.scopeRegistrationRecord.ref,
        receipt.statisticsRegistration.planRegistrationRecord.ref,
        receipt.reservationRecord.ref,
      ].sort((left, right) =>
        left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0,
      ),
    );
    const reopened = value.reopen().resolveNativeQualityReceipt({
      qualityReceiptDigest: receipt.qualityReceiptDigest,
    });
    expect(reopened.qualityReceipt).toEqual(receipt);
    expect(reopened).toMatchObject({
      historyAuthenticated: true,
      historicalSnapshotOnly: true,
      currentReceiptFreshnessVerified: false,
      qualityVerdictVerified: false,
      qualifiesForPromotion: false,
    });
    const repeated = await value.adapter.recordNativeQualityReceipt({
      qualityReceipt: receipt,
    });
    expect(repeated.newlyCommitted).toBe(false);
    expect(value.store.backend.ledger.verify().sequence).toBe(event.sequence);
    await expect(
      value.adapter.recordNativeQualityReceipt({
        qualityReceipt: clone(receipt),
      }),
    ).rejects.toThrow(/live branded/);
  }, 180000);

  it("rejects a true-flag rewrite, removed HOLD reasons, altered population and replaced provenance even after rehashing", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt(),
      originalContext = context(receipt);
    for (const mutate of [
      (copy) => {
        copy.qualityVerdictVerified = true;
        copy.decision = "PASS";
      },
      (copy) => {
        copy.unverifiedProductionPrerequisites.billingComplete = true;
      },
      (copy) => {
        copy.blockingReasons = copy.blockingReasons.filter(
          (reason) => reason !== "CALIBRATION_UNVERIFIED",
        );
      },
      (copy) => {
        copy.plannedActorObservations++;
      },
      (copy) => {
        copy.reservationRecord.sequence++;
      },
      (copy) => {
        copy.auditHead.sequence++;
      },
      (copy) => {
        copy.candidate.candidateId = "repackaged-candidate";
      },
    ]) {
      const copy = clone(receipt);
      mutate(copy);
      const changed = rehash(copy);
      expect(() =>
        verifyRecordedRrsiNativeQualityReceipt(changed, originalContext),
      ).toThrow();
      await expect(
        value.adapter.recordNativeQualityReceipt({ qualityReceipt: changed }),
      ).rejects.toThrow(/live branded/);
    }
    expect(value.store.backend.ledger.verify().sequence).toBe(
      receipt.auditHead.sequence,
    );
  }, 180000);

  it("cannot transplant a genuine receipt to another genuine journal with the same tenant and campaign", async () => {
    const left = fixture(),
      right = fixture(),
      { receipt } = await left.collectReceipt();
    await expect(
      right.adapter.recordNativeQualityReceipt({ qualityReceipt: receipt }),
    ).rejects.toThrow(/another.*journal|different.*journal/);
    expect(right.store.backend.ledger.verify().sequence).toBe(
      right.adapter.resolveNativeBatch({ batchDigest: right.batch.batchDigest })
        .reservationRecord.sequence,
    );
  }, 180000);

  it("does not rebase a live assessment onto a changed History head", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt();
    value.adapter.registerNativeStatisticsPlan(
      rotateNativeBatchCandidate(input, { freshInvocations: true }),
    );
    const head = value.store.backend.ledger.verify();
    await expect(
      value.adapter.recordNativeQualityReceipt({ qualityReceipt: receipt }),
    ).rejects.toThrow(/changed|invalidated|stale/);
    expect(value.store.backend.ledger.verify().sequence).toBe(head.sequence);
    expect(() =>
      value.reopen().resolveNativeQualityReceipt({
        qualityReceiptDigest: receipt.qualityReceiptDigest,
      }),
    ).toThrow(/not recorded/);
  }, 180000);

  it("keeps quality HOLD separate from legacy freeze intent and consumes no final query", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt();
    const head = value.store.backend.ledger.verify();
    expect(() =>
      value.adapter.freezeCandidate({
        campaignDigest: value.campaign.campaignDigest,
        contentDigest: value.batch.candidate.contentDigest,
      }),
    ).toThrow(/quality receipt/);
    await expect(
      value.adapter.freezeNativeCandidateV2({ qualityReceipt: receipt }),
    ).rejects.toThrow(/HOLD|unverified|quality/);
    const finalInput = rrsiNativeBatchFixture({ stage: "generalization" });
    value.adapter.registerNativeStatisticsPlan(finalInput);
    const beforeFinal = value.store.backend.ledger.verify();
    expect(() => value.adapter.reserveNativeBatchV2(finalInput)).toThrow(
      /quality receipt/,
    );
    expect(value.store.backend.ledger.verify().sequence).toBe(
      beforeFinal.sequence,
    );
    expect(value.adapter.inspect().selectionQueries).toBe(1);
    expect(beforeFinal.sequence).toBe(head.sequence + 1);
  }, 180000);

  it("rejects context accessors without invoking them and preserves original receipt bytes", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt(),
      original = context(receipt);
    let calls = 0;
    const hostile = { ...original };
    Object.defineProperty(hostile, "statisticsPlan", {
      enumerable: true,
      get() {
        calls++;
        throw new Error("accessed");
      },
    });
    expect(() =>
      verifyRecordedRrsiNativeQualityReceipt(receipt, hostile),
    ).toThrow(/accessors/);
    expect(calls).toBe(0);
    expect(rrsiCanonical(receipt)).toBe(
      captureRrsiNativeQualityReceipt(receipt).receiptBytes,
    );
  }, 180000);
});
