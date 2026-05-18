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
});
