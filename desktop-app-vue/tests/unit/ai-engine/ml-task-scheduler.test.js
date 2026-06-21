/**
 * MLTaskScheduler unit tests — src/main/ai-engine/cowork/ml-task-scheduler.js
 *
 * Lightweight statistical model for task complexity / resource prediction,
 * previously untested. No bug found on review — this locks in the feature
 * extraction, prediction clamping, resource tiering, and duration math.
 *
 * Constructor takes no DB at construction (untrained weights are zero, bias 5.0),
 * so prediction is deterministic and fully offline-testable.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  MLTaskScheduler,
  RESOURCE_TIERS,
  TASK_TYPE_COMPLEXITY,
} from "../../../src/main/ai-engine/cowork/ml-task-scheduler.js";

const mk = () => new MLTaskScheduler(null);

describe("MLTaskScheduler.extractFeatures", () => {
  it("returns a 5-feature vector with normalized word count", () => {
    const { vector, details } = mk().extractFeatures("alpha beta gamma");
    expect(vector).toHaveLength(5);
    expect(details.wordCount).toBe(3);
    expect(vector[0]).toBeCloseTo(3 / 500);
  });

  it("keyword density is 0 for keyword-free text", () => {
    const { details } = mk().extractFeatures("the cat sat on the mat");
    expect(details.keywordMatches).toBe(0);
    expect(details.keywordDensity).toBe(0);
  });

  it("maps priority to a weight and lowercases it", () => {
    const f = (p) => mk().extractFeatures("x", { priority: p }).vector[3];
    expect(f("critical")).toBe(1.0);
    expect(f("HIGH")).toBe(0.75);
    expect(f("medium")).toBe(0.5);
    expect(f("low")).toBe(0.25);
    expect(f("bogus")).toBe(0.5); // unknown → default
  });

  it("uses explicit subtask count from context", () => {
    const { vector, details } = mk().extractFeatures("x", { subtasks: 5 });
    expect(details.subtaskCount).toBe(5);
    expect(vector[2]).toBe(0.5); // 5 / 10
  });

  it("counts 'then' conjunctions as subtasks heuristically", () => {
    const { details } = mk().extractFeatures("do a then b then c");
    expect(details.subtaskCount).toBe(2);
  });

  it("falls back to default task-type complexity for unknown types", () => {
    const { details } = mk().extractFeatures("x", { type: "TOTALLY_UNKNOWN" });
    expect(details.taskType).toBe("totally_unknown");
    expect(details.typeBaseComplexity).toBe(TASK_TYPE_COMPLEXITY.default);
  });
});

describe("MLTaskScheduler._predict / predictComplexity", () => {
  it("untrained model predicts the midpoint complexity (bias 5.0)", () => {
    const r = mk().predictComplexity("anything at all");
    expect(r.complexity).toBe(5);
  });

  it("_predict is bias + weighted dot product", () => {
    const s = mk();
    s.weights[0] = 4; // weight on wordCount feature
    expect(s._predict([1, 0, 0, 0, 0])).toBe(9); // 5 + 4*1
  });

  it("clamps predicted complexity into [1, 10]", () => {
    // priority feature (index 3) is exactly 1.0 for "critical" → deterministic.
    const hi = mk();
    hi.weights[3] = 100;
    expect(hi.predictComplexity("x", { priority: "critical" }).complexity).toBe(
      10,
    );
    const lo = mk();
    lo.weights[3] = -100;
    expect(lo.predictComplexity("x", { priority: "critical" }).complexity).toBe(
      1,
    );
  });

  it("reports low confidence with no samples", () => {
    const r = mk().predictComplexity("x");
    expect(r.confidence).toBeLessThanOrEqual(0.2);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe("MLTaskScheduler.predictResources / duration helpers", () => {
  it("maps complexity to the correct resource tier", () => {
    expect(mk().predictResources(1).agentCount).toBe(RESOURCE_TIERS[0].agents);
    expect(mk().predictResources(5).agentCount).toBe(2); // tier with maxComplexity 6
    const top = mk().predictResources(10);
    expect(top.agentCount).toBe(5);
    expect(top.tier).toBe(RESOURCE_TIERS.length);
  });

  it("_estimateDuration scales with tier multiplier and complexity", () => {
    const s = mk();
    expect(s._estimateDuration(5)).toBe(60000); // 60000 * 1.0 * (5/5)
    expect(s._estimateDuration(2)).toBe(12000); // 60000 * 0.5 * (2/5)
    expect(s._estimateDuration(10)).toBe(240000); // 60000 * 2.0 * (10/5)
  });

  it("_durationToComplexity inverts and clamps to [1,10]", () => {
    const s = mk();
    expect(s._durationToComplexity(60000)).toBe(5);
    expect(s._durationToComplexity(6000)).toBe(1); // clamped up from 0.5
    expect(s._durationToComplexity(600000)).toBe(10); // clamped down from 50
  });

  it("_humanDuration formats ms/s/m/h", () => {
    const s = mk();
    expect(s._humanDuration(500)).toBe("500ms");
    expect(s._humanDuration(5000)).toBe("5s");
    expect(s._humanDuration(90000)).toBe("2m");
    expect(s._humanDuration(7200000)).toBe("2h");
  });
});
