package com.chainlesschain.ide.modelinputtest;

import com.intellij.openapi.actionSystem.*;
import com.intellij.openapi.application.*;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import com.intellij.openapi.wm.ToolWindowManager;
import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.MiniJson;
import com.chainlesschain.ide.SessionModelInputs;
import com.chainlesschain.ide.intellij.CcSettings;
import javax.swing.*;
import java.awt.*;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Test-only plugin: actual registered action, canonical CLI and native Swing. */
public final class ModelInputProbe implements StartupActivity.DumbAware {
    private static final AtomicBoolean STARTED = new AtomicBoolean();
    private final Path root = Path.of(System.getProperty("cc.modelInputs.testRoot"));
    private Project project;
    private javax.swing.Timer poll;
    private int ticks;
    private Window visibleWindow;
    private int stablePaintTicks;
    private boolean capturing;

    @Override public void runActivity(Project project) {
        if (!STARTED.compareAndSet(false, true)) return;
        this.project = project;
        ApplicationManager.getApplication().invokeLater(() -> {
            try {
                if (GraphicsEnvironment.isHeadless()) throw new AssertionError("A native GUI is required");
                progress("startup");
                CcSettings settings = CcSettings.getInstance();
                settings.getState().managedCliEnabled = false;
                settings.setCcPath(root.resolve("cc-canonical.cmd").toString());
                var tool = ToolWindowManager.getInstance(project).getToolWindow("ChainlessChain");
                if (tool == null) throw new AssertionError("Production chat tool window is registered");
                tool.show(() -> {
                    try { selectAndQuery(); } catch (Throwable error) { finish(null, error); }
                });
            } catch (Throwable error) { finish(null, error); }
        });
    }
    private void selectAndQuery() throws Exception {
        progress("select-session");
        Class<?> factory = Class.forName("com.chainlesschain.ide.intellij.ChatToolWindowFactory");
        Field registry = factory.getDeclaredField("REGISTRY");
        registry.setAccessible(true);
        Object panel = ((Map<?, ?>) registry.get(null)).get(project);
        if (panel == null) throw new AssertionError("Production chat panel was created");
        Method resume = panel.getClass().getDeclaredMethod("resumeSession", String.class);
        resume.setAccessible(true);
        resume.invoke(panel, Files.readString(root.resolve("session-id.txt")).trim());
        Method active = factory.getDeclaredMethod("activeSessionIdOrNullFor", Project.class);
        active.setAccessible(true);
        if (!Files.readString(root.resolve("session-id.txt")).trim().equals(active.invoke(null, project)))
            throw new AssertionError("Actual current conversation owns the fixture session");
        AnAction action = ActionManager.getInstance().getAction("chainlesschain.session.ModelInputs");
        if (action == null) throw new AssertionError("Production model-input action is registered");
        if (!action.getClass().getName().equals("com.chainlesschain.ide.intellij.ModelInputDiagnosticsAction"))
            throw new AssertionError("Actual production action class is used");
        poll = new javax.swing.Timer(100, event -> observe());
        poll.start();
        progress("action-start");
        DataContext data = key -> CommonDataKeys.PROJECT.getName().equals(key) ? project : null;
        action.actionPerformed(AnActionEvent.createFromAnAction(action, null, "ModelInputNativeTest", data));
    }
    private void observe() {
        if (capturing) return;
        try {
            for (Window window : Window.getWindows()) {
                JTextArea text = find(window);
                if (text == null || !window.isShowing()) continue;
                String expected = Files.readString(root.resolve("expected-report.json"));
                String actual = text.getText();
                String id = Files.readString(root.resolve("session-id.txt")).trim();
                if (!actual.equals(SessionModelInputs.parse(expected, id).describe()))
                    throw new AssertionError("Native text equals the actual canonical CLI contract");
                if (text.isEditable() || actual.contains("PRIVATE-") || !actual.contains("sourceMapping")
                        || !actual.contains("body-prepared") || !actual.contains("sourceCount"))
                    throw new AssertionError("Readonly source details are visible without source text");
                String before = Files.readString(root.resolve("journal-before.sha256")).trim();
                String after = digest(Files.readAllBytes(Path.of(System.getenv("CHAINLESSCHAIN_HOME"), "sessions", id + ".jsonl")));
                if (!before.equals(after)) throw new AssertionError("The canonical journal was not changed");
                if (visibleWindow != window) {
                    visibleWindow = window;
                    stablePaintTicks = 0;
                    text.setCaretPosition(Math.max(0, actual.indexOf("sourceMapping")));
                    window.toFront();
                    window.repaint();
                    return;
                }
                if (++stablePaintTicks < 3) return;
                Rectangle bounds = window.getBounds();
                if (bounds.width < 100 || bounds.height < 100) throw new AssertionError("Real dialog bounds");
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("schema", "chainlesschain.jetbrains-model-input-native/v1");
                result.put("status", "passed");
                result.put("scope", "registered-production-action-real-canonical-cli-and-native-swing-dialog");
                result.put("realCanonicalSessionCliRead", true);
                result.put("realCanonicalSessionJourney", false);
                result.put("selectionSeam", "test-plugin-calls-production-chat-panel-resumeSession");
                result.put("fixtureConversation", false);
                result.put("providerTaskExecutedOutsideIde", true);
                result.put("modelInvoked", false);
                result.put("signedProjectionVerified", false);
                result.put("ideVersion", ApplicationInfo.getInstance().getFullVersion());
                result.put("ideBuild", ApplicationInfo.getInstance().getBuild().asString());
                result.put("java", System.getProperty("java.version"));
                result.put("pid", ProcessHandle.current().pid());
                result.put("headless", GraphicsEnvironment.isHeadless());
                result.put("readonly", !text.isEditable());
                result.put("sourceMappingsMatchCanonicalCli", true);
                result.put("documentBytes", actual.getBytes(StandardCharsets.UTF_8).length);
                result.put("documentDigest", digest(actual.getBytes(StandardCharsets.UTF_8)));
                result.put("journalDigestBefore", before);
                result.put("journalDigestAfter", after);
                result.put("accessibleName", text.getAccessibleContext().getAccessibleName());
                capturing = true;
                poll.stop();
                text.paintImmediately(text.getVisibleRect());
                new Thread(() -> {
                    try {
                        Robot robot = new Robot();
                        robot.keyPress(java.awt.event.KeyEvent.VK_ALT);
                        robot.keyRelease(java.awt.event.KeyEvent.VK_ALT);
                        SwingUtilities.invokeAndWait(() -> { window.setAlwaysOnTop(true); window.toFront(); window.requestFocus(); });
                        robot.waitForIdle();
                        robot.delay(750);
                        var image = robot.createScreenCapture(bounds);
                        Set<Integer> colors = new HashSet<>();
                        for (int y = 60; y < image.getHeight() - 20 && colors.size() <= 32; y += 2)
                            for (int x = 20; x < image.getWidth() - 30 && colors.size() <= 32; x += 2)
                                colors.add(image.getRGB(x, y));
                        if (colors.size() <= 16) throw new AssertionError("Native dialog content was not painted");
                        javax.imageio.ImageIO.write(image, "png", root.resolve("dialog.png").toFile());
                        result.put("nativePaintVerified", false);
                        result.put("nativeScreenCaptureRequiresHumanInspection", true);
                        result.put("sampledInteriorColors", colors.size());
                        SwingUtilities.invokeLater(() -> {
                            window.dispose();
                            finish(result, null);
                        });
                    } catch (Throwable error) { SwingUtilities.invokeLater(() -> finish(null, error)); }
                }, "cc-model-input-native-pixels").start();
                return;
            }
            if (++ticks > 450) throw new AssertionError("Native source dialog did not appear");
        } catch (Throwable error) { finish(null, error); }
    }
    private static JTextArea find(Component component) {
        if (component instanceof JTextArea area && "chainlesschain.modelInputs.summary".equals(area.getName()))
            return area;
        if (component instanceof Container container) for (Component child : container.getComponents()) {
            JTextArea found = find(child);
            if (found != null) return found;
        }
        return null;
    }
    private static String digest(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
    private void progress(String stage) throws Exception {
        Files.writeString(root.resolve("driver-progress.jsonl"), MiniJson.stringify(
                Map.of("stage", stage, "at", java.time.Instant.now().toString())) + "\n",
                StandardOpenOption.CREATE, StandardOpenOption.APPEND);
    }
    private void finish(Map<String, Object> result, Throwable error) {
        if (poll != null) poll.stop();
        try {
            if (error != null) {
                StringWriter stack = new StringWriter();
                error.printStackTrace(new PrintWriter(stack));
                result = Map.of("schema", "chainlesschain.jetbrains-model-input-native/v1",
                        "status", "failed", "error", stack.toString());
            }
            Files.writeString(root.resolve("host-result.json"), MiniJson.stringify(result) + "\n");
        } catch (Exception failedReport) { failedReport.printStackTrace(); }
        final int code = error == null ? 0 : 1;
        // Exit the dedicated fixture through the platform API, which also
        // authorizes the IDE's own System.exit protection and shutdown hooks.
        ApplicationManager.getApplication().invokeLater(() ->
                ApplicationManager.getApplication().exit(true, true, false, code));
    }
}
