package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Pure conversation/tab model for the JetBrains chat tool window (Claude-Code
 * conversation-tabs parity) — a direct port of the VS Code extension's
 * conversation-manager.js. Holds N named conversations, each owning its own
 * agent session handle, resume id, per-turn reducer state, and title; tracks
 * which one is active. No IntelliJ SDK — the live AgentChatSession is held
 * opaquely as Object — so it compiles + tests with plain {@code javac}.
 *
 * The IntelliJ glue (a future tool-window with a real tab strip) drives this:
 * spawn a child per tab, route events to the owning tab, render the bar from
 * {@link #list()}.
 */
public final class ConversationManager {

    /** One conversation/tab. The session handle + turn state are opaque. */
    public static final class Conversation {
        public final String id;
        public String title;
        public String sessionId;   // resume id (nullable)
        public Object session;     // opaque AgentChatSession handle (nullable)
        public Object turnState;
        public String mode = "default"; // approval mode (default|acceptEdits|bypassPermissions)
        public String thinking = "off"; // extended thinking (off|on|ultra)

        Conversation(String id, String title, String sessionId, Object turnState) {
            this.id = id;
            this.title = title;
            this.sessionId = sessionId;
            this.turnState = turnState;
        }
    }

    /** Tab row for the UI, mirroring list() in the JS model. */
    public static final class TabInfo {
        public final String id;
        public final String title;
        public final String sessionId;
        public final boolean active;
        public final boolean hasSession;

        TabInfo(String id, String title, String sessionId, boolean active, boolean hasSession) {
            this.id = id;
            this.title = title;
            this.sessionId = sessionId;
            this.active = active;
            this.hasSession = hasSession;
        }
    }

    /** Result of close(): whether it removed anything, the removed record, the new active. */
    public static final class CloseResult {
        public final boolean closed;
        public final Conversation conv;    // removed record (nullable)
        public final Conversation active;  // new active record (nullable)

        CloseResult(boolean closed, Conversation conv, Conversation active) {
            this.closed = closed;
            this.conv = conv;
            this.active = active;
        }
    }

    private final Supplier<Object> createTurnState;
    private final Map<String, Conversation> conversations = new HashMap<String, Conversation>();
    private final List<String> order = new ArrayList<String>(); // tab order, left→right
    private String activeId = null;
    private int seq = 0; // monotonic — stable ids/titles even after closes

    public ConversationManager() {
        this(null);
    }

    /** @param createTurnState factory for a conversation's per-turn reducer state (nullable). */
    public ConversationManager(Supplier<Object> createTurnState) {
        this.createTurnState = createTurnState != null ? createTurnState : new Supplier<Object>() {
            public Object get() { return new HashMap<String, Object>(); }
        };
    }

    private String nextId() {
        seq += 1;
        return "conv-" + seq;
    }

    /** Create a conversation; becomes active when {@code activate} or none is active yet. */
    public Conversation create(String title, String sessionId, boolean activate) {
        String id = nextId();
        String t = (title != null && !title.trim().isEmpty()) ? title : ("Chat " + seq);
        Conversation conv = new Conversation(id, t, emptyToNull(sessionId), createTurnState.get());
        conversations.put(id, conv);
        order.add(id);
        if (activate || activeId == null) activeId = id;
        return conv;
    }

    /** Convenience: a fresh active conversation with default title and no resume id. */
    public Conversation create() {
        return create(null, null, true);
    }

    public Conversation get(String id) {
        return conversations.get(id);
    }

    public boolean has(String id) {
        return conversations.containsKey(id);
    }

    public String activeId() {
        return activeId;
    }

    public Conversation active() {
        return activeId != null ? conversations.get(activeId) : null;
    }

    public int count() {
        return order.size();
    }

    /** Tabs in left→right order, flagging the active one. */
    public List<TabInfo> list() {
        List<TabInfo> out = new ArrayList<TabInfo>();
        for (String id : order) {
            Conversation c = conversations.get(id);
            out.add(new TabInfo(c.id, c.title, c.sessionId, c.id.equals(activeId), c.session != null));
        }
        return out;
    }

    /** Activate a tab; returns its record, or null if the id is unknown. */
    public Conversation switchTo(String id) {
        if (!conversations.containsKey(id)) return null;
        activeId = id;
        return conversations.get(id);
    }

    /**
     * Remove a conversation. If it was active, activate the right neighbor (or
     * left if it was last; null if none remain) — the natural tab-close UX.
     */
    public CloseResult close(String id) {
        if (!conversations.containsKey(id)) {
            return new CloseResult(false, null, active());
        }
        int idx = order.indexOf(id);
        Conversation conv = conversations.remove(id);
        order.remove(idx);
        if (id.equals(activeId)) {
            if (idx < order.size()) {
                activeId = order.get(idx);          // former right neighbor
            } else if (idx - 1 >= 0) {
                activeId = order.get(idx - 1);      // was last → left neighbor
            } else {
                activeId = null;                    // none remain
            }
        }
        return new CloseResult(true, conv, active());
    }

    public Conversation setSessionId(String id, String sessionId) {
        Conversation c = get(id);
        if (c != null) c.sessionId = emptyToNull(sessionId);
        return c;
    }

    public Conversation setSession(String id, Object handle) {
        Conversation c = get(id);
        if (c != null) c.session = handle;
        return c;
    }

    /** Set a conversation's approval mode (takes effect on its next child spawn). */
    public Conversation setMode(String id, String mode) {
        Conversation c = get(id);
        if (c != null) c.mode = (mode == null || mode.trim().isEmpty()) ? "default" : mode;
        return c;
    }

    /** Set a conversation's extended-thinking level (next child spawn). */
    public Conversation setThinking(String id, String thinking) {
        Conversation c = get(id);
        if (c != null) c.thinking = (thinking == null || thinking.trim().isEmpty()) ? "off" : thinking;
        return c;
    }

    public Conversation setTitle(String id, String title) {
        Conversation c = get(id);
        if (c != null && title != null && !title.trim().isEmpty()) c.title = title;
        return c;
    }

    /** Fresh per-turn reducer state for a conversation (after reset/resume). */
    public Conversation resetTurnState(String id) {
        Conversation c = get(id);
        if (c != null) c.turnState = createTurnState.get();
        return c;
    }

    /** Every live session handle (for dispose — caller stops each). */
    public List<Object> allSessions() {
        List<Object> out = new ArrayList<Object>();
        for (String id : order) {
            Object s = conversations.get(id).session;
            if (s != null) out.add(s);
        }
        return out;
    }

    private static String emptyToNull(String s) {
        return (s == null || s.isEmpty()) ? null : s;
    }
}
