package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.DiffApplyGuard;
import com.chainlesschain.ide.DiffHunks;
import com.chainlesschain.ide.EditorFacade;
import com.chainlesschain.ide.MultiDiff;
import com.chainlesschain.ide.ReviewNote;
import com.intellij.diff.DiffContentFactory;
import com.intellij.diff.DiffDialogHints;
import com.intellij.diff.DiffManager;
import com.intellij.diff.chains.SimpleDiffRequestChain;
import com.intellij.diff.contents.DocumentContent;
import com.intellij.diff.requests.DiffRequest;
import com.intellij.diff.requests.SimpleDiffRequest;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.command.WriteCommandAction;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.editor.Editor;
import com.intellij.openapi.editor.SelectionModel;
import com.intellij.openapi.editor.markup.RangeHighlighter;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.editor.impl.DocumentMarkupModel;
import com.intellij.codeInsight.daemon.impl.HighlightInfo;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.LocalFileSystem;

import javax.swing.BoxLayout;
import javax.swing.JCheckBox;
import javax.swing.JComponent;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

/**
 * IntelliJ implementation of {@link EditorFacade}. SDK-bound: requires the
 * IntelliJ Platform to compile/run (not available on the CI/dev box that built
 * the rest of this plugin — the protocol layer is verified separately via the
 * cross-language interop probe). All editor reads/writes are marshalled onto
 * the correct threads (read action / EDT + write command).
 */
public final class IntellijEditorFacade implements EditorFacade {

    private final Project project;

    public IntellijEditorFacade(Project project) {
        this.project = project;
    }

    /** VirtualFile.getPath() is always forward-slashed; the agent sends OS-native
     *  paths (backslashes, arbitrary drive-letter case on Windows). A raw
     *  String.equals therefore never matches on Windows and getDiagnostics would
     *  silently return an empty list for a targeted file. */
    private static boolean samePath(String a, String b) {
        if (a == null || b == null) return false;
        String na = a.replace('\\', '/');
        String nb = b.replace('\\', '/');
        return java.io.File.separatorChar == '\\' ? na.equalsIgnoreCase(nb) : na.equals(nb);
    }

    @Override
    public Map<String, Object> getSelection() {
        return ApplicationManager.getApplication().runReadAction((com.intellij.openapi.util.Computable<Map<String, Object>>) () -> {
            Editor editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
            if (editor == null) return null;
            Document doc = editor.getDocument();
            VirtualFile vf = FileDocumentManager.getInstance().getFile(doc);
            SelectionModel sel = editor.getSelectionModel();
            int start = sel.getSelectionStart();
            int end = sel.getSelectionEnd();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("file", vf == null ? null : vf.getPath());
            out.put("languageId", vf == null ? null : vf.getFileType().getName());
            out.put("selection", range(doc, start, end));
            out.put("text", sel.getSelectedText() == null ? "" : sel.getSelectedText());
            return out;
        });
    }

    @Override
    public Map<String, Object> getActiveFile() {
        return ApplicationManager.getApplication().runReadAction((com.intellij.openapi.util.Computable<Map<String, Object>>) () -> {
            Editor editor = FileEditorManager.getInstance(project).getSelectedTextEditor();
            if (editor == null) return null;
            Document doc = editor.getDocument();
            VirtualFile vf = FileDocumentManager.getInstance().getFile(doc);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("file", vf == null ? null : vf.getPath());
            out.put("languageId", vf == null ? null : vf.getFileType().getName());
            out.put("isDirty", vf != null && FileDocumentManager.getInstance().isFileModified(vf));
            out.put("cursor", pos(doc, editor.getCaretModel().getOffset()));
            return out;
        });
    }

    /** Terminal-plugin classes may be absent (bundled plugin disabled) — the
     *  tool is still advertised and just reports no terminals then, matching
     *  the VS Code twin's "empty without shell integration" contract. */
    @Override
    public boolean supportsTerminalOutput() {
        return true;
    }

