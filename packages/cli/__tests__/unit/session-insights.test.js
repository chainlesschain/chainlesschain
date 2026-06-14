/**
 * Unit tests for session insights analysis (src/lib/session-insights.js).
 * Pure — drives analyzeSession with synthetic JSONL event arrays.
 */
import { describe, it, expect } from "vitest";
import {
  analyzeSession,
  formatDuration,
} from "../../src/lib/session-insights.js";

describe("formatDuration", () => {
  it("formats seconds / minutes / hours", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_660_000)).toBe("1h 1m");
  });
});

describe("analyzeSession", () => {
  const T0 = 1_700_000_000_000;
  const evts = [
    {
      type: "session_start",
      timestamp: T0,
      data: { title: "fix avg", model: "claude-opus", provider: "anthropic" },
    },
    { type: "user_message", timestamp: T0 + 1000, data: { content: "hi" } },
    {
      type: "tool_call",
      timestamp: T0 + 2000,
      data: { tool: "read_file", args: {} },
    },
    {
      type: "tool_result",
      timestamp: T0 + 2500,
      data: { tool: "read_file", result: { ok: true } },
    },
    {
      type: "tool_call",
      timestamp: T0 + 3000,
      data: { tool: "run_shell", args: {} },
    },
    {
      type: "tool_result",
      timestamp: T0 + 3500,
      data: { tool: "run_shell", result: { error: "boom" } },
    },
    {
      type: "token_usage",
      timestamp: T0 + 4000,
      data: {
        provider: "anthropic",
        model: "claude-opus",
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    },
    {
      type: "assistant_message",
      timestamp: T0 + 5000,
      data: { content: "done" },
    },
    { type: "compact", timestamp: T0 + 5500, data: { saved: 10 } },
  ];

  it("computes meta, duration and counts", () => {
    const r = analyzeSession(evts, "sess-1");
    expect(r.sessionId).toBe("sess-1");
    expect(r.meta.title).toBe("fix avg");
    expect(r.meta.model).toBe("claude-opus");
    expect(r.meta.provider).toBe("anthropic");
    expect(r.meta.durationMs).toBe(5500);
    expect(r.events).toBe(evts.length);
    expect(r.messages).toEqual({ user: 1, assistant: 1, total: 2 });
    expect(r.compactions).toBe(1);
  });

  it("breaks down tool calls and errors", () => {
    const r = analyzeSession(evts, "s");
    expect(r.tools.calls).toBe(2);
    expect(r.tools.errors).toBe(1);
    const shell = r.tools.byTool.find((t) => t.tool === "run_shell");
    expect(shell).toEqual({ tool: "run_shell", count: 1, errors: 1 });
    const read = r.tools.byTool.find((t) => t.tool === "read_file");
    expect(read.errors).toBe(0);
  });

  it("aggregates token usage", () => {
    const r = analyzeSession(evts, "s");
    expect(r.usage.total.totalTokens).toBe(1500);
    expect(r.usage.total.calls).toBe(1);
  });

  it("handles an empty / unknown session gracefully", () => {
    const r = analyzeSession([], null);
    expect(r.events).toBe(0);
    expect(r.meta.durationMs).toBe(0);
    expect(r.meta.model).toBeNull();
    expect(r.messages.total).toBe(0);
    expect(r.tools.calls).toBe(0);
    expect(r.usage.total.totalTokens).toBe(0);
  });

  it("falls back to usage model when no session_start", () => {
    const r = analyzeSession(
      [
        {
          type: "token_usage",
          timestamp: T0,
          data: {
            provider: "openai",
            model: "gpt-5",
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      ],
      "s",
    );
    expect(r.meta.model).toBe("gpt-5");
    expect(r.meta.provider).toBe("openai");
  });

  it("backfills usage model/provider from session_start (headless sessions)", () => {
    // Headless persists token_usage WITHOUT provider/model; session_start has it.
    const r = analyzeSession(
      [
        {
          type: "session_start",
          timestamp: T0,
          data: { model: "claude-sonnet", provider: "anthropic" },
        },
        {
          type: "token_usage",
          timestamp: T0 + 1,
          data: { input_tokens: 100, output_tokens: 50 },
        },
      ],
      "s",
    );
    expect(r.usage.byModel).toHaveLength(1);
    expect(r.usage.byModel[0].provider).toBe("anthropic");
    expect(r.usage.byModel[0].model).toBe("claude-sonnet");
  });

  it("detects is_error variants on tool results", () => {
    const r = analyzeSession(
      [
        { type: "tool_call", timestamp: 1, data: { tool: "x" } },
        { type: "tool_result", timestamp: 2, data: { tool: "x", result: { is_error: true } } },
        { type: "tool_call", timestamp: 3, data: { tool: "y" } },
        { type: "tool_result", timestamp: 4, data: { tool: "y", error: "nope" } },
      ],
      "s",
    );
    expect(r.tools.errors).toBe(2);
  });
});
