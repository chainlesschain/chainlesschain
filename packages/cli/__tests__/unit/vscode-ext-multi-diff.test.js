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
  planMultiDiffReview,
  normalizeFileMode,
  REASON_CHANGESET_LIMIT,
  REASON_MODE_CHANGE_UNSUPPORTED,
} from "../../../vscode-extension/src/multi-diff.js";
import {
  REASON_BINARY_SKIPPED,
  REASON_LARGE_FILE_SKIPPED,
} from "../../../vscode-extension/src/diff-apply-guard.js";

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
      {
        path: "a.js",
        modifiedText: "2",
        originalText: null,
        operation: "modify",
        targetPath: null,
        oldMode: null,
        newMode: null,
      },
      {
        path: "c.js",
        modifiedText: "z",
        originalText: "y",
        operation: "modify",
        targetPath: null,
        oldMode: null,
        newMode: null,
      },
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
    expect(
      fileLabel({
        path: "old.js",
        added: 0,
        removed: 0,
        operation: "rename",
        targetPath: "new.js",
      }),
    ).toBe("old.js  ±0 (rename → new.js)");
    expect(
      fileLabel({
        path: "run.sh",
        added: 0,
        removed: 0,
        operation: "mode-change",
        oldMode: "100644",
        newMode: "100755",
      }),
    ).toBe("run.sh  ±0 (mode 100644 → 100755)");
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
      {
        path: "a.js",
        modifiedText: "2",
        operation: "modify",
        targetPath: null,
        oldMode: null,
        newMode: null,
      },
      {
        path: "b.js",
        modifiedText: "y",
        operation: "modify",
        targetPath: null,
        oldMode: null,
        newMode: null,
      },
    ]);
  });

  it("a path set writes only those files (still dropping no-ops)", () => {
    expect(selectWrites(files, ["a.js", "noop.js"])).toEqual([
      {
        path: "a.js",
        modifiedText: "2",
        operation: "modify",
        targetPath: null,
        oldMode: null,
        newMode: null,
      },
    ]);
  });

  it("empty selection writes nothing", () => {
    expect(selectWrites(files, [])).toEqual([]);
  });

  it("preserves mixed lifecycle operations", () => {
    expect(
      selectWrites(
        [
          {
            path: "remove.js",
            originalText: "x",
            modifiedText: "",
            operation: "delete",
          },
          {
            path: "old.js",
            targetPath: "new.js",
            originalText: "x",
            modifiedText: "x",
            operation: "rename",
          },
          {
            path: "run.sh",
            originalText: "echo ok",
            modifiedText: "echo ok",
            operation: "mode-change",
            oldMode: "100644",
            newMode: "100755",
          },
        ],
        null,
      ),
    ).toMatchObject([
      { path: "remove.js", operation: "delete" },
      { path: "old.js", operation: "rename", targetPath: "new.js" },
      {
        path: "run.sh",
        operation: "mode-change",
        oldMode: "100644",
        newMode: "100755",
      },
    ]);
  });
});

describe("planMultiDiffReview", () => {
  it("partitions binary, per-file-large and reviewable entries", () => {
    const plan = planMultiDiffReview(
      [
        { path: "ok.js", originalText: "a", modifiedText: "b" },
        { path: "large.js", originalText: "12", modifiedText: "345" },
        { path: "blob.bin", originalText: "a\u0000", modifiedText: "b" },
      ],
      { maxFileBytes: 4, maxFiles: 10, maxTotalBytes: 100 },
    );
    expect(plan.reviewable.map((f) => f.path)).toEqual(["ok.js"]);
    expect(plan.skipped).toEqual([
      {
        path: "large.js",
        kind: "large-file",
        reason: REASON_LARGE_FILE_SKIPPED,
        bytes: 5,
        limitBytes: 4,
      },
      {
        path: "blob.bin",
        kind: "binary",
        reason: REASON_BINARY_SKIPPED,
        bytes: 3,
        limitBytes: 4,
      },
    ]);
    expect(plan.degraded).toBe(true);
  });

  it("bounds file count and aggregate payload deterministically", () => {
    const plan = planMultiDiffReview(
      [
        { path: "a.js", originalText: "", modifiedText: "aa" },
        { path: "b.js", originalText: "", modifiedText: "bb" },
        { path: "c.js", originalText: "", modifiedText: "cc" },
      ],
      { maxFileBytes: 10, maxFiles: 2, maxTotalBytes: 3 },
    );
    expect(plan.reviewable.map((f) => f.path)).toEqual(["a.js"]);
    expect(plan.skipped.map((f) => f.path)).toEqual(["b.js", "c.js"]);
    expect(plan.skipped.every((f) => f.reason === REASON_CHANGESET_LIMIT)).toBe(
      true,
    );
    expect(plan.totalBytes).toBe(2);
  });

  it("uses current raw bytes when originalText is omitted", () => {
    const plan = planMultiDiffReview(
      [{ path: "disk.bin", modifiedText: "text" }],
      {
        readCurrentBytes: () => Buffer.from([1, 0, 2]),
        maxFileBytes: 100,
      },
    );
    expect(plan.reviewable).toEqual([]);
    expect(plan.skipped[0]).toMatchObject({
      path: "disk.bin",
      kind: "binary",
    });
  });

  it("keeps lifecycle entries and explicitly degrades unsupported mode changes", () => {
    const files = [
      {
        path: "remove.js",
        originalText: "x",
        modifiedText: "",
        operation: "delete",
      },
      {
        path: "run.sh",
        originalText: "echo ok",
        modifiedText: "echo ok",
        operation: "mode-change",
        oldMode: "100644",
        newMode: "100755",
      },
    ];
    expect(
      planMultiDiffReview(files, { supportsModeChange: true }).reviewable.map(
        (f) => f.operation,
      ),
    ).toEqual(["delete", "mode-change"]);
    const degraded = planMultiDiffReview(files, {
      supportsModeChange: false,
    });
    expect(degraded.reviewable.map((f) => f.operation)).toEqual(["delete"]);
    expect(degraded.skipped[0]).toMatchObject({
      path: "run.sh",
      kind: "unsupported-operation",
      reason: REASON_MODE_CHANGE_UNSUPPORTED,
    });
  });

  it("rejects malformed lifecycle entries before review", () => {
    const plan = planMultiDiffReview([
      {
        path: "bad-delete.js",
        originalText: "x",
        modifiedText: "still here",
        operation: "delete",
      },
      {
        path: "bad-rename.js",
        originalText: "x",
        modifiedText: "x",
        operation: "rename",
      },
    ]);
    expect(plan.reviewable).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(
      plan.skipped.every((entry) => entry.kind === "unsupported-operation"),
    ).toBe(true);
  });
});

describe("normalizeFileMode", () => {
  it("accepts POSIX and Git modes but rejects malformed values", () => {
    expect(normalizeFileMode("100755")).toBe(0o755);
    expect(normalizeFileMode("0644")).toBe(0o644);
    expect(normalizeFileMode(0o600)).toBe(0o600);
    expect(normalizeFileMode("755x")).toBeNull();
    expect(normalizeFileMode(0o1000)).toBeNull();
  });
});
