import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openRrsiNativeQualityStore } from "../fixtures/rrsi-native-quality-store.js";
import { rrsiNativeBatchFixture } from "../fixtures/rrsi-native-batch.js";
import {
  RRSI_HISTORY_EVENT_SCHEMA,
  RRSI_HISTORY_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { rrsiEnvelope, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";
const roots = [],
  tempRoot = fs.realpathSync.native(os.tmpdir()),
  input = rrsiNativeBatchFixture();
function fixture() {
  const root = fs.mkdtempSync(path.join(tempRoot, "rrsi-quality-provenance-"));
  roots.push(root);
  return openRrsiNativeQualityStore(root, { input });
}
function appendAuthenticatedAssessment(
  value,
  receipt,
  {
    operationId = `quality.${receipt.qualityReceiptDigest.slice(7)}`,
    dropRefs = false,
  } = {},
) {
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
  const timestamp = new Date(value.store.clock()).toISOString(),
    descriptor = value.adapter.descriptor;
  const record = rrsiEnvelope(RRSI_HISTORY_EVENT_SCHEMA, "recordDigest", {
    descriptor,
    ledgerId: head.ledgerId,
    epoch: head.epoch,
    operationId,
    kind: "record-native-quality-receipt-v1",
    payload: { qualityReceipt: receipt },
    previousRecordDigest: previous.recordDigest,
    acceptedAt: timestamp,
  });
  const published = value.store.artifactPorts.putCanonical(
    "rrsi-history-event",
    record,
    {
      audience: descriptor.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    },
  );
  const scopeDigest = rrsiHash(
    "chainlesschain.rrsi-history-descriptor/v1",
    descriptor,
  );
  ledger.appendDomainEvent(
    {
      type: RRSI_HISTORY_EVENT_TYPE,
      eventId: `rrsi.${rrsiHash("chainlesschain.rrsi-history-operation/v1", { scopeDigest, operationId }).slice(7)}`,
      tenantId: descriptor.tenantId,
      artifactTenantId: descriptor.artifactTenantId,
      correlationId: descriptor.scopeId,
      skillName: descriptor.goalId,
      decision: "accepted",
      reason: "TEST ONLY authenticated invalid quality assertion",
      sourceRefs: dropRefs
        ? []
        : [
            receipt.statisticsRegistration.scopeRegistrationRecord.ref,
            receipt.statisticsRegistration.planRegistrationRecord.ref,
            receipt.reservationRecord.ref,
          ].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
      subjectRef: published.ref,
      timestamp,
    },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
  );
  expect(ledger.verify().status).toBe("verified");
  const retained = value.store.resolver({
    epoch: head.epoch,
    ledgerId: head.ledgerId,
    ref: published.ref,
    tenantId: descriptor.artifactTenantId,
  });
  expect(retained.found).toBe(true);
  expect(JSON.parse(retained.bytes.toString("utf8")).value).toEqual(record);
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      path.dirname(target) !== tempRoot ||
      !path.basename(target).startsWith("rrsi-quality-provenance-")
    )
      throw new Error("unsafe quality provenance cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("native quality History provenance beyond valid signatures", () => {
  it("rejects a retained correctly hashed assessment with a noncanonical operation ID", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt();
    appendAuthenticatedAssessment(value, receipt, {
      operationId: "quality.wrong-canonical-id",
    });
    expect(() =>
      value.adapter.resolveNativeQualityReceipt({
        qualityReceiptDigest: receipt.qualityReceiptDigest,
      }),
    ).toThrow(/operation ID differs/);
    expect(() => value.reopen()).toThrow(/operation ID differs/);
  }, 180000);
  it("rejects a retained canonical assessment that deletes the actual source references", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt();
    appendAuthenticatedAssessment(value, receipt, { dropRefs: true });
    expect(() => value.adapter.inspect()).toThrow(/source references differ/);
    expect(() => value.reopen()).toThrow(/source references differ/);
  }, 180000);
  it("rejects a correctly signed and rehashed PASS claim instead of upgrading its historical assertion", async () => {
    const value = fixture(),
      { receipt } = await value.collectReceipt();
    const {
      schema,
      qualityReceiptDigest,
      structuralOnly,
      authenticated,
      readyForExecution,
      qualifiesForPromotion,
      ...core
    } = JSON.parse(JSON.stringify(receipt));
    void qualityReceiptDigest;
    void structuralOnly;
    void authenticated;
    void readyForExecution;
    void qualifiesForPromotion;
    const forged = rrsiEnvelope(schema, "qualityReceiptDigest", {
      ...core,
      decision: "PASS",
      qualityVerdictVerified: true,
      grantsFinalEvaluationAuthority: true,
    });
    appendAuthenticatedAssessment(value, forged);
    expect(() => value.adapter.inspect()).toThrow(
      /recorded quality .* differs/,
    );
    expect(() => value.reopen()).toThrow(/recorded quality .* differs/);
  }, 180000);
});
