import { describe, it, expect } from "vitest";
import {
  KNOWN_FAST_MODELS,
  FAST_TRADEOFF,
  parseFastCommand,
  resolveFastPlan,
  renderFastStatus,
} from "../../src/repl/fast-mode.js";

describe("parseFastCommand", () => {
  it("returns null for non-/fast input", () => {
    expect(parseFastCommand("/model x")).toBe(null);
    expect(parseFastCommand("hello")).toBe(null);
    expect(parseFastCommand("/fastidious")).toBe(null);
  });

  it("parses on/off/status/toggle and aliases", () => {
    expect(parseFastCommand("/fast")).toEqual({ action: "toggle" });
    expect(parseFastCommand("/fast on").action).toBe("on");
    expect(parseFastCommand("/fast enable").action).toBe("on");
    expect(parseFastCommand("/fast off").action).toBe("off");
    expect(parseFastCommand("/fast 0").action).toBe("off");
    expect(parseFastCommand("/fast status").action).toBe("status");
    expect(parseFastCommand("/fast toggle").action).toBe("toggle");
  });

  it("reports a bad option", () => {
    expect(parseFastCommand("/fast maybe").error).toMatch(/Unknown/);
  });
});

describe("resolveFastPlan", () => {
  it("is a no-op when disabled", () => {
    const p = resolveFastPlan({
      enabled: false,
      provider: "anthropic",
      model: "m",
    });
    expect(p).toMatchObject({
      enabled: false,
      thinking: null,
      model: "m",
      swapped: false,
    });
  });

  it("minimizes reasoning and swaps to the provider's fast model", () => {
    const p = resolveFastPlan({
      enabled: true,
      provider: "anthropic",
      model: "claude-fable-5",
    });
    expect(p.thinking).toBe("off");
    expect(p.model).toBe(KNOWN_FAST_MODELS.anthropic);
    expect(p.swapped).toBe(true);
    expect(p.tradeoff).toBe(FAST_TRADEOFF);
    expect(p.note).toMatch(/low-latency model/);
  });

  it("never overrides a user-pinned model", () => {
    const p = resolveFastPlan({
      enabled: true,
      provider: "anthropic",
      model: "claude-fable-5",
      modelPinned: true,
    });
    expect(p.thinking).toBe("off");
    expect(p.model).toBe("claude-fable-5");
    expect(p.swapped).toBe(false);
    expect(p.note).toMatch(/pinned model/);
  });

  it("keeps the model when the provider has no known fast sibling", () => {
    const p = resolveFastPlan({
      enabled: true,
      provider: "ollama",
      model: "llama3",
    });
    expect(p.thinking).toBe("off");
    expect(p.model).toBe("llama3");
    expect(p.swapped).toBe(false);
    expect(p.note).toMatch(/reasoning minimized/);
  });

  it("does not report a swap when already on the fast model", () => {
    const p = resolveFastPlan({
      enabled: true,
      provider: "openai",
      model: KNOWN_FAST_MODELS.openai,
    });
    expect(p.swapped).toBe(false);
    expect(p.model).toBe(KNOWN_FAST_MODELS.openai);
  });
});

describe("renderFastStatus", () => {
  it("describes off and on states with the tradeoff", () => {
    expect(renderFastStatus({ enabled: false })).toMatch(/off/);
    const on = renderFastStatus({ enabled: true, provider: "anthropic" });
    expect(on).toMatch(/on/);
    expect(on).toContain(KNOWN_FAST_MODELS.anthropic);
    expect(on).toContain("reasoning minimized");
  });
});
