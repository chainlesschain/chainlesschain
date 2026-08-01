import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  iterateFileLinesReverseSync,
  iterateFileLinesSync,
} from "../../src/lib/file-lines.js";

const roots = [];

function temporaryFile(content) {
  const root = mkdtempSync(join(tmpdir(), "cc-file-lines-"));
  roots.push(root);
  const file = join(root, "events.jsonl");
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("bounded UTF-8 file line iterators", () => {
  it("streams forward across a split multibyte character", () => {
    const first = `${"x".repeat(1023)}🙂`;
    const file = temporaryFile(`${first}\r\n第二行\n尾部`);
    expect([...iterateFileLinesSync(file, { chunkSize: 1024 })]).toEqual([
      { line: first, lineNo: 1, terminated: true },
      { line: "第二行", lineNo: 2, terminated: true },
      { line: "尾部", lineNo: 3, terminated: false },
    ]);
  });

  it("streams newest-first and marks only an unterminated tail", () => {
    const file = temporaryFile("一\n二🙂\n三");
    expect([...iterateFileLinesReverseSync(file, { chunkSize: 1024 })]).toEqual(
      [
        { line: "三", terminated: false },
        { line: "二🙂", terminated: true },
        { line: "一", terminated: true },
      ],
    );
  });

  it("does not invent an empty record for a final newline", () => {
    const file = temporaryFile("a\n\nb\n");
    expect([...iterateFileLinesReverseSync(file)]).toEqual([
      { line: "b", terminated: true },
      { line: "a", terminated: true },
    ]);
    expect(
      [...iterateFileLinesSync(file, { includeEmpty: true })].map(
        (x) => x.line,
      ),
    ).toEqual(["a", "", "b", ""]);
  });
});
