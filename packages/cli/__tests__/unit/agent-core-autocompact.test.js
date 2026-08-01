/**
 * Headless auto-compaction in `agentLoop` (Claude-Code `--print` parity).
 *
 * When a run's message history grows past the compressor's threshold, the loop
 * compacts it in place at the top of an iteration (a clean tool-pair boundary),
 * emits a `compaction` event, and calls `options.onCompaction`. It is default-on
 * but opt-out via `autoCompact: false` (the interactive REPL opts out). The LLM
 * is mocked; no real provider or network is involved.
 */
import { describe, it, expect, vi } from "vitest";
import { agentLoop } from "../../src/runtime/agent-core.js";

/** A chatFn that immediately returns a final (tool-free) assistant message. */
function finalReplyChatFn() {
  return async () => ({
    message: { role: "assistant", content: "final answer" },
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

/** Seed > threshold messages (default maxMessages = 20 when no model given). */
function seedLargeHistory() {
  const msgs = [{ role: "system", content: "system prompt" }];
  for (let i = 0; i < 18; i++) {
    msgs.push({
      role: "user",
      content: `question ${i} with filler words here`,
    });
    msgs.push({
      role: "assistant",
      content: `answer ${i} with filler words here`,
    });
  }
  msgs.push({ role: "user", content: "the final question" });
  return msgs;
}

async function drain(iterable) {
  const out = [];
  for await (const event of iterable) out.push(event);
  return out;
}

describe("agentLoop headless auto-compaction", () => {
  const structuredSummary = () =>
    JSON.stringify({
      objective: "finish the requested change",
      constraints: ["do not widen permissions"],
      keyDecisions: ["use a session-scoped state model"],
      changedFiles: ["src/a.js"],
      tests: ["unit tests passed"],
      unresolvedSideEffects: [],
      checkpoints: ["checkpoint-1"],
      blockers: [],
      nextSteps: ["run integration tests"],
    });

  it("compacts a large history and emits a compaction event + onCompaction", async () => {
    const messages = seedLargeHistory();
    const original = messages.length;
    let compactionStats = null;

    const events = await drain(
      agentLoop(messages, {
        chatFn: finalReplyChatFn(),
        onCompaction: (stats) => {
          compactionStats = stats;
        },
      }),
    );

    const compaction = events.find((e) => e.type === "compaction");
    expect(compaction).toBeTruthy();
    expect(compaction.stats.saved).toBeGreaterThan(0);
    // The shared array was mutated in place — the caller sees the shrink.
    expect(messages.length).toBeLessThan(original);
    // onCompaction received the same stats.
    expect(compactionStats).toBeTruthy();
    expect(compactionStats.compressedMessages).toBeLessThan(
      compactionStats.originalMessages,
    );
  });

  it("does NOT compact when autoCompact is false", async () => {
    const messages = seedLargeHistory();
    const original = messages.length;

    const events = await drain(
      agentLoop(messages, {
        chatFn: finalReplyChatFn(),
        autoCompact: false,
      }),
    );

    expect(events.find((e) => e.type === "compaction")).toBeUndefined();
    expect(messages.length).toBe(original);
  });

  it("does NOT compact a short history", async () => {
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "hi" },
    ];

    const events = await drain(
      agentLoop(messages, { chatFn: finalReplyChatFn() }),
    );

    expect(events.find((e) => e.type === "compaction")).toBeUndefined();
  });

  it("uses the injected structured provider query before count truncation", async () => {
    const messages = seedLargeHistory();
    const compactionLlmQuery = vi.fn(async () => ({
      summary: structuredSummary(),
      usage: { input_tokens: 123, output_tokens: 45 },
      provider: "mock-summary",
      model: "summary-1",
    }));

    const events = await drain(
      agentLoop(messages, {
        chatFn: finalReplyChatFn(),
        compactionLlmQuery,
      }),
    );

    const compaction = events.find((event) => event.type === "compaction");
    expect(compactionLlmQuery).toHaveBeenCalledOnce();
    expect(compaction.stats).toMatchObject({
      summaryMode: "llm-structured",
      degraded: false,
      summaryProvider: "mock-summary",
      summaryModel: "summary-1",
      summaryUsage: { inputTokens: 123, outputTokens: 45 },
    });
    expect(
      messages.some((message) =>
        String(message.content).includes("finish the requested change"),
      ),
    ).toBe(true);
  });

  it("emits an explicit degraded event when semantic output is invalid", async () => {
    const events = await drain(
      agentLoop(seedLargeHistory(), {
        chatFn: finalReplyChatFn(),
        compactionLlmQuery: async () => "not-json",
      }),
    );

    const degraded = events.find(
      (event) => event.type === "compaction-degraded",
    );
    expect(degraded).toMatchObject({
      summaryMode: "extractive-fallback",
    });
    expect(degraded.reason).toMatch(/^invalid_llm_summary:/);
  });
});

describe("agentLoop microcompact auto-trigger", () => {
  // A few messages but an OLD huge tool result → token-bloat, low count.
  function seedTokenBloat() {
    const msgs = [
      { role: "system", content: "sys" },
      { role: "user", content: "read the file" },
      { role: "tool", tool_call_id: "t1", content: "X".repeat(2000) },
    ];
    for (let i = 0; i < 4; i++) {
      msgs.push({ role: "assistant", content: "a" + i });
      msgs.push({ role: "user", content: "q" + i });
    }
    return msgs; // 11 msgs; the 2000-char tool result is older than keepRecent=6
  }
  // Over threshold while total content is large; under once the tool result is trimmed.
  function fakeCompactor() {
    return {
      compress: vi.fn(async (msgs) => ({
        messages: [msgs[0], ...msgs.slice(-2)],
        stats: {
          saved: 1,
          originalMessages: msgs.length,
          compressedMessages: 3,
        },
      })),
      shouldAutoCompact: (msgs) =>
        msgs.reduce(
          (n, m) => n + (typeof m.content === "string" ? m.content.length : 0),
          0,
        ) > 1500,
    };
  }

  it("trims old tool results and SKIPS the full compaction when that suffices", async () => {
    const messages = seedTokenBloat();
    const comp = fakeCompactor();
    const events = await drain(
      agentLoop(messages, { chatFn: finalReplyChatFn(), _autoCompactor: comp }),
    );
    expect(
      events.find((e) => e.type === "micro-compaction")?.stats.trimmed,
    ).toBe(1);
    expect(events.find((e) => e.type === "compaction")).toBeUndefined(); // full skipped
    expect(comp.compress).not.toHaveBeenCalled();
    expect(messages.find((m) => m.role === "tool").content).toContain(
      "tool result trimmed",
    );
  });

  it("falls through to the full compaction when the trim is not enough", async () => {
    // count-based threshold (39 msgs > 20), no large tool results → microcompact no-ops.
    const messages = seedLargeHistory();
    const events = await drain(
      agentLoop(messages, { chatFn: finalReplyChatFn() }),
    );
    expect(events.find((e) => e.type === "micro-compaction")).toBeUndefined();
    expect(events.find((e) => e.type === "compaction")).toBeTruthy();
  });

  it("autoMicroCompact: false disables the pre-pass (full compaction runs)", async () => {
    const messages = seedTokenBloat();
    const comp = fakeCompactor();
    const events = await drain(
      agentLoop(messages, {
        chatFn: finalReplyChatFn(),
        _autoCompactor: comp,
        autoMicroCompact: false,
      }),
    );
    expect(events.find((e) => e.type === "micro-compaction")).toBeUndefined();
    expect(comp.compress).toHaveBeenCalled();
  });
});
