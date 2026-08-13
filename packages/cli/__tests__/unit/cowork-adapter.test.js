import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChatFn, coworkLogger } from "../../src/lib/cowork-adapter.js";

describe("cowork-adapter", () => {
  // ─── createChatFn ─────────────────────────────────────

  describe("createChatFn", () => {
    it("returns a function", () => {
      const chat = createChatFn({ provider: "ollama" });
      expect(typeof chat).toBe("function");
    });

    it("defaults to ollama provider", () => {
      const chat = createChatFn();
      expect(typeof chat).toBe("function");
    });

    it("creates chat function for openai provider", () => {
      const chat = createChatFn({ provider: "openai", apiKey: "test-key" });
      expect(typeof chat).toBe("function");
    });

    it("creates chat function for anthropic provider", () => {
      const chat = createChatFn({ provider: "anthropic", apiKey: "test-key" });
      expect(typeof chat).toBe("function");
    });

    it("ollama chat sends correct request", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: "Hello!" } }),
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      try {
        const chat = createChatFn({
          provider: "ollama",
          baseUrl: "http://localhost:11434",
        });
        const result = await chat([{ role: "user", content: "Hi" }]);
        expect(result).toBe("Hello!");

        expect(globalThis.fetch).toHaveBeenCalledWith(
          "http://localhost:11434/api/chat",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }),
        );

        // Verify the body has correct structure
        const callBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(callBody.messages).toEqual([{ role: "user", content: "Hi" }]);
        expect(callBody.stream).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("ollama chat throws on non-ok response", async () => {
      const mockResponse = { ok: false, status: 500 };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      try {
        const chat = createChatFn({ provider: "ollama" });
        await expect(chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
          "Ollama error: 500",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("anthropic chat sends correct headers", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ content: [{ text: "Hi from Claude" }] }),
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      try {
        const chat = createChatFn({
          provider: "anthropic",
          apiKey: "test-key-123",
        });
        const result = await chat([{ role: "user", content: "Hello" }]);
        expect(result).toBe("Hi from Claude");

        const callHeaders = globalThis.fetch.mock.calls[0][1].headers;
        expect(callHeaders["x-api-key"]).toBe("test-key-123");
        expect(callHeaders["anthropic-version"]).toBe("2023-06-01");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("anthropic chat extracts system messages", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ content: [{ text: "OK" }] }),
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      try {
        const chat = createChatFn({ provider: "anthropic", apiKey: "key" });
        await chat([
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hi" },
        ]);

        const callBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(callBody.system).toBe("You are helpful");
        expect(callBody.messages).toEqual([{ role: "user", content: "Hi" }]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("openai-compatible chat sends correct Authorization header", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hi from OpenAI" } }],
        }),
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      try {
        const chat = createChatFn({ provider: "openai", apiKey: "sk-test" });
        const result = await chat([{ role: "user", content: "Hi" }]);
        expect(result).toBe("Hi from OpenAI");

        const callHeaders = globalThis.fetch.mock.calls[0][1].headers;
        expect(callHeaders["Authorization"]).toBe("Bearer sk-test");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("wraps the complete provider call before fetch and preserves OpenAI usage privately", async () => {
      const originalFetch = globalThis.fetch;
      const order = [];
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        order.push("fetch");
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "metered answer" } }],
            usage: {
              prompt_tokens: 11,
              completion_tokens: 4,
              prompt_tokens_details: { cached_tokens: 3 },
            },
          }),
        };
      });
      const envelopes = [];

      try {
        const chat = createChatFn({
          provider: "openai",
          model: "gpt-test",
          apiKey: "sk-test",
          callWrapper: async ({ call, provider, model }) => {
            order.push("started");
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expect({ provider, model }).toEqual({
              provider: "openai",
              model: "gpt-test",
            });
            const envelope = await call();
            envelopes.push(envelope);
            order.push("settled");
            return envelope;
          },
        });

        await expect(chat([{ role: "user", content: "Hi" }])).resolves.toBe(
          "metered answer",
        );
        expect(order).toEqual(["started", "fetch", "settled"]);
        expect(envelopes).toEqual([
          {
            content: "metered answer",
            usage: {
              input_tokens: 8,
              output_tokens: 4,
              cache_read_input_tokens: 3,
              cache_creation_input_tokens: 0,
            },
          },
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it.each([
      [
        "ollama",
        { message: { content: "local" }, prompt_eval_count: 6, eval_count: 2 },
        { input_tokens: 6, output_tokens: 2 },
      ],
      [
        "anthropic",
        {
          content: [{ text: "claude" }],
          usage: { input_tokens: 9, output_tokens: 3 },
        },
        { input_tokens: 9, output_tokens: 3 },
      ],
    ])(
      "maps %s provider usage into the private wrapper envelope",
      async (provider, payload, expected) => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => payload,
        });
        let envelope;
        try {
          const chat = createChatFn({
            provider,
            apiKey: "test-key",
            callWrapper: async ({ call }) => {
              envelope = await call();
              return envelope;
            },
          });
          await chat([{ role: "user", content: "Hi" }]);
          expect(envelope.usage).toMatchObject(expected);
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );

    it.each([
      [{ message: { content: "partial" }, prompt_eval_count: 6 }],
      [{ message: { content: "partial" }, eval_count: 2 }],
    ])(
      "does not manufacture known Ollama usage from a partial counter set",
      async (payload) => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => payload,
        });
        let envelope;
        try {
          const chat = createChatFn({
            provider: "ollama",
            callWrapper: async ({ call }) => {
              envelope = await call();
              return envelope;
            },
          });
          await expect(chat([{ role: "user", content: "Hi" }])).resolves.toBe(
            "partial",
          );
          expect(envelope).toEqual({ content: "partial" });
        } finally {
          globalThis.fetch = originalFetch;
        }
      },
    );

    it("maps DeepSeek prompt cache hits without double-counting input", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "cached answer" } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 5,
            prompt_cache_hit_tokens: 80,
          },
        }),
      });
      let envelope;
      try {
        const chat = createChatFn({
          provider: "deepseek",
          apiKey: "test-key",
          callWrapper: async ({ call }) => {
            envelope = await call();
            return envelope;
          },
        });
        await expect(chat([{ role: "user", content: "Hi" }])).resolves.toBe(
          "cached answer",
        );
        expect(envelope.usage).toEqual({
          input_tokens: 20,
          output_tokens: 5,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 0,
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects a non-function provider call wrapper before use", () => {
      expect(() =>
        createChatFn({ provider: "ollama", callWrapper: true }),
      ).toThrow("cowork callWrapper must be a function");
    });

    it("respects maxTokens option", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ message: { content: "OK" } }),
      };
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

      try {
        const chat = createChatFn({ provider: "ollama" });
        await chat([{ role: "user", content: "Hi" }], { maxTokens: 500 });

        const callBody = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(callBody.options.num_predict).toBe(500);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ─── coworkLogger ─────────────────────────────────────

  describe("coworkLogger", () => {
    it("has info, warn, error, debug methods", () => {
      expect(typeof coworkLogger.info).toBe("function");
      expect(typeof coworkLogger.warn).toBe("function");
      expect(typeof coworkLogger.error).toBe("function");
      expect(typeof coworkLogger.debug).toBe("function");
    });

    it("info logs without throwing", () => {
      expect(() => coworkLogger.info("test message")).not.toThrow();
    });

    it("debug is a no-op", () => {
      expect(() => coworkLogger.debug("silent")).not.toThrow();
    });
  });
});
