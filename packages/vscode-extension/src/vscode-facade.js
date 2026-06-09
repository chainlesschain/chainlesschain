/**
 * Adapts the live VS Code API to the small `editor` facade that ide-tools.js
 * consumes. Isolating the `vscode` surface here keeps the tool logic testable
 * with a fake facade. This file only runs inside the extension host.
 */

const SEVERITY = ["error", "warning", "information", "hint"];

function createVscodeEditorFacade(vscode) {
  return {
    async getSelection() {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return null;
      const sel = ed.selection;
      return {
        file: ed.document.uri.fsPath,
        languageId: ed.document.languageId,
        selection: {
          start: { line: sel.start.line, character: sel.start.character },
          end: { line: sel.end.line, character: sel.end.character },
        },
        text: ed.document.getText(sel),
      };
    },

    async getDiagnostics({ path } = {}) {
      const out = [];
      for (const [uri, diags] of vscode.languages.getDiagnostics()) {
        const fsPath = uri.fsPath;
        if (path && fsPath !== path) continue;
        for (const d of diags) {
          out.push({
            file: fsPath,
            severity: SEVERITY[d.severity] ?? String(d.severity),
            message: d.message,
            line: d.range?.start?.line,
            character: d.range?.start?.character,
            source: d.source,
          });
        }
      }
      return out;
    },

    async getOpenEditors() {
      const active = vscode.window.activeTextEditor?.document?.uri?.fsPath;
      const seen = new Set();
      const out = [];
      for (const ed of vscode.window.visibleTextEditors || []) {
        const f = ed.document.uri.fsPath;
        if (seen.has(f)) continue;
        seen.add(f);
        out.push({
          file: f,
          active: f === active,
          languageId: ed.document.languageId,
        });
      }
      return out;
    },

    async openDiff({ path, modifiedText, originalText, title }) {
      const fileUri = vscode.Uri.file(path);
      let leftUri;
      if (typeof originalText === "string") {
        const leftDoc = await vscode.workspace.openTextDocument({
          content: originalText,
        });
        leftUri = leftDoc.uri;
      } else {
        leftUri = fileUri; // diff against the file on disk
      }
      const rightDoc = await vscode.workspace.openTextDocument({
        content: modifiedText,
      });
      await vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightDoc.uri,
        title || `Review: ${path}`,
      );
      // MVP: the diff is shown for manual review. Programmatic accept/reject
      // round-trip is Phase 2 (design module 98, §2.5 / Phase 2).
      return { shown: true, path };
    },
  };
}

module.exports = { createVscodeEditorFacade };
