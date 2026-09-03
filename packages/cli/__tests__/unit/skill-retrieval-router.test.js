import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SKILL_RETRIEVAL_RESULT_SCHEMA,
  routeSkillDescriptors,
} from "../../src/lib/skill-retrieval-router.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function skill(id, description, overrides = {}) {
  return {
    id,
    displayName: id,
    description,
    category: "development",
    source: "workspace",
    version: "1.0.0",
    tags: ["code"],
    paths: [],
    os: [],
    capabilities: ["workspace.read"],
    executionIdentity: { contentDigest: D(id) },
    ...overrides,
  };
}

describe("Skill retrieval router", () => {
  it("ranks BM25, vector and verified outcome signals with explanations", () => {
    const repair = skill(
      "repair-tests",
      "repair failing unit tests with vitest",
    );
    const docs = skill("write-docs", "write documentation and release notes");
    const result = routeSkillDescriptors({
      skills: [docs, repair],
      query: "repair vitest failure",
      vectorScores: { [D("repair-tests")]: 0.9, [D("write-docs")]: 0.1 },
      outcomeMetrics: {
        [D("repair-tests")]: {
          samples: 20,
          successRate: 0.95,
          correctionRate: 0.05,
        },
      },
    });
    expect(result).toMatchObject({
      schema: SKILL_RETRIEVAL_RESULT_SCHEMA,
      selected: { id: "repair-tests", digest: D("repair-tests") },
      vectorAvailable: true,
    });
    expect(result.candidates[0].reason).toContain("bm25=");
    expect(result.candidates[0].contextCostTokens).toBeGreaterThan(0);
  });

  it("filters namespace, tags, path, OS and capability before recall", () => {
    const result = routeSkillDescriptors({
      skills: [
        skill("allowed", "deploy service", { paths: ["services/api"] }),
        skill("wrong-namespace", "deploy service", { source: "marketplace" }),
        skill("wrong-os", "deploy service", { os: ["darwin"] }),
        skill("too-powerful", "deploy service", {
          capabilities: ["workspace.read", "network.write"],
        }),
      ],
      query: "deploy service",
      namespace: "workspace",
      tags: ["code"],
      targetPath: "services/api/src",
      target: { os: "linux", allowedCapabilities: ["workspace.read"] },
    });
    expect(result.candidates.map(({ id }) => id)).toEqual(["allowed"]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "wrong-namespace" }),
        expect.objectContaining({ id: "wrong-os" }),
        expect.objectContaining({ id: "too-powerful" }),
      ]),
    );
  });

  it("never silently selects same-name incompatible versions", () => {
    const result = routeSkillDescriptors({
      skills: [
        skill("repair", "repair tests", {
          version: "1.0.0",
          executionIdentity: { contentDigest: D("repair-v1") },
        }),
        skill("repair", "repair tests", {
          version: "2.0.0",
          source: "marketplace",
          executionIdentity: { contentDigest: D("repair-v2") },
        }),
      ],
      query: "repair tests",
      ambiguityMargin: 0,
    });
    expect(result.selected).toBeNull();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ type: "same-name-different-version" }),
    ]);
  });

  it("abstains when top scores are ambiguous", () => {
    const result = routeSkillDescriptors({
      skills: [skill("alpha", "same task"), skill("beta", "same task")],
      query: "same task",
      ambiguityMargin: 0.5,
    });
    expect(result.selected).toBeNull();
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ambiguous-top-score" }),
      ]),
    );
  });

  it("rejects unbounded inputs and invalid outcome evidence", () => {
    expect(() => routeSkillDescriptors({ skills: [], query: "" })).toThrow(
      "invalid or unbounded",
    );
    expect(() =>
      routeSkillDescriptors({
        skills: [skill("repair", "repair tests")],
        query: "repair",
        outcomeMetrics: {
          [D("repair")]: { samples: 1, successRate: 2, correctionRate: 0 },
        },
      }),
    ).toThrow("outcome metrics");
  });
});
