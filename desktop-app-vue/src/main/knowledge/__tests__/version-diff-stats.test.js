import { describe, it, expect } from "vitest";

const {
  KnowledgeVersionManager,
  lineDiffStats,
} = require("../version-manager");

describe("lineDiffStats (LCS line diff)", () => {
  it("reports zero changes for identical lines", () => {
    expect(lineDiffStats(["a", "b"], ["a", "b"])).toEqual({
      addedLines: 0,
      deletedLines: 0,
    });
  });

  it("reports a full rewrite when line count is equal but content differs (the bug)", () => {
    // Old net-count logic returned 0/0 here; LCS=0 → 3 added + 3 deleted.
    expect(lineDiffStats(["a", "b", "c"], ["x", "y", "z"])).toEqual({
      addedLines: 3,
      deletedLines: 3,
    });
  });

  it("counts pure additions", () => {
    expect(lineDiffStats(["a"], ["a", "b", "c"])).toEqual({
      addedLines: 2,
      deletedLines: 0,
    });
  });

  it("counts pure deletions", () => {
    expect(lineDiffStats(["a", "b", "c"], ["a"])).toEqual({
      addedLines: 0,
      deletedLines: 2,
    });
  });

  it("counts a single deleted middle line via LCS", () => {
    expect(lineDiffStats(["a", "b", "c"], ["a", "c"])).toEqual({
      addedLines: 0,
      deletedLines: 1,
    });
  });

  it("counts a replaced middle line as 1 added + 1 deleted", () => {
    expect(lineDiffStats(["a", "b", "c"], ["a", "x", "c"])).toEqual({
      addedLines: 1,
      deletedLines: 1,
    });
  });

  it("handles empty inputs", () => {
    expect(lineDiffStats([], [])).toEqual({ addedLines: 0, deletedLines: 0 });
    expect(lineDiffStats([], ["a"])).toEqual({
      addedLines: 1,
      deletedLines: 0,
    });
    expect(lineDiffStats(["a"], [])).toEqual({
      addedLines: 0,
      deletedLines: 1,
    });
  });
});

describe("compareVersions diff stats (no DB — mocked getVersion)", () => {
  function managerWith(versions) {
    const m = new KnowledgeVersionManager(null);
    m.getVersion = (id) => versions[id] || null;
    return m;
  }

  it("reports non-zero changes for an equal-line-count full rewrite", () => {
    const m = managerWith({
      v1: { id: "v1", title: "t", content: "apple\nbanana\ncherry" },
      v2: { id: "v2", title: "t", content: "dog\nelephant\nfox" },
    });

    const r = m.compareVersions("v1", "v2");
    expect(r.success).toBe(true);
    expect(r.diff.contentChanged).toBe(true);
    expect(r.diff.addedLines).toBe(3);
    expect(r.diff.deletedLines).toBe(3);
    expect(r.diff.totalChanges).toBe(6); // not 0 (the old bug)
  });

  it("reports zero changes for identical content", () => {
    const m = managerWith({
      v1: { id: "v1", title: "t", content: "same\ntext" },
      v2: { id: "v2", title: "t", content: "same\ntext" },
    });
    const r = m.compareVersions("v1", "v2");
    expect(r.diff.contentChanged).toBe(false);
    expect(r.diff.totalChanges).toBe(0);
  });

  it("detects a title-only change with no line changes", () => {
    const m = managerWith({
      v1: { id: "v1", title: "old", content: "body" },
      v2: { id: "v2", title: "new", content: "body" },
    });
    const r = m.compareVersions("v1", "v2");
    expect(r.diff.titleChanged).toBe(true);
    expect(r.diff.totalChanges).toBe(0);
  });

  it("fails for a missing version", () => {
    const m = managerWith({ v2: { id: "v2", title: "t", content: "x" } });
    expect(m.compareVersions("nope", "v2").success).toBe(false);
  });
});
