/**
 * Unit tests for --fallback-model. The base chatFn is injected so no real
 * provider is contacted; only the retry/skip logic is exercised.
 */

import { describe, it, expect, vi } from "vitest";
import {
  isRetryableModelError,
  isModelNotFoundError,
  normalizeFallbackModels,
  makeFallbackChatFn,
  parseFallbackEntry,
  resolveFallbackTarget,
} from "../../src/runtime/fallback-model.js";
import { resolveFallbackModels } from "../../src/commands/agent.js";

describe("isRetryableModelError", () => {
  it("is true for overload / rate-limit / transient status codes", () => {
    expect(isRetryableModelError({ status: 429 })).toBe(true);
    expect(isRetryableModelError({ status: 503 })).toBe(true);
    expect(isRetryableModelError({ statusCode: 529 })).toBe(true);
    expect(isRetryableModelError(new Error("Model is overloaded"))).toBe(true);
    expect(isRetryableModelError(new Error("429 Too Many Requests"))).toBe(
      true,
    );
    expect(isRetryableModelError(new Error("fetch failed"))).toBe(true);
    expect(isRetryableModelError({ code: "ECONNREFUSED" })).toBe(true);
  });

  it("unwraps a retryable cause", () => {
    const err = new Error("request failed");
    err.cause = { code: "ETIMEDOUT" };
    expect(isRetryableModelError(err)).toBe(true);
  });

  it("is false for non-transient errors and nullish input", () => {
    expect(isRetryableModelError(null)).toBe(false);
    expect(isRetryableModelError(new Error("invalid prompt"))).toBe(false);
    expect(isRetryableModelError({ status: 400 })).toBe(false);
    expect(isRetryableModelError({ status: 401 })).toBe(false);
  });
});

describe("makeFallbackChatFn", () => {
  it("passes through on success without invoking fallback", async () => {
    const baseChatFn = vi.fn(async () => ({ message: { content: "ok" } }));
    const onFallback = vi.fn();
    const fn = makeFallbackChatFn({
      fallbackModel: "backup",
      baseChatFn,
      onFallback,
    });
    const r = await fn([{ role: "user", content: "hi" }], { model: "primary" });
    expect(r.message.content).toBe("ok");
    expect(baseChatFn).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("retries with the fallback model on a retryable error", async () => {
    const baseChatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockResolvedValueOnce({ message: { content: "from-backup" } });
    const onFallback = vi.fn();
    const fn = makeFallbackChatFn({
      fallbackModel: "backup",
      baseChatFn,
      onFallback,
    });

    const r = await fn([], { model: "primary", provider: "ollama" });

    expect(r.message.content).toBe("from-backup");
    expect(baseChatFn).toHaveBeenCalledTimes(2);
    // second call keeps provider but swaps model
    expect(baseChatFn.mock.calls[1][1]).toMatchObject({
      model: "backup",
      provider: "ollama",
    });
    expect(onFallback).toHaveBeenCalledWith({
      from: "primary",
      to: "backup",
      crossProvider: false,
      error: "overloaded",
    });
  });

  it("does not retry a non-retryable error", async () => {
    const baseChatFn = vi.fn().mockRejectedValue(new Error("invalid prompt"));
    const fn = makeFallbackChatFn({ fallbackModel: "backup", baseChatFn });
    await expect(fn([], { model: "primary" })).rejects.toThrow(
      "invalid prompt",
    );
    expect(baseChatFn).toHaveBeenCalledTimes(1);
  });

  it("does not retry when fallback equals the primary model", async () => {
    const baseChatFn = vi.fn().mockRejectedValue(new Error("overloaded"));
    const fn = makeFallbackChatFn({ fallbackModel: "same", baseChatFn });
    await expect(fn([], { model: "same" })).rejects.toThrow("overloaded");
    expect(baseChatFn).toHaveBeenCalledTimes(1);
  });

  it("propagates the fallback error when the retry also fails", async () => {
    const baseChatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockRejectedValueOnce(new Error("backup also 503"));
    const fn = makeFallbackChatFn({ fallbackModel: "backup", baseChatFn });
    await expect(fn([], { model: "primary" })).rejects.toThrow(
      "backup also 503",
    );
    expect(baseChatFn).toHaveBeenCalledTimes(2);
  });

  it("walks an ordered chain until one model succeeds", async () => {
    const baseChatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("overloaded")) // primary
      .mockRejectedValueOnce(new Error("503")) // backup-1
      .mockResolvedValueOnce({ message: { content: "from-2" } }); // backup-2
    const onFallback = vi.fn();
    const fn = makeFallbackChatFn({
      fallbackModels: ["backup-1", "backup-2"],
      baseChatFn,
      onFallback,
    });

    const r = await fn([], { model: "primary", provider: "ollama" });

    expect(r.message.content).toBe("from-2");
    expect(baseChatFn).toHaveBeenCalledTimes(3);
    expect(baseChatFn.mock.calls[1][1]).toMatchObject({ model: "backup-1" });
    expect(baseChatFn.mock.calls[2][1]).toMatchObject({
      model: "backup-2",
      provider: "ollama",
    });
    expect(onFallback).toHaveBeenNthCalledWith(1, {
      from: "primary",
      to: "backup-1",
      crossProvider: false,
      error: "overloaded",
    });
    expect(onFallback).toHaveBeenNthCalledWith(2, {
      from: "backup-1",
      to: "backup-2",
      crossProvider: false,
      error: "503",
    });
  });

  it("throws the last error when the whole chain is exhausted", async () => {
    const baseChatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockRejectedValueOnce(new Error("b1 503"))
      .mockRejectedValueOnce(new Error("b2 timeout"));
    const fn = makeFallbackChatFn({
      fallbackModels: ["b1", "b2"],
      baseChatFn,
    });
    await expect(fn([], { model: "primary" })).rejects.toThrow("b2 timeout");
    expect(baseChatFn).toHaveBeenCalledTimes(3);
  });

  it("falls back when the primary model is not found (non-transient)", async () => {
    const baseChatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("model not found: gpt-old"))
      .mockResolvedValueOnce({ message: { content: "recovered" } });
    const fn = makeFallbackChatFn({ fallbackModel: "backup", baseChatFn });
    const r = await fn([], { model: "gpt-old" });
    expect(r.message.content).toBe("recovered");
    expect(baseChatFn).toHaveBeenCalledTimes(2);
  });

  it("skips a fallback identical to the model just tried", async () => {
    const baseChatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockResolvedValueOnce({ message: { content: "ok" } });
    const fn = makeFallbackChatFn({
      fallbackModels: ["primary", "backup"], // first dup of primary is skipped
      baseChatFn,
    });
    const r = await fn([], { model: "primary" });
    expect(r.message.content).toBe("ok");
    // primary (fail) → skip "primary" dup → "backup" (ok) = 2 calls, not 3
    expect(baseChatFn).toHaveBeenCalledTimes(2);
    expect(baseChatFn.mock.calls[1][1]).toMatchObject({ model: "backup" });
  });
});

