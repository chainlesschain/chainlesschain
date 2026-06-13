/**
 * `/export` REPL command — render the live conversation (OpenAI-shaped message
 * list) to a Markdown transcript, and a deterministic default filename.
 */
import { describe, it, expect } from "vitest";
import {
  renderConversationMarkdown,
  defaultExportFilename,
  TOOL_BLOCK_CAP,
} from "../../src/repl/conversation-export.js";

describe("defaultExportFilename", () => {
  it("formats a zero-padded timestamp", () => {
    const d = new Date(2026, 5, 13, 9, 7, 6); // 2026-06-13 09:07:06 local
    expect(defaultExportFilename(d)).toBe(
      "chainlesschain-export-20260613-090706.md",
    );
  });

  it("falls back gracefully on an invalid date", () => {
    expect(defaultExportFilename(new Date("nope"))).toMatch(
      /^chainlesschain-export-\d{8}-\d{6}\.md$/,
    );
  });
});

describe("renderConversationMarkdown", () => {
  it("renders user/assistant/system turns with a header + meta + totals", () => {
    const md = renderConversationMarkdown(
      [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello!" },
        { role: "user", content: "thanks" },
        { role: "assistant", content: "anytime" },
      ],
      { provider: "anthropic", model: "claude-opus", sessionId: "s1" },
    );
    expect(md).toContain("# ChainlessChain Conversation Export");
    expect(md).toContain("provider: anthropic · model: claude-opus");
    expect(md).toContain("## 👤 User");
    expect(md).toContain("## 🤖 Assistant");
    expect(md).toContain("## ⚙ System");
    expect(md).toContain("_2 user / 2 assistant turns_");
  });

  it("renders assistant tool_calls (pretty JSON args) and tool results", () => {
    const md = renderConversationMarkdown([
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "c1",
            function: { name: "read_file", arguments: '{"path":"a.js"}' },
          },
        ],
      },
      { role: "tool", content: "file contents here", tool_call_id: "c1" },
    ]);
    expect(md).toContain("**🔧 tool_call — `read_file`**");
    expect(md).toContain('"path": "a.js"'); // pretty-printed
    expect(md).toContain("**↩ tool_result**");
    expect(md).toContain("file contents here");
    // assistant turn had no text → not counted
    expect(md).toContain("_1 user / 0 assistant turns_");
  });

  it("flattens multimodal content parts and notes images", () => {
    const md = renderConversationMarkdown([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: "data:..." } },
        ],
      },
    ]);
    expect(md).toContain("what is this?");
    expect(md).toContain("[image]");
  });

  it("caps oversized tool results and keeps the fence intact", () => {
    const big = "x".repeat(TOOL_BLOCK_CAP + 500);
    const md = renderConversationMarkdown([
      { role: "tool", content: big, tool_call_id: "c1" },
    ]);
    expect(md).toContain("… [truncated]");
    expect(md.length).toBeLessThan(big.length + 500);
  });

  it("tolerates empty / malformed input", () => {
    expect(renderConversationMarkdown(null)).toContain("0 user / 0 assistant");
    expect(renderConversationMarkdown([null, 42, {}])).toContain(
      "# ChainlessChain Conversation Export",
    );
  });
});
