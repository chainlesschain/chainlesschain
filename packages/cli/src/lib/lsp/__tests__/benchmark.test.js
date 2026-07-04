/**
 * benchmark stats tests — the pure percentile/summarize helpers that turn raw
 * latency samples into a report. No spawning; the harness itself is exercised by
 * the live `cc code-intel bench` run.
 */

import { describe, it, expect } from "vitest";
import {
  percentile,
  summarize,
  sumSubtreeRss,
  sumSubtreeRssFromWmicCsv,
} from "../benchmark.js";

describe("percentile", () => {
  it("returns the value for a single sample", () => {
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([5], 95)).toBe(5);
  });
  it("computes median and p95 with interpolation", () => {
    const s = [10, 20, 30, 40, 50];
    expect(percentile(s, 50)).toBe(30);
    // p95 of 5 points: rank = 0.95*4 = 3.8 → 40 + (50-40)*0.8 = 48
    expect(percentile(s, 95)).toBeCloseTo(48, 5);
  });
  it("is order-independent (sorts internally)", () => {
    expect(percentile([50, 10, 30, 40, 20], 50)).toBe(30);
  });
  it("returns null for an empty sample", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("summarize", () => {
  it("reports n/min/median/p95/max/mean rounded to 0.1ms", () => {
    const s = summarize([12.34, 5.6, 8.9, 20.1, 3.33]);
    expect(s.n).toBe(5);
    expect(s.min).toBe(3.3);
    expect(s.max).toBe(20.1);
    expect(s.median).toBe(8.9);
    expect(s.mean).toBe(10.1); // (12.34+5.6+8.9+20.1+3.33)/5 = 10.054 → 10.1
  });
  it("handles an empty sample", () => {
    expect(summarize([])).toEqual({ n: 0 });
  });
});

describe("sumSubtreeRss", () => {
  // launcher(100) → node server(200) → worker(300); sibling(400) unrelated
  const rows = [
    { pid: 100, ppid: 1, val: 5 },
    { pid: 200, ppid: 100, val: 120 },
    { pid: 300, ppid: 200, val: 40 },
    { pid: 400, ppid: 1, val: 999 },
  ];
  it("sums a pid and all its transitive descendants (not the launcher alone)", () => {
    expect(sumSubtreeRss(rows, 100)).toBe(165); // 5 + 120 + 40
  });
  it("returns just the leaf when it has no children", () => {
    expect(sumSubtreeRss(rows, 300)).toBe(40);
  });
  it("returns null when the root pid is absent", () => {
    expect(sumSubtreeRss(rows, 555)).toBeNull();
  });
  it("does not loop on a cyclic parent relationship", () => {
    const cyclic = [
      { pid: 1, ppid: 2, val: 10 },
      { pid: 2, ppid: 1, val: 20 },
    ];
    expect(sumSubtreeRss(cyclic, 1)).toBe(30);
  });
});

describe("sumSubtreeRssFromWmicCsv", () => {
  it("parses wmic CSV and sums the subtree in bytes", () => {
    const csv = [
      "Node,ParentProcessId,ProcessId,WorkingSetSize",
      "HOST,1,100,5000",
      "HOST,100,200,120000",
      "HOST,200,300,40000",
      "HOST,1,400,999000",
    ].join("\r\n");
    expect(sumSubtreeRssFromWmicCsv(csv, 100)).toBe(165000);
  });
  it("returns null on malformed input", () => {
    expect(sumSubtreeRssFromWmicCsv("garbage\r\n", 100)).toBeNull();
  });
});
