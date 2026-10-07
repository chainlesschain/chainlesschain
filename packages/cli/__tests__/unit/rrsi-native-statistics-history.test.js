import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rrsiNativeBatchFixture } from "../fixtures/rrsi-native-batch.js";
import { openRrsiHistoryStore } from "../fixtures/rrsi-history-store.js";
import { openLedgerV2Fixture } from "../fixtures/evolution-ledger-v2-store.js";
import { rrsiFixtureDigest as digest } from "../fixtures/rrsi-shadow-fixture.js";
import { buildRrsiCampaign } from "../../src/lib/evolution/rrsi-contracts.js";
import { buildRrsiNativeEvaluationBatch } from "../../src/lib/evolution/rrsi-native-evaluation-batch.js";
import {
  createRrsiHistoryLedgerAdapter,
  RRSI_HISTORY_EVENT_SCHEMA,
  RRSI_HISTORY_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  rrsiCanonical,
  rrsiEnvelope,
  rrsiHash,
} from "../../src/lib/evolution/rrsi-data.js";
import { collectRrsiNativeBatchEvidence } from "../../src/lib/evolution/rrsi-native-batch-evidence.js";
import { analyzeRrsiNativeBatchGroupStatistics } from "../../src/lib/evolution/rrsi-native-group-statistics.js";
import { buildRrsiNativeGroupStatisticsPlan } from "../../src/lib/evolution/rrsi-native-group-statistics-plan.js";

