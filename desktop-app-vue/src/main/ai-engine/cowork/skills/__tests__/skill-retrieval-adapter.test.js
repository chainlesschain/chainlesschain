import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const {
  descriptorFor,
  routeDesktopSkills,
  routeDesktopSkillsWithOutcomeAuthority,
} = require("../skill-retrieval-adapter.js");

const digest = (character) => `sha256:${character.repeat(64)}`;
const hash = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function vectorAuthority(tenantId = "tenant:desktop") {
  const vector =
    await import("../../../../../../../packages/cli/src/lib/skill-vector-authority.js");
  const authority = vector.createSkillVectorAuthority({
    tenantId,
    provider: {
      score: async (request) => {
        const result = {
          schema: vector.SKILL_VECTOR_RESULT_SCHEMA,
          tenantId,
          requestDigest: request.requestDigest,
          corpusDigest: request.corpusDigest,
          modelId: "embedding:desktop-test",
          modelRevision: "revision:1",
          indexDigest: hash(`index:${tenantId}`),
          scores: request.corpus.map(({ digest: contentDigest }) => ({
            digest: contentDigest,
            score: 0.75,
          })),
          attestation: {
            schema: vector.SKILL_VECTOR_ATTESTATION_SCHEMA,
            algorithm: "test-signature",
            keyId: "key:desktop-test",
            value: "A".repeat(32),
          },
        };
        return {
          ...result,
          resultDigest: vector.digestSkillVectorResult(result),
        };
      },
    },
    verifier: {
      verify: async (request) => ({
        authenticated: true,
        durable: true,
        tenantId,
        requestDigest: request.requestDigest,
        resultDigest: request.resultDigest,
        receiptDigest: hash(`receipt:${request.resultDigest}`),
      }),
    },
  });
  return { authority, vector };
}

function skill(overrides = {}) {
  return {
    getInfo: () => ({
      skillId: "repair-tests",
      name: "Repair tests",
      description: "Repair deterministic test failures",
      category: "development",
      tags: ["tests"],
      source: "workspace",
      version: "2.0.0",
      os: ["win32"],
      executionCapabilities: ["filesystem:write"],
      executionSecurity: { contentDigest: digest("a") },
      ...overrides,
    }),
  };
}

