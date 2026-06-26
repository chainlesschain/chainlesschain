/**
 * Unit tests for the REPL's agentLoop() wrapper — its translation of
 * agent-core events into REPL state. Uses the `_coreLoop` injection seam so no
 * live model / agent-core is involved; stdout is spied to keep output clean.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { agentLoop } from "../../src/repl/agent-repl.js";

// A fake agent-core loop: yields the given events and records the options it
// was called with (so we can assert what the wrapper forwarded).
function coreLoop(events) {
  const fn = async function* (_messages, opts) {
    fn.calledWith = opts;
    for (const e of events) yield e;
  };
  return fn;
}

let writeSpy;
beforeEach(() => {
  writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  writeSpy.mockRestore();
});

describe("agentLoop() wrapper", () => {
  it("FORCES autoCompact off even when the caller passes autoCompact:true", async () => {
    // Regression guard: the REPL runs its own post-turn compaction, so the
    // in-loop pass must stay off. A caller option must never re-enable it
    // (the `autoCompact:false` is spread-ordered to win).
    const core = coreLoop([{ type: "response-complete", content: "hi" }]);
    const res = await agentLoop([], { _coreLoop: core, autoCompact: true });
    expect(core.calledWith.autoCompact).toBe(false);
    expect(res.content).toBe("hi");
  });

  it("records a checkpoint mark with atMessageCount === messages.length at event time", async () => {
    // /rewind relies on this count to restore the right file snapshot for a
    // turn; an off-by-one would rewind code to the wrong point.
    const marks = [];
    const messages = [
      { role: "system", content: "s" },
      { role: "user", content: "u" },
    ];
    const core = coreLoop([
      { type: "checkpoint", id: "ck1", tool: "write_file" },
      { type: "response-complete", content: "done" },
    ]);
    await agentLoop(messages, { _coreLoop: core, checkpointMarks: marks });
    expect(marks).toEqual([
      { atMessageCount: 2, id: "ck1", tool: "write_file" },
    ]);
  });

  it("accumulates token-usage events and returns content + thinking", async () => {
    const core = coreLoop([
      { type: "token-usage", usage: { input_tokens: 5, output_tokens: 2 } },
      { type: "token-usage", usage: { input_tokens: 3 } },
      { type: "response-complete", content: "answer", thinking: "reasoned" },
    ]);
    const res = await agentLoop([], { _coreLoop: core });
    expect(res.content).toBe("answer");
    expect(res.thinking).toBe("reasoned");
    expect(res.usageEvents).toHaveLength(2);
  });

  it("returns empty content + usageEvents when the loop ends with no response-complete", async () => {
    const core = coreLoop([
      { type: "tool-executing", tool: "read_file", args: { path: "x" } },
    ]);
    const res = await agentLoop([], { _coreLoop: core });
    expect(res.content).toBe("");
    expect(res.usageEvents).toEqual([]);
  });

  it("uses a caller-supplied onProviderFallback over the default", async () => {
    const seen = [];
    const core = coreLoop([{ type: "response-complete", content: "ok" }]);
    await agentLoop([], {
      _coreLoop: core,
      onProviderFallback: (info) => seen.push(info),
    });
    // The wrapper forwards the caller's handler (not the default REPL printer).
    core.calledWith.onProviderFallback({ from: "a", to: "b" });
    expect(seen).toEqual([{ from: "a", to: "b" }]);
  });
});
