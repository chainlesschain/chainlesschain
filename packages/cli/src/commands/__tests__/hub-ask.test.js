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

const { cmdAsk, cmdRetrieveContext, parsePositiveInt } = _internal;

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

  // Question text must pass through verbatim — AnalysisEngine.ask is the
  // single place that runs parseQuery + intent routing (latest narrow / list
  // FTS / sum-amount narrow / count TOTALS). If the CLI ever pre-normalizes
  // the question (lowercase / strip punctuation / truncate), routing would
  // misclassify or miss entity extraction. This case is the canary.
  it("passes question text to engine.ask verbatim (no CLI-side preprocessing)", async () => {
    const { askSpy, _getHub } = makeStubHub();
    const cases = [
      "最近的订单", // intent=latest (narrow path)
      "最近 30 天的消费", // intent=latest + timeWindow (fallthrough)
      "提到王老板的微信消息", // intent=list + entity (FTS augment)
      "上个月在淘宝总共花了多少？", // intent=sum-amount (4-subtype narrow)
      "我有几个联系人", // intent=count (TOTALS bypass)
    ];
    for (const q of cases) {
      askSpy.mockClear();
      await cmdAsk(q, { json: true, _getHub });
      expect(askSpy).toHaveBeenCalledTimes(1);
      expect(askSpy.mock.calls[0][0]).toBe(q);
    }
  });
});

// ─── retrieve-context (LLM-free RAG preflight, cloud-LLM bridge) ────────
//
// Bridges Android CLOUD_ANDROID route to RAG. Caller spawns this command
// to get { messages, factIds, ... } then POSTs `messages` to the cloud
// provider (Doubao / DeepSeek / Kimi / etc.) directly. NO LLM here.

function makeStubHubWithRetrieve() {
  const retrieveSpy = vi.fn(async (q, opts) => ({
    question: q,
    parsed: {
      raw: q,
      intent: "list",
      entityFocus: null,
      timeWindow: null,
      filters: {},
    },
    facts: [],
    factIds: [],
    factCount: 0,
    truncated: 0,
    ragContextIds: [],
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: `USER QUESTION: ${q}` },
    ],
    systemPrompt: "system prompt",
    retrievedAt: 0,
    durationMs: 1,
    _maxFactsSeen: opts?.maxFacts,
    _maxQueryLimitSeen: opts?.maxQueryLimit,
  }));
  return {
    retrieveSpy,
    _getHub: async () => ({ engine: { retrieveContext: retrieveSpy } }),
  };
}

describe("cc hub retrieve-context", () => {
  it("forwards parsed budget to engine.retrieveContext()", async () => {
    const { retrieveSpy, _getHub } = makeStubHubWithRetrieve();
    await cmdRetrieveContext("我有哪些联系人", {
      maxFacts: "20",
      maxQueryLimit: "50",
      _getHub,
    });
    expect(retrieveSpy).toHaveBeenCalledTimes(1);
    const [q, opts] = retrieveSpy.mock.calls[0];
    expect(q).toBe("我有哪些联系人");
    expect(opts.maxFacts).toBe(20);
    expect(opts.maxQueryLimit).toBe(50);
    // skipAudit=false by default — retrieve writes its own audit row distinct
    // from ask's, so the desktop / Android side can tell apart "LLM-free
    // preflight" vs "full ask" in audit_log filter views.
    expect(opts.skipAudit).toBe(false);
  });

  it("outputs JSON unconditionally (machine-only command)", async () => {
    const { _getHub } = makeStubHubWithRetrieve();
    await cmdRetrieveContext("hello", { _getHub });
    expect(logSpy).toHaveBeenCalled();
    const printed = logSpy.mock.calls[0][0];
    // printJson stringifies the result; basic shape check.
    const parsed = JSON.parse(printed);
    expect(parsed).toHaveProperty("messages");
    expect(parsed).toHaveProperty("factIds");
    expect(Array.isArray(parsed.messages)).toBe(true);
  });

  it("omits maxFacts/maxQueryLimit when flags absent (engine uses defaults)", async () => {
    const { retrieveSpy, _getHub } = makeStubHubWithRetrieve();
    await cmdRetrieveContext("hello", { _getHub });
    const [, opts] = retrieveSpy.mock.calls[0];
    expect(opts).not.toHaveProperty("maxFacts");
    expect(opts).not.toHaveProperty("maxQueryLimit");
  });

  it("does NOT touch acceptNonLocal (no LLM call → no privacy gate here)", async () => {
    const { retrieveSpy, _getHub } = makeStubHubWithRetrieve();
    // Even if env demanding non-local, retrieve-context still runs — the
    // caller's own LLM provider is the gate. Verify retrieveContext was
    // called without acceptNonLocal being forwarded.
    process.env.CC_HUB_ALLOW_NON_LOCAL = "1";
    await cmdRetrieveContext("hello", { _getHub });
    const [, opts] = retrieveSpy.mock.calls[0];
    expect(opts).not.toHaveProperty("acceptNonLocal");
  });

  it("exits 1 with JSON error envelope when engine throws", async () => {
    const errGetHub = async () => ({
      engine: {
        retrieveContext: async () => {
          throw new Error("vault not open");
        },
      },
    });
    await cmdRetrieveContext("hello", { _getHub: errGetHub });
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errPrinted = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(errPrinted);
    expect(parsed.error).toMatch(/vault not open/);
  });
});
