package com.chainlesschain.ide.intellij;

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
import com.intellij.terminal.JBTerminalWidget;
import com.jediterm.terminal.model.TerminalLine;
import com.jediterm.terminal.model.TerminalTextBuffer;
import org.jetbrains.plugins.terminal.TerminalToolWindowManager;

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
                if (path != null && !path.equals(vf.getPath())) continue;
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
                Document d = FileDocumentManager.getInstance().getDocument(vf);
                left = d == null ? "" : d.getText();
            }
            DocumentContent leftContent = factory.create(left == null ? "" : left);
            DocumentContent rightContent = factory.create(modifiedText);
            SimpleDiffRequest request = new SimpleDiffRequest(
                    title != null ? title : "Review: " + path,
                    leftContent, rightContent, "Current", "Proposed");
            DiffManager.getInstance().showDiff(project, request);

            // §3: three-way review — Accept / Request changes… / Reject. The
            // "changes-requested" shape matches VS Code so the CLI's
            // requestIdeDiffApproval handles it unchanged.
            int choice = Messages.showYesNoCancelDialog(
                    project, "Review proposed changes to " + path + ":",
                    "ChainlessChain Review", "Accept", "Request changes…", "Reject", null);

            Map<String, Object> r = new LinkedHashMap<>();
            if (choice == Messages.YES) {
                applyToFile(vf, modifiedText);
                r.put("outcome", "accepted");
                r.put("path", path);
                r.put("finalText", modifiedText);
            } else if (choice == Messages.NO) {
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
            } else {
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
                    if (vf != null) {
                        Document d = FileDocumentManager.getInstance().getDocument(vf);
                        left = d == null ? "" : d.getText();
                    }
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

    /**
     * Best-effort terminal read: the visible screen text of each integrated
     * terminal. JetBrains exposes no shell-integration command structure, so this
     * is raw text (no per-command output/exit-code). Read on the EDT; the jediterm
     * buffer is additionally locked. Any API variance → empty terminals.
     */
    @Override
    public Map<String, Object> getTerminalOutput(int limit) {
        final List<Map<String, Object>> terminals = new ArrayList<>();
        ApplicationManager.getApplication().invokeAndWait(() -> {
            try {
                int idx = 0;
                for (JBTerminalWidget w : TerminalToolWindowManager.getInstance(project).getWidgets()) {
                    String text = readTerminalText(w);
                    if (text != null && !text.isEmpty()) {
                        Map<String, Object> t = new LinkedHashMap<>();
                        t.put("name", "Terminal " + (++idx));
                        t.put("text", text);
                        terminals.add(t);
                    }
                }
            } catch (Throwable ignored) {
                // no terminal tool window / API variance → no terminals
            }
        });
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("terminals", terminals);
        return out;
    }

    private static String readTerminalText(JBTerminalWidget w) {
        try {
            TerminalTextBuffer buf = w.getTerminalTextBuffer();
            if (buf == null) return null;
            StringBuilder sb = new StringBuilder();
            buf.lock();
            try {
                int h = buf.getHeight();
                for (int i = 0; i < h; i++) {
                    TerminalLine line = buf.getLine(i);
                    if (line == null) continue;
                    String t = line.getText();
                    sb.append(t == null ? "" : stripTrailingSpaces(t)).append('\n');
                }
            } finally {
                buf.unlock();
            }
            // Drop leading/trailing blank lines; keep the meaningful middle.
            return trimBlankEdges(sb.toString());
        } catch (Throwable t) {
            return null;
        }
    }

    private static String stripTrailingSpaces(String s) {
        int end = s.length();
        while (end > 0 && (s.charAt(end - 1) == ' ' || s.charAt(end - 1) == '\t')) end--;
        return s.substring(0, end);
    }

    private static String trimBlankEdges(String s) {
        String[] lines = s.split("\n", -1);
        int start = 0, end = lines.length;
        while (start < end && lines[start].isEmpty()) start++;
        while (end > start && lines[end - 1].isEmpty()) end--;
        StringBuilder sb = new StringBuilder();
        for (int i = start; i < end; i++) {
            if (i > start) sb.append('\n');
            sb.append(lines[i]);
        }
        return sb.toString();
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
