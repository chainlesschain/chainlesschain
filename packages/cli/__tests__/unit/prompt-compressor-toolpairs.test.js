/**
 * Tool-pair safety for PromptCompressor — `sanitizeToolPairs()` and the
 * `compress(messages, { preserveToolPairs: true })` option.
 *
 * Strict chat APIs reject an orphaned tool result (a `tool` message whose
 * `tool_call_id` has no preceding assistant `tool_calls`) and an unanswered
 * assistant `tool_calls`. Count-based truncation / per-message snipping can
 * orphan either side; these tests pin the repair behaviour.
 */
import { describe, it, expect } from "vitest";
import {
  sanitizeToolPairs,
  PromptCompressor,
} from "../../src/harness/prompt-compressor.js";

/** Assert no orphan tool results and no unanswered assistant tool_calls. */
function expectBalanced(messages) {
  const callIds = new Set(
    messages
      .filter((m) => m.role === "assistant" && Array.isArray(m.tool_calls))
      .flatMap((m) => m.tool_calls.map((tc) => tc.id)),
  );
  const resultIds = new Set(
    messages
      .filter((m) => m.role === "tool" && m.tool_call_id)
      .map((m) => m.tool_call_id),
  );
  for (const m of messages) {
    if (m.role === "tool" && m.tool_call_id) {
      expect(callIds.has(m.tool_call_id)).toBe(true); // no orphan result
    }
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        expect(resultIds.has(tc.id)).toBe(true); // no unanswered call
      }
    }
  }
}

const call = (id) => ({
  role: "assistant",
  content: "",
  tool_calls: [{ id, function: { name: "x", arguments: "{}" } }],
});
const result = (id) => ({ role: "tool", tool_call_id: id, content: "ok-data" });

describe("sanitizeToolPairs", () => {
  it("leaves a balanced sequence untouched in content", () => {
    const msgs = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
      call("a"),
      result("a"),
      { role: "assistant", content: "done" },
    ];
    const out = sanitizeToolPairs(msgs);
    expect(out).toHaveLength(5);
    expectBalanced(out);
  });

  it("drops an orphan tool result (assistant call was truncated away)", () => {
    const msgs = [
      { role: "system", content: "s" },
      result("missing"), // its assistant call is gone
      { role: "user", content: "u" },
    ];
    const out = sanitizeToolPairs(msgs);
    expect(out.find((m) => m.role === "tool")).toBeUndefined();
    expectBalanced(out);
  });

  it("strips an unanswered tool_call but keeps assistant text", () => {
    const msgs = [
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: "thinking out loud",
        tool_calls: [{ id: "z", function: { name: "x", arguments: "{}" } }],
      },
      // no result for "z"
    ];
    const out = sanitizeToolPairs(msgs);
    const asst = out.find((m) => m.role === "assistant");
    expect(asst).toBeTruthy();
    expect(asst.tool_calls).toBeUndefined();
    expect(asst.content).toBe("thinking out loud");
    expectBalanced(out);
  });

  it("drops an assistant whose only call is unanswered and has no text", () => {
    const msgs = [{ role: "user", content: "u" }, call("z")];
    const out = sanitizeToolPairs(msgs);
    expect(out.find((m) => m.role === "assistant")).toBeUndefined();
    expectBalanced(out);
  });

  it("keeps the answered call and drops the unanswered one on a multi-call msg", () => {
    const msgs = [
      { role: "user", content: "u" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "ok", function: { name: "x", arguments: "{}" } },
          { id: "bad", function: { name: "y", arguments: "{}" } },
        ],
      },
      result("ok"),
    ];
    const out = sanitizeToolPairs(msgs);
    const asst = out.find((m) => m.role === "assistant");
    expect(asst.tool_calls.map((t) => t.id)).toEqual(["ok"]);
    expectBalanced(out);
  });
});

describe("compress({ preserveToolPairs })", () => {
  it("never emits an orphaned pair even when truncation splits a tool group", () => {
    // 30 small messages with tool pairs sprinkled through the truncated region.
    const msgs = [{ role: "system", content: "sys" }];
    for (let i = 0; i < 12; i++) {
      msgs.push(call(`c${i}`));
      msgs.push(result(`c${i}`));
    }
    msgs.push({ role: "user", content: "final question" });

    const pc = new PromptCompressor({ maxMessages: 8, maxTokens: 200 });
    return pc
      .compress(msgs, { preserveToolPairs: true })
      .then(({ messages }) => {
        expect(messages.length).toBeLessThan(msgs.length);
        expectBalanced(messages);
      });
  });

  it("is a no-op repair for tool-free conversations", async () => {
    const msgs = [
      { role: "system", content: "s" },
      { role: "user", content: "hello there friend" },
      { role: "assistant", content: "hi back" },
    ];
    const pc = new PromptCompressor({ maxMessages: 20, maxTokens: 8000 });
    const { messages } = await pc.compress(msgs, { preserveToolPairs: true });
    expect(messages.some((m) => m.role === "tool")).toBe(false);
  });
});
