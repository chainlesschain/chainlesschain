import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { routeSkillSearchWithVectorAuthority } from "../../src/commands/skill.js";
import {
  SKILL_VECTOR_ATTESTATION_SCHEMA,
  SKILL_VECTOR_RESULT_SCHEMA,
  createSkillVectorAuthority,
  digestSkillVectorResult,
} from "../../src/lib/skill-vector-authority.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function skill(id, description) {
  return {
    id,
    displayName: id,
    description,
    category: "engineering",
    tags: ["testing"],
    source: "workspace",
    version: "1.0.0",
    executionIdentity: { contentDigest: D(id) },
  };
}

function harness(mutator = (value) => value) {
  const verifier = { verify: vi.fn() };
  const provider = {
    score: vi.fn(async (request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.corpus)).toBe(true);
      const result = {
        schema: SKILL_VECTOR_RESULT_SCHEMA,
        tenantId: request.tenantId,
        requestDigest: request.requestDigest,
        corpusDigest: request.corpusDigest,
        modelId: "embedding:model",
        modelRevision: "revision:1",
        indexDigest: D("index:1"),
        scores: request.corpus.map(({ digest }, index) => ({
          digest,
          score: index === 0 ? 0.1 : 0.9,
        })),
        attestation: {
          schema: SKILL_VECTOR_ATTESTATION_SCHEMA,
          algorithm: "test-signature",
          keyId: "key:test-vector",
          value: "A".repeat(32),
        },
      };
      result.resultDigest = digestSkillVectorResult(result);
      return mutator(result);
    }),
  };
  verifier.verify.mockImplementation(async (request) => ({
    authenticated: true,
    durable: true,
    tenantId: request.tenantId,
    requestDigest: request.requestDigest,
    resultDigest: request.resultDigest,
    receiptDigest: D(`verification:${request.resultDigest}`),
  }));
  return {
    provider,
    verifier,
    authority: createSkillVectorAuthority({
      tenantId: "tenant:a",
      provider,
      verifier,
    }),
  };
}

describe("Skill vector authority", () => {
  it("binds CLI routing to an independently verified model and index result", async () => {
    const value = harness();
    const result = await routeSkillSearchWithVectorAuthority(
      [skill("repair", "repair broken tests"), skill("docs", "write docs")],
      "repair tests",
      { limit: 2, os: process.platform },
      value.authority,
    );
    expect(result).toMatchObject({
      vectorAvailable: true,
      vectorAuthority: {
        status: "verified",
        tenantId: "tenant:a",
        skillCount: 2,
        modelId: "embedding:model",
        modelRevision: "revision:1",
        indexDigest: D("index:1"),
      },
    });
    expect(result.candidates.some(({ scores }) => scores.vector > 0)).toBe(
      true,
    );
    expect(value.provider.score).toHaveBeenCalledTimes(1);
    expect(value.verifier.verify).toHaveBeenCalledTimes(1);
  });

  it("reports an explicit unavailable authority when none is configured", async () => {
    await expect(
      routeSkillSearchWithVectorAuthority(
        [skill("repair", "repair broken tests")],
        "repair tests",
      ),
    ).resolves.toMatchObject({
      vectorAvailable: false,
      vectorAuthority: {
        status: "unavailable",
        code: "CC_SKILL_VECTOR_AUTHORITY_UNCONFIGURED",
      },
    });
  });

  it("rejects score substitution before independent verification", async () => {
    const value = harness((result) => ({
      ...result,
      scores: result.scores.map((entry, index) =>
        index === 0 ? { ...entry, score: 1 } : entry,
      ),
    }));
    await expect(
      value.authority.score({
        query: "repair tests",
        skills: [
          skill("repair", "repair broken tests"),
          skill("docs", "write docs"),
        ],
      }),
    ).rejects.toThrow(/result integrity is invalid/u);
    expect(value.verifier.verify).not.toHaveBeenCalled();
  });

  it("rejects incomplete score coverage and forged authorities", async () => {
    const value = harness((result) => ({
      ...result,
      scores: result.scores.slice(1),
      resultDigest: digestSkillVectorResult({
        ...result,
        scores: result.scores.slice(1),
      }),
    }));
    await expect(
      value.authority.score({
        query: "repair tests",
        skills: [
          skill("repair", "repair broken tests"),
          skill("docs", "write docs"),
        ],
      }),
    ).rejects.toThrow(/not authoritative/u);
    await expect(
      routeSkillSearchWithVectorAuthority(
        [skill("repair", "repair broken tests")],
        "repair tests",
        {},
        { score: async () => ({}) },
      ),
    ).rejects.toThrow(/branded Skill vector authority/u);
    const untrusted = harness();
    untrusted.verifier.verify.mockImplementation(async (request) => ({
      authenticated: false,
      durable: true,
      tenantId: request.tenantId,
      requestDigest: request.requestDigest,
      resultDigest: request.resultDigest,
      receiptDigest: D("untrusted-vector-result"),
    }));
    await expect(
      untrusted.authority.score({
        query: "repair tests",
        skills: [skill("repair", "repair broken tests")],
      }),
    ).rejects.toThrow(/not independently verified/u);
  });
});
