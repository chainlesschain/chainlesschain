import { describe, expect, it, vi } from "vitest";

const {
  descriptorFor,
  routeDesktopSkills,
  routeDesktopSkillsWithOutcomeAuthority,
} = require("../skill-retrieval-adapter.js");

const digest = (character) => `sha256:${character.repeat(64)}`;

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
