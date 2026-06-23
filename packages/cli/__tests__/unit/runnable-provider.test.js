/**
 * Runnable-first model/provider selection — never auto-switch onto a provider
 * with no usable key (the "fast → claude-haiku with no Anthropic key → 401"
 * trap), and fall back to a provider we can actually run.
 */
import { describe, it, expect } from "vitest";
import {
  hasUsableKey,
  runnableTaskModel,
  pickRunnableProvider,
  isAuthError,
  inferProviderFromBaseUrl,
  makeRunnableProviderFallback,
} from "../../src/lib/runnable-provider.js";

describe("hasUsableKey", () => {
  it("keyless local provider (ollama) is always usable", () => {
    expect(hasUsableKey("ollama", { apiKey: "", env: {} })).toBe(true);
  });
  it("active provider with a configured key is usable", () => {
    expect(hasUsableKey("volcengine", { apiKey: "sk-x", env: {} })).toBe(true);
  });
  it("provider with its env key set is usable (even without a config key)", () => {
    expect(
      hasUsableKey("anthropic", {
        apiKey: "",
        env: { ANTHROPIC_API_KEY: "sk-ant" },
      }),
    ).toBe(true);
  });
  it("no key anywhere → not usable; blank/whitespace keys do not count", () => {
    expect(hasUsableKey("anthropic", { apiKey: "", env: {} })).toBe(false);
    expect(hasUsableKey("anthropic", { apiKey: "   ", env: {} })).toBe(false);
    expect(
      hasUsableKey("anthropic", {
        apiKey: "",
        env: { ANTHROPIC_API_KEY: "  " },
      }),
    ).toBe(false);
  });
  it("a config key only counts for the ACTIVE provider", () => {
    // apiKey belongs to the active provider; for a different one it's ignored.
    expect(
      hasUsableKey("anthropic", { apiKey: "sk-x", isActive: false, env: {} }),
    ).toBe(false);
  });
  it("unknown provider → not usable", () => {
    expect(hasUsableKey("nope", { apiKey: "sk-x", env: {} })).toBe(false);
  });
});

describe("runnableTaskModel (the haiku-401 guard)", () => {
  it("switches when the provider is runnable", () => {
    expect(
      runnableTaskModel({
        provider: "volcengine",
        currentModel: "doubao-seed-1-6-251015",
        recommended: "doubao-seed-1-6-lite-251015",
        apiKey: "sk-x",
        env: {},
      }),
    ).toBe("doubao-seed-1-6-lite-251015");
  });
  it("does NOT switch onto claude-haiku when there's no Anthropic key", () => {
    expect(
      runnableTaskModel({
        provider: "anthropic",
        currentModel: "claude-sonnet-4-6",
        recommended: "claude-haiku-4-5-20251001",
        apiKey: "",
        env: {},
      }),
    ).toBeNull();
  });
  it("null when nothing recommended or no change", () => {
    expect(
      runnableTaskModel({ provider: "volcengine", recommended: null }),
    ).toBeNull();
    expect(
      runnableTaskModel({
        provider: "volcengine",
        currentModel: "m",
        recommended: "m",
        apiKey: "sk-x",
      }),
    ).toBeNull();
  });
});

describe("pickRunnableProvider (runnable-first fallback)", () => {
  it("keeps the configured provider when it has a key", () => {
    expect(
      pickRunnableProvider({ provider: "volcengine", apiKey: "sk-x", env: {} }),
    ).toMatchObject({ provider: "volcengine", runnable: true });
  });
  it("falls back to a provider whose env key is set", () => {
    expect(
      pickRunnableProvider({
        provider: "anthropic",
        apiKey: "",
        env: { VOLCENGINE_API_KEY: "sk-v" },
      }),
    ).toMatchObject({ provider: "volcengine", fellBackFrom: "anthropic" });
  });
  it("falls back to keyless ollama when no keyed provider exists", () => {
    expect(
      pickRunnableProvider({ provider: "anthropic", apiKey: "", env: {} }),
    ).toMatchObject({ provider: "ollama", keyless: true });
  });
});

