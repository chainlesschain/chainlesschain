import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  SKILL_EVALUATED_PROMOTION_DURABILITY_AUTHORITY_SCHEMA,
  SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES,
  SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA,
  SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLUTION_SCHEMA,
  SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLVE_REQUEST_SCHEMA,
  SKILL_EVALUATED_PROMOTION_DURABILITY_RETAIN_REQUEST_SCHEMA,
  computeSkillEvaluatedPromotionDurabilityAttestationDigest,
  createSkillEvaluatedPromotionDurabilityAdapter,
} from "../../src/lib/evolution/skill-evaluated-promotion-durability.js";
import {
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
  SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
  createSkillEvaluatedPromotionProvider,
} from "../../src/lib/evolution/skill-evaluated-promotion.js";
import { SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA } from "../../src/lib/evolution/skill-target-matrix-eval.js";

const TENANT_ID = "tenant:durability-test";
const ATTESTATION_SECRET = "durability-attestation-test-secret";
const GRACE_ATTESTATION_SECRET = "durability-grace-attestation-test-secret";
const TRUSTED_NOW = "2026-09-02T01:00:02.000Z";
const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function matrixReceipt(suffix = "accepted") {
  return {
    schema: SKILL_TARGET_MATRIX_EVAL_RECEIPT_SCHEMA,
    tenantId: TENANT_ID,
    receiptDigest: digest(`matrix-receipt:${suffix}`),
  };
}

function durabilityAuthority({
  durable = true,
  duplicateGraceKey = false,
  graceNotAfter = null,
} = {}) {
  const records = new Map();
  const state = {
    abortObserved: false,
    hangRetain: false,
    invalidateAttestation: false,
    persistedAt: "2026-09-02T01:00:00.000Z",
    resolvedAt: "2026-09-02T01:00:01.000Z",
    substituteReceipt: false,
    useGraceKey: false,
  };
  const attestationTrust = {
    algorithm: "hmac-sha256",
    issuer: "issuer:durability-test",
    keyId: "key:durability-test-v1",
    trustPolicyDigest: digest("durability-attestation-policy:v1"),
  };
  const descriptor = {
    schema: SKILL_EVALUATED_PROMOTION_DURABILITY_AUTHORITY_SCHEMA,
    authorityId: "authority:durable-matrix-receipts",
    trust: "trusted",
    revision: 7,
    handlerArtifactDigest: digest("durable-matrix-receipts:v7"),
    attestationTrust,
    attestationGraceTrusts:
      graceNotAfter === null && !duplicateGraceKey
        ? []
        : [
            {
              trust: duplicateGraceKey
                ? attestationTrust
                : {
                    ...attestationTrust,
                    issuer: "issuer:durability-grace-test",
                    keyId: "key:durability-test-v0",
                  },
              notAfter: graceNotAfter ?? "2026-09-02T01:01:00.000Z",
            },
          ],
  };
  const graceTrust = descriptor.attestationGraceTrusts[0]?.trust ?? null;
  const attest = (core, purpose) => {
    const selectedTrust = state.useGraceKey ? graceTrust : attestationTrust;
    const secret = state.useGraceKey
      ? GRACE_ATTESTATION_SECRET
      : ATTESTATION_SECRET;
    return {
      ...selectedTrust,
      value: createHmac("sha256", secret)
        .update(purpose)
        .update("\0")
        .update(computeSkillEvaluatedPromotionDurabilityAttestationDigest(core))
        .digest("hex"),
    };
  };
  const authority = {
    ...descriptor,
    retain(request, { signal } = {}) {
      if (state.hangRetain) {
        return new Promise(() => {
          signal?.addEventListener(
            "abort",
            () => {
              state.abortObserved = true;
            },
            { once: true },
          );
        });
      }
      expect(request).toMatchObject({
        schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RETAIN_REQUEST_SCHEMA,
        tenantId: TENANT_ID,
      });
      records.set(
        `${request.tenantId}\0${request.receiptDigest}`,
        structuredClone(request.matrixReceipt),
      );
      const core = {
        schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RECEIPT_SCHEMA,
        authenticated: true,
        durable,
        authorityId: descriptor.authorityId,
        revision: descriptor.revision,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        tenantId: request.tenantId,
        receiptDigest: request.receiptDigest,
        persistedAt: state.persistedAt,
        persistenceReceiptDigest: digest(`persisted:${request.receiptDigest}`),
      };
      return {
        ...core,
        attestation: attest(
          core,
          SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.retain,
        ),
      };
    },
    resolve(request) {
      expect(request).toMatchObject({
        schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLVE_REQUEST_SCHEMA,
        tenantId: TENANT_ID,
      });
      const stored = records.get(
        `${request.tenantId}\0${request.receiptDigest}`,
      );
      if (!stored) throw new Error("durable receipt not found");
      const core = {
        schema: SKILL_EVALUATED_PROMOTION_DURABILITY_RESOLUTION_SCHEMA,
        authenticated: true,
        durable: true,
        authorityId: descriptor.authorityId,
        revision: descriptor.revision,
        handlerArtifactDigest: descriptor.handlerArtifactDigest,
        tenantId: request.tenantId,
        receiptDigest: request.receiptDigest,
        matrixReceipt: state.substituteReceipt
          ? matrixReceipt("substituted")
          : structuredClone(stored),
        resolvedAt: state.resolvedAt,
        resolutionReceiptDigest: digest(`resolved:${request.receiptDigest}`),
      };
      return {
        ...core,
        attestation: attest(
          core,
          SKILL_EVALUATED_PROMOTION_DURABILITY_ATTESTATION_PURPOSES.resolve,
        ),
      };
    },
    verifyAttestation({ purpose, payloadDigest, attestation, selectedTrust }) {
      const secret =
        selectedTrust.keyId === attestationTrust.keyId
          ? ATTESTATION_SECRET
          : GRACE_ATTESTATION_SECRET;
      const expected = createHmac("sha256", secret)
        .update(purpose)
        .update("\0")
        .update(payloadDigest)
        .digest("hex");
      return (
        !state.invalidateAttestation &&
        attestation.algorithm === selectedTrust.algorithm &&
        attestation.issuer === selectedTrust.issuer &&
        attestation.keyId === selectedTrust.keyId &&
        attestation.trustPolicyDigest === selectedTrust.trustPolicyDigest &&
        attestation.value === expected
      );
    },
  };
  return { authority, records, state };
}

