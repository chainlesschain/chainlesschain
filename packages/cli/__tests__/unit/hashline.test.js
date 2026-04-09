import { describe, it, expect } from "vitest";
import {
  hashLine,
  splitLines,
  annotateLines,
  findByHash,
  verifyLine,
  replaceByHash,
  snippetAround,
  _internals,
} from "../../src/lib/hashline.js";

describe("hashline — hashLine()", () => {
  it("is deterministic: same input → same hash", () => {
    expect(hashLine("const x = 1;")).toBe(hashLine("const x = 1;"));
  });

  it("produces a 6-char base64url hash for non-empty lines", () => {
    const h = hashLine("function foo() {}");
    expect(h).toHaveLength(6);
    expect(h).toMatch(/^[A-Za-z0-9_-]{6}$/);
  });

  it("is whitespace-insensitive (trim applied before hashing)", () => {
    expect(hashLine("  const x = 1;  ")).toBe(hashLine("const x = 1;"));
    expect(hashLine("\tconst x = 1;")).toBe(hashLine("const x = 1;"));
  });

  it("returns ______ for empty or whitespace-only lines", () => {
    expect(hashLine("")).toBe("______");
    expect(hashLine("   ")).toBe("______");
    expect(hashLine("\t\t")).toBe("______");
  });

  it("returns ______ for non-strings", () => {
    expect(hashLine(null)).toBe("______");
    expect(hashLine(undefined)).toBe("______");
    expect(hashLine(42)).toBe("______");
  });

  it("distinguishes different content", () => {
    expect(hashLine("const x = 1;")).not.toBe(hashLine("const x = 2;"));
  });

  it("handles Unicode content", () => {
    const h = hashLine("const 中文 = '你好';");
    expect(h).toHaveLength(6);
    expect(hashLine("const 中文 = '你好';")).toBe(h);
  });
});

describe("hashline — splitLines()", () => {
  it("detects LF line endings", () => {
    const { lines, eol } = splitLines("a\nb\nc");
    expect(lines).toEqual(["a", "b", "c"]);
    expect(eol).toBe("\n");
  });

  it("detects CRLF line endings", () => {
    const { lines, eol } = splitLines("a\r\nb\r\nc");
    expect(lines).toEqual(["a", "b", "c"]);
    expect(eol).toBe("\r\n");
  });

  it("handles single-line input", () => {
    const { lines, eol } = splitLines("single");
    expect(lines).toEqual(["single"]);
    expect(eol).toBe("\n");
  });

  it("handles empty input and non-strings", () => {
    expect(splitLines("").lines).toEqual([""]);
    expect(splitLines(null).lines).toEqual([]);
  });
});

describe("hashline — annotateLines()", () => {
  it("prefixes each line with '<hash>| '", () => {
    const annotated = annotateLines("const x = 1;\nconst y = 2;");
    const lines = annotated.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^[A-Za-z0-9_-]{6}\| const x = 1;$/);
    expect(lines[1]).toMatch(/^[A-Za-z0-9_-]{6}\| const y = 2;$/);
  });

  it("preserves CRLF when annotating", () => {
    const annotated = annotateLines("a\r\nb");
    expect(annotated.includes("\r\n")).toBe(true);
  });

  it("tags empty lines with ______", () => {
    const annotated = annotateLines("a\n\nb");
    const lines = annotated.split("\n");
    expect(lines[1]).toBe("______| ");
  });
});

describe("hashline — findByHash()", () => {
  it("finds a line by its hash", () => {
    const content = "line one\nline two\nline three";
    const hash = hashLine("line two");
    const matches = findByHash(content, hash);
    expect(matches).toHaveLength(1);
    expect(matches[0].lineNumber).toBe(2);
    expect(matches[0].content).toBe("line two");
  });

  it("returns multiple matches for duplicated lines", () => {
    const content = "dup\nunique\ndup";
    const matches = findByHash(content, hashLine("dup"));
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.lineNumber)).toEqual([1, 3]);
  });

  it("returns empty array when no match", () => {
    expect(findByHash("abc", "ZZZZZZ")).toEqual([]);
    expect(findByHash("abc", "")).toEqual([]);
  });
});

