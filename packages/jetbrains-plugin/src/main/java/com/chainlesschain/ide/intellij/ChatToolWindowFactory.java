package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.ChatEvents;
import com.intellij.openapi.Disposable;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.wm.ToolWindow;
import com.intellij.openapi.wm.ToolWindowFactory;
import com.intellij.ui.content.Content;
import com.intellij.ui.content.ContentFactory;

import javax.swing.JButton;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.Font;
import java.awt.event.ActionEvent;
import java.awt.event.ActionListener;
import java.io.File;
import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * "ChainlessChain" tool window — an in-IDE chat with the `cc` agent, the
 * JetBrains twin of the VS Code extension's chat panel (slice 1: plain-text
 * transcript; streaming deltas, tool trace, Stop/New).
 *
 * All protocol logic lives in the pure-JDK core (AgentChatSession/ChatEvents,
 * headless-smoked); this class is Swing + project glue only. The child agent
 * inherits THIS window's bridge port/token, so selection context, diagnostics
 * feedback and native diff review light up automatically.
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

    static final class ChatPanel implements Disposable {
        private final Project project;
        private final JPanel root = new JPanel(new BorderLayout(4, 4));
        private final JTextArea transcript = new JTextArea();
        private final JTextField input = new JTextField();
        private final JButton sendBtn = new JButton("Send");
        private final JButton stopBtn = new JButton("Stop");
        private final JButton newBtn = new JButton("New");
        private final ChatEvents.TurnState turnState = new ChatEvents.TurnState();
        private AgentChatSession session;

        ChatPanel(Project project) {
            this.project = project;
            transcript.setEditable(false);
            transcript.setLineWrap(true);
            transcript.setWrapStyleWord(true);
            transcript.setFont(new Font(Font.MONOSPACED, Font.PLAIN,
                    transcript.getFont().getSize()));
            root.add(new JScrollPane(transcript), BorderLayout.CENTER);

            JPanel south = new JPanel(new BorderLayout(4, 0));
            south.add(input, BorderLayout.CENTER);
            JPanel buttons = new JPanel();
            buttons.add(sendBtn);
            buttons.add(stopBtn);
            buttons.add(newBtn);
            south.add(buttons, BorderLayout.EAST);
            root.add(south, BorderLayout.SOUTH);

            ActionListener doSend = new ActionListener() {
                @Override
                public void actionPerformed(ActionEvent e) {
                    sendCurrentInput();
                }
            };
            sendBtn.addActionListener(doSend);
            input.addActionListener(doSend); // Enter sends
            stopBtn.addActionListener(new ActionListener() {
                @Override
                public void actionPerformed(ActionEvent e) {
                    if (session != null) session.interrupt();
                }
            });
            newBtn.addActionListener(new ActionListener() {
                @Override
                public void actionPerformed(ActionEvent e) {
                    resetSession();
                    transcript.setText("");
                }
            });
        }

        JPanel getComponent() {
            return root;
        }

        private void sendCurrentInput() {
            final String text = input.getText().trim();
            if (text.isEmpty()) return;
            try {
                ensureSession();
            } catch (IOException ex) {
                append("⚠ failed to start `cc` (is the ChainlessChain CLI "
                        + "installed and on PATH?): " + ex.getMessage() + "\n");
                return;
            }
            if (session.send(text)) {
                append("\nyou> " + text + "\n");
                input.setText("");
            } else {
                append("⚠ agent session is not running — press New to restart\n");
            }
        }

        /** Lazy spawn: first message starts the child; New restarts it. */
        private void ensureSession() throws IOException {
            if (session != null && session.isRunning()) return;
            AgentChatSession.Options o = new AgentChatSession.Options();
            String basePath = project.getBasePath();
            if (basePath != null) o.cwd = new File(basePath);
            IdeBridgeService bridge = IdeBridgeService.getInstance(project);
            if (bridge != null && bridge.getPort() > 0) {
                o.extraEnv.put("CHAINLESSCHAIN_IDE_PORT",
                        String.valueOf(bridge.getPort()));
                if (bridge.getToken() != null) {
                    o.extraEnv.put("CHAINLESSCHAIN_IDE_TOKEN", bridge.getToken());
                }
            }
            o.onEvent = new AgentChatSession.EventListener() {
                @Override
                public void onEvent(Map<String, Object> event) {
                    final Map<String, Object> ui =
                            ChatEvents.mapAgentEvent(event, turnState);
                    if (ui == null) return;
                    SwingUtilities.invokeLater(new Runnable() {
                        @Override
                        public void run() {
                            render(ui);
                        }
                    });
                }
            };
            o.onExit = new AgentChatSession.ExitListener() {
                @Override
                public void onExit(final int code) {
                    SwingUtilities.invokeLater(new Runnable() {
                        @Override
                        public void run() {
                            append("\n── agent exited (" + code
                                    + ") — next message restarts ──\n");
                        }
                    });
                }
            };
            session = new AgentChatSession(o);
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
                append("\n→ " + ui.get("tool")
                        + (summary.isEmpty() ? "" : " " + summary) + "\n");
            } else if ("tool_done".equals(kind)) {
                append((Boolean.TRUE.equals(ui.get("isError")) ? "✗ " : "✓ ")
                        + ui.get("tool") + "\n");
            } else if ("turn_end".equals(kind)) {
                Object text = ui.get("text");
                if (text != null) append(String.valueOf(text));
                append("\n");
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

        private void append(String s) {
            transcript.append(s);
            transcript.setCaretPosition(transcript.getDocument().getLength());
        }

        private void resetSession() {
            if (session != null) {
                session.stop();
                session = null;
            }
            turnState.sawDelta = false;
        }

        @Override
        public void dispose() {
            resetSession();
        }
    }
}