describe("parseFallbackEntry", () => {
  const known = new Set(["openai", "anthropic", "ollama"]);
  it("recognizes a known provider prefix", () => {
    expect(parseFallbackEntry("openai:gpt-4o", known)).toEqual({
      provider: "openai",
      model: "gpt-4o",
    });
  });
  it("keeps a colon-bearing model id intact under a known provider", () => {
    expect(parseFallbackEntry("ollama:qwen2.5:7b", known)).toEqual({
      provider: "ollama",
      model: "qwen2.5:7b",
    });
  });
  it("does NOT split a plain model whose prefix is not a known provider", () => {
    // `qwen2.5` is not a provider, so the whole thing is a same-provider model.
    expect(parseFallbackEntry("qwen2.5:7b", known)).toEqual({
      provider: null,
      model: "qwen2.5:7b",
    });
  });
  it("treats a bare model as same-provider", () => {
    expect(parseFallbackEntry("claude-haiku-4-5", known)).toEqual({
      provider: null,
      model: "claude-haiku-4-5",
    });
  });
});

describe("resolveFallbackTarget (cross-provider)", () => {
  const providers = {
    ollama: {
      name: "ollama",
      baseUrl: "http://localhost:11434",
      apiKeyEnv: null,
    },
    openai: {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  };

  it("same-provider entry only carries the model", () => {
    const t = resolveFallbackTarget("backup", { providers, env: {} });
    expect(t).toEqual({ model: "backup", crossProvider: false });
  });

  it("cross-provider entry resolves baseUrl + apiKey from the env", () => {
    const t = resolveFallbackTarget("openai:gpt-4o", {
      providers,
      env: { OPENAI_API_KEY: "sk-test" },
    });
    expect(t).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
      crossProvider: true,
    });
  });

  it("marks a cross-provider hop UNAVAILABLE when its key is absent (never reuse the wrong key)", () => {
    const t = resolveFallbackTarget("openai:gpt-4o", { providers, env: {} });
    expect(t.unavailable).toBe(true);
    expect(t.reason).toMatch(/OPENAI_API_KEY not set/);
  });

  it("a keyless provider (ollama) resolves without a key", () => {
    const t = resolveFallbackTarget("ollama:qwen2.5:7b", {
      providers,
      env: {},
    });
    expect(t).toMatchObject({
      provider: "ollama",
      model: "qwen2.5:7b",
      crossProvider: true,
    });
  });

  it("an unrecognized prefix is treated as a same-provider literal model (not split)", () => {
    // `bogus` is not a known provider, so `bogus:m` is a same-provider model id.
    const t = resolveFallbackTarget("bogus:m", { providers, env: {} });
    expect(t).toEqual({ model: "bogus:m", crossProvider: false });
  });

  it("flags a known-but-unconfigured provider as unavailable (defensive guard)", () => {
    // knownProviders lists `azure` as a prefix, but `providers` has no def → unavailable.
    const t = resolveFallbackTarget("azure:gpt-4o", {
      providers,
      env: {},
      knownProviders: new Set(["openai", "ollama", "azure"]),
    });
    expect(t.unavailable).toBe(true);
    expect(t.reason).toMatch(/unknown provider/);
  });
});

