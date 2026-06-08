/**
 * Unit tests for --fallback-model. The base chatFn is injected so no real
 * provider is contacted; only the retry/skip logic is exercised.
 */

import { describe, it, expect, vi } from "vitest";
import {
  isRetryableModelError,
  makeFallbackChatFn,
} from "../../src/runtime/fallback-model.js";

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
});
