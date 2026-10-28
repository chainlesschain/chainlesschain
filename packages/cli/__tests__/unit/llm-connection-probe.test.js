import { describe, expect, it, vi } from "vitest";
import {
  probeLlmConnection,
  normalizeLlmProbeUsage,
  priceLlmProbeUsage,
} from "../../src/lib/llm-connection-probe.js";

const target = {
  provider: "volcengine",
  model: "deepseek-v4-flash-ga-260731",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "test-only-key",
};

describe("catalog-selected OpenAI Responses probes", () => {
  const native = {
    provider: "openai",
    model: "gpt-6.1-sol",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "test-only-key",
  };
  const response = {
    status: "completed",
    output: [
      { type: "message", content: [{ type: "output_text", text: "Hi" }] },
    ],
    usage: {
      input_tokens: 20,
      output_tokens: 8,
      input_tokens_details: { cached_tokens: 5 },
      output_tokens_details: { reasoning_tokens: 6 },
    },
  };

  it("uses the existing Responses codec and retains billed reasoning/cache usage", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("https://api.openai.com/v1/responses");
      expect(options.headers.Authorization).toBe("Bearer test-only-key");
      expect(JSON.parse(options.body)).toMatchObject({
        model: native.model,
        max_output_tokens: 1024,
        store: false,
      });
      expect(JSON.parse(options.body)).not.toHaveProperty("max_tokens");
      return { ok: true, json: async () => response };
    });
    const result = await probeLlmConnection(native, {
      fetchImpl,
      includeUsage: true,
    });
    expect(result).toMatchObject({
      ok: true,
      reply: "Hi",
      usage: {
        input_tokens: 15,
        output_tokens: 8,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 0,
      },
      billingVerified: false,
    });
    expect(result.totalCostUsd).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    {},
    {
      input_tokens: 1,
      output_tokens: 2,
      input_tokens_details: { cached_tokens: 3 },
    },
    ...[5, null, "0", false].map((cache_write_tokens) => ({
      input_tokens: 20,
      output_tokens: 8,
      input_tokens_details: { cache_write_tokens },
    })),
  ])(
    "keeps missing or unsupported usage unknown instead of reporting a free test",
    async (usage) => {
      const result = await probeLlmConnection(native, {
        includeUsage: true,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ ...response, usage }),
        }),
      });
      if (usage?.input_tokens_details?.cache_write_tokens === 5) {
        expect(result.usage).toMatchObject({
          input_tokens: 15,
          cache_creation_input_tokens: 5,
          cacheCreationInvalid: true,
        });
      } else expect(result.usage).toBeNull();
      expect(result.totalCostUsd).toBeNull();
    },
  );

  it("keeps billed usage when an incomplete response has no trustworthy final answer", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...response,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }),
    }));
    const failure = await probeLlmConnection(native, {
      fetchImpl,
      includeUsage: true,
    }).catch((error) => error);
    expect(failure.message).toContain("exhausted the test output limit");
    expect(failure.probe).toMatchObject({
      ok: false,
      usage: { input_tokens: 15, output_tokens: 8 },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not apply official Responses support to a custom gateway", async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe("https://relay.example/v1/chat/completions");
      expect(JSON.parse(options.body)).toHaveProperty("messages");
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "gateway reply" } }],
        }),
      };
    });
    await expect(
      probeLlmConnection(
        { ...native, baseUrl: "https://relay.example/v1" },
        { fetchImpl },
      ),
    ).resolves.toBe("gateway reply");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps HTTP-200 provider errors private and retains reported usage", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ...response,
        error: { code: native.apiKey, message: "private reasoning" },
      }),
    }));
    const failure = await probeLlmConnection(native, {
      fetchImpl,
      includeUsage: true,
    }).catch((error) => error);
    expect(failure.message).toBe(
      "The Responses endpoint did not complete the connection test",
    );
    expect(failure.message).not.toContain(native.apiKey);
    expect(failure.probe).toMatchObject({
      ok: false,
      usage: { input_tokens: 15, output_tokens: 8 },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("reasoning model connection probes", () => {
  it("redacts a provider-echoed credential before truncating error details", async () => {
    const apiKey = "test-only-sensitive-" + "x".repeat(80);
    const error = await probeLlmConnection(
      { ...target, apiKey },
      {
        includeUsage: true,
        fetchImpl: async () => ({
          ok: false,
          status: 403,
          text: async () =>
            JSON.stringify({ error: { message: "x".repeat(390) + apiKey } }),
        }),
      },
    ).catch((error) => error);
    expect(error.message).not.toContain("test-only-");
    expect(error.probe).toMatchObject({
      ok: false,
      usage: null,
      totalCostUsd: null,
    });
  });
  it("redacts an echoed credential before truncating a probe reply", async () => {
    const apiKey = "test-only-" + "x".repeat(150);
    const receipt = await probeLlmConnection(
      { ...target, apiKey },
      {
        includeUsage: true,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: `${apiKey} Hi` } }],
          }),
        }),
      },
    );
    expect(receipt.reply).toBe("[REDACTED] Hi");
    expect(JSON.stringify(receipt)).not.toContain("test-only-");
  });
  it("retains billed reasoning and cached prompt usage without printing either raw payload or credentials", async () => {
    const receipt = await probeLlmConnection(target, {
      includeUsage: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "Hi",
                reasoning_content: "private reasoning",
              },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 35,
            prompt_tokens_details: { cached_tokens: 5 },
            extra: target.apiKey,
          },
        }),
      }),
    });
    expect(receipt).toMatchObject({
      ok: true,
      reply: "Hi",
      currency: "USD",
      costBasis: "token-estimate",
      billingVerified: false,
      usage: {
        input_tokens: 15,
        output_tokens: 35,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 0,
      },
    });
    expect(receipt.totalCostUsd).toBeCloseTo(
      (15 * 0.14 + 5 * 0.14 * 0.1 + 35 * 0.28) / 1e6,
      14,
    );
    expect(JSON.stringify(receipt)).not.toContain(target.apiKey);
    expect(JSON.stringify(receipt)).not.toContain("private reasoning");
  });

  it.each([
    undefined,
    {},
    { prompt_tokens: "20", completion_tokens: 1 },
    {
      prompt_tokens: 5,
      completion_tokens: 1,
      prompt_tokens_details: { cached_tokens: 6 },
    },
    { prompt_tokens: 5, completion_tokens: -1 },
    { prompt_tokens: 5, completion_tokens: 1, prompt_cache_hit_tokens: -1 },
    {
      prompt_tokens: 5,
      completion_tokens: 1,
      prompt_tokens_details: { cached_tokens: 1 },
      prompt_cache_hit_tokens: 2,
    },
  ])("keeps absent or invalid provider usage unknown", async (usage) => {
    const receipt = await probeLlmConnection(target, {
      includeUsage: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hi" } }],
          usage,
        }),
      }),
    });
    expect(receipt).toMatchObject({
      ok: true,
      usage: null,
      totalCostUsd: null,
    });
  });

  it("retains usage even when billed reasoning exhausts the final answer allowance", async () => {
    const error = await probeLlmConnection(target, {
      includeUsage: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: "length", message: { content: "" } }],
          usage: { prompt_tokens: 5, completion_tokens: 1024 },
        }),
      }),
    }).catch((error) => error);
    expect(error.message).toContain("exhausted");
    expect(error.probe).toMatchObject({
      ok: false,
      reply: null,
      usage: { input_tokens: 5, output_tokens: 1024 },
    });
    expect(error.probe.totalCostUsd).toBeGreaterThan(0);
  });

  it.each([
    [
      "anthropic",
      {
        usage: {
          input_tokens: 3,
          output_tokens: 2,
          cache_read_input_tokens: 4,
          cache_creation_input_tokens: 5,
        },
      },
      [3, 2, 4, 5],
    ],
    ["ollama", { prompt_eval_count: 3, eval_count: 2 }, [3, 2, 0, 0]],
    [
      "gemini",
      {
        usageMetadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 5,
          cachedContentTokenCount: 4,
        },
      },
      [3, 7, 4, 0],
    ],
    [
      "deepseek",
      {
        usage: {
          prompt_tokens: 7,
          completion_tokens: 2,
          prompt_cache_hit_tokens: 4,
        },
      },
      [3, 2, 4, 0],
    ],
  ])(
    "normalizes %s usage without counting cached inputs twice",
    (provider, payload, counts) => {
      expect(Object.values(normalizeLlmProbeUsage(provider, payload))).toEqual(
        counts,
      );
    },
  );

  it("keeps an unknown model price unknown even with complete usage", () => {
    expect(
      priceLlmProbeUsage(
        { provider: "custom", model: "unknown" },
        {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      ),
    ).toBeNull();
  });
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
