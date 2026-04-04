import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock feature-flags
let mockFlags = {};
vi.mock("../../src/lib/feature-flags.js", () => ({
  feature: (name) => mockFlags[name] ?? false,
}));

const { PromptCompressor, estimateTokens, estimateMessagesTokens } =
  await import("../../src/lib/prompt-compressor.js");

// ── Helpers ─────────────────────────────────────────────────────────────

function makeMessages(count, { withTools = false } = {}) {
  const msgs = [{ role: "system", content: "You are an AI assistant." }];
  for (let i = 0; i < count; i++) {
    msgs.push({ role: "user", content: `User message ${i}` });
    if (withTools && i % 2 === 0) {
      msgs.push({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: `call_${i}`, function: { name: `tool_${i}`, arguments: "{}" } },
        ],
      });
      msgs.push({ role: "tool", content: `Result for tool_${i}` });
    }
    msgs.push({ role: "assistant", content: `Response to message ${i}` });
  }
  return msgs;
}

// ── estimateTokens ──────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty/null", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("estimates English text (~4 chars/token)", () => {
    const tokens = estimateTokens("Hello world"); // 11 chars
    expect(tokens).toBe(3); // ceil(11/4)
  });

  it("estimates Chinese text (~1.5 chars/token)", () => {
    const tokens = estimateTokens("你好世界"); // 4 Chinese chars
    expect(tokens).toBe(3); // ceil(4/1.5)
  });

  it("handles mixed content", () => {
    const tokens = estimateTokens("Hello 你好"); // 6 other + 2 Chinese
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("estimateMessagesTokens", () => {
  it("sums tokens across messages", () => {
    const msgs = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "World" },
    ];
    const total = estimateMessagesTokens(msgs);
    expect(total).toBe(estimateTokens("Hello") + estimateTokens("World"));
  });

  it("handles non-string content", () => {
    const msgs = [{ role: "user", content: { key: "value" } }];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });
});

// ── PromptCompressor ────────────────────────────────────────────────────

