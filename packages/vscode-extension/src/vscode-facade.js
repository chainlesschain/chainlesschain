/**
 * Adapts the live VS Code API to the small `editor` facade that ide-tools.js
 * consumes. Isolating the `vscode` surface here keeps the tool logic testable
 * with a fake facade. This file only runs inside the extension host.
 */
const fs = require("fs");

const SEVERITY = ["error", "warning", "information", "hint"];

function createVscodeEditorFacade(vscode) {
  // Terminal-context capture (Claude-Code "terminal output in prompts" parity).
  // Feature-detected: shell-integration execution events are stable since VS
  // Code 1.93; on older hosts (engines is ^1.85) the buffer just stays empty.
  const { TerminalCapture } = require("./terminal-capture");
  const _terminalCapture = new TerminalCapture();
  const _terminalDisposables = [];
  if (
    vscode.window.onDidStartTerminalShellExecution &&
    vscode.window.onDidEndTerminalShellExecution
  ) {
    const reading = new Map(); // execution -> { command, terminal, output }
    const MAX_READ = 16000; // hard read cap before TerminalCapture re-caps
    _terminalDisposables.push(
      vscode.window.onDidStartTerminalShellExecution(async (e) => {
        const exec = e?.execution;
        if (!exec || typeof exec.read !== "function") return;
        const entry = {
          command: exec.commandLine?.value || "",
          terminal: e.terminal?.name || "",
          output: "",
        };
        reading.set(exec, entry);
        try {
          for await (const chunk of exec.read()) {
            entry.output += chunk;
            if (entry.output.length > MAX_READ) {
              entry.output = entry.output.slice(-MAX_READ);
            }
          }
        } catch {
          /* best-effort: a terminal that won't stream just yields no output */
        }
      }),
    );
    _terminalDisposables.push(
      vscode.window.onDidEndTerminalShellExecution((e) => {
        const exec = e?.execution;
        const entry = reading.get(exec);
        reading.delete(exec);
        if (entry) {
          _terminalCapture.record({
            command: entry.command,
            exitCode: typeof e.exitCode === "number" ? e.exitCode : null,
            output: entry.output,
            terminal: entry.terminal,
            endedAt: Date.now(),
          });
        }
      }),
    );
  }

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
      // Closing the diff tab IS the decision for most reviewers — race the
      // buttons against a tab-close watcher so the agent unblocks immediately
      // instead of waiting for someone to also dismiss the lingering toast.
      const CLOSED = Symbol("diff-tab-closed");
      const choice = await new Promise((resolve) => {
        let settled = false;
        let sub = null;
        const settle = (v) => {
          if (settled) return;
          settled = true;
          try {
            sub?.dispose();
          } catch {
            /* best-effort */
          }
          resolve(v);
        };
        const rightKey = rightDoc.uri.toString();
        // tabGroups landed in VS Code 1.67 — older hosts just keep the
        // button-only behavior (undefined → reject stays the fail-safe).
        if (vscode.window.tabGroups?.onDidChangeTabs) {
          sub = vscode.window.tabGroups.onDidChangeTabs((e) => {
            for (const tab of e?.closed || []) {
              const modified = tab?.input?.modified;
              if (modified && modified.toString() === rightKey) {
                settle(CLOSED);
                return;
              }
            }
          });
        }
        vscode.window
          .showInformationMessage(
            `Apply proposed changes to ${path}?`,
            { modal: false },
            "Accept",
            "Request changes…",
            "Pick hunks…",
            "Reject",
          )
          .then(settle, () => settle(undefined));
      });
      if (choice === CLOSED) {
        return { outcome: "rejected", path, closedDiff: true };
      }
      if (choice === "Request changes…") {
        // Inline review (Claude-Code parity): the reviewer annotates the diff
        // with revision notes instead of accept/reject. Nothing is written —
        // the notes ride back to the agent so it revises and re-proposes.
        const comments = await collectReviewComments(vscode, rightDoc);
        if (!comments || comments.length === 0) {
          return { outcome: "rejected", path }; // no actionable feedback
        }
        return {
          outcome: "changes-requested",
          path,
          comments,
          reviewedText: rightDoc.getText(),
        };
      }
      if (choice === "Accept") {
        const finalText = rightDoc.getText(); // includes any user edits
        await applyTextToFile(vscode, fileUri, finalText);
        return { outcome: "accepted", path, finalText };
      }
      if (choice === "Pick hunks…") {
        // Hunk-level partial accept: diff the (possibly user-edited) right
        // pane against the original and let the reviewer pick blocks with a
        // native multi-select QuickPick. Unpicked blocks keep the original.
        const { computeHunks, applyHunks } = require("./diff-hunks");
        const baseline =
          typeof originalText === "string"
            ? originalText
            : safeReadFile(path);
        const hunks = computeHunks(baseline, rightDoc.getText());
        if (hunks.length === 0) {
          return { outcome: "rejected", path }; // nothing to apply
        }
        const picks = await vscode.window.showQuickPick(
          hunks.map((h) => ({
            label: `Hunk ${h.index + 1}/${hunks.length} · ${h.header}`,
            description: h.preview,
            picked: true,
            hunk: h,
          })),
          {
            canPickMany: true,
            // Reviewers alt-tab to compare things mid-pick (or screenshot the
            // list) — focus loss must NOT silently cancel the review. Only an
            // explicit OK or Esc ends it. (Found live: a WeChat screenshot
            // killed the pick three demos in a row.)
            ignoreFocusOut: true,
            placeHolder:
              "勾选要应用的改动块(未勾选的保留原文);Esc 取消 = 不应用",
          },
        );
        // Esc / empty selection → fail-safe: nothing is written.
        if (!picks || picks.length === 0) {
          return { outcome: "rejected", path };
        }
        const finalText = applyHunks(
          baseline,
          hunks,
          picks.map((p) => p.hunk.index),
        );
        await applyTextToFile(vscode, fileUri, finalText);
        return {
          outcome: "accepted",
          path,
          finalText,
          appliedHunks: picks.length,
          totalHunks: hunks.length,
        };
      }
      return { outcome: "rejected", path };
    },

    // Batch review of a whole changeset (openMultiDiff): open VS Code's native
    // multi-file diff for several proposed changes at once, then BLOCK on a
    // decision (Accept all / Pick files… / Reject). Unlike openDiff the panes
    // are read-only — this is accept/reject of the proposal set, not in-place
    // editing — so on accept we write the proposed text for the chosen files.
    async openMultiDiff({ files, title }) {
      const {
        normalizeMultiDiffFiles,
        changesetSummary,
        fileLabel,
        selectWrites,
      } = require("./multi-diff");
      const norm = normalizeMultiDiffFiles(files);
      const changed = norm.filter(
        (f) => (f.originalText || "") !== f.modifiedText,
      );
      if (changed.length === 0) {
        return { outcome: "rejected", reason: "no changes" };
      }
      // Build the [resourceUri, leftUri, rightUri] list for vscode.changes.
      const resources = [];
      for (const f of changed) {
        const fileUri = vscode.Uri.file(f.path);
        let leftUri;
        if (typeof f.originalText === "string") {
          const leftDoc = await vscode.workspace.openTextDocument({
            content: f.originalText,
          });
          leftUri = leftDoc.uri;
        } else {
          leftUri = fileUri; // diff against the file on disk
        }
        const rightDoc = await vscode.workspace.openTextDocument({
          content: f.modifiedText,
        });
        resources.push([fileUri, leftUri, rightDoc.uri]);
      }
      try {
        await vscode.commands.executeCommand(
          "vscode.changes",
          title || `Review ${changed.length} changes`,
          resources,
        );
      } catch {
        // Multi-diff command unavailable (older host) — still prompt to decide.
      }
      const summary = changesetSummary(changed);
      const choice = await vscode.window
        .showInformationMessage(
          `Apply ${summary.count} proposed change(s)? (+${summary.totalAdded} -${summary.totalRemoved})`,
          { modal: false },
          "Accept all",
          "Pick files…",
          "Reject",
        )
        .then(
          (v) => v,
          () => undefined,
        );

      if (choice === "Accept all") {
        const writes = selectWrites(changed, null);
        for (const w of writes) {
          await applyTextToFile(
            vscode,
            vscode.Uri.file(w.path),
            w.modifiedText,
          );
        }
        return {
          outcome: "accepted",
          applied: writes.length,
          total: changed.length,
        };
      }
      if (choice === "Pick files…") {
        const picks = await vscode.window.showQuickPick(
          summary.files
            .filter((s) => !s.unchanged)
            .map((s) => ({ label: fileLabel(s), picked: true, path: s.path })),
          {
            canPickMany: true,
            ignoreFocusOut: true,
            placeHolder:
              "勾选要应用的文件(未勾选保留原样);Esc 取消 = 不应用",
          },
        );
        if (!picks || picks.length === 0) {
          return { outcome: "rejected" };
        }
        const writes = selectWrites(
          changed,
          picks.map((p) => p.path),
        );
        for (const w of writes) {
          await applyTextToFile(
            vscode,
            vscode.Uri.file(w.path),
            w.modifiedText,
          );
        }
        return {
          outcome: "accepted",
          applied: writes.length,
          total: changed.length,
          files: writes.map((w) => w.path),
        };
      }
      return { outcome: "rejected" };
    },

    // Notebook code execution via the Jupyter extension's Kernel API
    // (https://github.com/microsoft/vscode-jupyter/wiki/Kernel-API). The API
    // may require one-time user consent for third-party extensions; every
    // failure mode surfaces as a clear error the agent can act on.
    async executeCode({ code, timeoutMs }) {
      const jupyter = vscode.extensions.getExtension("ms-toolsai.jupyter");
      if (!jupyter) {
        throw new Error(
          "Jupyter extension (ms-toolsai.jupyter) is not installed",
        );
      }
      const api = jupyter.isActive ? jupyter.exports : await jupyter.activate();
      const notebook = vscode.window.activeNotebookEditor?.notebook;
      if (!notebook) {
        throw new Error(
          "No active notebook — open a notebook and start its kernel first",
        );
      }
      if (typeof api?.kernels?.getKernel !== "function") {
        throw new Error(
          "This Jupyter extension version does not expose the Kernel API",
        );
      }
      const kernel = await api.kernels.getKernel(notebook.uri);
      if (!kernel) {
        throw new Error(
          "No running kernel for the active notebook (start it, and grant " +
            "kernel access to this extension if prompted)",
        );
      }
      const tokenSource = new vscode.CancellationTokenSource();
      const budget = timeoutMs > 0 ? timeoutMs : 120000;
      const timer = setTimeout(() => tokenSource.cancel(), budget);
      const outputs = [];
      const decoder = new TextDecoder();
      try {
        for await (const items of kernel.executeCode(code, tokenSource.token)) {
          for (const item of items) {
            // OutputItem = { mime, data: Uint8Array }. Inline text-ish mimes;
            // anything else (images, widgets) is reported by mime only.
            const mime = item.mime || "unknown";
            const textual =
              mime.startsWith("text/") ||
              mime.includes("stdout") ||
              mime.includes("stderr") ||
              mime.includes("error") ||
              mime === "application/json";
            outputs.push({
              mime,
              text: textual
                ? decoder.decode(item.data).slice(0, 10000)
                : `(${item.data?.length ?? 0} bytes)`,
            });
          }
        }
      } finally {
        clearTimeout(timer);
        tokenSource.dispose();
      }
      const cancelled = tokenSource.token.isCancellationRequested;
      return { success: !cancelled, cancelled, outputs };
    },

    // Recent terminal commands + their output (shell integration). Lets the
    // agent see what you just ran and how it failed — Claude-Code parity for
    // "include terminal output in prompts". Empty on hosts without shell
    // integration (older VS Code) or before any command has run.
    async getTerminalOutput({ limit } = {}) {
      const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 3;
      return { terminals: _terminalCapture.recent(n) };
    },

    /** Dispose the shell-integration subscriptions (called on deactivate). */
    disposeTerminalCapture() {
      for (const d of _terminalDisposables) {
        try {
          d.dispose?.();
        } catch {
          /* best-effort */
        }
      }
      _terminalDisposables.length = 0;
    },
  };
}