    @Override
    public Map<String, Object> getTerminalOutput(int limit) {
        final int n = Math.max(1, limit);
        List<Map<String, Object>> terminals = new ArrayList<>();
        try {
            // Widget enumeration walks tool-window UI state — marshal to EDT
            // like every other editor read (the MCP server calls off-thread).
            final AtomicReference<List<Map<String, Object>>> ref = new AtomicReference<>();
            ApplicationManager.getApplication().invokeAndWait(() -> {
                try {
                    ref.set(TerminalTextReader.read(project, n));
                } catch (Throwable t) {
                    ref.set(null); // terminal plugin absent / API drift
                }
            });
            if (ref.get() != null) terminals = ref.get();
        } catch (Throwable ignored) {
            // best-effort: no terminal context is a valid answer
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("terminals", terminals);
        return out;
    }

    @Override
    public boolean supportsPreviewState() {
        return true;
    }

    @Override
    public Map<String, Object> getPreviewState() {
        try {
            PreviewService preview = PreviewService.getInstance(project);
            if (preview != null) return preview.stateMap();
        } catch (Throwable ignored) {
            // service unavailable (project closing) — fall through to default
        }
        return EditorFacade.super.getPreviewState();
    }

    @Override
    public List<Map<String, Object>> getDiagnostics(String path) {
        return ApplicationManager.getApplication().runReadAction((com.intellij.openapi.util.Computable<List<Map<String, Object>>>) () -> {
            List<Map<String, Object>> out = new ArrayList<>();
            FileEditorManager fem = FileEditorManager.getInstance(project);
            for (VirtualFile vf : fem.getOpenFiles()) {
                if (path != null && !samePath(path, vf.getPath())) continue;
                Document doc = FileDocumentManager.getInstance().getDocument(vf);
                if (doc == null) continue;
                for (RangeHighlighter h : DocumentMarkupModel.forDocument(doc, project, true).getAllHighlighters()) {
                    Object tt = h.getErrorStripeTooltip();
                    if (!(tt instanceof HighlightInfo)) continue;
                    HighlightInfo info = (HighlightInfo) tt;
                    if (info.getDescription() == null) continue;
                    int line = doc.getLineNumber(info.getStartOffset());
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("file", vf.getPath());
                    d.put("severity", String.valueOf(info.getSeverity()).toLowerCase());
                    d.put("message", info.getDescription());
                    d.put("line", (long) line);
                    d.put("character", (long) (info.getStartOffset() - doc.getLineStartOffset(line)));
                    out.add(d);
                }
            }
            return out;
        });
    }

    @Override
    public List<Map<String, Object>> getOpenEditors() {
        return ApplicationManager.getApplication().runReadAction((com.intellij.openapi.util.Computable<List<Map<String, Object>>>) () -> {
            List<Map<String, Object>> out = new ArrayList<>();
            FileEditorManager fem = FileEditorManager.getInstance(project);
            Editor active = fem.getSelectedTextEditor();
            VirtualFile activeFile = active == null ? null
                    : FileDocumentManager.getInstance().getFile(active.getDocument());
            for (VirtualFile vf : fem.getOpenFiles()) {
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("file", vf.getPath());
                e.put("active", vf.equals(activeFile));
                e.put("languageId", vf.getFileType().getName());
                // Unsaved-buffer flag so the agent knows the on-disk copy is
                // stale before reading the file (VS Code parity / Claude-Code
                // IDE checkDocumentDirty).
                e.put("isDirty", FileDocumentManager.getInstance().isFileModified(vf));
                out.add(e);
            }
            return out;
        });
    }

    @Override
    public Map<String, Object> openDiff(String path, String modifiedText, String originalText, String title) {
        final AtomicReference<Map<String, Object>> result = new AtomicReference<>();
        // Show the diff + the accept/reject prompt on the EDT and block until done.
        ApplicationManager.getApplication().invokeAndWait(() -> {
            DiffContentFactory factory = DiffContentFactory.getInstance();
            VirtualFile vf = LocalFileSystem.getInstance().findFileByPath(path);
            String left = originalText;
            if (left == null && vf != null) {
                left = readDocumentText(vf);
            }
            // Binary guard (twin of VS Code's diff-apply-guard): the review
            // pipeline is UTF-8 text — rewriting a binary file through it
            // corrupts the bytes. Short-circuit before any UI opens; nothing
            // is written. (A binary file has no Document, so also sniff the
            // raw bytes when the caller sent no baseline.)
            if (DiffApplyGuard.looksBinary(modifiedText)
                    || DiffApplyGuard.looksBinary(originalText)
                    || (originalText == null && DiffApplyGuard.looksBinary(readBytesSafe(vf)))) {
                Map<String, Object> bin = new LinkedHashMap<>();
                bin.put("outcome", "rejected");
                bin.put("path", path);
                bin.put("reason", DiffApplyGuard.REASON_BINARY_SKIPPED);
                result.set(bin);
                return;
            }
            DocumentContent leftContent = factory.create(left == null ? "" : left);
            // Editable right pane (VS Code parity): the reviewer can amend the
            // proposal in place before deciding — plain create() yields a
            // read-only document, so the tweak-then-accept flow needs this.
            DocumentContent rightContent = factory.createEditable(project, modifiedText, null);
            SimpleDiffRequest request = new SimpleDiffRequest(
                    title != null ? title : "Review: " + path,
                    leftContent, rightContent, "Current", "Proposed");
            DiffManager.getInstance().showDiff(project, request);

            // §3+§7: four-way review — Accept / Pick hunks… / Request changes… /
            // Reject. The "changes-requested" / hunk-accept shapes match VS Code
            // so the CLI's requestIdeDiffApproval handles them unchanged.
            Document rightDoc = rightContent.getDocument();
            String proposalShown = rightDoc.getText(); // post-normalization baseline
            int choice = Messages.showDialog(project,
                    "Review proposed changes to " + path + ":",
                    "ChainlessChain Review",
                    new String[] { "Accept", "Pick hunks…", "Request changes…", "Reject" },
                    0, null);

            // What the reviewer was actually looking at when they decided. When
            // untouched, keep the CLI's byte-exact modifiedText (the diff document
            // normalizes line separators); when edited, their version wins.
            String shownNow = rightDoc.getText();
            String reviewed = shownNow.equals(proposalShown) ? modifiedText : shownNow;

            Map<String, Object> r = new LinkedHashMap<>();
            if (choice == 0) { // Accept — writes the (possibly user-edited) right pane
                // Optimistic-concurrency gate: the review was decided against
                // originalText — if the file moved on disk meanwhile, don't
                // blind-write. No baseline (null) → legacy path, no prompt.
                if (!confirmDriftOverwrite(vf, path, originalText)) {
                    r.put("outcome", "rejected");
                    r.put("path", path);
                    r.put("reason", DiffApplyGuard.REASON_DISK_DRIFTED);
                } else {
                    applyToFile(vf, reviewed);
                    r.put("outcome", "accepted");
                    r.put("path", path);
                    r.put("finalText", reviewed);
                }
            } else if (choice == 1) { // Pick hunks… — partial accept; unpicked keep original
                String baseline = left == null ? "" : left;
                List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks(baseline, reviewed);
                Set<Integer> picked = hunks.isEmpty() ? new LinkedHashSet<>() : pickHunks(hunks);
                if (picked.isEmpty()) {
                    // Esc / nothing picked → fail-safe: nothing is written.
                    r.put("outcome", "rejected");
                    r.put("path", path);
                } else if (!confirmDriftOverwrite(vf, path, originalText)) {
                    // Same drift gate as Accept: the hunks were computed against
                    // the agent's baseline, so a moved disk would be clobbered.
                    r.put("outcome", "rejected");
                    r.put("path", path);
                    r.put("reason", DiffApplyGuard.REASON_DISK_DRIFTED);
                } else {
                    String finalText = DiffHunks.applyHunks(baseline, hunks, picked);
                    applyToFile(vf, finalText);
                    r.put("outcome", "accepted");
                    r.put("path", path);
                    r.put("finalText", finalText);
                    r.put("appliedHunks", picked.size());
                    r.put("totalHunks", hunks.size());
                }
            } else if (choice == 2) { // Request changes…
                List<Map<String, Object>> comments = collectReviewComments(reviewed);
                if (comments.isEmpty()) {
                    // No notes entered → treat as a plain rejection.
                    r.put("outcome", "rejected");
                    r.put("path", path);
                } else {
                    r.put("outcome", "changes-requested");
                    r.put("path", path);
                    r.put("comments", comments);
                    r.put("reviewedText", reviewed);
                }
            } else { // Reject or Esc
                r.put("outcome", "rejected");
                r.put("path", path);
            }
            result.set(r);
        });
        return result.get();
    }

    /**
     * §3: collect one or more review notes (EDT), each in the VS-Code
     * "changes-requested" comment shape. An optional {@code "12:"} /
     * {@code "12-15:"} prefix anchors the note to those (1-based) lines of the
     * reviewed right-pane text — {@link ReviewNote#parse} resolves it to the
     * 0-based {@code {line, endLine, lineText, note}} shape the CLI's
     * formatReviewComments renders, same as VS Code's selection anchors.
     * Blank input ends the loop.
     */
    private List<Map<String, Object>> collectReviewComments(String reviewedText) {
        List<Map<String, Object>> comments = new ArrayList<>();
        for (int i = 0; i < 20; i++) { // hard cap — avoid an accidental infinite loop
            String prompt = comments.isEmpty()
                    ? CcBundle.message("diff.requestChanges.prompt.first")
                    : CcBundle.message("diff.requestChanges.prompt.more", comments.size());
            String note = Messages.showInputDialog(
                    project, prompt, CcBundle.message("diff.requestChanges.title"), null);
            Map<String, Object> c = ReviewNote.parse(note, reviewedText);
            if (c == null) break;
            comments.add(c);
        }
        return comments;
    }

    @Override
    public Map<String, Object> openMultiDiff(List<MultiDiff.FileChange> files, String title) {
        final List<MultiDiff.FileChange> all = MultiDiff.normalizeMultiDiffFiles(files);
        final AtomicReference<Map<String, Object>> result = new AtomicReference<>();
        ApplicationManager.getApplication().invokeAndWait(() -> {
            Map<String, Object> r = new LinkedHashMap<>();
            // Binary guard (twin of VS Code): a binary file must never
            // round-trip the UTF-8 text pipeline — drop it from the reviewable
            // set up front, tracking which paths were skipped.
            final List<String> skippedBinary = new ArrayList<>();
            final List<MultiDiff.FileChange> norm = new ArrayList<>();
            for (MultiDiff.FileChange f : all) {
                boolean binary = DiffApplyGuard.looksBinary(f.modifiedText)
                        || DiffApplyGuard.looksBinary(f.originalText)
                        || (f.originalText == null
                                && DiffApplyGuard.looksBinary(
                                        readBytesSafe(LocalFileSystem.getInstance().findFileByPath(f.path))));
                if (binary) skippedBinary.add(f.path);
                else norm.add(f);
            }
            if (norm.isEmpty()) {
                r.put("outcome", "rejected");
                r.put("written", new ArrayList<String>());
                r.put("count", 0);
                if (!skippedBinary.isEmpty()) {
                    r.put("reason", DiffApplyGuard.REASON_BINARY_SKIPPED);
                    r.put("skippedBinary", skippedBinary);
                }
                result.set(r);
                return;
            }
            // Baseline per path for the accept-time drift gate (null baseline
            // → gate stays inert for that file, legacy byte-identical path).
            final Map<String, String> baselineByPath = new LinkedHashMap<>();
            for (MultiDiff.FileChange f : norm) {
                baselineByPath.put(f.path, f.originalText);
            }
            DiffContentFactory factory = DiffContentFactory.getInstance();
            List<DiffRequest> requests = new ArrayList<>();
            for (MultiDiff.FileChange f : norm) {
                String left = f.originalText;
                if (left == null) {
                    VirtualFile vf = LocalFileSystem.getInstance().findFileByPath(f.path);
                    left = readDocumentText(vf);
                }
                DocumentContent l = factory.create(left == null ? "" : left);
                DocumentContent rt = factory.create(f.modifiedText == null ? "" : f.modifiedText);
                requests.add(new SimpleDiffRequest(f.path, l, rt, "Current", "Proposed"));
            }
            SimpleDiffRequestChain chain = new SimpleDiffRequestChain(requests);
            DiffManager.getInstance().showDiff(project, chain, DiffDialogHints.DEFAULT);

            MultiDiff.Summary summary = MultiDiff.changesetSummary(norm);
            int choice = Messages.showYesNoCancelDialog(project,
                    "Apply " + summary.count + " file change(s)?  (+" + summary.totalAdded
                            + " / -" + summary.totalRemoved + ")",
                    title != null ? title : "ChainlessChain Multi-file Review",
                    "Accept all", "Choose files…", "Reject", null);

            List<String> written = new ArrayList<>();
            List<String> skippedConflicts = new ArrayList<>();
            String outcome;
            if (choice == Messages.YES) {
                for (MultiDiff.FileChange f : MultiDiff.selectWrites(norm, null)) {
                    if (!confirmDriftOverwriteByPath(f.path, baselineByPath.get(f.path))) {
                        skippedConflicts.add(f.path);
                        continue;
                    }
                    applyToPath(f.path, f.modifiedText);
                    written.add(f.path);
                }
                outcome = written.isEmpty() && !skippedConflicts.isEmpty() ? "rejected" : "accepted";
            } else if (choice == Messages.NO) {
                Set<String> picked = pickFiles(summary);
                if (picked.isEmpty()) {
                    outcome = "rejected";
                } else {
                    List<MultiDiff.FileChange> writes = MultiDiff.selectWrites(norm, picked);
                    for (MultiDiff.FileChange f : writes) {
                        if (!confirmDriftOverwriteByPath(f.path, baselineByPath.get(f.path))) {
                            skippedConflicts.add(f.path);
                            continue;
                        }
                        applyToPath(f.path, f.modifiedText);
                        written.add(f.path);
                    }
                    if (written.isEmpty() && !skippedConflicts.isEmpty()) {
                        outcome = "rejected";
                    } else {
                        outcome = written.size() == norm.size() ? "accepted" : "partial";
                    }
                }
            } else {
                outcome = "rejected";
            }
            r.put("outcome", outcome);
            r.put("written", written);
            r.put("count", written.size());
            if (!skippedConflicts.isEmpty()) {
                r.put("skippedConflicts", skippedConflicts);
                if (written.isEmpty()) r.put("reason", DiffApplyGuard.REASON_DISK_DRIFTED);
            }
            if (!skippedBinary.isEmpty()) r.put("skippedBinary", skippedBinary);
            result.set(r);
        });
        return result.get();
    }

    /**
     * §7: hunk checkbox picker (all pre-checked) → chosen hunk indices, or empty
     * if cancelled. Unpicked hunks keep the original lines (fail-safe: cancel
     * writes nothing).
     */
    private Set<Integer> pickHunks(List<DiffHunks.Hunk> hunks) {
        final Map<JCheckBox, Integer> boxes = new LinkedHashMap<>();
        final JPanel panel = new JPanel();
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        for (DiffHunks.Hunk h : hunks) {
            String label = "Hunk " + (h.index + 1) + "/" + hunks.size() + " · " + h.header
                    + (h.preview.isEmpty() ? "" : "  —  " + h.preview);
            JCheckBox cb = new JCheckBox(label, true);
            boxes.put(cb, h.index);
            panel.add(cb);
        }
        DialogWrapper dlg = new DialogWrapper(project, true) {
            {
                setTitle(CcBundle.message("diff.pickHunks.title"));
                init();
            }
            @Override
            protected JComponent createCenterPanel() {
                return new JScrollPane(panel);
            }
        };
        Set<Integer> picked = new LinkedHashSet<>();
        if (dlg.showAndGet()) {
            for (Map.Entry<JCheckBox, Integer> e : boxes.entrySet()) {
                if (e.getKey().isSelected()) picked.add(e.getValue());
            }
        }
        return picked;
    }

    /** §4: checkbox picker (all pre-checked) → chosen paths, or empty if cancelled. */
    private Set<String> pickFiles(MultiDiff.Summary summary) {
        final Map<JCheckBox, String> boxes = new LinkedHashMap<>();
        final JPanel panel = new JPanel();
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        for (MultiDiff.FileStat st : summary.files) {
            JCheckBox cb = new JCheckBox(MultiDiff.fileLabel(st), true);
            boxes.put(cb, st.path);
            panel.add(cb);
        }
        DialogWrapper dlg = new DialogWrapper(project, true) {
            {
                setTitle("Choose files to apply");
                init();
            }
            @Override
            protected JComponent createCenterPanel() {
                return new JScrollPane(panel);
            }
        };
        Set<String> picked = new LinkedHashSet<>();
        if (dlg.showAndGet()) {
            for (Map.Entry<JCheckBox, String> e : boxes.entrySet()) {
                if (e.getKey().isSelected()) picked.add(e.getValue());
            }
        }
        return picked;
    }

    /** Resolve a path → VirtualFile and write text (refreshes VFS if needed). */
    private void applyToPath(String path, String text) {
        VirtualFile vf = LocalFileSystem.getInstance().findFileByPath(path);
        if (vf == null) vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(path);
        applyToFile(vf, text);
    }

    private void applyToFile(VirtualFile vf, String text) {
        if (vf == null) return;
        Document doc = FileDocumentManager.getInstance().getDocument(vf);
        if (doc == null) return;
        WriteCommandAction.runWriteCommandAction(project, () -> {
            doc.setText(text);
            FileDocumentManager.getInstance().saveDocument(doc);
        });
    }

    /**
     * Optimistic-concurrency gate for a diff apply (twin of VS Code's
     * confirmDriftOverwrite). The reviewer decided against {@code baselineText}
     * (openDiff's originalText); if the file moved on disk during the review a
     * blind whole-file write would destroy those concurrent edits. Drift → an
     * explicit Yes/No confirm defaulting to No — dismissing (Esc) cancels,
     * never auto-overwrites. Returns whether the write may proceed.
     *
     * <p>Byte-identical legacy path: no baseline (null) or an unreadable
     * current document (nothing to clobber) → true with NO prompt.
     */
    private boolean confirmDriftOverwrite(VirtualFile vf, String path, String baselineText) {
        if (baselineText == null) return true;
        String current = readDocumentText(vf);
        // readDocumentText returns "" for a missing file/document; a genuinely
        // empty baseline still compares equal, so "" here is not special-cased.
        if (DiffApplyGuard.safeToApply(baselineText, current)) return true;
        int pick = Messages.showYesNoDialog(project,
                CcBundle.message("diff.driftOverwrite.message", path),
                CcBundle.message("diff.driftOverwrite.title"),
                CcBundle.message("diff.driftOverwrite.overwrite"),
                Messages.getCancelButton(),
                null);
        return pick == Messages.YES;
    }

    /** Resolve a path → VirtualFile, then run the drift gate. */
    private boolean confirmDriftOverwriteByPath(String path, String baselineText) {
        if (baselineText == null) return true;
        VirtualFile vf = LocalFileSystem.getInstance().findFileByPath(path);
        if (vf == null) vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(path);
        return confirmDriftOverwrite(vf, path, baselineText);
    }

    /** Raw bytes for the binary sniff (null when missing/unreadable). */
    private byte[] readBytesSafe(VirtualFile vf) {
        if (vf == null) return null;
        try {
            return ApplicationManager.getApplication().runReadAction(
                    (com.intellij.openapi.util.Computable<byte[]>) () -> {
                        try {
                            return vf.contentsToByteArray();
                        } catch (Throwable t) {
                            return null;
                        }
                    });
        } catch (Throwable t) {
            return null;
        }
    }

    /**
     * Read a file's current document text INSIDE a read action. The diff-review
     * code below runs on the EDT (invokeAndWait), and since 2026.2 the EDT no
     * longer grants implicit read access for document-model reads — an unwrapped
     * {@code Document.getText()} there throws "Read access is allowed from inside
     * read-action only". Returns "" for a missing file/document.
     */
    private String readDocumentText(VirtualFile vf) {
        if (vf == null) return "";
        return ApplicationManager.getApplication().runReadAction(
                (com.intellij.openapi.util.Computable<String>) () -> {
                    Document d = FileDocumentManager.getInstance().getDocument(vf);
                    return d == null ? "" : d.getText();
                });
    }

    private static Map<String, Object> range(Document doc, int start, int end) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("start", pos(doc, start));
        r.put("end", pos(doc, end));
        return r;
    }

    private static Map<String, Object> pos(Document doc, int offset) {
        int line = doc.getLineNumber(offset);
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("line", (long) line);
        p.put("character", (long) (offset - doc.getLineStartOffset(line)));
        return p;
    }
}
