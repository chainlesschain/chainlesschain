/**
 * "Fix with ChainlessChain" code-action glue (Claude Code IDE parity).
 *
 * Registers a QuickFix CodeActionProvider so a lightbulb appears on any range
 * carrying diagnostics; choosing it seeds the chat panel with a fix request
 * scoped to that file + those problems (the command handler lives in
 * extension.js, which holds the chat provider). This file only touches the
 * `vscode` API through the injected handle, so the mapping + provider can be
 * unit-tested with a fake. All formatting is the pure src/chat/fix-with-cc.js.
 */
const { buildFixActionTitle } = require("./chat/fix-with-cc");

const FIX_COMMAND = "chainlesschain.chat.fixDiagnostics";

/** Map vscode Diagnostic[] → plain, serializable objects (command payload). */
function mapVscodeDiagnostics(diags) {
  return (Array.isArray(diags) ? diags : []).map((d) => {
    const startLine =
      d && d.range && d.range.start && typeof d.range.start.line === "number"
        ? d.range.start.line
        : 0;
    return {
      message: d && d.message != null ? String(d.message) : "",
      severity: d && typeof d.severity === "number" ? d.severity : 0,
      line: startLine,
      source: d && d.source ? String(d.source) : undefined,
      code: d && d.code != null ? d.code : undefined,
    };
  });
}

/**
 * CodeActionProvider adding a single "Fix with ChainlessChain" QuickFix when
 * the requested range carries diagnostics. The action invokes FIX_COMMAND with
 * a serializable payload (uri + plain diags) — no vscode objects cross the
 * command boundary.
 */
function createFixCodeActionProvider(vscode) {
  return {
    provideCodeActions(document, _range, context) {
      const raw = (context && context.diagnostics) || [];
      const diagnostics = mapVscodeDiagnostics(raw);
      if (!diagnostics.length) return [];
      const action = new vscode.CodeAction(
        buildFixActionTitle(diagnostics),
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = raw; // links the bulb to the underlying problems
      action.command = {
        command: FIX_COMMAND,
        title: "Fix with ChainlessChain",
        arguments: [{ uri: document && document.uri, diagnostics }],
      };
      return [action];
    },
  };
}

/**
 * For the command-palette / context-menu path (no lightbulb args): gather the
 * active editor's diagnostics, scoped to the selection if non-empty, else the
 * cursor line, else the whole file. Returns null when there's no editor or no
 * problems. Touches `vscode` only via the injected handle (fake-testable).
 */
function collectActiveDiagnostics(vscode) {
  const editor = vscode.window && vscode.window.activeTextEditor;
  if (!editor || !editor.document) return null;
  const uri = editor.document.uri;
  const all = mapVscodeDiagnostics(
    vscode.languages.getDiagnostics(uri) || [],
  );
  if (!all.length) return null;
  const sel = editor.selection;
  let scoped = all;
  if (sel && sel.isEmpty === false) {
    scoped = all.filter(
      (d) => d.line >= sel.start.line && d.line <= sel.end.line,
    );
  } else if (sel && sel.active) {
    const onLine = all.filter((d) => d.line === sel.active.line);
    scoped = onLine.length ? onLine : all;
  }
  if (!scoped.length) scoped = all; // selection missed every problem — fix all
  return { uri, diagnostics: scoped };
}

module.exports = {
  FIX_COMMAND,
  mapVscodeDiagnostics,
  createFixCodeActionProvider,
  collectActiveDiagnostics,
};
