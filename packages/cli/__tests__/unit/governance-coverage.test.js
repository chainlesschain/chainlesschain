/**
 * Governance coverage metrics (P1-9 "覆盖率指标" of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md; §11.3 acceptance
 * targets). Pure module: no fs / clock / RNG. Verifies the two coverage metrics
 * — high-risk tool-call ledger/trace coverage and Plugin/MCP/Skill/Hook
 * provenance traceability — compose the ONE side-effect classifier and the
 * attribution records, and fail closed on any gap.
 */
import { describe, it, expect } from "vitest";
import {
  isHighRiskToolCall,
  computeSideEffectCoverage,
  computeProvenanceCoverage,
  computeGovernanceCoverage,
  summarizeGovernanceCoverage,
} from "../../src/lib/governance-coverage.js";

describe("isHighRiskToolCall", () => {
  it("mirrors classifyToolSideEffect: writes/shell/push/network are high-risk", () => {
    expect(
      isHighRiskToolCall({ tool: "write_file", args: { path: "a" } }),
    ).toBe(true);
    expect(
      isHighRiskToolCall({ tool: "run_shell", args: { command: "x" } }),
    ).toBe(true);
    expect(
      isHighRiskToolCall({ tool: "git", args: { command: "push origin" } }),
    ).toBe(true);
    expect(isHighRiskToolCall({ tool: "notify", args: { title: "hi" } })).toBe(
      true,
    );
  });

  it("read-only / locally-recoverable tools are not high-risk", () => {
    expect(isHighRiskToolCall({ tool: "read_file", args: { path: "a" } })).toBe(
      false,
    );
    expect(
      isHighRiskToolCall({ tool: "git", args: { command: "status" } }),
    ).toBe(false);
    expect(isHighRiskToolCall({ tool: "search_files", args: {} })).toBe(false);
  });
});

describe("computeSideEffectCoverage", () => {
  const CALLS = [
    { tool: "read_file", args: { path: "a" }, opId: "r1" }, // not high-risk
    { tool: "write_file", args: { path: "a" }, opId: "op1" }, // high-risk
    { tool: "run_shell", args: { command: "npm test" }, opId: "op2" }, // high-risk
    { tool: "git", args: { command: "push" }, opId: "op3" }, // high-risk
    { tool: "git", args: { command: "status" }, opId: "g1" }, // not high-risk
  ];

  it("100% covered when every high-risk call has a ledger entry + trace span", () => {
    const cov = computeSideEffectCoverage({
      toolCalls: CALLS,
      ledgerOpIds: ["op1", "op2", "op3"],
      tracedOpIds: ["op1", "op2", "op3"],
    });
    expect(cov.highRiskCount).toBe(3); // read_file + git status excluded
    expect(cov.ledgerCovered).toBe(3);
    expect(cov.traceCovered).toBe(3);
    expect(cov.ledgerCoverage).toBe(1);
    expect(cov.traceCoverage).toBe(1);
    expect(cov.uncoveredLedger).toEqual([]);
    expect(cov.ok).toBe(true);
  });

  it("flags a high-risk call missing a ledger entry (fail-closed, actionable)", () => {
    const cov = computeSideEffectCoverage({
      toolCalls: CALLS,
      ledgerOpIds: ["op1", "op3"], // op2 (shell) not recorded
      tracedOpIds: ["op1", "op2", "op3"],
    });
    expect(cov.ledgerCovered).toBe(2);
    expect(cov.ledgerCoverage).toBeCloseTo(2 / 3);
    expect(cov.uncoveredLedger).toEqual([
      { index: 2, tool: "run_shell", kind: "shell", opId: "op2" },
    ]);
    expect(cov.ok).toBe(false);
  });

  it("a high-risk call with no opId can never be covered", () => {
    const cov = computeSideEffectCoverage({
      toolCalls: [{ tool: "publish_artifact", args: { title: "t" } }],
      ledgerOpIds: [],
      tracedOpIds: [],
    });
    expect(cov.highRiskCount).toBe(1);
    expect(cov.uncoveredLedger[0]).toMatchObject({ tool: "publish_artifact" });
    expect(cov.ok).toBe(false);
  });

  it("no high-risk calls → vacuously fully covered", () => {
    const cov = computeSideEffectCoverage({
      toolCalls: [{ tool: "read_file", args: {}, opId: "r" }],
    });
    expect(cov.highRiskCount).toBe(0);
    expect(cov.ledgerCoverage).toBe(1);
    expect(cov.ok).toBe(true);
  });
});

describe("computeProvenanceCoverage", () => {
  it("fully traceable sourced calls → 100%", () => {
    const cov = computeProvenanceCoverage([
      {
        tool: "run_skill",
        source: "acme-skills",
        version: "1.2.0",
        scope: "project",
        tier: "extension",
        admitted: true,
      },
    ]);
    expect(cov.total).toBe(1);
    expect(cov.traceable).toBe(1);
    expect(cov.coverage).toBe(1);
    expect(cov.ok).toBe(true);
  });

  it("built-in mvp tool with no source is excluded from the denominator", () => {
    const cov = computeProvenanceCoverage([
      { tool: "read_file", tier: "mvp", admitted: true },
    ]);
    expect(cov.total).toBe(0);
    expect(cov.coverage).toBe(1);
    expect(cov.ok).toBe(true);
  });

  it("in-scope call missing version/scope/permission is untraceable, missing listed", () => {
    const cov = computeProvenanceCoverage([
      { tool: "run_skill", source: "acme", tier: "extension", admitted: true }, // no version/scope
      { tool: "mcp_x", tier: "extension" }, // no source/version/scope/permission
    ]);
    expect(cov.total).toBe(2);
    expect(cov.traceable).toBe(0);
    expect(cov.untraceable[0]).toMatchObject({
      tool: "run_skill",
      missing: ["version", "scope"],
    });
    expect(cov.untraceable[1].missing).toEqual([
      "source",
      "version",
      "scope",
      "permission",
    ]);
    expect(cov.ok).toBe(false);
  });
});

describe("computeGovernanceCoverage + summary", () => {
  it("ok only when BOTH metrics are 100%", () => {
    const good = computeGovernanceCoverage({
      toolCalls: [{ tool: "write_file", args: { path: "a" }, opId: "op1" }],
      ledgerOpIds: ["op1"],
      tracedOpIds: ["op1"],
      attributions: [
        {
          tool: "run_skill",
          source: "s",
          version: "1",
          scope: "project",
          admitted: true,
        },
      ],
    });
    expect(good.ok).toBe(true);
    expect(summarizeGovernanceCoverage(good)).toContain("OK");

    const bad = computeGovernanceCoverage({
      toolCalls: [{ tool: "write_file", args: { path: "a" }, opId: "op1" }],
      ledgerOpIds: [], // ledger gap
      tracedOpIds: ["op1"],
    });
    expect(bad.ok).toBe(false);
    expect(summarizeGovernanceCoverage(bad)).toContain("GAPS");
  });

  it("summary is token-free and reports percentages + counts", () => {
    const rep = computeGovernanceCoverage({
      toolCalls: [
        { tool: "write_file", args: { path: "a" }, opId: "op1" },
        { tool: "run_shell", args: { command: "x" }, opId: "op2" },
      ],
      ledgerOpIds: ["op1"], // 50% ledger
      tracedOpIds: ["op1", "op2"],
    });
    const s = summarizeGovernanceCoverage(rep);
    expect(s).toContain("ledger 50%");
    expect(s).toContain("trace 100%");
    expect(s).toContain("2 calls");
  });
});