describe("Desktop canonical Skill retrieval adapter", () => {
  it("projects only digest-addressed registry Skills", () => {
    expect(descriptorFor(skill())).toMatchObject({
      id: "repair-tests",
      executionIdentity: { contentDigest: digest("a") },
    });
    expect(
      descriptorFor(skill({ executionSecurity: { contentDigest: "forged" } })),
    ).toBeNull();
  });

  it("uses a host-owned target and the shared canonical router", async () => {
    const skillRetrievalRevocationReader = { inspect: vi.fn() };
    const routeSkillDescriptors = vi.fn((request) => ({
      schema: "chainlesschain.skill-retrieval-result/v1",
      selected: request.skills[0],
      candidates: request.skills,
      conflicts: [],
      rejected: [],
    }));
    const result = await routeDesktopSkills({
      skills: [skill()],
      query: "repair tests",
      filters: {
        namespace: "workspace",
        tags: ["tests"],
        topK: 5,
        target: { os: "linux", allowedCapabilities: [] },
      },
      hostTarget: {
        os: "win32",
        allowedCapabilities: ["filesystem:write"],
      },
      outcomeMetrics: {
        [digest("a")]: {
          samples: 2,
          successRate: 1,
          correctionRate: 0,
        },
      },
      skillRetrievalRevocationReader,
      loadRouter: async () => ({ routeSkillDescriptors }),
    });
    expect(result.selected.id).toBe("repair-tests");
    expect(routeSkillDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          os: "win32",
          allowedCapabilities: ["filesystem:write"],
        },
        outcomeMetrics: {
          [digest("a")]: {
            samples: 2,
            successRate: 1,
            correctionRate: 0,
          },
        },
        revocationReader: skillRetrievalRevocationReader,
      }),
    );
  });

  it("rejects unbounded renderer filters before loading the router", async () => {
    const loadRouter = vi.fn();
    await expect(
      routeDesktopSkills({
        skills: [skill()],
        query: "repair tests",
        filters: { tags: Array.from({ length: 65 }, () => "tests") },
        loadRouter,
      }),
    ).rejects.toThrow("invalid or unbounded");
    expect(loadRouter).not.toHaveBeenCalled();
  });

  it("runs the real shared BM25 router without admitting missing digests", async () => {
    const result = await routeDesktopSkills({
      skills: [
        skill(),
        skill({
          skillId: "unsafe",
          name: "Unsafe",
          executionSecurity: null,
        }),
      ],
      query: "deterministic test repair",
      hostTarget: {
        os: "win32",
        allowedCapabilities: ["filesystem:write"],
      },
    });
    expect(result.schema).toBe("chainlesschain.skill-retrieval-result/v1");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].digest).toBe(digest("a"));
    expect(result.vectorAuthority).toEqual({
      schema: "chainlesschain.skill-vector-authority/v1",
      status: "unavailable",
      code: "CC_SKILL_VECTOR_AUTHORITY_UNCONFIGURED",
    });
  });

  it("routes only independently verified host vector scores", async () => {
    const { authority, vector } = await vectorAuthority();
    const routeSkillDescriptors = vi.fn((request) => ({
      schema: "chainlesschain.skill-retrieval-result/v1",
      selected: request.skills[0],
      candidates: request.skills,
      conflicts: [],
      rejected: [],
      vectorAvailable: true,
    }));
    const result = await routeDesktopSkills({
      skills: [skill()],
      query: "repair tests",
      skillVectorAuthority: authority,
      loadRouter: async () => ({ routeSkillDescriptors }),
      loadVectorAuthority: async () => vector,
    });
    expect(routeSkillDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({
        vectorScores: { [digest("a")]: 0.75 },
      }),
    );
    expect(result.vectorAuthority).toMatchObject({
      schema: "chainlesschain.skill-vector-authority/v1",
      status: "verified",
      tenantId: "tenant:desktop",
      skillCount: 1,
      modelId: "embedding:desktop-test",
      modelRevision: "revision:1",
    });
  });

  it("rejects an unbranded host vector source before routing", async () => {
    const routeSkillDescriptors = vi.fn();
    await expect(
      routeDesktopSkills({
        skills: [skill()],
        query: "repair tests",
        skillVectorAuthority: { score: vi.fn() },
        loadRouter: async () => ({ routeSkillDescriptors }),
      }),
    ).rejects.toThrow(/branded Skill vector authority/u);
    expect(routeSkillDescriptors).not.toHaveBeenCalled();
  });

  it("routes from a host-owned DB authority and exposes bounded evidence", async () => {
    const routeSkillDescriptors = vi.fn((request) => ({
      schema: "chainlesschain.skill-retrieval-result/v1",
      selected: request.skills[0],
      candidates: request.skills,
      conflicts: [],
      rejected: [],
    }));
    const metrics = {
      [digest("a")]: { samples: 3, successRate: 1, correctionRate: 0 },
    };
    const buildOutcomeAuthority = vi.fn(async ({ database }) => ({
      status: "verified-local-db",
      metrics,
      evidence: {
        schema: "chainlesschain.desktop-skill-outcome-db-authority/v1",
        status: "verified-local-db",
        sourceDigest: digest("f"),
        antiRollbackWitness: false,
      },
    }));
    const database = { all: vi.fn() };

    const result = await routeDesktopSkillsWithOutcomeAuthority({
      database,
      buildOutcomeAuthority,
      skills: [skill()],
      query: "repair tests",
      hostTarget: { os: "win32" },
      loadRouter: async () => ({ routeSkillDescriptors }),
    });

    expect(buildOutcomeAuthority).toHaveBeenCalledWith({ database });
    expect(routeSkillDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeMetrics: metrics }),
    );
    expect(result.outcomeAuthority).toMatchObject({
      status: "verified-local-db",
      sourceDigest: digest("f"),
      antiRollbackWitness: false,
    });
  });

  it("disables all Desktop outcome metrics when its DB authority fails", async () => {
    const routeSkillDescriptors = vi.fn((request) => ({
      schema: "chainlesschain.skill-retrieval-result/v1",
      selected: request.skills[0],
      candidates: request.skills,
      conflicts: [],
      rejected: [],
    }));
    const result = await routeDesktopSkillsWithOutcomeAuthority({
      database: {},
      buildOutcomeAuthority: async () => {
        throw new Error("C:/private/database.sqlite");
      },
      skills: [skill()],
      query: "repair tests",
      hostTarget: { os: "win32" },
      loadRouter: async () => ({ routeSkillDescriptors }),
    });
    expect(routeSkillDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({ outcomeMetrics: null }),
    );
    expect(result.outcomeAuthority).toMatchObject({
      status: "unavailable",
      code: "CC_DESKTOP_SKILL_OUTCOME_AUTHORITY_UNAVAILABLE",
      antiRollbackWitness: false,
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("rejects an invalid routing envelope before scanning outcome history", async () => {
    const buildOutcomeAuthority = vi.fn();
    await expect(
      routeDesktopSkillsWithOutcomeAuthority({
        database: {},
        buildOutcomeAuthority,
        skills: [skill()],
        query: " ",
      }),
    ).rejects.toThrow(/request is invalid/i);
    await expect(
      routeDesktopSkillsWithOutcomeAuthority({
        database: {},
        buildOutcomeAuthority,
        skills: [skill()],
        query: "repair",
        filters: { tags: Array.from({ length: 65 }, () => "tests") },
      }),
    ).rejects.toThrow(/invalid or unbounded/i);
    expect(buildOutcomeAuthority).not.toHaveBeenCalled();
  });
});
