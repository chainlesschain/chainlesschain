import { describe, expect, it } from "vitest";
import { buildReadFilePage } from "../../src/lib/read-file-page.js";
import {
  safeHostToolResultForModel,
  boundedToolResultText,
} from "../../src/lib/tool-result-preview.js";
import { ReadFileLoopGuard } from "../../src/lib/read-file-loop-guard.js";

const source = [
  'import { check } from "./checks.js";',
  'describe("independent feature", () => {',
  "  const labels = [",
  '    "left",',
  '    "right",',
  "  ];",
  '  it.each(labels)("keeps %s independent", (label) => {',
  "    expect(check({ label, enabled: true })).toEqual({ label, enabled: true });",
  "  });",
  "});",
  'export const unrelated = "tail";',
].join("\n");
const read = (content, args = {}, maxChars = 12000, version = "v1") =>
  buildReadFilePage(
    content,
    { path: "feature.test.js", offset: 1, limit: 4, ...args },
    {
      filePath: "/work/feature.test.js",
      fileVersion: version,
      maxChars,
    },
  );

describe("complete source recovery from the current read snapshot", () => {
  it("delivers the surrounding call without a second read when a page cuts its callback", () => {
    const page = read(source);
    const visible = safeHostToolResultForModel("read_file", page);
    expect(visible.contentOmitted).toBeUndefined();
    expect(visible.content).toBe(
      source.split("\n").slice(0, 10).join("\n") + "\n",
    );
    expect(visible.content).not.toContain("unrelated");
    expect(visible.range).toEqual({
      startLine: 1,
      endLine: 10,
      totalLines: 11,
    });
    expect(visible.sourceRecovery).toMatchObject({
      action: "complete-source-container",
      fileVersion: "v1",
      requestedRange: { startLine: 1, endLine: 4, totalLines: 11 },
    });
    expect(visible.content).toBe(
      source.slice(visible.readSpan.start, visible.readSpan.end),
    );
    expect(visible.nextRead.offset).toBe(11);
    expect(JSON.stringify(visible).length).toBeLessThanOrEqual(12000);
  });

  it("recovers an interior range with its ancestors and resets after a file change", () => {
    const page = read(source, { offset: 3, limit: 2 });
    expect(page.range.startLine).toBe(2);
    expect(page.range.endLine).toBe(10);
    expect(page.sourceRecovery.requestedRange).toMatchObject({
      startLine: 3,
      endLine: 4,
    });
    const nextSource = source.replace("enabled: true", "enabled: false");
    const next = read(nextSource, { offset: 3, limit: 2 }, 12000, "v2");
    expect(next.fileVersion).toBe("v2");
    expect(next.content).toBe(
      nextSource.slice(next.readSpan.start, next.readSpan.end),
    );
    expect(next.content).toContain("enabled: false");
    expect(next.content).not.toBe(page.content);
  });

  it("does not turn recovered source into historical coverage before provider delivery", () => {
    const guard = new ReadFileLoopGuard();
    guard.observeVisibleMessages([]);
    const page = guard.read(
      { offset: 1, limit: 5 },
      { filePath: "/work/feature.test.js", fileVersion: "v1" },
      () => read(source),
      () => {
        throw new Error("Unexpected range substitution");
      },
    );
    const entry = [...guard.progress.values()][0];
    expect(entry.confirmedSpans).toEqual([]);
    guard.observeVisibleMessages([
      {
        role: "tool",
        content: JSON.stringify(safeHostToolResultForModel("read_file", page)),
      },
    ]);
    expect(entry.confirmedSpans).toEqual([
      [page.readSpan.start, page.readSpan.end],
    ]);
    expect(entry.summary.reachedEnd).toBe(false);
    expect(entry.undeliveredReads).toBe(0);
  });

  it.each([
    ['const payload = {"value":1,"value":2};', { offset: 1, limit: 1 }],
    ['const payload = {"value": [1, 2};', { offset: 1, limit: 1 }],
    [
      'function read() {\n  const payload = {"value": 1, "value": 2};\n}',
      { offset: 1, limit: 2 },
    ],
  ])(
    "retains strict omission for ambiguous or malformed structures",
    (text, args) => {
      const page = read(text, args);
      expect(page.sourceRecovery).toBeUndefined();
      expect(safeHostToolResultForModel("read_file", page).contentOmitted).toBe(
        true,
      );
    },
  );

  it("keeps the ordinary page when complete surrounding source exceeds the output bound", () => {
    const large = source.replace(
      "  const labels",
      `  // ${"padding ".repeat(600)}\n  const labels`,
    );
    const page = read(large, { offset: 4, limit: 2 }, 2600);
    expect(page.sourceRecovery).toBeUndefined();
    expect(JSON.stringify(page).length).toBeLessThanOrEqual(2600);
  });

  it("does not reinterpret non-source or hashed reads", () => {
    const hashed = read(source, { hashed: true });
    expect(hashed.sourceRecovery).toBeUndefined();
    const text = buildReadFilePage(
      source,
      { path: "data.txt", offset: 1, limit: 5 },
      {
        filePath: "/work/data.txt",
        fileVersion: "v1",
        maxChars: 12000,
      },
    );
    expect(text.sourceRecovery).toBeUndefined();
    expect(text.range.endLine).toBe(5);
  });

  it.each([46000, 49340])(
    "leaves metadata headroom through the final provider cap (%i comment chars)",
    (padding) => {
      const snapshot = [
        'describe("feature", () => {',
        "  const labels = [",
        '    "left",',
        '    "right",',
        "  ];",
        `  // ${"x".repeat(padding)}`,
        "});",
      ].join("\n");
      const guard = new ReadFileLoopGuard();
      guard.observeVisibleMessages([]);
      const page = guard.read(
        { offset: 1, limit: 4 },
        { filePath: "/work/feature.test.js", fileVersion: "v1" },
        () => read(snapshot, {}, 50000),
        () => {
          throw new Error("Unexpected range substitution");
        },
      );
      const withTelemetry = {
        ...page,
        toolTelemetryRecord: { host: "metadata".repeat(100) },
      };
      const visible = JSON.parse(
        boundedToolResultText(
          JSON.stringify(
            safeHostToolResultForModel("read_file", withTelemetry),
          ),
          50000,
        ),
      );
      guard.observeVisibleMessages([
        { role: "tool", content: JSON.stringify(visible) },
      ]);
      const entry = [...guard.progress.values()][0];
      if (padding === 46000) {
        expect(visible.content).toBe(snapshot);
        expect(visible.sourceRecovery?.action).toBe(
          "complete-source-container",
        );
        expect(visible.contentOmitted).toBeUndefined();
        expect(entry.summary.reachedEnd).toBe(true);
      } else {
        expect(visible.sourceRecovery).toBeUndefined();
        expect(visible.contentOmitted).toBe(true);
        expect(entry.confirmedSpans).toEqual([]);
        expect(entry.undeliveredReads).toBe(1);
      }
      expect(JSON.stringify(visible).length).toBeLessThanOrEqual(50000);
    },
  );
});