function adapterOptions(authority, overrides = {}) {
  return {
    authority,
    maximumEvidenceAgeMs: 60_000,
    maximumGracePeriodMs: 60_000,
    maximumOperationMs: 1_000,
    now: () => TRUSTED_NOW,
    ...overrides,
  };
}

describe("evaluated promotion durability adapter", () => {
  it("retains and resolves an exact receipt across adapter instances", async () => {
    const fixture = durabilityAuthority();
    const receipt = matrixReceipt();
    const writer = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );

    await expect(writer.retain(receipt)).resolves.toMatchObject({
      authenticated: true,
      durable: true,
      tenantId: TENANT_ID,
      receiptDigest: receipt.receiptDigest,
    });

    const reopened = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );
    const resolution = await reopened.resolver.resolve({
      schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
      tenantId: TENANT_ID,
      receiptDigest: receipt.receiptDigest,
    });

    expect(resolution).toMatchObject({
      schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_SCHEMA,
      tenantId: TENANT_ID,
      receiptDigest: receipt.receiptDigest,
      matrixReceipt: receipt,
    });
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(fixture.records.size).toBe(1);
    expect(
      createSkillEvaluatedPromotionProvider({
        authorityId: "authority:durable-provider",
        handlerArtifactDigest: digest("durable-provider:v1"),
        receiptResolver: reopened.resolver,
        revision: 1,
        verifier: {},
      }),
    ).toMatchObject({
      authorityId: "authority:durable-provider",
      revision: 1,
    });
  });

  it("rejects a retain acknowledgement that is not durable", async () => {
    const fixture = durabilityAuthority({ durable: false });
    const adapter = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );

    await expect(adapter.retain(matrixReceipt())).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
    });
  });

  it("rejects receipt substitution by the durability authority", async () => {
    const fixture = durabilityAuthority();
    const receipt = matrixReceipt();
    const writer = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );
    await writer.retain(receipt);
    fixture.state.substituteReceipt = true;
    const reader = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );

    await expect(
      reader.resolver.resolve({
        schema: SKILL_EVALUATED_PROMOTION_RECEIPT_RESOLUTION_REQUEST_SCHEMA,
        tenantId: TENANT_ID,
        receiptDigest: receipt.receiptDigest,
      }),
    ).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
    });
  });

  it("rejects a durability acknowledgement with an invalid attestation", async () => {
    const fixture = durabilityAuthority();
    fixture.state.invalidateAttestation = true;
    const adapter = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );

    await expect(adapter.retain(matrixReceipt())).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_DURABILITY_REJECTED",
    });
  });

  it("times out and aborts a hanging durability authority call", async () => {
    const fixture = durabilityAuthority();
    fixture.state.hangRetain = true;
    const adapter = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority, { maximumOperationMs: 10 }),
    );

    await expect(adapter.retain(matrixReceipt())).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_DURABILITY_TIMEOUT",
    });
    expect(fixture.state.abortObserved).toBe(true);
  });

  it("rejects a signed durability acknowledgement outside the freshness window", async () => {
    const fixture = durabilityAuthority();
    fixture.state.persistedAt = "2026-09-01T23:00:00.000Z";
    const adapter = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );

    await expect(adapter.retain(matrixReceipt())).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_DURABILITY_STALE",
    });
  });

  it("accepts a unique previous attestation key inside its grace window", async () => {
    const fixture = durabilityAuthority({
      graceNotAfter: "2026-09-02T01:01:00.000Z",
    });
    fixture.state.useGraceKey = true;
    const adapter = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );

    await expect(adapter.retain(matrixReceipt())).resolves.toMatchObject({
      authenticated: true,
      durable: true,
    });
  });

  it("rejects a previous attestation key after its grace window", async () => {
    const fixture = durabilityAuthority({
      graceNotAfter: "2026-09-02T00:59:00.000Z",
    });
    fixture.state.useGraceKey = true;
    const adapter = createSkillEvaluatedPromotionDurabilityAdapter(
      adapterOptions(fixture.authority),
    );

    await expect(adapter.retain(matrixReceipt())).rejects.toMatchObject({
      code: "SKILL_EVALUATED_PROMOTION_DURABILITY_STALE",
    });
  });

  it("rejects duplicate active and grace keyId values at construction", () => {
    const fixture = durabilityAuthority({ duplicateGraceKey: true });

    expect(() =>
      createSkillEvaluatedPromotionDurabilityAdapter(
        adapterOptions(fixture.authority),
      ),
    ).toThrow(/keyId values must be globally unique/u);
  });

  it("rejects a grace key window beyond the configured maximum", () => {
    const fixture = durabilityAuthority({
      graceNotAfter: "2026-09-02T02:00:00.000Z",
    });

    expect(() =>
      createSkillEvaluatedPromotionDurabilityAdapter(
        adapterOptions(fixture.authority),
      ),
    ).toThrow(/exceeds maximumGracePeriodMs/u);
  });
});
