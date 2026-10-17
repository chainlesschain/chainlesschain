import { describe, expect, it, vi } from "vitest";
import { createSkillDecisionRequest } from "../../src/lib/decision-layer/contracts.js";
import {
  snapshotSkillDecisionRequest,
  snapshotSkillDecisionPayload,
  buildSkillDecisionPayload,
} from "../../src/lib/evolution/skill-decision-projection.js";

function request() {
  return createSkillDecisionRequest({
    decisionId: "decision-1",
    tenantId: "tenant-a",
    sessionId: "session-a",
    turnId: "turn-a",
    query: "repair tests",
    candidates: [
      {
        id: "repair",
        description: "Repair tests",
        digest: `sha256:${"a".repeat(64)}`,
      },
    ],
  });
}

function projection(content, overrides = {}) {
  return {
    visibility: "model-visible",
    truncated: false,
    redactionSummary: { byType: {} },
    content,
    ...overrides,
  };
}

describe("typed Skill decision projection", () => {
  it("captures immutable identity and payload without retaining source aliases", () => {
    const input = structuredClone(request());
    const captured = snapshotSkillDecisionRequest(input);
    input.payload.state.task = "changed";
    input.payload.questions.best_skill.criteria.c1 = "changed";
    expect(captured.payload.state.task).toBe("repair tests");
    expect(captured.payload.questions.best_skill.criteria.c1).not.toBe(
      "changed",
    );
    expect(
      Object.isFrozen(captured.payload.questions.best_skill.criteria),
    ).toBe(true);
  });

  it("rejects forged digests, extra fields and question changes", () => {
    for (const change of [
      (input) => {
        input.requestDigest = `sha256:${"b".repeat(64)}`;
      },
      (input) => {
        input.extra = "uncommitted";
      },
      (input) => {
        input.payload.questions.best_skill.instructions = "Different task";
      },
    ]) {
      const input = structuredClone(request());
      change(input);
      expect(() => snapshotSkillDecisionRequest(input)).toThrow();
    }
  });

  it("rejects hostile objects without evaluating getters", () => {
    const getter = vi.fn(() => "secret");
    const input = structuredClone(request().payload);
    Object.defineProperty(input.state, "task", {
      get: getter,
      enumerable: true,
    });
    expect(() => snapshotSkillDecisionPayload(input)).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
    const cycle = {};
    cycle.self = cycle;
    for (const value of [
      new Proxy({}, {}),
      cycle,
      { state: new Date() },
      { state: [,] },
    ]) {
      expect(() => snapshotSkillDecisionPayload(value)).toThrow();
    }
  });

  it("preserves whole long descriptions and rejects oversized serialized input", () => {
    const input = structuredClone(request().payload);
    input.state.candidates[0].description = "x".repeat(16_384);
    expect(
      snapshotSkillDecisionPayload(input).state.candidates[0].description,
    ).toHaveLength(16_384);
    input.state.task = "x".repeat(256 * 1024);
    expect(() => snapshotSkillDecisionPayload(input)).toThrow(/budget/);
  });

  it("allows only projected source text and never restores raw descriptions", () => {
    const input = request().payload;
    const projected = structuredClone(input);
    projected.state.task = "[REDACTED:credential]";
    projected.state.candidates[0].description =
      "[QUARANTINED:POTENTIAL_PROMPT_INJECTION]";
    projected.questions.best_skill.criteria.c1 = "Use [REDACTED:credential]";
    const result = buildSkillDecisionPayload(input, projection(projected));
    expect(result).toEqual(projected);
    expect(input.state.task).toBe("repair tests");
    expect(Object.isFrozen(result.questions.best_skill.criteria)).toBe(true);
  });

  it.each([
    (value) => {
      value.state.candidates[0].candidateId = "c2";
    },
    (value) => {
      value.questions.needs_skill.type = "choice";
    },
    (value) => {
      value.questions.needs_skill.instructions = "changed";
    },
    (value) => {
      value.questions.best_skill.criteria.none = "changed";
    },
    (value) => {
      value.state.candidates[0].tags.push("new");
    },
  ])("rejects changed protocol controls and structure", (change) => {
    const original = request().payload;
    const altered = structuredClone(original);
    change(altered);
    expect(() =>
      buildSkillDecisionPayload(original, projection(altered)),
    ).toThrow();
  });

  it.each([
    { visibility: "opaque" },
    { truncated: true },
    { redactionSummary: { byType: { "content-truncation": 1 } } },
  ])("refuses unusable projections", (overrides) => {
    const original = request().payload;
    expect(() =>
      buildSkillDecisionPayload(original, projection(original, overrides)),
    ).toThrow(/opaque or truncated/);
  });
});
