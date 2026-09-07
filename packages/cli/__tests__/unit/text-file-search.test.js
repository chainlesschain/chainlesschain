import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchTextFile } from "../../src/lib/text-file-search.js";
import { executeTool } from "../../src/runtime/agent-core.js";

const dirs = [];
function fixture(content, name = "long.txt") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-text-search-test-"));
  dirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { dir, file };
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("long text file keyword search", () => {
  it("finds a late match in a multi-megabyte file with exact line/column and context", async () => {
    const { file } = fixture(
      "ordinary line\n".repeat(400000) + "before 关键字🙂 after\n",
    );
    const r = await searchTextFile(file, { pattern: "关键字🙂" });
    expect(r.error).toBeUndefined();
    expect(r.hasMore).toBe(false);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({
      line: 400001,
      column: 8,
      text: "关键字🙂",
    });
    expect(r.matches[0].context).toContain("before 关键字🙂 after");
  });

  it("finds literal matches across scan windows in a large single line", async () => {
    const text =
      "x".repeat(65534) + "跨界🙂keyword" + "y".repeat(80000) + "跨界🙂keyword";
    const { file } = fixture(text);
    const first = await searchTextFile(file, {
      pattern: "跨界🙂keyword",
      maxMatches: 1,
    });
    expect(first.matches[0]).toMatchObject({
      offset: 65534,
      line: 1,
      column: 65535,
    });
    const next = await searchTextFile(file, {
      pattern: "跨界🙂keyword",
      offset: first.nextOffset,
    });
    expect(next.matches).toHaveLength(1);
    expect(next.matches[0].offset).toBe(text.lastIndexOf("跨界🙂keyword"));
  });

  it("supports bounded regex, case sensitivity and literal shell metacharacters", async () => {
    const { file } = fixture("alpha\nALPHA\nFAIL E123\nx'; $(echo secret)\n");
    expect((await searchTextFile(file, { pattern: "alpha" })).count).toBe(2);
    expect(
      (await searchTextFile(file, { pattern: "alpha", caseSensitive: true }))
        .count,
    ).toBe(1);
    expect(
      (await searchTextFile(file, { pattern: "FAIL E[0-9]+", regex: true }))
        .matches[0].line,
    ).toBe(3);
    expect(
      (await searchTextFile(file, { pattern: "x'; $(echo secret)" })).count,
    ).toBe(1);
    expect(
      (await searchTextFile(file, { pattern: "[", regex: true })).code,
    ).toBe("ERR_TEXT_SEARCH_PATTERN");
  });

  it("bounds pathological regular expressions with a worker deadline", async () => {
    const { file } = fixture("a".repeat(100000) + "!");
    const r = await searchTextFile(file, {
      pattern: "(a+)+$",
      regex: true,
      timeout: 200,
    });
    expect(r.code).toBe("ERR_TEXT_SEARCH_TIMEOUT");
    expect(r.truncated).toBe(true);
  });

  it("routes search hits into read_file and preserves credential/path guards", async () => {
    const { dir, file } = fixture("first\nneedle here\nlast");
    const r = await executeTool(
      "search_files",
      { path: file, pattern: "needle" },
      { cwd: dir },
    );
    expect(r.error).toBeUndefined();
    const read = await executeTool("read_file", r.matches[0].nextRead, {
      cwd: dir,
    });
    expect(read.content).toContain("needle here");
    fs.writeFileSync(path.join(dir, ".env"), "TOP_SECRET=needle");
    const blocked = await executeTool(
      "search_files",
      { path: ".env", pattern: "needle" },
      { cwd: dir },
    );
    expect(blocked.error).toBeTruthy();
    expect(JSON.stringify(blocked)).not.toContain("TOP_SECRET");
    const outside = await executeTool(
      "search_files",
      { path: file, pattern: "needle" },
      { cwd: path.join(dir, "subdir") },
    );
    expect(outside.error).toContain("Workspace Path Guard");
  });
});
