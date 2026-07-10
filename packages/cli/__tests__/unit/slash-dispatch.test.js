/**
 * `cc agent --disable-slash-commands` — the REPL's slash-dispatch bypass.
 * The predicate decides which lines skip built-in dispatch; the sentinel is
 * what handlers see instead (must be unmatchable by every dispatch branch).
 */
import { describe, it, expect } from "vitest";
import {
  slashDispatchBypassed,
  slashBypassSentinel,
} from "../../src/lib/slash-dispatch.js";

describe("slashDispatchBypassed", () => {
  it("bypasses '/'-leading lines when disabled", () => {
    expect(slashDispatchBypassed("/help", true)).toBe(true);
    expect(slashDispatchBypassed("/model gpt", true)).toBe(true);
    expect(slashDispatchBypassed("/mcp__srv__prompt", true)).toBe(true);
    expect(slashDispatchBypassed("/my-custom-macro arg", true)).toBe(true);
  });

  it("keeps /exit and /quit live so the session stays closable", () => {
    expect(slashDispatchBypassed("/exit", true)).toBe(false);
    expect(slashDispatchBypassed("/quit", true)).toBe(false);
  });

  it("never bypasses when the flag is off (byte-identical default path)", () => {
    expect(slashDispatchBypassed("/help", false)).toBe(false);
    expect(slashDispatchBypassed("/help", undefined)).toBe(false);
  });

  it("ignores non-slash input (! bash, # memorize, plain prompts)", () => {
    expect(slashDispatchBypassed("!ls", true)).toBe(false);
    expect(slashDispatchBypassed("# note", true)).toBe(false);
    expect(slashDispatchBypassed("fix the bug", true)).toBe(false);
  });
});

describe("slashBypassSentinel", () => {
  it("is unmatchable by every dispatch branch", () => {
    const s = slashBypassSentinel();
    // handlers match on these prefixes — the sentinel must dodge all of them
    expect(s.startsWith("/")).toBe(false);
    expect(s.startsWith("!")).toBe(false);
    expect(s.startsWith("#")).toBe(false);
    // non-empty (the `if (!trimmed) return` guard must not swallow it)
    expect(s.length).toBeGreaterThan(0);
    // leading NUL: even a handler that re-trims can't see a "/" first char
    expect(s.charCodeAt(0)).toBe(0);
  });
});
