/**
 * Pure helper for the "Insert File Reference" command (Cmd/Ctrl+Alt+K — Claude
 * Code parity). Turns a workspace-relative path into the `@<path> ` token the
 * chat input accepts; the CLI's file-ref expander resolves it server-side, so
 * this only has to produce the text. vscode-free → unit-testable without a host.
 */
function formatInsertReference(relPath) {
  const p = String(relPath || "")
    .replace(/\\/g, "/")
    .trim();
  return p ? `@${p} ` : "";
}

module.exports = { formatInsertReference };
