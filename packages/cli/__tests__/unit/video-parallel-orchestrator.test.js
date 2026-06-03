/**
 * video-parallel-orchestrator.test.js — Phase 3 tests
 * Covers: detectConflicts, ParallelShotOrchestrator, reviewer, createQualityCheckPolicy
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  ParallelShotOrchestrator,
  detectConflicts,
} from "../../src/skills/video-editing/parallel-orchestrator.js";
import {
  reviewEntry,
  registerChecker,
  getChecker,
  listCheckers,
  createQualityCheckPolicy,
  DEFAULT_THRESHOLDS,
} from "../../src/skills/video-editing/reviewer.js";

// ── detectConflicts ─────────────────────────────────────────

describe("detectConflicts", () => {
  test("returns empty when no overlaps", () => {
    const results = [
      { clips: [{ start: 0, end: 5 }] },
      { clips: [{ start: 5, end: 10 }] },
      { clips: [{ start: 10, end: 15 }] },
    ];
    expect(detectConflicts(results)).toHaveLength(0);
  });

  test("detects single overlap pair", () => {
    const results = [
      { clips: [{ start: 0, end: 6 }] },
      { clips: [{ start: 5, end: 10 }] },
    ];
    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual([results[0], results[1]]);
  });

  test("detects multiple overlap pairs", () => {
    const a = { clips: [{ start: 0, end: 10 }] };
    const b = { clips: [{ start: 5, end: 15 }] };
    const c = { clips: [{ start: 8, end: 20 }] };
    const conflicts = detectConflicts([a, b, c]);
    expect(conflicts.length).toBeGreaterThanOrEqual(2);
  });

  test("handles entries with no clips", () => {
    const results = [{ clips: [] }, { clips: [{ start: 0, end: 5 }] }];
    expect(detectConflicts(results)).toHaveLength(0);
  });

  test("handles entries with multiple clips", () => {
    const a = {
      clips: [
        { start: 0, end: 3 },
        { start: 10, end: 13 },
      ],
    };
    const b = { clips: [{ start: 11, end: 14 }] };
    const conflicts = detectConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
  });

  test("touching ranges (end === start) do not conflict", () => {
    const results = [
      { clips: [{ start: 0, end: 5 }] },
      { clips: [{ start: 5, end: 10 }] },
    ];
    expect(detectConflicts(results)).toHaveLength(0);
  });
});

// ── ParallelShotOrchestrator ────────────────────────────────

describe("ParallelShotOrchestrator", () => {
  let orch;

  beforeEach(() => {
    orch = new ParallelShotOrchestrator({
      maxConcurrency: 2,
      maxReruns: 2,
    });
  });

  test("runs sections in parallel batches", async () => {
    const callOrder = [];
    const sections = [
      { section_idx: 0, shots: [{ shot_idx: 0, target_duration: 3 }] },
      { section_idx: 1, shots: [{ shot_idx: 0, target_duration: 3 }] },
      { section_idx: 2, shots: [{ shot_idx: 0, target_duration: 3 }] },
    ];

    const runShot = vi.fn(async (section, shot) => {
      callOrder.push(section.section_idx);
      return {
        clips: [
          {
            start: section.section_idx * 10,
            end: section.section_idx * 10 + 3,
          },
        ],
        total_duration: 3,
      };
    });

    const results = await orch.run(sections, runShot, {});
    expect(runShot).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(3);
  });

  test("emits batch_start events", async () => {
    const events = [];
    orch.on("event", (ev) => events.push(ev));

    const sections = [
      { section_idx: 0, shots: [{ shot_idx: 0 }] },
      { section_idx: 1, shots: [{ shot_idx: 0 }] },
      { section_idx: 2, shots: [{ shot_idx: 0 }] },
    ];

    await orch.run(sections, async () => ({ clips: [] }), {});
    const batchEvents = events.filter((e) => e.type === "parallel.batch_start");
    expect(batchEvents).toHaveLength(2); // batch 0 (2 items) + batch 1 (1 item)
  });

  test("resolves conflicts by quality score", async () => {
    const sections = [
      {
        section_idx: 0,
        shots: [{ shot_idx: 0, target_duration: 5 }],
        music_segment: { start: 0, end: 5 },
      },
      {
        section_idx: 1,
        shots: [{ shot_idx: 0, target_duration: 5 }],
        music_segment: { start: 0, end: 5 },
      },
    ];

    let callCount = 0;
    const runShot = vi.fn(async (section, shot, ctx) => {
      callCount++;
      if (callCount <= 2) {
        return {
          clips: [{ start: 0, end: 5 }],
          total_duration: 5,
          protagonist_ratio: section.section_idx === 0 ? 0.9 : 0.1,
        };
      }
      return {
        clips: [{ start: 20, end: 25 }],
        total_duration: 5,
        protagonist_ratio: 0.5,
      };
    });

    const results = await orch.run(sections, runShot, {});
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("handles shot errors gracefully", async () => {
    const events = [];
    orch.on("event", (ev) => events.push(ev));

    const sections = [{ section_idx: 0, shots: [{ shot_idx: 0 }] }];

    const runShot = vi.fn(async () => {
      throw new Error("ffmpeg crash");
    });

    const results = await orch.run(sections, runShot, {});
    expect(results).toHaveLength(0);
    const errorEvents = events.filter((e) => e.type === "parallel.shot_error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0].error).toBe("ffmpeg crash");
  });

  test("quality score weights protagonist and duration", () => {
    const score = orch._qualityScore({
      protagonist_ratio: 0.8,
      target_duration: 5,
      total_duration: 5,
    });
    // 0.6 * 0.8 + 0.4 * 1.0 = 0.88
    expect(score).toBeCloseTo(0.88, 2);
  });

  test("quality score penalizes duration mismatch", () => {
    const score = orch._qualityScore({
      protagonist_ratio: 0.8,
      target_duration: 5,
      total_duration: 10,
    });
    // duration_accuracy = 1 - min(|10-5|/5, 1) = 0
    // 0.6 * 0.8 + 0.4 * 0 = 0.48
    expect(score).toBeCloseTo(0.48, 2);
  });

  test("_extractTimeRanges returns clip ranges", () => {
    const entry = {
      clips: [
        { start: 1, end: 3 },
        { start: 7, end: 9 },
      ],
    };
    const ranges = orch._extractTimeRanges(entry);
    expect(ranges).toEqual([
      { start: 1, end: 3 },
      { start: 7, end: 9 },
    ]);
  });
});

// ── Reviewer ────────────────────────────────────────────────

describe("reviewer", () => {
  test("built-in checkers are registered", () => {
    const names = listCheckers();
    expect(names).toContain("vision-protagonist");
    expect(names).toContain("aesthetic-score");
  });

  test("getChecker returns checker object", () => {
    const checker = getChecker("vision-protagonist");
    expect(checker).toBeDefined();
    expect(typeof checker.check).toBe("function");
  });

  test("registerChecker adds custom checker", () => {
    registerChecker("test-checker", async () => ({
      pass: true,
      score: 1,
      reason: "ok",
    }));
    expect(listCheckers()).toContain("test-checker");
  });

  test("reviewEntry passes when all checkers pass", async () => {
    registerChecker("always-pass", async () => ({
      pass: true,
      score: 0.9,
      reason: "fine",
    }));
    const result = await reviewEntry(
      { clips: [{ start: 0, end: 5 }] },
      ["always-pass"],
      {},
    );
    expect(result.pass).toBe(true);
    expect(result.aggregateScore).toBeCloseTo(0.9);
  });

  test("reviewEntry fails when any checker fails", async () => {
    registerChecker("always-fail", async () => ({
      pass: false,
      score: 0.1,
      reason: "bad",
    }));
    const result = await reviewEntry(
      { clips: [{ start: 0, end: 5 }] },
      ["always-pass", "always-fail"],
      {},
    );
    expect(result.pass).toBe(false);
  });

  test("reviewEntry handles unknown checker gracefully", async () => {
    const result = await reviewEntry(
      { clips: [] },
      ["nonexistent-checker"],
      {},
    );
    expect(result.pass).toBe(true);
    expect(result.checks[0].reason).toContain("Unknown checker");
  });

  test("reviewEntry handles checker error", async () => {
    registerChecker("broken", async () => {
      throw new Error("boom");
    });
    const result = await reviewEntry({ clips: [] }, ["broken"], {});
    expect(result.pass).toBe(false);
    expect(result.checks[0].reason).toContain("Checker error");
  });

  test("vision-protagonist skips when no VLM", async () => {
    const result = await reviewEntry(
      { clips: [{ start: 0, end: 5 }] },
      ["vision-protagonist"],
      { llmCall: null },
    );
    expect(result.pass).toBe(true);
    expect(result.checks[0].reason).toContain("skipped");
  });

  test("vision-protagonist uses llmCall result", async () => {
    const llmCall = vi.fn(async () => ({ protagonist_ratio: 0.8 }));
    const result = await reviewEntry(
      { clips: [{ start: 0, end: 5 }] },
      ["vision-protagonist"],
      { llmCall, mainCharacter: "Alice" },
    );
    expect(result.pass).toBe(true);
    expect(result.checks[0].score).toBe(0.8);
    expect(llmCall).toHaveBeenCalledWith(
      expect.objectContaining({ type: "protagonist-detect" }),
    );
  });

  test("vision-protagonist fails below threshold", async () => {
    const llmCall = vi.fn(async () => ({ protagonist_ratio: 0.2 }));
    const result = await reviewEntry(
      { clips: [{ start: 0, end: 5 }] },
      ["vision-protagonist"],
      { llmCall, thresholds: { protagonist_ratio: 0.5 } },
    );
    expect(result.pass).toBe(false);
    expect(result.checks[0].score).toBe(0.2);
  });

  test("DEFAULT_THRESHOLDS has expected values", () => {
    expect(DEFAULT_THRESHOLDS.protagonist_ratio).toBe(0.5);
    expect(DEFAULT_THRESHOLDS.aesthetic_score).toBe(2.5);
  });
});

// ── createQualityCheckPolicy ────────────────────────────────

describe("createQualityCheckPolicy", () => {
  test("returns policy object with expected shape", () => {
    const policy = createQualityCheckPolicy(["vision-protagonist"]);
    expect(policy.type).toBe("quality-check");
    expect(policy.checkers).toEqual(["vision-protagonist"]);
    expect(policy.onFail).toBe("rerun");
    expect(typeof policy.evaluate).toBe("function");
  });

  test("evaluate returns approve on pass", async () => {
    const policy = createQualityCheckPolicy(["vision-protagonist"], {
      thresholds: { protagonist_ratio: 0.3 },
    });
    const llmCall = vi.fn(async () => ({ protagonist_ratio: 0.8 }));
    const result = await policy.evaluate(
      { clips: [{ start: 0, end: 5 }] },
      { llmCall },
    );
    expect(result.pass).toBe(true);
    expect(result.action).toBe("approve");
  });

  test("evaluate returns rerun on fail", async () => {
    const policy = createQualityCheckPolicy(["vision-protagonist"], {
      onFail: "rerun",
      thresholds: { protagonist_ratio: 0.9 },
    });
    const llmCall = vi.fn(async () => ({ protagonist_ratio: 0.2 }));
    const result = await policy.evaluate(
      { clips: [{ start: 0, end: 5 }] },
      { llmCall },
    );
    expect(result.pass).toBe(false);
    expect(result.action).toBe("rerun");
  });

  test("custom onFail action", async () => {
    const policy = createQualityCheckPolicy(["vision-protagonist"], {
      onFail: "skip",
    });
    const llmCall = vi.fn(async () => ({ protagonist_ratio: 0.1 }));
    const result = await policy.evaluate(
      { clips: [{ start: 0, end: 5 }] },
      { llmCall },
    );
    expect(result.action).toBe("skip");
  });
});
