/**
 * Adapts the live VS Code API to the small `editor` facade that ide-tools.js
 * consumes. Isolating the `vscode` surface here keeps the tool logic testable
 * with a fake facade. This file only runs inside the extension host.
 */
const fs = require("fs");
const nodePath = require("path");
const {
  checkApplySafety,
  checkReviewPayload,
  MAX_REVIEW_FILE_BYTES,
  REASON_DISK_DRIFTED,
} = require("./diff-apply-guard");

const SEVERITY = ["error", "warning", "information", "hint"];

function createVscodeEditorFacade(vscode, opts = {}) {
  const hostPlatform = opts.platform || process.platform;
  // Optional provider for the App Preview controller (created lazily by the
  // preview.start command) — getPreviewState reads through it so the tool
  // reports "not running" before the first start instead of being absent.
  const getPreview =
    typeof opts.getPreview === "function" ? opts.getPreview : () => null;
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
    if (vscode.window.onDidCloseTerminal) {
      _terminalDisposables.push(
        vscode.window.onDidCloseTerminal((term) => {
          // A terminal killed WITHOUT an end event would otherwise leave its
          // in-flight reading entry (up to MAX_READ of buffered output) in the
          // Map for the extension's lifetime. Drop any entries for it.
          const name = term?.name || "";
          for (const [exec, entry] of reading) {
            if (entry.terminal === name) reading.delete(exec);
          }
        }),
      );
    }
  }

  // The diff reviews currently blocking openDiff/openMultiDiff, so a
  // keybinding-driven command (Accept / Reject) can settle one without
  // reaching for a notification button. A stack, not a single slot: two chat
  // tabs can each block on a review at once — the keys prefer the review whose
  // diff tab is focused, falling back to the most recent, and the
  // `chainlesschainDiffActive` context key stays on while ANY review is open.
  const activeReviews = [];
  const removeReview = (review) => {
    const i = activeReviews.indexOf(review);
    if (i >= 0) activeReviews.splice(i, 1);
    setDiffContext(activeReviews.length > 0);
  };
  const pickReview = () => {
    if (activeReviews.length === 0) return null;
    try {
      const tab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
      if (tab) {
        for (let i = activeReviews.length - 1; i >= 0; i--) {
          if (activeReviews[i].matchesTab?.(tab)) return activeReviews[i];
        }
      }
    } catch {
      /* fall back to most recent */
    }
    return activeReviews[activeReviews.length - 1];
  };
  const setDiffContext = (on) => {
    try {
      vscode.commands.executeCommand(
        "setContext",
        "chainlesschainDiffActive",
        !!on,
      );
    } catch {
      /* best-effort — a missing setContext just leaves the keybindings idle */
    }
  };

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

    async getActiveFile() {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return null;
      const pos = ed.selection?.active || ed.selection?.start;
      return {
        file: ed.document.uri.fsPath,
        languageId: ed.document.languageId,
        isDirty: Boolean(ed.document.isDirty),
        cursor: pos ? { line: pos.line, character: pos.character } : null,
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
      const push = (uri, doc) => {
        const f = uri?.fsPath;
        if (!f || seen.has(f)) return;
        seen.add(f);
        out.push({
          file: f,
          active: f === active,
          languageId: doc ? doc.languageId : undefined,
          // Unsaved-buffer flag so the agent knows the on-disk copy is stale
          // before it reads the file (Claude-Code IDE exposes checkDocumentDirty
          // for the same reason). Always a boolean for older/fake hosts.
          isDirty: Boolean(doc && doc.isDirty),
        });
      };
      // Prefer ALL open tabs (including background ones, not just the split-
      // visible editors) — matches the JetBrains panel's getOpenFiles and
      // Claude-Code IDE. tabGroups landed in VS Code 1.67; older hosts fall back
      // to the visible editors. A tab only carries its uri, so look the document
      // up in workspace.textDocuments for languageId + dirty state.
      const groups = vscode.window.tabGroups?.all;
      if (Array.isArray(groups)) {
        const docByUri = new Map();
        for (const d of vscode.workspace.textDocuments || []) {
          docByUri.set(d.uri.toString(), d);
        }
        for (const group of groups) {
          for (const tab of group.tabs || []) {
            // Text tabs expose input.uri; diff / webview / image tabs do not.
            const uri = tab?.input?.uri;
            if (!uri) continue;
            push(uri, docByUri.get(uri.toString()));
          }
        }
      } else {
        for (const ed of vscode.window.visibleTextEditors || []) {
          push(ed.document.uri, ed.document);
        }
      }
      return out;
    },

    async openDiff({
      path,
      modifiedText,
      originalText,
      title,
      operation = "modify",
      targetPath = null,
    }) {
      const lifecycleOperation =
        operation === "delete" || operation === "rename";
      if (!["modify", "create", "delete", "rename"].includes(operation)) {
        return {
          outcome: "rejected",
          path,
          operation,
          reason: "unsupported diff operation",
        };
      }
      if (operation === "rename" && !targetPath) {
        return {
          outcome: "rejected",
          path,
          operation,
          reason: "rename target missing",
        };
      }
      // Binary guard: the whole diff pipeline is UTF-8 text — reviewing (and
      // on accept, rewriting) a binary file through it corrupts the bytes.
      // Short-circuit before any UI opens; nothing is written.
      const currentProbe =
        typeof originalText === "string" ? null : safeReadFileProbe(path);
      const reviewPayload = checkReviewPayload({
        modifiedText,
        originalText,
        currentBytes: currentProbe?.bytes,
        currentSizeBytes: currentProbe?.sizeBytes,
      });
      if (!reviewPayload.reviewable) {
        return {
          outcome: "rejected",
          path,
          operation,
          ...(targetPath ? { targetPath } : {}),
          reason: reviewPayload.reason,
          degradation: reviewPayload,
        };
      }
      const auditBaselineText =
        typeof originalText === "string"
          ? originalText
          : currentTextForDrift(vscode, path);
      const withAuditBaseline = (decision) => ({
        ...decision,
        operation,
        ...(targetPath ? { targetPath } : {}),
        _auditBaselineText: auditBaselineText,
      });
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
          removeReview(review); // a keybinding can no longer resolve this review
          try {
            sub?.dispose();
          } catch {
            /* best-effort */
          }
          resolve(v);
        };
        const rightKey = rightDoc.uri.toString();
        // Expose this review to the Accept/Reject keybinding commands.
        const review = {
          settle,
          accept: "Accept",
          reject: "Reject",
          matchesTab: (tab) => tab?.input?.modified?.toString() === rightKey,
        };
        activeReviews.push(review);
        setDiffContext(true);
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
            diffReviewPrompt(operation, path, targetPath),
            { modal: false },
            "Accept",
            "Request changes…",
            ...(!lifecycleOperation ? ["Pick hunks…"] : []),
            "Reject",
          )
          .then(settle, () => settle(undefined));
      });
      if (choice === CLOSED) {
        // The reviewer closed the diff tab themselves — it is already gone.
        return withAuditBaseline({
          outcome: "rejected",
          path,
          closedDiff: true,
        });
      }
      // Close the (now-stale) diff tab once a BUTTON decision is fully handled.
      // Accept / Pick hunks / Request changes otherwise leave the tab open, so
      // diff tabs pile up across a multi-edit session (Claude-Code ships
      // closeAllDiffTabs for exactly this). The `finally` runs AFTER each path
      // has read rightDoc.getText(), so no in-pane user edit is lost to the close.
      const closeDiffTab = async () => {
        const groups = vscode.window.tabGroups;
        if (!groups?.all || typeof groups.close !== "function") return;
        const rightKey = rightDoc.uri.toString();
        try {
          for (const group of groups.all) {
            for (const tab of group.tabs || []) {
              const modified = tab?.input?.modified;
              if (modified && modified.toString() === rightKey) {
                await groups.close(tab);
                return;
              }
            }
          }
        } catch {
          /* best-effort — never block the decision on tab cleanup */
        }
      };
      try {
        if (choice === "Request changes…") {
          // Inline review (Claude-Code parity): the reviewer annotates the diff
          // with revision notes instead of accept/reject. Nothing is written —
          // the notes ride back to the agent so it revises and re-proposes.
          const comments = await collectReviewComments(vscode, rightDoc);
          if (!comments || comments.length === 0) {
            return withAuditBaseline({ outcome: "rejected", path }); // no actionable feedback
          }
          return withAuditBaseline({
            outcome: "changes-requested",
            path,
            comments,
            reviewedText: rightDoc.getText(),
          });
        }
        if (choice === "Accept") {
          const finalText = rightDoc.getText(); // includes any user edits
          // Optimistic-concurrency gate: the review was decided against
          // `originalText` — if the disk moved meanwhile, don't blind-write.
          if (!(await confirmDriftOverwrite(vscode, path, originalText))) {
            return withAuditBaseline({
              outcome: "rejected",
              path,
              reason: REASON_DISK_DRIFTED,
            });
          }
          try {
            if (operation === "delete") {
              deleteReviewedFile(path);
              return withAuditBaseline({ outcome: "accepted", path });
            }
            if (operation === "rename") {
              await renameReviewedFile(
                vscode,
                path,
                targetPath,
                finalText,
                auditBaselineText,
              );
              return withAuditBaseline({
                outcome: "accepted",
                path,
                targetPath,
                finalText,
              });
            }
            await applyTextToFile(vscode, fileUri, finalText);
            return withAuditBaseline({ outcome: "accepted", path, finalText });
          } catch (error) {
            return withAuditBaseline({
              outcome: "rejected",
              path,
              reason: `apply failed: ${String(error?.message || error).slice(0, 240)}`,
            });
          }
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
            return withAuditBaseline({ outcome: "rejected", path }); // nothing to apply
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
              placeHolder: vscode.l10n.t(
                "Check the change blocks to apply (unchecked = keep the original); Esc to cancel = apply nothing",
              ),
            },
          );
          // Esc / empty selection → fail-safe: nothing is written.
          if (!picks || picks.length === 0) {
            return withAuditBaseline({ outcome: "rejected", path });
          }
          const finalText = applyHunks(
            baseline,
            hunks,
            picks.map((p) => p.hunk.index),
          );
          // Same drift gate as Accept: hunks were computed against the agent's
          // baseline, so a moved disk would be clobbered by this write too.
          if (!(await confirmDriftOverwrite(vscode, path, originalText))) {
            return withAuditBaseline({
              outcome: "rejected",
              path,
              reason: REASON_DISK_DRIFTED,
            });
          }
          await applyTextToFile(vscode, fileUri, finalText);
          return withAuditBaseline({
            outcome: "accepted",
            path,
            finalText,
            appliedHunks: picks.length,
            totalHunks: hunks.length,
            selectedHunks: picks.map((pick) => pick.hunk.index),
          });
        }
        return withAuditBaseline({ outcome: "rejected", path });
      } finally {
        await closeDiffTab();
      }
    },

    // Keybinding-driven decisions for the diff review blocking openDiff (the
    // command glue in extension.js binds Cmd/Ctrl+Enter → accept, a key → reject,
    // both scoped to the `chainlesschainDiffActive` context). No-op when no
    // review is open. Returns whether a review was actually settled.
    acceptActiveDiff() {
      const review = pickReview();
      if (!review) return false;
      review.settle(review.accept);
      return true;
    },
    rejectActiveDiff() {
      const review = pickReview();
      if (!review) return false;
      review.settle(review.reject);
      return true;
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
        planMultiDiffReview,
        normalizeFileMode,
      } = require("./multi-diff");
      const norm = normalizeMultiDiffFiles(files);
      // Binary guard (same as openDiff): a binary file must never round-trip
      // the UTF-8 text pipeline — drop it from the reviewable set up front.
      const reviewPlan = planMultiDiffReview(norm, {
        readCurrentBytes: safeReadFileProbe,
        supportsModeChange: hostPlatform !== "win32",
      });
      const skippedBinary = reviewPlan.skipped
        .filter((entry) => entry.kind === "binary")
        .map((entry) => entry.path);
      const skippedLarge = reviewPlan.skipped
        .filter(
          (entry) =>
            entry.kind === "large-file" || entry.kind === "changeset-limit",
        )
        .map((entry) => entry.path);
      const skippedUnsupported = reviewPlan.skipped
        .filter((entry) => entry.kind === "unsupported-operation")
        .map((entry) => entry.path);
      const changed = reviewPlan.reviewable;
      const withDegradation = (result) => {
        if (!reviewPlan.degraded) return result;
        return {
          ...result,
          degraded: true,
          degradation: {
            requested: norm.length,
            reviewable: changed.length,
            skipped: reviewPlan.skipped,
            limits: reviewPlan.limits,
          },
          ...(skippedBinary.length > 0 ? { skippedBinary } : {}),
          ...(skippedLarge.length > 0 ? { skippedLarge } : {}),
          ...(skippedUnsupported.length > 0 ? { skippedUnsupported } : {}),
        };
      };
      if (changed.length === 0) {
        return withDegradation({
          outcome: "rejected",
          reason: reviewPlan.skipped[0]?.reason || "no changes",
        });
      }
      // Baseline per path for the accept-time drift gate (normalize() stores
      // null when the caller sent no baseline → gate stays inert for those).
      const baselineByPath = new Map(
        changed.map((f) => [f.path, f.originalText]),
      );
      // Write the chosen files, skipping any whose disk drifted from the
      // reviewed baseline and whose overwrite the user declined.
      const applyWritesGuarded = async (writes) => {
        const written = [];
        const skippedConflicts = [];
        const failedOperations = [];
        const appliedOperations = [];
        for (const w of writes) {
          const baseline = baselineByPath.get(w.path);
          const ok = await confirmDriftOverwrite(
            vscode,
            w.path,
            typeof baseline === "string" ? baseline : undefined,
          );
          if (!ok) {
            skippedConflicts.push(w.path);
            continue;
          }
          try {
            let writtenPath = w.path;
            if (w.operation === "delete") {
              deleteReviewedFile(w.path);
            } else if (w.operation === "rename") {
              await renameReviewedFile(
                vscode,
                w.path,
                w.targetPath,
                w.modifiedText,
                baseline,
              );
              writtenPath = w.targetPath;
            } else if (w.operation === "create") {
              createReviewedFile(w.path, w.modifiedText);
            } else if (w.operation === "mode-change") {
              assertLifecycleSource(w.path);
              fs.chmodSync(w.path, normalizeFileMode(w.newMode));
            } else {
              await applyTextToFile(
                vscode,
                vscode.Uri.file(w.path),
                w.modifiedText,
              );
            }
            written.push(writtenPath);
            appliedOperations.push(multiDiffOperationRecord(w));
          } catch (error) {
            failedOperations.push({
              ...multiDiffOperationRecord(w),
              reason: String(error?.message || error).slice(0, 240),
            });
          }
        }
        return {
          written,
          skippedConflicts,
          appliedOperations,
          failedOperations,
        };
      };
      // Shape a decision result: identical to the historical shape unless a
      // guard actually skipped something (then the extra keys ride along).
      const decisionResult = (
        written,
        skippedConflicts,
        appliedOperations,
        failedOperations,
        extra = {},
      ) => {
        const out = {
          outcome: "accepted",
          applied: written.length,
          total: changed.length,
          appliedOperations,
          ...extra,
        };
        if (skippedConflicts.length > 0) {
          out.skippedConflicts = skippedConflicts;
        }
        if (failedOperations.length > 0) {
          out.failedOperations = failedOperations;
        }
        if (
          written.length === 0 &&
          (skippedConflicts.length > 0 || failedOperations.length > 0)
        ) {
          out.outcome = "rejected";
          out.reason =
            failedOperations.length > 0
              ? "changeset apply failed"
              : REASON_DISK_DRIFTED;
        } else if (written.length > 0 && failedOperations.length > 0) {
          out.outcome = "partial";
        }
        return withDegradation(out);
      };
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
      // The multi-diff editor that just opened, captured by reference so closing
      // it can mean "reject" (parity with openDiff). Reference equality avoids
      // parsing the less-standard multi-diff tab input type.
      const multiTab =
        vscode.window.tabGroups?.activeTabGroup?.activeTab || null;
      const summary = changesetSummary(changed);
      const operationCounts = new Map();
      for (const f of changed) {
        operationCounts.set(
          f.operation,
          (operationCounts.get(f.operation) || 0) + 1,
        );
      }
      const operationSummary = [...operationCounts]
        .map(([operation, count]) => `${operation} ${count}`)
        .join(", ");
      const lifecycleFiles = summary.files.filter(
        (file) => file.operation !== "modify",
      );
      const lifecycleSummary =
        lifecycleFiles.length === 0
          ? ""
          : `; lifecycle: ${lifecycleFiles
              .slice(0, 6)
              .map(fileLabel)
              .join("; ")}${
              lifecycleFiles.length > 6
                ? `; +${lifecycleFiles.length - 6} more`
                : ""
            }`;
      // Block on the decision, also resolvable by the Accept/Reject keybindings
      // (same chainlesschainDiffActive handle as openDiff — keyboard Accept maps
      // to "Accept all", keyboard Reject to "Reject") or by closing the tab.
      const CLOSED = Symbol("multi-diff-closed");
      const choice = await new Promise((resolve) => {
        let settled = false;
        let sub = null;
        const settle = (v) => {
          if (settled) return;
          settled = true;
          removeReview(review);
          try {
            sub?.dispose();
          } catch {
            /* best-effort */
          }
          resolve(v);
        };
        const review = {
          settle,
          accept: "Accept all",
          reject: "Reject",
          matchesTab: (tab) => multiTab != null && tab === multiTab,
        };
        activeReviews.push(review);
        setDiffContext(true);
        // Closing the multi-diff tab is a reject — unblock the agent immediately
        // instead of waiting for the notification to also be dismissed.
        if (multiTab && vscode.window.tabGroups?.onDidChangeTabs) {
          sub = vscode.window.tabGroups.onDidChangeTabs((e) => {
            if ((e?.closed || []).includes(multiTab)) settle(CLOSED);
          });
        }
        vscode.window
          .showInformationMessage(
            `Apply ${summary.count} proposed change(s)? (+${summary.totalAdded} -${summary.totalRemoved}; ${operationSummary})${lifecycleSummary}${
              reviewPlan.skipped.length > 0
                ? `; ${reviewPlan.skipped.length} skipped by safety limits`
                : ""
            }`,
            { modal: false },
            "Accept all",
            "Pick files…",
            "Reject",
          )
          .then(settle, () => settle(undefined));
      });

      // Close the multi-diff editor after a button decision (parity with
      // openDiff's closeDiffTab) so a multi-edit session doesn't pile up review
      // tabs. CLOSED means the user already closed it.
      if (choice !== CLOSED && multiTab && vscode.window.tabGroups?.close) {
        try {
          await vscode.window.tabGroups.close(multiTab);
        } catch {
          /* best-effort — never block the decision on tab cleanup */
        }
      }

      if (choice === CLOSED) {
        return withDegradation({ outcome: "rejected", closedDiff: true });
      }
      if (choice === "Accept all") {
        const writes = selectWrites(changed, null);
        const result = await applyWritesGuarded(writes);
        return decisionResult(
          result.written,
          result.skippedConflicts,
          result.appliedOperations,
          result.failedOperations,
        );
      }
      if (choice === "Pick files…") {
        const picks = await vscode.window.showQuickPick(
          summary.files
            .filter((s) => !s.unchanged)
            .map((s) => ({ label: fileLabel(s), picked: true, path: s.path })),
          {
            canPickMany: true,
            ignoreFocusOut: true,
            placeHolder: vscode.l10n.t(
              "Check the files to apply (unchecked = keep as-is); Esc to cancel = apply nothing",
            ),
          },
        );
        if (!picks || picks.length === 0) {
          return withDegradation({ outcome: "rejected" });
        }
        const writes = selectWrites(
          changed,
          picks.map((p) => p.path),
        );
        const result = await applyWritesGuarded(writes);
        return decisionResult(
          result.written,
          result.skippedConflicts,
          result.appliedOperations,
          result.failedOperations,
          { files: result.written },
        );
      }
      return withDegradation({ outcome: "rejected" });
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

    // App Preview state (server-side): whether the dev server runs, its URL,
    // the npm script and the recent server output tail — the agent reads
    // build/runtime errors and the preview URL from here. Page-side state
    // (DOM/console/network/screenshot) needs a real browser connector and is
    // intentionally NOT faked here.
    async getPreviewState() {
      const controller = getPreview();
      if (controller && typeof controller.state === "function") {
        return controller.state();
      }
      return {
        running: false,
        url: null,
        script: null,
        exitCode: null,
        output: "",
      };
    },

    // Semantic navigation capability (gap #7): raw language-server queries
    // via VS Code's built-in `vscode.execute…Provider` commands. This is a
    // thin adapter — all validation / shaping / caps live in the pure
    // semantic-tools.js module, which receives this object injected. Every
    // position here is 0-based (the VS Code convention); semantic-tools owns
    // the 1-based↔0-based conversion for tool callers.
    lsp: {
      async hover({ path, line, character }) {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path),
        );
        return vscode.commands.executeCommand(
          "vscode.executeHoverProvider",
          doc.uri,
          new vscode.Position(line, character),
        );
      },
      async definition({ path, line, character }) {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path),
        );
        return vscode.commands.executeCommand(
          "vscode.executeDefinitionProvider",
          doc.uri,
          new vscode.Position(line, character),
        );
      },
      async references({ path, line, character }) {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path),
        );
        return vscode.commands.executeCommand(
          "vscode.executeReferenceProvider",
          doc.uri,
          new vscode.Position(line, character),
        );
      },
      async prepareCallHierarchy({ path, line, character }) {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path),
        );
        return vscode.commands.executeCommand(
          "vscode.prepareCallHierarchy",
          doc.uri,
          new vscode.Position(line, character),
        );
      },
      // The hierarchy item must be the very instance prepareCallHierarchy
      // returned (VS Code resolves the provider through it), so these take
      // the item, not a path/position.
      async incomingCalls(item) {
        return vscode.commands.executeCommand(
          "vscode.provideIncomingCalls",
          item,
        );
      },
      async outgoingCalls(item) {
        return vscode.commands.executeCommand(
          "vscode.provideOutgoingCalls",
          item,
        );
      },
      async documentSymbols({ path }) {
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(path),
        );
        return vscode.commands.executeCommand(
          "vscode.executeDocumentSymbolProvider",
          doc.uri,
        );
      },
      async workspaceRoots() {
        return (vscode.workspace.workspaceFolders || []).map((f) => ({
          name: f.name,
          path: f.uri.fsPath,
        }));
      },
      async openEditorLanguages() {
        return (vscode.workspace.textDocuments || [])
          .filter((d) => d?.uri?.scheme === "file")
          .map((d) => ({ file: d.uri.fsPath, languageId: d.languageId }));
      },
      async listFiles({ max } = {}) {
        const cap = Number.isFinite(max) && max > 0 ? Math.floor(max) : 5000;
        const uris = await vscode.workspace.findFiles(
          "**/*",
          "**/{node_modules,.git,dist,out,build,.vscode-test}/**",
          cap,
        );
        return (uris || []).map((u) => u.fsPath);
      },
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
        ? vscode.l10n.t(
            "lines {0}-{1}",
            String(anchor.line + 1),
            String(anchor.endLine + 1),
          )
        : vscode.l10n.t("line {0}", String(anchor.line + 1))
      : vscode.l10n.t("whole file");
    const note = await vscode.window.showInputBox({
      prompt: vscode.l10n.t(
        "Review comment #{0} (anchored to {1}; blank to finish the review)",
        String(comments.length + 1),
        where,
      ),
      placeHolder: vscode.l10n.t(
        "Describe how you want the agent to change this edit…",
      ),
      // Reviewers alt-tab to inspect the diff while typing — focus loss must
      // not silently end the review (same lesson as the hunk-pick QuickPick).
      ignoreFocusOut: true,
    });
    if (!note || !note.trim()) break;
    comments.push({ ...anchor, note: note.trim() });
  }
  return comments;
}

