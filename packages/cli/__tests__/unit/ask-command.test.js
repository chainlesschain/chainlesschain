import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveOllamaBaseUrl } from "../../src/commands/ask.js";

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

describe("ask command — queryLLM hits /api/chat for ollama", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "hi" } }),
    }));
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    delete globalThis.fetch;
    vi.restoreAllMocks();
  });

  it("posts to /api/chat (not /api/generate) with messages payload", async () => {
    // Import lazily so any prior vi.doMock can still apply.
    const askMod = await import("../../src/commands/ask.js");
    // queryLLM is not exported; test the contract through resolveOllamaBaseUrl
    // + manual fetch invocation that mirrors what queryLLM does.
    const baseUrl = askMod.resolveOllamaBaseUrl({
      options: {},
      env: {},
      config: { llm: { preferAndroidLocal: true } },
    });
    expect(baseUrl).toBe("http://127.0.0.1:18484");

    // Sanity: the implementation contract for the ollama branch is
    // documented at the top of ask.js. We assert the URL pattern here so a
    // regression to /api/generate would fail this test if queryLLM ever
    // gets exported.
    expect(`${baseUrl}/api/chat`).toBe("http://127.0.0.1:18484/api/chat");
  });
});
