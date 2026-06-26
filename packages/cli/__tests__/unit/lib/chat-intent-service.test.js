import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock for chat-core — vitest 4 strict mode requires every named
// export the SUT imports. chat-intent-service only pulls `chatWithStreaming`.
// Use vi.hoisted so the mock fn is created BEFORE vi.mock's factory runs.
const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));
vi.mock("../../../src/lib/chat-core.js", () => ({
  chatWithStreaming: chatMock,
}));

// Import AFTER vi.mock so the mock is in place when the module evaluates.
import {
  understandIntent,
  classifyFollowupIntent,
  _internal,
} from "../../../src/lib/chat-intent-service.js";

const validLlmOptions = {
  provider: "ollama",
  model: "qwen2.5:7b",
  baseUrl: "http://localhost:11434",
  apiKey: null,
};

describe("chat-intent-service", () => {
  beforeEach(() => {
    chatMock.mockReset();
  });

  // ------------------------------------------------------------
  // _internal helpers
  // ------------------------------------------------------------
  describe("_internal.extractJson", () => {
    it("extracts ```json fenced block", () => {
      const text = 'noise\n```json\n{"a":1}\n```\nmore';
      expect(_internal.extractJson(text)).toBe('{"a":1}');
    });
    it("extracts plain ``` fenced block", () => {
      const text = '```\n{"a":2}\n```';
      expect(_internal.extractJson(text)).toBe('{"a":2}');
    });
    it("falls back to bare braces", () => {
      expect(_internal.extractJson('prefix {"x":3} suffix')).toBe('{"x":3}');
    });
    it("stops at the first balanced object despite trailing prose with a stray }", () => {
      // 旧贪婪 /\{[\s\S]*\}/ 会吃到末尾散文里那个落单的 } → 下游 JSON.parse 抛错。
      expect(
        _internal.extractJson('好的 {"intent":"search"} 希望有帮助 }'),
      ).toBe('{"intent":"search"}');
    });
    it("returns null when no JSON present", () => {
      expect(_internal.extractJson("no json at all")).toBeNull();
      expect(_internal.extractJson("")).toBeNull();
      expect(_internal.extractJson(null)).toBeNull();
    });
  });

  describe("_internal.buildUnderstandPrompts", () => {
    it("includes the user input verbatim", () => {
      const { userPrompt } = _internal.buildUnderstandPrompts(
        "fix login bug",
        "project",
      );
      expect(userPrompt).toContain("fix login bug");
    });
    it("falls back to 'global' when contextMode is empty", () => {
      const { userPrompt } = _internal.buildUnderstandPrompts("hi", "");
      expect(userPrompt).toContain("global");
    });
    it("emits the JSON contract in the system prompt", () => {
      const { systemPrompt } = _internal.buildUnderstandPrompts("hi", "global");
      expect(systemPrompt).toContain("correctedInput");
      expect(systemPrompt).toContain("intent");
      expect(systemPrompt).toContain("keyPoints");
    });
  });

  describe("_internal.ruleBasedClassify", () => {
    it("empty input → CONTINUE_EXECUTION (high confidence)", () => {
      const r = _internal.ruleBasedClassify("");
      expect(r.intent).toBe("CONTINUE_EXECUTION");
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
    });
    it("'继续' pure match → CONTINUE_EXECUTION 1.0", () => {
      const r = _internal.ruleBasedClassify("继续");
      expect(r.intent).toBe("CONTINUE_EXECUTION");
      expect(r.confidence).toBe(1.0);
    });
    it("'算了' → CANCEL_TASK 1.0", () => {
      const r = _internal.ruleBasedClassify("算了");
      expect(r.intent).toBe("CANCEL_TASK");
      expect(r.confidence).toBe(1.0);
    });
    it("'改成红色' → MODIFY_REQUIREMENT", () => {
      const r = _internal.ruleBasedClassify("改成红色");
      expect(r.intent).toBe("MODIFY_REQUIREMENT");
    });
    it("'标题用宋体' → CLARIFICATION", () => {
      const r = _internal.ruleBasedClassify("标题用宋体");
      expect(r.intent).toBe("CLARIFICATION");
    });
    it("'正文采用黑体颜色' → CLARIFICATION (de-catastrophized 用…颜色 pattern still matches)", () => {
      const r = _internal.ruleBasedClassify("正文采用黑体颜色");
      expect(r.intent).toBe("CLARIFICATION");
    });
    it("does not catastrophically backtrack on a huge adversarial input (ReDoS guard)", () => {
      // Before the fix, ~2 KB of "用" took ~3 s on one CLARIFICATION pattern.
      const huge = "用".repeat(500_000);
      const t = Date.now();
      const r = _internal.ruleBasedClassify(huge);
      const ms = Date.now() - t;
      expect(ms).toBeLessThan(500); // bounded by input cap + non-exp regex
      expect(typeof r.intent).toBe("string");
    });
  });

  // ------------------------------------------------------------
  // understandIntent
  // ------------------------------------------------------------
  describe("understandIntent", () => {
    it("throws when userInput is empty", async () => {
      await expect(
        understandIntent({ userInput: "", llmOptions: validLlmOptions }),
      ).rejects.toThrow(/required/i);
    });

    it("returns success=false fallback when no llmOptions provided", async () => {
      const result = await understandIntent({
        userInput: "hello",
        contextMode: "project",
      });
      expect(result.success).toBe(false);
      expect(result.correctedInput).toBe("hello");
      expect(result.intent).toBe("general");
      expect(result.keyPoints).toEqual([]);
      expect(chatMock).not.toHaveBeenCalled();
    });

    it("parses fenced JSON LLM response into success=true", async () => {
      chatMock.mockResolvedValueOnce(
        '```json\n{"correctedInput":"fix login","intent":"修复登录","keyPoints":["登录","bug"]}\n```',
      );
      const result = await understandIntent({
        userInput: "fxi loign bug",
        contextMode: "project",
        llmOptions: validLlmOptions,
      });
      expect(result.success).toBe(true);
      expect(result.correctedInput).toBe("fix login");
      expect(result.intent).toBe("修复登录");
      expect(result.keyPoints).toEqual(["登录", "bug"]);
      expect(chatMock).toHaveBeenCalledTimes(1);
      // Verify temperature is conservative (V5 parity).
      const opts = chatMock.mock.calls[0][1];
      expect(opts.temperature).toBeLessThanOrEqual(0.3);
    });

    it("falls back gracefully when LLM returns malformed content", async () => {
      chatMock.mockResolvedValueOnce("totally not json");
      const result = await understandIntent({
        userInput: "anything",
        llmOptions: validLlmOptions,
      });
      expect(result.success).toBe(false);
      expect(result.correctedInput).toBe("anything");
      expect(result.intent).toBe("general");
    });

    it("falls back when chatWithStreaming throws", async () => {
      chatMock.mockRejectedValueOnce(new Error("network"));
      const result = await understandIntent({
        userInput: "x",
        llmOptions: validLlmOptions,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/network/);
    });
  });

  // ------------------------------------------------------------
  // classifyFollowupIntent
  // ------------------------------------------------------------
  describe("classifyFollowupIntent", () => {
    it("rule-only path when input matches a high-confidence rule", async () => {
      const r = await classifyFollowupIntent({ input: "继续" });
      expect(r.intent).toBe("CONTINUE_EXECUTION");
      expect(r.method).toBe("rule");
      expect(chatMock).not.toHaveBeenCalled();
    });

    it("uses 'rule_no_llm' method when ambiguous and no llmOptions", async () => {
      const r = await classifyFollowupIntent({ input: "嗯哼" });
      expect(r.method).toBe("rule_no_llm");
      expect(chatMock).not.toHaveBeenCalled();
    });

    it("invokes LLM for ambiguous input when llmOptions provided", async () => {
      chatMock.mockResolvedValueOnce(
        '```json\n{"intent":"CLARIFICATION","confidence":0.7,"reason":"detail","extractedInfo":"red"}\n```',
      );
      const r = await classifyFollowupIntent({
        input: "嗯哼",
        llmOptions: validLlmOptions,
      });
      expect(r.method).toBe("llm");
      expect(r.intent).toBe("CLARIFICATION");
      expect(r.confidence).toBe(0.7);
      expect(r.extractedInfo).toBe("red");
    });

    it("falls back to rule result when LLM throws on ambiguous input", async () => {
      chatMock.mockRejectedValueOnce(new Error("offline"));
      // Pick an input with weak rule signal (confidence ≤ 0.8) so the LLM
      // branch is reached and its failure surfaces as rule_fallback.
      const r = await classifyFollowupIntent({
        input: "嗯哼",
        llmOptions: validLlmOptions,
      });
      expect(r.method).toBe("rule_fallback");
      // 嗯哼 has weak CONTINUE_EXECUTION signal; that's the rule's pick.
      expect(r.intent).toBe("CONTINUE_EXECUTION");
    });

    it("default to CLARIFICATION when both rule and LLM fail", async () => {
      chatMock.mockRejectedValueOnce(new Error("offline"));
      // Input matches no rule keywords / patterns.
      const r = await classifyFollowupIntent({
        input: "😀😀😀",
        llmOptions: validLlmOptions,
      });
      expect(["CLARIFICATION", "CONTINUE_EXECUTION"]).toContain(r.intent);
      // `latency` is always set so the caller can log telemetry.
      expect(typeof r.latency).toBe("number");
    });
  });

  // ------------------------------------------------------------
  // Intent-classification timeout (DEFAULT_INTENT_TIMEOUT_MS was declared but
  // never enforced — a slow LLM could block intent classification for minutes).
  // ------------------------------------------------------------
  describe("_internal.resolveIntentTimeout", () => {
    it("defaults to 15s and honors a positive override", () => {
      expect(_internal.resolveIntentTimeout(undefined)).toBe(
        _internal.DEFAULT_INTENT_TIMEOUT_MS,
      );
      expect(_internal.resolveIntentTimeout({})).toBe(15000);
      expect(_internal.resolveIntentTimeout({ intentTimeoutMs: 500 })).toBe(
        500,
      );
    });
    it("treats explicit 0 as disabled and NaN/negative as the default", () => {
      expect(_internal.resolveIntentTimeout({ intentTimeoutMs: 0 })).toBe(0);
      expect(_internal.resolveIntentTimeout({ intentTimeoutMs: -5 })).toBe(
        15000,
      );
      expect(_internal.resolveIntentTimeout({ intentTimeoutMs: "x" })).toBe(
        15000,
      );
    });
  });

  describe("_internal.withIntentTimeout", () => {
    it("rejects a slow promise once the budget elapses", async () => {
      const slow = new Promise((resolve) => setTimeout(resolve, 1000, "late"));
      await expect(_internal.withIntentTimeout(slow, 20)).rejects.toThrow(
        /timed out after 20ms/,
      );
    });
    it("passes a fast promise through unchanged", async () => {
      await expect(
        _internal.withIntentTimeout(Promise.resolve("ok"), 1000),
      ).resolves.toBe("ok");
    });
    it("disables the cap when ms <= 0 (returns the bare promise)", async () => {
      const p = Promise.resolve("v");
      expect(_internal.withIntentTimeout(p, 0)).toBe(p);
    });
  });

  describe("understandIntent enforces the intent timeout", () => {
    it("falls back gracefully when the LLM call exceeds the budget", async () => {
      // chatWithStreaming hangs well past the (tiny) per-call budget.
      chatMock.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1000, "{}")),
      );
      const r = await understandIntent({
        userInput: "build me a dashboard",
        llmOptions: { ...validLlmOptions, intentTimeoutMs: 20 },
      });
      expect(r.success).toBe(false);
      expect(r.intent).toBe("general");
      expect(r.correctedInput).toBe("build me a dashboard"); // verbatim passthrough
      expect(r.error).toMatch(/timed out/);
    });
  });

  describe("classifyFollowupIntent enforces the intent timeout", () => {
    it("times out the LLM and returns the rule result", async () => {
      chatMock.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 1000, "{}")),
      );
      // "标题颜色" has CLARIFICATION signal (~0.6) but stays below the 0.8
      // short-circuit, so the LLM path runs — and then times out into the rule.
      const r = await classifyFollowupIntent({
        input: "标题颜色",
        llmOptions: { ...validLlmOptions, intentTimeoutMs: 20 },
      });
      expect(r.method).toBe("rule_fallback");
    });
  });
});
