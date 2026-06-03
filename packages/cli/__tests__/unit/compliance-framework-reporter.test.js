/**
 * Tests for src/lib/compliance-framework-reporter.js —
 * framework catalogs, gap analysis, and MD/HTML/JSON rendering.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  FRAMEWORK_TEMPLATES,
  analyzeCoverage,
  renderMarkdown,
  renderHTML,
  renderJSON,
  generateFrameworkReport,
  getFrameworkTemplate,
  listFrameworks,
  registerFrameworkTemplate,
  unregisterFrameworkTemplate,
  _resetState,
} from "../../src/lib/compliance-framework-reporter.js";

describe("compliance-framework-reporter", () => {
  beforeEach(() => {
    _resetState();
  });

  // ── Static catalogs ─────────────────────────────────────────

  describe("FRAMEWORK_TEMPLATES", () => {
    it("is frozen", () => {
      expect(Object.isFrozen(FRAMEWORK_TEMPLATES)).toBe(true);
    });

    it("ships SOC 2, ISO 27001, and GDPR templates", () => {
      expect(FRAMEWORK_TEMPLATES.soc2).toBeDefined();
      expect(FRAMEWORK_TEMPLATES.iso27001).toBeDefined();
      expect(FRAMEWORK_TEMPLATES.gdpr).toBeDefined();
    });

    it("every control has id/title/category/requires", () => {
      for (const tpl of Object.values(FRAMEWORK_TEMPLATES)) {
        for (const c of tpl.controls) {
          expect(c.id).toBeTruthy();
          expect(c.title).toBeTruthy();
          expect(c.category).toBeTruthy();
          expect(c.requires).toBeDefined();
        }
      }
    });
  });

  describe("getFrameworkTemplate / listFrameworks", () => {
    it("returns a registered template", () => {
      expect(getFrameworkTemplate("soc2").name).toBe("SOC 2");
    });

    it("returns null for unknown framework", () => {
      expect(getFrameworkTemplate("hipaa-mini")).toBeNull();
    });

    it("lists all known frameworks", () => {
      const ids = listFrameworks();
      expect(ids).toContain("soc2");
      expect(ids).toContain("iso27001");
      expect(ids).toContain("gdpr");
    });

    it("registerFrameworkTemplate adds a custom template", () => {
      registerFrameworkTemplate("custom1", {
        id: "custom1",
        name: "Custom",
        version: "1.0",
        controls: [
          {
            id: "C1",
            title: "Test",
            category: "Misc",
            requires: { evidenceTypes: ["t"], policyTypes: [] },
            description: "",
          },
        ],
      });
      expect(getFrameworkTemplate("custom1")).toBeTruthy();
      expect(listFrameworks()).toContain("custom1");
    });

    it("unregisterFrameworkTemplate removes it", () => {
      registerFrameworkTemplate("custom2", {
        controls: [
          { id: "X", title: "x", category: "c", requires: {}, description: "" },
        ],
      });
      expect(unregisterFrameworkTemplate("custom2")).toBe(true);
      expect(getFrameworkTemplate("custom2")).toBeNull();
    });

    it("throws when template is malformed", () => {
      expect(() => registerFrameworkTemplate("", {})).toThrow();
      expect(() => registerFrameworkTemplate("a", null)).toThrow();
      expect(() =>
        registerFrameworkTemplate("a", { controls: "not-array" }),
      ).toThrow();
    });
  });

  // ── analyzeCoverage ─────────────────────────────────────────

  describe("analyzeCoverage", () => {
    it("throws for unknown framework", () => {
      expect(() => analyzeCoverage("unknown")).toThrow(/Unknown framework/);
    });

    it("reports all gaps with no evidence or policies", () => {
      const report = analyzeCoverage("soc2", { evidence: [], policies: [] });
      expect(report.counts.gap).toBeGreaterThan(0);
      expect(report.counts.covered).toBe(0);
      expect(report.score).toBe(0);
      expect(report.total).toBe(FRAMEWORK_TEMPLATES.soc2.controls.length);
    });

    it("marks a control covered when evidence + policy match", () => {
      const report = analyzeCoverage("soc2", {
        evidence: [{ type: "auth_log" }, { type: "mfa_config" }],
        policies: [{ type: "access_control" }],
      });
      const cc61 = report.controls.find((c) => c.id === "CC6.1");
      expect(cc61.status).toBe("covered");
    });

    it("marks partial when only evidence or only policy present", () => {
      // CC6.1 requires access_control policy + auth_log/mfa_config evidence
      const report = analyzeCoverage("soc2", {
        evidence: [{ type: "auth_log" }],
        policies: [],
      });
      const cc61 = report.controls.find((c) => c.id === "CC6.1");
      expect(cc61.status).toBe("partial");
    });

    it("counts evidence + policy matches per control", () => {
      const report = analyzeCoverage("soc2", {
        evidence: [
          { type: "auth_log", id: "e1" },
          { type: "auth_log", id: "e2" },
          { type: "mfa_config", id: "e3" },
        ],
        policies: [{ type: "access_control", id: "p1" }],
      });
      const cc61 = report.controls.find((c) => c.id === "CC6.1");
      expect(cc61.matchedEvidence.length).toBe(3);
      expect(cc61.matchedPolicies.length).toBe(1);
    });

    it("computes a weighted score (partial = 0.5)", () => {
      // Custom 2-control framework for predictable scoring.
      registerFrameworkTemplate("test2", {
        id: "test2",
        name: "Test",
        version: "1.0",
        controls: [
          {
            id: "A",
            title: "a",
            category: "c",
            requires: { evidenceTypes: ["x"], policyTypes: ["y"] },
            description: "",
          },
          {
            id: "B",
            title: "b",
            category: "c",
            requires: { evidenceTypes: ["z"], policyTypes: ["unmatched"] },
            description: "",
          },
        ],
      });
      // A: evidence x + policy y → covered.
      // B: evidence z present but no policy "unmatched" → partial.
      // Score = (1 + 0.5) / 2 = 0.75 → 75
      const report = analyzeCoverage("test2", {
        evidence: [{ type: "x" }, { type: "z" }],
        policies: [{ type: "y" }],
      });
      expect(report.controls.find((c) => c.id === "A").status).toBe("covered");
      expect(report.controls.find((c) => c.id === "B").status).toBe("partial");
      expect(report.score).toBe(75);
    });

    it("includes a machine-readable summary string", () => {
      const report = analyzeCoverage("soc2");
      expect(report.summary).toMatch(/controls covered/);
    });

    it("sets framework metadata on the result", () => {
      const report = analyzeCoverage("gdpr");
      expect(report.framework).toBe("gdpr");
      expect(report.frameworkName).toBe("GDPR");
      expect(report.version).toMatch(/2016\/679/);
      expect(report.generatedAt).toBeDefined();
    });
  });

  // ── Renderers ───────────────────────────────────────────────

  describe("renderMarkdown", () => {
    it("includes framework header and score line", () => {
      const report = analyzeCoverage("soc2");
      const md = renderMarkdown(report);
      expect(md).toContain("# SOC 2 Compliance Report");
      expect(md).toContain("**Score:**");
      expect(md).toContain("**Summary:**");
    });

    it("renders a control row per control", () => {
      const report = analyzeCoverage("soc2");
      const md = renderMarkdown(report);
      for (const c of FRAMEWORK_TEMPLATES.soc2.controls) {
        expect(md).toContain(c.id);
      }
    });

    it("emits a Remediation section when gaps exist", () => {
      const report = analyzeCoverage("soc2");
      const md = renderMarkdown(report);
      expect(md).toContain("## Remediation");
    });

    it("lists missing evidence + policy types in remediation", () => {
      const report = analyzeCoverage("soc2", { evidence: [], policies: [] });
      const md = renderMarkdown(report);
      expect(md).toMatch(/Missing evidence:/);
      expect(md).toMatch(/Missing policies:/);
    });

    it("skips Remediation when everything is covered", () => {
      registerFrameworkTemplate("free", {
        id: "free",
        name: "Free",
        version: "1",
        controls: [
          {
            id: "F1",
            title: "f",
            category: "c",
            requires: { evidenceTypes: [], policyTypes: [] },
            description: "",
          },
        ],
      });
      const report = analyzeCoverage("free");
      const md = renderMarkdown(report);
      expect(md).not.toContain("## Remediation");
    });
  });

  describe("renderHTML", () => {
    it("produces a standalone HTML document", () => {
      const report = analyzeCoverage("gdpr");
      const html = renderHTML(report);
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("<title>GDPR Compliance Report</title>");
      expect(html).toContain("<table>");
    });

    it("escapes HTML special characters in content", () => {
      registerFrameworkTemplate("xss", {
        id: "xss",
        name: "<script>alert(1)</script>",
        version: "v&1",
        controls: [
          {
            id: "X",
            title: "<b>bold</b>",
            category: "a",
            requires: {},
            description: "",
          },
        ],
      });
      const html = renderHTML(analyzeCoverage("xss"));
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).toContain("v&amp;1");
      expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    });

    it("tags rows with status class for styling", () => {
      const report = analyzeCoverage("soc2");
      const html = renderHTML(report);
      expect(html).toMatch(/class="status-gap"/);
    });
  });

  describe("renderJSON", () => {
    it("returns valid JSON that round-trips", () => {
      const report = analyzeCoverage("iso27001");
      const json = renderJSON(report);
      const parsed = JSON.parse(json);
      expect(parsed.framework).toBe("iso27001");
      expect(Array.isArray(parsed.controls)).toBe(true);
    });
  });

  // ── generateFrameworkReport ─────────────────────────────────

  describe("generateFrameworkReport", () => {
    it("defaults to markdown", () => {
      const { format, body } = generateFrameworkReport("soc2");
      expect(format).toBe("markdown");
      expect(body).toContain("# SOC 2");
    });

    it("accepts md alias", () => {
      const { body } = generateFrameworkReport("soc2", { format: "md" });
      expect(body).toContain("# SOC 2");
    });

    it("renders html when requested", () => {
      const { body } = generateFrameworkReport("soc2", { format: "html" });
      expect(body.startsWith("<!doctype html>")).toBe(true);
    });

    it("renders json when requested", () => {
      const { body } = generateFrameworkReport("soc2", { format: "json" });
      expect(() => JSON.parse(body)).not.toThrow();
    });

    it("rejects unknown formats", () => {
      expect(() => generateFrameworkReport("soc2", { format: "pdf" })).toThrow(
        /Unknown format/,
      );
    });

    it("passes through evidence + policies into analysis", () => {
      const { analysis } = generateFrameworkReport("soc2", {
        evidence: [{ type: "auth_log" }],
        policies: [{ type: "access_control" }],
      });
      expect(analysis.counts.covered).toBeGreaterThan(0);
    });
  });
});
