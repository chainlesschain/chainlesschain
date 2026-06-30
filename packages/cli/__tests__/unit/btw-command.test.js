/**
 * Unit tests for the REPL `/btw` one-shot-aside pure helpers. The REPL glue
 * (queue + inject/restore around agentLoop) is exercised separately; these cover
 * the parse + render + content-merge logic. Pure → no readline/agent loop.
 */
import { describe, it, expect } from "vitest";
import {
  parseBtwCommand,
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

  it("errors on an empty note", () => {
    expect(parseBtwCommand("/btw").error).toMatch(/usage: \/btw/);
    expect(parseBtwCommand("/btw   ").error).toMatch(/usage: \/btw/);
  });

  it("captures and trims the note text", () => {
    expect(parseBtwCommand("/btw use PowerShell")).toEqual({
      text: "use PowerShell",
    });
    expect(parseBtwCommand("/btw   I'm on Windows  ")).toEqual({
      text: "I'm on Windows",
    });
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
