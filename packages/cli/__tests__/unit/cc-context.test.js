/**
 * Unit tests for `cc context` — the context-window breakdown command.
 * Focus on the pure categorizer; the command's I/O is a thin render over it.
 */

import { describe, it, expect } from "vitest";
import { categorizeContext } from "../../src/commands/context.js";

// Deterministic estimator: 1 token per character (real one lives in
// prompt-compressor and is tested there).
const est = (s) => (s ? s.length : 0);

describe("categorizeContext", () => {
  it("buckets tokens + counts by role", () => {
    const msgs = [
      { role: "system", content: "sys" }, // 3
      { role: "user", content: "hello" }, // 5
      { role: "assistant", content: "hi" }, // 2
      { role: "user", content: "again" }, // 5
    ];
    const { buckets, counts, total } = categorizeContext(msgs, est);
    expect(buckets.system).toBe(3);
    expect(buckets.user).toBe(10);
    expect(buckets.assistant).toBe(2);
    expect(counts).toEqual({ system: 1, user: 2, assistant: 1, tool: 0 });
    expect(total).toBe(15);
  });

  it("counts assistant tool_calls separately from text", () => {
    const msgs = [
      {
        role: "assistant",
        content: "ok",
        tool_calls: [{ function: { name: "read_file", arguments: "{}" } }],
      },
    ];
    const { buckets } = categorizeContext(msgs, est);
    expect(buckets.assistant).toBe(2); // "ok"
    expect(buckets.toolCalls).toBe(
      est(JSON.stringify(msgs[0].tool_calls)),
    );
    expect(buckets.toolCalls).toBeGreaterThan(0);
  });

  it("treats tool-role messages as their own bucket", () => {
    const { buckets, counts } = categorizeContext(
      [{ role: "tool", content: "result-data" }],
      est,
    );
    expect(buckets.tool).toBe("result-data".length);
    expect(counts.tool).toBe(1);
  });

  it("maps unknown roles to assistant and skips nullish entries", () => {
    const { buckets, counts } = categorizeContext(
      [null, { role: "function", content: "x" }, undefined],
      est,
    );
    expect(buckets.assistant).toBe(1);
    expect(counts.assistant).toBe(1);
  });

  it("stringifies non-string content before estimating", () => {
    const { buckets } = categorizeContext(
      [{ role: "user", content: [{ type: "text", text: "hey" }] }],
      est,
    );
    expect(buckets.user).toBe(JSON.stringify([{ type: "text", text: "hey" }]).length);
  });

  it("total is the sum of every bucket including tool calls", () => {
    const msgs = [
      { role: "system", content: "a" },
      { role: "assistant", content: "b", tool_calls: [{ x: 1 }] },
      { role: "tool", content: "cc" },
    ];
    const { buckets, total } = categorizeContext(msgs, est);
    expect(total).toBe(
      buckets.system +
        buckets.user +
        buckets.assistant +
        buckets.tool +
        buckets.toolCalls,
    );
  });
});
