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
      error: "overloaded",
    });
    expect(onFallback).toHaveBeenNthCalledWith(2, {
      from: "backup-1",
      to: "backup-2",
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
