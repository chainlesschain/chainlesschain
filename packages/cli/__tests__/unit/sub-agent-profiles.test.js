import { describe, it, expect, beforeEach } from "vitest";
import {
  getSubAgentProfile,
  listSubAgentProfiles,
  registerSubAgentProfile,
  unregisterSubAgentProfile,
  resetToBuiltins,
  buildSubagentSummaryLines,
} from "../../src/lib/sub-agent-profiles.js";

describe("sub-agent-profiles — built-ins", () => {
  beforeEach(() => resetToBuiltins());

  it("ships 3 built-in profiles", () => {
    const all = listSubAgentProfiles();
    expect(all.map((p) => p.name).sort()).toEqual([
      "design",
      "executor",
      "explorer",
    ]);
  });

  it("explorer is read-only (no write/execute tools)", () => {
    const p = getSubAgentProfile("explorer");
    expect(p.toolAllowlist).not.toContain("write_file");
    expect(p.toolAllowlist).not.toContain("edit_file");
    expect(p.toolAllowlist).not.toContain("run_shell");
    expect(p.toolAllowlist).toContain("read_file");
    expect(p.toolAllowlist).toContain("search_files");
  });

  it("executor has full tool access", () => {
    const p = getSubAgentProfile("executor");
    expect(p.toolAllowlist).toContain("write_file");
    expect(p.toolAllowlist).toContain("run_shell");
    expect(p.toolAllowlist).toContain("git");
    expect(p.toolAllowlist).toContain("edit_file_hashed");
  });

  it("design has write access but no shell/git", () => {
    const p = getSubAgentProfile("design");
    expect(p.toolAllowlist).toContain("write_file");
    expect(p.toolAllowlist).not.toContain("run_shell");
    expect(p.toolAllowlist).not.toContain("git");
  });

  it("each built-in has shortDescription + systemPrompt + modelHint", () => {
    for (const name of ["explorer", "executor", "design"]) {
      const p = getSubAgentProfile(name);
      expect(p.shortDescription.length).toBeGreaterThan(0);
      expect(p.systemPrompt.length).toBeGreaterThan(0);
      expect(p.modelHint).toBeDefined();
      expect(typeof p.maxIterations).toBe("number");
    }
  });

  it("getSubAgentProfile returns null for unknown name", () => {
    expect(getSubAgentProfile("nonexistent")).toBeNull();
    expect(getSubAgentProfile("")).toBeNull();
    expect(getSubAgentProfile(null)).toBeNull();
  });

  it("returns deep copies (mutation safe)", () => {
    const p1 = getSubAgentProfile("explorer");
    p1.toolAllowlist.push("run_shell");
    const p2 = getSubAgentProfile("explorer");
    expect(p2.toolAllowlist).not.toContain("run_shell");
  });
});

describe("sub-agent-profiles — custom registration", () => {
  beforeEach(() => resetToBuiltins());

  it("registers a valid custom profile", () => {
    const ok = registerSubAgentProfile({
      name: "linter",
      shortDescription: "Lints only",
      systemPrompt: "You lint code.",
      toolAllowlist: ["read_file", "search_files"],
      maxIterations: 10,
    });
    expect(ok).toBe(true);
    expect(getSubAgentProfile("linter").maxIterations).toBe(10);
  });

  it("rejects invalid profiles", () => {
    expect(registerSubAgentProfile(null)).toBe(false);
    expect(registerSubAgentProfile({})).toBe(false);
    expect(registerSubAgentProfile({ name: "x" })).toBe(false);
    expect(
      registerSubAgentProfile({
        name: "x",
        shortDescription: "d",
      }),
    ).toBe(false);
  });

  it("allows overriding a built-in profile", () => {
    registerSubAgentProfile({
      name: "explorer",
      shortDescription: "Overridden",
      systemPrompt: "Overridden prompt",
      toolAllowlist: ["read_file"],
    });
    expect(getSubAgentProfile("explorer").shortDescription).toBe("Overridden");
  });

  it("unregister removes a profile", () => {
    registerSubAgentProfile({
      name: "temp",
      shortDescription: "x",
      systemPrompt: "y",
    });
    expect(unregisterSubAgentProfile("temp")).toBe(true);
    expect(getSubAgentProfile("temp")).toBeNull();
  });

  it("resetToBuiltins clears custom profiles", () => {
    registerSubAgentProfile({
      name: "custom",
      shortDescription: "x",
      systemPrompt: "y",
    });
    resetToBuiltins();
    expect(getSubAgentProfile("custom")).toBeNull();
    expect(listSubAgentProfiles()).toHaveLength(3);
  });
});

describe("sub-agent-profiles — buildSubagentSummaryLines", () => {
  beforeEach(() => resetToBuiltins());

  it("produces a heading + one bullet per profile", () => {
    const text = buildSubagentSummaryLines();
    expect(text).toMatch(/## Available sub-agents/);
    expect(text).toMatch(/- \*\*explorer\*\*/);
    expect(text).toMatch(/- \*\*executor\*\*/);
    expect(text).toMatch(/- \*\*design\*\*/);
  });

  it("reflects custom-registered profiles", () => {
    registerSubAgentProfile({
      name: "linter",
      shortDescription: "Lints only",
      systemPrompt: "x",
    });
    expect(buildSubagentSummaryLines()).toMatch(/- \*\*linter\*\*: Lints only/);
  });
});
