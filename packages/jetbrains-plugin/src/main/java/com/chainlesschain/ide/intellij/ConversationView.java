package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.ChatEvents;
import com.chainlesschain.ide.ConversationManager;
import com.chainlesschain.ide.IntrospectArgs;
import com.chainlesschain.ide.SessionArgs;
import com.intellij.openapi.project.Project;

import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.Font;
import java.io.File;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * One conversation tab's view + live agent session — the per-tab unit behind the
 * tabbed chat tool window (Claude-Code conversation-tabs parity). Extracted from
 * the former single-session ChatPanel so {@link ChatToolWindowFactory} can hold N
 * of these in a {@code JBTabbedPane}, one per {@link ConversationManager.Conversation}.
 *
 * Protocol logic stays in the pure core (AgentChatSession/ChatEvents/SessionArgs);
 * this is Swing + project glue. The child inherits the window's bridge port/token,
 * and is spawned with the conversation's approval mode + thinking level (§6) so a
 * mode change just restarts the child with the new flag.
 */
final class ConversationView {

    interface SessionIdSink {
        /** Persist a (possibly null) resume id for this conversation. */
        void onSessionId(String convId, String sessionId);
    }

    /** Container hooks a slash command may invoke (e.g. {@code /new} opens a tab). */
    interface ContainerActions {
        void newConversation();
    }

    private final Project project;
    private final ConversationManager.Conversation conv;
    private final SessionIdSink sessionIdSink;
    private ContainerActions containerActions;

    private final JPanel root = new JPanel(new BorderLayout(4, 4));
    private final JTextArea transcript = new JTextArea();
    private final JTextField input = new JTextField();
    private final JButton sendBtn = new JButton("Send");
    private final JButton stopBtn = new JButton("Stop");
    private final JLabel contextLabel = new JLabel(" "); // §6 context-window indicator

    ConversationView(Project project, ConversationManager.Conversation conv,
                     SessionIdSink sessionIdSink) {
        this.project = project;
        this.conv = conv;
        this.sessionIdSink = sessionIdSink;
        if (conv.turnState == null) conv.turnState = new ChatEvents.TurnState();

        transcript.setEditable(false);
        transcript.setLineWrap(true);
        transcript.setWrapStyleWord(true);
        transcript.setFont(new Font(Font.MONOSPACED, Font.PLAIN, transcript.getFont().getSize()));
        root.add(new JScrollPane(transcript), BorderLayout.CENTER);

        JPanel south = new JPanel(new BorderLayout(4, 0));
        south.add(input, BorderLayout.CENTER);
        JPanel buttons = new JPanel();
        buttons.add(sendBtn);
        buttons.add(stopBtn);
        south.add(buttons, BorderLayout.EAST);

        JPanel southWrap = new JPanel(new BorderLayout(0, 2));
        contextLabel.setFont(contextLabel.getFont().deriveFont(
                contextLabel.getFont().getSize2D() - 1f));
        contextLabel.setEnabled(false); // dimmed status line
        southWrap.add(contextLabel, BorderLayout.NORTH);
        southWrap.add(south, BorderLayout.CENTER);
        root.add(southWrap, BorderLayout.SOUTH);

        sendBtn.addActionListener(e -> sendCurrentInput());
        input.addActionListener(e -> sendCurrentInput()); // Enter sends
        stopBtn.addActionListener(e -> {
            AgentChatSession s = liveSession();
            if (s != null) s.interrupt();
        });
    }

    JPanel getComponent() {
        return root;
    }

    void setContainerActions(ContainerActions actions) {
        this.containerActions = actions;
    }

    void focusInput() {
        SwingUtilities.invokeLater(input::requestFocusInWindow);
    }

    private ChatEvents.TurnState turnState() {
        return (ChatEvents.TurnState) conv.turnState;
    }

    private AgentChatSession liveSession() {
        return conv.session instanceof AgentChatSession ? (AgentChatSession) conv.session : null;
    }

    private void sendCurrentInput() {
        final String text = input.getText().trim();
        if (text.isEmpty()) return;
        // §5 panel slash + §6 mode/thinking commands are handled locally, never sent.
        if (text.startsWith("/")) {
            input.setText("");
            handleSlash(text);
            return;
        }
        try {
            ensureSession();
        } catch (IOException ex) {
            append("⚠ failed to start `cc` (is the ChainlessChain CLI installed and on "
                    + "PATH?): " + ex.getMessage() + "\n");
            return;
        }
        AgentChatSession s = liveSession();
        if (s != null && s.send(text)) {
            append("\nyou> " + text + "\n");
            input.setText("");
        } else {
            append("⚠ agent session is not running — press New to restart\n");
        }
    }

