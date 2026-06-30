package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.ChatEvents;
import com.chainlesschain.ide.CliLauncher;
import com.chainlesschain.ide.CliVersionCheck;
import com.chainlesschain.ide.ConversationManager;
import com.chainlesschain.ide.IntrospectArgs;
import com.chainlesschain.ide.LlmConfig;
import com.chainlesschain.ide.MarkdownLite;
import com.chainlesschain.ide.TranscriptCap;
import com.chainlesschain.ide.Mentions;
import com.chainlesschain.ide.SessionArgs;
import com.chainlesschain.ide.SlashCommands;
import com.intellij.ide.util.PropertiesComponent;
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

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextPane;
import javax.swing.text.BadLocationException;
import javax.swing.text.SimpleAttributeSet;
import javax.swing.text.StyleConstants;
import javax.swing.text.StyledDocument;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.io.IOException;
import java.util.LinkedHashMap;
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
    private final JTextPane transcript = new JTextPane();
    // Markdown styling for the transcript: plain (default), inline/fenced code
    // (amber, readable on light + dark themes), and **bold**.
    private final SimpleAttributeSet stylePlain = new SimpleAttributeSet();
    private final SimpleAttributeSet styleCode = new SimpleAttributeSet();
    private final SimpleAttributeSet styleBold = new SimpleAttributeSet();
    private final SimpleAttributeSet styleDim = new SimpleAttributeSet(); // extended-thinking
    // The current streamed assistant text run: appended plain, then re-styled
    // with markdown when it ends (a tool call, the turn end, or any other line).
    private int assistantRunStart = -1;
    private boolean inAssistantRun = false;
    private final JTextArea input = new JTextArea(3, 0); // multi-line composer
    // Pasted screenshots (Ctrl/Cmd+V) → temp PNG paths, attached to the next turn.
    private final java.util.List<String> pendingImages = new java.util.ArrayList<>();
    private final JLabel imageLabel = new JLabel();
    private final JButton sendBtn = new JButton("Send");
    private final JButton stopBtn = new JButton("Stop");
    private final JLabel contextLabel = new JLabel(" "); // §6 context-window indicator
    private final JPanel cardsPanel = new JPanel();       // §5 interactive approval/plan cards
    private final Map<String, JComponent> approvalCards = new LinkedHashMap<>();
    private JComponent planCard;
    private List<String> cachedFiles;                     // §5 @-mention file index (lazy, bounded)
    private List<Mentions.MentionItem> cachedSymbols;     // §5 @-mention PSI symbols (lazy, bounded)

    ConversationView(Project project, ConversationManager.Conversation conv,
                     SessionIdSink sessionIdSink) {
        this.project = project;
        this.conv = conv;
        this.sessionIdSink = sessionIdSink;
        if (conv.turnState == null) conv.turnState = new ChatEvents.TurnState();

        transcript.setEditable(false);
        // JTextPane wraps by default (no setLineWrap). Keep the monospace look.
        transcript.setFont(new Font(Font.MONOSPACED, Font.PLAIN, transcript.getFont().getSize()));
        StyleConstants.setForeground(styleCode, new Color(0xCC, 0x78, 0x32)); // amber code
        StyleConstants.setBold(styleBold, true);
        StyleConstants.setForeground(styleDim, new Color(0x80, 0x80, 0x80)); // gray thinking
        StyleConstants.setItalic(styleDim, true);
        root.add(new JScrollPane(transcript), BorderLayout.CENTER);

        // Multi-line composer: Enter sends, Shift+Enter inserts a newline.
        input.setLineWrap(true);
        input.setWrapStyleWord(true);

        // Input gets its own full-width line; Send/Stop sit on a row below it
        // (the old side-by-side layout left the field too narrow).
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 0));
        JButton llmBtn = new JButton("⚙ LLM");
        llmBtn.setToolTipText("配置 LLM 提供商 / 文本模型 / 图片识别(视觉)模型(写入共享 config.json)");
        llmBtn.addActionListener(ev -> {
            javax.swing.JPopupMenu menu = new javax.swing.JPopupMenu();
            javax.swing.JMenuItem full =
                    new javax.swing.JMenuItem("配置 LLM(提供商 / 模型 / API key)…");
            full.addActionListener(a -> {
                ConfigureLlmAction.runWizard(project);
                reloadLlmConfig();
            });
            javax.swing.JMenuItem vision =
                    new javax.swing.JMenuItem("图片识别(视觉)模型…");
            vision.addActionListener(a -> {
                ConfigureLlmAction.configureVisionModel(project);
                reloadLlmConfig();
            });
            javax.swing.JMenuItem checkUpdate =
                    new javax.swing.JMenuItem("检查 cc 更新…");
            checkUpdate.addActionListener(a -> checkCliUpdateManually());
            menu.add(full);
            menu.add(vision);
            menu.addSeparator();
            menu.add(checkUpdate);
            menu.show(llmBtn, 0, llmBtn.getHeight());
        });
        buttons.add(llmBtn);
        buttons.add(sendBtn);
        buttons.add(stopBtn);
        imageLabel.setEnabled(false);
        imageLabel.setVisible(false);
        JPanel buttonRow = new JPanel(new BorderLayout());
        buttonRow.add(imageLabel, BorderLayout.WEST);   // 📷 attached-image indicator
        buttonRow.add(buttons, BorderLayout.EAST);
        JPanel south = new JPanel(new BorderLayout(0, 2));
        south.add(new JScrollPane(input), BorderLayout.NORTH);
        south.add(buttonRow, BorderLayout.SOUTH);

        contextLabel.setFont(contextLabel.getFont().deriveFont(
                contextLabel.getFont().getSize2D() - 1f));
        contextLabel.setEnabled(false); // dimmed status line
        cardsPanel.setLayout(new BoxLayout(cardsPanel, BoxLayout.Y_AXIS));

        JPanel inputArea = new JPanel(new BorderLayout(0, 2));
        inputArea.add(contextLabel, BorderLayout.NORTH);
        inputArea.add(south, BorderLayout.CENTER);

        JPanel southWrap = new JPanel(new BorderLayout(0, 2));
        southWrap.add(cardsPanel, BorderLayout.NORTH);   // §5 interactive cards above input
        southWrap.add(inputArea, BorderLayout.CENTER);
        root.add(southWrap, BorderLayout.SOUTH);

        sendBtn.addActionListener(e -> sendCurrentInput());
        stopBtn.addActionListener(e -> {
            AgentChatSession s = liveSession();
            if (s != null) s.interrupt();
        });
        // §5 @-mention completion: typing '@' (at start or after space) pops a chooser.
        // Slash-command completion: typing '/' at the line start pops a chooser too.
        input.addKeyListener(new java.awt.event.KeyAdapter() {
            @Override
            public void keyTyped(java.awt.event.KeyEvent e) {
                if (e.getKeyChar() == '@') SwingUtilities.invokeLater(() -> maybeOpenMention());
                else if (e.getKeyChar() == '/') SwingUtilities.invokeLater(() -> maybeOpenSlash());
            }

            @Override
            public void keyPressed(java.awt.event.KeyEvent e) {
                // Enter sends; Shift+Enter falls through to insert a newline
                // (the multi-line composer). IME confirms candidates before this
                // fires, so CJK composition is unaffected.
                if (e.getKeyCode() == java.awt.event.KeyEvent.VK_ENTER && !e.isShiftDown()) {
                    e.consume();
                    sendCurrentInput();
                    return;
                }
                // Ctrl/Cmd+V with an image on the clipboard → attach it (vision);
                // otherwise fall through to normal text paste.
                if (e.getKeyCode() == java.awt.event.KeyEvent.VK_V
                        && (e.isControlDown() || e.isMetaDown())
                        && tryPasteImage()) {
                    e.consume();
                }
            }
        });

        // First-run nudge (VS Code parity): if no LLM provider is configured yet,
        // dim-hint toward the ⚙ LLM button instead of leaving the panel blank
        // until the first turn fails with a 401. Best-effort, probe runs off the EDT.
        maybeShowOnboarding();
        // The plugin and the `cc` CLI ship on independent tracks (Marketplace vs
        // npm), so a working-but-old cc misses newer features silently. Dim-hint
        // when a newer cc is published. Best-effort, off the EDT, once per version.
        maybeShowCliUpdateNudge();
    }

    /** One-time first-run nudge: when `cc config get llm.provider` is empty,
     *  guide the user to the ⚙ LLM button. The CLI probe runs off the EDT so
     *  it never blocks the panel; failures are swallowed (best-effort). */
    private void maybeShowOnboarding() {
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            // The whole panel needs `cc` on PATH. If it's missing, say so first —
            // otherwise the provider probe below fails and shows the misleading
            // "未配置 LLM" hint when the real problem is "cc not installed".
            String ver = AgentChatSession.runCapture(
                    java.util.Collections.singletonList("--version"), cwd, 12000);
            if (CliVersionCheck.parseVersion(ver) == null) {
                SwingUtilities.invokeLater(() -> appendThinking(
                        "面板需要 cc CLI 才能工作。" + CliLauncher.missingCliMessage() + "\n"));
                return;
            }
            String provider;
            try {
                provider = LlmConfig.getConfiguredProvider();
            } catch (Throwable t) {
                return; // never block the panel on the probe
            }
            if (provider == null || provider.trim().isEmpty()) {
                SwingUtilities.invokeLater(() -> appendThinking(
                        "尚未配置 LLM —— 点右下「⚙ LLM」选择提供商并填入 API key,即可开始对话。\n"));
            }
        });
    }

    /** One-time-per-version nudge: if a newer `cc` is published on npm than the
     *  one installed, dim-hint the upgrade command. The `cc --version` probe and
     *  the npm fetch run off the EDT (never block the panel); the hint is shown
     *  at most once per latest version via {@link PropertiesComponent}; every
     *  failure is swallowed (best-effort). */
    private void maybeShowCliUpdateNudge() {
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                String installed = AgentChatSession.runCapture(
                        java.util.Collections.singletonList("--version"), cwd, 12000);
                String latestJson = fetchNpmLatest();
                String latest = CliVersionCheck.parseNpmLatest(latestJson);
                String notice = CliVersionCheck.updateNotice(installed, latest);
                if (notice == null) return;
                String key = "cc.cliUpdateNudge." + CliVersionCheck.parseVersion(latest);
                PropertiesComponent props = PropertiesComponent.getInstance(project);
                if (props.getBoolean(key, false)) return; // already nudged for this version
                props.setValue(key, true);
                SwingUtilities.invokeLater(() -> appendThinking("ℹ " + notice + "\n"));
            } catch (Throwable t) {
                // best-effort — never disturb the panel on a version probe
            }
        });
    }

    /** The npm registry body for `chainlesschain@latest`, or null (5s timeout). */
    private static String fetchNpmLatest() {
        java.net.HttpURLConnection c = null;
        try {
            // URI.toURL() instead of the deprecated new URL(String) constructor.
            c = (java.net.HttpURLConnection) java.net.URI.create(
                    "https://registry.npmjs.org/chainlesschain/latest").toURL().openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setRequestProperty("Accept", "application/json");
            if (c.getResponseCode() != 200) return null;
            StringBuilder sb = new StringBuilder();
            try (java.io.BufferedReader r = new java.io.BufferedReader(
                    new java.io.InputStreamReader(c.getInputStream(),
                            java.nio.charset.StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            return sb.toString();
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Manual "检查 cc 更新" (⚙ LLM menu): always reports — including up-to-date —
     *  and ignores the once-per-version throttle. Probe + npm fetch run off the
     *  EDT; the result dialog is shown back on the EDT. */
    private void checkCliUpdateManually() {
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String installed = CliVersionCheck.parseVersion(AgentChatSession.runCapture(
                    java.util.Collections.singletonList("--version"), cwd, 12000));
            String latest = CliVersionCheck.parseNpmLatest(fetchNpmLatest());
            SwingUtilities.invokeLater(() -> {
                if (installed == null) {
                    com.intellij.openapi.ui.Messages.showWarningDialog(project,
                            "无法读取已安装的 cc 版本。请确认已安装并在 PATH 中(npm i -g chainlesschain)。",
                            "ChainlessChain");
                    return;
                }
                if (latest == null) {
                    com.intellij.openapi.ui.Messages.showWarningDialog(project,
                            "无法连接 npm 检查更新(你的版本是 cc " + installed + ")。", "ChainlessChain");
                    return;
                }
                if (CliVersionCheck.compare(installed, latest) >= 0) {
                    com.intellij.openapi.ui.Messages.showInfoMessage(project,
                            "cc " + installed + " 已是最新(npm 最新为 " + latest + ")。", "ChainlessChain");
                    return;
                }
                int r = com.intellij.openapi.ui.Messages.showYesNoDialog(project,
                        "新版本 cc " + latest + " 可用(你的是 " + installed + ")。\n是否复制升级命令到剪贴板?\n\n"
                                + CliVersionCheck.UPGRADE_COMMAND,
                        "ChainlessChain", "复制升级命令", "稍后", null);
                if (r == com.intellij.openapi.ui.Messages.YES) {
                    java.awt.Toolkit.getDefaultToolkit().getSystemClipboard().setContents(
                            new java.awt.datatransfer.StringSelection(CliVersionCheck.UPGRADE_COMMAND), null);
                    appendThinking("ℹ 已复制:" + CliVersionCheck.UPGRADE_COMMAND
                            + " —— 在终端粘贴运行即可升级。\n");
                }
            });
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

    /** §5: seed the input box (e.g. Explain/Refactor or an @file reference) without sending. */
    void seedInput(String text) {
        SwingUtilities.invokeLater(() -> {
            String cur = input.getText();
            input.setText((cur == null || cur.isEmpty()) ? text : cur + " " + text);
            input.requestFocusInWindow();
            input.setCaretPosition(input.getText().length());
        });
    }

    private ChatEvents.TurnState turnState() {
        // Defensive: a conversation minted without the TurnState factory holds a
        // HashMap — casting it would CCE on the reader thread and kill all replies.
        if (!(conv.turnState instanceof ChatEvents.TurnState)) {
            conv.turnState = new ChatEvents.TurnState();
        }
        return (ChatEvents.TurnState) conv.turnState;
    }

    private AgentChatSession liveSession() {
        return conv.session instanceof AgentChatSession ? (AgentChatSession) conv.session : null;
    }

    private void sendCurrentInput() {
        final String text = input.getText().trim();
        if (text.isEmpty() && pendingImages.isEmpty()) return;
        // §5 panel slash + §6 mode/thinking commands are handled locally, never
        // sent (only when it's a pure text command, no attached images).
        if (pendingImages.isEmpty() && text.startsWith("/")) {
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
        java.util.List<String> imgs = new java.util.ArrayList<>(pendingImages);
        if (s != null && s.send(text, imgs)) {
            String tag = imgs.isEmpty() ? ""
                    : (text.isEmpty() ? "" : " ") + "[📷 " + imgs.size() + "]";
            append("\nyou> " + text + tag + "\n");
            input.setText("");
            pendingImages.clear();
            updateImageIndicator();
        } else {
            append("⚠ agent session is not running — press New to restart\n");
        }
    }

    /** Attach a clipboard image (Ctrl/Cmd+V). Returns true if one was taken. */
    private boolean tryPasteImage() {
        try {
            java.awt.datatransfer.Clipboard cb =
                    java.awt.Toolkit.getDefaultToolkit().getSystemClipboard();
            if (!cb.isDataFlavorAvailable(java.awt.datatransfer.DataFlavor.imageFlavor)) {
                return false;
            }
            Object data = cb.getData(java.awt.datatransfer.DataFlavor.imageFlavor);
            if (!(data instanceof java.awt.Image)) return false;
            if (pendingImages.size() >= 4) return true; // cap at 4, still consume the paste
            java.io.File tmp = java.io.File.createTempFile("cc-paste-", ".png");
            tmp.deleteOnExit();
            javax.imageio.ImageIO.write(toBuffered((java.awt.Image) data), "png", tmp);
            pendingImages.add(tmp.getAbsolutePath());
            updateImageIndicator();
            return true;
        } catch (Exception ex) {
            return false; // any failure → fall back to normal text paste
        }
    }

    private static java.awt.image.BufferedImage toBuffered(java.awt.Image img) {
        if (img instanceof java.awt.image.BufferedImage) {
            return (java.awt.image.BufferedImage) img;
        }
        int w = Math.max(1, img.getWidth(null));
        int h = Math.max(1, img.getHeight(null));
        java.awt.image.BufferedImage bi =
                new java.awt.image.BufferedImage(w, h, java.awt.image.BufferedImage.TYPE_INT_ARGB);
        java.awt.Graphics2D g = bi.createGraphics();
        g.drawImage(img, 0, 0, null);
        g.dispose();
        return bi;
    }

    private void updateImageIndicator() {
        int n = pendingImages.size();
        imageLabel.setText(n == 0 ? "" : "📷 " + n + " image" + (n == 1 ? "" : "s"));
        imageLabel.setVisible(n > 0);
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
            case "/compact": {
                // Manual compaction (Claude-Code IDE parity): trim the live
                // history in the CLI child between turns. The CLI answers with
                // a `compaction` event rendered as "compacted: saved … tokens".
                AgentChatSession s = liveSession();
                if (s != null) { s.compact(); append("ℹ compacting…\n"); }
                else append("ℹ no running agent to compact\n");
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
            case "/review":
                // Seed a review turn: the agent inspects the working-tree diff
                // using its tools + this window's IDE context (selection /
                // diagnostics ride along). Local sugar — re-enter
                // sendCurrentInput() with a canned prompt (mirrors the VS Code
                // panel's /review); the non-slash text sends as a normal turn.
                input.setText(
                        "Review my current uncommitted git changes. Run git diff (and "
                        + "git diff --staged) to see them, then flag correctness bugs "
                        + "first and simplifications/cleanups second. Cite file:line "
                        + "and be concise. Don't edit files unless I ask.");
                sendCurrentInput();
                return;
            case "/plan":
                sendPlanAction("enter");
                append("ℹ plan mode — write tools blocked until you approve\n");
                return;
            case "/approve":
                respondPlan("approve");
                return;
            case "/reject":
                respondPlan("reject");
                return;
            case "/help":
                append("ℹ commands: /new /stop /compact /auto /bypass /normal /think "
                        + "/ultrathink /think-off /plan /approve /reject /context /cost "
                        + "/review\n");
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

    /**
     * After a Configure-LLM / vision-model change, restart this tab's child so it
     * respawns with the new config. The provider/model are pinned at spawn time
     * (SessionArgs reads config.json once via {@code ensureSession}), so a child
     * started with the old/broken LLM config keeps erroring until it respawns —
     * the "配置完还没用 / 新开一个对话才行" symptom. Mirrors the VS Code panel reload.
     */
    private void reloadLlmConfig() {
        boolean restarted = liveSession() != null;
        restartForModeChange();
        append(restarted
                ? "ℹ LLM 配置已更新 —— 下一条消息生效\n"
                : "ℹ LLM 配置已更新\n");
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
        // Pin the user's configured provider/model (read straight from
        // ~/.chainlesschain/config.json) so the panel deterministically uses the
        // SAME LLM as the terminal `cc` — never drifts to a stale ambient default
        // (the cause of spurious "Anthropic error: 401" when another provider is
        // actually configured). Pass the FULL block — provider/model AND the
        // endpoint + key — so the CLI doesn't drop a cloud provider's baseUrl/key
        // (it skips config when --provider is explicit) and fall through to ollama
        // ("配置了火山却 fetch failed"). Blank → SessionArgs omits the flag.
        String[] llm = com.chainlesschain.ide.LlmConfig.readConfiguredLlmBlock();
        o.extraArgs = SessionArgs.build(
                llm[0], llm[1], llm[2], llm[3], conv.sessionId, conv.mode, conv.thinking);

        IdeBridgeService bridge = IdeBridgeService.getInstance(project);
        if (bridge != null && bridge.getPort() > 0) {
            o.extraEnv.put("CHAINLESSCHAIN_IDE_PORT", String.valueOf(bridge.getPort()));
            if (bridge.getToken() != null) {
                o.extraEnv.put("CHAINLESSCHAIN_IDE_TOKEN", bridge.getToken());
            }
        }
        // IDEA's OWN built-in MCP server (IDEA 2025.2+), separate from our bridge
        // above. If the locator already found IntelliJ's MCP endpoint, inject it
        // so the spawned cc connects it as server `idea` (mcp__idea__*) and can
        // use the IDE's indexed operations (find usages / file-by-path / search)
        // instead of reading + grepping files — fewer tokens, faster. Best-effort
        // + cached; nothing found (IDE < 2025.2 or MCP disabled) → inject nothing
        // → cc does not connect. Also nudge a refresh for the next spawn.
        String jbMcpUrl = com.chainlesschain.ide.JetbrainsMcpLocator.cachedUrl();
        if (jbMcpUrl != null && !jbMcpUrl.isEmpty()) {
            o.extraEnv.put("CHAINLESSCHAIN_JETBRAINS_MCP_URL", jbMcpUrl);
        }
        com.chainlesschain.ide.JetbrainsMcpLocator.refreshAsync();
        // Opt into the ask_user_question round-trip: the agent's questions pop a
        // dialog here (an old `cc` ignores the env var → graceful degrade).
        o.extraEnv.put("CC_INTERACTIVE_QUESTIONS", "1");
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
            appendAssistantDelta(String.valueOf(ui.get("text")));
        } else if ("thinking".equals(kind)) {
            appendThinking(String.valueOf(ui.get("text")));
        } else if ("tool".equals(kind)) {
            String summary = String.valueOf(ui.get("summary"));
            append("\n→ " + ui.get("tool") + (summary.isEmpty() ? "" : " " + summary) + "\n");
        } else if ("tool_done".equals(kind)) {
            append((Boolean.TRUE.equals(ui.get("isError")) ? "✗ " : "✓ ")
                    + ui.get("tool") + "\n");
            Object note = ui.get("note");
            if (note instanceof String && !((String) note).isEmpty()) {
                appendThinking("ℹ " + ui.get("tool") + ":" + note + "\n");
            }
        } else if ("turn_end".equals(kind)) {
            Object text = ui.get("text");
            // The final result text only arrives here when nothing streamed; run
            // it through the same markdown path. (When deltas streamed, text is
            // null and we just finalize the streamed run.)
            if (text != null) appendAssistantDelta(String.valueOf(text));
            finalizeAssistantRun();
            append("\n");
            refreshContextIndicator(); // §6: after each turn
        } else if ("plan".equals(kind)) {
            showPlanCard(ui); // §5 interactive plan card (items + Approve/Reject)
        } else if ("approval".equals(kind)) {
            showApprovalCard(ui); // §5 interactive approval card (Approve/Deny)
        } else if ("approval_done".equals(kind)) {
            resolveApprovalCard(ui);
        } else if ("question".equals(kind)) {
            askQuestion(ui); // ask_user_question round-trip → dialog → {type:answer}
        } else if ("info".equals(kind) || "error".equals(kind)) {
            Object text = ui.get("text");
            String body = String.valueOf(text != null ? text : kind);
            append(("error".equals(kind) ? "⚠ " : "ℹ ") + body + "\n");
            // Nudge toward the LLM wizard when the failure looks like a
            // missing/expired key or wrong provider (401/403/api key…).
            if ("error".equals(kind) && LlmConfig.looksLikeLlmConfigError(body)) {
                appendThinking("提示:点右下「⚙ LLM」配置提供商 / API key"
                        + "(文本模型与图片识别模型可分别设置)。\n");
            }
        }
    }

    // ---- §5 interactive cards ------------------------------------------

    private static final Color WARN = new Color(0xCC, 0x88, 0x00);

    /** ask_user_question round-trip: the agent is BLOCKED on the user. Pop a
     *  dialog (single-choice / multi-choice / free-text) and reply
     *  {type:"answer",id,answer}. Cancel → null answer (CLI maps to user_timeout,
     *  the model proceeds). Runs on the EDT (render() is invoked via invokeLater),
     *  and the modal dialog spins its own event loop so nothing deadlocks. */
    private void askQuestion(Map<String, Object> ui) {
        String id = ui.get("id") == null ? "" : String.valueOf(ui.get("id"));
        if (id.isEmpty()) return;
        String question = ui.get("question") == null || String.valueOf(ui.get("question")).isEmpty()
                ? "ChainlessChain 提问" : String.valueOf(ui.get("question"));
        java.util.List<String> labels = new java.util.ArrayList<>();
        Object optsO = ui.get("options");
        if (optsO instanceof java.util.List) {
            for (Object o : (java.util.List<?>) optsO) {
                if (o instanceof Map) {
                    Object lbl = ((Map<?, ?>) o).get("label");
                    labels.add(String.valueOf(lbl != null ? lbl : o));
                } else {
                    labels.add(String.valueOf(o));
                }
            }
        }
        boolean multi = Boolean.TRUE.equals(ui.get("multiSelect"));
        Object answer; // String | List<String> | null
        if (labels.isEmpty()) {
            answer = com.intellij.openapi.ui.Messages.showInputDialog(
                    project, question, "ChainlessChain", null);
        } else if (!multi) {
            answer = showSingleSelectQuestion(question, labels);
        } else {
            answer = showMultiSelectQuestion(question, labels);
        }
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "answer");
        ev.put("id", id);
        ev.put("answer", answer);
        AgentChatSession s = liveSession();
        if (s != null) s.sendEvent(ev);
    }

    /** Single-select question → a combo-box dialog (non-deprecated; replaces
     *  Messages.showChooseDialog). Returns the chosen label, or null if cancelled. */
    private String showSingleSelectQuestion(String question, java.util.List<String> labels) {
        JPanel panel = new JPanel();
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        panel.add(new JLabel("<html>" + question + "</html>"));
        javax.swing.JComboBox<String> combo =
                new javax.swing.JComboBox<>(labels.toArray(new String[0]));
        panel.add(combo);
        com.intellij.openapi.ui.DialogBuilder b = new com.intellij.openapi.ui.DialogBuilder(project);
        b.setTitle("ChainlessChain");
        b.setCenterPanel(panel);
        b.addOkAction();
        b.addCancelAction();
        if (b.show() != com.intellij.openapi.ui.DialogWrapper.OK_EXIT_CODE) return null;
        Object sel = combo.getSelectedItem();
        return sel == null ? null : String.valueOf(sel);
    }

    /** Multi-select question → a checkbox dialog. Returns the chosen labels, or
     *  null if cancelled (→ the agent proceeds without an answer). */
    private java.util.List<String> showMultiSelectQuestion(String question, java.util.List<String> labels) {
        JPanel panel = new JPanel();
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        panel.add(new JLabel("<html>" + question + "</html>"));
        java.util.List<javax.swing.JCheckBox> boxes = new java.util.ArrayList<>();
        for (String l : labels) {
            javax.swing.JCheckBox cb = new javax.swing.JCheckBox(l);
            boxes.add(cb);
            panel.add(cb);
        }
        com.intellij.openapi.ui.DialogBuilder b = new com.intellij.openapi.ui.DialogBuilder(project);
        b.setTitle("ChainlessChain");
        b.setCenterPanel(panel);
        b.addOkAction();
        b.addCancelAction();
        if (b.show() != com.intellij.openapi.ui.DialogWrapper.OK_EXIT_CODE) return null;
        java.util.List<String> sel = new java.util.ArrayList<>();
        for (int i = 0; i < boxes.size(); i++) {
            if (boxes.get(i).isSelected()) sel.add(labels.get(i));
        }
        return sel;
    }

    /** Tool-permission approval card → sends {type:approval,id,approve} on click. */
    @SuppressWarnings("unchecked")
    private void showApprovalCard(Map<String, Object> ui) {
        final String id = ui.get("id") == null ? "" : String.valueOf(ui.get("id"));
        if (id.isEmpty() || approvalCards.containsKey(id)) return;

        StringBuilder q = new StringBuilder("Allow ");
        q.append(ui.get("tool") != null ? ui.get("tool") : "tool");
        if (ui.get("command") != null) q.append(": ").append(ui.get("command"));
        q.append("?");
        if (ui.get("risk") != null) q.append("  [risk: ").append(ui.get("risk")).append("]");
        if (ui.get("reason") != null) q.append("\n").append(ui.get("reason"));

        JPanel card = new JPanel(new BorderLayout(4, 4));
        card.setBorder(BorderFactory.createLineBorder(WARN));
        card.add(htmlLabel(q.toString()), BorderLayout.CENTER);
        JPanel btns = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 2));
        JButton approve = new JButton("Approve");
        JButton deny = new JButton("Deny");
        approve.addActionListener(e -> respondApproval(id, true));
        deny.addActionListener(e -> respondApproval(id, false));
        btns.add(approve);
        btns.add(deny);
        card.add(btns, BorderLayout.SOUTH);

        approvalCards.put(id, card);
        cardsPanel.add(card);
        cardsPanel.revalidate();
        cardsPanel.repaint();
    }

    private void respondApproval(String id, boolean approve) {
        AgentChatSession s = liveSession();
        if (s != null) {
            Map<String, Object> ev = new LinkedHashMap<>();
            ev.put("type", "approval");
            ev.put("id", id);
            ev.put("approve", approve);
            s.sendEvent(ev);
        }
        removeApprovalCard(id);
        append("ℹ " + (approve ? "approved" : "denied") + " (" + id + ")\n");
    }

    private void resolveApprovalCard(Map<String, Object> ui) {
        Object id = ui.get("id");
        if (id != null) removeApprovalCard(String.valueOf(id));
    }

    private void removeApprovalCard(String id) {
        JComponent card = approvalCards.remove(id);
        if (card != null) {
            cardsPanel.remove(card);
            cardsPanel.revalidate();
            cardsPanel.repaint();
        }
    }

    /** Plan card with the step list + Approve/Reject → sends {type:plan,action}. */
    @SuppressWarnings("unchecked")
    private void showPlanCard(Map<String, Object> ui) {
        String state = String.valueOf(ui.get("state"));
        boolean active = Boolean.TRUE.equals(ui.get("active"));
        // Terminal states clear the card and leave a transcript note.
        if (!active || "approved".equals(state) || "rejected".equals(state)) {
            removePlanCard();
            append("📋 plan " + (state == null ? "ended" : state) + "\n");
            return;
        }
        removePlanCard();
        List<Object> items = ui.get("items") instanceof List
                ? (List<Object>) ui.get("items") : java.util.Collections.emptyList();

        StringBuilder sb = new StringBuilder("<b>Plan</b>");
        if (ui.get("risk") != null) sb.append("  [risk: ").append(ui.get("risk")).append("]");
        sb.append("<br>");
        int n = 1;
        for (Object it : items) {
            String text = it instanceof Map && ((Map<String, Object>) it).get("text") != null
                    ? String.valueOf(((Map<String, Object>) it).get("text")) : String.valueOf(it);
            sb.append(n++).append(". ").append(escapeHtml(text)).append("<br>");
        }

        JPanel card = new JPanel(new BorderLayout(4, 4));
        card.setBorder(BorderFactory.createLineBorder(WARN));
        card.add(htmlLabel(sb.toString()), BorderLayout.CENTER);
        JPanel btns = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 2));
        JButton ok = new JButton("Approve");
        JButton no = new JButton("Reject");
        ok.addActionListener(e -> respondPlan("approve"));
        no.addActionListener(e -> respondPlan("reject"));
        btns.add(ok);
        btns.add(no);
        card.add(btns, BorderLayout.SOUTH);

        planCard = card;
        cardsPanel.add(card);
        cardsPanel.revalidate();
        cardsPanel.repaint();
    }

    private void respondPlan(String action) {
        sendPlanAction(action);
        removePlanCard();
        append("📋 plan " + action + "d\n");
    }

    /** Send a plan control ({type:plan,action}); entering plan may need to spawn the child. */
    private void sendPlanAction(String action) {
        AgentChatSession s = liveSession();
        if (s == null || !s.isRunning()) {
            try {
                ensureSession();
            } catch (IOException ex) {
                append("⚠ could not start agent for plan control: " + ex.getMessage() + "\n");
                return;
            }
            s = liveSession();
        }
        if (s != null) {
            Map<String, Object> ev = new LinkedHashMap<>();
            ev.put("type", "plan");
            ev.put("action", action);
            s.sendEvent(ev);
        }
    }

    private void removePlanCard() {
        if (planCard != null) {
            cardsPanel.remove(planCard);
            planCard = null;
            cardsPanel.revalidate();
            cardsPanel.repaint();
        }
    }

    private static JLabel htmlLabel(String text) {
        return new JLabel("<html>" + text.replace("\n", "<br>") + "</html>");
    }

    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
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

    // ---- slash-command completion popup --------------------------------

    /** Open the chooser only when the whole input so far is a leading slash token. */
    private void maybeOpenSlash() {
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
    private void maybeOpenMention() {
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

    /** Compact token count: 12345 → "12.3k", 1500000 → "1.5M". */
    private static String human(long n) {
        if (n < 1000) return String.valueOf(n);
        if (n < 1_000_000) return String.format("%.1fk", n / 1000.0);
        return String.format("%.1fM", n / 1_000_000.0);
    }

    private void insertStyled(String s, javax.swing.text.AttributeSet style) {
        try {
            StyledDocument d = transcript.getStyledDocument();
            d.insertString(d.getLength(), s, style);
            // Bound long-session memory: drop the oldest text once the document
            // exceeds the cap, never trimming into the active assistant run (whose
            // absolute offset is shifted by whatever is removed). Mirrors the VS
            // Code panel's transcript node cap (chainlesschain-ide 0.36.5).
            int removeLen = TranscriptCap.removeCount(
                    d.getLength(), assistantRunStart, inAssistantRun,
                    TranscriptCap.DEFAULT_MAX_CHARS);
            if (removeLen > 0) {
                d.remove(0, removeLen);
                if (assistantRunStart >= 0) assistantRunStart -= removeLen;
            }
            transcript.setCaretPosition(d.getLength());
        } catch (BadLocationException ignored) {
            /* document offsets are append-only here — should not happen */
        }
    }

    /** A plain transcript line (header / tool / info / error). Ends any pending
     *  assistant markdown run first so it gets re-styled before this line. */
    private void append(String s) {
        finalizeAssistantRun();
        insertStyled(s, stylePlain);
    }

    /** Streaming assistant text — appended plain; re-styled with markdown when
     *  the run finalizes (so streaming stays responsive, then snaps to styled). */
    private void appendAssistantDelta(String s) {
        if (!inAssistantRun) {
            assistantRunStart = transcript.getStyledDocument().getLength();
            inAssistantRun = true;
        }
        insertStyled(s, stylePlain);
    }

    /** Re-render the just-streamed assistant run as markdown (code → monospace
     *  amber, **bold** → bold). No-op when not in a run. */
    private void finalizeAssistantRun() {
        if (!inAssistantRun) return;
        inAssistantRun = false;
        StyledDocument d = transcript.getStyledDocument();
        int end = d.getLength();
        int start = assistantRunStart;
        assistantRunStart = -1;
        if (start < 0 || end <= start) return;
        try {
            String text = d.getText(start, end - start);
            d.remove(start, end - start);
            for (MarkdownLite.Span span : MarkdownLite.parse(text)) {
                javax.swing.text.AttributeSet st =
                        span.kind == MarkdownLite.Kind.CODE ? styleCode
                        : span.kind == MarkdownLite.Kind.BOLD ? styleBold
                        : stylePlain;
                d.insertString(d.getLength(), span.text, st);
            }
            transcript.setCaretPosition(d.getLength());
        } catch (BadLocationException ignored) {
            /* best-effort — leave the plain text in place on any hiccup */
        }
    }

    /** Extended-thinking reasoning — streamed dim/italic, not markdown-rendered. */
    private void appendThinking(String s) {
        finalizeAssistantRun();
        insertStyled(s, styleDim);
    }

    void appendInfo(String s) {
        SwingUtilities.invokeLater(() -> append(s));
    }

    void clearTranscript() {
        inAssistantRun = false;
        assistantRunStart = -1;
        pendingImages.clear();
        updateImageIndicator();
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
