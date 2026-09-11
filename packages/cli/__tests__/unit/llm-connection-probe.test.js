import { describe, expect, it, vi } from "vitest";
import { probeLlmConnection } from "../../src/lib/llm-connection-probe.js";

const target = {
  provider: "volcengine",
  model: "deepseek-v4-flash-ga-260731",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "test-only-key",
};

describe("reasoning model connection probes", () => {
  it("allows a reasoning model to finish before judging the configured connection", async () => {
    const original = structuredClone(target);
    const fetchImpl = vi.fn(async (url, options) => {
      const request = JSON.parse(options.body);
      // Reproduce the reported Ark response: a tiny allowance is consumed by
      // reasoning, leaving an empty answer despite a successful HTTP request.
      const truncated = request.max_tokens < 34;
      expect(request.max_tokens).toBeLessThanOrEqual(1024);
      expect(request).not.toHaveProperty("thinking");
      expect(url).toBe(`${target.baseUrl}/chat/completions`);
      expect(options.headers.Authorization).toBe(`Bearer ${target.apiKey}`);
      expect(request.model).toBe(target.model);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: truncated ? "length" : "stop",
              message: {
                content: truncated ? "" : "Hi",
                reasoning_content: "private reasoning",
              },
            },
          ],
        }),
      };
    });
    await expect(probeLlmConnection(target, { fetchImpl })).resolves.toBe("Hi");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(target).toEqual(original);
  });

  it.each([
    [
      "openai",
      {
        choices: [
          {
            finish_reason: "length",
            message: { content: "", reasoning_content: "private reasoning" },
          },
        ],
      },
    ],
    [
      "volcengine",
      {
        choices: [
          {
            finish_reason: "length",
            message: { content: null, reasoning_content: "private reasoning" },
          },
        ],
      },
    ],
    [
      "anthropic",
      {
        stop_reason: "max_tokens",
        content: [{ type: "thinking", thinking: "private reasoning" }],
      },
    ],
    [
      "gemini",
      { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [] } }] },
    ],
    [
      "ollama",
      { done_reason: "length", response: "", thinking: "private reasoning" },
    ],
  ])(
    "distinguishes %s output exhaustion from bad connection settings",
    async (provider, payload) => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        json: async () => payload,
      }));
      const result = await probeLlmConnection(
        { ...target, provider },
        { fetchImpl },
      ).catch((error) => error);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toContain("exhausted the test output limit");
      expect(result.message).not.toContain("private reasoning");
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([{}, { choices: [] }, { choices: [{ message: { content: "" } }] }])(
    "still rejects a malformed or empty successful HTTP response",
    async (payload) => {
      await expect(
        probeLlmConnection(target, {
          fetchImpl: async () => ({ ok: true, json: async () => payload }),
        }),
      ).rejects.toThrow("no model text");
    },
  );

  it("does not print reasoning as if it were a final answer", async () => {
    await expect(
      probeLlmConnection(target, {
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            choices: [
              {
                finish_reason: "stop",
                message: { reasoning_content: "private reasoning" },
              },
            ],
          }),
        }),
      }),
    ).rejects.toThrow("no model text");
  });

  it("keeps the timeout active while reading a stalled response body", async () => {
    const fetchImpl = vi.fn(async (url, { signal }) => ({
      ok: true,
      json: () =>
        new Promise((resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ),
    }));
    await expect(
      probeLlmConnection(target, { fetchImpl, timeoutMs: 10 }),
    ).rejects.toThrow("timed out");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reads Gemini's final answer without exposing its thought parts", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(JSON.parse(options.body).generationConfig.maxOutputTokens).toBe(
        1024,
      );
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: "private reasoning" },
                  { text: "Hi" },
                ],
              },
            },
          ],
        }),
      };
    });
    await expect(
      probeLlmConnection({ ...target, provider: "gemini" }, { fetchImpl }),
    ).resolves.toBe("Hi");
  });
});
