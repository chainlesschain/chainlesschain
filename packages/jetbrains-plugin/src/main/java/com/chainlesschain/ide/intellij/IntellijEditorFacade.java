package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.DiffHunks;
import com.chainlesschain.ide.EditorFacade;
import com.chainlesschain.ide.MultiDiff;
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
            DocumentContent leftContent = factory.create(left == null ? "" : left);
            DocumentContent rightContent = factory.create(modifiedText);
            SimpleDiffRequest request = new SimpleDiffRequest(
                    title != null ? title : "Review: " + path,
                    leftContent, rightContent, "Current", "Proposed");
            DiffManager.getInstance().showDiff(project, request);

            // §3+§7: four-way review — Accept / Pick hunks… / Request changes… /
            // Reject. The "changes-requested" / hunk-accept shapes match VS Code
            // so the CLI's requestIdeDiffApproval handles them unchanged.
            int choice = Messages.showDialog(project,
                    "Review proposed changes to " + path + ":",
                    "ChainlessChain Review",
                    new String[] { "Accept", "Pick hunks…", "Request changes…", "Reject" },
                    0, null);

            Map<String, Object> r = new LinkedHashMap<>();
            if (choice == 0) { // Accept
                applyToFile(vf, modifiedText);
                r.put("outcome", "accepted");
                r.put("path", path);
                r.put("finalText", modifiedText);
            } else if (choice == 1) { // Pick hunks… — partial accept; unpicked keep original
                String baseline = left == null ? "" : left;
                List<DiffHunks.Hunk> hunks = DiffHunks.computeHunks(baseline, modifiedText);
                Set<Integer> picked = hunks.isEmpty() ? new LinkedHashSet<>() : pickHunks(hunks);
                if (picked.isEmpty()) {
                    // Esc / nothing picked → fail-safe: nothing is written.
                    r.put("outcome", "rejected");
                    r.put("path", path);
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
                List<Map<String, Object>> comments = collectReviewComments();
                if (comments.isEmpty()) {
                    // No notes entered → treat as a plain rejection.
                    r.put("outcome", "rejected");
                    r.put("path", path);
                } else {
                    r.put("outcome", "changes-requested");
                    r.put("path", path);
                    r.put("comments", comments);
                    r.put("reviewedText", modifiedText);
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
     * §3: collect one or more free-text review notes (EDT). Each becomes a
     * {@code {note}} comment in the VS-Code "changes-requested" shape; line
     * anchors are left null (the diff viewer is show-only here), which the CLI
     * tolerates. Blank input ends the loop.
     */
    private List<Map<String, Object>> collectReviewComments() {
        List<Map<String, Object>> comments = new ArrayList<>();
        for (int i = 0; i < 20; i++) { // hard cap — avoid an accidental infinite loop
            String prompt = comments.isEmpty()
                    ? "Describe the change you want (blank to cancel):"
                    : "Another note? (blank to finish, " + comments.size() + " so far):";
            String note = Messages.showInputDialog(
                    project, prompt, "Request Changes", null);
            if (note == null || note.trim().isEmpty()) break;
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("note", note.trim());
            comments.add(c);
        }
        return comments;
    }

    @Override
    public Map<String, Object> openMultiDiff(List<MultiDiff.FileChange> files, String title) {
        final List<MultiDiff.FileChange> norm = MultiDiff.normalizeMultiDiffFiles(files);
        final AtomicReference<Map<String, Object>> result = new AtomicReference<>();
        ApplicationManager.getApplication().invokeAndWait(() -> {
            Map<String, Object> r = new LinkedHashMap<>();
            if (norm.isEmpty()) {
                r.put("outcome", "rejected");
                r.put("written", new ArrayList<String>());
                r.put("count", 0);
                result.set(r);
                return;
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
            String outcome;
            if (choice == Messages.YES) {
                for (MultiDiff.FileChange f : norm) {
                    applyToPath(f.path, f.modifiedText);
                    written.add(f.path);
                }
                outcome = "accepted";
            } else if (choice == Messages.NO) {
                Set<String> picked = pickFiles(summary);
                if (picked.isEmpty()) {
                    outcome = "rejected";
                } else {
                    for (MultiDiff.FileChange f : MultiDiff.selectWrites(norm, picked)) {
                        applyToPath(f.path, f.modifiedText);
                        written.add(f.path);
                    }
                    outcome = written.size() == norm.size() ? "accepted" : "partial";
                }
            } else {
                outcome = "rejected";
            }
            r.put("outcome", outcome);
            r.put("written", written);
            r.put("count", written.size());
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
                setTitle("勾选要应用的改动块（未勾选的保留原文）");
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
