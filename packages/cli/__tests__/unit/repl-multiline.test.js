/** REPL multiline backslash-continuation — pure helpers, no readline. */
import { describe, it, expect } from "vitest";
import {
  analyzeContinuation,
  joinContinuation,
} from "../../src/lib/repl-multiline.js";

describe("analyzeContinuation", () => {
  it("continues on a space-gated trailing backslash, dropping it", () => {
    expect(analyzeContinuation("write a function \\")).toEqual({
      continued: true,
      text: "write a function",
    });
  });
  it("continues on a lone backslash (blank continuation line)", () => {
    expect(analyzeContinuation("\\")).toEqual({ continued: true, text: "" });
  });
  it("does NOT continue a Windows path (no preceding whitespace)", () => {
    expect(analyzeContinuation("dir C:\\")).toEqual({
      continued: false,
      text: "dir C:\\",
    });
  });
  it("treats an even backslash run as a literal (\\\\ → no continue)", () => {
    expect(analyzeContinuation("path ends \\\\")).toEqual({
      continued: false,
      text: "path ends \\\\",
    });
  });
  it("leaves a plain line untouched", () => {
    expect(analyzeContinuation("plain line")).toEqual({
      continued: false,
      text: "plain line",
    });
  });
  it("is null-safe", () => {
    expect(analyzeContinuation(undefined)).toEqual({
      continued: false,
      text: "",
    });
  });
});

describe("joinContinuation", () => {
  it("stitches pieces and the final line with newlines", () => {
    expect(joinContinuation(["line one", "line two"], "line three")).toBe(
      "line one\nline two\nline three",
    );
  });
  it("works with no prior pieces", () => {
    expect(joinContinuation([], "only")).toBe("only");
  });
  it("preserves a blank continuation line", () => {
    expect(joinContinuation(["a", ""], "b")).toBe("a\n\nb");
  });

  it("round-trips a real two-line entry", () => {
    // user types: "def f():\" <enter> "    return 1" <enter>
    const a = analyzeContinuation("def f(): \\");
    expect(a.continued).toBe(true);
    const final = "    return 1";
    expect(analyzeContinuation(final).continued).toBe(false);
    expect(joinContinuation([a.text], final)).toBe("def f():\n    return 1");
  });
});