    /**
     * Panel slash commands (§5) + approval-mode / extended-thinking toggles (§6).
     * Mode/thinking are spawn-time flags, so changing one stops the live child;
     * the next message respawns with the new flag (resume id preserved).
     */
    private void handleSlash(String raw) {
        String[] parts = raw.trim().split("\\s+", 2);
        String cmd = parts[0].toLowerCase();
        switch (cmd) {
            case "/new":
                if (containerActions != null) containerActions.newConversation();
                else append("ℹ /new unavailable\n");
                return;
            case "/stop": {
                AgentChatSession s = liveSession();
                if (s != null) { s.interrupt(); append("ℹ interrupted\n"); }
                else append("ℹ no running agent\n");
                return;
            }
            case "/auto":
                conv.mode = "acceptEdits";
                restartForModeChange();
                append("ℹ approval mode → auto (accept edits) — next message applies\n");
                return;
            case "/bypass":
                conv.mode = "bypassPermissions";
                restartForModeChange();
                append("ℹ approval mode → bypass (skip all approvals) — next message applies\n");
                return;
            case "/normal":
                conv.mode = "default";
                restartForModeChange();
                append("ℹ approval mode → normal — next message applies\n");
                return;
            case "/think":
                conv.thinking = "on";
                restartForModeChange();
                append("ℹ extended thinking → on (Anthropic) — next message applies\n");
                return;
            case "/ultrathink":
                conv.thinking = "ultra";
                restartForModeChange();
                append("ℹ extended thinking → max — next message applies\n");
                return;
            case "/think-off":
                conv.thinking = "off";
                restartForModeChange();
                append("ℹ extended thinking → off — next message applies\n");
                return;
            case "/context":
                append("ℹ refreshing context…\n");
                refreshContextIndicator();
                return;
            case "/cost":
                runIntrospect("cost");
                return;
            case "/help":
                append("ℹ commands: /new /stop /auto /bypass /normal /think "
                        + "/ultrathink /think-off /context /cost\n");
                return;
            default:
                append("ℹ unknown command " + cmd + " — try /help\n");
        }
    }

    /** Best-effort {@code cc <kind> <id> --json} → append a short line off the EDT. */
    private void runIntrospect(String kind) {
        final String sid = conv.sessionId;
        if (sid == null || sid.isEmpty()) {
            append("ℹ /" + kind + " needs an active session (send a message first)\n");
            return;
        }
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        new Thread(() -> {
            List<String> args = IntrospectArgs.build(kind, sid, null, null, true);
            String out = AgentChatSession.runCapture(args, cwd, 8000);
            final String line = (out == null || out.trim().isEmpty())
                    ? "ℹ /" + kind + " unavailable\n"
                    : "ℹ " + kind + ": " + out.trim().replace('\n', ' ') + "\n";
            SwingUtilities.invokeLater(() -> append(line));
        }, "cc-" + kind + "-" + conv.id).start();
    }

    /** Restart the child so the next message respawns with current mode/thinking (§6). */
    void restartForModeChange() {
        AgentChatSession s = liveSession();
        if (s != null) {
            s.stop();
            conv.session = null;
        }
        conv.turnState = new ChatEvents.TurnState();
    }

    /** Lazy spawn: first message starts the child; mode/thinking changes restart it. */
    private void ensureSession() throws IOException {
        AgentChatSession existing = liveSession();
        if (existing != null && existing.isRunning()) return;

        AgentChatSession.Options o = new AgentChatSession.Options();
        String basePath = project.getBasePath();
        if (basePath != null) o.cwd = new File(basePath);
        // Spawn carries this conversation's resume id + approval mode + thinking level.
        o.extraArgs = SessionArgs.build(null, null, conv.sessionId, conv.mode, conv.thinking);

        IdeBridgeService bridge = IdeBridgeService.getInstance(project);
        if (bridge != null && bridge.getPort() > 0) {
            o.extraEnv.put("CHAINLESSCHAIN_IDE_PORT", String.valueOf(bridge.getPort()));
            if (bridge.getToken() != null) {
                o.extraEnv.put("CHAINLESSCHAIN_IDE_TOKEN", bridge.getToken());
            }
        }
        o.onEvent = event -> {
            if (event != null && "system".equals(event.get("type"))
                    && "init".equals(event.get("subtype"))) {
                Object sid = event.get("session_id");
                if (sid != null && !String.valueOf(sid).isEmpty()) {
                    conv.sessionId = String.valueOf(sid);
                    if (sessionIdSink != null) sessionIdSink.onSessionId(conv.id, conv.sessionId);
                }
                Object resumed = event.get("resumed_messages");
                if (resumed instanceof Number && ((Number) resumed).intValue() > 0) {
                    final String note = "ℹ resumed previous conversation ("
                            + ((Number) resumed).intValue() + " messages)\n";
                    SwingUtilities.invokeLater(() -> append(note));
                }
            }
            final Map<String, Object> ui = ChatEvents.mapAgentEvent(event, turnState());
            if (ui == null) return;
            SwingUtilities.invokeLater(() -> render(ui));
        };
        o.onExit = code -> SwingUtilities.invokeLater(() ->
                append("\n── agent exited (" + code + ") — next message restarts ──\n"));

        AgentChatSession session = new AgentChatSession(o);
        conv.session = session;
        session.start();
    }