describe("hashline — verifyLine()", () => {
  it("returns true when hash and trimmed content match", () => {
    expect(verifyLine("  foo  ", hashLine("foo"), "foo")).toBe(true);
  });

  it("returns false on hash mismatch", () => {
    expect(verifyLine("bar", hashLine("foo"), "foo")).toBe(false);
  });

  it("returns false on content mismatch (trimmed)", () => {
    expect(verifyLine("foo", hashLine("foo"), "bar")).toBe(false);
  });
});

describe("hashline — replaceByHash()", () => {
  it("replaces a single anchored line", () => {
    const content = "line one\nline two\nline three";
    const result = replaceByHash(content, {
      anchorHash: hashLine("line two"),
      expectedLine: "line two",
      newLine: "LINE TWO REPLACED",
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe("line one\nLINE TWO REPLACED\nline three");
    expect(result.lineNumber).toBe(2);
    expect(result.previousContent).toBe("line two");
  });

  it("preserves CRLF line endings on replace", () => {
    const content = "a\r\nb\r\nc";
    const result = replaceByHash(content, {
      anchorHash: hashLine("b"),
      expectedLine: "b",
      newLine: "B",
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe("a\r\nB\r\nc");
  });

  it("returns hash_mismatch when anchor not found", () => {
    const result = replaceByHash("abc", {
      anchorHash: "ZZZZZZ",
      expectedLine: "abc",
      newLine: "x",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("hash_mismatch");
    expect(result.hint).toMatch(/hashed:true/);
  });

  it("returns ambiguous_anchor for duplicated lines", () => {
    const content = "dup\nunique\ndup";
    const result = replaceByHash(content, {
      anchorHash: hashLine("dup"),
      expectedLine: "dup",
      newLine: "X",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe("ambiguous_anchor");
    expect(result.matches).toHaveLength(2);
  });

  it("returns content_mismatch when expected_line doesn't match", () => {
    // Force a content mismatch: use a real hash but wrong expected_line
    // (this is really about the second-layer safety check)
    const content = "foo";
    const h = hashLine("foo");
    const result = replaceByHash(content, {
      anchorHash: h,
      expectedLine: "bar", // intentionally wrong
      newLine: "X",
    });
    // hashLine("foo") !== hashLine("bar"), so this actually passes verify step —
    // but the second-layer check compares trimmed strings.
    expect(result.success).toBe(false);
    expect(result.error).toBe("content_mismatch");
  });

  it("tolerates whitespace drift in expected_line (trim)", () => {
    const content = "  foo  ";
    const result = replaceByHash(content, {
      anchorHash: hashLine("foo"),
      expectedLine: "foo",
      newLine: "bar",
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe("bar");
  });
});

describe("hashline — snippetAround()", () => {
  it("returns annotated context lines", () => {
    const content = "a\nb\nc\nd\ne";
    const snippet = snippetAround(content, 2, 1);
    // index 2 is "c"; contextLines=1 → b, c, d
    const lines = snippet.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/\| b$/);
    expect(lines[1]).toMatch(/\| c$/);
    expect(lines[2]).toMatch(/\| d$/);
  });

  it("clamps to file boundaries", () => {
    const content = "a\nb";
    const snippet = snippetAround(content, 0, 5);
    expect(snippet.split("\n")).toHaveLength(2);
  });
});

describe("hashline — _internals", () => {
  it("exports expected constants", () => {
    expect(_internals.HASH_LENGTH).toBe(6);
    expect(_internals.EMPTY_HASH).toBe("______");
    expect(_internals.SEPARATOR).toBe("| ");
  });
});
