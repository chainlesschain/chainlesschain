import { describe, it, expect } from "vitest";
import {
  computeTrend,
  summarizeRun,
  sparkline,
  formatTrend,
} from "../../src/lib/eval/trend.js";

// A raw `cc eval --json` summary shape.
const run = (ranAt, pairs, label = null) => ({
  ranAt,
  label,
  passed: pairs.filter(([, p]) => p).length,
  total: pairs.length,
  passRate: pairs.filter(([, p]) => p).length / pairs.length,
  results: pairs.map(([id, pass]) => ({ id, pass })),
});

describe("summarizeRun", () => {
  it("derives perTask + counts from results", () => {
    const s = summarizeRun(
      run("2026-07-01", [
        ["a", true],
        ["b", false],
      ]),
    );
    expect(s.perTask).toEqual({ a: true, b: false });
    expect(s.passed).toBe(1);
    expect(s.total).toBe(2);
    expect(s.passRate).toBe(0.5);
  });
});

describe("computeTrend", () => {
  it("returns n/a with a single run (no delta yet)", () => {
    const t = computeTrend([run("2026-07-01", [["a", true]])]);
    expect(t.runs).toBe(1);
    expect(t.direction).toBe("n/a");
    expect(t.regressed).toBe(false);
    expect(t.previous).toBe(null);
  });

  it("reports an improving trend with fixed tasks", () => {
    const t = computeTrend([
      run("2026-07-01", [
        ["a", true],
        ["b", false],
      ]),
      run("2026-07-02", [
        ["a", true],
        ["b", true],
      ]),
    ]);
    expect(t.direction).toBe("up");
    expect(t.delta).toBeCloseTo(0.5, 5);
    expect(t.fixed).toEqual(["b"]);
    expect(t.regressions).toEqual([]);
    expect(t.regressed).toBe(false);
  });

  it("flags a per-task regression even when the aggregate rate is flat", () => {
    // a broke, b fixed → same 1/2 rate, but 'a' is a real regression.
    const t = computeTrend([
      run("2026-07-01", [
        ["a", true],
        ["b", false],
      ]),
      run("2026-07-02", [
        ["a", false],
        ["b", true],
      ]),
    ]);
    expect(t.delta).toBeCloseTo(0, 5);
    expect(t.direction).toBe("flat");
    expect(t.regressions).toEqual(["a"]);
    expect(t.fixed).toEqual(["b"]);
    expect(t.regressed).toBe(true); // gate trips on the regression, not the rate
  });

  it("honors the regression threshold for a pure rate drop", () => {
    const runs = [
      run("2026-07-01", [
        ["a", true],
        ["b", true],
        ["c", true],
        ["d", true],
      ]),
      run("2026-07-02", [
        ["a", true],
        ["b", true],
        ["c", true],
        ["d", true],
      ]),
    ];
    // Identical runs → flat, not regressed.
    expect(computeTrend(runs).regressed).toBe(false);
    // Now drop one task (25 pts). Threshold 30 pts → tolerated; 20 pts → trips.
    const dropped = [
      runs[0],
      run("2026-07-02", [
        ["a", true],
        ["b", true],
        ["c", true],
        ["d", false],
      ]),
    ];
    // A dropped task is itself a regression, so it always trips regardless of
    // threshold — verify via a run that lowers the rate WITHOUT a task regressing
    // (a brand-new failing task appearing).
    const grew = [
      run("2026-07-01", [
        ["a", true],
        ["b", true],
      ]),
      run("2026-07-02", [
        ["a", true],
        ["b", true],
        ["c", false],
      ]),
    ];
    // c is new (not in previous) → not a "regression"; rate 1.0→0.667 = -33 pts.
    expect(computeTrend(grew, { regressionThreshold: 0.4 }).regressed).toBe(
      false,
    );
    expect(computeTrend(grew, { regressionThreshold: 0.2 }).regressed).toBe(
      true,
    );
    expect(dropped[1].results.find((r) => r.id === "d").pass).toBe(false);
  });

  it("orders runs by ranAt regardless of input order", () => {
    const t = computeTrend([
      run("2026-07-03", [["a", false]]),
      run("2026-07-01", [["a", true]]),
      run("2026-07-02", [["a", true]]),
    ]);
    // Latest = 07-03 (a fails), previous = 07-02 (a passes) → regression.
    expect(t.latest.perTask.a).toBe(false);
    expect(t.regressions).toEqual(["a"]);
  });

  it("detects a dropped task between runs", () => {
    const t = computeTrend([
      run("2026-07-01", [
        ["a", true],
        ["b", true],
      ]),
      run("2026-07-02", [["a", true]]),
    ]);
    expect(t.newlyMissing).toEqual(["b"]);
  });

  it("handles empty history", () => {
    const t = computeTrend([]);
    expect(t.runs).toBe(0);
    expect(t.regressed).toBe(false);
    expect(t.direction).toBe("n/a");
  });
});

describe("sparkline + formatTrend", () => {
  it("renders a bar per run scaled to pass-rate", () => {
    const s = sparkline([0, 0.5, 1]);
    expect(s).toHaveLength(3);
    expect(s[0]).toBe("▁"); // 0 → lowest bar
    expect(s[2]).toBe("█"); // 1 → highest bar
  });

  it("formats a regressed report with the gate verdict", () => {
    const t = computeTrend([
      run("2026-07-01", [["a", true]]),
      run("2026-07-02", [["a", false]]),
    ]);
    const text = formatTrend(t);
    expect(text).toMatch(/REGRESSED/);
    expect(text).toMatch(/regressions: a/);
  });
});