describe("PromptCompressor", () => {
  let compressor;

  beforeEach(() => {
    mockFlags = { PROMPT_COMPRESSOR: true };
    compressor = new PromptCompressor({ maxMessages: 10, maxTokens: 2000 });
  });

  describe("compress() — basic", () => {
    it("returns messages as-is when <= 2", async () => {
      const msgs = [{ role: "system", content: "sys" }];
      const { messages } = await compressor.compress(msgs);
      expect(messages).toHaveLength(1);
    });

    it("returns strategy none for short conversations", async () => {
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ];
      const { stats } = await compressor.compress(msgs);
      expect(stats.strategy).toBe("none");
    });
  });

  // ── Strategy 1: Deduplication ───────────────────────────────────────

  describe("deduplication", () => {
    it("removes exact duplicate messages", async () => {
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "same question" },
        { role: "assistant", content: "same answer" },
        { role: "user", content: "different question" },
        { role: "assistant", content: "same answer" },
        { role: "user", content: "final question" },
      ];
      const { messages, stats } = await compressor.compress(msgs);
      // "same answer" appears twice, one should be removed
      expect(messages.length).toBeLessThan(msgs.length);
      expect(stats.strategy).toContain("dedup");
    });

    it("preserves system and last user message", async () => {
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "dup" },
        { role: "assistant", content: "a" },
        { role: "user", content: "dup" },
      ];
      const { messages } = await compressor.compress(msgs);
      expect(messages[0].content).toBe("sys");
      expect(messages[messages.length - 1].content).toBe("dup");
    });
  });

  // ── Strategy 2: Truncation ──────────────────────────────────────────

  describe("truncation", () => {
    it("truncates when exceeding maxMessages", async () => {
      const msgs = makeMessages(15); // ~31 messages + system
      compressor.maxMessages = 10;
      const { messages, stats } = await compressor.compress(msgs);
      expect(messages.length).toBeLessThanOrEqual(10);
      expect(stats.strategy).toContain("truncate");
    });

    it("preserves system prompt after truncation", async () => {
      const msgs = makeMessages(15);
      compressor.maxMessages = 5;
      const { messages } = await compressor.compress(msgs);
      expect(messages[0].role).toBe("system");
    });
  });

  // ── Strategy 3: Summarization ───────────────────────────────────────

  describe("summarization", () => {
    it("calls llmQuery when over token limit", async () => {
      const mockLlm = vi.fn().mockResolvedValue("Summary of conversation");
      compressor.llmQuery = mockLlm;
      compressor.maxTokens = 50; // Very low threshold

      const msgs = makeMessages(8);
      const { messages, stats } = await compressor.compress(msgs);
      expect(mockLlm).toHaveBeenCalled();
      expect(stats.strategy).toContain("summarize");
      expect(
        messages.some((m) => m.content.includes("[Conversation Summary]")),
      ).toBe(true);
    });

    it("gracefully handles LLM failure", async () => {
      compressor.llmQuery = vi.fn().mockRejectedValue(new Error("LLM down"));
      compressor.maxTokens = 10;

      const msgs = makeMessages(3);
      const { messages } = await compressor.compress(msgs);
      // Should still return something, just without summarization
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  // ── Strategy 4: Snip Compact ────────────────────────────────────────

  describe("snipCompact", () => {
    it("removes stale markers when flag enabled", async () => {
      mockFlags.CONTEXT_SNIP = true;
      const msgs = [
        { role: "system", content: "sys" },
        { role: "assistant", content: "[PROCESSED] old result" },
        { role: "assistant", content: "" },
        { role: "tool", content: "ok" },
        { role: "user", content: "msg1" },
        { role: "assistant", content: "resp1" },
        { role: "user", content: "msg2" },
        { role: "assistant", content: "resp2" },
      ];
      const { messages, stats } = await compressor.compress(msgs);
      expect(messages.length).toBeLessThan(msgs.length);
      expect(stats.strategy).toContain("snip");
    });

    it("does nothing when flag disabled", async () => {
      mockFlags.CONTEXT_SNIP = false;
      const msgs = [
        { role: "system", content: "sys" },
        { role: "assistant", content: "[PROCESSED] old" },
        { role: "user", content: "q1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "q2" },
        { role: "assistant", content: "a2" },
      ];
      const { messages } = await compressor.compress(msgs);
      // [PROCESSED] message should still be there (not snipped)
      expect(messages.some((m) => m.content.includes("[PROCESSED]"))).toBe(
        true,
      );
    });

    it("preserves last 4 messages untouched", async () => {
      mockFlags.CONTEXT_SNIP = true;
      const msgs = [
        { role: "system", content: "sys" },
        { role: "tool", content: "ok" },
        { role: "tool", content: "{}" },
        { role: "user", content: "keep1" },
        { role: "assistant", content: "keep2" },
        { role: "user", content: "keep3" },
        { role: "assistant", content: "keep4" },
      ];
      const { messages } = await compressor.compress(msgs);
      // The stale tool messages "ok" and "{}" should be snipped from middle
      // Last 4 should be preserved (they are the tail in snip)
      const contents = messages.map((m) => m.content);
      expect(contents).toContain("keep1");
      expect(contents).toContain("keep2");
      expect(contents).toContain("keep3");
      expect(contents).toContain("keep4");
      // Stale tools should be gone
      expect(contents).not.toContain("ok");
      expect(contents).not.toContain("{}");
    });
  });

  // ── Strategy 5: Context Collapse ────────────────────────────────────

  describe("contextCollapse", () => {
    it("collapses consecutive tool sequences when flag enabled", async () => {
      mockFlags.CONTEXT_COLLAPSE = true;
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "do something" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "1", function: { name: "read_file", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "file content here" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "2", function: { name: "write_file", arguments: "{}" } },
          ],
        },
        { role: "tool", content: "written ok" },
        { role: "user", content: "now what" },
        { role: "assistant", content: "done" },
        { role: "user", content: "thanks" },
        { role: "assistant", content: "welcome" },
      ];
      const { messages, stats } = await compressor.compress(msgs);
      expect(messages.length).toBeLessThan(msgs.length);
      expect(stats.strategy).toContain("collapse");
      expect(messages.some((m) => m.content.includes("[Collapsed"))).toBe(true);
    });

    it("does nothing when flag disabled", async () => {
      mockFlags.CONTEXT_COLLAPSE = false;
      const msgs = makeMessages(5, { withTools: true });
      const { stats } = await compressor.compress(msgs);
      expect(stats.strategy).not.toContain("collapse");
    });
  });

  // ── shouldAutoCompact ───────────────────────────────────────────────

  describe("shouldAutoCompact", () => {
    it("returns true when messages exceed maxMessages", () => {
      const msgs = makeMessages(15);
      expect(compressor.shouldAutoCompact(msgs)).toBe(true);
    });

    it("returns false for short conversations", () => {
      const msgs = [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ];
      expect(compressor.shouldAutoCompact(msgs)).toBe(false);
    });

    it("returns true when tokens exceed maxTokens", () => {
      compressor.maxTokens = 20;
      const msgs = [
        { role: "system", content: "A".repeat(100) },
        { role: "user", content: "B".repeat(100) },
        { role: "assistant", content: "C".repeat(100) },
      ];
      expect(compressor.shouldAutoCompact(msgs)).toBe(true);
    });
  });

  // ── Combined strategies ─────────────────────────────────────────────

  describe("combined strategies", () => {
    it("applies multiple strategies together", async () => {
      mockFlags.CONTEXT_SNIP = true;
      mockFlags.CONTEXT_COLLAPSE = true;

      const msgs = makeMessages(12, { withTools: true });
      // Add some stale markers
      msgs.splice(2, 0, { role: "assistant", content: "[STALE] old" });
      msgs.splice(3, 0, { role: "tool", content: "ok" });

      const { messages, stats } = await compressor.compress(msgs);
      expect(messages.length).toBeLessThan(msgs.length);
      expect(stats.saved).toBeGreaterThan(0);
    });

    it("stats contain valid ratio", async () => {
      const msgs = makeMessages(8);
      compressor.maxMessages = 5;
      const { stats } = await compressor.compress(msgs);
      expect(stats.ratio).toBeGreaterThan(0);
      expect(stats.ratio).toBeLessThanOrEqual(1);
      expect(stats.originalTokens).toBeGreaterThan(0);
    });
  });
});