    @SuppressWarnings("unchecked")
    private void render(Map<String, Object> ui) {
        String kind = String.valueOf(ui.get("kind"));
        if ("init".equals(kind)) {
            append("── " + ui.get("model") + " · " + ui.get("provider") + " ──\n");
        } else if ("delta".equals(kind)) {
            append(String.valueOf(ui.get("text")));
        } else if ("tool".equals(kind)) {
            String summary = String.valueOf(ui.get("summary"));
            append("\n→ " + ui.get("tool") + (summary.isEmpty() ? "" : " " + summary) + "\n");
        } else if ("tool_done".equals(kind)) {
            append((Boolean.TRUE.equals(ui.get("isError")) ? "✗ " : "✓ ")
                    + ui.get("tool") + "\n");
        } else if ("turn_end".equals(kind)) {
            Object text = ui.get("text");
            if (text != null) append(String.valueOf(text));
            append("\n");
            refreshContextIndicator(); // §6: after each turn
        } else if ("plan".equals(kind)) {
            Object items = ui.get("items");
            int n = items instanceof List ? ((List<Object>) items).size() : 0;
            append("📋 plan " + ui.get("state") + " (" + n + " steps)\n");
        } else if ("info".equals(kind) || "error".equals(kind)
                || "approval".equals(kind) || "approval_done".equals(kind)) {
            Object text = ui.get("text");
            append(("error".equals(kind) ? "⚠ " : "ℹ ")
                    + (text != null ? text : kind) + "\n");
        }
    }

    /**
     * §6 persistent context-window indicator: best-effort {@code cc context <id> --json}
     * after a turn, parsed by the pure {@link IntrospectArgs#parseContextStatus}. Runs off
     * the EDT; never blocks the UI and silently no-ops on any failure.
     */
    private void refreshContextIndicator() {
        final String sid = conv.sessionId;
        if (sid == null || sid.isEmpty()) return;
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        new Thread(() -> {
            try {
                List<String> args = IntrospectArgs.build("context", sid, null, null, true);
                String json = AgentChatSession.runCapture(args, cwd, 8000);
                final IntrospectArgs.ContextStatus st = IntrospectArgs.parseContextStatus(json);
                if (st == null) return;
                SwingUtilities.invokeLater(() -> {
                    contextLabel.setText(" ⊟ context " + human(st.total) + " / "
                            + human(st.window) + " (" + st.pct + "%)");
                    contextLabel.setForeground(st.overflow
                            ? java.awt.Color.RED : java.awt.Color.GRAY);
                });
            } catch (Throwable ignored) {
                // best-effort — context line is non-essential
            }
        }, "cc-context-" + conv.id).start();
    }

    /** Compact token count: 12345 → "12.3k", 1500000 → "1.5M". */
    private static String human(long n) {
        if (n < 1000) return String.valueOf(n);
        if (n < 1_000_000) return String.format("%.1fk", n / 1000.0);
        return String.format("%.1fM", n / 1_000_000.0);
    }

    private void append(String s) {
        transcript.append(s);
        transcript.setCaretPosition(transcript.getDocument().getLength());
    }

    void appendInfo(String s) {
        SwingUtilities.invokeLater(() -> append(s));
    }

    void clearTranscript() {
        transcript.setText("");
    }

    void dispose() {
        AgentChatSession s = liveSession();
        if (s != null) {
            s.stop();
            conv.session = null;
        }
    }
}
