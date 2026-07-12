import { describe, it, expect } from "vitest";
import {
  mcpServerOf,
  filterInheritedMcp,
  filterInheritedHooks,
} from "../../src/lib/subagent-inheritance.js";

describe("mcpServerOf", () => {
  it("extracts the server segment from a wire name", () => {
    expect(mcpServerOf("mcp__github__create_issue")).toBe("github");
    expect(mcpServerOf("mcp__fs__read")).toBe("fs");
  });

  it("handles a server-only name (no tool segment)", () => {
    expect(mcpServerOf("mcp__github")).toBe("github");
  });

  it("returns null for non-mcp names and junk", () => {
    expect(mcpServerOf("run_skill")).toBeNull();
    expect(mcpServerOf("")).toBeNull();
    expect(mcpServerOf(null)).toBeNull();
    expect(mcpServerOf("mcp__")).toBeNull();
  });
});

describe("filterInheritedMcp", () => {
  const parent = {
    extraToolDefinitions: [
      { type: "function", function: { name: "mcp__github__create_issue" } },
      { type: "function", function: { name: "mcp__fs__read" } },
    ],
    externalToolDescriptors: {
      mcp__github__create_issue: { serverName: "github" },
      mcp__fs__read: { serverName: "fs" },
    },
    externalToolExecutors: {
      mcp__github__create_issue: { kind: "mcp", serverName: "github" },
      mcp__fs__read: { kind: "mcp", serverName: "fs" },
    },
    mcpClient: { id: "client-1" },
  };

  it("returns null when allow is [] (inherit none — the default)", () => {
    expect(filterInheritedMcp(parent, [])).toBeNull();
  });

  it("inherits everything when allow is null", () => {
    const out = filterInheritedMcp(parent, null);
    expect(out.extraToolDefinitions).toHaveLength(2);
    expect(Object.keys(out.externalToolDescriptors)).toHaveLength(2);
    expect(Object.keys(out.externalToolExecutors)).toHaveLength(2);
    expect(out.mcpClient).toBe(parent.mcpClient);
  });

  it("subsets by server name when allow is a list", () => {
    const out = filterInheritedMcp(parent, ["github"]);
    expect(out.extraToolDefinitions).toHaveLength(1);
    expect(out.extraToolDefinitions[0].function.name).toBe(
      "mcp__github__create_issue",
    );
    expect(Object.keys(out.externalToolDescriptors)).toEqual([
      "mcp__github__create_issue",
    ]);
    expect(Object.keys(out.externalToolExecutors)).toEqual([
      "mcp__github__create_issue",
    ]);
  });

  it("returns null when the allow-list matches no server", () => {
    expect(filterInheritedMcp(parent, ["nonexistent"])).toBeNull();
  });

  it("falls back to the wire name when a descriptor lacks serverName", () => {
    const p = {
      extraToolDefinitions: [
        { type: "function", function: { name: "mcp__weather__now" } },
      ],
      externalToolDescriptors: { mcp__weather__now: {} },
      externalToolExecutors: { mcp__weather__now: {} },
    };
    const out = filterInheritedMcp(p, ["weather"]);
    expect(Object.keys(out.externalToolDescriptors)).toEqual([
      "mcp__weather__now",
    ]);
  });
});

describe("filterInheritedHooks", () => {
  const hooks = {
    PreToolUse: [
      { matcher: "Bash", hooks: [{ command: "echo bash" }] },
      { matcher: "", hooks: [{ command: "echo any" }] },
    ],
    PostToolUse: [{ matcher: "Write", hooks: [{ command: "echo write" }] }],
  };

  it("returns null when allow is [] (inherit none — the default)", () => {
    expect(filterInheritedHooks(hooks, [])).toBeNull();
  });

  it("returns the hooks object unchanged when allow is null", () => {
    expect(filterInheritedHooks(hooks, null)).toBe(hooks);
  });

  it("subsets groups by matcher, normalizing empty to '*'", () => {
    const out = filterInheritedHooks(hooks, ["Bash", "*"]);
    expect(out.PreToolUse).toHaveLength(2);
    expect(out.PostToolUse).toBeUndefined();
  });

  it("keeps only the matching event when a single matcher is allowed", () => {
    const out = filterInheritedHooks(hooks, ["Write"]);
    expect(out.PreToolUse).toBeUndefined();
    expect(out.PostToolUse).toHaveLength(1);
  });

  it("returns null when no group matches", () => {
    expect(filterInheritedHooks(hooks, ["Nope"])).toBeNull();
  });

  it("returns null for missing settingsHooks", () => {
    expect(filterInheritedHooks(null, null)).toBeNull();
    expect(filterInheritedHooks(undefined, ["Bash"])).toBeNull();
  });
});
