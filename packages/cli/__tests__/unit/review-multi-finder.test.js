/**
 * cc review --multi — fan out one finder agent per dimension, then dedupe/rank
 * their JSON findings into a structured report. Drives runMultiFinderReview with
 * an injected runAgentHeadless (no real LLM) and checks the pure prompt/render
 * helpers.
 */
import { describe, it, expect, vi } from "vitest";
import {
  buildDimensionPrompt,
  renderMultiFinderReport,
  runMultiFinderReview,
  REVIEW_DIMENSIONS,
} from "../../src/commands/review.js";

describe("buildDimensionPrompt", () => {
  it("focuses the finder on one dimension and asks for a JSON array", () => {
    const p = buildDimensionPrompt(
      { diff: "@@ -1 +1 @@\n-a\n+b", summary: "1 file", label: "working" },
      { key: "security", label: "security", hint: "injection, secrets" },
    );
    expect(p).toMatch(/security code reviewer/);
    expect(p).toMatch(/injection, secrets/);
    expect(p).toContain("```diff");
    expect(p).toMatch(/ONLY a JSON array/);
  });
});

describe("renderMultiFinderReport", () => {
  it("renders severity counts, dimensions, and each finding", () => {
    const report = {
      findings: [
        {
          path: "x.js",
          line: 3,
          category: "security",
          severity: "High",
          failure_scenario: "SQL injection",
          evidence: "user input concatenated",
        },
      ],
      summary: { total: 1, bySeverity: { High: 1 } },
    };
    const md = renderMultiFinderReport(report, { security: 1, correctness: 0 });
    expect(md).toMatch(/Multi-agent review — 1 finding/);
    expect(md).toMatch(/High: 1/);
    expect(md).toMatch(/security 1/);
    expect(md).toMatch(/\[High\] x\.js:3 \(security\)/);
    expect(md).toMatch(/SQL injection/);
  });

  it("says so when there are no findings", () => {
    expect(
      renderMultiFinderReport({ findings: [], summary: { total: 0 } }),
    ).toMatch(/No findings/);
  });
});

describe("runMultiFinderReview", () => {
  const dimensions = [
    { key: "alpha", label: "alpha", hint: "a-stuff" },
    { key: "beta", label: "beta", hint: "b-stuff" },
  ];

  function stubRun(byLabel) {
    const calls = [];
    const run = vi.fn(async (opts) => {
      calls.push(opts);
      const label = /a (\w+) code reviewer/.exec(opts.prompt)?.[1];
      return { result: JSON.stringify(byLabel[label] || []) };
    });
    return { run, calls };
  }

  it("runs one finder per dimension and merges cross-dimension duplicates", async () => {
    const { run, calls } = stubRun({
      alpha: [
        { path: "x.js", line: 1, severity: "High", title: "bug", body: "b1" },
        { path: "y.js", line: 2, severity: "Low", title: "only-a", body: "b" },
      ],
      beta: [
        // same path:line:title as alpha's — must merge, keep max severity.
        {
          path: "x.js",
          line: 1,
          severity: "Critical",
          title: "bug",
          body: "b2",
        },
      ],
    });
    let out = "";
    const res = await runMultiFinderReview(
      { outputFormat: "json", writeOut: (s) => (out += s), scope: "working" },
      { runAgentHeadless: run, dimensions },
    );
    expect(calls).toHaveLength(2); // one finder per dimension
    expect(res.report.summary.total).toBe(2); // x.js:1:bug merged, y.js:2 distinct
    expect(res.byDimension).toEqual({ alpha: 2, beta: 1 });
    const merged = res.report.findings.find((f) => f.path === "x.js");
    expect(merged.severity).toBe("Critical"); // max across finders
    const parsed = JSON.parse(out);
    expect(parsed.byDimension).toEqual({ alpha: 2, beta: 1 });
  });

  it("captures finder output (raw JSON never hits writeOut) and renders markdown by default", async () => {
    const { run } = stubRun({
      alpha: [
        { path: "a.js", line: 5, severity: "Medium", title: "t", body: "d" },
      ],
      beta: [],
    });
    let out = "";
    await runMultiFinderReview(
      { writeOut: (s) => (out += s), scope: "working" },
      { runAgentHeadless: run, dimensions },
    );
    expect(out).toMatch(/Multi-agent review/); // rendered report
    expect(out).not.toMatch(/"title"/); // raw finder JSON was captured, not printed
  });

  it("tolerates a finder that throws — others still contribute", async () => {
    const run = vi.fn(async (opts) => {
      if (opts.prompt.includes("alpha code reviewer")) throw new Error("boom");
      return {
        result: JSON.stringify([
          { path: "b.js", line: 9, severity: "High", title: "t", body: "d" },
        ]),
      };
    });
    const res = await runMultiFinderReview(
      { writeOut: () => {}, writeErr: () => {}, scope: "working" },
      { runAgentHeadless: run, dimensions },
    );
    expect(res.byDimension.alpha).toBe(0);
    expect(res.byDimension.beta).toBe(1);
    expect(res.report.summary.total).toBe(1);
  });

  it("ships the four default review dimensions", () => {
    expect(REVIEW_DIMENSIONS.map((d) => d.key)).toEqual([
      "correctness",
      "security",
      "performance",
      "tests",
    ]);
  });
});
