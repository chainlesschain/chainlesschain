package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.Mentions;
import com.chainlesschain.ide.SlashCommands;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.roots.ProjectFileIndex;
import com.intellij.openapi.ui.popup.JBPopup;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.psi.PsiClass;
import com.intellij.psi.PsiFile;
import com.intellij.psi.PsiMethod;
import com.intellij.psi.search.GlobalSearchScope;
import com.intellij.psi.search.PsiShortNamesCache;

import javax.swing.JTextArea;
import java.util.List;

/**
 * The composer's completion popups: `/` slash commands and `@`-mentions
 * (IDE pseudo-mentions + PSI symbols + folders + project files). Split out of
 * ConversationView (opportunistic split) — owns the lazy, bounded file/symbol
 * caches; the pure token/splice logic stays in {@link Mentions} /
 * {@link SlashCommands}.
 */
final class ChatMentionPopups {

    private final Project project;
    private final JTextArea input;
    private List<String> cachedFiles;                 // §5 @-mention file index (lazy, bounded)
    private List<Mentions.MentionItem> cachedSymbols; // §5 @-mention PSI symbols (lazy, bounded)

    ChatMentionPopups(Project project, JTextArea input) {
        this.project = project;
        this.input = input;
    }

    // ---- slash-command completion popup --------------------------------

    /** Open the chooser only when the whole input so far is a leading slash token. */
    void maybeOpenSlash() {
        String text = input.getText();
        int caret = Math.min(input.getCaretPosition(), text.length());
        String prefix = SlashCommands.detectSlashToken(text.substring(0, caret));
        if (prefix != null) openSlashPopup(prefix);
    }

    private void openSlashPopup(String prefix) {
        final List<String[]> candidates = SlashCommands.filter(prefix);
        if (candidates.isEmpty()) return;
        JBPopup popup = JBPopupFactory.getInstance()
                .createPopupChooserBuilder(candidates)
                .setTitle("Slash commands")
                .setRenderer(new javax.swing.DefaultListCellRenderer() {
                    @Override
                    public java.awt.Component getListCellRendererComponent(
                            javax.swing.JList<?> list, Object value, int index,
                            boolean selected, boolean hasFocus) {
                        java.awt.Component c = super.getListCellRendererComponent(
                                list, value, index, selected, hasFocus);
                        if (value instanceof String[]) {
                            setText(SlashCommands.label((String[]) value));
                        }
                        return c;
                    }
                })
                .setItemChosenCallback(item -> {
                    // Replace the input with the chosen command (ready to Enter).
                    input.setText(((String[]) item)[0] + " ");
                    input.requestFocusInWindow();
                })
                .createPopup();
        popup.showUnderneathOf(input);
    }

    // ---- §5 @-mention completion popup ---------------------------------

    /** Open the chooser only when the caret sits on a real {@code @}-token. */
    void maybeOpenMention() {
        String text = input.getText();
        int caret = Math.min(input.getCaretPosition(), text.length());
        if (Mentions.detectAtToken(text.substring(0, caret)) != null) openMentionPopup();
    }

    private void openMentionPopup() {
        // Candidates carry a display label + the value spliced on choose. Files
        // and PSI symbols both resolve to a file path (cc expands it); a symbol
        // entry just adds a name-based way to find that file (e.g. type a class
        // name). IDE pseudo-mentions splice @selection / @diagnostics.
        List<Mentions.MentionItem> candidates = new java.util.ArrayList<>();
        candidates.add(Mentions.MentionItem.symbol("selection", "selection"));
        candidates.add(Mentions.MentionItem.symbol("diagnostics", "diagnostics"));
        candidates.addAll(symbolCandidates());
        // Offer ancestor folders (as @folder/) ahead of the files — typing
        // "@src" surfaces the directory too; cc expands it into a bounded tree.
        List<String> files = projectRelativeFiles();
        for (String d : Mentions.deriveFolders(files, 2000)) candidates.add(Mentions.MentionItem.path(d));
        for (String f : files) candidates.add(Mentions.MentionItem.path(f));
        if (candidates.isEmpty()) return;
        JBPopup popup = JBPopupFactory.getInstance()
                .createPopupChooserBuilder(candidates)
                .setTitle("Insert @mention")
                .setRenderer(new javax.swing.DefaultListCellRenderer() {
                    @Override
                    public java.awt.Component getListCellRendererComponent(
                            javax.swing.JList<?> list, Object value, int index,
                            boolean selected, boolean hasFocus) {
                        java.awt.Component c = super.getListCellRendererComponent(
                                list, value, index, selected, hasFocus);
                        if (value instanceof Mentions.MentionItem) {
                            setText(Mentions.mentionLabel((Mentions.MentionItem) value));
                        }
                        return c;
                    }
                })
                .setItemChosenCallback(item -> insertMention(Mentions.mentionValue(item)))
                .createPopup();
        popup.showUnderneathOf(input);
    }

