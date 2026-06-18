/**
 * Same-model auto-retry (Claude-Code 2.1.181 parity).
 *
 * makeRetryingChatFn retries the SAME model a few times on a transient
 * connection drop ("connection closed while thinking") before surfacing the
 * error. It composes inside makeFallbackChatFn: same-model retries first, then
 * the fallback chain advances to the next model. A user abort and a
 * non-transient error are never retried. The base chatFn and the sleep timer
 * are injected so no real provider is contacted and tests run instantly.
 */

import { describe, it, expect, vi } from "vitest";
import {
  makeRetryingChatFn,
  makeFallbackChatFn,
} from "../../src/runtime/fallback-model.js";

const noSleep = () => Promise.resolve();

describe("makeRetryingChatFn", () => {
  it("returns the result on first success without retrying", async () => {
    const base = vi.fn().mockResolvedValue({ message: { content: "ok" } });
    const fn = makeRetryingChatFn({ baseChatFn: base, sleep: noSleep });
    const out = await fn([{ role: "user", content: "hi" }], { model: "m" });
    expect(out).toEqual({ message: { content: "ok" } });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("retries a transient drop and succeeds on a later attempt", async () => {
    const base = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue({ message: { content: "recovered" } });
    const onRetry = vi.fn();
    const fn = makeRetryingChatFn({
      baseChatFn: base,
      sleep: noSleep,
      onRetry,
    });
    const out = await fn([], { model: "m" });
    expect(out).toEqual({ message: { content: "recovered" } });
    expect(base).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, max: 2 });
    expect(onRetry.mock.calls[1][0]).toMatchObject({ attempt: 2, max: 2 });
  });

  it("gives up after maxRetries and throws the last error", async () => {
    const base = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
    const fn = makeRetryingChatFn({
      baseChatFn: base,
      maxRetries: 2,
      sleep: noSleep,
    });
    await expect(fn([], {})).rejects.toThrow("ETIMEDOUT");
    expect(base).toHaveBeenCalledTimes(3); // initial + 2 retries, then throw
  });

  it("does not retry a non-transient (auth / bad-request) error", async () => {
    const err = new Error("401 invalid api key");
    const base = vi.fn().mockRejectedValue(err);
    const fn = makeRetryingChatFn({ baseChatFn: base, sleep: noSleep });
    await expect(fn([], {})).rejects.toThrow("401 invalid api key");
    expect(base).toHaveBeenCalledTimes(1); // no retry
  });

  it("does not retry a user abort (AbortError)", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    const base = vi.fn().mockRejectedValue(err);
    const fn = makeRetryingChatFn({ baseChatFn: base, sleep: noSleep });
    await expect(fn([], {})).rejects.toThrow("aborted");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the AbortSignal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    // Even a transient-looking error is not retried once the signal is aborted.
    const base = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const fn = makeRetryingChatFn({ baseChatFn: base, sleep: noSleep });
    await expect(fn([], { signal: ac.signal })).rejects.toThrow("ECONNRESET");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("maxRetries:0 disables retrying entirely", async () => {
    const base = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const fn = makeRetryingChatFn({
      baseChatFn: base,
      maxRetries: 0,
      sleep: noSleep,
    });
    await expect(fn([], {})).rejects.toThrow("ECONNRESET");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff between retries", async () => {
    const delays = [];
    const sleep = (ms) => {
      delays.push(ms);
      return Promise.resolve();
    };
    const base = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const fn = makeRetryingChatFn({
      baseChatFn: base,
      maxRetries: 3,
      baseDelayMs: 100,
      sleep,
    });
    await expect(fn([], {})).rejects.toThrow();
    // 3 retries → 3 sleeps: 100, 200, 400 (doubling)
    expect(delays).toEqual([100, 200, 400]);
  });

  it("passes messages and options through to the base chatFn unchanged", async () => {
    const base = vi.fn().mockResolvedValue({ ok: true });
    const fn = makeRetryingChatFn({ baseChatFn: base, sleep: noSleep });
    const messages = [{ role: "user", content: "x" }];
    const options = { model: "m", temperature: 0.3 };
    await fn(messages, options);
    expect(base).toHaveBeenCalledWith(messages, options);
  });
});

describe("makeRetryingChatFn composed inside makeFallbackChatFn", () => {
  it("exhausts same-model retries before advancing to the fallback model", async () => {
    const calls = [];
    const base = vi.fn(async (_messages, options) => {
      calls.push(options.model);
      if (options.model === "primary") throw new Error("ECONNRESET");
      return { message: { content: `from ${options.model}` } };
    });
    const retrying = makeRetryingChatFn({
      baseChatFn: base,
      maxRetries: 2,
      sleep: noSleep,
    });
    const withFallback = makeFallbackChatFn({
      fallbackModels: ["backup"],
      baseChatFn: retrying,
    });
    const out = await withFallback([], { model: "primary" });
    expect(out).toEqual({ message: { content: "from backup" } });
    // primary tried 3 times (initial + 2 retries), then backup once.
    expect(calls).toEqual(["primary", "primary", "primary", "backup"]);
  });
});
