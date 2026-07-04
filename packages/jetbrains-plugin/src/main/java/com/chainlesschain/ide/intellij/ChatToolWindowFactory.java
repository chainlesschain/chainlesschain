package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ChatEvents;
import com.chainlesschain.ide.ConversationManager;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.openapi.wm.ToolWindowManager;
import com.intellij.ui.components.JBTabbedPane;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;

import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.WeakHashMap;

/**
 * "ChainlessChain" tool window — an in-IDE chat with the {@code cc} agent, the
 * JetBrains twin of the VS Code extension's chat panel. Now multi-conversation
 * (Claude-Code conversation-tabs parity): a {@link JBTabbedPane} of
 * {@link ConversationView}s, one live {@code cc agent} child per tab, driven by
 * the pure {@link ConversationManager} model.
 *
 * <ul>
 *   <li>{@code + New chat} → {@link ConversationManager#create()} → new tab.</li>
 *   <li>per-tab {@code ×} → {@link ConversationManager#close(String)} (activates
 *       the neighbor, never empties).</li>
 *   <li>tab switch → {@link ConversationManager#switchTo(String)}; each tab keeps
 *       its own transcript + session, so switching is instant.</li>
 *   <li>per-tab resume ids persist in {@link PropertiesComponent} → tabs survive
 *       IDE restart (migrates the old single-session key).</li>
 * </ul>
 *
 * All protocol logic is in the pure core; this is Swing + project glue only.
 */
public final class ChatToolWindowFactory implements ToolWindowFactory, DumbAware {

    @Override
    public void createToolWindowContent(Project project, ToolWindow toolWindow) {
        ChatPanel panel = new ChatPanel(project);
        Content content = ContentFactory.getInstance()
                .createContent(panel.getComponent(), "", false);
        content.setDisposer(panel);
        toolWindow.getContentManager().addContent(content);
    }

    /** Tool-window id (matches plugin.xml) — for actions to reveal the window. */
    static final String TOOL_WINDOW_ID = "ChainlessChain";

    /** Per-project live panel, so IDE actions (new / reopen) can reach it. */
    private static final Map<Project, ChatPanel> REGISTRY = new WeakHashMap<Project, ChatPanel>();

    /**
     * The active conversation's approval mode — feeds the status-bar widget.
     * "default" when the panel hasn't been opened yet (no elevated mode can be
     * set without it).
     */
    static String activeModeFor(Project project) {
        ChatPanel panel = REGISTRY.get(project);
        ConversationManager.Conversation c = panel != null ? panel.conversations.active() : null;
        return c != null ? c.mode : "default";
    }

