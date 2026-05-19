"use strict";

import { describe, it, expect } from "vitest";

const { CcLLMAdapter, LOCAL_PROVIDERS } = require("../lib/bridges/cc-llm-adapter");
const { AnalysisEngine } = require("../lib/analysis");

describe("CcLLMAdapter construction", () => {
  it("requires chat function", () => {
    expect(() => new CcLLMAdapter()).toThrow();
    expect(() => new CcLLMAdapter({})).toThrow(/chat/);
  });

  it("constructs with just chat", () => {
    const a = new CcLLMAdapter({ chat: async () => ({}) });
    expect(a.name).toBe("cc-llm"); // no provider/model getters → default name
  });
});

describe("CcLLMAdapter.isLocal", () => {
  it("returns true for ollama / llama-cpp / lm-studio / vllm-local", () => {
    for (const p of ["ollama", "llama-cpp", "llamacpp", "vllm-local", "lm-studio", "lmstudio"]) {
      const a = new CcLLMAdapter({
        chat: async () => ({}),
        getActiveProvider: () => p,
      });
      expect(a.isLocal).toBe(true);
    }
  });

  it("returns false for openai / anthropic / volcengine / etc.", () => {
    for (const p of ["openai", "anthropic", "volcengine", "gemini", "deepseek"]) {
      const a = new CcLLMAdapter({
        chat: async () => ({}),
        getActiveProvider: () => p,
      });
      expect(a.isLocal).toBe(false);
    }
  });

  it("returns false (conservative) when no provider getter is wired", () => {
    const a = new CcLLMAdapter({ chat: async () => ({}) });
    expect(a.isLocal).toBe(false);
  });

  it("getActiveProvider throws → fall through to false (defensive)", () => {
    const a = new CcLLMAdapter({
      chat: async () => ({}),
      getActiveProvider: () => { throw new Error("oops"); },
    });
    expect(a.isLocal).toBe(false);
  });

  it("custom localProviders override the default whitelist", () => {
    const a = new CcLLMAdapter({
      chat: async () => ({}),
      getActiveProvider: () => "my-private-cluster",
      localProviders: ["my-private-cluster"],
    });
    expect(a.isLocal).toBe(true);
  });

  it("LOCAL_PROVIDERS contains the documented set", () => {
    expect(LOCAL_PROVIDERS.has("ollama")).toBe(true);
    expect(LOCAL_PROVIDERS.has("llama-cpp")).toBe(true);
    expect(LOCAL_PROVIDERS.has("vllm-local")).toBe(true);
    expect(LOCAL_PROVIDERS.has("openai")).toBe(false);
  });
});

describe("CcLLMAdapter.name", () => {
  it("uses opts.name override when provided", () => {
    const a = new CcLLMAdapter({ chat: async () => ({}), name: "my-name" });
    expect(a.name).toBe("my-name");
  });

  it("composes provider:model when both getters available", () => {
    const a = new CcLLMAdapter({
      chat: async () => ({}),
      getActiveProvider: () => "ollama",
      getActiveModel: () => "qwen2.5:7b",
    });
    expect(a.name).toBe("ollama:qwen2.5:7b");
  });

  it("falls back to model only when no provider", () => {
    const a = new CcLLMAdapter({
      chat: async () => ({}),
      getActiveModel: () => "qwen",
    });
    expect(a.name).toBe("qwen");
  });
});

describe("CcLLMAdapter.chat response normalization", () => {
  it("extracts text from .content (cc llm-manager shape)", async () => {
    const a = new CcLLMAdapter({
      chat: async () => ({ content: "hi from cc", model: "qwen", usage: { promptTokens: 5, completionTokens: 3 } }),
      getActiveModel: () => "qwen",
    });
    const r = await a.chat([{ role: "user", content: "x" }]);
    expect(r.text).toBe("hi from cc");
    expect(r.model).toBe("qwen");
    expect(r.usage.promptTokens).toBe(5);
    expect(r.usage.completionTokens).toBe(3);
    expect(r.usage.totalTokens).toBe(8);
  });

  it("extracts text from .message.content (raw provider)", async () => {
    const a = new CcLLMAdapter({
      chat: async () => ({ message: { role: "assistant", content: "from msg" } }),
    });
    const r = await a.chat([]);
    expect(r.text).toBe("from msg");
  });

  it("extracts text from .text (alt shape)", async () => {
    const a = new CcLLMAdapter({ chat: async () => ({ text: "alt shape" }) });
    const r = await a.chat([]);
    expect(r.text).toBe("alt shape");
  });

  it("extracts text from OpenAI-style .choices[0].message.content", async () => {
    const a = new CcLLMAdapter({
      chat: async () => ({
        choices: [{ message: { content: "openai-like" } }],
      }),
    });
    const r = await a.chat([]);
    expect(r.text).toBe("openai-like");
  });

  it("returns empty text for unknown shape (doesn't throw)", async () => {
    const a = new CcLLMAdapter({ chat: async () => ({ random: "blob" }) });
    const r = await a.chat([]);
    expect(r.text).toBe("");
  });

  it("normalizes snake_case usage (prompt_tokens) to camelCase", async () => {
    const a = new CcLLMAdapter({
      chat: async () => ({
        content: "x",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    });
    const r = await a.chat([]);
    expect(r.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it("wraps underlying chat errors with cause preserved", async () => {
    const a = new CcLLMAdapter({
      chat: async () => { throw new Error("upstream Ollama died"); },
    });
    await expect(a.chat([])).rejects.toThrow(/underlying client failed/);
  });

  it("validates messages is an array", async () => {
    const a = new CcLLMAdapter({ chat: async () => ({}) });
    await expect(a.chat("not an array")).rejects.toThrow(/array/);
  });
});

describe("CcLLMAdapter ↔ AnalysisEngine integration", () => {
  it("AnalysisEngine accepts CcLLMAdapter (local-provider path)", () => {
    const a = new CcLLMAdapter({
      chat: async () => ({ content: "ok" }),
      getActiveProvider: () => "ollama",
    });
    // Construction shouldn't throw — isLocal:true means engine accepts.
    const fakeVault = {
      audit: () => {},
      queryEvents: () => [],
      getWatermark: () => null,
    };
    expect(() => new AnalysisEngine({ vault: fakeVault, llm: a })).not.toThrow();
  });

  it("AnalysisEngine refuses CcLLMAdapter when provider is non-local without opt-in", async () => {
    const a = new CcLLMAdapter({
      chat: async () => ({ content: "ok" }),
      getActiveProvider: () => "anthropic",
    });
    const fakeVault = {
      audit: () => {},
      queryEvents: () => [],
      getWatermark: () => null,
    };
    const e = new AnalysisEngine({ vault: fakeVault, llm: a });
    await expect(e.ask("test")).rejects.toThrow(/non-local/);
  });
});
