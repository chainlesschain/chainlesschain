import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { openDecisionProviderAuthority } from "../../src/lib/decision-layer/provider-authority.js";
import { createSkillDecisionRuntime } from "../../src/lib/decision-layer/runtime.js";
import { executeTool } from "../../src/runtime/agent-core.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function skill(id, description) {
  return {
    id,
    dirName: id,
    displayName: id,
    description,
    category: "development",
    source: "workspace",
    version: "1.0.0",
    tags: ["code"],
    os: [],
    capabilities: ["workspace.read"],
    hasHandler: true,
    executionIdentity: { contentDigest: D(id) },
  };
}

function loader() {
  const skills = [
    skill("repair-tests", "repair failing vitest unit tests"),
    skill("write-docs", "write product documentation"),
  ];
  return {
    getResolvedSkills: () => skills,
    recordDescriptorUse: vi.fn(),
  };
}

function decisionRuntime(mode, observe) {
  const provider = openDecisionProviderAuthority({
    provider: "typesafe",
    model: "jev-test",
    decide: async (request) => {
      const candidateIds = request.candidates.map(
        ({ candidateId }) => candidateId,
      );
      const probabilities = Object.fromEntries(
        candidateIds.map((candidateId, index) => [
          candidateId,
          index === 0 ? 0.96 : 0,
        ]),
      );
      probabilities.none = 0.04;
      return {
        provider: "typesafe",
        model: "jev-test",
        answers: {
          needs_skill: { type: "noul", noul: 0.97 },
          best_skill: {
            type: "choice",
            choice: "c1",
            confidence: 0.92,
            probabilities,
          },
          ...Object.fromEntries(
            candidateIds.map((candidateId, index) => [
              `fits_${candidateId}`,
              { type: "noul", noul: index === 0 ? 0.96 : 0.05 },
            ]),
          ),
        },
        usage: { input_tokens: 40, output_tokens: 8 },
      };
    },
  });
  return createSkillDecisionRuntime({
    mode,
    tenantId: "tenant-a",
    sessionId: "session-a",
    provider,
    persist: async () => {},
    observe,
    idGenerator: () => `${mode}-1`,
  });
}

describe("CLI list_skills decision suggestion", () => {
  it("exposes a typed suggestion without replacing the existing retrieval result", async () => {
    const observe = vi.fn(async () => {});
    const result = await executeTool(
      "list_skills",
      { query: "repair vitest tests" },
      {
        cwd: process.cwd(),
        sessionId: "session-a",
        turnId: "turn-a",
        toolCallId: "tool-a",
        skillLoader: loader(),
        skillDecisionRuntime: decisionRuntime("suggest", observe),
      },
    );

    expect(result.routing.selectedDigest).toBe(D("repair-tests"));
    expect(result.routing.decisionSuggestion).toMatchObject({
      status: "suggestion",
      selectedSkillId: "repair-tests",
      selectedDigest: D("repair-tests"),
    });
    expect(result.skills[0].id).toBe("repair-tests");
    expect(observe).toHaveBeenCalledOnce();
  });

  it("records shadow decisions without changing the Agent-visible payload", async () => {
    const observe = vi.fn(async () => {});
    const result = await executeTool(
      "list_skills",
      { query: "repair vitest tests" },
      {
        cwd: process.cwd(),
        sessionId: "session-a",
        turnId: "turn-a",
        toolCallId: "tool-a",
        skillLoader: loader(),
        skillDecisionRuntime: decisionRuntime("shadow", observe),
      },
    );

    expect(result.routing).not.toHaveProperty("decisionSuggestion");
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "shadow",
        status: "suggestion",
        selectedDigest: D("repair-tests"),
      }),
    );
  });
});
