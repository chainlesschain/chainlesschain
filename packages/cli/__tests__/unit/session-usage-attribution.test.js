/**
 * Usage attribution (用量归因) — session-usage.js additions.
 *
 * Covers: extractUsage/extractAttribution attribution passthrough (and the
 * guarantee that LEGACY events produce byte-identical records — no
 * `attribution` key), aggregateUsageAttribution origin/skill/subagent
 * roll-ups over MIXED old+new transcripts, aggregateToolCalls (compact +
 * legacy tool event shapes, MCP server bucketing, turn-associated tokens),
 * and the sessionUsage/allSessionsUsage `attribution` section.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  extractUsage,
  extractAttribution,
  aggregateUsage,
  aggregateUsageAttribution,
  aggregateToolCalls,
  sessionAttribution,
  mcpServerOf,
  sessionUsage,
  allSessionsUsage,
  _deps,
} from "../../src/lib/session-usage.js";

const legacyUsage = (model, input, output) => ({
  type: "token_usage",
  data: { model, usage: { input_tokens: input, output_tokens: output } },
});

const attributedUsage = (model, input, output, attribution) => ({
  type: "token_usage",
  data: {
    provider: "anthropic",
    model,
    usage: { input_tokens: input, output_tokens: output },
    attribution,
  },
});

describe("extractAttribution", () => {
  it("returns a normalized frame from event.data.attribution", () => {
    const a = extractAttribution({
      type: "token_usage",
      data: {
        usage: { input_tokens: 1 },
        attribution: {
          origin: "subagent",
          subagentId: "sub-1",
          role: "researcher",
          parentSessionId: "sess-9",
          depth: 1,
          junk: "dropped",
        },
      },
    });
    expect(a).toEqual({
      origin: "subagent",
      subagentId: "sub-1",
      role: "researcher",
      parentSessionId: "sess-9",
      depth: 1,
    });
  });

  it("returns null for legacy events / malformed frames", () => {
    expect(extractAttribution(legacyUsage("m", 1, 1))).toBeNull();
    expect(
      extractAttribution({ type: "token_usage", data: { attribution: "x" } }),
    ).toBeNull();
    expect(
      extractAttribution({ type: "token_usage", data: { attribution: {} } }),
    ).toBeNull(); // no origin → not an attribution frame
    expect(extractAttribution(null)).toBeNull();
  });
});

describe("extractUsage attribution passthrough", () => {
  it("legacy events produce records WITHOUT an attribution key (byte-compat)", () => {
    const u = extractUsage(legacyUsage("opus", 10, 5));
    expect("attribution" in u).toBe(false);
  });

  it("attributed events carry the frame", () => {
    const u = extractUsage(
      attributedUsage("opus", 10, 5, { origin: "skill", skill: "pdf-report" }),
    );
    expect(u.attribution).toEqual({ origin: "skill", skill: "pdf-report" });
    expect(u.inputTokens).toBe(10);
  });
});

describe("aggregateUsageAttribution (mixed old + new events)", () => {
  const mixed = [
    { type: "user_message", data: { content: "go" } },
    legacyUsage("opus", 100, 50), // pre-attribution transcript line → main
    attributedUsage("opus", 30, 10, {
      origin: "subagent",
      subagentId: "sub-1",
      role: "researcher",
      depth: 1,
    }),
    attributedUsage("haiku", 7, 3, {
      origin: "skill",
      skill: "csv-clean",
      subagentId: "sub-2",
      depth: 1,
    }),
    attributedUsage("opus", 5, 5, {
      origin: "subagent",
      subagentId: "sub-1",
      role: "researcher",
      depth: 1,
    }),
  ];

  it("buckets untagged usage as main and splits subagent/skill", () => {
    const a = aggregateUsageAttribution(mixed);
    const byOrigin = Object.fromEntries(a.byOrigin.map((r) => [r.origin, r]));
    expect(byOrigin.main).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      calls: 1,
    });
    expect(byOrigin.subagent).toMatchObject({
      inputTokens: 35,
      outputTokens: 15,
      calls: 2,
    });
    expect(byOrigin.skill).toMatchObject({
      inputTokens: 7,
      outputTokens: 3,
      calls: 1,
    });
  });

  it("bySkill keys on the skill name; bySubagent keys on subagentId with role", () => {
    const a = aggregateUsageAttribution(mixed);
    expect(a.bySkill).toEqual([
      expect.objectContaining({ skill: "csv-clean", totalTokens: 10 }),
    ]);
    const sub1 = a.bySubagent.find((r) => r.subagentId === "sub-1");
    expect(sub1).toMatchObject({
      role: "researcher",
      origin: "subagent",
      totalTokens: 50,
      calls: 2,
    });
    // the isolated skill's sub-agent id also gets a row (origin skill)
    expect(a.bySubagent.find((r) => r.subagentId === "sub-2")).toMatchObject({
      origin: "skill",
      totalTokens: 10,
    });
  });

  it("a purely legacy transcript aggregates to a single main row equal to aggregateUsage", () => {
    const legacy = [legacyUsage("opus", 100, 50), legacyUsage("opus", 30, 10)];
    const a = aggregateUsageAttribution(legacy);
    const plain = aggregateUsage(legacy);
    expect(a.byOrigin).toHaveLength(1);
    expect(a.byOrigin[0]).toMatchObject({
      origin: "main",
      inputTokens: plain.total.inputTokens,
      outputTokens: plain.total.outputTokens,
      totalTokens: plain.total.totalTokens,
      calls: plain.total.calls,
    });
    expect(a.bySkill).toEqual([]);
    expect(a.bySubagent).toEqual([]);
  });
});

describe("mcpServerOf", () => {
  it("extracts the server segment of mcp__<server>__<tool>", () => {
    expect(mcpServerOf("mcp__github__search_issues")).toBe("github");
    expect(mcpServerOf("mcp__fs__read")).toBe("fs");
  });
  it("returns null for non-MCP names / malformed", () => {
    expect(mcpServerOf("read_file")).toBeNull();
    expect(mcpServerOf("mcp__")).toBeNull();
    expect(mcpServerOf("mcp____tool")).toBeNull(); // empty server segment
    expect(mcpServerOf(null)).toBeNull();
  });
});

describe("aggregateToolCalls", () => {
  const compactCall = (tool, isError = false, extra = {}) => ({
    type: "tool_call",
    data: { tool, is_error: isError, ...extra },
  });

  it("counts compact tool_call events + errors and buckets MCP servers", () => {
    const r = aggregateToolCalls([
      { type: "user_message", data: { content: "go" } },
      compactCall("read_file"),
      compactCall("read_file", true),
      compactCall("mcp__github__search_issues"),
      compactCall("mcp__github__get_pr", true),
      compactCall("mcp__fs__read"),
    ]);
    expect(r.totalCalls).toBe(5);
    expect(r.totalErrors).toBe(2);
    const read = r.byTool.find((t) => t.tool === "read_file");
    expect(read).toMatchObject({ calls: 2, errors: 1, mcpServer: null });
    const gh = r.byMcpServer.find((s) => s.server === "github");
    expect(gh).toMatchObject({ calls: 2, errors: 1 });
    expect(r.byMcpServer.find((s) => s.server === "fs")).toMatchObject({
      calls: 1,
      errors: 0,
    });
  });

  it("legacy tool_call{args} + tool_result pairs: calls from tool_call, errors from tool_result (no double count)", () => {
    const r = aggregateToolCalls([
      {
        type: "tool_call",
        data: { tool: "run_shell", args: { command: "x" } },
      },
      {
        type: "tool_result",
        data: { tool: "run_shell", result: { error: "boom" } },
      },
      {
        type: "tool_call",
        data: { tool: "run_shell", args: { command: "y" } },
      },
      { type: "tool_result", data: { tool: "run_shell", result: { ok: 1 } } },
    ]);
    expect(r.totalCalls).toBe(2);
    expect(r.totalErrors).toBe(1);
    expect(r.byTool[0]).toMatchObject({
      tool: "run_shell",
      calls: 2,
      errors: 1,
    });
  });

  it("associates turn tokens with every tool used in the turn (user_message boundaries)", () => {
    const r = aggregateToolCalls([
      // turn 1: read_file + MCP github, 150 tokens
      { type: "user_message", data: { content: "t1" } },
      compactCall("read_file"),
      compactCall("mcp__github__search_issues"),
      legacyUsage("opus", 100, 50),
      // turn 2: read_file only, 30 tokens
      { type: "user_message", data: { content: "t2" } },
      compactCall("read_file"),
      legacyUsage("opus", 20, 10),
    ]);
    expect(r.byTool.find((t) => t.tool === "read_file").turnTokens).toBe(180);
    expect(
      r.byTool.find((t) => t.tool === "mcp__github__search_issues").turnTokens,
    ).toBe(150);
    expect(r.byMcpServer.find((s) => s.server === "github").turnTokens).toBe(
      150,
    );
  });

  it("headless shape: one aggregate usage event after all tool_calls in a single turn", () => {
    const r = aggregateToolCalls([
      { type: "user_message", data: { content: "go" } },
      compactCall("run_skill", false, { skill: "csv-clean" }),
      compactCall("write_file"),
      // headless end-of-run aggregate (no provider/model)
      { type: "token_usage", data: { input_tokens: 500, output_tokens: 100 } },
    ]);
    expect(r.byTool.find((t) => t.tool === "run_skill").turnTokens).toBe(600);
    expect(r.byTool.find((t) => t.tool === "write_file").turnTokens).toBe(600);
  });

  it("transcripts without tool events aggregate to zeros", () => {
    const r = aggregateToolCalls([
      { type: "user_message", data: { content: "hi" } },
      legacyUsage("opus", 10, 5),
    ]);
    expect(r.totalCalls).toBe(0);
    expect(r.totalErrors).toBe(0);
    expect(r.byTool).toEqual([]);
    expect(r.byMcpServer).toEqual([]);
  });

  it("handles empty + nullish input", () => {
    expect(aggregateToolCalls([]).totalCalls).toBe(0);
    expect(aggregateToolCalls(null).totalCalls).toBe(0);
  });
});

describe("sessionUsage / allSessionsUsage attribution section", () => {
  const origReadEvents = _deps.readEvents;
  const origListSessions = _deps.listJsonlSessions;
  afterEach(() => {
    _deps.readEvents = origReadEvents;
    _deps.listJsonlSessions = origListSessions;
  });

  const sessionEvents = [
    { type: "user_message", data: { content: "go" } },
    { type: "tool_call", data: { tool: "mcp__jira__create", is_error: false } },
    legacyUsage("opus", 100, 50),
    attributedUsage("opus", 30, 10, {
      origin: "subagent",
      subagentId: "sub-1",
      depth: 1,
    }),
  ];

  it("sessionUsage keeps total/byModel semantics and adds attribution", () => {
    _deps.readEvents = () => sessionEvents;
    const r = sessionUsage("s1");
    // pre-attribution keys unchanged: total counts EVERY usage event
    expect(r.total.calls).toBe(2);
    expect(r.total.totalTokens).toBe(190);
    // additive attribution section
    const byOrigin = Object.fromEntries(
      r.attribution.byOrigin.map((x) => [x.origin, x]),
    );
    expect(byOrigin.main.totalTokens).toBe(150);
    expect(byOrigin.subagent.totalTokens).toBe(40);
    expect(r.attribution.tools.totalCalls).toBe(1);
    expect(r.attribution.tools.byMcpServer[0]).toMatchObject({
      server: "jira",
      calls: 1,
    });
  });

  it("allSessionsUsage merges attribution across sessions", () => {
    _deps.listJsonlSessions = () => [{ id: "a" }, { id: "b" }];
    _deps.readEvents = () => sessionEvents;
    const r = allSessionsUsage();
    expect(r.total.calls).toBe(4);
    const byOrigin = Object.fromEntries(
      r.attribution.byOrigin.map((x) => [x.origin, x]),
    );
    expect(byOrigin.main).toMatchObject({ totalTokens: 300, calls: 2 });
    expect(byOrigin.subagent).toMatchObject({ totalTokens: 80, calls: 2 });
    expect(r.attribution.bySubagent[0]).toMatchObject({
      subagentId: "sub-1",
      totalTokens: 80,
      calls: 2,
    });
    expect(r.attribution.tools.totalCalls).toBe(2);
    expect(r.attribution.tools.byMcpServer[0]).toMatchObject({
      server: "jira",
      calls: 2,
    });
  });

  it("sessionAttribution over a legacy transcript is all-main / zero tools", () => {
    const a = sessionAttribution([
      legacyUsage("opus", 10, 5),
      { type: "assistant_message", data: { content: "ok" } },
    ]);
    expect(a.byOrigin).toEqual([expect.objectContaining({ origin: "main" })]);
    expect(a.tools.totalCalls).toBe(0);
  });
});
