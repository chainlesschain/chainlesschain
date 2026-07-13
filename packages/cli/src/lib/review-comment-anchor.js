/**
 * Review-comment anchoring + staleness — the "行评论 / comment-to-fix" half of
 * P1-1 (原生复杂 Diff 与评论驱动修复) of
 * CLAUDE_CODE_IDE_INCREMENTAL_GAP_ANALYSIS_2026-07-13.md:
 *
 *   "行评论传递 file + base hash + line/hunk anchor + comment。
 *    Agent 修复后评论标记为 resolved/outdated，不错误复用旧行号。"
 *
 * [[review-pipeline.js]] aggregates FINDINGS (dedup / verdicts / rank), but a
 * finding's `line` is a raw number against one snapshot. Once the agent edits
 * the file, that number is a lie: line 42 now points at unrelated code. Claude
 * Code's diff review keeps a comment anchored to the CODE it addressed, not to a
 * coordinate, and after a re-diff it relocates the comment or marks it stale —
 * it never silently reuses the old line number against new content.
 *
 * This is the PURE anchoring core. An anchor captures the file, a content hash,
 * the 1-based line and the anchored line's text plus a small context window. On
 * a new file version it recomputes the comment's fate:
 *
 *   current   — file unchanged (hash match): line preserved.
 *   moved     — the anchored line relocated UNIQUELY: line updated.
 *   outdated  — the anchored line is gone (edited/deleted): line = null. The fix
 *               most likely addressed it; the old number must NOT be reused.
 *   ambiguous — several equally-plausible locations: line = null, needs a human.
 *
 * The hard invariant: whenever we cannot uniquely place the comment in the new
 * content, `line` is null. No stale coordinate ever survives a re-anchor.
 *
 * PURE: no fs / clock / RNG. Content hashing uses node:crypto (deterministic).
 */

import { createHash } from "node:crypto";

/** Terminal + transient states a comment can be in after re-anchoring. */
export const ANCHOR_STATUS = Object.freeze({
  CURRENT: "current", // file unchanged — line preserved
  MOVED: "moved", // relocated uniquely — line updated
  OUTDATED: "outdated", // anchored code gone — line null, do not reuse
  AMBIGUOUS: "ambiguous", // multiple candidates — line null, needs human
  RESOLVED: "resolved", // caller-set: the comment's issue was fixed
});

/** Deterministic content hash used as the anchor's base-version fingerprint. */
export function hashContent(content) {
  return createHash("sha256")
    .update(String(content ?? ""))
    .digest("hex");
}

function splitLines(content) {
  return String(content ?? "").split("\n");
}

/** Normalize a line for matching — trailing CR + surrounding whitespace only,
 *  preserving interior text so distinct statements stay distinct. */
function norm(line) {
  return String(line ?? "")
    .replace(/\r$/, "")
    .trim();
}

/**
 * Build a review-comment anchor from the file content it was written against.
 *
 * @param {object} params
 * @param {string} params.file          repo-relative path
 * @param {string} params.content       the base file content the comment addresses
 * @param {number} params.line          1-based line the comment anchors to
 * @param {string} params.comment       the review text
 * @param {string} [params.id]          stable comment id (caller-owned)
 * @param {number} [params.contextRadius=2]  context lines captured each side
 * @returns {object} an anchor record (serializable)
 */
export function makeCommentAnchor({
  file,
  content,
  line,
  comment,
  id = null,
  contextRadius = 2,
} = {}) {
  const lines = splitLines(content);
  const idx = Number(line) - 1; // to 0-based
  const inRange = Number.isInteger(idx) && idx >= 0 && idx < lines.length;
  const radius = Math.max(0, Math.floor(Number(contextRadius) || 0));
  return {
    id: id == null ? null : String(id),
    file: String(file ?? ""),
    baseHash: hashContent(content),
    line: inRange ? idx + 1 : null,
    comment: String(comment ?? ""),
    anchorLine: inRange ? String(lines[idx]) : "",
    contextBefore: inRange ? lines.slice(Math.max(0, idx - radius), idx) : [],
    contextAfter: inRange ? lines.slice(idx + 1, idx + 1 + radius) : [],
    status: ANCHOR_STATUS.CURRENT,
  };
}

/**
 * Score how well a candidate index's neighbourhood matches the anchor context.
 * Context is only a TIE-BREAKER among equal text matches, so a 0-radius anchor
 * (bare line match) still relocates when the match is unique.
 */
