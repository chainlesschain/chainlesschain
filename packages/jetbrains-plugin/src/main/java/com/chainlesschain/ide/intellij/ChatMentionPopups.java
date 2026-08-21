package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.Mentions;
import com.chainlesschain.ide.SlashCommands;
import com.chainlesschain.ide.WorkspaceMentionIndex;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.roots.ProjectFileIndex;
import com.intellij.openapi.ui.popup.JBPopup;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.openapi.vfs.VirtualFileManager;
import com.intellij.openapi.vfs.newvfs.BulkFileListener;
import com.intellij.openapi.vfs.newvfs.events.VFileDeleteEvent;
import com.intellij.openapi.vfs.newvfs.events.VFileEvent;
import com.intellij.openapi.vfs.newvfs.events.VFileMoveEvent;
import com.intellij.openapi.vfs.newvfs.events.VFilePropertyChangeEvent;
import com.intellij.psi.PsiClass;
import com.intellij.psi.PsiFile;
import com.intellij.psi.PsiMethod;
import com.intellij.psi.search.GlobalSearchScope;
import com.intellij.psi.search.PsiShortNamesCache;

import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/** Composer slash commands and generation-safe, bounded {@code @}-mentions. */
final class ChatMentionPopups {
    private final Project project;
    private final JTextArea input;
    private final boolean workspaceTrusted;
    private final WorkspaceMentionIndex mentionIndex;
    private final AtomicBoolean fileScanRunning = new AtomicBoolean();
    private final AtomicBoolean symbolScanRunning = new AtomicBoolean();
    private volatile boolean filesWarmed;
    private volatile boolean symbolsWarmed;
    private volatile String latestPrefix = "";
    private volatile WorkspaceMentionIndex.QueryTicket latestTicket;
    private volatile JBPopup activeMentionPopup;
    private volatile List<Mentions.MentionItem> activeMentionItems = List.of();

    ChatMentionPopups(Project project, JTextArea input) {
        this.project = project;
        this.input = input;
        this.workspaceTrusted = isProjectTrusted(project);
        String root = project.getBasePath();
        this.mentionIndex = new WorkspaceMentionIndex(
                root == null ? List.of() : List.of(root), workspaceTrusted);
        if (workspaceTrusted) {
            project.getMessageBus().connect(project).subscribe(
                    VirtualFileManager.VFS_CHANGES,
                    new BulkFileListener() {
                        @Override
                        public void after(List<? extends VFileEvent> events) {
                            applyVfsEvents(events);
                        }
                    });
        }
    }

    private static boolean isProjectTrusted(Project project) {
        if (Boolean.getBoolean("idea.trust.all.projects")) return true;
        try {
            Class<?> type = Class.forName("com.intellij.ide.impl.TrustedProjects");
            for (Method method : type.getMethods()) {
                if (!method.getName().equals("isProjectTrusted")
                        || method.getParameterCount() != 1
                        || !method.getParameterTypes()[0].isAssignableFrom(Project.class)) {
                    continue;
                }
                Object receiver = Modifier.isStatic(method.getModifiers())
                        ? null : type.getField("INSTANCE").get(null);
                return Boolean.TRUE.equals(method.invoke(receiver, project));
            }
        } catch (ReflectiveOperationException | LinkageError ignored) {
            // Trust API is version-specific; fail closed when unavailable.
        }
        return false;
    }

    private void applyVfsEvents(List<? extends VFileEvent> events) {
        boolean rescanFiles = false;
        for (VFileEvent event : events) {
            if (event instanceof VFileDeleteEvent) {
                VirtualFile deleted = event.getFile();
                if (deleted != null && deleted.isDirectory()) rescanFiles = true;
                else mentionIndex.removePath(event.getPath());
                continue;
            }
            if (event instanceof VFileMoveEvent) {
                VFileMoveEvent move = (VFileMoveEvent) event;
                VirtualFile file = move.getFile();
                mentionIndex.removePath(move.getOldParent().getPath() + "/" + file.getName());
            } else if (event instanceof VFilePropertyChangeEvent) {
                VFilePropertyChangeEvent change = (VFilePropertyChangeEvent) event;
                if (VirtualFile.PROP_NAME.equals(change.getPropertyName())) {
                    VirtualFile file = change.getFile();
                    VirtualFile parent = file.getParent();
                    if (parent != null) {
                        mentionIndex.removePath(parent.getPath() + "/" + change.getOldValue());
                    }
                }
            }
            VirtualFile file = event.getFile();
            if (file != null && file.isDirectory()) {
                rescanFiles = true;
            } else if (file != null && file.isValid()) {
                if (!mentionIndex.upsertPath(file.getPath())) {
                    mentionIndex.touchWorkspace();
                }
            }
        }
        if (rescanFiles) {
            filesWarmed = false;
            warmFilesAsync();
        }
        rerunLatestQuery();
    }

