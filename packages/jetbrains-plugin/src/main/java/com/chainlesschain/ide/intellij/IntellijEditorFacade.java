package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.DiffApplyGuard;
import com.chainlesschain.ide.DiffHunks;
import com.chainlesschain.ide.EditorFacade;
import com.chainlesschain.ide.IdeContextV2;
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
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.EnumSet;
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

    @Override
    public Map<String, Object> getContextMetadata(
            String file, String tool) {
        return ApplicationManager.getApplication().runReadAction(
                (com.intellij.openapi.util.Computable<Map<String, Object>>) () -> {
                    VirtualFile vf = null;
                    Document doc = null;
                    if (file != null && !file.isEmpty()) {
                        for (VirtualFile open :
                                FileEditorManager.getInstance(project).getOpenFiles()) {
                            if (samePath(file, open.getPath())) {
                                vf = open;
                                break;
                            }
                        }
                        if (vf == null) {
                            vf = LocalFileSystem.getInstance().findFileByPath(
                                    file.replace('\\', '/'));
                        }
                        if (vf != null) {
                            doc = FileDocumentManager.getInstance().getDocument(vf);
                        }
                    } else if ("getSelection".equals(tool)
                            || "getActiveFile".equals(tool)) {
                        Editor active = FileEditorManager.getInstance(project)
                                .getSelectedTextEditor();
                        if (active != null) {
                            doc = active.getDocument();
                            vf = FileDocumentManager.getInstance().getFile(doc);
                        }
                    }
                    String base = project.getBasePath();
                    List<String> roots = base == null
                            ? java.util.Collections.<String>emptyList()
                            : java.util.Collections.singletonList(base);
                    return IdeContextV2.build(
                            roots,
                            vf == null ? null : vf.getUrl(),
                            doc == null ? null : Long.valueOf(
                                    doc.getModificationStamp()),
                            vf == null || doc == null
                                    ? null
                                    : Boolean.valueOf(
                                            FileDocumentManager.getInstance()
                                                    .isFileModified(vf)),
                            "jetbrains-project-policy",
                            doc == null ? "live-host" : "live-buffer",
                            System.currentTimeMillis());
                });
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
                    d.put("documentUri", vf.getUrl());
                    d.put("documentVersion",
                            Long.valueOf(doc.getModificationStamp()));
                    d.put("isDirty", Boolean.valueOf(
                            FileDocumentManager.getInstance()
                                    .isFileModified(vf)));
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
                e.put("documentUri", vf.getUrl());
                Document doc =
                        FileDocumentManager.getInstance().getDocument(vf);
                e.put("documentVersion", doc == null
                        ? null
                        : Long.valueOf(doc.getModificationStamp()));
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
        return openDiff(path, modifiedText, originalText, title, "modify", null);
    }

    @Override
    public Map<String, Object> openDiff(
            String path,
            String modifiedText,
            String originalText,
            String title,
            String operation,
            String targetPath) {
        final AtomicReference<Map<String, Object>> result = new AtomicReference<>();
        final String diffOperation = List.of("modify", "create", "delete", "rename")
                .contains(operation) ? operation : "modify";
        final boolean lifecycleOperation =
                "delete".equals(diffOperation) || "rename".equals(diffOperation);
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
            FileProbe currentProbe =
                    originalText == null ? readFileProbe(vf) : null;
            DiffApplyGuard.ReviewPayload reviewPayload =
                    DiffApplyGuard.checkReviewPayload(
                            modifiedText,
                            originalText,
                            currentProbe == null ? null : currentProbe.bytes,
                            currentProbe == null
                                    ? null : Long.valueOf(currentProbe.sizeBytes),
                            DiffApplyGuard.MAX_REVIEW_FILE_BYTES);
            if (!reviewPayload.reviewable) {
                Map<String, Object> bin = new LinkedHashMap<>();
                bin.put("outcome", "rejected");
                bin.put("path", path);
                bin.put("operation", diffOperation);
                if (targetPath != null) bin.put("targetPath", targetPath);
                bin.put("reason", reviewPayload.reason);
                bin.put("degradation", reviewPayloadMap(reviewPayload));
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
                    diffReviewPrompt(diffOperation, path, targetPath),
                    "ChainlessChain Review",
                    lifecycleOperation
                            ? new String[] { "Accept", "Request changes…", "Reject" }
                            : new String[] {
                                    "Accept", "Pick hunks…", "Request changes…", "Reject" },
                    0, null);

            // What the reviewer was actually looking at when they decided. When
            // untouched, keep the CLI's byte-exact modifiedText (the diff document
            // normalizes line separators); when edited, their version wins.
            String shownNow = rightDoc.getText();
            String reviewed = shownNow.equals(proposalShown) ? modifiedText : shownNow;

            Map<String, Object> r = new LinkedHashMap<>();
            if (choice == 0) { // Accept — applies the explicit filesystem intent
                // Optimistic-concurrency gate: the review was decided against
                // originalText — if the file moved on disk meanwhile, don't
                // blind-write. No baseline (null) → legacy path, no prompt.
                if (!confirmDriftOverwrite(vf, path, originalText)) {
                    r.put("outcome", "rejected");
                    r.put("path", path);
                    r.put("reason", DiffApplyGuard.REASON_DISK_DRIFTED);
                } else {
                    try {
                        if ("delete".equals(diffOperation)) {
                            deleteReviewedFile(vf);
                        } else if ("rename".equals(diffOperation)) {
                            renameReviewedFile(vf, targetPath, reviewed, left);
                        } else if ("create".equals(diffOperation)) {
                            createReviewedFile(path, reviewed);
                        } else {
                            applyToFile(vf, reviewed);
                        }
                        r.put("outcome", "accepted");
                        r.put("path", path);
                        if (!"delete".equals(diffOperation)) {
                            r.put("finalText", reviewed);
                        }
                    } catch (RuntimeException e) {
                        r.put("outcome", "rejected");
                        r.put("path", path);
                        r.put("reason", "apply failed: " + boundedMessage(e));
                    }
                }
            } else if (!lifecycleOperation && choice == 1) {
                // Pick hunks… — partial accept; unpicked keep original
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
                    r.put("selectedHunks", new ArrayList<Integer>(picked));
                }
            } else if ((!lifecycleOperation && choice == 2)
                    || (lifecycleOperation && choice == 1)) { // Request changes…
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
            r.put("operation", diffOperation);
            if (targetPath != null) r.put("targetPath", targetPath);
            r.put("_auditBaselineText", left);
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
            final Map<String, byte[]> currentBytes = new LinkedHashMap<>();
            final Map<String, Long> currentSizes = new LinkedHashMap<>();
            for (MultiDiff.FileChange f : all) {
                if (f.originalText == null) {
                    FileProbe probe = readFileProbe(
                            LocalFileSystem.getInstance().findFileByPath(f.path));
                    if (probe != null) {
                        currentBytes.put(f.path, probe.bytes);
                        currentSizes.put(f.path, probe.sizeBytes);
                    }
                }
            }
            final MultiDiff.ReviewPlan reviewPlan =
                    MultiDiff.planReview(
                            all,
                            currentBytes,
                            currentSizes,
                            DiffApplyGuard.MAX_REVIEW_FILE_BYTES,
                            MultiDiff.MAX_REVIEW_CHANGESET_FILES,
                            MultiDiff.MAX_REVIEW_CHANGESET_BYTES,
                            supportsPosixModeChanges());
            final List<MultiDiff.FileChange> norm = reviewPlan.reviewable;
            final List<String> skippedBinary = skippedPaths(reviewPlan, "binary");
            final List<String> skippedLarge = skippedPaths(
                    reviewPlan, "large-file", "changeset-limit");
            final List<String> skippedUnsupported =
                    skippedPaths(reviewPlan, "unsupported-operation");
            if (norm.isEmpty()) {
                r.put("outcome", "rejected");
                r.put("written", new ArrayList<String>());
                r.put("count", 0);
                if (!reviewPlan.skipped.isEmpty()) {
                    r.put("reason", reviewPlan.skipped.get(0).reason);
                    addReviewDegradation(
                            r, all.size(), norm.size(), reviewPlan,
                            skippedBinary, skippedLarge, skippedUnsupported);
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
                requests.add(new SimpleDiffRequest(
                        MultiDiff.fileLabel(MultiDiff.fileStat(f)),
                        l,
                        rt,
                        "Current",
                        "Proposed"));
            }
            SimpleDiffRequestChain chain = new SimpleDiffRequestChain(requests);
            DiffManager.getInstance().showDiff(project, chain, DiffDialogHints.DEFAULT);

            MultiDiff.Summary summary = MultiDiff.changesetSummary(norm);
            int choice = Messages.showYesNoCancelDialog(project,
                    "Apply " + summary.count + " file change(s)?  (+" + summary.totalAdded
                            + " / -" + summary.totalRemoved + "; "
                            + multiDiffOperationSummary(norm) + ")"
                            + multiDiffLifecycleSummary(norm)
                            + (reviewPlan.skipped.isEmpty()
                                    ? ""
                                    : "; " + reviewPlan.skipped.size()
                                            + " skipped by safety limits"),
                    title != null ? title : "ChainlessChain Multi-file Review",
                    "Accept all", "Choose files…", "Reject", null);

            List<String> written = new ArrayList<>();
            List<String> skippedConflicts = new ArrayList<>();
            List<Map<String, Object>> failedOperations = new ArrayList<>();
            List<Map<String, Object>> appliedOperations = new ArrayList<>();
            String outcome;
            if (choice == Messages.YES) {
                for (MultiDiff.FileChange f : MultiDiff.selectWrites(norm, null)) {
                    if (!confirmDriftOverwriteByPath(f.path, baselineByPath.get(f.path))) {
                        skippedConflicts.add(f.path);
                        continue;
                    }
                    try {
                        written.add(applyMultiDiffChange(
                                f, baselineByPath.get(f.path)));
                        appliedOperations.add(multiDiffOperationRecord(f));
                    } catch (RuntimeException e) {
                        failedOperations.add(
                                failedMultiDiffOperation(f, e));
                    }
                }
                outcome = written.isEmpty()
                                && (!skippedConflicts.isEmpty()
                                        || !failedOperations.isEmpty())
                        ? "rejected"
                        : !failedOperations.isEmpty()
                                ? "partial"
                                : "accepted";
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
                        try {
                            written.add(applyMultiDiffChange(
                                    f, baselineByPath.get(f.path)));
                            appliedOperations.add(multiDiffOperationRecord(f));
                        } catch (RuntimeException e) {
                            failedOperations.add(
                                    failedMultiDiffOperation(f, e));
                        }
                    }
                    if (written.isEmpty()
                            && (!skippedConflicts.isEmpty()
                                    || !failedOperations.isEmpty())) {
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
            r.put("appliedOperations", appliedOperations);
            if (!skippedConflicts.isEmpty()) {
                r.put("skippedConflicts", skippedConflicts);
                if (written.isEmpty()) r.put("reason", DiffApplyGuard.REASON_DISK_DRIFTED);
            }
            if (!failedOperations.isEmpty()) {
                r.put("failedOperations", failedOperations);
                if (written.isEmpty()) r.put("reason", "changeset apply failed");
            }
            if (reviewPlan.degraded()) {
                addReviewDegradation(
                        r, all.size(), norm.size(), reviewPlan,
                        skippedBinary, skippedLarge, skippedUnsupported);
            }
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
        if (vf == null) {
            throw new IllegalStateException("Review target file not found");
        }
        Document doc = FileDocumentManager.getInstance().getDocument(vf);
        if (doc == null) {
            throw new IllegalStateException(
                    "Review target is not an editable text file: " + vf.getPath());
        }
        WriteCommandAction.runWriteCommandAction(project, () -> {
            doc.setText(text);
            FileDocumentManager.getInstance().saveDocument(doc);
        });
    }

    private static boolean supportsPosixModeChanges() {
        return FileSystems.getDefault()
                .supportedFileAttributeViews()
                .contains("posix");
    }

    private static String multiDiffOperationSummary(
            List<MultiDiff.FileChange> files) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (MultiDiff.FileChange file : files) {
            counts.put(file.operation, counts.getOrDefault(file.operation, 0) + 1);
        }
        List<String> parts = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            parts.add(entry.getKey() + " " + entry.getValue());
        }
        return String.join(", ", parts);
    }

    private static String multiDiffLifecycleSummary(
            List<MultiDiff.FileChange> files) {
        List<String> labels = new ArrayList<>();
        int lifecycleCount = 0;
        for (MultiDiff.FileChange file : files) {
            if ("modify".equals(file.operation)) continue;
            lifecycleCount += 1;
            if (labels.size() < 6) {
                labels.add(MultiDiff.fileLabel(MultiDiff.fileStat(file)));
            }
        }
        if (lifecycleCount == 0) return "";
        String remaining = lifecycleCount > labels.size()
                ? "; +" + (lifecycleCount - labels.size()) + " more"
                : "";
        return "\nLifecycle: " + String.join("; ", labels) + remaining;
    }

    private static Map<String, Object> multiDiffOperationRecord(
            MultiDiff.FileChange file) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("path", file.path);
        record.put("operation", file.operation);
        if (file.targetPath != null) record.put("targetPath", file.targetPath);
        if (file.oldMode != null) record.put("oldMode", file.oldMode);
        if (file.newMode != null) record.put("newMode", file.newMode);
        return record;
    }

    private static Map<String, Object> failedMultiDiffOperation(
            MultiDiff.FileChange file, Throwable error) {
        Map<String, Object> record = multiDiffOperationRecord(file);
        record.put("reason", boundedMessage(error));
        return record;
    }

    private String applyMultiDiffChange(
            MultiDiff.FileChange file, String baselineText) {
        VirtualFile vf = LocalFileSystem.getInstance().findFileByPath(file.path);
        if (vf == null) {
            vf = LocalFileSystem.getInstance().refreshAndFindFileByPath(file.path);
        }
        switch (file.operation) {
            case "delete":
                deleteReviewedFile(vf);
                return file.path;
            case "rename":
                renameReviewedFile(
                        vf, file.targetPath, file.modifiedText, baselineText);
                return file.targetPath;
            case "create":
                createReviewedFile(file.path, file.modifiedText);
                return file.path;
            case "mode-change":
                applyModeChange(file.path, file.newMode);
                return file.path;
            case "modify":
                applyToFile(vf, file.modifiedText);
                return file.path;
            default:
                throw new IllegalStateException(
                        "Unsupported changeset operation: " + file.operation);
        }
    }

    private void createReviewedFile(String path, String text) {
        Path target = Path.of(path);
        Path parent = target.getParent();
        if (parent == null || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalStateException(
                    "Create target directory not found: " + parent);
        }
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalStateException("Create target already exists: " + path);
        }
        WriteCommandAction.runWriteCommandAction(project, () -> {
            try {
                Files.writeString(
                        target,
                        text,
                        StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE_NEW,
                        StandardOpenOption.WRITE);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });
        LocalFileSystem.getInstance().refreshAndFindFileByPath(path);
    }

    private static void applyModeChange(String path, Object newMode) {
        Integer mode = MultiDiff.normalizeFileMode(newMode);
        if (mode == null) {
            throw new IllegalStateException("Invalid POSIX file mode: " + newMode);
        }
        if (!supportsPosixModeChanges()) {
            throw new IllegalStateException(MultiDiff.REASON_MODE_CHANGE_UNSUPPORTED);
        }
        Path target = Path.of(path);
        if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalStateException(
                    "Mode change only supports an existing regular file: " + path);
        }
        try {
            Files.setPosixFilePermissions(target, posixPermissions(mode));
        } catch (IOException | UnsupportedOperationException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Set<PosixFilePermission> posixPermissions(int mode) {
        Set<PosixFilePermission> permissions =
                EnumSet.noneOf(PosixFilePermission.class);
        if ((mode & 0400) != 0) permissions.add(PosixFilePermission.OWNER_READ);
        if ((mode & 0200) != 0) permissions.add(PosixFilePermission.OWNER_WRITE);
        if ((mode & 0100) != 0) permissions.add(PosixFilePermission.OWNER_EXECUTE);
        if ((mode & 0040) != 0) permissions.add(PosixFilePermission.GROUP_READ);
        if ((mode & 0020) != 0) permissions.add(PosixFilePermission.GROUP_WRITE);
        if ((mode & 0010) != 0) permissions.add(PosixFilePermission.GROUP_EXECUTE);
        if ((mode & 0004) != 0) permissions.add(PosixFilePermission.OTHERS_READ);
        if ((mode & 0002) != 0) permissions.add(PosixFilePermission.OTHERS_WRITE);
        if ((mode & 0001) != 0) permissions.add(PosixFilePermission.OTHERS_EXECUTE);
        return permissions;
    }

    private static String diffReviewPrompt(
            String operation, String path, String targetPath) {
        if ("delete".equals(operation)) return "Review deletion of " + path + ":";
        if ("rename".equals(operation)) {
            return "Review rename of " + path + " to " + targetPath + ":";
        }
        if ("create".equals(operation)) return "Review creation of " + path + ":";
        return "Review proposed changes to " + path + ":";
    }

    private static String boundedMessage(Throwable error) {
        String message = error == null || error.getMessage() == null
                ? String.valueOf(error) : error.getMessage();
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    private static Map<String, Object> reviewPayloadMap(
            DiffApplyGuard.ReviewPayload payload) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("reviewable", payload.reviewable);
        if (payload.kind != null) out.put("kind", payload.kind);
        if (payload.reason != null) out.put("reason", payload.reason);
        out.put("bytes", payload.bytes);
        out.put("limitBytes", payload.limitBytes);
        return out;
    }

    private static List<String> skippedPaths(
            MultiDiff.ReviewPlan plan, String... kinds) {
        Set<String> acceptedKinds = new LinkedHashSet<>(List.of(kinds));
        List<String> paths = new ArrayList<>();
        for (MultiDiff.ReviewSkip skip : plan.skipped) {
            if (acceptedKinds.contains(skip.kind)) paths.add(skip.path);
        }
        return paths;
    }

    private static void addReviewDegradation(
            Map<String, Object> result,
            int requested,
            int reviewable,
            MultiDiff.ReviewPlan plan,
            List<String> skippedBinary,
            List<String> skippedLarge,
            List<String> skippedUnsupported) {
        List<Map<String, Object>> skipped = new ArrayList<>();
        for (MultiDiff.ReviewSkip item : plan.skipped) {
            Map<String, Object> entry = new LinkedHashMap<>();
            entry.put("path", item.path);
            entry.put("kind", item.kind);
            entry.put("reason", item.reason);
            entry.put("operation", item.operation);
            entry.put("bytes", item.bytes);
            entry.put("limitBytes", item.limitBytes);
            skipped.add(entry);
        }
        Map<String, Object> limits = new LinkedHashMap<>();
        limits.put("maxFileBytes", plan.maxFileBytes);
        limits.put("maxFiles", plan.maxFiles);
        limits.put("maxTotalBytes", plan.maxTotalBytes);
        Map<String, Object> degradation = new LinkedHashMap<>();
        degradation.put("requested", requested);
        degradation.put("reviewable", reviewable);
        degradation.put("skipped", skipped);
        degradation.put("limits", limits);
        result.put("degraded", true);
        result.put("degradation", degradation);
        if (!skippedBinary.isEmpty()) result.put("skippedBinary", skippedBinary);
        if (!skippedLarge.isEmpty()) result.put("skippedLarge", skippedLarge);
        if (!skippedUnsupported.isEmpty()) {
            result.put("skippedUnsupported", skippedUnsupported);
        }
    }

    private void deleteReviewedFile(VirtualFile vf) {
        if (vf == null
                || !Files.isRegularFile(
                        Path.of(vf.getPath()), LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalStateException("Diff deletion only supports an existing file");
        }
        WriteCommandAction.runWriteCommandAction(project, () -> {
            try {
                vf.delete(this);
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });
    }

    private void renameReviewedFile(
            VirtualFile vf, String targetPath, String reviewedText, String baselineText) {
        if (vf == null
                || !Files.isRegularFile(
                        Path.of(vf.getPath()), LinkOption.NOFOLLOW_LINKS)) {
            throw new IllegalStateException("Diff rename only supports an existing file");
        }
        if (targetPath == null || targetPath.isEmpty()) {
            throw new IllegalStateException("Rename target missing");
        }
        LocalFileSystem lfs = LocalFileSystem.getInstance();
        if (lfs.findFileByPath(targetPath) != null
                || lfs.refreshAndFindFileByPath(targetPath) != null) {
            throw new IllegalStateException("Rename target already exists: " + targetPath);
        }
        java.io.File targetFile = new java.io.File(targetPath);
        java.io.File parentFile = targetFile.getParentFile();
        VirtualFile targetParent = parentFile == null
                ? null : lfs.refreshAndFindFileByPath(parentFile.getPath());
        if (targetParent == null || !targetParent.isDirectory()) {
            throw new IllegalStateException(
                    "Rename target directory not found: " + parentFile);
        }
        VirtualFile originalParent = vf.getParent();
        String originalName = vf.getName();
        WriteCommandAction.runWriteCommandAction(project, () -> {
            try {
                if (!samePath(vf.getParent().getPath(), targetParent.getPath())) {
                    vf.move(this, targetParent);
                }
                if (!vf.getName().equals(targetFile.getName())) {
                    vf.rename(this, targetFile.getName());
                }
            } catch (IOException e) {
                try {
                    if (!vf.getName().equals(originalName)) vf.rename(this, originalName);
                    if (originalParent != null
                            && !samePath(vf.getParent().getPath(), originalParent.getPath())) {
                        vf.move(this, originalParent);
                    }
                } catch (IOException ignored) {
                    // Best-effort rollback; preserve the original failure.
                }
                throw new IllegalStateException(e);
            }
        });
        if (!java.util.Objects.equals(reviewedText, baselineText)) {
            try {
                applyToFile(vf, reviewedText);
            } catch (RuntimeException e) {
                rollbackReviewedRename(vf, originalParent, originalName);
                throw e;
            }
        }
    }

    private void rollbackReviewedRename(
            VirtualFile vf, VirtualFile originalParent, String originalName) {
        try {
            WriteCommandAction.runWriteCommandAction(project, () -> {
                try {
                    if (!vf.getName().equals(originalName)) {
                        vf.rename(this, originalName);
                    }
                    if (originalParent != null
                            && !samePath(vf.getParent().getPath(), originalParent.getPath())) {
                        vf.move(this, originalParent);
                    }
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            });
        } catch (RuntimeException ignored) {
            // Best-effort rollback; preserve the original apply failure.
        }
    }

    /**
     * Optimistic-concurrency gate for a diff apply (twin of VS Code's
     * confirmDriftOverwrite). The reviewer decided against {@code baselineText}
     * (openDiff's originalText); if the file changed during the review — saved
     * to disk OR edited in an open editor buffer — a blind whole-file write
     * would destroy those concurrent edits. {@link #readDocumentText} reads the
     * in-memory Document, so unsaved buffer edits count too (VS Code's twin now
     * reads its live buffer for the same parity). Drift → an explicit Yes/No
     * confirm defaulting to No — dismissing (Esc) cancels, never
     * auto-overwrites. Returns whether the write may proceed.
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

    private static final class FileProbe {
        final byte[] bytes;
        final long sizeBytes;

        FileProbe(byte[] bytes, long sizeBytes) {
            this.bytes = bytes;
            this.sizeBytes = sizeBytes;
        }
    }

    /**
     * Read at most 8 KiB for the binary sniff while retaining the full VFS
     * length. A huge file is therefore rejected without materializing it.
     */
    private FileProbe readFileProbe(VirtualFile vf) {
        if (vf == null) return null;
        try {
            return ApplicationManager.getApplication().runReadAction(
                    (com.intellij.openapi.util.Computable<FileProbe>) () -> {
                        long size = Math.max(0L, vf.getLength());
                        int probeLength = (int) Math.min(size, 8192L);
                        try (InputStream input = vf.getInputStream()) {
                            return new FileProbe(input.readNBytes(probeLength), size);
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
