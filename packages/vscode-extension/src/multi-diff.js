/**
 * Pure helpers for multi-file diff review (openMultiDiff — batch review of a
 * whole changeset at once, vs. openDiff's one-file-at-a-time). No `vscode`: it
 * normalizes the proposed file set, computes a per-file +/- summary (reusing the
 * diff-hunks LCS), and resolves a per-file accept decision into the writes to
 * perform. The facade (vscode-facade.js) handles the editor UI; this stays
 * host-free and unit-testable.
 *
 * Slice 1 of the batch-diff feature.
 */
const { computeHunks } = require("./diff-hunks");
const {
  checkReviewPayload,
  MAX_REVIEW_FILE_BYTES,
} = require("./diff-apply-guard");

const MAX_REVIEW_CHANGESET_FILES = 64;
const MAX_REVIEW_CHANGESET_BYTES = 8 * 1024 * 1024;
const REASON_CHANGESET_LIMIT = "changeset exceeds IDE diff review limits";

/**
 * Keep only valid `{path, modifiedText, originalText?}` entries, deduped by
 * path (last write wins — a later edit to the same file supersedes earlier).
 * originalText defaults to null (== "new file" for the summary).
 */
function normalizeMultiDiffFiles(files) {
  const byPath = new Map();
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || typeof f.path !== "string" || !f.path) continue;
    if (typeof f.modifiedText !== "string") continue;
    byPath.set(f.path, {
      path: f.path,
      modifiedText: f.modifiedText,
      originalText: typeof f.originalText === "string" ? f.originalText : null,
    });
  }
  return [...byPath.values()];
}

/** Per-file added/removed line counts + new/unchanged flags. */
function fileStat(f) {
  const original = f.originalText || "";
  const modified = f.modifiedText;
  if (original === modified) {
    return {
      path: f.path,
      added: 0,
      removed: 0,
      isNew: false,
      unchanged: true,
    };
  }
  // Whole-file add or delete: count lines directly so the phantom empty line
  // from splitLines("") isn't miscounted as a -1/+1.
  if (original === "" || modified === "") {
    return {
      path: f.path,
      added: modified === "" ? 0 : modified.split("\n").length,
      removed: original === "" ? 0 : original.split("\n").length,
      isNew: original === "" && modified !== "",
      unchanged: false,
    };
  }
  const hunks = computeHunks(original, modified);
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    added += h.newLines.length;
    removed += h.oldLines.length;
  }
  return { path: f.path, added, removed, isNew: false, unchanged: false };
}

/**
 * Changeset summary for the review UI: per-file stats + totals.
 * @returns {{files:Array, count:number, totalAdded:number, totalRemoved:number}}
 */
function changesetSummary(files) {
  const norm = normalizeMultiDiffFiles(files);
  const stats = norm.map(fileStat);
  return {
    files: stats,
    count: norm.length,
    totalAdded: stats.reduce((s, x) => s + x.added, 0),
    totalRemoved: stats.reduce((s, x) => s + x.removed, 0),
  };
}

/** One-line label for a file in the pick list, e.g. "src/a.js  +12 -3 (new)". */
function fileLabel(stat) {
  const parts = [];
  if (stat.added) parts.push("+" + stat.added);
  if (stat.removed) parts.push("-" + stat.removed);
  const flag = stat.isNew ? " (new)" : stat.unchanged ? " (unchanged)" : "";
  return `${stat.path}  ${parts.join(" ") || "±0"}${flag}`.trimEnd();
}

/**
 * Resolve which files to write. `selectedPaths` null/undefined → accept ALL;
 * otherwise only the listed paths. Unchanged files are dropped either way
 * (writing them is a no-op churn). Returns the `{path, modifiedText}` writes.
 */
function selectWrites(files, selectedPaths) {
  const sel = selectedPaths == null ? null : new Set(selectedPaths);
  return normalizeMultiDiffFiles(files)
    .filter((f) => (f.originalText || "") !== f.modifiedText) // skip no-ops
    .filter((f) => sel == null || sel.has(f.path))
    .map((f) => ({ path: f.path, modifiedText: f.modifiedText }));
}

/**
 * Partition a changeset before any native editor documents or LCS matrices are
 * created. Oversized/binary entries and entries beyond the aggregate budget
 * are reported, never silently applied.
 */
function planMultiDiffReview(
  files,
  {
    readCurrentBytes,
    maxFileBytes = MAX_REVIEW_FILE_BYTES,
    maxFiles = MAX_REVIEW_CHANGESET_FILES,
    maxTotalBytes = MAX_REVIEW_CHANGESET_BYTES,
  } = {},
) {
  const reviewable = [];
  const skipped = [];
  let totalBytes = 0;
  const fileLimit =
    Number.isSafeInteger(maxFiles) && maxFiles > 0
      ? maxFiles
      : MAX_REVIEW_CHANGESET_FILES;
  const byteLimit =
    Number.isSafeInteger(maxTotalBytes) && maxTotalBytes > 0
      ? maxTotalBytes
      : MAX_REVIEW_CHANGESET_BYTES;

  for (const file of normalizeMultiDiffFiles(files)) {
    if ((file.originalText || "") === file.modifiedText) continue;
    const current =
      file.originalText == null && typeof readCurrentBytes === "function"
        ? readCurrentBytes(file.path)
        : null;
    const currentBytes =
      current &&
      typeof current === "object" &&
      !(current instanceof Uint8Array) &&
      "bytes" in current
        ? current.bytes
        : current;
    const currentSizeBytes =
      current &&
      typeof current === "object" &&
      Number.isSafeInteger(current.sizeBytes)
        ? current.sizeBytes
        : undefined;
    const payload = checkReviewPayload({
      modifiedText: file.modifiedText,
      originalText: file.originalText,
      currentBytes,
      currentSizeBytes,
      maxBytes: maxFileBytes,
    });
    if (!payload.reviewable) {
      skipped.push({
        path: file.path,
        kind: payload.kind,
        reason: payload.reason,
        bytes: payload.bytes,
        limitBytes: payload.limitBytes,
      });
      continue;
    }
    if (
      reviewable.length >= fileLimit ||
      totalBytes + payload.bytes > byteLimit
    ) {
      skipped.push({
        path: file.path,
        kind: "changeset-limit",
        reason: REASON_CHANGESET_LIMIT,
        bytes: payload.bytes,
        limitBytes: byteLimit,
      });
      continue;
    }
    reviewable.push(file);
    totalBytes += payload.bytes;
  }

  return {
    reviewable,
    skipped,
    totalBytes,
    degraded: skipped.length > 0,
    limits: {
      maxFileBytes:
        Number.isSafeInteger(maxFileBytes) && maxFileBytes > 0
          ? maxFileBytes
          : MAX_REVIEW_FILE_BYTES,
      maxFiles: fileLimit,
      maxTotalBytes: byteLimit,
    },
  };
}

module.exports = {
  normalizeMultiDiffFiles,
  fileStat,
  changesetSummary,
  fileLabel,
  selectWrites,
  planMultiDiffReview,
  MAX_REVIEW_CHANGESET_FILES,
  MAX_REVIEW_CHANGESET_BYTES,
  REASON_CHANGESET_LIMIT,
};
