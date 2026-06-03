import { describe, it, expect } from "vitest";
import { extractUsage, aggregateUsage } from "../../src/lib/session-usage.js";

describe("session-usage", () => {
  describe("extractUsage", () => {
    it("reads a token_usage event", () => {
      const u = extractUsage({
        type: "token_usage",
        timestamp: 1,
        data: {
          provider: "anthropic",
          model: "claude-opus-4-6",
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      });
      expect(u).toEqual({
        provider: "anthropic",
        model: "claude-opus-4-6",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        timestamp: 1,
      });
    });

    it("reads usage embedded in assistant_message", () => {
      const u = extractUsage({
        type: "assistant_message",
        timestamp: 2,
        data: {
          content: "...",
          usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
          model: "gpt-4o",
        },
      });
      expect(u).toMatchObject({
        model: "gpt-4o",
        inputTokens: 40,
        outputTokens: 20,
        totalTokens: 60,
      });
    });

    it("returns null for events without usage", () => {
      expect(extractUsage({ type: "user_message", data: {} })).toBeNull();
      expect(
        extractUsage({ type: "assistant_message", data: { content: "hi" } }),
      ).toBeNull();
    });

    it("returns null for unknown event types", () => {
      expect(
        extractUsage({
          type: "tool_call",
          data: { usage: { input_tokens: 10 } },
        }),
      ).toBeNull();
    });

    it("returns null when all counts are zero", () => {
      expect(
        extractUsage({
          type: "token_usage",
          data: { usage: { input_tokens: 0, output_tokens: 0 } },
        }),
      ).toBeNull();
    });
  });

  describe("aggregateUsage", () => {
    it("rolls up total + per-model", () => {
      const agg = aggregateUsage([
        {
          type: "token_usage",
          data: {
            provider: "anthropic",
            model: "opus",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        },
        {
          type: "token_usage",
          data: {
            provider: "anthropic",
            model: "opus",
            usage: { input_tokens: 30, output_tokens: 10 },
          },
        },
        {
          type: "token_usage",
          data: {
            provider: "openai",
            model: "gpt-4o",
            usage: { input_tokens: 20, output_tokens: 5 },
          },
        },
      ]);
      expect(agg.total).toEqual({
        inputTokens: 150,
        outputTokens: 65,
        totalTokens: 215,
        calls: 3,
      });
      expect(agg.byModel).toHaveLength(2);
      expect(agg.byModel[0]).toMatchObject({
        provider: "anthropic",
        model: "opus",
        inputTokens: 130,
        outputTokens: 60,
        calls: 2,
      });
      expect(agg.byModel[1]).toMatchObject({
        provider: "openai",
        model: "gpt-4o",
        inputTokens: 20,
        outputTokens: 5,
        calls: 1,
      });
    });

    it("ignores events without usage", () => {
      const agg = aggregateUsage([
        { type: "user_message", data: { content: "hi" } },
        { type: "tool_call", data: { tool: "read_file", args: {} } },
      ]);
      expect(agg.total.calls).toBe(0);
      expect(agg.byModel).toEqual([]);
    });

    it("handles empty + nullish input", () => {
      expect(aggregateUsage([]).total.calls).toBe(0);
      expect(aggregateUsage(null).total.calls).toBe(0);
    });

    it("sorts byModel descending by totalTokens", () => {
      const agg = aggregateUsage([
        {
          type: "token_usage",
          data: {
            model: "small",
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        {
          type: "token_usage",
          data: {
            model: "big",
            usage: { input_tokens: 500, output_tokens: 500 },
          },
        },
      ]);
      expect(agg.byModel[0].model).toBe("big");
      expect(agg.byModel[1].model).toBe("small");
    });
  });
});
