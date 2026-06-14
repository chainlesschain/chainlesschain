/**
 * "Explain / Refactor selection" — pure prompt builder for the editor
 * context-menu actions (Claude Code parity). Seeds the chat input with a
 * request that references `@selection` (the CLI expands it to the LIVE editor
 * selection through the IDE bridge — headless-stream expandIdeMentions), plus
 * a human pointer to the file + lines. vscode-free → unit-testable; the thin
 * command glue (read selection, seed panel) lives in extension.js.
 */

/** "line 12" for a single line, "lines 12-20" for a span (input is 0-based). */
function formatRange(startLine, endLine) {
  const a = (typeof startLine === "number" ? startLine : 0) + 1;
  const b =
    (typeof endLine === "number" ? endLine : startLine || 0) + 1;
  return b <= a ? `line ${a}` : `lines ${a}-${b}`;
}

/**
 * Build the seeded prompt for an editor selection action.
 * - explain  → a complete prompt (ends with newline; user can just Send)
 * - refactor → an open prompt (ends with ": " so the caret sits ready for the
 *   user to describe the change before Send)
 */
function formatSelectionPrompt(action, { relPath, startLine, endLine } = {}) {
  const rel = String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
  const where = rel ? ` (in ${rel}, ${formatRange(startLine, endLine)})` : "";
  if (action === "refactor") {
    return `Refactor @selection${where} — describe the change you want, then send: `;
  }
  return `Explain @selection${where} — what it does and how it works.\n`;
}

module.exports = { formatSelectionPrompt, formatRange };
