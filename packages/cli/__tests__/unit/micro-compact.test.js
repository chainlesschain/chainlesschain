/**
 * Micro-compaction: surgically trim large OLD tool results in place, keeping
 * recent messages and never orphaning a tool pair.
 */
import { describe, it, expect } from "vitest";
import { microCompact } from "../../src/lib/micro-compact.js";

const big = (n) => "x".repeat(n);

function convo() {
  // 10 messages: system, then 9 turns; tool results at indices 2 and 4 are old
  // and large, index 8 is a recent large tool result (kept).
  return [
    { role: "system", content: "sys" },
    { role: "user", content: "q1" },
    { role: "tool", tool_call_id: "t1", content: big(2000) }, // old + large → trim
    { role: "assistant", content: "a1" },
    { role: "tool", tool_call_id: "t2", content: big(1000) }, // old + large → trim
    { role: "user", content: "q2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "q3" },
    { role: "tool", tool_call_id: "t3", content: big(3000) }, // recent → kept
    { role: "assistant", content: "a3" },
  ];
}

describe("microCompact", () => {
  it("trims old large tool results but keeps recent ones and the flow", () => {
    const messages = convo();
    const { messages: out, stats } = microCompact(messages, {
      keepRecent: 4,
      maxToolChars: 400,
    });
    expect(out).toHaveLength(messages.length); // no message removed (pairs intact)
    expect(stats.trimmed).toBe(2); // indices 2 and 4
    expect(out[2].content.length).toBeLessThan(2000);
    expect(out[2].content).toContain("tool result trimmed");
    expect(out[2]._microCompacted).toBe(true);
    expect(out[4].content).toContain("tool result trimmed");
    // recent large tool result (index 8, within last 4) is untouched
    expect(out[8].content).toBe(big(3000));
    expect(out[8]._microCompacted).toBeUndefined();
    expect(stats.saved).toBeGreaterThan(0);
  });

  it("leaves small tool results and non-tool messages alone", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "tool", tool_call_id: "t", content: "short" }, // small → kept
      { role: "user", content: big(5000) }, // big but not a tool result → kept
      { role: "user", content: "x" },
      { role: "user", content: "y" },
      { role: "user", content: "z" },
      { role: "user", content: "w" },
    ];
    const { messages: out, stats } = microCompact(messages, { keepRecent: 2 });
    expect(stats.trimmed).toBe(0);
    expect(out).toEqual(messages);
  });

  it("does not mutate the input array or its messages", () => {
    const messages = convo();
    const snapshot = messages[2].content;
    microCompact(messages, { keepRecent: 4, maxToolChars: 400 });
    expect(messages[2].content).toBe(snapshot); // original untouched
  });

  it("returns input unchanged for a non-array", () => {
    const r = microCompact(null);
    expect(r.messages).toBe(null);
    expect(r.stats.trimmed).toBe(0);
  });
});

/**
 * Fact-retention / task-continuity (Phase 7 acceptance "Compaction 前后任务
 * 关键约束保留率"). Micro-compaction must never drop a stated task constraint or
 * orphan a tool_call→tool_result pair — it only shortens old tool OUTPUTS.
 */
describe("microCompact fact retention", () => {
  function constrainedConvo() {
    return [
      // The task constraint the agent must keep honoring — an OLD user message.
      {
        role: "user",
        content:
          "IMPORTANT constraint: the API key must NEVER be logged and all money amounts use integer cents.",
      },
      {
        role: "assistant",
        content: "Understood — no key logging, integer cents.",
        tool_calls: [{ id: "c1", function: { name: "read_file" } }],
      },
      { role: "tool", tool_call_id: "c1", content: big(5000) }, // old, large → trimmed
      { role: "assistant", content: "reasoning about the code" },
      { role: "user", content: "now add the transfer function" },
      { role: "assistant", content: "here is the plan" },
    ];
  }

  it("preserves every non-tool message (task constraints) verbatim", () => {
    const messages = constrainedConvo();
    const { messages: out } = microCompact(messages, {
      keepRecent: 2,
      maxToolChars: 400,
    });
    // The constraint (message 0) and all user/assistant text survive verbatim —
    // 100% constraint retention. Only the old tool result (index 2) shrank.
    expect(out[0]).toBe(messages[0]); // same object → untouched
    expect(out[0].content).toMatch(/API key must NEVER be logged/);
    expect(out[0].content).toMatch(/integer cents/);
    expect(out[1]).toBe(messages[1]); // assistant + its tool_calls intact
    expect(out[3]).toBe(messages[3]);
    // Retention rate over non-tool messages = 100%.
    const nonTool = messages.filter((m) => m.role !== "tool");
    const retained = nonTool.filter((m, i) => {
      const outNonTool = out.filter((x) => x.role !== "tool");
      return outNonTool[i].content === m.content;
    });
    expect(retained.length).toBe(nonTool.length);
  });

  it("never orphans a tool_call → tool_result pair", () => {
    const messages = constrainedConvo();
    const { messages: out } = microCompact(messages, {
      keepRecent: 1,
      maxToolChars: 100,
    });
    // Every tool_call id still has a matching tool result (the tool message is
    // shortened, never removed).
    const callIds = out.flatMap((m) => m.tool_calls || []).map((c) => c.id);
    const resultIds = out
      .filter((m) => m.role === "tool")
      .map((m) => m.tool_call_id);
    for (const id of callIds) expect(resultIds).toContain(id);
    // The trimmed tool result is still present, just shorter, and flagged.
    const trimmed = out.find((m) => m.tool_call_id === "c1");
    expect(trimmed._microCompacted).toBe(true);
    expect(trimmed.content).toMatch(/tool result trimmed/);
  });
});
