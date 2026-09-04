import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { routeSkillSearch } from "../../src/commands/skill.js";

const digest = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

function skill(id, description, overrides = {}) {
  return {
    id,
    displayName: id,
    description,
    category: "development",
    source: "workspace",
    version: "1.0.0",
    tags: ["tests"],
    os: [],
    capabilities: [],
    executionIdentity: { contentDigest: digest(id) },
    ...overrides,
  };
}

describe("cc skill search canonical routing", () => {
  it("returns ranked digest-bound candidates with stable evidence", () => {
    const result = routeSkillSearch(
      [
        skill("write-docs", "write release notes"),
        skill("repair-tests", "repair failing vitest tests"),
      ],
      "repair vitest tests",
      { limit: "5", os: "win32" },
    );

    expect(result).toMatchObject({
      schema: "chainlesschain.skill-retrieval-result/v1",
      selected: { id: "repair-tests", digest: digest("repair-tests") },
    });
    expect(result.candidates[0]).toMatchObject({
      id: "repair-tests",
      digest: digest("repair-tests"),
      reason: expect.stringContaining("bm25="),
    });
  });

  it("applies exact product filters and excludes missing digests", () => {
    const result = routeSkillSearch(
      [
        skill("workspace-test", "repair tests"),
        skill("market-test", "repair tests", { source: "marketplace" }),
        skill("unsafe", "repair tests", { executionIdentity: null }),
      ],
      "repair tests",
      { source: "workspace", tag: "tests", category: "development" },
    );

    expect(result.candidates.map(({ id }) => id)).toEqual(["workspace-test"]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "market-test" }),
        expect.objectContaining({ id: "unsafe" }),
      ]),
    );
  });

  it("rejects an unbounded result limit", () => {
    expect(() =>
      routeSkillSearch([skill("repair", "repair tests")], "repair", {
        limit: "65",
      }),
    ).toThrow("1 to 64");
  });

  it("passes verified outcome metrics into canonical reranking", () => {
    const lowerOutcome = skill("alpha-repair", "repair failing tests");
    const higherOutcome = skill("omega-repair", "repair failing tests");
    const result = routeSkillSearch(
      [lowerOutcome, higherOutcome],
      "repair failing tests",
      {
        outcomeMetrics: {
          [lowerOutcome.executionIdentity.contentDigest]: {
            samples: 10,
            successRate: 0.2,
            correctionRate: 0.5,
          },
          [higherOutcome.executionIdentity.contentDigest]: {
            samples: 10,
            successRate: 0.9,
            correctionRate: 0,
          },
        },
      },
    );

    expect(result.selected.digest).toBe(
      higherOutcome.executionIdentity.contentDigest,
    );
    expect(result.selected.outcome).toEqual({
      samples: 10,
      successRate: 0.9,
      correctionRate: 0,
    });
  });

  it("passes the branded revocation reader into CLI canonical routing", () => {
    const revoked = skill("repair-tests", "repair failing tests");
    const reader = {
      inspect: () => ({ invalidated: true }),
    };
    expect(() =>
      routeSkillSearch([revoked], "repair tests", {
        revocationReader: reader,
      }),
    ).toThrow("branded");
  });
});
