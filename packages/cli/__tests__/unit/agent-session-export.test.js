/** agent-session-export — JSONL agent session → Markdown transcript. */
import { describe, it, expect } from "vitest";
import {
  renderAgentSessionMarkdown,
  TOOL_BLOCK_CAP,
} from "../../src/lib/agent-session-export.js";

const T0 = 1765432100000;

function ev(type, data, ts = T0) {
  return { type, timestamp: ts, data };
}

describe("renderAgentSessionMarkdown", () => {
  it("renders header meta, turns, tool blocks, compact note and totals", () => {
    const events = [
      ev("session_start", { title: "fix bug", provider: "ollama", model: "qwen3" }),
      ev("user_message", { role: "user", content: "fix the bug" }),
      ev("tool_call", { tool: "read_file", args: { path: "a.js" } }),
      ev("tool_result", { tool: "read_file", result: "const x = 1;" }),
      ev("compact", { savedTokens: 123 }),
      ev("assistant_message", { role: "assistant", content: "done" }),
      ev("token_usage", { inputTokens: 100, outputTokens: 20 }),
    ];
    const md = renderAgentSessionMarkdown("sess-1", events, {
      exportedAt: "2026-06-11T00:00:00.000Z",
    });
    expect(md).toContain("# Agent Session sess-1");
    expect(md).toContain("title: fix bug");
    expect(md).toContain("provider: ollama · model: qwen3");
    expect(md).toContain("## 👤 User\n\nfix the bug");
    expect(md).toContain("**🔧 tool_call — `read_file`**");
    expect(md).toContain('"path": "a.js"');
    expect(md).toContain("**↩ tool_result — `read_file`**");
    expect(md).toContain("> ⊟ context compacted — saved ~123 tokens");
    expect(md).toContain("## 🤖 Assistant\n\ndone");
    expect(md).toContain("1 user / 1 assistant turns · tokens in/out: 100/20");
    expect(md).toContain("exported: 2026-06-11T00:00:00.000Z");
  });

  it("caps oversized tool payloads and guards embedded fences", () => {
    const big = "x".repeat(TOOL_BLOCK_CAP + 50);
    const events = [
      ev("tool_result", { tool: "run_shell", result: big }),
      ev("tool_result", { tool: "run_shell", result: "has ``` inside" }),
    ];
    const md = renderAgentSessionMarkdown("s", events);
    expect(md).toContain("… [truncated]");
    expect(md).toContain("````\nhas ``` inside\n````");
  });

  it("stringifies non-string content (multimodal arrays) and skips unknown types", () => {
    const events = [
      ev("user_message", {
        role: "user",
        content: [{ type: "text", text: "hi" }],
      }),
      ev("totally_unknown", { whatever: true }),
    ];
    const md = renderAgentSessionMarkdown("s", events);
    expect(md).toContain('"type": "text"');
    expect(md).not.toContain("totally_unknown");
  });

  it("handles an empty event list without throwing", () => {
    const md = renderAgentSessionMarkdown("empty", []);
    expect(md).toContain("# Agent Session empty");
    expect(md).toContain("0 user / 0 assistant turns");
  });
});
