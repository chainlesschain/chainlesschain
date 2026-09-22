import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createSkillDecisionRequest,
  normalizeSkillDecisionProviderResult,
  resolveSkillDecision,
} from "../../src/lib/decision-layer/contracts.js";

const D = (value) =>
  `sha256:${createHash("sha256").update(String(value)).digest("hex")}`;

function request() {
  return createSkillDecisionRequest({
    decisionId: "skill-decision-1",
    tenantId: "tenant-a",
    sessionId: "session-a",
    turnId: "turn-a",
    query: "repair the failing vitest suite",
    candidates: [
      {
        id: "repair-tests",
        displayName: "Repair tests",
        description: "Diagnose and repair unit test failures",
        category: "development",
        digest: D("repair-tests"),
        tags: ["tests"],
      },
      {
        id: "write-docs",
        displayName: "Write docs",
        description: "Write project documentation",
        category: "documentation",
        digest: D("write-docs"),
        tags: ["docs"],
      },
    ],
  });
}

function providerResult(overrides = {}) {
  return {
    provider: "typesafe",
    model: "jev-test",
    answers: {
      needs_skill: { type: "noul", noul: 0.96 },
      best_skill: {
        type: "choice",
        choice: "c1",
        confidence: 0.9,
        probabilities: { c1: 0.92, c2: 0.05, none: 0.03 },
      },
      fits_c1: { type: "noul", noul: 0.95 },
      fits_c2: { type: "noul", noul: 0.1 },
    },
    usage: { input_tokens: 20, output_tokens: 5 },
    ...overrides,
  };
}

describe("typed Skill decision contracts", () => {
  it("builds bounded candidate questions and resolves an accepted suggestion", () => {
    const input = request();
    expect(Object.keys(input.payload.questions)).toEqual([
      "needs_skill",
      "best_skill",
      "fits_c1",
      "fits_c2",
    ]);
    expect(input.payload.questions.best_skill.criteria).toHaveProperty("none");

    const normalized = normalizeSkillDecisionProviderResult(
      input,
      providerResult(),
    );
    expect(resolveSkillDecision(input, normalized)).toMatchObject({
      status: "suggestion",
      selectedSkillId: "repair-tests",
      selectedDigest: D("repair-tests"),
    });
  });

  it("keeps no-match distinct from uncertainty", () => {
    const input = request();
    const normalized = normalizeSkillDecisionProviderResult(
      input,
      providerResult({
        answers: {
          ...providerResult().answers,
          needs_skill: { type: "noul", noul: 0.2 },
        },
      }),
    );
    expect(resolveSkillDecision(input, normalized)).toMatchObject({
      status: "no-match",
      reasonCode: "needs-skill-below-threshold",
      selectedDigest: null,
    });
  });

  it("rejects incomplete or unnormalized probability distributions", () => {
    const input = request();
    const bad = providerResult();
    bad.answers.best_skill.probabilities = { c1: 0.8, c2: 0.1, none: 0.2 };
    expect(() => normalizeSkillDecisionProviderResult(input, bad)).toThrow(
      "sum to one",
    );

    delete bad.answers.fits_c2;
    expect(() => normalizeSkillDecisionProviderResult(input, bad)).toThrow(
      "incomplete",
    );
  });

  it("rejects duplicate candidate identities and oversized sets", () => {
    const input = request();
    expect(() =>
      createSkillDecisionRequest({
        decisionId: "duplicate",
        tenantId: "tenant-a",
        sessionId: "session-a",
        turnId: "turn-a",
        query: "task",
        candidates: [input.candidates[0], input.candidates[0]],
      }),
    ).toThrow("unique content digests");
  });
});
