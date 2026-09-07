import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  config: {
    llm: {
      provider: "openai",
      baseUrl: "https://old.example/v1",
      apiKey: "old-key",
      model: "old-model",
    },
  },
  calls: [],
}));
vi.mock("../../src/lib/config-manager.js", () => ({
  updateConfigAtomically: (mutate) => {
    const next = structuredClone(state.config);
    mutate(next);
    state.calls.push(next);
  },
  setSecretConfigValue: (key, value, opts) => {
    const next = structuredClone(state.config);
    opts.configMutator(next);
    next.llm.apiKey = value;
    state.calls.push(next);
  },
}));
import {
  normalizeLlmConnection,
  saveLlmConnection,
  readLlmConnectionInput,
} from "../../src/lib/llm-connection-config.js";
import { probeLlmConnection } from "../../src/lib/llm-connection-probe.js";
import { Readable } from "node:stream";
describe("LLM custom connection", () => {
  const draft = {
    provider: "openai",
    model: "my/custom-model",
    baseUrl: "https://relay.example/proxy/v1",
    visionModel: "",
    apiKey: "new-key",
  };
  it("updates endpoint and secret in one transaction while clearing the optional vision model", () => {
    state.calls.length = 0;
    const result = saveLlmConnection(draft);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].llm).toMatchObject({
      provider: "openai",
      baseUrl: draft.baseUrl,
      apiKey: "new-key",
      visionModel: null,
    });
    expect(result).not.toHaveProperty("apiKey");
  });
  it("does not reuse the original key across destinations", () => {
    expect(() => saveLlmConnection({ ...draft, apiKey: "" })).toThrow(
      "own API key",
    );
    expect(() =>
      saveLlmConnection({
        ...draft,
        baseUrl: state.config.llm.baseUrl,
        apiKey: "",
      }),
    ).not.toThrow();
  });
  it("rejects unsafe URL/protocol/fields before writing anything", () => {
    for (const baseUrl of [
      "file:///tmp/key",
      "https://user:key@relay.example",
      "https://relay.example/v1/chat/completions",
      "http://relay.example/v1",
    ])
      expect(() => normalizeLlmConnection({ ...draft, baseUrl })).toThrow();
    expect(
      normalizeLlmConnection({ ...draft, baseUrl: "http://localhost:1234/v1" })
        .baseUrl,
    ).toBe("http://localhost:1234/v1");
    expect(() => normalizeLlmConnection({ ...draft, other: true })).toThrow();
  });
  it("bounds stdin and rejects malformed JSON without echoing it", async () => {
    await expect(
      readLlmConnectionInput(Readable.from([JSON.stringify(draft)])),
    ).resolves.toEqual(draft);
    await expect(
      readLlmConnectionInput(Readable.from(["s".repeat(33000)])),
    ).rejects.toThrow("too large");
    await expect(
      readLlmConnectionInput(Readable.from(["secret"])),
    ).rejects.toThrow("valid JSON");
    const utf8 = Buffer.from(JSON.stringify({ ...draft, model: "中文模型" }));
    await expect(
      readLlmConnectionInput(
        Readable.from([...utf8].map((byte) => Buffer.from([byte]))),
      ),
    ).resolves.toMatchObject({ model: "中文模型" });
  });
  it.each([
    [
      "openai",
      "/chat/completions",
      "Authorization",
      { choices: [{ message: { content: "Hi" } }] },
    ],
    [
      "anthropic",
      "/messages",
      "x-api-key",
      { content: [{ type: "text", text: "Hi" }] },
    ],
    [
      "gemini",
      "/models/custom:generateContent",
      "x-goog-api-key",
      { candidates: [{ content: { parts: [{ text: "Hi" }] } }] },
    ],
    ["ollama", "/api/generate", null, { response: "Hi" }],
  ])(
    "tests %s using its native wire protocol",
    async (provider, suffix, header, payload) => {
      const fetchImpl = vi.fn(async () => ({
        ok: true,
        json: async () => payload,
      }));
      await expect(
        probeLlmConnection(
          {
            provider,
            model: "custom",
            baseUrl: "https://relay.example/v1/",
            apiKey: "secret",
          },
          { fetchImpl },
        ),
      ).resolves.toBe("Hi");
      const [url, options] = fetchImpl.mock.calls[0];
      expect(url).toBe("https://relay.example/v1" + suffix);
      expect(url).not.toContain("secret");
      expect(options.redirect).toBe("error");
      if (header) expect(options.headers[header]).toContain("secret");
      else expect(options.headers).not.toHaveProperty("Authorization");
    },
  );
  it("does not call an empty JSON response a successful model connection", async () => {
    await expect(
      probeLlmConnection(draft, {
        fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
      }),
    ).rejects.toThrow("no model text");
  });
});
