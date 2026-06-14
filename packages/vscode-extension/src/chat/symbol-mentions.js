/**
 * Workspace-symbol entries for the chat `@`-completion (Claude Code parity:
 * find a file by a function/class/symbol name, not just by path). The CLI's
 * `@` expander only resolves `@<path>`, so a picked symbol inserts the file
 * that CONTAINS it — searching by symbol name surfaces files whose name
 * differs from the symbol. Pure (no `vscode`); the host injects the symbols
 * from `vscode.executeWorkspaceSymbolProvider`.
 */

// VS Code SymbolKind enum (numeric) → short label for the dropdown row.
const SYMBOL_KIND = {
  1: "module",
  2: "namespace",
  4: "class",
  5: "method",
  6: "property",
  7: "field",
  8: "ctor",
  9: "enum",
  10: "interface",
  11: "function",
  12: "var",
  13: "const",
  22: "struct",
  23: "event",
  25: "typeparam",
};

function symbolKindLabel(kind) {
  return SYMBOL_KIND[kind] || "symbol";
}

/**
 * Map VS Code SymbolInformation[] → completion items `{label, value}` where
 * `label` shows "<kind> <name> · <relpath>" and `value` is the workspace-
 * relative file path that gets inserted as `@<path>`. Skips nameless/pathless
 * entries; caps the list.
 */
function formatSymbolItems(symbols, root, limit) {
  const max = limit > 0 ? limit : 8;
  const list = Array.isArray(symbols) ? symbols : [];
  const out = [];
  for (const s of list) {
    if (!s || !s.name) continue;
    let p = (s.location && s.location.uri && s.location.uri.fsPath) || "";
    if (root && p.indexOf(root) === 0) p = p.slice(root.length + 1);
    p = p.replace(/\\/g, "/");
    if (!p) continue;
    out.push({
      label: symbolKindLabel(s.kind) + " " + String(s.name) + " · " + p,
      value: p,
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Keep the first item per inserted value, so a symbol whose file is already
 * offered by path search doesn't show a duplicate row. Items may be plain
 * path strings (files / ide mentions) or `{label, value}` objects (symbols).
 */
function dedupeMentionItems(items) {
  const seen = new Set();
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const value =
      it && typeof it === "object"
        ? String(it.value || "")
        : String(it == null ? "" : it);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(it);
  }
  return out;
}

module.exports = {
  SYMBOL_KIND,
  symbolKindLabel,
  formatSymbolItems,
  dedupeMentionItems,
};
