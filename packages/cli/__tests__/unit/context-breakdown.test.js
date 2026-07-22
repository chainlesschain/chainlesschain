/**
 * Unit tests for context-breakdown.js — the pure per-source token attribution
 * behind `cc context --sources`. Deterministic 1-token-per-char estimator; the
 * real CJK-aware one lives in prompt-compressor and is tested there.
 */

import { describe, it, expect } from "vitest";
import {
  relativizeInstructionPath,
  breakdownInstructionSources,
  breakdownMcpSchemas,
  rankContextSources,
} from "../../src/lib/context-breakdown.js";

const est = (s) => (s ? s.length : 0);

describe("relativizeInstructionPath", () => {
  it("relativizes a file inside cwd with forward slashes", () => {
    const cwd = "/repo";
    expect(relativizeInstructionPath("/repo/pkg/cc.md", cwd)).toBe("pkg/cc.md");
  });

  it("keeps an absolute path when the file is outside cwd", () => {
    expect(
      relativizeInstructionPath("/home/u/.claude/CLAUDE.md", "/repo"),
    ).toBe("/home/u/.claude/CLAUDE.md");
  });

  it("is null-safe and cwd-optional", () => {
    expect(relativizeInstructionPath("", "/repo")).toBe("");
    expect(relativizeInstructionPath("/a/b.md")).toBe("/a/b.md");
  });
});

describe("breakdownInstructionSources", () => {
  it("attributes tokens per instruction file with scope + display path", () => {
    const files = [
      { path: "/repo/cc.md", scope: "project", content: "hello world" }, // 11
      { path: "/repo/pkg/CLAUDE.md", scope: "project", content: "abc" }, // 3
      { path: "/home/u/CLAUDE.local.md", scope: "local", content: "xy" }, // 2
    ];
    const { sources, total } = breakdownInstructionSources(files, est, "/repo");
    expect(total).toBe(16);
    expect(sources[0]).toMatchObject({
      scope: "project",
      source: "cc.md",
      tokens: 11,
      truncated: false,
    });
    expect(sources[1].source).toBe("pkg/CLAUDE.md");
    expect(sources[2]).toMatchObject({
      scope: "local",
      source: "/home/u/CLAUDE.local.md", // outside cwd → absolute
      tokens: 2,
    });
  });

  it("carries the truncated flag and tolerates missing content", () => {
    const files = [
      {
        path: "/repo/big.md",
        scope: "import",
        content: "data",
        truncated: true,
      },
      { path: "/repo/empty.md", scope: "project" }, // no content → 0
    ];
    const { sources, total } = breakdownInstructionSources(files, est, "/repo");
    expect(sources[0].truncated).toBe(true);
    expect(sources[1].tokens).toBe(0);
    expect(total).toBe(4);
  });

  it("returns an empty report for no files / non-array", () => {
    expect(breakdownInstructionSources([], est, "/repo")).toEqual({
      sources: [],
      total: 0,
    });
    expect(breakdownInstructionSources(null, est, "/repo").total).toBe(0);
  });
});

describe("rankContextSources", () => {
  it("attributes MCP schema tokens by server/tool source", () => {
    const mcp = breakdownMcpSchemas([
      { function: { name: "mcp__github__issues", description: "List issues", parameters: { type: "object" } } },
    ], est);
    expect(mcp.sources[0]).toMatchObject({ source: "github", tool: "mcp__github__issues" });
    expect(mcp.total).toBeGreaterThan(0);
    expect(rankContextSources({ extraSources: mcp.sources.map((s) => ({ ...s, kind: "mcp_schema" })) }).sources[0]).toMatchObject({ kind: "mcp_schema" });
  });

  it("merges instruction total + message buckets, ranked by tokens desc", () => {
    const { sources, total } = rankContextSources({
      instructionTotal: 100,
      buckets: { system: 0, user: 40, assistant: 60, tool: 10, toolCalls: 5 },
      counts: { system: 0, user: 2, assistant: 3, tool: 1 },
    });
    expect(total).toBe(215);
    // instructions (100) largest, then assistant (60), user (40), tool (10), toolCalls (5)
    expect(sources.map((s) => s.source)).toEqual([
      "project memory (instructions)",
      "assistant messages",
      "user messages",
      "tool results",
      "tool calls",
    ]);
    expect(sources[0]).toMatchObject({ kind: "instructions", tokens: 100 });
    // shares sum to ~1 and are correct
    expect(sources[0].share).toBeCloseTo(100 / 215, 6);
    const sum = sources.reduce((a, s) => a + s.share, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("omits zero-token sources and the instruction group when absent", () => {
    const { sources, total } = rankContextSources({
      instructionTotal: 0,
      buckets: { user: 5, assistant: 0, tool: 0, toolCalls: 0 },
      counts: { user: 1 },
    });
    expect(total).toBe(5);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: "message",
      source: "user messages",
      count: 1,
      share: 1,
    });
  });

  it("tags tool calls with the tool_calls kind", () => {
    const { sources } = rankContextSources({
      buckets: { toolCalls: 7 },
    });
    expect(sources[0]).toMatchObject({ kind: "tool_calls", tokens: 7 });
  });

  it("is defined-safe with no args", () => {
    expect(rankContextSources()).toEqual({ sources: [], total: 0 });
  });
});