/**
 * Collect line-anchored review comments for a "Request changes…" verdict.
 * Each note is anchored to the reviewer's current selection in the modified
 * (right) pane when available, so the agent learns WHICH lines to revise. An
 * empty input ends the review. Bounded loop so a stuck reviewer can't spin.
 * Returns `[{ line?, endLine?, lineText?, note }]` with 0-based editor lines.
 */
async function collectReviewComments(vscode, rightDoc) {
  const comments = [];
  const rightKey = rightDoc.uri.toString();
  for (let i = 0; i < 50; i++) {
    // Best-effort anchor: the visible right-pane editor's current selection.
    let anchor = {};
    try {
      const ed = (vscode.window.visibleTextEditors || []).find(
        (e) => e?.document?.uri?.toString() === rightKey,
      );
      if (ed && ed.selection) {
        const s = ed.selection;
        anchor = {
          line: s.start.line,
          endLine: s.end.line,
          lineText: ed.document.lineAt(s.start.line).text,
        };
      }
    } catch {
      /* anchor is optional — a general comment is still useful */
    }
    const where = Number.isInteger(anchor.line)
      ? anchor.endLine != null && anchor.endLine !== anchor.line
        ? `行 ${anchor.line + 1}-${anchor.endLine + 1}`
        : `行 ${anchor.line + 1}`
      : "整体";
    const note = await vscode.window.showInputBox({
      prompt: `评审意见 #${comments.length + 1}(锚定 ${where};留空结束评审)`,
      placeHolder: "描述希望 agent 如何修改这处改动…",
      // Reviewers alt-tab to inspect the diff while typing — focus loss must
      // not silently end the review (same lesson as the hunk-pick QuickPick).
      ignoreFocusOut: true,
    });
    if (!note || !note.trim()) break;
    comments.push({ ...anchor, note: note.trim() });
  }
  return comments;
}

/** Best-effort disk read for the hunk baseline (new files → empty). */
function safeReadFile(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
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
