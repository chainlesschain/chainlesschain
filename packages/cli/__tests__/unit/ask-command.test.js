import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
vi.mock("ora", () => ({
  default: () => ({ start() {}, fail() {}, succeed() {} }),
}));
vi.mock("../../src/lib/logger.js", () => ({ logger: {} }));
vi.mock("../../src/lib/evolution/agent-evolution-ingress.js", () => ({
  captureAgentEvolutionIngress: (ingress) => ingress,
}));
vi.mock(
  "../../src/lib/evolution/agent-evolution-runtime-composition-brand.js",
  () => ({
    captureAgentEvolutionRuntimeComposition: (composition) => composition,
  }),
);
import {
  resolveOllamaBaseUrl,
  resolveAskOptions,
  queryLLM,
  extractCompletion,
  registerAskCommand,
} from "../../src/commands/ask.js";

describe("ask command deployment dependencies", () => {
  it("rejects accessor and Proxy dependencies without executing them", () => {
    const getter = vi.fn();
    const dependencies = Object.defineProperty(
      {},
      "evolutionCompositionFactory",
      { get: getter },
    );
    expect(() => registerAskCommand({}, dependencies)).toThrow(
      /function data property/,
    );
    expect(getter).not.toHaveBeenCalled();
    const trap = vi.fn();
    expect(() =>
      registerAskCommand({}, new Proxy({}, { getOwnPropertyDescriptor: trap })),
    ).toThrow(/plain object/);
    expect(trap).not.toHaveBeenCalled();
  });
});

describe("ask command — resolveOllamaBaseUrl precedence", () => {
  it("returns --base-url flag when set (highest precedence)", () => {
    expect(
      resolveOllamaBaseUrl({
        options: { baseUrl: "http://custom:9999", preferAndroidLocal: true },
        env: { CC_HUB_OLLAMA_URL: "http://env-wins:1234" },
        config: { llm: { preferAndroidLocal: true, baseUrl: "http://cfg:1" } },
      }),
    ).toBe("http://custom:9999");
  });

  it("returns CC_HUB_OLLAMA_URL when --base-url absent", () => {
    expect(
      resolveOllamaBaseUrl({
        options: { preferAndroidLocal: true },
        env: { CC_HUB_OLLAMA_URL: "http://127.0.0.1:18487" },
        config: { llm: { preferAndroidLocal: true } },
      }),
    ).toBe("http://127.0.0.1:18487");
  });

  it("ignores empty CC_HUB_OLLAMA_URL", () => {
    expect(
      resolveOllamaBaseUrl({
        options: {},
        env: { CC_HUB_OLLAMA_URL: "   " },
        config: { llm: { preferAndroidLocal: true } },
      }),
    ).toBe("http://127.0.0.1:18484");
  });

  it("returns Android local URL when --prefer-android-local flag is set", () => {
    expect(
      resolveOllamaBaseUrl({
        options: { preferAndroidLocal: true },
        env: {},
        config: { llm: { baseUrl: "http://cfg-default:11434" } },
      }),
    ).toBe("http://127.0.0.1:18484");
  });

  it("returns Android local URL when config.llm.preferAndroidLocal=true", () => {
    expect(
      resolveOllamaBaseUrl({
        options: {},
        env: {},
        config: {
          llm: {
            preferAndroidLocal: true,
            baseUrl: "http://cfg-default:11434",
          },
        },
      }),
    ).toBe("http://127.0.0.1:18484");
  });

  it("returns config.llm.baseUrl when toggle off and config set", () => {
    expect(
      resolveOllamaBaseUrl({
        options: {},
        env: {},
        config: {
          llm: { preferAndroidLocal: false, baseUrl: "http://my-ollama:11434" },
        },
      }),
    ).toBe("http://my-ollama:11434");
  });

  it("falls back to localhost:11434 when nothing else set", () => {
    expect(
      resolveOllamaBaseUrl({
        options: {},
        env: {},
        config: {},
      }),
    ).toBe("http://localhost:11434");
  });

  it("treats preferAndroidLocal=false as no opt-in (does not override config.llm.baseUrl)", () => {
    expect(
      resolveOllamaBaseUrl({
        options: { preferAndroidLocal: false },
        env: {},
        config: {
          llm: { preferAndroidLocal: false, baseUrl: "http://other:11434" },
        },
      }),
    ).toBe("http://other:11434");
  });
});

