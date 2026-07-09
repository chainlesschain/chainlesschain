import { describe, it, expect } from "vitest";
import {
  buildFimPrompt,
  cleanCompletion,
  MAX_COMPLETION_CHARS,
} from "../../src/commands/complete.js";

describe("cc complete — buildFimPrompt", () => {
  it("embeds prefix, cursor sentinel, and suffix in order", () => {
    const p = buildFimPrompt("const a = ", ";\nconst b = 2;", "javascript");
    expect(p).toContain("const a = <CURSOR>;\nconst b = 2;");
  });

  it("names the language in the instruction", () => {
    expect(buildFimPrompt("x", "y", "python")).toContain(
      "completion engine for python",
    );
  });

  it("falls back to a generic language phrase when blank", () => {
    expect(buildFimPrompt("x", "y", "")).toContain(
      "completion engine for the given language",
    );
  });

  it("instructs the model to output only raw code (no fences/prose)", () => {
    const p = buildFimPrompt("x", "y", "go");
    expect(p).toContain("Output ONLY the raw code");
    expect(p).toContain("no markdown code fences");
  });

  it("tolerates null prefix/suffix", () => {
    const p = buildFimPrompt(null, null, null);
    expect(p).toContain("<CURSOR>");
  });
});

describe("cc complete — cleanCompletion", () => {
  it("returns empty for null/empty input", () => {
    expect(cleanCompletion(null)).toBe("");
    expect(cleanCompletion("")).toBe("");
  });

  it("strips a wrapping markdown code fence", () => {
    expect(cleanCompletion("```js\nfoo();\n```")).toBe("foo();");
    expect(cleanCompletion("```\nbar()\n```")).toBe("bar()");
  });

  it("drops an echoed <CURSOR> sentinel", () => {
    expect(cleanCompletion("a<CURSOR>b")).toBe("ab");
  });

  it("trims trailing whitespace but keeps leading indentation", () => {
    expect(cleanCompletion("    indented()   \n\n")).toBe("    indented()");
  });

  it("keeps a legitimate trailing brace (no aggressive suffix trimming)", () => {
    expect(cleanCompletion("if (x) { doThing(); }")).toBe(
      "if (x) { doThing(); }",
    );
  });

  it("hard-caps runaway output", () => {
    const huge = "x".repeat(MAX_COMPLETION_CHARS + 500);
    expect(cleanCompletion(huge).length).toBe(MAX_COMPLETION_CHARS);
  });
});
