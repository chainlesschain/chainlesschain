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
