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
  buildVerifierPrompt,
  parseVerdict,
  runVerifierPass,
  resolveMultiVerify,
  REVIEW_DIMENSIONS,
} from "../../src/commands/review.js";
import { findingKey } from "../../src/lib/review-pipeline.js";

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

describe("buildVerifierPrompt", () => {
  it("asks a skeptic to reproduce the finding and reply JSON", () => {
    const p = buildVerifierPrompt({
      severity: "High",
      path: "x.js",
      line: 3,
      title: "off-by-one",
      evidence: "loops to <= len",
    });
    expect(p).toMatch(/SKEPTICAL/);
    expect(p).toMatch(/x\.js:3/);
    expect(p).toMatch(/off-by-one/);
    expect(p).toMatch(/"reproduced"/);
  });
});

describe("parseVerdict", () => {
  it("reads reproduced/confidence/reason into an applyVerdicts verdict", () => {
    expect(
      parseVerdict('{"reproduced": true, "confidence": 0.8, "reason": "real"}'),
    ).toEqual({ verified: true, confidence: 0.8, note: "real" });
    expect(parseVerdict('noise {"reproduced": false} tail')).toEqual({
      verified: false,
    });
  });

  it("returns null for unparseable output", () => {
    expect(parseVerdict("not json at all")).toBeNull();
  });
});

describe("runVerifierPass", () => {
  it("collects verdicts keyed by findingKey; a thrown verifier leaves no verdict", async () => {
    const findings = [
      { path: "x.js", line: 1, title: "a", severity: "High" },
      { path: "y.js", line: 2, title: "b", severity: "Low" },
    ];
    const run = vi.fn(async (opts) => {
      if (opts.prompt.includes("x.js:1")) throw new Error("boom");
      return { result: '{"reproduced": true, "confidence": 0.7}' };
    });
    const verdicts = await runVerifierPass(
      findings,
      { writeErr: () => {} },
      { runAgentHeadless: run },
    );
    expect(Object.keys(verdicts)).toEqual([findingKey(findings[1])]);
    expect(verdicts[findingKey(findings[1])].verified).toBe(true);
  });
});

describe("runMultiFinderReview --verify", () => {
  const dimensions = [
    { key: "alpha", label: "alpha", hint: "a" },
    { key: "beta", label: "beta", hint: "b" },
  ];

  it("drops findings the verifier refutes and reports the verified count", async () => {
    const run = vi.fn(async (opts) => {
      if (opts.prompt.includes("SKEPTICAL")) {
        // refute the x.js:1 finding, reproduce y.js:2
        return opts.prompt.includes("x.js:1")
          ? { result: '{"reproduced": false, "confidence": 0.9}' }
          : { result: '{"reproduced": true, "confidence": 0.8}' };
      }
      const label = /a (\w+) code reviewer/.exec(opts.prompt)?.[1];
      return {
        result: JSON.stringify(
          label === "alpha"
            ? [
                {
                  path: "x.js",
                  line: 1,
                  severity: "High",
                  title: "bug",
                  body: "b",
                },
                {
                  path: "y.js",
                  line: 2,
                  severity: "Low",
                  title: "real",
                  body: "b",
                },
              ]
            : [],
        ),
      };
    });
    const res = await runMultiFinderReview(
      {
        verify: true,
        writeOut: () => {},
        writeErr: () => {},
        scope: "working",
      },
      { runAgentHeadless: run, dimensions },
    );
    // 2 finder calls + 2 verifier calls (deduped findings)
    expect(run).toHaveBeenCalledTimes(4);
    expect(res.report.summary.total).toBe(1); // x.js:1 refuted → dropped
    expect(res.report.findings[0].path).toBe("y.js");
    expect(res.verified).toBe(1);
  });
});

describe("resolveMultiVerify (effort auto-enable)", () => {
  it("stays single-pass for low/medium effort with no flags (byte-identical default)", () => {
    expect(resolveMultiVerify({ effort: "low" })).toEqual({
      multi: false,
      verify: false,
      auto: false,
    });
    expect(resolveMultiVerify({ effort: "medium" })).toEqual({
      multi: false,
      verify: false,
      auto: false,
    });
    expect(resolveMultiVerify({})).toEqual({
      multi: false,
      verify: false,
      auto: false,
    }); // unset effort → medium
  });

  it("auto-enables multi + verify at high effort with no flags", () => {
    expect(resolveMultiVerify({ effort: "high" })).toEqual({
      multi: true,
      verify: true,
      auto: true,
    });
  });

  it("--single forces single-pass even at high effort", () => {
    expect(resolveMultiVerify({ effort: "high", single: true })).toEqual({
      multi: false,
      verify: false,
      auto: false,
    });
  });

  it("explicit --multi at low effort enables multi but not verify, and is not 'auto'", () => {
    expect(resolveMultiVerify({ effort: "low", multi: true })).toEqual({
      multi: true,
      verify: false,
      auto: false,
    });
  });

  it("explicit --multi --verify at low effort enables both", () => {
    expect(
      resolveMultiVerify({ effort: "low", multi: true, verify: true }),
    ).toEqual({ multi: true, verify: true, auto: false });
  });

  it("--no-verify (verify:false) at high effort keeps multi, drops verify", () => {
    expect(resolveMultiVerify({ effort: "high", verify: false })).toEqual({
      multi: true,
      verify: false,
      auto: true,
    });
  });

  it("verify never survives without multi", () => {
    expect(resolveMultiVerify({ effort: "low", verify: true }).verify).toBe(
      false,
    );
  });
});
