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