function contextScore(anchor, lines, i) {
  let score = 0;
  const before = anchor.contextBefore || [];
  for (let k = 0; k < before.length; k++) {
    const li = i - before.length + k;
    if (li >= 0 && norm(lines[li]) === norm(before[k])) score++;
  }
  const after = anchor.contextAfter || [];
  for (let k = 0; k < after.length; k++) {
    const li = i + 1 + k;
    if (li < lines.length && norm(lines[li]) === norm(after[k])) score++;
  }
  return score;
}

/**
 * Recompute a comment's fate against a new version of its file.
 *
 * @param {object} anchor        a record from makeCommentAnchor()
 * @param {string} newContent    the file's new content
 * @returns {object} the anchor with updated {status, line, previousLine}
 */
export function reanchorComment(anchor, newContent) {
  if (!anchor || typeof anchor !== "object") return anchor;
  const previousLine = anchor.line;
  const newHash = hashContent(newContent);

  // Unchanged file → the coordinate is still true.
  if (newHash === anchor.baseHash) {
    return {
      ...anchor,
      status: ANCHOR_STATUS.CURRENT,
      line: previousLine,
      previousLine,
    };
  }

  const target = norm(anchor.anchorLine);
  // An anchor with no captured text can never be relocated — it's stale.
  if (target === "") {
    return {
      ...anchor,
      status: ANCHOR_STATUS.OUTDATED,
      line: null,
      previousLine,
    };
  }

  const lines = splitLines(newContent);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    if (norm(lines[i]) === target) candidates.push(i);
  }

  if (candidates.length === 0) {
    // The exact anchored code no longer exists — the fix changed/removed it.
    return {
      ...anchor,
      status: ANCHOR_STATUS.OUTDATED,
      line: null,
      previousLine,
    };
  }

  // Disambiguate multiple text matches by surrounding context.
  let best = -1;
  const winners = [];
  for (const i of candidates) {
    const s = contextScore(anchor, lines, i);
    if (s > best) {
      best = s;
      winners.length = 0;
      winners.push(i);
    } else if (s === best) {
      winners.push(i);
    }
  }

  if (winners.length !== 1) {
    // Equally-plausible locations — refuse to guess; never reuse the old line.
    return {
      ...anchor,
      status: ANCHOR_STATUS.AMBIGUOUS,
      line: null,
      previousLine,
    };
  }

  const newLine = winners[0] + 1;
  const status =
    newLine === previousLine ? ANCHOR_STATUS.CURRENT : ANCHOR_STATUS.MOVED;
  return { ...anchor, status, line: newLine, previousLine };
}

/**
 * Explicitly mark a comment resolved (the agent's fix addressed its issue). A
 * caller-driven terminal state distinct from the auto-detected OUTDATED, so a
 * reviewer can tell "you fixed this" from "the code you commented on vanished".
 */
export function markResolved(anchor, resolvedReason = "") {
  return {
    ...anchor,
    status: ANCHOR_STATUS.RESOLVED,
    line: null,
    resolvedReason: String(resolvedReason || ""),
  };
}

/**
 * Re-anchor a list of comments against a new file version and bucket them.
 * `resolvedIds` (optional) forces those comment ids to RESOLVED before/around
 * the automatic re-anchor.
 *
 * @param {Array} anchors
 * @param {string} newContent
 * @param {{resolvedIds?:Iterable<string>}} [opts]
 * @returns {{comments:Array, current:string[], moved:string[],
 *            outdated:string[], ambiguous:string[], resolved:string[]}}
 */
export function reconcileComments(anchors, newContent, { resolvedIds } = {}) {
  const resolved = new Set([...(resolvedIds || [])].map((x) => String(x)));
  const comments = (Array.isArray(anchors) ? anchors : []).map((a) => {
    if (a && a.id != null && resolved.has(String(a.id))) {
      return markResolved(a, "marked resolved by caller");
    }
    return reanchorComment(a, newContent);
  });
  const bucket = (status) =>
    comments.filter((c) => c && c.status === status).map((c) => c.id);
  return {
    comments,
    current: bucket(ANCHOR_STATUS.CURRENT),
    moved: bucket(ANCHOR_STATUS.MOVED),
    outdated: bucket(ANCHOR_STATUS.OUTDATED),
    ambiguous: bucket(ANCHOR_STATUS.AMBIGUOUS),
    resolved: bucket(ANCHOR_STATUS.RESOLVED),
  };
}
