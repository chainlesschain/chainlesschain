import { describe, it, expect } from "vitest";
import {
  deepMerge,
  inferModelOverrides,
  mergeProviderOptions,
  PROVIDER_DEFAULTS,
} from "../../src/lib/provider-options.js";

describe("provider-options — deepMerge", () => {
  it("merges nested plain objects recursively", () => {
    const out = deepMerge(
      { a: 1, nested: { x: 1, y: 1 } },
      { b: 2, nested: { y: 2, z: 3 } },
    );
    expect(out).toEqual({ a: 1, b: 2, nested: { x: 1, y: 2, z: 3 } });
  });

  it("later arrays replace earlier ones (not concat)", () => {
    const out = deepMerge({ arr: [1, 2, 3] }, { arr: [9] });
    expect(out.arr).toEqual([9]);
  });

  it("undefined in later layer erases key", () => {
    const out = deepMerge({ a: 1, b: 2 }, { b: undefined });
    expect(out).toEqual({ a: 1 });
  });

  it("ignores non-plain layers (null/array/undefined)", () => {
    const out = deepMerge({ a: 1 }, null, undefined, [1, 2]);
    expect(out).toEqual({ a: 1 });
  });
});

describe("provider-options — inferModelOverrides", () => {
  it("returns {} for unknown model", () => {
    expect(inferModelOverrides("some-random-model")).toEqual({});
  });

  it("strips temperature for o1/o3 reasoning models", () => {
    const out = inferModelOverrides("o1-preview");
    expect(out.temperature).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "medium" });
  });

  it("enables thinking for claude-opus-*", () => {
    const out = inferModelOverrides("claude-opus-4-6");
    expect(out.anthropic.thinking.type).toBe("enabled");
    expect(out.maxTokens).toBe(16384);
  });

  it("uses smaller maxTokens for haiku", () => {
    expect(inferModelOverrides("claude-haiku-4-5").maxTokens).toBe(4096);
  });

  it("bumps deepseek-reasoner capacity + reasoning", () => {
    const out = inferModelOverrides("deepseek-reasoner");
    expect(out.maxTokens).toBe(8192);
    expect(out.reasoning.enabled).toBe(true);
  });

  it("safe on empty/null input", () => {
    expect(inferModelOverrides("")).toEqual({});
    expect(inferModelOverrides(null)).toEqual({});
  });
});

describe("provider-options — mergeProviderOptions", () => {
  it("three-layer merge: defaults ← model inference ← call overrides", () => {
    const out = mergeProviderOptions("anthropic", "claude-opus-4-6", {
      maxTokens: 32768,
      anthropic: { thinking: { budgetTokens: 12000 } },
    });
    // call override wins at maxTokens
    expect(out.maxTokens).toBe(32768);
    // thinking.type from model layer preserved, budgetTokens overridden
    expect(out.anthropic.thinking).toEqual({
      type: "enabled",
      budgetTokens: 12000,
    });
  });

  it("call override can disable a default via explicit undefined", () => {
    const out = mergeProviderOptions("openai", "o1-preview", {});
    // model layer sets temperature: undefined → erased
    expect(out).not.toHaveProperty("temperature");
  });

  it("unknown provider still merges model + call layers", () => {
    const out = mergeProviderOptions("mystery", "claude-haiku-4-5", {
      foo: 1,
    });
    expect(out).toEqual({ maxTokens: 4096, foo: 1 });
  });

  it("empty call overrides returns defaults+model layer", () => {
    const out = mergeProviderOptions("anthropic", "claude-sonnet-4-6");
    expect(out.maxTokens).toBe(PROVIDER_DEFAULTS.anthropic.maxTokens);
    expect(out.temperature).toBe(1.0);
    // sonnet doesn't match any model-inference rule → thinking stays disabled
    expect(out.anthropic.thinking.type).toBe("disabled");
  });
});
