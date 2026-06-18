/**
 * LLMProviderRegistry.testProvider connectivity-probe timeout.
 *
 * `testProvider` sends a tiny "Hi" to verify a provider is reachable; it backs
 * `cc llm test`, provider selection and doctor. A probe that hangs forever
 * defeats its purpose, so it must fail fast with a clear timeout instead of
 * blocking on an unreachable / silent endpoint.
 *
 * CC_PROVIDER_TEST_TIMEOUT_MS is set before importing so the module-level
 * PROVIDER_TEST_TIMEOUT_MS picks up a tiny value (vitest isolates modules/file).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";

process.env.CC_PROVIDER_TEST_TIMEOUT_MS = "60";
const { LLMProviderRegistry, PROVIDER_TEST_TIMEOUT_MS } =
  await import("../../src/lib/llm-providers.js");

describe("testProvider timeout", () => {
  let reg;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    reg = new LLMProviderRegistry(new MockDatabase());
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("picks up CC_PROVIDER_TEST_TIMEOUT_MS", () => {
    expect(PROVIDER_TEST_TIMEOUT_MS).toBe(60);
  });

  it("times out a hung provider probe instead of hanging", async () => {
    // fetch never resolves but honours the abort signal → the timeout rejects.
    globalThis.fetch = (url, opts) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    await expect(reg.testProvider("ollama")).rejects.toThrow(/timed out/i);
  });

  it("returns ok on a healthy probe (control)", async () => {
    globalThis.fetch = () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ response: "hi" }),
      });
    const r = await reg.testProvider("ollama");
    expect(r.ok).toBe(true);
    expect(r.response).toBe("hi");
  });
});
