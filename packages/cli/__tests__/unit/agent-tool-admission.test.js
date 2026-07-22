/**
 * Agent tool admission + attribution (P1-6 "Extension Tier 工具需经过 Capability、
 * Policy、权限、预算和 UI 支持检查后再开放" —
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md). Pure fail-closed
 * decision: no fs / clock / RNG.
 */
import { describe, it, expect } from "vitest";
import {
  TOOL_TIER,
  normalizeToolTier,
  admitTool,
  buildToolAttribution,
  describeToolAttribution,
  parseToolAdmissionConfig,
} from "../../src/lib/agent-tool-admission.js";

describe("parseToolAdmissionConfig", () => {
  it("keeps only bounded decision and provenance fields", () => {
    const parsed = parseToolAdmissionConfig(
      JSON.stringify({
        enforce: true,
        source: "vscode-extension",
        capabilityGranted: true,
        policyAllowed: true,
        permissionGranted: true,
        budgetOk: true,
        uiSupported: true,
        apiKey: "must-not-cross-the-boundary",
        prompt: "must-not-cross-the-boundary",
        tools: {
          publish_artifact: {
            policyAllowed: false,
            arguments: { token: "must-not-cross-the-boundary" },
          },
        },
      }),
    );

    expect(parsed).toEqual({
      enforce: true,
      source: "vscode-extension",
      capabilityGranted: true,
      policyAllowed: true,
      permissionGranted: true,
      budgetOk: true,
      uiSupported: true,
      tools: { publish_artifact: { policyAllowed: false } },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/apiKey|prompt|arguments|token/);
  });

  it("fails closed on malformed or ambiguous enforcement envelopes", () => {
    for (const input of [
      "not json",
      "[]",
      "{}",
      '{"enforce":false}',
      '{"enforce":true,"budgetOk":"yes"}',
      '{"enforce":true,"source":"host\\nforged"}',
      '{"enforce":true,"tools":{"bad name":{}}}',
      '{"enforce":true,"tools":{"__proto__":{}}}',
    ]) {
      expect(() => parseToolAdmissionConfig(input)).toThrow();
    }
  });

  it("bounds the environment contract size and tool count", () => {
    expect(() =>
      parseToolAdmissionConfig(
        JSON.stringify({ enforce: true, source: "x".repeat(32768) }),
      ),
    ).toThrow(/32 KiB/);

    const tools = Object.fromEntries(
      Array.from({ length: 257 }, (_, i) => [`tool_${i}`, {}]),
    );
    expect(() => parseToolAdmissionConfig({ enforce: true, tools })).toThrow(
      /256 entries/,
    );
  });
});

describe("normalizeToolTier", () => {
  it("maps baseline labels to MVP and everything else to EXTENSION", () => {
    expect(normalizeToolTier("mvp")).toBe(TOOL_TIER.MVP);
    expect(normalizeToolTier("core")).toBe(TOOL_TIER.MVP);
    expect(normalizeToolTier("extension")).toBe(TOOL_TIER.EXTENSION);
    expect(normalizeToolTier("mystery")).toBe(TOOL_TIER.EXTENSION); // fail-closed
    expect(normalizeToolTier(undefined)).toBe(TOOL_TIER.EXTENSION);
  });
});

const grantedExtension = {
  tool: "run_skill",
  tier: "extension",
  capabilityGranted: true,
  policyAllowed: true,
  permissionGranted: true,
  budgetOk: true,
  uiSupported: true,
};

describe("admitTool — extension tier five gates", () => {
  it("admits only when all five gates pass", () => {
    expect(admitTool(grantedExtension)).toEqual({
      admitted: true,
      unmet: [],
      reason: "ok",
      tier: TOOL_TIER.EXTENSION,
    });
  });

  it("denies on each missing gate with a named reason", () => {
    expect(
      admitTool({ ...grantedExtension, capabilityGranted: false }).unmet,
    ).toContain("capability-not-granted");
    expect(
      admitTool({ ...grantedExtension, policyAllowed: false }).unmet,
    ).toContain("policy-blocked");
    expect(
      admitTool({ ...grantedExtension, permissionGranted: false }).unmet,
    ).toContain("permission-not-granted");
    expect(admitTool({ ...grantedExtension, budgetOk: false }).unmet).toContain(
      "budget-exhausted",
    );
    expect(
      admitTool({ ...grantedExtension, uiSupported: false }).unmet,
    ).toContain("ui-unsupported");
  });

  it("collects EVERY unmet gate, not just the first", () => {
    const d = admitTool({ tool: "browser", tier: "extension" });
    expect(d.admitted).toBe(false);
    expect(d.unmet.length).toBe(5);
  });

  it("treats an unknown tier as extension (fail-closed)", () => {
    const d = admitTool({
      tool: "x",
      tier: "weird",
      policyAllowed: true,
      budgetOk: true,
    });
    expect(d.tier).toBe(TOOL_TIER.EXTENSION);
    expect(d.admitted).toBe(false); // still needs capability/permission/ui
  });
});

describe("admitTool — MVP tier gates only policy + budget", () => {
  it("admits a built-in with just policy + budget, ignoring capability/ui", () => {
    const d = admitTool({
      tool: "read_file",
      tier: "mvp",
      policyAllowed: true,
      budgetOk: true,
    });
    expect(d.admitted).toBe(true);
  });
  it("still blocks a built-in on policy or budget", () => {
    expect(
      admitTool({ tier: "mvp", policyAllowed: false, budgetOk: true }).unmet,
    ).toEqual(["policy-blocked"]);
    expect(
      admitTool({ tier: "mvp", policyAllowed: true, budgetOk: false }).unmet,
    ).toEqual(["budget-exhausted"]);
  });
});

describe("buildToolAttribution", () => {
  it("carries source/version/scope/tier + decision, never args", () => {
    const decision = admitTool(grantedExtension);
    const attr = buildToolAttribution({
      tool: "run_skill",
      source: "acme-skills",
      version: "1.2.0",
      scope: "project",
      callId: "tc-1",
      decision,
    });
    expect(attr).toEqual({
      tool: "run_skill",
      source: "acme-skills",
      version: "1.2.0",
      scope: "project",
      tier: TOOL_TIER.EXTENSION,
      callId: "tc-1",
      admitted: true,
      reason: "ok",
      unmet: [],
    });
  });

  it("reflects a denial with its unmet gates", () => {
    const decision = admitTool({ tool: "browser", tier: "extension" });
    const attr = buildToolAttribution({ tool: "browser", decision });
    expect(attr.admitted).toBe(false);
    expect(attr.unmet.length).toBe(5);
  });
});

describe("describeToolAttribution", () => {
  it("renders a token-free one-liner for admitted and denied", () => {
    const okAttr = buildToolAttribution({
      tool: "run_skill",
      source: "acme-skills",
      version: "1.2.0",
      scope: "project",
      decision: admitTool(grantedExtension),
    });
    const line = describeToolAttribution(okAttr);
    expect(line).toContain("run_skill");
    expect(line).toContain("acme-skills@1.2.0");
    expect(line).toContain("admitted");

    const denied = describeToolAttribution(
      buildToolAttribution({
        tool: "browser",
        decision: admitTool({ tool: "browser", tier: "extension" }),
      }),
    );
    expect(denied).toMatch(/denied\(/);
  });
});
