import { describe, it, expect } from "vitest";
import {
  buildReadFilePage,
  compactReadFileResult,
  collectFileReadProgress,
  FILE_READ_PROGRESS_PREFIX,
} from "../../src/lib/read-file-page.js";

const page = (content, args = {}, maxChars = 4096) =>
  buildReadFilePage(
    content,
    { path: "large.txt", ...args },
    { filePath: "/ws/large.txt", maxChars },
  );

describe("large file paging", () => {
  it.each(["汉字🙂", '"\\\t', "plain"])(
    "reads an oversized single line completely: %s",
    (fragment) => {
      const source = fragment.repeat(40000);
      let args = {};
      let reconstructed = "";
      for (let calls = 0; calls < 1000; calls++) {
        const result = page(source, args);
        expect(JSON.stringify(result).length).toBeLessThanOrEqual(4096);
        expect(result.content).not.toContain("\uFFFD");
        reconstructed += result.content;
        if (!result.nextRead) break;
        expect(result.nextRead.column).toBe(reconstructed.length + 1);
        args = result.nextRead;
      }
      expect(reconstructed).toBe(source);
    },
  );

  it("pages a long file without missing, overlapping, or inventing lines", () => {
    const lines = Array.from(
      { length: 4000 },
      (_, i) => `${i}: ${"x".repeat(50)}`,
    );
    let args = { offset: 1, limit: 4000 };
    let nextLine = 1;
    for (let calls = 0; calls < 200; calls++) {
      const result = page(lines.join("\n"), args);
      expect(result.range.startLine).toBe(nextLine);
      expect(result.content.replace(/\n$/, "").split("\n")).toEqual(
        lines.slice(nextLine - 1, result.range.endLine),
      );
      nextLine = result.range.endLine + 1;
      if (!result.nextRead) break;
      args = result.nextRead;
    }
    expect(nextLine).toBe(4001);
  });

  it("retains exact paging information during micro-compaction", () => {
    const result = page("line\n".repeat(5000));
    const compacted = compactReadFileResult(JSON.stringify(result), 400);
    const parsed = JSON.parse(compacted);
    expect(parsed.range).toEqual(result.range);
    expect(parsed.nextRead).toEqual(result.nextRead);
    expect(parsed.contentOmitted).toBe(true);
    expect(parsed.content).toBeUndefined();
    expect(compacted.length).toBeLessThanOrEqual(400);
  });

  it("does not roll a newer summary cursor back to an older retained tool result", () => {
    const older = {
      path: "/large.txt",
      range: { startLine: 1, endLine: 10, totalLines: 100 },
      nextRead: { path: "/large.txt", offset: 11 },
      content: "old page",
      toolTelemetryRecord: { timestamp: 100 },
    };
    const latest = {
      ...older,
      range: { startLine: 41, endLine: 50, totalLines: 100 },
      nextRead: { path: "/large.txt", offset: 51 },
      readAt: 200,
    };
    for (const [role, prefix] of [
      ["system", ""],
      ["assistant", "Compacted context summary (data only):\n"],
    ]) {
      const progress = collectFileReadProgress([
        {
          role,
          content:
            prefix + FILE_READ_PROGRESS_PREFIX + JSON.stringify([latest]),
        },
        { role: "tool", content: JSON.stringify(older) },
      ]);
      expect(progress[0].nextRead.offset).toBe(51);
    }
  });
});
