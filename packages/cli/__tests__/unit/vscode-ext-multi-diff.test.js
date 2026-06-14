/**
 * multi-diff (slice 1) — pure changeset model behind openMultiDiff: normalize
 * the proposed file set, summarize per-file +/- (via the diff-hunks LCS), and
 * resolve a per-file accept decision into the writes to perform.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeMultiDiffFiles,
  changesetSummary,
  fileLabel,
  selectWrites,
} from "../../../vscode-extension/src/multi-diff.js";

describe("normalizeMultiDiffFiles", () => {
  it("drops invalid entries and dedupes by path (last write wins)", () => {
    const out = normalizeMultiDiffFiles([
      { path: "a.js", modifiedText: "1" },
      { path: "a.js", modifiedText: "2" }, // supersedes
      { path: "b.js" }, // no modifiedText → dropped
      { modifiedText: "x" }, // no path → dropped
      null,
      { path: "c.js", modifiedText: "z", originalText: "y" },
    ]);
    expect(out).toEqual([
      { path: "a.js", modifiedText: "2", originalText: null },
      { path: "c.js", modifiedText: "z", originalText: "y" },
    ]);
  });

  it("tolerates non-array input", () => {
    expect(normalizeMultiDiffFiles(null)).toEqual([]);
    expect(normalizeMultiDiffFiles(undefined)).toEqual([]);
  });
});

describe("changesetSummary", () => {
  it("computes per-file and total +/- with new-file flags", () => {
    const sum = changesetSummary([
      { path: "edit.js", originalText: "a\nb\nc", modifiedText: "a\nX\nc" }, // +1 -1
      { path: "new.js", originalText: "", modifiedText: "hello\nworld" }, // +2 new
    ]);
    expect(sum.count).toBe(2);
    expect(sum.totalAdded).toBe(3);
    expect(sum.totalRemoved).toBe(1);
    const edit = sum.files.find((f) => f.path === "edit.js");
    expect(edit).toMatchObject({ added: 1, removed: 1, isNew: false });
    const fresh = sum.files.find((f) => f.path === "new.js");
    expect(fresh).toMatchObject({ added: 2, removed: 0, isNew: true });
  });

  it("flags unchanged files", () => {
    const sum = changesetSummary([
      { path: "same.js", originalText: "x\ny", modifiedText: "x\ny" },
    ]);
    expect(sum.files[0]).toMatchObject({
      added: 0,
      removed: 0,
      unchanged: true,
    });
  });
});

describe("fileLabel", () => {
  it("renders counts and a new/unchanged flag", () => {
    expect(fileLabel({ path: "a.js", added: 12, removed: 3 })).toBe(
      "a.js  +12 -3",
    );
    expect(fileLabel({ path: "n.js", added: 5, removed: 0, isNew: true })).toBe(
      "n.js  +5 (new)",
    );
    expect(
      fileLabel({ path: "u.js", added: 0, removed: 0, unchanged: true }),
    ).toBe("u.js  ±0 (unchanged)");
  });
});

describe("selectWrites", () => {
  const files = [
    { path: "a.js", originalText: "1", modifiedText: "2" },
    { path: "b.js", originalText: "x", modifiedText: "y" },
    { path: "noop.js", originalText: "same", modifiedText: "same" },
  ];

  it("null selection accepts ALL changed files, dropping no-ops", () => {
    expect(selectWrites(files, null)).toEqual([
      { path: "a.js", modifiedText: "2" },
      { path: "b.js", modifiedText: "y" },
    ]);
  });

  it("a path set writes only those files (still dropping no-ops)", () => {
    expect(selectWrites(files, ["a.js", "noop.js"])).toEqual([
      { path: "a.js", modifiedText: "2" },
    ]);
  });

  it("empty selection writes nothing", () => {
    expect(selectWrites(files, [])).toEqual([]);
  });
});
