// TEST ONLY: local HMAC/manifest replicas, no producer or tenant routing authority.
import path from "node:path";
import { openLedgerV2Fixture } from "./evolution-ledger-v2-store.js";
import { rrsiCampaignInput, rrsiFixtureDigest } from "./rrsi-shadow-fixture.js";
import { buildRrsiCampaign } from "../../src/lib/evolution/rrsi-contracts.js";
import { createRrsiHistoryLedgerAdapter } from "../../src/lib/evolution/rrsi-history-ledger-adapter.js";
import { createRrsiRegistryStorePolicy } from "../../src/lib/evolution/rrsi-registry-store-policy.js";
import { createRrsiObservedTextIndex } from "../../src/lib/evolution/rrsi-observed-text-index.js";
export const scope = {
  tenantId: "synthetic-tenant",
  artifactTenantId: "observed-text-artifacts",
  audience: "rrsi-runtime",
};
export function openObservedTextFixture(root, options = {}) {
  const store = openLedgerV2Fixture(path.join(root, "store"), {
    ...scope,
    ...options,
  });
  const policy = createRrsiRegistryStorePolicy({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: { ...scope, purpose: "evolution-ledger" },
  });
  const campaign = buildRrsiCampaign(rrsiCampaignInput());
  const history = createRrsiHistoryLedgerAdapter({
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
    descriptor: {
      ...scope,
      goalId: campaign.goalId,
      purpose: "evolution-ledger",
    },
    settlementVerifier: null,
    now: store.clock,
  });
  const composition = {
    storePolicy: policy,
    backend: store.backend,
    artifactPorts: store.artifactPorts,
    ledgerArtifactResolver: store.resolver,
  };
  return { root, store, policy, campaign, history, composition };
}
export function registerPreparationPlan(value) {
  value.history.registerCampaign(value.campaign);
  value.history.registerPreparationPlan({
    campaignDigest: value.campaign.campaignDigest,
    maxAttempts: 2,
    planDigest: rrsiFixtureDigest("plan"),
    manifestDigest: rrsiFixtureDigest("manifest"),
    trainingMappingDigest: rrsiFixtureDigest("mapping"),
    pmTrainingPartitionDigest: rrsiFixtureDigest("partition"),
  });
}
export function reservePreparation(value, phase = "candidate-proposal") {
  return value.history.reservePreparation({
    campaignDigest: value.campaign.campaignDigest,
    phase,
    sourceTaskIds: ["train-task-0"],
    inputs: {
      instructionDigest: rrsiFixtureDigest("instruction"),
      memoryDigest: rrsiFixtureDigest("memory"),
      artifactDigests: [],
    },
    roundId: "round-1",
    branchId: "branch-1",
    slotId: "slot-1",
    executionId: "prep-1",
    budget: {
      maxTokens: 10_000,
      maxToolCalls: 100,
      maxWallClockMs: 10_000,
      maxCostMicrounits: 100_000,
      maxExecutions: 1,
    },
  });
}
export function openObservedTextIndex(value) {
  return createRrsiObservedTextIndex(value.composition);
}
export function observationRequest(value, text, restrictionCodes = []) {
  return {
    text,
    historyAdapter: value.history,
    preparationExecutionId: "prep-1",
    restrictionCodes,
  };
}
