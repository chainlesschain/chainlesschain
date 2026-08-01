/**
 * Unit tests for the REPL's immediate `/btw` side question and the legacy
 * `/note-next` guidance helpers. Pure → no readline/agent loop.
 */
import { describe, it, expect } from "vitest";
import {
  parseBtwCommand,
  parseNoteNextCommand,
  buildBtwMessages,
  runBtwQuestion,
  buildAsideBlock,
  applyAside,
} from "../../src/repl/btw-command.js";

describe("parseBtwCommand", () => {
  it("returns null for non-/btw input", () => {
    expect(parseBtwCommand("/think on")).toBe(null);
    expect(parseBtwCommand("/btwx")).toBe(null); // not the real command
    expect(parseBtwCommand("hello /btw note")).toBe(null); // not at start
    expect(parseBtwCommand("")).toBe(null);
    expect(parseBtwCommand(null)).toBe(null);
  });

  it("errors on an empty question", () => {
    expect(parseBtwCommand("/btw").error).toMatch(/usage: \/btw/);
    expect(parseBtwCommand("/btw   ").error).toMatch(/usage: \/btw/);
  });

  it("captures and trims the question text", () => {
    expect(parseBtwCommand("/btw use PowerShell")).toEqual({
      text: "use PowerShell",
    });
    expect(parseBtwCommand("/btw   I'm on Windows  ")).toEqual({
      text: "I'm on Windows",
    });
  });

  it("parses an explicit independent-session fork", () => {
    expect(parseBtwCommand("/btw --fork why this design?")).toEqual({
      text: "why this design?",
      fork: true,
    });
    expect(parseBtwCommand("/btw --fork").error).toMatch(/usage: \/btw/);
  });
});

describe("parseNoteNextCommand", () => {
  it("preserves the old next-turn guidance under an honest name", () => {
    expect(parseNoteNextCommand("/note-next use PowerShell")).toEqual({
      text: "use PowerShell",
    });
    expect(parseNoteNextCommand("/note-next").error).toMatch(/note-next/);
    expect(parseNoteNextCommand("/btw question")).toBe(null);
  });
});

describe("immediate side-question snapshot", () => {
  it("removes tool protocol fields while retaining tool output as context", () => {
    const source = [
      { role: "system", content: "repo context" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1" }] },
      { role: "tool", tool_call_id: "t1", content: "result.txt" },
    ];
    const out = buildBtwMessages(source, "what file?");
    expect(out.some((m) => m.content.includes("[Tool result]"))).toBe(true);
    expect(out.at(-1)).toEqual({ role: "user", content: "what file?" });
    expect(JSON.stringify(out)).not.toContain("tool_call_id");
    expect(JSON.stringify(out)).not.toContain("tool_calls");
  });

  it("runs exactly one injected chat call and never mutates parent messages", async () => {
    const parent = [{ role: "user", content: "main task" }];
    const before = JSON.stringify(parent);
    const calls = [];
    const result = await runBtwQuestion({
      messages: parent,
      question: "side?",
      model: "test-model",
      chatFn: async (messages, options) => {
        calls.push({ messages, options });
        return "side answer";
      },
    });
    expect(result.answer).toBe("side answer");
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ model: "test-model" });
    expect(JSON.stringify(parent)).toBe(before);
  });
});

describe("buildAsideBlock", () => {
  it("returns null when there is nothing to add", () => {
    expect(buildAsideBlock([])).toBe(null);
    expect(buildAsideBlock(null)).toBe(null);
    expect(buildAsideBlock(["", "   "])).toBe(null);
  });

  it("renders queued notes inside a tagged, labelled block", () => {
    const block = buildAsideBlock(["one", "two"]);
    expect(block).toContain("<aside");
    expect(block).toContain("not saved to history");
    expect(block).toContain("one\ntwo");
    expect(block).toContain("</aside>");
  });

  it("drops blank entries but keeps the rest", () => {
    expect(buildAsideBlock(["keep", "  ", "also"])).toContain("keep\nalso");
  });
});

describe("applyAside", () => {
  const BLOCK = "<aside>x</aside>";

  it("appends to a string with a blank-line separator", () => {
    expect(applyAside("hello", BLOCK)).toBe(`hello\n\n${BLOCK}`);
  });

  it("returns just the block when the content is empty/nullish", () => {
    expect(applyAside("", BLOCK)).toBe(BLOCK);
    expect(applyAside(null, BLOCK)).toBe(BLOCK);
  });

  it("adds a text part to a multimodal array (vision turn)", () => {
    const content = [{ type: "image_url", image_url: { url: "data:…" } }];
    const out = applyAside(content, BLOCK);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(content[0]); // original parts preserved
    expect(out[1]).toEqual({ type: "text", text: BLOCK });
    expect(content).toHaveLength(1); // input not mutated
  });

  it("returns the content unchanged for a falsy block", () => {
    expect(applyAside("hello", null)).toBe("hello");
    const arr = [{ type: "text", text: "x" }];
    expect(applyAside(arr, null)).toBe(arr);
  });
});
