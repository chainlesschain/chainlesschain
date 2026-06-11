/**
 * Line-level diff → pickable hunks, for openDiff's hunk-level partial accept.
 *
 * computeHunks(original, modified) returns contiguous change blocks; the
 * reviewer picks a subset and applyHunks(original, hunks, selected) rebuilds
 * the file with ONLY those blocks applied. Invariants (tested):
 *   applyHunks(o, hunks, all)  === modified
 *   applyHunks(o, hunks, none) === original
 *
 * Pure Node, no `vscode`. LCS DP with common prefix/suffix trimming; a size
 * guard collapses pathological diffs into one whole-file hunk instead of
 * blowing memory (picking then degrades to plain accept/reject, which is
 * exactly the previous behavior).
 */

const MAX_DP_CELLS = 4_000_000; // ~16 MB Int32Array worst case

function splitLines(text) {
  return String(text ?? "").split("\n");
}

/**
 * @returns [{index, oldStart, oldLines, newStart, newLines, header, preview}]
 *          oldStart/newStart are 0-based line offsets into original/modified.
 */
function computeHunks(original, modified) {
  if (original === modified) return [];
  const oldL = splitLines(original);
  const newL = splitLines(modified);

  // common prefix / suffix
  let pre = 0;
  while (pre < oldL.length && pre < newL.length && oldL[pre] === newL[pre]) {
    pre++;
  }
  let endO = oldL.length;
  let endN = newL.length;
  while (endO > pre && endN > pre && oldL[endO - 1] === newL[endN - 1]) {
    endO--;
    endN--;
  }
  const midO = oldL.slice(pre, endO);
  const midN = newL.slice(pre, endN);

  // size guard → one whole-change hunk (degrades to accept/reject-all)
  if ((midO.length + 1) * (midN.length + 1) > MAX_DP_CELLS) {
    return [
      finalizeHunk({
        index: 0,
        oldStart: pre,
        oldLines: midO,
        newStart: pre,
        newLines: midN,
      }),
    ];
  }

  // LCS DP over the middle
  const n = midO.length;
  const m = midN.length;
  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] =
        midO[i] === midN[j]
          ? dp[(i + 1) * W + j + 1] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    }
  }

  // backtrack → group contiguous del/add runs into hunks
  const hunks = [];
  let cur = null;
  let i = 0;
  let j = 0;
  const open = () => {
    if (!cur) {
      cur = {
        oldStart: pre + i,
        oldLines: [],
        newStart: pre + j,
        newLines: [],
      };
    }
  };
  const close = () => {
    if (cur) {
      hunks.push(cur);
      cur = null;
    }
  };
  while (i < n || j < m) {
    if (i < n && j < m && midO[i] === midN[j]) {
      close();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i * W + j + 1] >= dp[(i + 1) * W + j])) {
      open();
      cur.newLines.push(midN[j]);
      j++;
    } else {
      open();
      cur.oldLines.push(midO[i]);
      i++;
    }
  }
  close();

  return hunks.map((h, index) => finalizeHunk({ index, ...h }));
}

function finalizeHunk(h) {
  const oldCount = h.oldLines.length;
  const newCount = h.newLines.length;
  const where =
    oldCount > 0
      ? `${h.oldStart + 1}-${h.oldStart + oldCount}`
      : `${h.oldStart}+`; // pure insertion sits between lines
  const firstChanged = (newCount > 0 ? h.newLines[0] : "- " + h.oldLines[0])
    .trim()
    .slice(0, 60);
  return {
    ...h,
    header: `行 ${where} (-${oldCount} +${newCount})`,
    preview: firstChanged,
  };
}

/**
 * Rebuild the file with only `selectedIndices` hunks applied; unselected
 * hunks keep the ORIGINAL lines.
 */
function applyHunks(original, hunks, selectedIndices) {
  const sel = new Set(selectedIndices || []);
  const oldL = splitLines(original);
  const sorted = [...(hunks || [])].sort((a, b) => a.oldStart - b.oldStart);
  const out = [];
  let cursor = 0;
  for (const h of sorted) {
    out.push(...oldL.slice(cursor, h.oldStart));
    out.push(...(sel.has(h.index) ? h.newLines : h.oldLines));
    cursor = h.oldStart + h.oldLines.length;
  }
  out.push(...oldL.slice(cursor));
  return out.join("\n");
}

module.exports = { computeHunks, applyHunks };
