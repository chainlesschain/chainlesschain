import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { rrsiNativeBatchFixture } from "../fixtures/rrsi-native-batch.js";
import { openLedgerV2Fixture } from "../fixtures/evolution-ledger-v2-store.js";
import {
  createRrsiHistoryLedgerAdapter,
  RRSI_HISTORY_EVENT_SCHEMA,
  RRSI_HISTORY_EVENT_TYPE,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { buildRrsiNativeEvaluationBatch } from "../../src/lib/evolution/rrsi-native-evaluation-batch.js";
import { buildRrsiNativeGroupStatisticsPlan } from "../../src/lib/evolution/rrsi-native-group-statistics-plan.js";
import {
  buildRrsiNativeStatisticsScopeProtocol,
  normalizeRrsiNativeStatisticsExecutionContract,
} from "../../src/lib/evolution/rrsi-native-statistics-protocol.js";
import { rrsiEnvelope, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

const SCOPE_KIND = "register-native-statistics-scope-v2";
const PLAN_KIND = "register-native-statistics-plan-v2";
const RESERVE_KIND = "reserve-native-batch-v2";
const SCOPE_ID = "register.native-statistics-scope-v2";
const roots = [];
const tempRoot = fs.realpathSync.native(os.tmpdir());
let input,
  campaign,
  execution,
  protocol,
  batch,
  statisticsPlan,
  planId,
  reserveId;

beforeAll(() => {
  input = rrsiNativeBatchFixture();
  campaign = input.planContext.context.campaign;
  execution = normalizeRrsiNativeStatisticsExecutionContract({
    campaign,
    execution: input.planContext.executionContract,
  });
  protocol = buildRrsiNativeStatisticsScopeProtocol({ campaign, execution });
  batch = buildRrsiNativeEvaluationBatch(input);
  statisticsPlan = buildRrsiNativeGroupStatisticsPlan({ campaign, batch });
  const suffix = rrsiHash(
    "chainlesschain.rrsi-native-query-operation/v1",
    batch.queryId,
  ).slice(7);
  planId = `statistics-plan.${suffix}`;
  reserveId = `reserve-native.${suffix}`;
}, 120000);

function fixture() {
  const root = fs.mkdtempSync(path.join(tempRoot, "rrsi-stats-provenance-"));
  roots.push(root);
  const descriptor = {
    tenantId: campaign.tenantId,
    artifactTenantId: "rrsi-artifacts",
    audience: "rrsi-runtime",
    goalId: campaign.goalId,
    purpose: "evolution-ledger",
  };
  const options = {
    tenantId: descriptor.tenantId,
    artifactTenantId: descriptor.artifactTenantId,
    audience: descriptor.audience,
  };
  const makeAdapter = (store) =>
    createRrsiHistoryLedgerAdapter({
      backend: store.backend,
      artifactPorts: store.artifactPorts,
      ledgerArtifactResolver: store.resolver,
      descriptor,
      settlementVerifier: null,
      now: store.clock,
    });
  const store = openLedgerV2Fixture(root, options);
  const adapter = makeAdapter(store);
  adapter.registerCampaign(campaign);
  return {
    store,
    adapter,
    reopen: () => makeAdapter(openLedgerV2Fixture(root, options)),
  };
}

function readRetained(value, ref) {
  const head = value.store.backend.ledger.verify();
  const resolution = value.store.resolver({
    epoch: head.epoch,
    ledgerId: head.ledgerId,
    ref,
    tenantId: value.adapter.descriptor.artifactTenantId,
  });
  expect(resolution.authenticated).toBe(true);
  expect(resolution.found).toBe(true);
  return JSON.parse(resolution.bytes.toString("utf8")).value;
}

function retain(value, record) {
  const published = value.store.artifactPorts.putCanonical(
    "rrsi-history-event",
    record,
    {
      audience: value.adapter.descriptor.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    },
  );
  expect(published.receipt).toMatchObject({
    persisted: true,
    readbackVerified: true,
    integrityVerified: true,
  });
  return published.ref;
}

// Genuine retained artifact, record chain, manifest journal and CAS append.
// Only the domain meaning selected by a test is malformed.
function appendRecord(value, kind, operationId, payload, sourceRefs = []) {
  const ledger = value.store.backend.ledger;
  const head = ledger.verify();
  const last = ledger.read({ afterSequence: 0, limit: 1000 }).at(-1);
  const previous = readRetained(value, last.subjectRef);
  const descriptor = value.adapter.descriptor;
  const acceptedAt = new Date(value.store.clock()).toISOString();
  const record = rrsiEnvelope(RRSI_HISTORY_EVENT_SCHEMA, "recordDigest", {
    descriptor,
    ledgerId: head.ledgerId,
    epoch: head.epoch,
    operationId,
    kind,
    payload,
    previousRecordDigest: previous.recordDigest,
    acceptedAt,
  });
  const ref = retain(value, record);
  const scopeDigest = rrsiHash(
    "chainlesschain.rrsi-history-descriptor/v1",
    descriptor,
  );
  const receipt = ledger.appendDomainEvent(
    {
      type: RRSI_HISTORY_EVENT_TYPE,
      eventId: `rrsi.${rrsiHash("chainlesschain.rrsi-history-operation/v1", { scopeDigest, operationId }).slice(7)}`,
      tenantId: descriptor.tenantId,
      artifactTenantId: descriptor.artifactTenantId,
      correlationId: descriptor.scopeId,
      skillName: descriptor.goalId,
      decision: "accepted",
      reason: "TEST ONLY authenticated provenance boundary",
      sourceRefs: [...sourceRefs].sort((a, b) =>
        a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0,
      ),
      subjectRef: ref,
      timestamp: acceptedAt,
    },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
  );
  expect(receipt).toMatchObject({ authenticated: true, durable: true });
  expect(ledger.verify()).toMatchObject({
    authenticated: true,
    durable: true,
    status: "verified",
    sequence: head.sequence + 1,
  });
  expect(readRetained(value, ref)).toEqual(record);
  return {
    recordDigest: record.recordDigest,
    ref,
    sequence: head.sequence + 1,
  };
}

function scopeAction(value) {
  const root = value.adapter.resolveCampaignRoot();
  return {
    kind: SCOPE_KIND,
    operationId: SCOPE_ID,
    payload: {
      execution,
      protocol,
      binding: {
        historyScopeId: root.descriptor.scopeId,
        historyDescriptorDigest: rrsiHash(
          "chainlesschain.rrsi-history-descriptor/v1",
          root.descriptor,
        ),
        ledgerIdentity: root.identity,
        rootRegistrationRecord: root.registrationRecord,
      },
    },
    sourceRefs: [root.registrationRecord.ref],
  };
}

function planAction(value) {
  const scope = value.adapter.registerNativeStatisticsScope({ execution });
  return {
    kind: PLAN_KIND,
    operationId: planId,
    payload: {
      batch,
      statisticsPlan,
      scopeRegistrationRecord: scope.registrationRecord,
    },
    sourceRefs: [scope.registrationRecord.ref],
  };
}

function reserveAction(value) {
  const plan = planAction(value);
  const registrationRecord = appendAction(value, plan);
  // Ensure the correctly authenticated preceding plan is actually accepted.
  value.adapter.inspect();
  return {
    kind: RESERVE_KIND,
    operationId: reserveId,
    payload: {
      batch,
      scopeStatisticsRegistrationDigest:
        plan.payload.scopeRegistrationRecord.recordDigest,
      batchStatisticsRegistrationDigest: registrationRecord.recordDigest,
      statisticsPlanDigest: statisticsPlan.statisticsPlanDigest,
    },
    sourceRefs: [
      plan.payload.scopeRegistrationRecord.ref,
      registrationRecord.ref,
    ],
  };
}
function appendAction(value, action) {
  return appendRecord(
    value,
    action.kind,
    action.operationId,
    action.payload,
    action.sourceRefs,
  );
}
function rejected(value, message) {
  expect(() => value.adapter.inspect()).toThrow(message);
  expect(() => value.reopen()).toThrow(message);
  expect(value.store.backend.ledger.verify().authenticated).toBe(true);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    const target = path.resolve(root);
    if (
      path.dirname(target) !== tempRoot ||
      !path.basename(target).startsWith("rrsi-stats-provenance-")
    )
      throw new Error("unsafe provenance fixture cleanup");
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("authenticated native statistics provenance on a genuine v2 journal", () => {
  it("accepts a correctly retained direct-append chain without manufacturing fresh execution capability", () => {
    const value = fixture();
    const action = reserveAction(value);
    const reservationRecord = appendAction(value, action);
    const resolution = value
      .reopen()
      .resolveNativeBatch({ batchDigest: batch.batchDigest });
    expect(resolution.statisticsRegistration).toMatchObject({
      statisticsPlanDigest: statisticsPlan.statisticsPlanDigest,
      reservationRecord,
      preObservationRegistrationVerified: true,
      readyForExecution: false,
    });
    expect(value.adapter.reserveNativeBatchV2(input).newlyCommitted).toBe(
      false,
    );
  }, 90000);

  it.each([
    ["scope", scopeAction],
    ["plan", planAction],
    ["reserve", reserveAction],
  ])(
    "rejects a noncanonical %s operation ID despite valid authentication",
    (name, prepare) => {
      const value = fixture();
      const action = prepare(value);
      appendAction(value, {
        ...action,
        operationId: `test.noncanonical-${name}`,
      });
      rejected(value, /native statistics (scope|query) operation ID differs/);
    },
    90000,
  );

  it.each(["scope", "plan"])(
    "does not promote an unrelated record occupying the canonical %s operation ID",
    (name) => {
      const value = fixture();
      if (name === "plan")
        value.adapter.registerNativeStatisticsScope({ execution });
      const operationId = name === "scope" ? SCOPE_ID : planId;
      appendRecord(value, "register", operationId, { campaign });
      expect(value.adapter.inspect().campaignCount).toBe(1);
      const register =
        name === "scope"
          ? () => value.adapter.registerNativeStatisticsScope({ execution })
          : () => value.adapter.registerNativeStatisticsPlan(input);
      expect(register).toThrow(/operation ID is bound to different data/);
      expect(() => value.adapter.reserveNativeBatchV2(input)).toThrow(
        /not preregistered|no matching/,
      );
      expect(value.reopen().inspect().selectionQueries).toBe(0);
    },
    90000,
  );

  it("rejects an unrelated statistics-plan payload at the canonical plan operation ID", () => {
    const value = fixture();
    const action = planAction(value);
    const changed = structuredClone(statisticsPlan);
    const schema = changed.schema;
    delete changed.schema;
    delete changed.statisticsPlanDigest;
    changed.successDefinition = "TEST changed definition after scope";
    appendAction(value, {
      ...action,
      payload: {
        ...action.payload,
        statisticsPlan: rrsiEnvelope(schema, "statisticsPlanDigest", changed),
      },
    });
    rejected(value, /statistics plan differs from the frozen protocol/);
  }, 90000);

  it.each([
    ["scope", "missing", scopeAction],
    ["scope", "substituted", scopeAction],
    ["plan", "missing", planAction],
    ["plan", "substituted", planAction],
    ["reserve", "missing", reserveAction],
  ])(
    "rejects %s registration with %s source references",
    (name, mode, prepare) => {
      const value = fixture();
      const action = prepare(value);
      const unrelated = retain(value, {
        fixture: "TEST ONLY other retained history artifact",
        kind: name,
      });
      appendAction(value, {
        ...action,
        sourceRefs: mode === "missing" ? [] : [unrelated],
      });
      rejected(value, /native statistics History source references differ/);
    },
    90000,
  );

  it("rejects a scope binding copied from another authenticated journal", () => {
    const foreign = fixture();
    const foreignAction = scopeAction(foreign);
    const value = fixture();
    const localAction = scopeAction(value);
    expect(foreignAction.payload.binding.ledgerIdentity).not.toEqual(
      localAction.payload.binding.ledgerIdentity,
    );
    // Retain the foreign root artifact locally, so authentication succeeds and
    // rejection must come from the History scope binding, not missing bytes.
    const foreignRoot = foreignAction.payload.binding.rootRegistrationRecord;
    const imported = retain(value, readRetained(foreign, foreignRoot.ref));
    const binding = {
      ...foreignAction.payload.binding,
      rootRegistrationRecord: { ...foreignRoot, ref: imported },
    };
    appendAction(value, {
      ...localAction,
      payload: { ...localAction.payload, binding },
      sourceRefs: [imported],
    });
    rejected(value, /another History root or journal/);
  }, 90000);

  it("rejects a foreign scope record substituted into an otherwise valid plan", () => {
    const foreign = fixture();
    const foreignScope = foreign.adapter.registerNativeStatisticsScope({
      execution,
    });
    const value = fixture();
    const action = planAction(value);
    const imported = retain(
      value,
      readRetained(foreign, foreignScope.registrationRecord.ref),
    );
    appendAction(value, {
      ...action,
      payload: {
        ...action.payload,
        scopeRegistrationRecord: {
          ...foreignScope.registrationRecord,
          ref: imported,
        },
      },
      sourceRefs: [imported],
    });
    rejected(value, /replaces its scope registration/);
  }, 90000);
});
