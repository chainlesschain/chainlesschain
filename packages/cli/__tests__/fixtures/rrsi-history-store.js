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
  buildRrsiSettlementMessage,
  createRrsiSettlementVerifier,
  createRrsiHistoryLedgerAdapter,
} from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import {
  rrsiCampaignInput,
  rrsiCandidateInput,
  rrsiFixtureDigest,
} from "./rrsi-shadow-fixture.js";

export function openRrsiHistoryStore(
  root,
  {
    initialize = false,
    crashHook = null,
    settlementEnabled = true,
    now = null,
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
  const store = openEvolutionDurableStore(path.join(root, "store"), {
    tenantId: "synthetic-tenant",
    artifactTenantId: "rrsi-artifacts",
    audience: "rrsi-runtime",
    crashHook,
  });
  const adapter = createRrsiHistoryLedgerAdapter({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: {
      tenantId: "synthetic-tenant",
      artifactTenantId: "rrsi-artifacts",
      goalId: "pm-task-change-export",
      audience: "rrsi-runtime",
      purpose: "evolution-ledger",
    },
    settlementVerifier: settlementEnabled ? settlementVerifier : null,
    now: now ?? store.clock,
  });
  const campaign = buildRrsiCampaign(rrsiCampaignInput());
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
      schema: RRSI_SETTLEMENT_SCHEMA,
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
    signSettlement,
    settlementVerifier,
  };
}