describe("isAuthError", () => {
  it("detects 401/403 by status and common messages", () => {
    expect(isAuthError({ status: 401 })).toBe(true);
    expect(isAuthError({ statusCode: 403 })).toBe(true);
    expect(isAuthError(new Error("anthropic API error: HTTP 401"))).toBe(true);
    expect(isAuthError(new Error("API key required for anthropic"))).toBe(true);
    expect(isAuthError(new Error("authentication failed"))).toBe(true);
    expect(isAuthError(new Error("invalid api key"))).toBe(true);
  });
  it("ignores non-auth errors", () => {
    expect(isAuthError(new Error("ECONNRESET"))).toBe(false);
    expect(isAuthError({ status: 500 })).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe("inferProviderFromBaseUrl", () => {
  it("maps a known endpoint host to its provider", () => {
    expect(
      inferProviderFromBaseUrl("https://ark.cn-beijing.volces.com/api/v3"),
    ).toBe("volcengine");
    expect(inferProviderFromBaseUrl("https://api.anthropic.com/v1")).toBe(
      "anthropic",
    );
    expect(inferProviderFromBaseUrl("https://api.openai.com/v1")).toBe(
      "openai",
    );
  });
  it("returns null for unknown / empty", () => {
    expect(inferProviderFromBaseUrl("https://example.com")).toBeNull();
    expect(inferProviderFromBaseUrl("")).toBeNull();
    expect(inferProviderFromBaseUrl(null)).toBeNull();
  });
});

describe("makeRunnableProviderFallback", () => {
  it("heals a mislabeled config: provider=anthropic but volces baseUrl → volcengine", async () => {
    const seen = [];
    const fb = [];
    // throws auth on anthropic, succeeds once provider matches the baseUrl
    const chatFn = async (_msgs, opts) => {
      seen.push(opts.provider);
      if (opts.provider === "anthropic") {
        throw new Error("API key required for anthropic");
      }
      return { message: { role: "assistant", content: "ok" }, _opts: opts };
    };
    const wrapped = makeRunnableProviderFallback(chatFn, {
      env: {},
      onFallback: (i) => fb.push(i),
    });
    const out = await wrapped([], {
      provider: "anthropic",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "sk-volc",
      model: "haiku",
    });
    expect(seen).toEqual(["anthropic", "volcengine"]);
    expect(out._opts.provider).toBe("volcengine");
    expect(out._opts.apiKey).toBe("sk-volc"); // same key + baseUrl kept
    expect(out._opts.model).toBe("doubao-seed-2-1-pro-260628"); // provider default
    expect(fb[0]).toMatchObject({
      from: "anthropic",
      to: "volcengine",
      reason: "baseurl-mismatch",
    });
  });

  it("falls back to an env-keyed provider when the endpoint is unknown", async () => {
    const seen = [];
    const chatFn = async (_msgs, opts) => {
      seen.push(opts.provider);
      if (opts.provider === "anthropic") throw new Error("401 unauthorized");
      return { message: { content: "ok" }, _opts: opts };
    };
    const wrapped = makeRunnableProviderFallback(chatFn, {
      env: { VOLCENGINE_API_KEY: "sk-v" },
    });
    const out = await wrapped([], {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
    });
    expect(out._opts.provider).toBe("volcengine");
    expect(out._opts.apiKey).toBe("sk-v");
  });

  it("does NOT hijack an explicitly-keyed provider to another vendor on auth error", async () => {
    // Recurring "configured volcengine but it ran Claude/haiku" trap: a
    // volcengine 401 with a PRESENT volcengine key must surface as-is, never
    // silently switch onto anthropic just because ANTHROPIC_API_KEY is in the
    // env (which would spend on a different account and run claude-haiku).
    let calls = 0;
    const chatFn = async (_msgs, opts) => {
      calls++;
      if (opts.provider === "volcengine") throw new Error("401 unauthorized");
      return { message: { content: "ok" }, _opts: opts };
    };
    const wrapped = makeRunnableProviderFallback(chatFn, {
      env: { ANTHROPIC_API_KEY: "sk-ant" },
    });
    await expect(
      wrapped([], {
        provider: "volcengine",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "sk-volc-present",
        model: "doubao-seed-2-1-pro-260628",
      }),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1); // no second (anthropic) attempt — no vendor hijack
  });

  it("rethrows the auth error when nowhere runnable to go", async () => {
    const chatFn = async () => {
      throw new Error("API key required for anthropic");
    };
    const wrapped = makeRunnableProviderFallback(chatFn, { env: {} });
    await expect(
      wrapped([], {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
      }),
    ).rejects.toThrow(/API key required/);
  });

  it("passes non-auth errors straight through (no retry)", async () => {
    let calls = 0;
    const chatFn = async () => {
      calls++;
      throw new Error("ECONNRESET");
    };
    const wrapped = makeRunnableProviderFallback(chatFn, {
      env: { VOLCENGINE_API_KEY: "sk-v" },
    });
    await expect(wrapped([], { provider: "anthropic" })).rejects.toThrow(
      /ECONNRESET/,
    );
    expect(calls).toBe(1);
  });

  it("happy path: returns the first result untouched", async () => {
    const chatFn = async () => ({ message: { content: "hi" } });
    const wrapped = makeRunnableProviderFallback(chatFn, { env: {} });
    expect(
      await wrapped([], { provider: "volcengine", apiKey: "sk-v" }),
    ).toEqual({
      message: { content: "hi" },
    });
  });
});

describe("makeRunnableProviderFallback — sticky resolution + dedup", () => {
  it("skips the known-bad provider on later turns and warns only once", async () => {
    const seen = [];
    const fb = [];
    const chatFn = async (_msgs, opts) => {
      seen.push(opts.provider);
      if (opts.provider === "anthropic")
        throw new Error("API key required for anthropic");
      return { message: { content: "ok" }, _opts: opts };
    };
    const wrapped = makeRunnableProviderFallback(chatFn, {
      env: {},
      onFallback: (i) => fb.push(i),
    });
    const opts = {
      provider: "anthropic",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      apiKey: "sk-volc",
      model: "haiku",
    };
    // Turn 1: attempts anthropic (fails) → volcengine.
    await wrapped([], opts);
    // Turn 2 + 3: route straight to volcengine, no wasted anthropic attempt.
    await wrapped([], opts);
    await wrapped([], opts);
    expect(seen).toEqual([
      "anthropic",
      "volcengine",
      "volcengine",
      "volcengine",
    ]);
    // The fallback was announced exactly once despite three turns.
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ from: "anthropic", to: "volcengine" });
  });

  it("still works (and is sticky) for env-key fallback across turns", async () => {
    const seen = [];
    const chatFn = async (_msgs, opts) => {
      seen.push(opts.provider);
      if (opts.provider === "anthropic") throw new Error("401 unauthorized");
      return { message: { content: "ok" }, _opts: opts };
    };
    const wrapped = makeRunnableProviderFallback(chatFn, {
      env: { VOLCENGINE_API_KEY: "sk-v" },
    });
    const opts = {
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      apiKey: "",
    };
    await wrapped([], opts);
    await wrapped([], opts);
    expect(seen).toEqual(["anthropic", "volcengine", "volcengine"]);
  });

  it("a genuinely healthy provider never becomes sticky", async () => {
    const seen = [];
    const chatFn = async (_msgs, opts) => {
      seen.push(opts.provider);
      return { message: { content: "hi" }, _opts: opts };
    };
    const wrapped = makeRunnableProviderFallback(chatFn, { env: {} });
    await wrapped([], { provider: "volcengine", apiKey: "sk-v" });
    await wrapped([], { provider: "volcengine", apiKey: "sk-v" });
    expect(seen).toEqual(["volcengine", "volcengine"]);
  });
});
