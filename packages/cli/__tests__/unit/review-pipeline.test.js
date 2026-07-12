/**
 * Multi-agent review pipeline (P2) — normalize, dedup+merge, verifier verdicts,
 * confidence filter, rank, and structured report. Pure module.
 */
import { describe, it, expect } from "vitest";
import {
  REVIEW_DIMENSIONS,
  normalizeSeverity,
  severityRank,
  clampConfidence,
  findingKey,
  dedupeFindings,
  applyVerdicts,
  filterByConfidence,
  rankFindings,
  buildReviewReport,
} from "../../src/lib/review-pipeline.js";

describe("severity + confidence helpers", () => {
  it("normalizes and ranks severities", () => {
    expect(normalizeSeverity("critical")).toBe("Critical");
    expect(normalizeSeverity("bogus")).toBe("Note");
    expect(severityRank("High")).toBeGreaterThan(severityRank("Low"));
  });
  it("clamps confidence to [0,1]", () => {
    expect(clampConfidence(1.5)).toBe(1);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence("x", 0.3)).toBe(0.3);
  });
  it("exposes the four finder dimensions", () => {
    expect(REVIEW_DIMENSIONS).toEqual([
      "correctness",
      "security",
      "performance",
      "tests",
    ]);
  });
});

describe("dedupeFindings", () => {
  it("is shape-preserving for a plain finding with no duplicates", () => {
    const input = [
      { path: "a.js", line: 3, severity: "High", title: "bug", body: "fix" },
    ];
    expect(dedupeFindings(input)).toEqual(input); // unchanged (parseFindings relies on this)
  });

  it("merges same path:line:title, keeping the highest severity", () => {
    const out = dedupeFindings([
      {
        path: "a.js",
        line: 3,
        severity: "Low",
        title: "SQL injection",
        body: "x",
      },
      {
        path: "a.js",
        line: 3,
        severity: "Critical",
        title: "sql injection",
        body: "y",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("Critical");
    expect(out[0].mergedCount).toBe(2);
  });

  it("unions categories/dimensions across finders (cross-dimension merge)", () => {
    const out = dedupeFindings([
      {
        path: "a.js",
        line: 3,
        severity: "High",
        title: "leak",
        category: "security",
        dimension: "security",
      },
      {
        path: "a.js",
        line: 3,
        severity: "High",
        title: "leak",
        category: "correctness",
        dimension: "correctness",
      },
    ]);
    expect(out[0].categories.sort()).toEqual(["correctness", "security"]);
    expect(out[0].dimensions.sort()).toEqual(["correctness", "security"]);
  });

  it("keeps distinct issues at the same location separate", () => {
    const out = dedupeFindings([
      { path: "a.js", line: 3, severity: "High", title: "off-by-one" },
      { path: "a.js", line: 3, severity: "Low", title: "unused var" },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("findingKey", () => {
  it("is location + issue based and case/space-insensitive on the title", () => {
    expect(findingKey({ path: "a", line: 1, title: "Foo  Bar" })).toBe(
      findingKey({ path: "a", line: 1, title: "foo bar" }),
    );
  });
});

describe("applyVerdicts (verifier reproduction)", () => {
  const findings = [
    {
      path: "a.js",
      line: 1,
      severity: "High",
      title: "real bug",
      confidence: 0.5,
    },
    {
      path: "b.js",
      line: 2,
      severity: "High",
      title: "false positive",
      confidence: 0.5,
    },
  ];
  it("drops refuted findings and boosts reproduced ones", () => {
    const verdicts = {
      [findingKey(findings[0])]: {
        verified: true,
        confidence: 0.95,
        note: "reproduced",
      },
      [findingKey(findings[1])]: { verified: false },
    };
    const out = applyVerdicts(findings, verdicts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      verified: true,
      confidence: 0.95,
      verifierNote: "reproduced",
    });
  });
  it("passes through findings with no verdict (unverified)", () => {
    expect(applyVerdicts(findings, {})).toHaveLength(2);
  });
});

describe("filterByConfidence + rankFindings", () => {
  it("filters below the threshold", () => {
    const out = filterByConfidence([{ confidence: 0.9 }, { confidence: 0.2 }], {
      minConfidence: 0.5,
    });
    expect(out).toHaveLength(1);
  });
  it("ranks by severity then confidence", () => {
    const out = rankFindings([
      { path: "a", line: 1, severity: "Low", confidence: 0.9 },
      { path: "b", line: 2, severity: "Critical", confidence: 0.3 },
      { path: "c", line: 3, severity: "Critical", confidence: 0.9 },
    ]);
    expect(out.map((f) => f.path)).toEqual(["c", "b", "a"]);
  });
});

describe("buildReviewReport (structured output)", () => {
  it("produces path/line/category/severity/failure_scenario/evidence + rollups", () => {
    const raw = [
      {
        path: "a.js",
        line: 10,
        severity: "Critical",
        title: "sqli",
        category: "security",
        failureScenario: "user input → query",
        evidence: "line 10",
        confidence: 0.9,
      },
      {
        path: "a.js",
        line: 10,
        severity: "High",
        title: "sqli",
        category: "correctness",
        confidence: 0.7,
      }, // dup → merges
      {
        path: "b.js",
        line: 4,
        severity: "Low",
        title: "nit",
        category: "performance",
        confidence: 0.6,
      },
    ];
    const report = buildReviewReport(raw, { minConfidence: 0.5 });
    expect(report.summary.total).toBe(2);
    expect(report.summary.bySeverity.Critical).toBe(1);
    const top = report.findings[0];
    expect(top).toMatchObject({
      path: "a.js",
      line: 10,
      severity: "Critical",
      failure_scenario: "user input → query",
      evidence: "line 10",
    });
    expect(top.confidence).toBe(0.9);
  });

  it("drops findings the verifier refuted before ranking", () => {
    const raw = [
      { path: "x", line: 1, severity: "High", title: "maybe", confidence: 0.8 },
    ];
    const verdicts = { [findingKey(raw[0])]: { verified: false } };
    expect(buildReviewReport(raw, { verdicts }).summary.total).toBe(0);
  });
});
