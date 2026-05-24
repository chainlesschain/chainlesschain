/**
 * `cc hub ask` CLI command — focused unit tests for --max-facts /
 * --max-query-limit flag wiring.
 *
 * Why this test exists: Android-side `LocalCcRunner.askQuestion` defaults to
 * `--max-facts 20 --max-query-limit 50` to keep prompt budget within
 * Qwen2.5-1.5B's effective ~2-4K instruction-following window. If those
 * flags ever silently stop forwarding to `AnalysisEngine.ask()`, on-device
 * answers will start hallucinating because prompts overflow the model. This
 * suite is the canary.
 *
 * Uses the `_getHub` injection seam — no real vault / no spinner side
 * effects.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { _internal } from "../hub.js";

const { cmdAsk, parsePositiveInt } = _internal;

let exitSpy, logSpy;

beforeEach(() => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  exitSpy.mockRestore();
  logSpy.mockRestore();
  delete process.env.CC_HUB_ALLOW_NON_LOCAL;
});

function makeStubHub() {
  const askSpy = vi.fn(async () => ({
    answer: "ok",
    citations: [],
    llmName: "qwen",
    isLocal: true,
  }));
  return {
    askSpy,
    _getHub: async () => ({ engine: { ask: askSpy } }),
  };
}

describe("parsePositiveInt", () => {
  it("returns null for undefined / blank / non-numeric / non-positive", () => {
    expect(parsePositiveInt(undefined)).toBeNull();
    expect(parsePositiveInt(null)).toBeNull();
    expect(parsePositiveInt("")).toBeNull();
    expect(parsePositiveInt("abc")).toBeNull();
    expect(parsePositiveInt("0")).toBeNull();
    expect(parsePositiveInt("-5")).toBeNull();
  });
  it("coerces positive integer strings to numbers", () => {
    expect(parsePositiveInt("20")).toBe(20);
    expect(parsePositiveInt("50")).toBe(50);
    expect(parsePositiveInt("1")).toBe(1);
  });
});

describe("cc hub ask --max-facts / --max-query-limit", () => {
  it("forwards parsed budget to engine.ask()", async () => {
    const { askSpy, _getHub } = makeStubHub();
    await cmdAsk("hello?", {
      json: true,
      maxFacts: "20",
      maxQueryLimit: "50",
      _getHub,
    });
    expect(askSpy).toHaveBeenCalledTimes(1);
    const [q, opts] = askSpy.mock.calls[0];
    expect(q).toBe("hello?");
    expect(opts.maxFacts).toBe(20);
    expect(opts.maxQueryLimit).toBe(50);
  });

  it("omits maxFacts/maxQueryLimit from options when flags absent", async () => {
    const { askSpy, _getHub } = makeStubHub();
    await cmdAsk("hello?", { json: true, _getHub });
    expect(askSpy).toHaveBeenCalledTimes(1);
    const [, opts] = askSpy.mock.calls[0];
    // Caller didn't pass — let engine fall back to constructor defaults.
    expect(opts).not.toHaveProperty("maxFacts");
    expect(opts).not.toHaveProperty("maxQueryLimit");
  });

  it("ignores invalid flag values (typo on cmdline → fallback to defaults)", async () => {
    const { askSpy, _getHub } = makeStubHub();
    await cmdAsk("hello?", {
      json: true,
      maxFacts: "abc",
      maxQueryLimit: "-1",
      _getHub,
    });
    const [, opts] = askSpy.mock.calls[0];
    expect(opts).not.toHaveProperty("maxFacts");
    expect(opts).not.toHaveProperty("maxQueryLimit");
  });

  it("still forwards acceptNonLocal when budget flags present", async () => {
    const { askSpy, _getHub } = makeStubHub();
    await cmdAsk("hello?", {
      json: true,
      maxFacts: "20",
      acceptNonLocal: true,
      _getHub,
    });
    const [, opts] = askSpy.mock.calls[0];
    expect(opts.acceptNonLocal).toBe(true);
    expect(opts.maxFacts).toBe(20);
  });
});
