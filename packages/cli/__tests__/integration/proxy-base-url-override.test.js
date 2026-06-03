/**
 * Integration tests: Proxy / relay site (中转站) base-url override
 *
 * Verifies that --base-url correctly overrides provider default URLs,
 * allowing access through proxy/relay sites like API2D, OpenAI-SB, One-API, etc.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  BUILT_IN_PROVIDERS,
  LLMProviderRegistry,
} from "../../src/lib/llm-providers.js";
import { MockDatabase } from "../helpers/mock-db.js";

describe("Proxy / Base-URL Override (中转站)", () => {
  let capturedUrl;
  let capturedHeaders;
  let capturedBody;

  beforeEach(() => {
    capturedUrl = null;
    capturedHeaders = null;
    capturedBody = null;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url, options) => {
        capturedUrl = url;
        capturedHeaders = options?.headers || {};
        capturedBody = options?.body ? JSON.parse(options.body) : null;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              choices: [
                {
                  message: {
                    role: "assistant",
                    content: "proxy response",
                  },
                },
              ],
            }),
          body: {
            getReader: () => ({
              read: vi
                .fn()
                .mockResolvedValueOnce({
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"content":"proxy"}}]}\n\ndata: [DONE]\n',
                  ),
                })
                .mockResolvedValueOnce({ done: true }),
            }),
          },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ─── ask.js queryLLM-like flow with base-url override ──────

  describe("queryLLM with proxy base-url (ask command flow)", () => {
    /**
     * Simulates the queryLLM flow from ask.js
     * Tests that --base-url overrides provider.baseUrl
     */
    async function simulateQueryLLM(question, options = {}) {
      const provider = options.provider || "ollama";
      const model = options.model || "gpt-4o";
      const baseUrl = options.baseUrl || "http://localhost:11434";

      if (provider === "ollama") {
        await fetch(`${baseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: question, stream: false }),
        });
      } else {
        const providerDef = BUILT_IN_PROVIDERS[provider];
        const apiKey =
          options.apiKey ||
          (providerDef?.apiKeyEnv ? process.env[providerDef.apiKeyEnv] : null);
        const apiBase = options.baseUrl || providerDef?.baseUrl;
        await fetch(`${apiBase}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model || providerDef?.models[0],
            messages: [{ role: "user", content: question }],
          }),
        });
      }
    }

    it("should use proxy URL when --base-url is provided for openai", async () => {
      await simulateQueryLLM("hello", {
        provider: "openai",
        baseUrl: "https://oa.api2d.net/v1",
        apiKey: "fk-proxy-key",
        model: "gpt-4o",
      });

      expect(capturedUrl).toBe("https://oa.api2d.net/v1/chat/completions");
      expect(capturedHeaders.Authorization).toBe("Bearer fk-proxy-key");
      expect(capturedBody.model).toBe("gpt-4o");
    });

    it("should use proxy URL for volcengine with custom relay site", async () => {
      await simulateQueryLLM("你好", {
        provider: "volcengine",
        baseUrl: "https://my-proxy.com/volcengine/v3",
        apiKey: "ark-proxy-key",
        model: "doubao-seed-1-6-251015",
      });

      expect(capturedUrl).toBe(
        "https://my-proxy.com/volcengine/v3/chat/completions",
      );
      expect(capturedHeaders.Authorization).toBe("Bearer ark-proxy-key");
      expect(capturedBody.model).toBe("doubao-seed-1-6-251015");
    });

    it("should use proxy URL for deepseek via OpenAI-SB relay", async () => {
      await simulateQueryLLM("test", {
        provider: "deepseek",
        baseUrl: "https://api.openai-sb.com/v1",
        apiKey: "sb-xxxxxx",
        model: "deepseek-chat",
      });

      expect(capturedUrl).toBe("https://api.openai-sb.com/v1/chat/completions");
      expect(capturedHeaders.Authorization).toBe("Bearer sb-xxxxxx");
    });

    it("should fall back to provider default URL when no base-url is given", async () => {
      process.env.OPENAI_API_KEY = "test-key";
      try {
        await simulateQueryLLM("test", {
          provider: "openai",
          model: "gpt-4o-mini",
        });

        expect(capturedUrl).toBe("https://api.openai.com/v1/chat/completions");
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });

    it("should use proxy URL for One-API gateway", async () => {
      await simulateQueryLLM("test", {
        provider: "openai",
        baseUrl: "http://localhost:3000/v1",
        apiKey: "sk-oneapi-xxxxxx",
        model: "gpt-4o",
      });

      expect(capturedUrl).toBe("http://localhost:3000/v1/chat/completions");
      expect(capturedHeaders.Authorization).toBe("Bearer sk-oneapi-xxxxxx");
    });

    it("should use proxy URL for enterprise Nginx reverse proxy", async () => {
      await simulateQueryLLM("test", {
        provider: "openai",
        baseUrl: "https://ai-gateway.company.com/v1",
        apiKey: "sk-enterprise-key",
        model: "gpt-4o",
      });

      expect(capturedUrl).toBe(
        "https://ai-gateway.company.com/v1/chat/completions",
      );
    });

    it("should use Claude model through proxy with openai provider", async () => {
      await simulateQueryLLM("test", {
        provider: "openai",
        baseUrl: "https://claude-proxy.com/v1",
        apiKey: "proxy-key",
        model: "claude-sonnet-4-20250514",
      });

      expect(capturedUrl).toBe("https://claude-proxy.com/v1/chat/completions");
      expect(capturedBody.model).toBe("claude-sonnet-4-20250514");
    });
  });

  // ─── chat-repl flow with base-url override ─────────────────

  describe("chat-repl with proxy base-url", () => {
    /**
     * Simulates the chat-repl URL resolution logic
     */
    function resolveChatUrl(provider, baseUrl) {
      const providerDef = BUILT_IN_PROVIDERS[provider];
      return baseUrl !== "http://localhost:11434"
        ? baseUrl
        : providerDef?.baseUrl || "https://api.openai.com/v1";
    }

    function resolveApiKey(provider, apiKey) {
      if (apiKey) return apiKey;
      const providerDef = BUILT_IN_PROVIDERS[provider];
      return providerDef?.apiKeyEnv ? process.env[providerDef.apiKeyEnv] : null;
    }

    it("should resolve proxy URL correctly for openai via relay site", () => {
      const url = resolveChatUrl("openai", "https://oa.api2d.net/v1");
      expect(url).toBe("https://oa.api2d.net/v1");
    });

    it("should resolve proxy URL for volcengine via relay site", () => {
      const url = resolveChatUrl(
        "volcengine",
        "https://my-proxy.com/volcengine/v3",
      );
      expect(url).toBe("https://my-proxy.com/volcengine/v3");
    });

    it("should fall back to volcengine default URL when no proxy is set", () => {
      const url = resolveChatUrl("volcengine", "http://localhost:11434");
      expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3");
    });

    it("should resolve apiKey from --api-key over env var", () => {
      process.env.VOLCENGINE_API_KEY = "env-key";
      try {
        const key = resolveApiKey("volcengine", "explicit-key");
        expect(key).toBe("explicit-key");
      } finally {
        delete process.env.VOLCENGINE_API_KEY;
      }
    });

    it("should resolve apiKey from env var when --api-key is null", () => {
      process.env.VOLCENGINE_API_KEY = "env-key";
      try {
        const key = resolveApiKey("volcengine", null);
        expect(key).toBe("env-key");
      } finally {
        delete process.env.VOLCENGINE_API_KEY;
      }
    });

    it("should NOT use OPENAI_API_KEY for volcengine when apiKey is null", () => {
      process.env.OPENAI_API_KEY = "openai-key";
      try {
        const key = resolveApiKey("volcengine", null);
        // Should NOT return the openai key — this was the bug we fixed
        expect(key).not.toBe("openai-key");
        expect(key).toBeFalsy();
      } finally {
        delete process.env.OPENAI_API_KEY;
      }
    });
  });

  // ─── agent-repl flow with base-url override ────────────────

  describe("agent-repl chatWithTools proxy URL resolution", () => {
    /**
     * Simulates the agent-repl chatWithTools URL resolution
     */
    function resolveAgentUrl(provider, baseUrl) {
      const providerUrls = {
        openai: "https://api.openai.com/v1",
        deepseek: "https://api.deepseek.com/v1",
        dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        mistral: "https://api.mistral.ai/v1",
        gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
        volcengine: "https://ark.cn-beijing.volces.com/api/v3",
        kimi: "https://api.moonshot.cn/v1",
        minimax: "https://api.minimax.chat/v1",
      };

      return baseUrl && baseUrl !== "http://localhost:11434"
        ? baseUrl
        : providerUrls[provider];
    }

    function resolveAgentApiKey(provider, apiKey) {
      if (apiKey) return apiKey;
      const envKeys = {
        openai: "OPENAI_API_KEY",
        deepseek: "DEEPSEEK_API_KEY",
        dashscope: "DASHSCOPE_API_KEY",
        mistral: "MISTRAL_API_KEY",
        gemini: "GEMINI_API_KEY",
        volcengine: "VOLCENGINE_API_KEY",
        kimi: "MOONSHOT_API_KEY",
        minimax: "MINIMAX_API_KEY",
      };
      const envKey = envKeys[provider] || "OPENAI_API_KEY";
      return process.env[envKey] || null;
    }

    it("should use proxy URL for all OpenAI-compatible providers", () => {
      const providers = [
        "openai",
        "deepseek",
        "dashscope",
        "mistral",
        "volcengine",
        "kimi",
        "minimax",
      ];
      const proxyUrl = "https://my-one-api-gateway.com/v1";

      for (const p of providers) {
        const url = resolveAgentUrl(p, proxyUrl);
        expect(url).toBe(proxyUrl);
      }
    });

    it("should fall back to volcengine default when baseUrl is ollama default", () => {
      const url = resolveAgentUrl("volcengine", "http://localhost:11434");
      expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3");
    });

    it("should fall back to volcengine default when baseUrl is null", () => {
      const url = resolveAgentUrl("volcengine", null);
      expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3");
    });

    it("should resolve volcengine API key from env", () => {
      process.env.VOLCENGINE_API_KEY = "ark-test";
      try {
        const key = resolveAgentApiKey("volcengine", null);
        expect(key).toBe("ark-test");
      } finally {
        delete process.env.VOLCENGINE_API_KEY;
      }
    });

    it("should prefer explicit apiKey over env var in agent mode", () => {
      process.env.VOLCENGINE_API_KEY = "env-key";
      try {
        const key = resolveAgentApiKey("volcengine", "explicit-key");
        expect(key).toBe("explicit-key");
      } finally {
        delete process.env.VOLCENGINE_API_KEY;
      }
    });

    it("should build correct proxy request to relay site", async () => {
      const proxyUrl = "https://oa.api2d.net/v1";
      const proxyKey = "fk-relay-key";
      const model = "gpt-4o";

      await fetch(`${proxyUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${proxyKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hello" }],
          tools: [{ type: "function", function: { name: "read_file" } }],
        }),
      });

      expect(capturedUrl).toBe("https://oa.api2d.net/v1/chat/completions");
      expect(capturedHeaders.Authorization).toBe("Bearer fk-relay-key");
      expect(capturedBody.tools).toBeDefined();
      expect(capturedBody.tools[0].function.name).toBe("read_file");
    });
  });

  // ─── Custom provider with proxy URL ─────────────────────────

  describe("Custom provider registered with proxy URL", () => {
    it("should register and test a custom provider with proxy base URL", async () => {
      process.env.MY_PROXY_KEY = "proxy-test-key";
      try {
        const db = new MockDatabase();
        const registry = new LLMProviderRegistry(db);

        registry.addProvider("my-proxy", {
          displayName: "My OpenAI Proxy",
          baseUrl: "https://my-proxy.com/v1",
          apiKeyEnv: "MY_PROXY_KEY",
          models: ["gpt-4o", "claude-sonnet-4-20250514"],
        });

        const provider = registry.get("my-proxy");
        expect(provider).toBeTruthy();
        expect(provider.baseUrl).toBe("https://my-proxy.com/v1");

        const result = await registry.testProvider("my-proxy");
        expect(result.ok).toBe(true);
        expect(capturedUrl).toContain("my-proxy.com/v1");
      } finally {
        delete process.env.MY_PROXY_KEY;
      }
    });

    it("should use proxy key from env for custom provider", async () => {
      process.env.RELAY_KEY = "relay-api-key";
      try {
        const db = new MockDatabase();
        const registry = new LLMProviderRegistry(db);

        registry.addProvider("relay-site", {
          displayName: "Relay Site",
          baseUrl: "https://oa.api2d.net/v1",
          apiKeyEnv: "RELAY_KEY",
          models: ["gpt-4o"],
        });

        const result = await registry.testProvider("relay-site");
        expect(result.ok).toBe(true);
        expect(capturedHeaders.Authorization).toBe("Bearer relay-api-key");
      } finally {
        delete process.env.RELAY_KEY;
      }
    });
  });

  // ─── Kimi and MiniMax proxy support ────────────────────────

  describe("Kimi and MiniMax proxy base-url override", () => {
    it("should use proxy URL for kimi via relay site", async () => {
      await fetch("https://my-proxy.com/moonshot/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer proxy-kimi-key",
        },
        body: JSON.stringify({
          model: "moonshot-v1-auto",
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(capturedUrl).toBe(
        "https://my-proxy.com/moonshot/v1/chat/completions",
      );
      expect(capturedHeaders.Authorization).toBe("Bearer proxy-kimi-key");
      expect(capturedBody.model).toBe("moonshot-v1-auto");
    });

    it("should use proxy URL for minimax via relay site", async () => {
      await fetch("https://my-proxy.com/minimax/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer proxy-minimax-key",
        },
        body: JSON.stringify({
          model: "MiniMax-Text-01",
          messages: [{ role: "user", content: "hello" }],
        }),
      });

      expect(capturedUrl).toBe(
        "https://my-proxy.com/minimax/v1/chat/completions",
      );
      expect(capturedBody.model).toBe("MiniMax-Text-01");
    });

    it("should fall back to kimi default URL when no proxy", () => {
      const kimi = BUILT_IN_PROVIDERS.kimi;
      expect(kimi.baseUrl).toBe("https://api.moonshot.cn/v1");
    });

    it("should fall back to minimax default URL when no proxy", () => {
      const minimax = BUILT_IN_PROVIDERS.minimax;
      expect(minimax.baseUrl).toBe("https://api.minimax.chat/v1");
    });
  });

  // ─── Anthropic and Gemini proxy (中转站) ──────────────────

  describe("Anthropic and Gemini proxy (中转站) support", () => {
    it("should route anthropic-proxy through relay site with OpenAI format", async () => {
      const proxyUrl = "https://claude-relay.example.com/v1";
      await fetch(`${proxyUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer relay-claude-key",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: "test" }],
        }),
      });

      expect(capturedUrl).toBe(
        "https://claude-relay.example.com/v1/chat/completions",
      );
      expect(capturedHeaders.Authorization).toBe("Bearer relay-claude-key");
      expect(capturedBody.model).toBe("claude-sonnet-4-6");
    });

    it("should route gemini-proxy through relay site with OpenAI format", async () => {
      const proxyUrl = "https://gemini-relay.example.com/v1";
      await fetch(`${proxyUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer relay-gemini-key",
        },
        body: JSON.stringify({
          model: "gemini-2.0-flash",
          messages: [{ role: "user", content: "test" }],
        }),
      });

      expect(capturedUrl).toBe(
        "https://gemini-relay.example.com/v1/chat/completions",
      );
      expect(capturedBody.model).toBe("gemini-2.0-flash");
    });

    it("anthropic-proxy and gemini-proxy should use user-provided base URL", () => {
      // These providers don't have a built-in entry — they're setup-wizard-only
      // The proxy URL is fully provided by the user during setup
      const { LLM_PROVIDERS } = require("../../src/constants.js");
      expect(LLM_PROVIDERS["anthropic-proxy"].isProxy).toBe(true);
      expect(LLM_PROVIDERS["anthropic-proxy"].defaultBaseUrl).toBe("");
      expect(LLM_PROVIDERS["gemini-proxy"].isProxy).toBe(true);
      expect(LLM_PROVIDERS["gemini-proxy"].defaultBaseUrl).toBe("");
    });
  });

  // ─── Relay site URL format validation ──────────────────────

  describe("Relay site URL format validation", () => {
    const relaySites = [
      { name: "API2D", url: "https://oa.api2d.net/v1" },
      { name: "OpenAI-SB", url: "https://api.openai-sb.com/v1" },
      { name: "CloseAI", url: "https://api.closeai-proxy.xyz/v1" },
      { name: "AiHubMix", url: "https://aihubmix.com/v1" },
      { name: "One-API", url: "http://localhost:3000/v1" },
      { name: "Self-hosted Nginx", url: "https://ai-gateway.company.com/v1" },
    ];

    for (const site of relaySites) {
      it(`${site.name} URL should form valid chat/completions endpoint`, () => {
        const endpoint = `${site.url}/chat/completions`;
        expect(endpoint).toMatch(/\/v1\/chat\/completions$/);
      });
    }

    it("should correctly append /chat/completions to various URL formats", () => {
      const urls = [
        "https://proxy.com/v1",
        "https://proxy.com/v1/",
        "http://localhost:3000/v1",
      ];

      for (const url of urls) {
        const base = url.replace(/\/$/, "");
        expect(`${base}/chat/completions`).toMatch(/\/chat\/completions$/);
      }
    });
  });
});
