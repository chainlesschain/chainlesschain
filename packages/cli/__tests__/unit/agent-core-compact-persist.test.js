/**
 * Phase 1b — agentLoop self-persists a `compact` event so `--resume` rebuilds
 * from the shortened history.
 *
 * When the loop auto-compacts and no explicit `onCompaction` hook is supplied,
 * it appends a `compact` event to the JSONL session — but ONLY when that session
 * is already persisted (its file exists). A one-shot `cc agent -p` (no session
 * file) must write nothing. An `onCompaction` hook takes precedence over
 * self-persist, and `persistCompaction: false` disables it.
 *
 * The session store is mocked (real compressor runs); no disk is touched.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  sessionExists: vi.fn(() => true),
  appendCompactEvent: vi.fn(),
}));

const store = await import("../../src/harness/jsonl-session-store.js");
const { agentLoop } = await import("../../src/runtime/agent-core.js");

function finalReplyChatFn() {
  return async () => ({
    message: { role: "assistant", content: "final answer" },
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

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

describe("agentLoop compaction self-persist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.sessionExists.mockReturnValue(true);
  });

  it("persists a compact event for a persisted session (file exists)", async () => {
    const messages = seedLargeHistory();
    await drain(
      agentLoop(messages, { chatFn: finalReplyChatFn(), sessionId: "s1" }),
    );
    expect(store.appendCompactEvent).toHaveBeenCalledTimes(1);
    const [sid, payload] = store.appendCompactEvent.mock.calls[0];
    expect(sid).toBe("s1");
    expect(Array.isArray(payload.messages)).toBe(true);
    expect(payload.compressedMessages).toBeLessThan(payload.originalMessages);
  });

  it("does NOT persist when the session file does not exist (one-shot)", async () => {
    store.sessionExists.mockReturnValue(false);
    const messages = seedLargeHistory();
    await drain(
      agentLoop(messages, { chatFn: finalReplyChatFn(), sessionId: "oneshot" }),
    );
    expect(store.appendCompactEvent).not.toHaveBeenCalled();
  });

  it("does NOT persist when no sessionId is set", async () => {
    const messages = seedLargeHistory();
    await drain(agentLoop(messages, { chatFn: finalReplyChatFn() }));
    expect(store.appendCompactEvent).not.toHaveBeenCalled();
  });

  it("lets an explicit onCompaction hook take precedence over self-persist", async () => {
    const onCompaction = vi.fn();
    const messages = seedLargeHistory();
    await drain(
      agentLoop(messages, {
        chatFn: finalReplyChatFn(),
        sessionId: "s1",
        onCompaction,
      }),
    );
    expect(onCompaction).toHaveBeenCalledTimes(1);
    expect(store.appendCompactEvent).not.toHaveBeenCalled();
  });

  it("respects persistCompaction:false", async () => {
    const messages = seedLargeHistory();
    await drain(
      agentLoop(messages, {
        chatFn: finalReplyChatFn(),
        sessionId: "s1",
        persistCompaction: false,
      }),
    );
    expect(store.appendCompactEvent).not.toHaveBeenCalled();
  });
});
