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
        stats: { saved: 1, originalMessages: msgs.length, compressedMessages: 3 },
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
    expect(events.find((e) => e.type === "micro-compaction")?.stats.trimmed).toBe(1);
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
