/**
 * Pure helper for the "Insert File Reference" command (Cmd/Ctrl+Alt+K — Claude
 * Code parity). Turns a workspace-relative path into the `@<path> ` token the
 * chat input accepts; the CLI's file-ref expander resolves it server-side, so
 * this only has to produce the text. vscode-free → unit-testable without a host.
 *
 * With a `range` ({start,end} 1-based, inclusive — e.g. from the editor
 * selection) it emits `@<path>#L<start>-<end> ` (or `#L<n>` for a single line),
 * which the CLI expander slices to just those lines.
 */
function formatInsertReference(relPath, range) {
  const p = String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
  if (!p) return "";
  if (range && Number.isFinite(range.start) && range.start >= 1) {
    const start = Math.floor(range.start);
    const end =
      Number.isFinite(range.end) && range.end >= start
        ? Math.floor(range.end)
        : start;
    const suffix = start === end ? `#L${start}` : `#L${start}-${end}`;
    return `@${p}${suffix} `;
  }
  return `@${p} `;
}

/**
 * Convert a vscode selection-like object ({start:{line,character},
 * end:{line,character}, isEmpty}) into a 1-based inclusive line range, or null
 * for an empty selection. A selection ending at column 0 doesn't really include
 * that trailing line, so it's dropped (matches how editors highlight full lines).
 */
function selectionToLineRange(selection) {
  if (!selection || selection.isEmpty) return null;
  const startLine = selection.start && selection.start.line;
  let endLine = selection.end && selection.end.line;
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null;
  if (selection.end.character === 0 && endLine > startLine) endLine -= 1;
  return { start: startLine + 1, end: endLine + 1 };
}

module.exports = { formatInsertReference, selectionToLineRange };
