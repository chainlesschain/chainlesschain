import { createHash, createHmac } from "node:crypto";

import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import { createEvolutionEvalRuntimeChildEvidenceStore } from "../../src/lib/evolution/evolution-eval-runtime-composition.js";
import { EvolutionReleaseTrainStageOutputLedgerAdapter } from "../../src/lib/evolution/evolution-release-train-stage-output-ledger-adapter.js";
import {
  SKILL_EVALUATED_PROMOTION_DURABILITY_AUTHORITY_SCHEMA,
  SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES,
  SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA,
  SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLUTION_SCHEMA,
  computeSkillEvaluatedPromotionDurabilityAttestationDigest,
} from "../../src/lib/evolution/skill-evaluated-promotion-durability.js";

export const EVAL_COMPOSITION_TEST_NOW = "2026-09-01T12:00:00.000Z";
const hash = (text) =>
  `sha256:${createHash("sha256").update(text).digest("hex")}`;
const mac = (purpose, payloadDigest) =>
  createHmac("sha256", "test-only-eval-composition-durability")
    .update(`${purpose}\0${payloadDigest}`)
    .digest("hex");

// Deterministic test authorities over the actual signed filesystem backend.
// This does not provision or claim a production PKI/durability service.
export function openEvalCompositionTestStore(
  root,
  tenantId = "tenant-primary",
) {
  const storage = openEvolutionDurableStore(root, {
    tenantId,
    artifactTenantId: tenantId,
    streamId: "eval-composition-run",
  });
  const descriptor = Object.freeze({
    tenantId,
    runId: "eval-composition-run",
    authorityId: "authority:eval-composition-test",
    revision: 1,
    handlerArtifactDigest: hash("eval-composition-test-module"),
  });
  const resources = {
    artifactPorts: storage.artifactPorts,
    ledger: storage.backend.ledger,
    ledgerArtifactResolver: storage.resolver,
    audience: storage.descriptor.audience,
    now: storage.clock,
  };
  const childReceiptStore = createEvolutionEvalRuntimeChildEvidenceStore({
    descriptor,
    ...resources,
  });
  const outputLedger = new EvolutionReleaseTrainStageOutputLedgerAdapter({
    descriptor: { ...storage.descriptor, skillName: "skill-pilot" },
    ...resources,
  });
  const durabilityLedger = new EvolutionReleaseTrainStageOutputLedgerAdapter({
    descriptor: { ...storage.descriptor, skillName: "eval-durability" },
    ...resources,
  });
  const attestationTrust = {
    algorithm: "hmac-sha256",
    issuer: "issuer:eval-composition-test",
    keyId: "key:eval-composition-test",
    trustPolicyDigest: hash("eval-composition-durability-test-policy"),
  };
  const state = { invalidAttestation: false };
  const identity = {
    authorityId: "authority:eval-composition-durability",
    revision: 1,
    handlerArtifactDigest: hash("eval-composition-durability-test-module"),
  };
  const attest = (core, purpose) => ({
    ...core,
    attestation: {
      ...attestationTrust,
      value: state.invalidAttestation
        ? "invalid-test-signature"
        : mac(
            purpose,
            computeSkillEvaluatedPromotionDurabilityAttestationDigest(core),
          ),
    },
  });
  const authority = {
    schema: SKILL_EVALUATED_PROMOTION_DURABILITY_AUTHORITY_SCHEMA,
    ...identity,
    trust: "trusted",
    attestationTrust,
    attestationGraceTrusts: [],
    attestationRevocations: { revision: 1, keyIds: [] },
    retain(request) {
      if (request.tenantId !== tenantId)
        throw new Error("test tenant mismatch");
      const retained = durabilityLedger.commit({
        planDigest: request.receiptDigest,
        stage: "eval",
        operationKey: request.receiptDigest,
        inputDigest: request.receiptDigest,
        outputDigest: request.receiptDigest,
        value: request.matrixReceipt,
        effectiveAt: EVAL_COMPOSITION_TEST_NOW,
      });
      return attest(
        {
          schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA,
          authenticated: true,
          durable: true,
          ...identity,
          tenantId,
          receiptDigest: request.receiptDigest,
          persistedAt: EVAL_COMPOSITION_TEST_NOW,
          persistenceReceiptDigest: retained.recordDigest,
        },
        SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.retain,
      );
    },
    resolve(request) {
      if (request.tenantId !== tenantId)
        throw new Error("test tenant mismatch");
      const stored = durabilityLedger.load({
        planDigest: request.receiptDigest,
        stage: "eval",
      });
      if (!stored) throw new Error("test durable matrix receipt is missing");
      return attest(
        {
          schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLUTION_SCHEMA,
          authenticated: true,
          durable: true,
          ...identity,
          tenantId,
          receiptDigest: request.receiptDigest,
          matrixReceipt: stored.value,
          resolvedAt: EVAL_COMPOSITION_TEST_NOW,
          resolutionReceiptDigest: stored.recordDigest,
        },
        SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.resolve,
      );
    },
    verifyAttestation({ purpose, payloadDigest, attestation }) {
      return attestation.value === mac(purpose, payloadDigest);
    },
  };
  return {
    ...storage,
    descriptor,
    resources,
    childReceiptStore,
    outputLedger,
    state,
    durabilityOptions: {
      authority,
      maximumEvidenceAgeMs: 60_000,
      maximumGracePeriodMs: 60_000,
      maximumOperationMs: 5_000,
      now: () => EVAL_COMPOSITION_TEST_NOW,
    },
  };
}