describe("makeFallbackChatFn — cross-provider hops", () => {
  const providers = {
    ollama: {
      name: "ollama",
      baseUrl: "http://localhost:11434",
      apiKeyEnv: null,
    },
    openai: {
      name: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  };

  it("switches provider + baseUrl + apiKey when a cross-provider fallback is used", async () => {
    const baseChatFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("overloaded"))
      .mockResolvedValueOnce({ message: { content: "from-openai" } });
    const onFallback = vi.fn();
    const fn = makeFallbackChatFn({
      fallbackModels: ["openai:gpt-4o"],
      baseChatFn,
      onFallback,
      providers,
      env: { OPENAI_API_KEY: "sk-test" },
    });
    const r = await fn([], {
      model: "qwen2.5:7b",
      provider: "ollama",
      baseUrl: "http://localhost:11434",
    });
    expect(r.message.content).toBe("from-openai");
    expect(baseChatFn.mock.calls[1][1]).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test",
    });
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({ to: "openai:gpt-4o", crossProvider: true }),
    );
  });

  it("SKIPS a cross-provider hop whose key is missing (no wrong-credential call)", async () => {
    const baseChatFn = vi.fn().mockRejectedValue(new Error("overloaded"));
    const onFallback = vi.fn();
    const fn = makeFallbackChatFn({
      fallbackModels: ["openai:gpt-4o"], // no OPENAI_API_KEY in env
      baseChatFn,
      onFallback,
      providers,
      env: {},
    });
    await expect(
      fn([], { model: "qwen2.5:7b", provider: "ollama" }),
    ).rejects.toThrow("overloaded");
    // Only the primary was attempted; the keyless cross-provider hop was skipped.
    expect(baseChatFn).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: true }),
    );
  });
});

describe("isModelNotFoundError", () => {
  it("is true for 404 and not-found / unknown-model phrasings", () => {
    expect(isModelNotFoundError({ status: 404 })).toBe(true);
    expect(isModelNotFoundError(new Error("model not found"))).toBe(true);
    expect(isModelNotFoundError(new Error("model_not_found"))).toBe(true);
    expect(isModelNotFoundError(new Error("Unknown model: foo"))).toBe(true);
    expect(
      isModelNotFoundError(new Error("The model abc does not exist")),
    ).toBe(true);
    expect(isModelNotFoundError(new Error("invalid model id"))).toBe(true);
  });

  it("is false for transient, auth, and nullish errors", () => {
    expect(isModelNotFoundError(null)).toBe(false);
    expect(isModelNotFoundError(new Error("overloaded"))).toBe(false);
    expect(isModelNotFoundError({ status: 429 })).toBe(false);
    expect(isModelNotFoundError({ status: 401 })).toBe(false);
    expect(isModelNotFoundError(new Error("invalid prompt"))).toBe(false);
  });
});

describe("normalizeFallbackModels", () => {
  it("returns [] for nullish / non-string input", () => {
    expect(normalizeFallbackModels(null)).toEqual([]);
    expect(normalizeFallbackModels(undefined)).toEqual([]);
    expect(normalizeFallbackModels([42, {}])).toEqual([]);
  });

  it("splits comma lists, trims, drops empties, and dedupes", () => {
    expect(normalizeFallbackModels("a, b ,,a, c")).toEqual(["a", "b", "c"]);
    expect(normalizeFallbackModels(["a", "b,c", "b"])).toEqual(["a", "b", "c"]);
  });

  it("caps the chain at 3 models", () => {
    expect(normalizeFallbackModels("a,b,c,d,e")).toEqual(["a", "b", "c"]);
    expect(normalizeFallbackModels(["a", "b", "c", "d"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("resolveFallbackModels (flag > config)", () => {
  it("prefers the flag array over config", () => {
    expect(
      resolveFallbackModels(["x", "y"], { fallbackModels: ["a", "b"] }),
    ).toEqual(["x", "y"]);
  });

  it("falls back to config llm.fallbackModels when no flag", () => {
    expect(resolveFallbackModels(undefined, { fallbackModels: "a,b" })).toEqual(
      ["a", "b"],
    );
  });

  it("supports legacy config llm.fallbackModel (single)", () => {
    expect(resolveFallbackModels(undefined, { fallbackModel: "solo" })).toEqual(
      ["solo"],
    );
  });

  it("returns [] when neither flag nor config provides a chain", () => {
    expect(resolveFallbackModels(undefined, {})).toEqual([]);
    expect(resolveFallbackModels([], undefined)).toEqual([]);
  });
});
