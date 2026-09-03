import { describe, expect, it, vi } from "vitest";

const {
  descriptorFor,
  routeDesktopSkills,
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
      loadRouter: async () => ({ routeSkillDescriptors }),
    });
    expect(result.selected.id).toBe("repair-tests");
    expect(routeSkillDescriptors).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          os: "win32",
          allowedCapabilities: ["filesystem:write"],
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
});