function diffReviewPrompt(operation, path, targetPath) {
  if (operation === "delete") return `Delete ${path}?`;
  if (operation === "rename") return `Rename ${path} to ${targetPath}?`;
  if (operation === "create") return `Create ${path}?`;
  return `Apply proposed changes to ${path}?`;
}

function assertLifecycleSource(path) {
  const stat = fs.lstatSync(path);
  if (!stat.isFile()) {
    throw new Error(`Diff lifecycle operations only support files: ${path}`);
  }
}

function deleteReviewedFile(path) {
  assertLifecycleSource(path);
  fs.unlinkSync(path);
}

function createReviewedFile(path, text) {
  const parent = nodePath.dirname(path);
  if (!fs.existsSync(parent) || !fs.lstatSync(parent).isDirectory()) {
    throw new Error(`Create target directory not found: ${parent}`);
  }
  fs.writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
}

async function renameReviewedFile(
  vscode,
  sourcePath,
  targetPath,
  finalText,
  baselineText,
) {
  assertLifecycleSource(sourcePath);
  if (fs.existsSync(targetPath)) {
    throw new Error(`Rename target already exists: ${targetPath}`);
  }
  const targetParent = nodePath.dirname(targetPath);
  if (
    !fs.existsSync(targetParent) ||
    !fs.lstatSync(targetParent).isDirectory()
  ) {
    throw new Error(`Rename target directory not found: ${targetParent}`);
  }
  moveFileNoOverwrite(sourcePath, targetPath);
  if (finalText === baselineText) return;
  try {
    await applyTextToFile(vscode, vscode.Uri.file(targetPath), finalText);
  } catch (error) {
    try {
      if (!fs.existsSync(sourcePath) && fs.existsSync(targetPath)) {
        moveFileNoOverwrite(targetPath, sourcePath);
      }
    } catch {
      /* best-effort rollback; preserve the original apply error */
    }
    throw error;
  }
}

