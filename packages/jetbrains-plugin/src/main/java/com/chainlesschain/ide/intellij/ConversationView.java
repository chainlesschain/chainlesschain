package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.ChatEvents;
import com.chainlesschain.ide.ContextStatus;
import com.chainlesschain.ide.CliLauncher;
import com.chainlesschain.ide.CliVersionCheck;
import com.chainlesschain.ide.ConversationManager;
import com.chainlesschain.ide.ElicitationSchema;
import com.chainlesschain.ide.IntrospectArgs;
import com.chainlesschain.ide.IdeSessionIndex;
import com.chainlesschain.ide.LlmConfig;
import com.chainlesschain.ide.PlanReview;
import com.chainlesschain.ide.RemoteHandoff;
import com.chainlesschain.ide.RewindCommands;
import com.chainlesschain.ide.SessionArgs;
import com.chainlesschain.ide.SessionList;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.editor.Document;
import com.intellij.openapi.fileEditor.FileDocumentManager;
import com.intellij.openapi.fileEditor.FileEditorManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.popup.JBPopupFactory;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;

import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.FlowLayout;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

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

    private static final String PLAN_REVIEW_STATES_KEY =
            "chainlesschain.chat.planReviewStates.v1";

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
    // Transcript rendering (styles + markdown snap + memory cap) — see ChatTranscript.
    private final ChatTranscript transcript = new ChatTranscript();
    private final JTextArea input = new JTextArea(3, 0); // multi-line composer
    // Attached images (paste + drag-drop + 📷 indicator) — see ChatComposerImages.
    private final ChatComposerImages images = new ChatComposerImages(input);
    // `/` and `@` completion popups — see ChatMentionPopups (needs `project`; ctor-assigned).
    private final ChatMentionPopups popups;
    private final JButton sendBtn = new JButton("Send");
    private final JButton stopBtn = new JButton("Stop");
    private final JLabel contextLabel = new JLabel(" "); // §6 context-window indicator
    private final JPanel cardsPanel = new JPanel();       // §5 interactive approval/plan cards
    private final Map<String, JComponent> approvalCards = new LinkedHashMap<>();
    private JComponent planCard;
    private Map<String, Object> currentPlanUi;
    private File planReviewFile;
    private VirtualFile planReviewVirtualFile;
    private String planReviewLastText;
    private Map<String, Object> planReviewLastPlan;
    private Map<String, Object> planReviewRevisionBase;
    private boolean planReviewHasReviewerEdits;
    private volatile int planReviewTurn;
    private boolean restoringPlanReview;
    // Serial per-tab worker for spawn + send: ensureSession() reads config files,
    // probes the cc binary (worst case seconds on a cold machine) and starts a
    // process — never on the EDT. Bound 1 keeps this tab's sends ordered.
    private final java.util.concurrent.ExecutorService sendExecutor =
            com.intellij.util.concurrency.AppExecutorUtil.createBoundedApplicationPoolExecutor(
                    "ChainlessChain chat send", 1);
    // True while a send is being spawned/delivered off-EDT; further Enter presses
    // are ignored instead of double-sending the same composer text.
    private volatile boolean sendInFlight = false;
    // Set by dispose(): sendExecutor.shutdown() lets ALREADY-QUEUED tasks run,
    // and ensureSession() would happily spawn a fresh cc child for the dead
    // view — checked at the top of ensureSession and every queued task body.
    private volatile boolean disposed = false;
    // One shared worker funnels ALL session-index writes off the EDT:
    // indexConversation used to read+parse+rewrite the 200-record index file
    // synchronously on the EDT several times per turn. Application-level (not
    // per-view) so a disposing view's final "stopped" upsert still flushes.
    private static final java.util.concurrent.ExecutorService INDEX_EXECUTOR =
            com.intellij.util.concurrency.AppExecutorUtil.createBoundedApplicationPoolExecutor(
                    "ChainlessChain session index", 1);
    // Latest-wins coalescing per conversation: several status flips inside one
    // turn collapse into the newest record still pending when the worker runs.
    private final java.util.concurrent.atomic.AtomicReference<Map<String, Object>>
            pendingIndexRecord = new java.util.concurrent.atomic.AtomicReference<>();
    // §6 local context indicator (VS Code parity): the LAST LLM call's usage
    // (token_usage events) + the model's window size learned from ONE
    // `cc context --json` probe → per-turn indicator with no CLI spawn.
    // usage is EDT-only; the window cache is cleared on LLM reconfigure.
    private Map<String, Object> lastCallUsage;
    private volatile long cachedContextWindow;
    // Live per-turn token tally (token_usage events); reset at turn end. EDT-only.
    private ChatEvents.TokenTally turnTokens;
    // Stop escalation: the session interrupt was already sent to — a second Stop
    // click on the SAME still-running child hard-kills it (interrupt can't reach
    // a hung child). EDT-only.
    private AgentChatSession interruptRequested;
    // This tab's last successfully-sent user prompt, for /retry (regenerate).
    // Per-view (= per-conversation), so a retry never replays another tab's
    // prompt (mirrors the VS Code panel's lastSentByTab). EDT-only.
    private String lastSentPrompt;
    private volatile ScheduledFuture<?> loopTask;
    // Self-created temp images, one batch PER SENT MESSAGE (FIFO). The CLI
    // resolves a turn's images when that turn STARTS, and queued sends run in
    // order, so each turn_end deletes the OLDEST batch — not all of them. (The
    // old single flat list deleted every pending temp at the first turn_end,
    // destroying a second message's image before its turn had started.) EDT-only.
    private final java.util.Deque<java.util.List<String>> sentImageBatches =
            new java.util.ArrayDeque<>();

    ConversationView(Project project, ConversationManager.Conversation conv,
                     SessionIdSink sessionIdSink) {
        this.project = project;
        this.conv = conv;
        this.sessionIdSink = sessionIdSink;
        this.popups = new ChatMentionPopups(project, input);
        if (conv.turnState == null) conv.turnState = new ChatEvents.TurnState();

        root.add(new JScrollPane(transcript.pane()), BorderLayout.CENTER);

        // Multi-line composer: Enter sends, Shift+Enter inserts a newline.
        input.setLineWrap(true);
        input.setWrapStyleWord(true);

        // Input gets its own full-width line; Send/Stop sit on a row below it
        // (the old side-by-side layout left the field too narrow).
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 0));
        JButton llmBtn = new JButton("⚙ LLM");
        llmBtn.setToolTipText(CcBundle.message("chat.btn.llm.tooltip"));
        llmBtn.addActionListener(ev -> {
            javax.swing.JPopupMenu menu = new javax.swing.JPopupMenu();
            javax.swing.JMenuItem full =
                    new javax.swing.JMenuItem(CcBundle.message("chat.menu.configureLlm"));
            full.addActionListener(a -> {
                ConfigureLlmAction.runWizard(project);
                reloadLlmConfig();
            });
            javax.swing.JMenuItem vision =
                    new javax.swing.JMenuItem(CcBundle.message("chat.menu.visionModel"));
            vision.addActionListener(a -> {
                ConfigureLlmAction.configureVisionModel(project);
                reloadLlmConfig();
            });
            javax.swing.JMenuItem checkUpdate =
                    new javax.swing.JMenuItem(CcBundle.message("chat.menu.checkUpdate"));
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
        JPanel buttonRow = new JPanel(new BorderLayout());
        buttonRow.add(images.indicatorLabel(), BorderLayout.WEST); // 📷 attached-image indicator
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
        stopBtn.setToolTipText(CcBundle.message("chat.btn.stop.tooltip"));
        stopBtn.addActionListener(e -> {
            AgentChatSession s = liveSession();
            if (s == null) return;
            // Both interrupt() and stop() do blocking pipe I/O (stdin write/flush)
            // under the session monitor — if the child's stdin buffer is full
            // (a hung child that stopped reading), doing them on the EDT freezes
            // the whole IDE, and the second-click force-kill can never dispatch.
            // Decide on the EDT, run the blocking part off it.
            if (s == interruptRequested) {
                // Second click on the same still-live child → escalate to a hard
                // stop (interrupt rides stdin, which a hung child never reads).
                interruptRequested = null;
                conv.session = null;
                append("⏹ force-stopped the agent process — next message restarts it\n");
                ApplicationManager.getApplication().executeOnPooledThread(s::stop);
                return;
            }
            interruptRequested = s;
            ApplicationManager.getApplication().executeOnPooledThread(s::interrupt);
        });
        // §5 @-mention completion: typing '@' (at start or after space) pops a chooser.
        // Slash-command completion: typing '/' at the line start pops a chooser too.
        input.addKeyListener(new java.awt.event.KeyAdapter() {
            @Override
            public void keyTyped(java.awt.event.KeyEvent e) {
                if (e.getKeyChar() == '@') SwingUtilities.invokeLater(popups::maybeOpenMention);
                else if (e.getKeyChar() == '/') SwingUtilities.invokeLater(popups::maybeOpenSlash);
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
                        && images.tryPaste()) {
                    e.consume();
                }
            }
        });

        // Drag-drop images onto the composer or transcript (VS Code 0.37.0
        // parity). A DropTarget — not a TransferHandler swap — so the text
        // area's default paste and text handling stay intact.
        images.installDropTarget(input);
        images.installDropTarget(transcript.pane());

        // First-run nudge (VS Code parity): if no LLM provider is configured yet,
        // dim-hint toward the ⚙ LLM button instead of leaving the panel blank
        // until the first turn fails with a 401. Best-effort, probe runs off the EDT.
        maybeShowOnboarding();
        // The plugin and the `cc` CLI ship on independent tracks (Marketplace vs
        // npm), so a working-but-old cc misses newer features silently. Dim-hint
        // when a newer cc is published. Best-effort, off the EDT, once per version.
        maybeShowCliUpdateNudge();
        restorePlanReviewState();
    }

    /** One-time first-run nudge: when `cc config get llm.provider` is empty,
     *  guide the user to the ⚙ LLM button. The CLI probe runs off the EDT so
     *  it never blocks the panel; failures are swallowed (best-effort). */
    // Process-level cache of the `cc --version` probe output: every new tab
    // construction used to re-spawn it twice (onboarding + update nudge). The
    // installed CLI can't change under a running IDE except via a manual
    // upgrade — the explicit "检查 cc 更新" action re-probes and refreshes this.
    // Only probes that look like the REAL chainlesschain CLI are cached (strict
    // bare-semver first line — not a `cc` that is actually the C compiler, whose
    // "cc (GCC) 12.2.0" banner parseVersion would wrongly accept and then pin
    // process-wide). "cc not installed yet" (or a gcc shadow) keeps being
    // re-checked and recovers as soon as the real CLI is installed / on PATH.
    private static volatile String cachedVersionOut;

    private static String probeVersionCached(File cwd) {
        String v = cachedVersionOut;
        if (v != null) return v;
        String out = AgentChatSession.runCapture(
                java.util.Collections.singletonList("--version"), cwd, 12000);
        if (AgentChatSession.looksLikeCcVersion(out)) cachedVersionOut = out;
        return out;
    }

    private void maybeShowOnboarding() {
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            // The whole panel needs `cc` on PATH. If it's missing, say so first —
            // otherwise the provider probe below fails and shows the misleading
            // "未配置 LLM" hint when the real problem is "cc not installed".
            String ver = probeVersionCached(cwd);
            if (CliVersionCheck.parseVersion(ver) == null) {
                SwingUtilities.invokeLater(() -> appendThinking(
                        CcBundle.message("chat.needsCli") + " " + CcBundle.message("cli.missing") + "\n"));
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
                        CcBundle.message("chat.noLlm") + "\n"));
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
                String installed = probeVersionCached(cwd);
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
            // Manual check: the user may have JUST upgraded — bypass and refresh
            // the process-level probe cache.
            String freshOut = AgentChatSession.runCapture(
                    java.util.Collections.singletonList("--version"), cwd, 12000);
            // Only cache a probe that is really the chainlesschain CLI (not a gcc
            // `cc` shadow), matching probeVersionCached's gate.
            if (AgentChatSession.looksLikeCcVersion(freshOut)) cachedVersionOut = freshOut;
            String installed = CliVersionCheck.parseVersion(freshOut);
            String latest = CliVersionCheck.parseNpmLatest(fetchNpmLatest());
            SwingUtilities.invokeLater(() -> {
                if (installed == null) {
                    com.intellij.openapi.ui.Messages.showWarningDialog(project,
                            CcBundle.message("chat.update.noVersion"),
                            "ChainlessChain");
                    return;
                }
                if (latest == null) {
                    com.intellij.openapi.ui.Messages.showWarningDialog(project,
                            CcBundle.message("chat.update.noNpm", installed), "ChainlessChain");
                    return;
                }
                if (CliVersionCheck.compare(installed, latest) >= 0) {
                    com.intellij.openapi.ui.Messages.showInfoMessage(project,
                            CcBundle.message("chat.update.latest", installed, latest), "ChainlessChain");
                    return;
                }
                int r = com.intellij.openapi.ui.Messages.showYesNoDialog(project,
                        CcBundle.message("chat.update.available", latest, installed,
                                CliVersionCheck.UPGRADE_COMMAND),
                        "ChainlessChain", CcBundle.message("chat.update.copyBtn"),
                        CcBundle.message("chat.update.laterBtn"), null);
                if (r == com.intellij.openapi.ui.Messages.YES) {
                    java.awt.Toolkit.getDefaultToolkit().getSystemClipboard().setContents(
                            new java.awt.datatransfer.StringSelection(CliVersionCheck.UPGRADE_COMMAND), null);
                    appendThinking(CcBundle.message("chat.update.copied", CliVersionCheck.UPGRADE_COMMAND) + "\n");
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

    /**
     * Deep-link entry: apply a pre-vetted safe approval mode (default /
     * acceptEdits / plan — the parser already rejects bypassPermissions from an
     * untrusted link) to this conversation. Same restart-on-next-message
     * semantics as the /auto · /normal slash commands.
     */
    void applyDeepLinkMode(String mode) {
        if (!com.chainlesschain.ide.DeepLink.SAFE_MODES.contains(mode)) return;
        // "plan" isn't a spawn-time approval flag here; map it to default so a
        // deep link never silently arms auto-approval.
        conv.mode = "acceptEdits".equals(mode) ? "acceptEdits" : "default";
        restartForModeChange();
        BridgeStatusBarWidgetFactory.refresh(project);
        append("ℹ approval mode → " + conv.mode + " (deep link) — next message applies\n");
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
        if (sendInFlight) return;
        final String text = input.getText().trim();
        if (text.isEmpty() && images.isEmpty()) return;
        // §5 panel slash + §6 mode/thinking commands are handled locally, never
        // sent (only when it's a pure text command, no attached images).
        if (images.isEmpty() && text.startsWith("/")) {
            input.setText("");
            handleSlash(text);
            return;
        }
        final java.util.List<String> imgs = images.snapshot();
        sendInFlight = true;
        sendExecutor.execute(() -> {
            if (disposed) return; // queued before a tab close — don't respawn cc
            boolean sent = false;
            String spawnError = null;
            try {
                ensureSession();
                AgentChatSession s = liveSession();
                sent = s != null && s.send(text, imgs);
            } catch (IOException ex) {
                spawnError = ex.getMessage();
            } finally {
                final boolean ok = sent;
                final String err = spawnError;
                SwingUtilities.invokeLater(() -> {
                    sendInFlight = false;
                    if (err != null) {
                        append("⚠ failed to start `cc` (is the ChainlessChain CLI installed and on "
                                + "PATH?): " + err + "\n");
                    } else if (ok) {
                        if (!text.isEmpty()) lastSentPrompt = text; // for /retry
                        String tag = imgs.isEmpty() ? ""
                                : (text.isEmpty() ? "" : " ") + "[📷 " + imgs.size() + "]";
                        append("\nyou> " + text + tag + "\n");
                        input.setText("");
                        // Take ownership of the composer's self-created temp pngs
                        // BEFORE clearAll (which deletes still-pending own temps)
                        // — these were just sent, so they're cleaned at THIS
                        // message's turn end. One batch per send keeps the FIFO
                        // aligned with turn_end events (empty batch for a
                        // text-only / dropped-real-file send).
                        sentImageBatches.addLast(
                                new java.util.ArrayList<>(images.takeOwnedTemps(imgs)));
                        images.clearAll();
                    } else {
                        append("⚠ agent session is not running — press New to restart\n");
                    }
                });
            }
        });
    }

    /**
     * Panel slash commands (§5) + approval-mode / extended-thinking toggles (§6).
     * Mode/thinking are spawn-time flags, so changing one stops the live child;
     * the next message respawns with the new flag (resume id preserved).
     */
    private void handleSlash(String raw) {
        String[] parts = raw.trim().split("\\s+", 2);
        String cmd = parts[0].toLowerCase();
        if ("/".equals(cmd)) {
            append("type / followed by a command, or choose one from the suggestions\n");
            return;
        }
        switch (cmd) {
            case "/new":
            case "/clear":
                if (containerActions != null) containerActions.newConversation();
                else append("ℹ /new unavailable\n");
                return;
            case "/goal":
                setGoal(parts.length > 1 ? parts[1] : "");
                return;
            case "/loop":
                setLoop(parts.length > 1 ? parts[1] : "");
                return;
            case "/status": runCliCommand("status"); return;
            case "/doctor": runCliCommand("doctor"); return;
            case "/init": runCliCommand("init"); return;
            case "/mcp": runCliCommand("mcp"); return;
            case "/hooks": runCliCommand("hook"); return;
            case "/permissions": runCliCommand("permissions"); return;
            case "/agents": runCliCommand("agents"); return;
            case "/tasks": runCliCommand("tasks"); return;
            case "/memory": runCliCommand("memory"); return;
            case "/plugin": runCliCommand("plugin"); return;
            case "/release-notes": runCliCommand("changelog"); return;
            case "/stop": {
                AgentChatSession s = liveSession();
                // interrupt() writes+flushes the child's stdin under the session
                // monitor — a wedged child that stopped reading freezes the EDT.
                // Pooled thread, NOT sendExecutor: an interrupt must never queue
                // behind the very sends it is trying to break (Stop button twin).
                if (s != null) {
                    ApplicationManager.getApplication().executeOnPooledThread(s::interrupt);
                    append("ℹ interrupted\n");
                } else append("ℹ no running agent\n");
                return;
            }
            case "/compact": {
                // Manual compaction (Claude-Code IDE parity): trim the live
                // history in the CLI child between turns. The CLI answers with
                // a `compaction` event rendered as "compacted: saved … tokens".
                // Same blocking-stdin-write hazard as /stop → pooled thread.
                AgentChatSession s = liveSession();
                if (s != null) {
                    ApplicationManager.getApplication().executeOnPooledThread(s::compact);
                    append("ℹ compacting…\n");
                } else append("ℹ no running agent to compact\n");
                return;
            }
            case "/auto":
                conv.mode = "acceptEdits";
                restartForModeChange();
                BridgeStatusBarWidgetFactory.refresh(project);
                append("ℹ approval mode → auto (accept edits) — next message applies\n");
                return;
            case "/bypass":
                conv.mode = "bypassPermissions";
                restartForModeChange();
                BridgeStatusBarWidgetFactory.refresh(project);
                append("ℹ approval mode → bypass (skip all approvals) — next message applies\n");
                return;
            case "/normal":
                conv.mode = "default";
                restartForModeChange();
                BridgeStatusBarWidgetFactory.refresh(project);
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
            case "/rewind":
                runRewind();
                return;
            case "/sessions":
                runSessions();
                return;
            case "/handoff":
                runHandoff();
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
            case "/retry":
                // Regenerate: re-send THIS tab's last successfully-sent prompt as
                // a fresh turn (mirrors the VS Code panel's /retry). Local sugar
                // — re-enter sendCurrentInput() with the remembered text.
                if (lastSentPrompt == null || lastSentPrompt.isEmpty()) {
                    append("ℹ nothing to retry yet — send a message first\n");
                    return;
                }
                input.setText(lastSentPrompt);
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
                        + "/review /retry /rewind /sessions /handoff\n");
                return;
            default:
                append("ℹ unknown command " + cmd + " — try /help\n");
        }
    }

    private void setGoal(String spec) {
        String value = spec == null ? "" : spec.trim();
        if (value.isEmpty()) {
            append("goal: " + (conv.goalCondition.isEmpty() ? "not set" : conv.goalCondition) + "\n");
            return;
        }
        if ("clear".equalsIgnoreCase(value) || "off".equalsIgnoreCase(value)
                || "none".equalsIgnoreCase(value)) {
            conv.goalCondition = "";
            restartForModeChange();
            append("goal cleared\n");
            return;
        }
        conv.goalCondition = value;
        restartForModeChange();
        append("goal set: " + value + " (applies on next message)\n");
    }

    private void setLoop(String spec) {
        String value = spec == null ? "" : spec.trim();
        if (value.isEmpty() || "stop".equalsIgnoreCase(value)
                || "clear".equalsIgnoreCase(value) || "off".equalsIgnoreCase(value)) {
            if (loopTask != null) loopTask.cancel(false);
            loopTask = null;
            append("loop stopped\n");
            return;
        }
        long intervalMs = 300_000L;
        String prompt = value;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^(\\d+(?:\\.\\d+)?)(s|m|h)\\s+(.+)$", java.util.regex.Pattern.CASE_INSENSITIVE)
                .matcher(value);
        if (m.matches()) {
            double n = Double.parseDouble(m.group(1));
            long unit = "h".equalsIgnoreCase(m.group(2)) ? 3_600_000L
                    : ("m".equalsIgnoreCase(m.group(2)) ? 60_000L : 1_000L);
            intervalMs = Math.max(1_000L, Math.min(86_400_000L, (long) (n * unit)));
            prompt = m.group(3).trim();
        }
        if (loopTask != null) loopTask.cancel(false);
        final String loopPrompt = prompt;
        final long delay = intervalMs;
        loopTask = com.intellij.util.concurrency.AppExecutorUtil
                .getAppScheduledExecutorService().scheduleWithFixedDelay(() ->
                        SwingUtilities.invokeLater(() -> {
                            if (!disposed) {
                                input.setText(loopPrompt);
                                sendCurrentInput();
                            }
                        }), 0, delay, TimeUnit.MILLISECONDS);
        append("loop started: every " + delay + "ms\n");
    }

    private void runCliCommand(String command) {
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(java.util.Arrays.asList(command), cwd, 30000);
            SwingUtilities.invokeLater(() -> append("/" + command + ": "
                    + (out == null || out.trim().isEmpty() ? "(no output)" : out.trim()) + "\n"));
        });
    }

    /** Best-effort {@code cc <kind> <id> --json} → append a short line off the EDT. */
    private void runIntrospect(String kind) {
        final String sid = conv.sessionId;
        if (sid == null || sid.isEmpty()) {
            append("ℹ /" + kind + " needs an active session (send a message first)\n");
            return;
        }
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            List<String> args = IntrospectArgs.build(kind, sid, null, null, true);
            String out = AgentChatSession.runCapture(args, cwd, 8000);
            final String line = (out == null || out.trim().isEmpty())
                    ? "ℹ /" + kind + " unavailable\n"
                    : "ℹ " + kind + ": " + out.trim().replace('\n', ' ') + "\n";
            SwingUtilities.invokeLater(() -> append(line));
        });
    }

    /**
     * {@code /rewind} — list this session's auto-checkpoints (the agent snapshots
     * the work tree before each mutating tool, cc >= 0.162.70), let the user pick
     * one, and {@code cc checkpoint restore} it (current state is auto-snapshotted
     * first). Scoped to this conversation's session id, mirroring the VS Code
     * panel's _rewind. CLI captures run off the EDT; choosers/appends on it.
     */
    private void runRewind() {
        final String sid = conv.sessionId;
        if (sid == null || sid.isEmpty()) {
            append("ℹ /rewind: send a message first — no session yet.\n");
            return;
        }
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(RewindCommands.buildListArgs(sid), cwd, 30000);
            final List<RewindCommands.Checkpoint> list = RewindCommands.parseCheckpointList(out);
            SwingUtilities.invokeLater(() -> {
                if (list.isEmpty()) {
                    append("ℹ /rewind: no checkpoints for this session yet — they're "
                            + "created automatically before file edits (needs cc >= 0.162.70).\n");
                    return;
                }
                java.util.List<String> labels = new java.util.ArrayList<>();
                for (RewindCommands.Checkpoint c : list) labels.add(RewindCommands.itemLabel(c));
                JBPopupFactory.getInstance()
                        .createPopupChooserBuilder(labels)
                        .setTitle("Rewind to which checkpoint? (a diff preview opens before you confirm)")
                        .setItemChosenCallback(label -> {
                            int idx = labels.indexOf(label);
                            if (idx < 0) return;
                            final RewindCommands.Checkpoint chosen = list.get(idx);
                            previewThenRestore(sid, chosen, cwd);
                        })
                        .createPopup()
                        .showCenteredInCurrentWindow(project);
            });
        });
    }

    /**
     * Preview a checkpoint's diff, then confirm before restoring (VS Code
     * _rewind parity — the old flow restored on pick with no way to see what
     * would change). {@code cc checkpoint show --diff} runs off the EDT; the
     * preview + confirm dialog is shown on it. Cancel = no write. If the diff
     * is unavailable (copy engine / error), the confirm still gates the write.
     */
    private void previewThenRestore(String sid, RewindCommands.Checkpoint chosen, File cwd) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String shown = AgentChatSession.runCapture(
                    RewindCommands.buildShowDiffArgs(sid, chosen.id), cwd, 30000);
            final String preview = RewindCommands.formatDiffPreview(shown);
            SwingUtilities.invokeLater(() -> {
                boolean confirmed = confirmRestore(chosen.id, preview);
                if (!confirmed) {
                    append("ℹ /rewind: cancelled — nothing restored\n");
                    return;
                }
                ApplicationManager.getApplication().executeOnPooledThread(() -> {
                    String restored = AgentChatSession.runCapture(
                            RewindCommands.buildRestoreArgs(sid, chosen.id), cwd, 60000);
                    final boolean ok = RewindCommands.restoreOk(restored);
                    final Integer n = RewindCommands.restoredCount(restored);
                    final String raw = restored == null ? "" : restored.trim();
                    SwingUtilities.invokeLater(() -> append(ok
                            ? "↩ rewound to " + chosen.id
                              + (n != null ? " — " + n + " file(s) restored" : "") + "\n"
                            : "✗ /rewind failed: "
                              + (raw.isEmpty() ? "no output" : raw) + "\n"));
                });
            });
        });
    }

    /** Modal preview + confirm dialog. Returns true only when the user clicks
     *  Restore. A non-empty diff is shown read-only (monospace); an empty diff
     *  states "no textual diff" but still lets the user confirm. */
    private boolean confirmRestore(String checkpointId, String preview) {
        JPanel panel = new JPanel(new BorderLayout(0, 6));
        panel.add(new JLabel("<html>Restore the work tree to <b>" + escapeHtml(checkpointId)
                + "</b>?<br>Your current state is snapshotted first, so this is undoable.</html>"),
                BorderLayout.NORTH);
        JTextArea area = new JTextArea(preview == null || preview.isEmpty()
                ? "(no textual diff available for this checkpoint)" : preview);
        area.setEditable(false);
        area.setFont(new java.awt.Font(java.awt.Font.MONOSPACED, java.awt.Font.PLAIN,
                area.getFont().getSize()));
        area.setCaretPosition(0);
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new java.awt.Dimension(680, 420));
        panel.add(scroll, BorderLayout.CENTER);

        com.intellij.openapi.ui.DialogBuilder b = new com.intellij.openapi.ui.DialogBuilder(project);
        b.setTitle("Restore preview — " + checkpointId);
        b.setCenterPanel(panel);
        b.addOkAction().setText("Restore"); // default OK action closes with OK_EXIT_CODE
        b.addCancelAction();
        return b.show() == com.intellij.openapi.ui.DialogWrapper.OK_EXIT_CODE;
    }

    /**
     * {@code /sessions} — pick a saved session ({@code cc session list --json}
     * merged with the shared IDE index), then choose resume / rename / delete
     * (mirrors the VS Code panel's two-step _pickSession). Resume stops the
     * live child; the next message respawns with {@code --resume <picked>}.
     */
    private void runSessions() {
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(SessionList.buildListArgs(30), cwd, 30000);
            final List<SessionList.SessionItem> list = SessionList.mergeSessionItems(
                    SessionList.parseSessionList(out),
                    IdeSessionIndex.sessionItems(IdeSessionIndex.defaultFile()));
            SwingUtilities.invokeLater(() -> {
                if (list.isEmpty()) {
                    append("ℹ no saved sessions found\n");
                    return;
                }
                java.util.List<String> labels = new java.util.ArrayList<>();
                for (SessionList.SessionItem s : list) labels.add(SessionList.itemLabel(s));
                JBPopupFactory.getInstance()
                        .createPopupChooserBuilder(labels)
                        .setTitle("Pick a session to resume, rename or delete")
                        .setItemChosenCallback(label -> {
                            int idx = labels.indexOf(label);
                            if (idx < 0) return;
                            showSessionActions(list.get(idx), cwd);
                        })
                        .createPopup()
                        .showCenteredInCurrentWindow(project);
            });
        });
    }

    /** Second step of {@code /sessions}: act on the chosen session. */
    private void showSessionActions(SessionList.SessionItem chosen, File cwd) {
        final String RESUME = "Resume in this tab";
        final String RENAME = "Rename…";
        final String DELETE = "Delete…";
        JBPopupFactory.getInstance()
                .createPopupChooserBuilder(java.util.Arrays.asList(RESUME, RENAME, DELETE))
                .setTitle(chosen.id)
                .setItemChosenCallback(action -> {
                    if (RESUME.equals(action)) {
                        restartForModeChange(); // stop the live child; next message respawns
                        conv.sessionId = chosen.id;
                        if (sessionIdSink != null) sessionIdSink.onSessionId(conv.id, chosen.id);
                        indexConversation("stopped");
                        append("ℹ will resume " + chosen.id
                                + " — send a message to continue it\n");
                    } else if (RENAME.equals(action)) {
                        renameSession(chosen);
                    } else if (DELETE.equals(action)) {
                        deleteSession(chosen, cwd);
                    }
                })
                .createPopup()
                .showCenteredInCurrentWindow(project);
    }

    /**
     * Rename a picked session. The title lives in the shared IDE index as an
     * overlay — the picker merge prefers it, so this also "renames" sessions
     * that only exist in the CLI store (which has no rename command).
     */
    private void renameSession(SessionList.SessionItem chosen) {
        String raw = com.intellij.openapi.ui.Messages.showInputDialog(
                project, "New title for " + chosen.id, "Rename Session", null,
                chosen.title, null);
        final String title = raw == null ? "" : raw.trim();
        if (title.isEmpty()) return;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            final boolean ok = IdeSessionIndex.renameDefault(chosen.id, title);
            SwingUtilities.invokeLater(() -> append(ok
                    ? "ℹ renamed " + chosen.id + " → \"" + title + "\"\n"
                    : "⚠ rename failed for " + chosen.id + "\n"));
        });
    }

    /**
     * Delete a picked session: {@code cc session delete --force} removes the
     * CLI transcript, and the shared IDE index entry is pruned so the other
     * IDE's picker stops offering it. A tab pointing at the id loses its
     * resume id (otherwise the next message would --resume a deleted session).
     */
    private void deleteSession(SessionList.SessionItem chosen, File cwd) {
        int r = com.intellij.openapi.ui.Messages.showYesNoDialog(project,
                "Delete session " + chosen.id
                        + "? Its saved transcript is removed. This cannot be undone.",
                "Delete Session", null);
        if (r != com.intellij.openapi.ui.Messages.YES) return;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(
                    SessionList.buildDeleteArgs(chosen.id), cwd, 30000);
            final boolean cliDeleted = out != null && !out.isEmpty();
            final boolean indexDeleted = IdeSessionIndex.removeDefault(chosen.id);
            SwingUtilities.invokeLater(() -> {
                if (chosen.id.equals(conv.sessionId)) {
                    conv.sessionId = null;
                    if (sessionIdSink != null) sessionIdSink.onSessionId(conv.id, null);
                }
                append(cliDeleted || indexDeleted
                        ? "ℹ deleted session " + chosen.id + "\n"
                        : "⚠ could not delete " + chosen.id
                                + " (not found in CLI store or IDE index)\n");
            });
        });
    }

    /**
     * {@code /handoff} — hand this tab's conversation off to a DETACHED
     * background agent ({@code cc agent --bg --resume <id>}), so it keeps
     * running without the IDE and can be continued from the web panel's
     * Background Agents view (browser/phone), {@code cc attach <id>}, or the
     * Background Agents dialog. The live panel child is stopped first — the
     * background worker becomes the session's single writer.
     */
    private void runHandoff() {
        if (conv.sessionId == null || conv.sessionId.isEmpty()) {
            append("ℹ nothing to hand off yet — send a message first\n");
            return;
        }
        String raw = com.intellij.openapi.ui.Messages.showInputDialog(
                project, "Task for the background agent to continue with",
                "Hand Off Session", null, "Continue the current task.", null);
        final String prompt = raw == null ? "" : raw.trim();
        if (prompt.isEmpty()) return;
        restartForModeChange(); // queues the live child's stop on sendExecutor
        final String sid = conv.sessionId;
        final File cwd = project.getBasePath() != null
                ? new File(project.getBasePath()) : null;
        append("ℹ handing off to a background agent…\n");
        // Queue the bg spawn on the SAME single-threaded sendExecutor, AFTER the
        // stop restartForModeChange just enqueued — otherwise the general pool
        // could launch `cc agent --bg --resume <sid>` while the panel child is
        // still alive, giving one session two writers.
        try {
            sendExecutor.execute(() -> {
                String out = AgentChatSession.runCapture(
                        RemoteHandoff.buildHandoffArgs(sid, prompt), cwd, 60000);
                final Map<String, Object> state = RemoteHandoff.parseBackgroundState(out);
                SwingUtilities.invokeLater(() -> {
                    if (state == null) {
                        append("⚠ handoff failed — the background launcher returned no state"
                                + " (is `cc` current?)\n");
                        return;
                    }
                    indexConversation("running"); // the session runs on — detached
                    append("ℹ " + RemoteHandoff.formatHandoffNote(state) + "\n");
                });
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            // executor already shut down (dispose in progress) — nothing to hand off
        }
    }

    /**
     * After a Configure-LLM / vision-model change, restart this tab's child so it
     * respawns with the new config. The provider/model are pinned at spawn time
     * (SessionArgs reads config.json once via {@code ensureSession}), so a child
     * started with the old/broken LLM config keeps erroring until it respawns —
     * the "配置完还没用 / 新开一个对话才行" symptom. Mirrors the VS Code panel reload.
     */
    private void reloadLlmConfig() {
        // The model (hence its context-window size) may have changed — drop the
        // cached window so the next indicator refresh re-probes the CLI.
        cachedContextWindow = 0;
        boolean restarted = liveSession() != null;
        restartForModeChange();
        append((restarted
                ? CcBundle.message("chat.llmUpdated.next")
                : CcBundle.message("chat.llmUpdated")) + "\n");
    }

    /**
     * Restart the child so the next message respawns with the current
     * mode/thinking (§6). The teardown runs on the single-threaded
     * {@link #sendExecutor}, NOT inline on the EDT: that serializes it with
     * ensureSession, so a mode change fired while a send is spawning can't be
     * lost (the spawn completes, then this stops it → the next message respawns
     * with the new mode). The caller has already updated conv.mode/thinking on
     * the EDT before invoking this, so the next spawn reads the new values.
     */
    void restartForModeChange() {
        conv.turnState = new ChatEvents.TurnState();
        indexConversation("stopped");
        try {
            sendExecutor.execute(() -> {
                AgentChatSession s = liveSession();
                if (s != null) {
                    s.stop();
                    conv.session = null;
                }
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            // executor already shut down (dispose in progress) — nothing to stop
        }
    }

    /**
     * Record this conversation's lifecycle status in the shared IDE index.
     * The write is a full read+parse+rewrite of the 200-record index file —
     * done synchronously it stalled the EDT several times per turn. The record
     * is snapshotted here (cheap, callers may be on the EDT or the stdout
     * pump) and flushed by the shared single-thread worker; latest-wins per
     * view, so a burst of status flips collapses into one file write. The
     * worker is application-level, so dispose()'s final "stopped" upsert still
     * flushes after the view is gone.
     */
    private void indexConversation(String status) {
        if (conv.sessionId == null || conv.sessionId.isEmpty()) return;
        String workspace = project.getBasePath() != null ? project.getBasePath() : "";
        List<String> folders = new ArrayList<String>();
        if (!workspace.isEmpty()) folders.add(workspace);
        Map<String, Object> record = IdeSessionIndex.record(
                conv.sessionId,
                conv.title,
                "jetbrains",
                conv.id,
                workspace,
                folders,
                status,
                conv.mode,
                Instant.now());
        // Slot already full → an unconsumed worker task will pick THIS newer
        // record up (invariant: non-null slot ⟹ one queued task not yet run).
        if (pendingIndexRecord.getAndSet(record) != null) return;
        try {
            INDEX_EXECUTOR.execute(() -> {
                Map<String, Object> r = pendingIndexRecord.getAndSet(null);
                if (r != null) IdeSessionIndex.upsertDefault(r);
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            // application shutdown — losing a display-status upsert is fine
        }
    }

    /** Lazy spawn: first message starts the child; mode/thinking changes restart it.
     *  Blocking (config reads + binary probe + process start) — call it from the
     *  {@link #sendExecutor} worker, never the EDT. */
    private void ensureSession() throws IOException {
        if (disposed) return; // never spawn a fresh child for a closed view
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
        // Declare the session id UP FRONT (VS Code twin fix): anonymous
        // stream sessions are persistence-free by CLI design, so a first
        // conversation spawned without an id was never written — an IDE
        // restart's --resume of the id captured from system/init then
        // silently started EMPTY, losing all pre-restart context. --resume
        // with a fresh id makes the CLI create + persist it.
        if (conv.sessionId == null || conv.sessionId.isEmpty()) {
            conv.sessionId = com.chainlesschain.ide.SessionArgs.newPanelSessionId();
            indexConversation("running");
            if (sessionIdSink != null) {
                final String cid = conv.id;
                final String sessId = conv.sessionId;
                SwingUtilities.invokeLater(() -> sessionIdSink.onSessionId(cid, sessId));
            }
        }
        o.extraArgs = SessionArgs.build(
                llm[0], llm[1], llm[2], llm[3], conv.sessionId, conv.mode, conv.thinking,
                conv.goalCondition);

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
        o.extraEnv.put("CC_TOOL_ADMISSION",
                com.chainlesschain.ide.IdeToolAdmission.environmentJson());
        // Lean chat context (Settings → ChainlessChain IDE, default on): inject
        // CC_PROJECT_MEMORY=lean so the agent's system prompt keeps only the entry
        // instruction file (cc.md/CLAUDE.md) and sheds CLAUDE.local.md / .claude/
        // rules / rules.md — a doc-heavy repo re-sends that block (~8k+ tokens)
        // EVERY turn. Env var, not a CLI flag, so an older `cc` degrades to full
        // memory instead of erroring on an unknown flag. Needs cc >= 0.162.165 to
        // actually shed. Terminal `cc` is untouched (scoped to this child).
        String leanEnv = com.chainlesschain.ide.ProjectMemory.leanContextEnvValue(
                CcSettings.getInstance().isLeanContextEnabled());
        if (leanEnv != null) o.extraEnv.put("CC_PROJECT_MEMORY", leanEnv);
        o.onEvent = event -> {
            if (event != null && "system".equals(event.get("type"))
                    && "init".equals(event.get("subtype"))) {
                Object sid = event.get("session_id");
                if (sid != null && !String.valueOf(sid).isEmpty()) {
                    conv.sessionId = String.valueOf(sid);
                    indexConversation("running");
                    if (sessionIdSink != null) {
                        // This callback runs on the stdout pump thread; the sink
                        // (persistSessionIds) walks Swing-owned tab state — hop to
                        // the EDT or a concurrent tab close CMEs and the resume id
                        // is silently dropped.
                        final String cid = conv.id;
                        final String sessId = conv.sessionId;
                        SwingUtilities.invokeLater(() -> sessionIdSink.onSessionId(cid, sessId));
                    }
                }
                Object resumed = event.get("resumed_messages");
                if (resumed instanceof Number && ((Number) resumed).intValue() > 0) {
                    final String note = "ℹ resumed previous conversation ("
                            + ((Number) resumed).intValue() + " messages)\n";
                    SwingUtilities.invokeLater(() -> append(note));
                }
            }
            if (event != null && "result".equals(event.get("type"))
                    && event.get("turn") instanceof Number) {
                planReviewTurn = Math.max(
                        planReviewTurn, ((Number) event.get("turn")).intValue());
            }
            final Map<String, Object> ui = ChatEvents.mapAgentEvent(event, turnState());
            if (ui == null) return;
            SwingUtilities.invokeLater(() -> render(ui));
        };
        o.onExit = code -> SwingUtilities.invokeLater(() ->
        {
            indexConversation("stopped");
            append("\n── agent exited (" + code + ") — next message restarts ──\n");
        });

        AgentChatSession session = new AgentChatSession(o);
        conv.session = session;
        session.start();
        indexConversation("running");
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
        } else if ("usage".equals(kind)) {
            // Live per-turn token tally (VS Code 0.37.2 parity): token_usage
            // fires once per LLM call; accumulate onto the status line. The
            // turn_end below overwrites with the authoritative total.
            if (turnTokens == null) turnTokens = new ChatEvents.TokenTally();
            Map<String, Object> callUsage = asMapOrNull(ui.get("usage"));
            turnTokens.add(callUsage);
            // The LAST call's usage is the live context size — feeds the local
            // (spawn-free) context indicator after the turn (VS Code parity).
            if (callUsage != null) lastCallUsage = callUsage;
            contextLabel.setText(" " + turnTokens.statusLine());
            contextLabel.setForeground(com.intellij.ui.JBColor.GRAY);
        } else if ("turn_end".equals(kind)) {
            indexConversation("completed");
            Object text = ui.get("text");
            // The final result text only arrives here when nothing streamed; run
            // it through the same markdown path. (When deltas streamed, text is
            // null and we just finalize the streamed run.)
            if (text != null) appendAssistantDelta(String.valueOf(text));
            transcript.finalizeAssistantRun();
            append("\n");
            // Authoritative turn total replaces the live tally until the async
            // context probe repaints the ⊟ indicator.
            turnTokens = null;
            interruptRequested = null; // turn is over — next Stop starts fresh
            Map<String, Object> usage = asMapOrNull(ui.get("usage"));
            if (usage != null) {
                contextLabel.setText(" " + ChatEvents.readyLine(usage));
                contextLabel.setForeground(com.intellij.ui.JBColor.GRAY);
            }
            deleteOldestSentImageBatch(); // THIS turn's images — CLI consumed them at its start
            refreshContextIndicator(); // §6: after each turn
        } else if ("plan".equals(kind)) {
            showPlanCard(ui); // §5 interactive plan card (items + Approve/Reject)
        } else if ("approval".equals(kind)) {
            indexConversation("waiting_approval");
            showApprovalCard(ui); // §5 interactive approval card (Approve/Deny)
        } else if ("approval_done".equals(kind)) {
            indexConversation("running");
            resolveApprovalCard(ui);
        } else if ("question".equals(kind)) {
            indexConversation("waiting_approval");
            if (Boolean.TRUE.equals(ui.get("elicitation"))) askElicitation(ui);
            else askQuestion(ui); // ask_user_question round-trip → dialog → {type:answer}
        } else if ("info".equals(kind) || "error".equals(kind)) {
            if ("error".equals(kind)) indexConversation("errored");
            Object text = ui.get("text");
            String body = String.valueOf(text != null ? text : kind);
            append(("error".equals(kind) ? "⚠ " : "ℹ ") + body + "\n");
            // Nudge toward the LLM wizard when the failure looks like a
            // missing/expired key or wrong provider (401/403/api key…).
            if ("error".equals(kind) && LlmConfig.looksLikeLlmConfigError(body)) {
                appendThinking(CcBundle.message("chat.hint.llmError") + "\n");
            }
        }
    }

    // ---- §5 interactive cards ------------------------------------------

    // Theme-aware amber: darker for light UIs, brighter for Darcula.
    private static final Color WARN = new com.intellij.ui.JBColor(
            new Color(0xCC, 0x88, 0x00), new Color(0xE0, 0xA5, 0x2E));

    /** ask_user_question round-trip: the agent is BLOCKED on the user. Pop a
     *  dialog (single-choice / multi-choice / free-text) and reply
     *  {type:"answer",id,answer}. Cancel → null answer (CLI maps to user_timeout,
     *  the model proceeds). Runs on the EDT (render() is invoked via invokeLater),
     *  and the modal dialog spins its own event loop so nothing deadlocks. */
    private void askQuestion(Map<String, Object> ui) {
        String id = ui.get("id") == null ? "" : String.valueOf(ui.get("id"));
        if (id.isEmpty()) return;
        String question = ui.get("question") == null || String.valueOf(ui.get("question")).isEmpty()
                ? CcBundle.message("chat.question.title") : String.valueOf(ui.get("question"));
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
        queueSessionEvent(ev);
    }

    /**
     * MCP elicitation round-trip: render the restricted MCP form vocabulary as
     * a native form and validate/coerce it with the shared conformance model.
     * Unsupported (for example nested) schemas stay on an explicit raw-JSON
     * fallback instead of being silently flattened.
     */
    @SuppressWarnings("unchecked")
    private void askElicitation(Map<String, Object> ui) {
        String id = ui.get("id") == null ? "" : String.valueOf(ui.get("id"));
        if (id.isEmpty()) return;
        String question = ui.get("question") == null ? CcBundle.message("chat.question.title") : String.valueOf(ui.get("question"));
        Object schemaO = ui.get("requestedSchema");
        ElicitationSchema.Model model = ElicitationSchema.compile(schemaO);
        String title = String.valueOf(ui.get("server") == null
                ? "MCP elicitation" : "MCP: " + ui.get("server"));
        if (!model.supported) {
            Object answer = askRawElicitation(question, title);
            sendElicitationAnswer(id, answer);
            return;
        }

        JPanel panel = new JPanel();
        panel.setLayout(new BoxLayout(panel, BoxLayout.Y_AXIS));
        panel.add(new JLabel("<html>" + question + "</html>"));
        if (model.fields.isEmpty()) {
            panel.add(new JLabel("No fields are required."));
        }
        Map<String, java.util.function.Supplier<Object>> readers =
                new LinkedHashMap<>();
        Map<String, Object> initial = ElicitationSchema.initialValues(model);
        for (ElicitationSchema.Field field : model.fields) {
            JPanel row = new JPanel(new java.awt.BorderLayout(8, 0));
            JPanel caption = new JPanel();
            caption.setLayout(new BoxLayout(caption, BoxLayout.Y_AXIS));
            caption.add(new JLabel(field.title + (field.required ? " *" : "")));
            if (!field.description.isEmpty()) {
                JLabel description = new JLabel(field.description);
                description.setForeground(java.awt.Color.GRAY);
                caption.add(description);
            }
            row.add(caption, java.awt.BorderLayout.WEST);
            javax.swing.JComponent component;
            if (field.kind == ElicitationSchema.Kind.SINGLE_SELECT) {
                javax.swing.JComboBox<ElicitationSchema.Option> combo =
                        new javax.swing.JComboBox<>();
                if (!field.required && !field.hasDefault) {
                    combo.addItem(new ElicitationSchema.Option("", "—"));
                }
                for (ElicitationSchema.Option option : field.options) {
                    combo.addItem(option);
                    if (option.value.equals(initial.get(field.name))) {
                        combo.setSelectedItem(option);
                    }
                }
                component = combo;
                readers.put(field.name, () -> {
                    Object selected = combo.getSelectedItem();
                    return selected instanceof ElicitationSchema.Option
                            ? ((ElicitationSchema.Option) selected).value : "";
                });
            } else if (field.kind == ElicitationSchema.Kind.MULTI_SELECT) {
                JPanel choices = new JPanel();
                choices.setLayout(new BoxLayout(choices, BoxLayout.Y_AXIS));
                List<javax.swing.JCheckBox> boxes = new ArrayList<>();
                java.util.Set<?> selected = initial.get(field.name) instanceof List
                        ? new java.util.HashSet<>((List<?>) initial.get(field.name))
                        : java.util.Set.of();
                for (ElicitationSchema.Option option : field.options) {
                    javax.swing.JCheckBox box =
                            new javax.swing.JCheckBox(option.label);
                    box.setSelected(selected.contains(option.value));
                    box.putClientProperty("elicitationValue", option.value);
                    boxes.add(box);
                    choices.add(box);
                }
                component = choices;
                readers.put(field.name, () -> {
                    List<String> values = new ArrayList<>();
                    for (javax.swing.JCheckBox box : boxes) {
                        if (box.isSelected()) {
                            values.add(String.valueOf(
                                    box.getClientProperty("elicitationValue")));
                        }
                    }
                    return values;
                });
            } else if (field.kind == ElicitationSchema.Kind.BOOLEAN) {
                javax.swing.JCheckBox checkbox = new javax.swing.JCheckBox();
                checkbox.setSelected(Boolean.TRUE.equals(initial.get(field.name)));
                component = checkbox;
                readers.put(field.name, checkbox::isSelected);
            } else {
                javax.swing.JTextField input = new javax.swing.JTextField();
                if (initial.get(field.name) != null) {
                    input.setText(String.valueOf(initial.get(field.name)));
                }
                if (field.minimum != null) {
                    input.setToolTipText("Minimum: " + field.minimum);
                }
                if (field.maximum != null) {
                    input.setToolTipText("Maximum: " + field.maximum);
                }
                component = input;
                readers.put(field.name, input::getText);
            }
            row.add(component, java.awt.BorderLayout.CENTER);
            panel.add(row);
        }

        Object answer = null;
        while (true) {
            com.intellij.openapi.ui.DialogBuilder builder =
                    new com.intellij.openapi.ui.DialogBuilder(project);
            builder.setTitle(title);
            builder.setCenterPanel(panel);
            builder.addOkAction();
            builder.addCancelAction();
            if (builder.show()
                    != com.intellij.openapi.ui.DialogWrapper.OK_EXIT_CODE) {
                break;
            }
            Map<String, Object> raw = new LinkedHashMap<>();
            for (Map.Entry<String, java.util.function.Supplier<Object>> entry
                    : readers.entrySet()) {
                raw.put(entry.getKey(), entry.getValue().get());
            }
            ElicitationSchema.Submission submission =
                    ElicitationSchema.prepare(model, raw);
            if (submission.valid) {
                answer = submission.value;
                break;
            }
            StringBuilder problem = new StringBuilder();
            for (ElicitationSchema.Issue issue : submission.errors) {
                if (problem.length() > 0) problem.append("\n");
                problem.append("• ").append(issue.message);
            }
            com.intellij.openapi.ui.Messages.showErrorDialog(
                    project, problem.toString(), "Invalid MCP input");
        }
        sendElicitationAnswer(id, answer);
    }

    private Object askRawElicitation(String question, String title) {
        while (true) {
            String raw = com.intellij.openapi.ui.Messages.showInputDialog(
                    project,
                    question + "\nEnter a JSON object (unsupported schema fallback).",
                    title,
                    null);
            if (raw == null) return null;
            try {
                Object parsed = com.chainlesschain.ide.MiniJson.parse(raw);
                if (parsed instanceof Map) return parsed;
            } catch (IllegalArgumentException ignored) {
                // The error dialog below gives the user another attempt.
            }
            com.intellij.openapi.ui.Messages.showErrorDialog(
                    project, "Enter a valid JSON object.", "Invalid MCP input");
        }
    }

    private void sendElicitationAnswer(String id, Object answer) {
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "answer");
        ev.put("id", id);
        ev.put("answer", answer);
        queueSessionEvent(ev);
    }

    /**
     * Deliver one protocol event to the live child on the send worker, never
     * the EDT — sendEvent does a blocking pipe write+flush under the session
     * monitor, and a wedged child that stopped reading stdin would freeze the
     * whole IDE. The send worker (bound 1) keeps replies ordered with sends,
     * so an approval/answer can never overtake the turn it belongs to.
     */
    private void queueSessionEvent(Map<String, Object> ev) {
        try {
            sendExecutor.execute(() -> {
                if (disposed) return;
                AgentChatSession s = liveSession();
                if (s != null) s.sendEvent(ev);
            });
        } catch (java.util.concurrent.RejectedExecutionException ignored) {
            // executor already shut down (dispose in progress) — child is gone too
        }
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
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("type", "approval");
        ev.put("id", id);
        ev.put("approve", approve);
        queueSessionEvent(ev); // blocking stdin write — never on the EDT
        indexConversation("running");
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
        currentPlanUi = ui;
        planReviewLastPlan = ui;
        boolean terminalState = "rejected".equals(state)
                || "completed".equals(state) || "failed".equals(state);
        // Terminal states clear the card and leave a transcript note.
        if (!active || terminalState) {
            if (!restoringPlanReview) {
                String merged = PlanReview.mergeProgress(readPlanReviewText(), ui);
                replacePlanReviewText(merged);
                Map<String, Object> previous = PlanReview.findPersistedState(
                        readPersistedPlanReviewStates(), conv.sessionId, conv.id);
                String terminalStatus = terminalState ? state
                        : previous != null
                                && "reject".equals(String.valueOf(previous.get("action")))
                                ? "rejected" : "ended";
                persistPlanReviewState(merged, ui, terminalStatus,
                        previous == null ? state : String.valueOf(previous.get("action")));
            }
            removePlanCard();
            append("📋 plan " + (state == null ? "ended" : state) + "\n");
            return;
        }
        syncPlanReviewEditor(ui);
        if (!restoringPlanReview) {
            persistPlanReviewState(readPlanReviewText(), ui,
                    "approved".equals(state) || "executing".equals(state)
                            ? "executing" : "draft",
                    "");
        }
        removePlanCard();
        List<Object> items = ui.get("items") instanceof List
                ? (List<Object>) ui.get("items") : java.util.Collections.emptyList();

        StringBuilder sb = new StringBuilder("<b>Plan</b>");
        if (ui.get("risk") != null) sb.append("  [risk: ").append(ui.get("risk")).append("]");
        sb.append("<br>");
        int n = 1;
        for (Object it : items) {
            if (it instanceof Map) {
                Map<String, Object> item = (Map<String, Object>) it;
                String title = item.get("title") == null
                        ? String.valueOf(it) : String.valueOf(item.get("title"));
                String tool = item.get("tool") == null ? "" : String.valueOf(item.get("tool"));
                String itemState = item.get("status") == null
                        ? "pending" : String.valueOf(item.get("status"));
                sb.append(n++).append(". ");
                if (!tool.isEmpty()) sb.append(escapeHtml(tool)).append(": ");
                sb.append(escapeHtml(title)).append(" [")
                        .append(escapeHtml(itemState)).append("]<br>");
            } else {
                sb.append(n++).append(". ").append(escapeHtml(String.valueOf(it))).append("<br>");
            }
        }

        JPanel card = new JPanel(new BorderLayout(4, 4));
        card.setBorder(BorderFactory.createLineBorder(WARN));
        card.add(htmlLabel(sb.toString()), BorderLayout.CENTER);
        JPanel btns = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 2));
        JButton changes = new JButton("Request changes");
        JButton regen = new JButton("Regenerate");
        JButton ok = new JButton("Approve");
        JButton no = new JButton("Reject");
        changes.addActionListener(e -> requestPlanRevision("requestChanges"));
        regen.addActionListener(e -> requestPlanRevision("regenerate"));
        ok.addActionListener(e -> respondPlan("approve"));
        no.addActionListener(e -> respondPlan("reject"));
        btns.add(changes);
        btns.add(regen);
        btns.add(ok);
        btns.add(no);
        card.add(btns, BorderLayout.SOUTH);

        planCard = card;
        cardsPanel.add(card);
        cardsPanel.revalidate();
        cardsPanel.repaint();
    }

    private void respondPlan(String action) {
        Map<String, Object> persisted = persistPlanReviewState(
                readPlanReviewText(), currentPlanUi,
                "decision_submitted", action);
        Map<String, Object> review = PlanReview.reviewRecord(
                action,
                readPlanReviewText(),
                conv.id,
                conv.title,
                conv.sessionId,
                currentPlanUi,
                planReviewTurn,
                conv.mode,
                Instant.now());
        if (persisted != null) review.put("revision", persisted.get("revision"));
        sendPlanAction(action, review);
        indexConversation("reject".equals(action) ? "stopped" : "running");
        removePlanCard();
        String label = "reject".equals(action) ? "rejected" : action + "d";
        append("📋 plan " + label + "\n");
    }

    private void requestPlanRevision(String action) {
        Map<String, Object> persisted = persistPlanReviewState(
                readPlanReviewText(), currentPlanUi,
                "changes_requested", action);
        Map<String, Object> review = PlanReview.reviewRecord(
                action,
                readPlanReviewText(),
                conv.id,
                conv.title,
                conv.sessionId,
                currentPlanUi,
                planReviewTurn,
                conv.mode,
                Instant.now());
        if (persisted != null) review.put("revision", persisted.get("revision"));
        planReviewRevisionBase = PlanReview.sanitizePlanSnapshot(currentPlanUi);
        sendPlanAction("requestChanges".equals(action) ? "revise" : "regenerate", review);
        append("regenerate".equals(action)
                ? "requested a regenerated plan\n" : "plan review comments sent\n");
    }

    /** Send a plan control ({type:plan,action}); entering plan may need to spawn
     *  the child, so the whole thing runs on the send worker, never the EDT. */
    private void sendPlanAction(String action) {
        sendPlanAction(action, null);
    }

    private void sendPlanAction(String action, Map<String, Object> review) {
        sendExecutor.execute(() -> {
            if (disposed) return;
            AgentChatSession s = liveSession();
            if (s == null || !s.isRunning()) {
                try {
                    ensureSession();
                } catch (IOException ex) {
                    final String msg = ex.getMessage();
                    SwingUtilities.invokeLater(() ->
                            append("⚠ could not start agent for plan control: " + msg + "\n"));
                    return;
                }
                s = liveSession();
            }
            if (s != null) {
                s.sendEvent(PlanReview.planEvent(action, review));
            }
        });
        indexConversation("running");
    }

    private void syncPlanReviewEditor(Map<String, Object> plan) {
        Map<String, Object> previousPlan = planReviewLastPlan;
        if (planReviewRevisionBase == null && previousPlan != null
                && plan.get("previous_plan_id") != null) {
            Object previousId = previousPlan.get("plan_id") != null
                    ? previousPlan.get("plan_id") : previousPlan.get("planId");
            if (String.valueOf(plan.get("previous_plan_id")).equals(String.valueOf(previousId))) {
                planReviewRevisionBase = PlanReview.sanitizePlanSnapshot(previousPlan);
            }
        }
        String nextGenerated = PlanReview.markdown(
                plan, conv.title, conv.sessionId, Instant.now());
        if (planReviewRevisionBase != null) {
            nextGenerated = PlanReview.mergeRevisionDiff(
                    nextGenerated, planReviewRevisionBase, plan);
        }
        final String generated = nextGenerated;
        try {
            if (planReviewVirtualFile == null) {
                String text = planReviewLastText != null ? planReviewLastText : generated;
                if (planReviewFile == null) {
                    planReviewFile = Files.createTempFile(
                            "chainlesschain-plan-" + conv.id + "-", ".md").toFile();
                    planReviewFile.deleteOnExit();
                }
                Files.write(planReviewFile.toPath(), text.getBytes(StandardCharsets.UTF_8));
                planReviewVirtualFile =
                        LocalFileSystem.getInstance().refreshAndFindFileByIoFile(planReviewFile);
                if (planReviewVirtualFile != null) {
                    FileEditorManager.getInstance(project).openFile(planReviewVirtualFile, true);
                }
                planReviewLastText = text;
                planReviewLastPlan = plan;
                append("opened plan review editor tab\n");
                return;
            }

            String current = readPlanReviewText();
            if (planReviewLastText != null && !current.equals(planReviewLastText)) {
                // Preserve inline reviewer edits; do not overwrite a dirty review.
                planReviewHasReviewerEdits = true;
            }
            if (planReviewHasReviewerEdits) {
                String merged = PlanReview.mergeProgress(current, plan);
                if (planReviewRevisionBase != null) {
                    merged = PlanReview.mergeRevisionDiff(
                            merged, planReviewRevisionBase, plan);
                }
                replacePlanReviewText(merged);
                planReviewLastText = merged;
                planReviewLastPlan = plan;
                String state = String.valueOf(plan.get("state"));
                persistPlanReviewState(merged, plan,
                        "approved".equals(state) || "executing".equals(state)
                                ? "executing" : "draft",
                        "");
                return;
            }
            if (!generated.equals(planReviewLastText)) {
                Document doc = FileDocumentManager.getInstance().getDocument(planReviewVirtualFile);
                if (doc != null) {
                    ApplicationManager.getApplication().runWriteAction(() -> doc.setText(generated));
                } else if (planReviewFile != null) {
                    Files.write(planReviewFile.toPath(), generated.getBytes(StandardCharsets.UTF_8));
                    LocalFileSystem.getInstance().refreshAndFindFileByIoFile(planReviewFile);
                }
                planReviewLastText = generated;
            }
            planReviewLastPlan = plan;
        } catch (Exception e) {
            append("warning: could not open plan review editor: " + e.getMessage() + "\n");
        }
    }

    private void replacePlanReviewText(String text) {
        try {
            if (planReviewVirtualFile != null) {
                Document doc = FileDocumentManager.getInstance().getDocument(planReviewVirtualFile);
                if (doc != null) {
                    if (!doc.getText().equals(text)) {
                        ApplicationManager.getApplication().runWriteAction(() -> doc.setText(text));
                    }
                    return;
                }
            }
            if (planReviewFile != null && planReviewFile.isFile()) {
                Files.write(planReviewFile.toPath(), text.getBytes(StandardCharsets.UTF_8));
                LocalFileSystem.getInstance().refreshAndFindFileByIoFile(planReviewFile);
            }
        } catch (Exception e) {
            append("warning: could not update plan review progress: " + e.getMessage() + "\n");
        }
    }

    private String readPlanReviewText() {
        try {
            if (planReviewVirtualFile != null) {
                Document doc = FileDocumentManager.getInstance().getDocument(planReviewVirtualFile);
                if (doc != null) return doc.getText();
            }
            if (planReviewFile != null && planReviewFile.isFile()) {
                return new String(Files.readAllBytes(planReviewFile.toPath()), StandardCharsets.UTF_8);
            }
        } catch (Exception ignored) {
            // fall through to regenerated markdown
        }
        return PlanReview.markdown(
                currentPlanUi != null ? currentPlanUi : planReviewLastPlan,
                conv.title,
                conv.sessionId,
                Instant.now());
    }

    private Object readPersistedPlanReviewStates() {
        String raw = PropertiesComponent.getInstance(project).getValue(PLAN_REVIEW_STATES_KEY);
        if (raw == null || raw.trim().isEmpty()) return java.util.Collections.emptyList();
        try {
            Object parsed = com.chainlesschain.ide.MiniJson.parse(raw);
            return parsed instanceof List ? parsed : java.util.Collections.emptyList();
        } catch (Exception ignored) {
            return java.util.Collections.emptyList();
        }
    }

    private Map<String, Object> persistPlanReviewState(
            String documentText, Map<String, Object> plan, String status, String action) {
        if (plan == null) return null;
        Object states = readPersistedPlanReviewStates();
        Map<String, Object> previous = PlanReview.findPersistedState(
                states, conv.sessionId, conv.id);
        Map<String, Object> next = PlanReview.persistedState(
                documentText, conv.id, conv.title, conv.sessionId, plan,
                status, action, previous, planReviewTurn, Instant.now());
        if (next == null) return null;
        PropertiesComponent.getInstance(project).setValue(
                PLAN_REVIEW_STATES_KEY,
                com.chainlesschain.ide.MiniJson.stringify(
                        PlanReview.upsertPersistedState(states, next)));
        return next;
    }

    @SuppressWarnings("unchecked")
    private void restorePlanReviewState() {
        Map<String, Object> state = PlanReview.findPersistedState(
                readPersistedPlanReviewStates(), conv.sessionId, conv.id);
        if (state == null || !(state.get("plan") instanceof Map)) return;
        String status = String.valueOf(state.get("status"));
        boolean terminal = "approved".equals(status) || "rejected".equals(status)
                || "completed".equals(status) || "failed".equals(status)
                || "ended".equals(status);
        Map<String, Object> plan = new LinkedHashMap<String, Object>(
                (Map<String, Object>) state.get("plan"));
        if (terminal) {
            plan.put("active", false);
            plan.put("state", status);
            currentPlanUi = plan;
            planReviewLastPlan = plan;
            return;
        }
        if (!Boolean.TRUE.equals(plan.get("active"))) return;
        plan.put("persistedRevision", state.get("revision"));
        currentPlanUi = plan;
        planReviewLastPlan = plan;
        planReviewLastText = String.valueOf(state.get("snapshot"));
        planReviewHasReviewerEdits = state.get("comments") instanceof List
                && !((List<?>) state.get("comments")).isEmpty();
        if (state.get("comments") instanceof List) {
            for (Object raw : (List<?>) state.get("comments")) {
                if (raw instanceof Map && ((Map<?, ?>) raw).get("turn") instanceof Number) {
                    planReviewTurn = Math.max(planReviewTurn,
                            ((Number) ((Map<?, ?>) raw).get("turn")).intValue());
                }
            }
        }
        restoringPlanReview = true;
        try {
            showPlanCard(plan);
        } finally {
            restoringPlanReview = false;
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

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMapOrNull(Object v) {
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /** Delete one FIFO batch of temp paths (self-created images; user-dropped
     *  real files are never in these lists). Best-effort. */
    private static void deleteImageBatch(java.util.List<String> batch) {
        if (batch == null) return;
        for (String p : batch) {
            try {
                java.nio.file.Files.deleteIfExists(java.nio.file.Paths.get(p));
            } catch (Exception ignored) {
                // still open on Windows → deleteOnExit backstop gets it
            }
        }
    }

    /** Delete the OLDEST sent-image batch (the just-completed turn's images —
     *  the CLI inlined them at that turn's start). Leaves later, not-yet-started
     *  messages' images intact. */
    private void deleteOldestSentImageBatch() {
        deleteImageBatch(sentImageBatches.pollFirst());
    }

    /** Delete every remaining sent-image batch (on dispose). */
    private void deleteAllSentImageTemps() {
        java.util.List<String> batch;
        while ((batch = sentImageBatches.pollFirst()) != null) {
            deleteImageBatch(batch);
        }
    }

    private static JLabel htmlLabel(String text) {
        return new JLabel("<html>" + text.replace("\n", "<br>") + "</html>");
    }

    private static String escapeHtml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    /**
     * §6 persistent context-window indicator. Preferred path (VS Code parity):
     * derive it LOCALLY from the last LLM call's {@code token_usage} + the
     * model's window size learned from ONE {@code cc context --json} probe —
     * the old per-turn probe cold-spawned the CLI after EVERY turn (seconds on
     * Windows). The CLI probe remains the authoritative fallback and fills the
     * window cache. Runs off the EDT; silently no-ops on any failure.
     */
    private void refreshContextIndicator() {
        if (!CcSettings.getInstance().isContextIndicatorEnabled()) {
            SwingUtilities.invokeLater(() -> contextLabel.setText(""));
            return;
        }
        final String sid = conv.sessionId;
        if (sid == null || sid.isEmpty()) return;
        // Local, spawn-free path (called from render() on the EDT — lastCallUsage
        // is EDT-owned): last call's usage IS the live context size.
        IntrospectArgs.ContextStatus local =
                ContextStatus.fromUsage(lastCallUsage, cachedContextWindow);
        if (local != null) {
            paintContextStatus(local);
            return;
        }
        final File cwd = project.getBasePath() != null ? new File(project.getBasePath()) : null;
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            try {
                List<String> args = IntrospectArgs.build("context", sid, null, null, true);
                String json = AgentChatSession.runCapture(args, cwd, 8000);
                final IntrospectArgs.ContextStatus st = IntrospectArgs.parseContextStatus(json);
                if (st == null) return;
                // Remember the window so later turns derive the status locally.
                cachedContextWindow = st.window;
                SwingUtilities.invokeLater(() -> paintContextStatus(st));
            } catch (Throwable ignored) {
                // best-effort — context line is non-essential
            }
        });
    }

    /** Paint the ⊟ status line (EDT only). */
    private void paintContextStatus(IntrospectArgs.ContextStatus st) {
        contextLabel.setText(" ⊟ context " + human(st.total) + " / "
                + human(st.window) + " (" + st.pct + "%)");
        // JBColor: theme-aware red/gray so the dimmed status line
        // stays readable under Darcula (plain AWT RED is glaring).
        contextLabel.setForeground(st.overflow
                ? com.intellij.ui.JBColor.RED : com.intellij.ui.JBColor.GRAY);
    }

    /** Compact token count: 12345 → "12.3k", 1500000 → "1.5M". */
    private static String human(long n) {
        if (n < 1000) return String.valueOf(n);
        if (n < 1_000_000) return String.format("%.1fk", n / 1000.0);
        return String.format("%.1fM", n / 1_000_000.0);
    }

    // Transcript delegates — rendering/styling/markdown-snap live in ChatTranscript.
    private void append(String s) {
        transcript.append(s);
    }

    private void appendAssistantDelta(String s) {
        transcript.appendAssistantDelta(s);
    }

    private void appendThinking(String s) {
        transcript.appendThinking(s);
    }

    void appendInfo(String s) {
        SwingUtilities.invokeLater(() -> append(s));
    }

    void clearTranscript() {
        transcript.clear();
        images.clearAll();
    }

    void dispose() {
        disposed = true; // gates ensureSession + every queued task body
        if (currentPlanUi != null && Boolean.TRUE.equals(currentPlanUi.get("active"))) {
            Map<String, Object> previous = PlanReview.findPersistedState(
                    readPersistedPlanReviewStates(), conv.sessionId, conv.id);
            boolean submitted = previous != null
                    && "decision_submitted".equals(String.valueOf(previous.get("status")));
            String planState = String.valueOf(currentPlanUi.get("state"));
            boolean executing = "approved".equals(planState)
                    || "executing".equals(planState);
            boolean terminal = "completed".equals(planState)
                    || "failed".equals(planState) || "rejected".equals(planState);
            String persistStatus = terminal ? planState
                    : submitted ? "decision_submitted" : executing ? "executing" : "draft";
            String persistAction = terminal
                    ? previous == null ? planState : String.valueOf(previous.get("action"))
                    : submitted ? String.valueOf(previous.get("action")) : "";
            persistPlanReviewState(
                    readPlanReviewText(), currentPlanUi,
                    persistStatus, persistAction);
        }
        if (loopTask != null) loopTask.cancel(false);
        loopTask = null;
        sendExecutor.shutdown(); // pending sends may still finish; no new ones
        indexConversation("stopped"); // queued — INDEX_EXECUTOR outlives the view
        AgentChatSession s = liveSession();
        conv.session = null;
        if (s != null) {
            // stop() is synchronized and closes stdin (blocking pipe I/O). A
            // sendExecutor worker blocked in sendEvent() holds the session
            // monitor — stopping inline would deadlock the EDT on tab/project
            // close. Mirror the force-stop path: pooled thread.
            ApplicationManager.getApplication().executeOnPooledThread(s::stop);
        }
        deleteAllSentImageTemps();
        images.clearAll(); // also delete pending-but-unsent own temp pngs
        if (planReviewFile != null) {
            // deleteOnExit() alone leaked one plan-*.md per conversation for the
            // whole IDE lifetime — delete it now that the tab is gone.
            try {
                Files.deleteIfExists(planReviewFile.toPath());
            } catch (Exception ignored) {
                // deleteOnExit remains the backstop
            }
            planReviewFile = null;
        }
    }
}