    void maybeOpenSlash() {
        String text = input.getText();
        int caret = Math.min(input.getCaretPosition(), text.length());
        String prefix = SlashCommands.detectSlashToken(text.substring(0, caret));
        if (prefix == null) return;
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
                        java.awt.Component component = super.getListCellRendererComponent(
                                list, value, index, selected, hasFocus);
                        if (value instanceof String[]) setText(SlashCommands.label((String[]) value));
                        return component;
                    }
                })
                .setItemChosenCallback(item -> {
                    input.setText(((String[]) item)[0] + " ");
                    input.requestFocusInWindow();
                })
                .createPopup();
        popup.showUnderneathOf(input);
    }

    /** Called after every composer edit; the new generation cancels the old. */
    void onInputChanged() {
        String text = input.getText();
        int caret = Math.min(input.getCaretPosition(), text.length());
        Mentions.AtToken token = Mentions.detectAtToken(text.substring(0, caret));
        if (token == null) {
            mentionIndex.beginQuery();
            latestTicket = null;
            latestPrefix = "";
            JBPopup popup = activeMentionPopup;
            if (popup != null && !popup.isDisposed()) popup.cancel();
            activeMentionItems = List.of();
            return;
        }
        scheduleMentionQuery(token.prefix);
    }

    void maybeOpenMention() {
        onInputChanged();
    }

    /** Keyboard routing for a non-focus-stealing mention popup. */
    boolean handleMentionKey(java.awt.event.KeyEvent event) {
        JBPopup popup = activeMentionPopup;
        if (popup == null || popup.isDisposed() || activeMentionItems.isEmpty()) return false;
        int key = event.getKeyCode();
        if (key == java.awt.event.KeyEvent.VK_ESCAPE) {
            popup.cancel();
            activeMentionItems = List.of();
            event.consume();
            return true;
        }
        javax.swing.JList<?> list = findList(popup.getContent());
        if (key == java.awt.event.KeyEvent.VK_DOWN || key == java.awt.event.KeyEvent.VK_UP) {
            int current = list == null ? 0 : Math.max(0, list.getSelectedIndex());
            int direction = key == java.awt.event.KeyEvent.VK_DOWN ? 1 : -1;
            int next = Math.floorMod(current + direction, activeMentionItems.size());
            if (list != null) {
                list.setSelectedIndex(next);
                list.ensureIndexIsVisible(next);
            }
            event.consume();
            return true;
        }
        if (key == java.awt.event.KeyEvent.VK_TAB || key == java.awt.event.KeyEvent.VK_ENTER) {
            int selected = list == null ? 0 : Math.max(0, list.getSelectedIndex());
            insertMention(Mentions.mentionValue(activeMentionItems.get(
                    Math.min(selected, activeMentionItems.size() - 1))));
            popup.cancel();
            activeMentionItems = List.of();
            event.consume();
            return true;
        }
        return false;
    }

    private static javax.swing.JList<?> findList(java.awt.Component component) {
        if (component instanceof javax.swing.JList<?>) return (javax.swing.JList<?>) component;
        if (component instanceof java.awt.Container) {
            for (java.awt.Component child : ((java.awt.Container) component).getComponents()) {
                javax.swing.JList<?> list = findList(child);
                if (list != null) return list;
            }
        }
        return null;
    }

    private void scheduleMentionQuery(String prefix) {
        JBPopup popup = activeMentionPopup;
        if (popup != null && !popup.isDisposed()) popup.cancel();
        activeMentionItems = List.of();
        latestPrefix = prefix == null ? "" : prefix;
        WorkspaceMentionIndex.QueryTicket ticket = mentionIndex.beginQuery();
        latestTicket = ticket;
        if (workspaceTrusted && !filesWarmed) warmFilesAsync();
        if (workspaceTrusted && !symbolsWarmed) warmSymbolsAsync();
        queryAsync(ticket, latestPrefix);
    }

    private void queryAsync(WorkspaceMentionIndex.QueryTicket ticket, String prefix) {
        com.intellij.openapi.application.ApplicationManager.getApplication()
                .executeOnPooledThread(() -> {
                    WorkspaceMentionIndex.QueryResult result = mentionIndex.query(ticket, prefix);
                    SwingUtilities.invokeLater(() -> {
                        if (!mentionIndex.commit(ticket, result)) return;
                        if (result.items.isEmpty()) {
                            activeMentionItems = List.of();
                            return;
                        }
                        showMentionPopup(result.items);
                    });
                });
    }

    private void rerunLatestQuery() {
        if (latestTicket == null) return;
        SwingUtilities.invokeLater(() -> scheduleMentionQuery(latestPrefix));
    }

    private void showMentionPopup(List<Mentions.MentionItem> candidates) {
        JBPopup old = activeMentionPopup;
        if (old != null && !old.isDisposed()) old.cancel();
        JBPopup popup = JBPopupFactory.getInstance()
                .createPopupChooserBuilder(candidates)
                .setTitle("Insert @mention")
                // Keep the caret in the composer so each typed character
                // creates a new cancellable index generation.
                .setRequestFocus(false)
                .setRenderer(new javax.swing.DefaultListCellRenderer() {
                    @Override
                    public java.awt.Component getListCellRendererComponent(
                            javax.swing.JList<?> list, Object value, int index,
                            boolean selected, boolean hasFocus) {
                        java.awt.Component component = super.getListCellRendererComponent(
                                list, value, index, selected, hasFocus);
                        if (value instanceof Mentions.MentionItem) {
                            setText(Mentions.mentionLabel((Mentions.MentionItem) value));
                        }
                        return component;
                    }
                })
                .setItemChosenCallback(item -> insertMention(Mentions.mentionValue(item)))
                .createPopup();
        activeMentionPopup = popup;
        activeMentionItems = List.copyOf(candidates);
        popup.showUnderneathOf(input);
    }

    private void warmFilesAsync() {
        if (!fileScanRunning.compareAndSet(false, true)) return;
        com.intellij.openapi.application.ReadAction.nonBlocking(this::scanFiles)
                .inSmartMode(project)
                .submit(com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService())
                .onSuccess(files -> {
                    mentionIndex.replacePaths(files);
                    filesWarmed = true;
                    fileScanRunning.set(false);
                    rerunLatestQuery();
                })
                .onError(error -> fileScanRunning.set(false));
    }

    private void warmSymbolsAsync() {
        if (!symbolScanRunning.compareAndSet(false, true)) return;
        com.intellij.openapi.application.ReadAction.nonBlocking(this::scanSymbols)
                .inSmartMode(project)
                .submit(com.intellij.util.concurrency.AppExecutorUtil.getAppExecutorService())
                .onSuccess(symbols -> {
                    mentionIndex.replaceSymbols(symbols);
                    symbolsWarmed = true;
                    symbolScanRunning.set(false);
                    rerunLatestQuery();
                })
                .onError(error -> symbolScanRunning.set(false));
    }

    /** Metadata-only VFS scan; no document or file content is opened. */
    private List<String> scanFiles() {
        final List<String> paths = new java.util.ArrayList<>();
        ProjectFileIndex.getInstance(project).iterateContent(file -> {
            if (!file.isDirectory()) paths.add(file.getPath());
            return paths.size() < WorkspaceMentionIndex.MAX_PATHS;
        });
        return paths;
    }

    /** Bounded PSI metadata scan performed under a non-blocking read action. */
    private List<Mentions.Symbol> scanSymbols() {
        List<Mentions.Symbol> symbols = new java.util.ArrayList<>();
        PsiShortNamesCache cache = PsiShortNamesCache.getInstance(project);
        GlobalSearchScope scope = GlobalSearchScope.projectScope(project);
        String[] classNames = cache.getAllClassNames();
        for (int index = 0; index < Math.min(classNames.length, 800); index++) {
            for (PsiClass psiClass : cache.getClassesByName(classNames[index], scope)) {
                VirtualFile file = vfileOf(psiClass.getContainingFile());
                if (file != null) {
                    symbols.add(new Mentions.Symbol(classNames[index], 4, file.getPath()));
                    break;
                }
            }
        }
        String[] methodNames = cache.getAllMethodNames();
        for (int index = 0; index < Math.min(methodNames.length, 800); index++) {
            for (PsiMethod method : cache.getMethodsByName(methodNames[index], scope)) {
                VirtualFile file = vfileOf(method.getContainingFile());
                if (file != null) {
                    symbols.add(new Mentions.Symbol(methodNames[index], 5, file.getPath()));
                    break;
                }
            }
        }
        return symbols;
    }

    private static VirtualFile vfileOf(PsiFile file) {
        return file == null ? null : file.getVirtualFile();
    }

    private void insertMention(String value) {
        String text = input.getText();
        int caret = Math.min(input.getCaretPosition(), text.length());
        Mentions.AtToken token = Mentions.detectAtToken(text.substring(0, caret));
        if (token != null) {
            Mentions.ApplyResult result = Mentions.applyMention(text, token, value, caret);
            input.setText(result.text);
            input.setCaretPosition(Math.min(result.caret, result.text.length()));
        } else {
            String insertion = "@" + value + " ";
            input.setText(text.substring(0, caret) + insertion + text.substring(caret));
            input.setCaretPosition(caret + insertion.length());
        }
        input.requestFocusInWindow();
    }
}
