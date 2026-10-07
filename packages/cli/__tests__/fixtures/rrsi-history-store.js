/** Test-only independent keys, real ArtifactStore/Ledger/witness files. */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import {
  buildRrsiCampaign,
  buildRrsiCandidate,
} from "../../src/lib/evolution/rrsi-contracts.js";
import {
  RRSI_SETTLEMENT_SCHEMA,
  RRSI_HISTORY_EVENT_SCHEMA,
  RRSI_HISTORY_EVENT_TYPE,
  buildRrsiSettlementMessage,
  createRrsiSettlementVerifier,
  createRrsiHistoryLedgerAdapter,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  isRrsiPreparationReservation,
  RRSI_PREPARATION_SETTLEMENT_SCHEMA,
} from "../../src/lib/evolution/rrsi-preparation-contracts.js";
import {
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiFixtureDigest,
} from "./rrsi-shadow-fixture.js";
import { rrsiEnvelope, rrsiHash } from "../../src/lib/evolution/rrsi-data.js";

/** Reconstruct a v1 dispatch admitted by the pre-preparation release. */
export function appendPreUpgradeRrsiDispatch(value, reservation) {
  const { store, adapter } = value;
  const head = store.backend.ledger.verify();
  const events = store.backend.ledger.read({ afterSequence: 0, limit: 1000 });
  const last = events.at(-1);
  const resolution = store.resolver({
    epoch: head.epoch,
    ledgerId: head.ledgerId,
    ref: last.subjectRef,
    tenantId: adapter.descriptor.artifactTenantId,
  });
  const previousRecordDigest = JSON.parse(resolution.bytes.toString("utf8"))
    .value.recordDigest;
  const operationId = `dispatch.${rrsiHash("rrsi-execution-id/v1", reservation.bindings.executionId).slice(7)}`;
  const scopeDigest = rrsiHash(
    "chainlesschain.rrsi-history-descriptor/v1",
    adapter.descriptor,
  );
  const acceptedAt = new Date(store.clock()).toISOString();
  const record = rrsiEnvelope(RRSI_HISTORY_EVENT_SCHEMA, "recordDigest", {
    descriptor: adapter.descriptor,
    ledgerId: head.ledgerId,
    epoch: head.epoch,
    operationId,
    kind: "dispatch",
    payload: {
      executionId: reservation.bindings.executionId,
      reservationDigest: reservation.reservationDigest,
    },
    previousRecordDigest,
    acceptedAt,
  });
  const published = store.artifactPorts.putCanonical(
    "rrsi-history-event",
    record,
    {
      audience: adapter.descriptor.audience,
      purpose: "evolution-ledger",
      retention: "ledger",
    },
  );
  return store.backend.ledger.appendDomainEvent(
    {
      type: RRSI_HISTORY_EVENT_TYPE,
      eventId: `rrsi.${rrsiHash("chainlesschain.rrsi-history-operation/v1", { scopeDigest, operationId }).slice(7)}`,
      tenantId: adapter.descriptor.tenantId,
      artifactTenantId: adapter.descriptor.artifactTenantId,
      correlationId: adapter.descriptor.scopeId,
      skillName: adapter.descriptor.goalId,
      decision: "accepted",
      reason: "TEST ONLY pre-upgrade v1 dispatch compatibility",
      sourceRefs: [],
      subjectRef: published.ref,
      timestamp: acceptedAt,
    },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
  );
}

