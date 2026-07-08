/**
 * "✨ Explain / Refactor" CodeLens above functions, methods and classes
 * (Claude-Code / Copilot-Chat affordance parity): one click selects the
 * symbol's range and seeds the chat panel with the same @selection prompt as
 * the context-menu actions — no manual selecting first. Symbol discovery
 * rides the IDE's own DocumentSymbolProvider (`executeDocumentSymbolProvider`),
 * so it works for every language with a symbol provider and costs no CLI
 * spawn. `chainlesschain.codeLens.enabled` turns it off.
 *
 * flattenLensTargets is pure (plain symbol objects) → unit-testable; the
 * provider is thin glue over it.
 */

// vscode.SymbolKind values worth a lens: Class 4, Method 5, Constructor 8,
// Function 11. Numeric on purpose — the fake test host has no SymbolKind enum,
// and the real enum's values are API-stable.
const DEFAULT_LENS_KINDS = [4, 5, 8, 11];

// Bound the lens count so a 500-function generated file doesn't wallpaper the
// editor: DFS in document order, first MAX win (the visible top of the file).
const MAX_LENS_TARGETS = 30;

/**
 * Flatten a DocumentSymbol tree (document order, depth-first) to the symbols
 * that deserve a lens. Tolerates null/ragged input — the symbol provider can
 * return undefined while a language server is still starting.
 */
function flattenLensTargets(
  symbols,
  { kinds = DEFAULT_LENS_KINDS, maxTargets = MAX_LENS_TARGETS } = {},
) {
  const kindSet = new Set(kinds);
  const out = [];
  const walk = (list) => {
    for (const s of list || []) {
      if (out.length >= maxTargets) return;
      if (s && kindSet.has(s.kind)) out.push(s);
      if (s && Array.isArray(s.children) && s.children.length) {
        walk(s.children);
      }
    }
  };
  walk(Array.isArray(symbols) ? symbols : []);
  return out;
}

/**
 * The CodeLensProvider. `onDidChange` (optional) is the host event fired when
 * the enable setting flips, so open editors refresh without a reload.
 */
function createCcCodeLensProvider(vscode, { onDidChange } = {}) {
  return {
    onDidChangeCodeLenses: onDidChange,
    async provideCodeLenses(document) {
      const cfg = vscode.workspace.getConfiguration("chainlesschain.codeLens");
      if (cfg.get("enabled") === false) return [];
      let symbols;
      try {
        symbols = await vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",
          document.uri,
        );
      } catch {
        return []; // no provider / server starting — lenses are best-effort
      }
      const lenses = [];
      for (const s of flattenLensTargets(symbols)) {
        // Anchor on selectionRange (the name line) so the lens sits above the
        // signature; pass the FULL range so the seeded @selection covers the
        // whole body.
        const anchor = s.selectionRange || s.range;
        lenses.push(
          new vscode.CodeLens(anchor, {
            title: "✨ Explain",
            command: "chainlesschain.lens.explain",
            arguments: [document.uri, s.range],
          }),
          new vscode.CodeLens(anchor, {
            title: "✨ Refactor",
            command: "chainlesschain.lens.refactor",
            arguments: [document.uri, s.range],
          }),
        );
      }
      return lenses;
    },
  };
}

module.exports = {
  createCcCodeLensProvider,
  flattenLensTargets,
  DEFAULT_LENS_KINDS,
  MAX_LENS_TARGETS,
};