    /**
     * Project class symbols for @-mention (lazy, bounded). Each resolves to its
     * file via {@link PsiShortNamesCache}; {@link Mentions#formatSymbolItems}
     * builds "class Foo · src/foo.kt" labels with the file relpath as the value.
     * JVM-language-centric best-effort; non-JVM projects just get files +
     * IDE-mentions (the cache returns no class names there).
     */
    private List<Mentions.MentionItem> symbolCandidates() {
        if (cachedSymbols != null) return cachedSymbols;
        final List<Mentions.Symbol> syms = new java.util.ArrayList<>();
        try {
            ApplicationManager.getApplication().runReadAction((Runnable) () -> {
                PsiShortNamesCache cache = PsiShortNamesCache.getInstance(project);
                GlobalSearchScope scope = GlobalSearchScope.projectScope(project);
                // Classes (kind 4).
                String[] classNames = cache.getAllClassNames();
                int classCap = Math.min(classNames.length, 800); // bound for big projects
                for (int i = 0; i < classCap; i++) {
                    for (PsiClass c : cache.getClassesByName(classNames[i], scope)) {
                        VirtualFile vf = vfileOf(c.getContainingFile());
                        if (vf != null) {
                            syms.add(new Mentions.Symbol(classNames[i], 4, vf.getPath()));
                            break; // first declaration is enough
                        }
                    }
                }
                // Methods / functions (kind 5).
                String[] methodNames = cache.getAllMethodNames();
                int methodCap = Math.min(methodNames.length, 800);
                for (int i = 0; i < methodCap; i++) {
                    for (PsiMethod m : cache.getMethodsByName(methodNames[i], scope)) {
                        VirtualFile vf = vfileOf(m.getContainingFile());
                        if (vf != null) {
                            syms.add(new Mentions.Symbol(methodNames[i], 5, vf.getPath()));
                            break;
                        }
                    }
                }
            });
        } catch (Throwable ignored) {
            // no PSI symbol cache (non-JVM / indexing) → files + IDE-mentions still work
        }
        cachedSymbols = Mentions.formatSymbolItems(syms, project.getBasePath(), 1600);
        return cachedSymbols;
    }

    private static VirtualFile vfileOf(PsiFile f) {
        return f == null ? null : f.getVirtualFile();
    }

    /** Splice the chosen value into the input, replacing the current {@code @}-token. */
    private void insertMention(String value) {
        String text = input.getText();
        int caret = Math.min(input.getCaretPosition(), text.length());
        Mentions.AtToken at = Mentions.detectAtToken(text.substring(0, caret));
        if (at != null) {
            Mentions.ApplyResult r = Mentions.applyMention(text, at, value, caret);
            input.setText(r.text);
            input.setCaretPosition(Math.min(r.caret, r.text.length()));
        } else {
            String ins = "@" + value + " ";
            input.setText(text.substring(0, caret) + ins + text.substring(caret));
            input.setCaretPosition(caret + ins.length());
        }
        input.requestFocusInWindow();
    }

    /** Project-relative content file paths (lazy, capped) for @-file ranking. */
    private List<String> projectRelativeFiles() {
        if (cachedFiles != null) return cachedFiles;
        final List<String> out = new java.util.ArrayList<>();
        final String base = project.getBasePath();
        final String b = base == null ? null
                : (base.replace('\\', '/').endsWith("/") ? base.replace('\\', '/')
                        : base.replace('\\', '/') + "/");
        try {
            ApplicationManager.getApplication().runReadAction((Runnable) () -> {
                ProjectFileIndex.getInstance(project).iterateContent(vf -> {
                    if (vf.isDirectory()) return true;
                    String p = vf.getPath().replace('\\', '/');
                    if (b != null && p.startsWith(b)) p = p.substring(b.length());
                    out.add(p);
                    return out.size() < 3000; // bound the index for big projects
                });
            });
        } catch (Throwable ignored) {
            // partial / empty index → @-completion still offers the pseudo-mentions
        }
        cachedFiles = out;
        return out;
    }
}