export function openRrsiHistoryStore(
  root,
  {
    initialize = false,
    crashHook = null,
    settlementEnabled = true,
    now = null,
    campaignOverrides = {},
  } = {},
) {
  const keyPath = path.join(root, "test-control", "settlement-private.pem");
  if (initialize) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const keyPair = generateKeyPairSync("ed25519");
    fs.writeFileSync(
      keyPath,
      keyPair.privateKey.export({ format: "pem", type: "pkcs8" }),
      { flag: "wx", mode: 0o600 },
    );
  }
  const privateKey = createPrivateKey(fs.readFileSync(keyPath));
  const settlementVerifier = createRrsiSettlementVerifier({
    publicKey: createPublicKey(privateKey),
    authorityId: "rrsi-test-settlement",
    trustPolicyDigest: rrsiFixtureDigest(
      "TEST ONLY independent settlement policy",
    ),
  });
  const campaign = buildRrsiCampaign({
    ...rrsiCampaignInput(),
    ...campaignOverrides,
  });
  const store = openEvolutionDurableStore(path.join(root, "store"), {
    tenantId: campaign.tenantId,
    artifactTenantId: "rrsi-artifacts",
    audience: "rrsi-runtime",
    crashHook,
  });
  const adapter = createRrsiHistoryLedgerAdapter({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: {
      tenantId: campaign.tenantId,
      artifactTenantId: "rrsi-artifacts",
      goalId: campaign.goalId,
      audience: "rrsi-runtime",
      purpose: "evolution-ledger",
    },
    settlementVerifier: settlementEnabled ? settlementVerifier : null,
    now: now ?? store.clock,
  });
  const candidate = buildRrsiCandidate(campaign, rrsiCandidateInput(campaign));
  const request = (overrides = {}) => ({
    campaignDigest: campaign.campaignDigest,
    candidate,
    partition: "select",
    slotId: "select-slot-1",
    executionId: "rrsi-execution-1",
    budget: {
      maxTokens: 10_000,
      maxToolCalls: 100,
      maxWallClockMs: 10_000,
      maxCostMicrounits: 100_000,
      maxExecutions: 1000,
    },
    ...overrides,
  });
  const signSettlement = (reservation, overrides = {}) => {
    const core = {
      schema: isRrsiPreparationReservation(reservation)
        ? RRSI_PREPARATION_SETTLEMENT_SCHEMA
        : RRSI_SETTLEMENT_SCHEMA,
      receiptId: "settlement-1",
      bindings: reservation.bindings,
      status: "succeeded",
      cleanupConfirmed: true,
      usage: {
        tokens: 1000,
        toolCalls: 10,
        wallClockMs: 1000,
        costMicrounits: 10_000,
        executions: reservation.plannedExecutions,
      },
      sourceReceiptDigests: [
        rrsiFixtureDigest(
          `TEST ONLY independent source receipt ${reservation.bindings.executionId}`,
        ),
      ],
      issuedAt: new Date(store.clock()).toISOString(),
      validUntil: new Date(store.clock() + 60_000).toISOString(),
      ...overrides,
    };
    return {
      core,
      attestation: {
        ...settlementVerifier.descriptor,
        signature: sign(
          null,
          buildRrsiSettlementMessage(core, settlementVerifier.descriptor),
          privateKey,
        ).toString("base64url"),
      },
    };
  };
  return {
    adapter,
    store,
    campaign,
    candidate,
    request,
    preparationPlan: (overrides = {}) => ({
      campaignDigest: campaign.campaignDigest,
      maxAttempts: 4,
      planDigest: rrsiFixtureDigest("TEST ONLY PM preparation plan"),
      manifestDigest: rrsiFixtureDigest("TEST ONLY PM preparation manifest"),
      trainingMappingDigest: rrsiFixtureDigest(
        "TEST ONLY unverified source mapping",
      ),
      pmTrainingPartitionDigest: rrsiFixtureDigest(
        "TEST ONLY PM training partition",
      ),
      ...overrides,
    }),
    preparationRequest: (overrides = {}) => ({
      campaignDigest: campaign.campaignDigest,
      phase: "candidate-proposal",
      sourceTaskIds: ["train-task-0"],
      inputs: {
        instructionDigest: rrsiFixtureDigest("TEST ONLY proposal instruction"),
        memoryDigest: rrsiFixtureDigest("TEST ONLY input memory"),
        artifactDigests: [],
      },
      roundId: "round-1",
      branchId: "branch-1",
      slotId: "preparation-slot-1",
      executionId: "preparation-execution-1",
      budget: {
        maxTokens: 10_000,
        maxToolCalls: 100,
        maxWallClockMs: 10_000,
        maxCostMicrounits: 100_000,
        maxExecutions: 1,
      },
      ...overrides,
    }),
    signSettlement,
    settlementVerifier,
  };
}