    /** Reveal the chat tool window and run {@code body} on its panel (creates it if needed). */
    static void onPanel(Project project, java.util.function.Consumer<ChatPanel> body) {
        ToolWindow tw = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID);
        if (tw == null) return;
        tw.activate(() -> {
            ChatPanel panel = REGISTRY.get(project);
            if (panel != null) body.accept(panel);
        }, true, true);
    }

    static final class ChatPanel implements Disposable {
        /** New per-tab resume-id list (comma-joined); migrates the legacy single key. */
        private static final String SESSION_IDS_KEY = "chainlesschain.chat.sessionIds";
        private static final String LEGACY_SESSION_ID_KEY = "chainlesschain.chat.sessionId";

        private final Project project;
        private String lastClosedSessionId; // §6 reopen-closed
        private String lastClosedTitle;
        private final JPanel root = new JPanel(new BorderLayout(0, 2));
        private final JBTabbedPane tabs = new JBTabbedPane();
        // Factory MUST mint a real ChatEvents.TurnState — ConversationView casts
        // conv.turnState to it; the default (HashMap) would CCE on the first event
        // and silently kill the reply reader thread (message echoes, no answer).
        private final ConversationManager conversations =
                new ConversationManager(ChatEvents.TurnState::new);
        private final Map<String, ConversationView> views = new LinkedHashMap<String, ConversationView>();
        private final List<String> tabIds = new ArrayList<String>(); // mirrors tab index order
        private boolean syncing = false; // guard re-entrant ChangeListener during structural edits

        ChatPanel(Project project) {
            this.project = project;
            REGISTRY.put(project, this);

            JPanel north = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 2));
            JButton addBtn = new JButton("+ New chat");
            addBtn.addActionListener(e -> newConversation());
            north.add(addBtn);
            root.add(north, BorderLayout.NORTH);
            root.add(tabs, BorderLayout.CENTER);

            tabs.addChangeListener(e -> {
                if (syncing) return;
                int i = tabs.getSelectedIndex();
                if (i < 0 || i >= tabIds.size()) return;
                String id = tabIds.get(i);
                conversations.switchTo(id);
                // Tabs can differ in approval mode — repaint the widget.
                BridgeStatusBarWidgetFactory.refresh(project);
                ConversationView v = views.get(id);
                if (v != null) v.focusInput();
            });

            restoreOrCreate();
        }

        JComponent getComponent() {
            return root;
        }

        // ---- conversation lifecycle ----------------------------------------

        void newConversation() {
            ConversationManager.Conversation conv = conversations.create();
            addTabFor(conv, true);
            persistSessionIds();
        }

        /** §5: seed the active conversation's input (Explain/Refactor, @file ref). */
        void seedActiveInput(String text) {
            String id = conversations.activeId();
            if (id == null && !tabIds.isEmpty()) id = tabIds.get(0);
            if (id == null) { newConversation(); id = conversations.activeId(); }
            ConversationView v = id != null ? views.get(id) : null;
            if (v != null) v.seedInput(text);
        }

        /** §6 reopen-closed: re-open the most recently closed conversation, resuming it. */
        void reopenClosed() {
            if (lastClosedSessionId == null && lastClosedTitle == null) {
                newConversation();
                return;
            }
            ConversationManager.Conversation conv =
                    conversations.create(lastClosedTitle, lastClosedSessionId, true);
            addTabFor(conv, true);
            persistSessionIds();
            lastClosedSessionId = null;
            lastClosedTitle = null;
        }

        /** Add a tab + view for an existing model conversation. */
        private void addTabFor(ConversationManager.Conversation conv, boolean select) {
            ConversationView view = new ConversationView(project, conv,
                    (cid, sid) -> persistSessionIds());
            view.setContainerActions(this::newConversation);
            views.put(conv.id, view);
            syncing = true;
            try {
                tabs.addTab(conv.title, view.getComponent());
                tabIds.add(conv.id);
                int idx = tabIds.size() - 1;
                tabs.setTabComponentAt(idx, makeTabHeader(conv.id, conv.title));
                if (select) tabs.setSelectedIndex(idx);
            } finally {
                syncing = false;
            }
            if (select) {
                conversations.switchTo(conv.id);
                BridgeStatusBarWidgetFactory.refresh(project);
                view.focusInput();
            }
        }

        private void closeConversation(String id) {
            int idx = tabIds.indexOf(id);
            if (idx < 0) return;
            ConversationManager.CloseResult r = conversations.close(id);
            if (r.conv != null) { // remember for §6 reopen-closed
                lastClosedSessionId = r.conv.sessionId;
                lastClosedTitle = r.conv.title;
            }
            ConversationView view = views.remove(id);
            if (view != null) view.dispose();
            syncing = true;
            try {
                tabs.removeTabAt(idx);
                tabIds.remove(idx);
            } finally {
                syncing = false;
            }
            // Never leave the window empty — open a fresh conversation.
            if (tabIds.isEmpty()) {
                newConversation();
                return;
            }
            String activeId = r.active != null ? r.active.id : tabIds.get(Math.min(idx, tabIds.size() - 1));
            int sel = tabIds.indexOf(activeId);
            if (sel >= 0) {
                tabs.setSelectedIndex(sel);
                conversations.switchTo(activeId);
            }
            BridgeStatusBarWidgetFactory.refresh(project);
            persistSessionIds();
        }

        /** A tab header: title label + a small × close button. */
        private JComponent makeTabHeader(String id, String title) {
            JPanel header = new JPanel(new FlowLayout(FlowLayout.LEFT, 4, 0));
            header.setOpaque(false);
            JLabel label = new JLabel(title);
            JButton close = new JButton("×");
            close.setBorderPainted(false);
            close.setContentAreaFilled(false);
            close.setFocusable(false);
            close.setMargin(new java.awt.Insets(0, 4, 0, 0));
            close.setToolTipText("Close conversation");
            close.addActionListener(e -> closeConversation(id));
            header.add(label);
            header.add(close);
            return header;
        }

        // ---- persistence ----------------------------------------------------

        private void persistSessionIds() {
            List<String> ids = new ArrayList<String>();
            for (String id : tabIds) {
                ConversationManager.Conversation c = conversations.get(id);
                ids.add(c != null && c.sessionId != null ? c.sessionId : "");
            }
            PropertiesComponent.getInstance(project)
                    .setValue(SESSION_IDS_KEY, String.join(",", ids));
        }

        /** Rebuild tabs from stored resume ids on open; migrate the legacy single key. */
        private void restoreOrCreate() {
            PropertiesComponent props = PropertiesComponent.getInstance(project);
            String stored = props.getValue(SESSION_IDS_KEY);
            if (stored == null) {
                String legacy = props.getValue(LEGACY_SESSION_ID_KEY);
                if (legacy != null && !legacy.trim().isEmpty()) stored = legacy;
            }
            if (stored != null && !stored.trim().isEmpty()) {
                for (String raw : stored.split(",", -1)) {
                    String sid = raw.trim();
                    ConversationManager.Conversation conv =
                            conversations.create(null, sid.isEmpty() ? null : sid, false);
                    addTabFor(conv, false);
                }
            }
            if (tabIds.isEmpty()) {
                newConversation();
            } else {
                tabs.setSelectedIndex(0);
                conversations.switchTo(tabIds.get(0));
            }
        }

        @Override
        public void dispose() {
            REGISTRY.remove(project);
            for (ConversationView v : views.values()) v.dispose();
            views.clear();
            tabIds.clear();
        }
    }
}