const input = rrsiNativeBatchFixture();
const campaign = input.planContext.context.campaign;
const execution = input.planContext.executionContract;
const clone = (value) => JSON.parse(JSON.stringify(value));
const roots = [];
const tempRoot = fs.realpathSync.native(os.tmpdir());
function fixture({ v2 = false, crashHook = null } = {}) {
  const root = fs.mkdtempSync(path.join(tempRoot, "rrsi-stats-history-"));
  roots.push(root);
  const original = openRrsiHistoryStore(root, { initialize: true, crashHook });
  const storeOptions = {
    tenantId: campaign.tenantId,
    artifactTenantId: "rrsi-artifacts",
    audience: "rrsi-runtime",
  };
  const v2Root = path.join(root, "v2");
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
      settlementVerifier: original.settlementVerifier,
      now: store.clock,
    });
  const store = v2 ? openLedgerV2Fixture(v2Root, storeOptions) : original.store;
  const adapter = v2 ? makeAdapter(store) : original.adapter;
  adapter.registerCampaign(campaign);
  return {
    ...original,
    root,
    store,
    adapter,
    reopen: () =>
      v2
        ? makeAdapter(openLedgerV2Fixture(v2Root, storeOptions))
        : openRrsiHistoryStore(root).adapter,
  };
}
function preregister(value) {
  const scope = value.adapter.registerNativeStatisticsScope({ execution });
  const plan = value.adapter.registerNativeStatisticsPlan(input);
  return { scope, plan };
}
// These are genuine retained, correctly hashed Ledger records carrying invalid
// domain actions. Authentication must not bypass History's application rules.
function appendTestRecord(value, kind, operationId, payload, sourceRefs = []) {
  const ledger = value.store.backend.ledger;
  const head = ledger.verify();
  const last = ledger.read({ afterSequence: 0, limit: 1000 }).at(-1);
  const previous = JSON.parse(
    value.store
      .resolver({
        epoch: head.epoch,
        ledgerId: head.ledgerId,
        ref: last.subjectRef,
        tenantId: value.adapter.descriptor.artifactTenantId,
      })
      .bytes.toString("utf8"),
  ).value;
  const acceptedAt = new Date(value.store.clock()).toISOString();
  const record = rrsiEnvelope(RRSI_HISTORY_EVENT_SCHEMA, "recordDigest", {
    descriptor: value.adapter.descriptor,
    ledgerId: head.ledgerId,
    epoch: head.epoch,
    operationId,
    kind,
    payload,
    previousRecordDigest: previous.recordDigest,
    acceptedAt,
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
      reason: "TEST ONLY authenticated invalid domain action",
      sourceRefs,
      subjectRef: published.ref,
      timestamp: acceptedAt,
    },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
  );
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      path.dirname(target) !== tempRoot ||
      !path.basename(target).startsWith("rrsi-stats-history-")
    )
      throw new Error("unsafe statistics fixture cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("native statistics preregistration in genuine History", () => {
  it.each(["scope", "plan", "reservation"])(
    "recovers %s committed before a lost response without granting fresh execution",
    (stage) => {
      let armed = false;
      const value = fixture({
        crashHook(phase) {
          if (armed && phase === "after-head")
            throw new Error("TEST statistics response lost");
        },
      });
      if (stage !== "scope")
        value.adapter.registerNativeStatisticsScope({ execution });
      if (stage === "reservation")
        value.adapter.registerNativeStatisticsPlan(input);
      armed = true;
      const action = (adapter) =>
        stage === "scope"
          ? adapter.registerNativeStatisticsScope({ execution })
          : stage === "plan"
            ? adapter.registerNativeStatisticsPlan(input)
            : adapter.reserveNativeBatchV2(input);
      expect(() => action(value.adapter)).toThrow(/requires readback/);
      armed = false;
      const recovered = value.reopen();
      const response = action(recovered);
      expect(response.newlyCommitted).toBe(false);
      if (stage === "reservation") {
        expect(
          recovered.resolveNativeBatch({ batchDigest: response.batchDigest })
            .statisticsRegistration.preObservationRegistrationVerified,
        ).toBe(true);
        expect(() =>
          recovered.recordNativeDispatch(response.children[0]),
        ).toThrow(/fresh child/);
        expect(recovered.inspect().selectionQueries).toBe(1);
      } else expect(recovered.inspect().selectionQueries).toBe(0);
    },
    90000,
  );
  it("binds root, scope, plan and v2 reservation in strict order on a real v2 journal", async () => {
    const value = fixture({ v2: true }),
      { scope, plan } = preregister(value);
    const response = value.adapter.reserveNativeBatchV2(input);
    const resolution = value.adapter.resolveNativeBatch({
      batchDigest: response.batchDigest,
    });
    const registration = resolution.statisticsRegistration;
    expect(registration).toMatchObject({
      protocolDigest: scope.protocol.protocolDigest,
      statisticsPlanDigest: plan.statisticsPlan.statisticsPlanDigest,
      scopeRegistrationRecord: scope.registrationRecord,
      planRegistrationRecord: plan.registrationRecord,
      reservationRecord: resolution.reservationRecord,
      reservationKind: "reserve-native-batch-v2",
      preObservationRegistrationVerified: true,
      statisticalProtocolValidated: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
    expect(registration.binding.rootRegistrationRecord.sequence).toBeLessThan(
      scope.registrationRecord.sequence,
    );
    expect(scope.registrationRecord.sequence).toBeLessThan(
      plan.registrationRecord.sequence,
    );
    expect(plan.registrationRecord.sequence).toBeLessThan(
      resolution.reservationRecord.sequence,
    );
    const events = value.store.backend.ledger.read({
      afterSequence: 0,
      limit: 1000,
    });
    expect(
      events.find(
        (event) => event.sequence === scope.registrationRecord.sequence,
      ).sourceRefs,
    ).toEqual([scope.binding.rootRegistrationRecord.ref]);
    expect(
      events.find(
        (event) => event.sequence === plan.registrationRecord.sequence,
      ).sourceRefs,
    ).toEqual([scope.registrationRecord.ref]);
    expect(
      events.find(
        (event) => event.sequence === resolution.reservationRecord.sequence,
      ).sourceRefs,
    ).toHaveLength(2);
    expect(
      value.reopen().resolveNativeBatch({ batchDigest: response.batchDigest }),
    ).toEqual(resolution);
    const census = await collectRrsiNativeBatchEvidence({
      historyAdapter: value.adapter,
      batchDigest: response.batchDigest,
      cohorts: [],
    });
    expect(census).toMatchObject({
      schema: "chainlesschain.rrsi-native-batch-evidence/v2",
      preObservationRegistrationVerified: true,
      controlledHistoryRegistrationOrderVerified: true,
      underlyingObservationTimeVerified: false,
      decision: "HOLD",
    });
    const report = analyzeRrsiNativeBatchGroupStatistics({
      batchEvidence: census,
      plan: plan.statisticsPlan,
    });
    expect(report).toMatchObject({
      schema: "chainlesschain.rrsi-native-group-statistics-report/v3",
      preObservationRegistrationVerified: true,
      controlledHistoryRegistrationOrderVerified: true,
      underlyingObservationTimeVerified: false,
      observedRowClaims: 0,
      missingActorObservations: 2880,
      crossSelectionQueryErrorRateControlled: false,
      decision: "HOLD",
      statisticalProtocolValidated: false,
      qualityVerdictVerified: false,
    });
    expect(report.blockingReasons).not.toContain(
      "STATISTICAL_PROTOCOL_NOT_PREREGISTERED",
    );
    expect(report.blockingReasons).toContain(
      "STATISTICAL_PROTOCOL_UNVALIDATED",
    );
    expect(report.blockingReasons).toContain("MISSING_SIGNED_ROWS");
    expect(() =>
      analyzeRrsiNativeBatchGroupStatistics({
        batchEvidence: clone(census),
        plan: plan.statisticsPlan,
      }),
    ).toThrow(/live branded/);
  }, 180000);

  it("keeps registration idempotent and never regenerates dispatch capabilities after retry or reopening", () => {
    const value = fixture(),
      first = preregister(value);
    const head = value.store.backend.ledger.verify();
    expect(
      value.adapter.registerNativeStatisticsScope({ execution }).newlyCommitted,
    ).toBe(false);
    expect(
      value.adapter.registerNativeStatisticsPlan(input).newlyCommitted,
    ).toBe(false);
    expect(value.store.backend.ledger.verify().sequence).toBe(head.sequence);
    const response = value.adapter.reserveNativeBatchV2(input);
    expect(response.newlyCommitted).toBe(true);
    expect(
      value.adapter.registerNativeStatisticsPlan(input).statisticsPlan,
    ).toEqual(first.plan.statisticsPlan);
    const recovered = value.reopen().reserveNativeBatchV2(input);
    expect(recovered.newlyCommitted).toBe(false);
    expect(() =>
      value.adapter.recordNativeDispatch(recovered.children[0]),
    ).toThrow(/fresh child/);
    expect(() =>
      value.adapter.recordNativeDispatch(clone(response.children[0])),
    ).toThrow(/fresh child/);
    expect(
      value.adapter.recordNativeDispatch(response.children[0]).newlyCommitted,
    ).toBe(true);
    expect(() =>
      value.adapter.recordNativeDispatch(response.children[0]),
    ).toThrow(/fresh child/);
  }, 180000);

  it("requires the scope and exact query plan before reservation and prevents legacy downgrade", () => {
    const value = fixture();
    expect(() => value.adapter.reserveNativeBatchV2(input)).toThrow(
      /scope is not preregistered/,
    );
    value.adapter.registerNativeStatisticsScope({ execution });
    expect(() => value.adapter.reserveNativeBatchV2(input)).toThrow(
      /matching observation-before-reservation plan/,
    );
    expect(() => value.adapter.reserveNativeBatch(input)).toThrow(
      /prohibits legacy native/,
    );
    expect(() =>
      value.adapter.reserve(
        value.request({
          campaignDigest: campaign.campaignDigest,
          candidate: input.candidate,
        }),
      ),
    ).toThrow(/prohibits legacy evaluation/);
    expect(value.adapter.inspect().selectionQueries).toBe(0);
  }, 90000);

  it("rejects first scope registration after an undispatched or unknown legacy native reservation", () => {
    const value = fixture(),
      reserved = value.adapter.reserveNativeBatch(input);
    expect(() =>
      value.adapter.registerNativeStatisticsScope({ execution }),
    ).toThrow(/before any execution reservation/);
    value.adapter.markNativeUnknown({
      childId: reserved.children[0].childId,
      batchDigest: reserved.batchDigest,
    });
    expect(() =>
      value.reopen().registerNativeStatisticsScope({ execution }),
    ).toThrow(/before any execution reservation/);
    expect(
      value.adapter.resolveNativeBatch({ batchDigest: reserved.batchDigest }),
    ).not.toHaveProperty("statisticsRegistration");
  }, 90000);

  it("rejects first scope registration even after a cancelled preparation releases its resource budget", () => {
    const value = fixture();
    value.adapter.registerPreparationPlan(
      value.preparationPlan({ campaignDigest: campaign.campaignDigest }),
    );
    const reserved = value.adapter.reservePreparation(
      value.preparationRequest({ campaignDigest: campaign.campaignDigest }),
    );
    value.adapter.settle(
      value.signSettlement(reserved.reservation, {
        status: "not-started",
        usage: {
          tokens: 0,
          toolCalls: 0,
          wallClockMs: 0,
          costMicrounits: 0,
          executions: 0,
        },
      }),
    );
    expect(() =>
      value.reopen().registerNativeStatisticsScope({ execution }),
    ).toThrow(/before any execution reservation/);
    expect(value.adapter.inspect().preparationAttempts).toBe(1);
  }, 90000);

  it("freezes the method, data population and randomness across new campaign IDs", () => {
    const value = fixture();
    value.adapter.registerNativeStatisticsScope({ execution });
    const fields = clone(campaign);
    for (const name of [
      "schema",
      "campaignDigest",
      "alphaPerComparison",
      "plannedFinalExecutionsPerArm",
      "plannedSelectionExecutionsPerExploringArm",
      "statisticalProtocolValidated",
      "structuralOnly",
      "authenticated",
      "readyForExecution",
      "qualifiesForPromotion",
    ])
      delete fields[name];
    const same = buildRrsiCampaign({
      ...fields,
      campaignId: "same-scope-new-campaign",
    });
    expect(value.adapter.registerCampaign(same).newlyCommitted).toBe(true);
    const changed = buildRrsiCampaign({
      ...fields,
      campaignId: "changed-statistical-campaign",
      experiment: { ...fields.experiment, bootstrapSamples: 20000 },
    });
    expect(() => value.reopen().registerCampaign(changed)).toThrow(
      /scope protocol/,
    );
  }, 90000);

  it("rejects replacement of an already registered query even before any model execution", () => {
    const value = fixture();
    preregister(value);
    const changed = clone(input);
    Object.values(changed.allocations[0].byArm)[0].costInventoryDigest = digest(
      "TEST substituted query inventory",
    );
    expect(() => value.adapter.registerNativeStatisticsPlan(changed)).toThrow(
      /operation ID is bound to different data/,
    );
    expect(value.adapter.inspect().selectionQueries).toBe(0);
  }, 90000);

  it("rejects a correctly authenticated old reservation record appended after a statistics scope", () => {
    const value = fixture();
    value.adapter.registerNativeStatisticsScope({ execution });
    const batch = buildRrsiNativeEvaluationBatch(input);
    appendTestRecord(
      value,
      "reserve-native-batch",
      `reserve-native.${rrsiHash("chainlesschain.rrsi-native-query-operation/v1", batch.queryId).slice(7)}`,
      { batch },
    );
    expect(() => value.reopen()).toThrow(/prohibits legacy native/);
  }, 90000);

  it("rejects a signed plan artifact that replaces the scope registration digest", () => {
    const value = fixture(),
      scope = value.adapter.registerNativeStatisticsScope({ execution });
    const batch = buildRrsiNativeEvaluationBatch(input);
    const statisticsPlan = buildRrsiNativeGroupStatisticsPlan({
      campaign,
      batch,
    });
    appendTestRecord(
      value,
      "register-native-statistics-plan-v2",
      `statistics-plan.${rrsiHash("chainlesschain.rrsi-native-query-operation/v1", batch.queryId).slice(7)}`,
      {
        batch,
        statisticsPlan,
        scopeRegistrationRecord: {
          ...scope.registrationRecord,
          recordDigest: digest("TEST other scope record"),
        },
      },
      [scope.registrationRecord.ref],
    );
    expect(() => value.reopen()).toThrow(/replaces its scope registration/);
  }, 90000);

  it("keeps full v2 statistical plan bytes in the actual retained preregistration artifact", () => {
    const value = fixture(),
      { plan } = preregister(value);
    const head = value.store.backend.ledger.verify();
    const stored = JSON.parse(
      value.store
        .resolver({
          epoch: head.epoch,
          ledgerId: head.ledgerId,
          ref: plan.registrationRecord.ref,
          tenantId: "rrsi-artifacts",
        })
        .bytes.toString("utf8"),
    );
    expect(rrsiCanonical(stored.value.payload.statisticsPlan)).toBe(
      rrsiCanonical(plan.statisticsPlan),
    );
    expect(
      stored.value.payload.statisticsPlan.preObservationRegistrationVerified,
    ).toBe(false);
  }, 90000);
});
