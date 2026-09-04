import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA,
  INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA,
  createIndependentSkillRevocationSource,
  digestIndependentSkillRevocationRecord,
} from "../../src/lib/evolution/independent-skill-revocation-source.js";
import { SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA } from "../../src/lib/evolution/skill-wiki-reconciliation.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function record(overrides = {}) {
  const core = {
    schema: INDEPENDENT_SKILL_REVOCATION_RECORD_SCHEMA,
    tenantId: "tenant-a",
    streamId: "security-revocations",
    sequence: 4,
    revocationId: "security-incident-4",
    candidateId: D("candidate"),
    skillName: "safe-refactor",
    reason: "Independent security authority revoked the active Skill.",
    occurredAt: "2026-09-05T09:00:00.000Z",
    activeStateDigest: D("active-state"),
    evidenceReceiptDigests: [D("incident")],
    ...overrides,
  };
  const signed = {
    ...core,
    attestation: {
      algorithm: "ed25519",
      keyId: "security-key-1",
      value: "A".repeat(64),
    },
  };
  return {
    ...signed,
    recordDigest: digestIndependentSkillRevocationRecord(signed),
  };
}

function fixture(value = record()) {
  const verifyRevocation = vi.fn(async (request) => ({
    schema: INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA,
    authenticated: true,
    durable: true,
    tenantId: request.tenantId,
    streamId: request.streamId,
    sequence: request.sequence,
    recordDigest: request.recordDigest,
    receiptDigest: D(`verified:${request.recordDigest}`),
  }));
  const source = createIndependentSkillRevocationSource({
    tenantId: "tenant-a",
    streamId: "security-revocations",
    ports: {
      readRevocations: async () => [value],
      verifyRevocation,
    },
  });
  return { source, verifyRevocation };
}

describe("independent Skill revocation source", () => {
  it("projects independently verified durable records into revoke outcomes", async () => {
    const { source, verifyRevocation } = fixture();
    await expect(source.list()).resolves.toEqual([
      expect.objectContaining({
        schema: SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA,
        authenticated: true,
        durable: true,
        sequence: 4,
        outcome: "revoke",
        skillName: "safe-refactor",
        transitionDigest: expect.stringMatching(/^sha256:/u),
      }),
    ]);
    expect(verifyRevocation).toHaveBeenCalledOnce();
    await expect(source.list({ afterSequence: 4 })).resolves.toEqual([]);
  });

  it("rejects record substitution before consulting the verifier", async () => {
    const tampered = record();
    tampered.reason = "substituted";
    const { source, verifyRevocation } = fixture(tampered);
    await expect(source.list()).rejects.toThrow("not bound");
    expect(verifyRevocation).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated or non-durable verifier results", async () => {
    const source = createIndependentSkillRevocationSource({
      tenantId: "tenant-a",
      streamId: "security-revocations",
      ports: {
        readRevocations: async () => [record()],
        verifyRevocation: async (request) => ({
          schema: INDEPENDENT_SKILL_REVOCATION_VERIFICATION_SCHEMA,
          authenticated: true,
          durable: false,
          tenantId: request.tenantId,
          streamId: request.streamId,
          sequence: request.sequence,
          recordDigest: request.recordDigest,
          receiptDigest: D("weak-verification"),
        }),
      },
    });
    await expect(source.list()).rejects.toThrow("not bound");
  });
});