describe("ask command saved provider selection", () => {
  it("does not reuse a different provider's model, URL, API key, or local endpoint", () => {
    expect(
      resolveAskOptions(
        { provider: "gemini" },
        {
          llm: {
            provider: "volcengine",
            model: "doubao-model",
            baseUrl: "https://ark.example/api/v3",
            apiKey: "volc-secret",
            preferAndroidLocal: true,
          },
        },
        { CC_HUB_OLLAMA_URL: "http://127.0.0.1:18484" },
      ),
    ).toEqual({
      provider: "gemini",
      model: "gemini-2.0-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      apiKey: null,
    });
  });

  it("keeps a matching provider's saved settings", () => {
    expect(
      resolveAskOptions(
        {},
        {
          llm: {
            provider: "anthropic",
            model: "claude-custom",
            baseUrl: "https://proxy.example/v1/",
            apiKey: "anthropic-secret",
          },
        },
      ),
    ).toMatchObject({
      provider: "anthropic",
      model: "claude-custom",
      baseUrl: "https://proxy.example/v1/",
      apiKey: "anthropic-secret",
    });
  });

  it("does not send a same-provider saved key to an explicitly different endpoint", () => {
    expect(
      resolveAskOptions(
        { provider: "anthropic", baseUrl: "http://127.0.0.1:9010/v1" },
        {
          llm: {
            provider: "anthropic",
            model: "saved-model",
            baseUrl: "https://api.anthropic.com/v1",
            apiKey: "saved-anthropic-key",
          },
        },
        {},
      ),
    ).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-6",
      baseUrl: "http://127.0.0.1:9010/v1",
      apiKey: null,
    });
  });
});

describe("ask command — queryLLM hits /api/chat for ollama", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "hi" } }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to /api/chat (not /api/generate) with messages payload", async () => {
    const baseUrl = resolveOllamaBaseUrl({
      options: {},
      env: {},
      config: { llm: { preferAndroidLocal: true } },
    });
    expect(baseUrl).toBe("http://127.0.0.1:18484");

    const question = 'explain this unfinished example: {"partial":';
    await expect(
      queryLLM(question, { provider: "ollama", model: "qwen2:7b", baseUrl }),
    ).resolves.toBe("hi");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, request] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:18484/api/chat");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({
      model: "qwen2:7b",
      messages: [{ role: "user", content: question }],
      stream: false,
    });
  });
});

describe("ask command — extractCompletion", () => {
  it("returns the assistant content from a well-formed response", () => {
    const data = { choices: [{ message: { content: "hello" } }] };
    expect(extractCompletion(data, "openai")).toBe("hello");
  });

  it("treats an empty-string completion as valid", () => {
    const data = { choices: [{ message: { content: "" } }] };
    expect(extractCompletion(data, "openai")).toBe("");
  });

  it("throws a clear error for empty choices (200 + no completion)", () => {
    expect(() => extractCompletion({ choices: [] }, "volcengine")).toThrow(
      /volcengine returned no completion/,
    );
  });

  it("throws a clear error when choices is missing entirely", () => {
    expect(() => extractCompletion({}, "openai")).toThrow(
      /returned no completion/,
    );
  });

  it("includes the provider error body when a 200 carries an error", () => {
    const data = { error: { message: "content filtered" } };
    expect(() => extractCompletion(data, "openai")).toThrow(/content filtered/);
  });
});

describe("ask command provider protocols", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [
      "anthropic",
      "https://api.anthropic.com/v1/",
      "claude-haiku-4-5-20251001",
      {
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "hello" },
        ],
      },
      "https://api.anthropic.com/v1/messages",
      "x-api-key",
    ],
    [
      "gemini",
      "https://generativelanguage.googleapis.com/v1beta/",
      "gemini-2.0-flash",
      {
        candidates: [
          {
            content: {
              parts: [{ thought: true, text: "private" }, { text: "hello" }],
            },
          },
        ],
      },
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      "x-goog-api-key",
    ],
  ])(
    "routes %s through its native API and keeps the key out of the URL",
    async (provider, baseUrl, model, payload, expectedUrl, keyHeader) => {
      const fetch = vi.fn(async () => ({
        ok: true,
        json: async () => payload,
      }));
      vi.stubGlobal("fetch", fetch);
      await expect(
        queryLLM(
          "hello",
          { provider, baseUrl, model, apiKey: "secret" },
          { prepareModelRequest: async ({ messages }) => ({ messages }) },
        ),
      ).resolves.toBe("hello");
      const [url, options] = fetch.mock.calls[0];
      expect(url).toBe(expectedUrl);
      expect(url).not.toContain("secret");
      expect(options.headers[keyHeader]).toBe("secret");
    },
  );
});