function moveFileNoOverwrite(sourcePath, targetPath) {
  let targetLinked = false;
  try {
    fs.linkSync(sourcePath, targetPath);
    targetLinked = true;
    fs.unlinkSync(sourcePath);
    return;
  } catch (error) {
    if (targetLinked) {
      try {
        fs.unlinkSync(targetPath);
      } catch {
        /* best-effort rollback; preserve the original unlink failure */
      }
      throw error;
    }
    if (!["EXDEV", "EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
      throw error;
    }
  }
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  try {
    fs.unlinkSync(sourcePath);
  } catch (error) {
    try {
      fs.unlinkSync(targetPath);
    } catch {
      /* best-effort rollback; preserve the original unlink failure */
    }
    throw error;
  }
}

function multiDiffOperationRecord(change) {
  return {
    path: change.path,
    operation: change.operation,
    ...(change.targetPath ? { targetPath: change.targetPath } : {}),
    ...(change.oldMode != null ? { oldMode: change.oldMode } : {}),
    ...(change.newMode != null ? { newMode: change.newMode } : {}),
  };
}

/** Best-effort disk read for the hunk baseline (new files → empty). */
function safeReadFile(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** Like safeReadFile but distinguishes "missing/unreadable" (null) from "". */
function safeReadFileOrNull(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Read only a small binary probe while preserving the full on-disk byte size.
 * Capacity rejection therefore happens without materializing a huge file.
 */
function safeReadFileProbe(path) {
  let fd = null;
  try {
    const stat = fs.statSync(path);
    if (!stat.isFile()) return null;
    const length = Math.min(stat.size, 8192, MAX_REVIEW_FILE_BYTES);
    const bytes = Buffer.alloc(length);
    if (length > 0) {
      fd = fs.openSync(path, "r");
      const read = fs.readSync(fd, bytes, 0, length, 0);
      return { bytes: bytes.subarray(0, read), sizeBytes: stat.size };
    }
    return { bytes, sizeBytes: stat.size };
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* best-effort */
      }
    }
  }
}

/**
 * The file's current content for the drift gate — the LIVE editor buffer when
 * the file is open (so unsaved edits count), else the on-disk text. Reading
 * only disk (the old behavior) missed a whole failure class: a file open in
 * another tab with unsaved edits leaves the disk untouched, so the gate saw no
 * drift and the accept blind-wrote the buffer, silently destroying those edits
 * (applyTextToFile replaces the whole document). The JetBrains twin already
 * reads the in-memory Document; this brings VS Code to parity. null = the file
 * is neither open nor readable → nothing to clobber.
 */
function currentTextForDrift(vscode, path) {
  try {
    const docs = (vscode.workspace && vscode.workspace.textDocuments) || [];
    for (const d of docs) {
      const uri = d && d.uri;
      if (uri && uri.scheme === "file" && uri.fsPath === path) {
        return d.getText();
      }
    }
  } catch {
    /* no open-document API / read failed — fall back to disk */
  }
  return safeReadFileOrNull(path);
}

/**
 * Optimistic-concurrency gate for a diff apply: the reviewer decided against
 * `baselineText` (openDiff's originalText), so if the file changed during the
 * review — saved to disk OR edited in an open editor buffer — a blind
 * whole-file write would destroy those concurrent edits. Drift → explicit
 * modal confirm, and dismissing it (Esc) cancels — fail-safe, never
 * auto-overwrite. Returns true when the write may proceed.
 *
 * Byte-identical legacy path: no baseline (older callers diff against the
 * live file) or a missing/unreadable file that isn't open (nothing to
 * clobber) → true, and no prompt is ever shown.
 */
async function confirmDriftOverwrite(vscode, path, baselineText) {
  if (typeof baselineText !== "string") return true;
  const current = currentTextForDrift(vscode, path);
  if (current === null) return true; // new/deleted file — nothing to clobber
  const verdict = checkApplySafety({ baselineText, currentDiskText: current });
  if (verdict.safe) return true;
  const overwrite = vscode.l10n.t("Overwrite");
  let pick;
  try {
    pick = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        "{0} was modified during the review (unsaved editor edits or on disk). Overwrite those changes?",
        path,
      ),
      { modal: true },
      overwrite,
    );
  } catch {
    pick = undefined; // an unshowable prompt must never mean "overwrite"
  }
  return pick === overwrite;
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
    // applyEdit resolves false (no throw) when the edit is rejected — e.g. a
    // read-only document. Saving then would report "accepted" upstream while
    // the disk never changed, so force the fs fallback instead.
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) throw new Error("applyEdit rejected");
    await doc.save();
  } catch {
    fs.writeFileSync(fileUri.fsPath, text, "utf8");
  }
}

module.exports = { createVscodeEditorFacade };
