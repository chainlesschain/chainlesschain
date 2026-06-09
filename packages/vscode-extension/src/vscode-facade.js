/**
 * Adapts the live VS Code API to the small `editor` facade that ide-tools.js
 * consumes. Isolating the `vscode` surface here keeps the tool logic testable
 * with a fake facade. This file only runs inside the extension host.
 */
const fs = require("fs");

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
      // The right pane is a real (editable) document, so the user can tweak the
      // proposal before accepting — we read its final text back on accept.
      const rightDoc = await vscode.workspace.openTextDocument({
        content: modifiedText,
      });
      await vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightDoc.uri,
        title || `Review: ${path}`,
        { preview: false },
      );

      // Phase 2: block the tool call until the user decides. Dismissing the
      // prompt (undefined) is treated as Reject — fail-safe, never auto-apply.
      const choice = await vscode.window.showInformationMessage(
        `Apply proposed changes to ${path}?`,
        { modal: false },
        "Accept",
        "Reject",
      );
      if (choice !== "Accept") {
        return { outcome: "rejected", path };
      }

      const finalText = rightDoc.getText(); // includes any user edits
      await applyTextToFile(vscode, fileUri, finalText);
      return { outcome: "accepted", path, finalText };
    },
  };
}

/**
 * Replace a file's whole content with `text` and save. Prefers a WorkspaceEdit
 * (keeps VS Code's undo history); falls back to a direct write for files VS
 * Code can't open as a text document (e.g. a brand-new path).
 */
async function applyTextToFile(vscode, fileUri, text) {
  try {
    const doc = await vscode.workspace.openTextDocument(fileUri);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length),
    );
    edit.replace(fileUri, fullRange, text);
    await vscode.workspace.applyEdit(edit);
    await doc.save();
  } catch {
    fs.writeFileSync(fileUri.fsPath, text, "utf8");
  }
}

module.exports = { createVscodeEditorFacade };
