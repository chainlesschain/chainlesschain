package com.chainlesschain.ide.uitest;

import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import com.intellij.remoterobot.search.locators.Locators;
import org.junit.jupiter.api.Test;

import javax.imageio.ImageIO;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;

/**
 * Real-host chat/control journey driven through Remote Robot.
 *
 * <p>The IDE is launched separately with the production plugin and a
 * deterministic stream-json peer placed at the front of PATH only for the
 * sandbox process. CLI resolution, process spawn, NDJSON transport, event
 * mapping, Swing rendering, and control replies use the normal plugin path.
 * An opt-in observer can record boundary metadata without changing that path.
 *
 * <p>The journey covers streaming, retry, plan approval, tool permission,
 * interrupt escalation, child restart, session resume, the canonical
 * Sessions Workbench lifecycle, a full IDE restart/recovery, and the canonical
 * partial-coverage checkpoint timeline. The latter executes code-only,
 * conversation-only, combined, both summary directions, and branch actions
 * through the production chooser/preview/confirmation path. It is not
 * live-provider evidence and does not claim Diff, Preview, remote transport,
 * or plugin-lifecycle coverage; those remain separate P0 host journeys.
 */
final class IdeUiSmokeTest {

    private static final String ROBOT_URL =
            System.getProperty("ui.robot.url", "http://127.0.0.1:8082");
    private static final Duration CONNECT_BUDGET = Duration.ofMinutes(3);
    private static final Duration FRAME_BUDGET = Duration.ofMinutes(5);
    private static final Duration FIND_BUDGET = Duration.ofSeconds(45);
    private static final Duration OPTIONAL_ONBOARDING_BUDGET = Duration.ofSeconds(2);
    private static final Duration PANEL_VISIBILITY_PROBE_BUDGET = Duration.ofSeconds(2);
    private static final Duration FIRST_POPUP_BUDGET = Duration.ofSeconds(15);
    private static final long NEEDS_INPUT_VISIBILITY_SLA_MILLIS = 2_000L;
    private static final int NEEDS_INPUT_VISIBILITY_SAMPLE_COUNT = 100;
    private static final int NEEDS_INPUT_READINESS_MINIMUM_COUNT = 40;
    private static final int NEEDS_INPUT_READINESS_MAXIMUM_COUNT = 75;
    private static final int NEEDS_INPUT_READINESS_CONSECUTIVE_COUNT = 10;
    private static final int WORKBENCH_QUIESCENCE_PROBE_COUNT = 4;
    private static final long WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MILLIS = 250L;

    /** Match new-UI and classic-UI stripe buttons. */
    private static final String STRIPE_XPATH =
            "//div[(@class='SquareStripeButton' or @class='StripeButton')"
                    + " and (@text='ChainlessChain' or @tooltiptext='ChainlessChain'"
                    + " or @accessiblename='ChainlessChain')]";
    private static final String SESSIONS_STRIPE_XPATH =
            "//div[(@class='SquareStripeButton' or @class='StripeButton')"
                    + " and (@text='ChainlessChain Sessions'"
                    + " or @tooltiptext='ChainlessChain Sessions'"
                    + " or @accessiblename='ChainlessChain Sessions')]";
    private static final String SESSIONS_TABLE_XPATH =
            "//div[@class='JBTable' and @visible='true'"
                    + " and @accessiblename='ChainlessChain sessions table']";

    @Test
    void chainlessChainChatAndControlJourney() throws Exception {
        RemoteRobot robot = connectWithRetry();
        try {
            ComponentFixture frame = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='IdeFrameImpl']"), FRAME_BUDGET);
            restoreIdeWindow(frame);
            assertRequiredHostArchitecture(frame);
            assertRequiredHostVersion(frame);
            assertAutomaticCompletionContract(frame);
            dismissVendorOnboarding(robot);

            String onboardingRoot = System.getProperty("ui.onboarding.root", "");
            if (!onboardingRoot.isBlank()) {
                ensureChatInputVisible(robot);
                new OnboardingIdentityJourney(robot, frame, Paths.get(onboardingRoot)).run();
                return;
            }

            String verifyRoot = System.getProperty("ui.verify01.captureRoot", "");
            String coldRoot = System.getProperty("ui.cold.root", "");
            if (!coldRoot.isBlank()) {
                ensureChatInputVisible(robot);
                ColdInitializationJourney journey = new ColdInitializationJourney(robot, frame, Paths.get(coldRoot),
                        Long.parseLong(System.getProperty("ui.verify01.deadlineMs")));
                if (Boolean.getBoolean("ui.cold.boundaries")) journey.runBoundaries();
                else journey.run();
                return;
            }
            if (!verifyRoot.isBlank()) {
                ensureChatInputVisible(robot);
                String phase = System.getProperty("ui.journey.phase", "initial");
                new Verify01HostJourney(robot, frame, Paths.get(verifyRoot),
                        System.getProperty("ui.verify01.sampleId", "")).run(phase);
                if ("initial".equals(phase)) saveProjectBeforeRestart(frame);
                return;
            }

            String recoveryRoot = System.getProperty("ui.recovery.root", "");
            if (!recoveryRoot.isBlank()) {
                ensureChatInputVisible(robot);
                String phase = System.getProperty("ui.journey.phase", "initial");
                new ConversationRecoveryJourney(robot, frame, Paths.get(recoveryRoot)).run(phase);
                if ("initial".equals(phase)) NativeTranscriptJourney.run(robot, frame, Paths.get(recoveryRoot));
                if ("initial".equals(phase)) saveProjectBeforeRestart(frame);
                return;
            }

            if ("restart".equals(System.getProperty("ui.journey.phase"))) {
                runSessionsWorkbenchJourney(robot, true);
                runModelConfigurationJourney(robot, true);
                return;
            }

            ComponentFixture input = ensureChatInputVisible(robot);
            robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='JBTabbedPane']"), FIND_BUDGET);
            ComponentFixture transcript = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='JTextPane']"), FIND_BUDGET);
            ComponentFixture send = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@text='Send']"), FIND_BUDGET);
            ComponentFixture stop = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@text='Stop']"), FIND_BUDGET);

            send(input, send, "journey:stream");
            waitForTranscript(transcript, "fixture stream complete #1", FIND_BUDGET);
            send(input, send, "/retry");
            waitForTranscript(transcript, "fixture stream complete #2", FIND_BUDGET);

            send(input, send, "journey:plan");
            waitForTranscript(transcript, "opened plan review editor tab", FIND_BUDGET);
            transcript.runJs(
                    "importClass(com.intellij.openapi.application.ApplicationManager);"
                            + "importClass(com.intellij.openapi.command.WriteCommandAction);"
                            + "importClass(com.intellij.openapi.project.ProjectManager);"
                            + "importClass(com.intellij.openapi.fileEditor.FileEditorManager);"
                            + "importClass(java.lang.Runnable);"
                            + "ApplicationManager.getApplication().invokeLater(new Runnable({run:function(){"
                            + "var project=ProjectManager.getInstance().getOpenProjects()[0];"
                            + "var editor=FileEditorManager.getInstance(project).getSelectedTextEditor();"
                            + "var document=editor.getDocument();"
                            + "WriteCommandAction.runWriteCommandAction(project,new Runnable({run:function(){"
                            + "document.insertString(document.getTextLength(),'\\nReviewer fixture: preserve this note.\\n');"
                            + "}}));}}));", true);
            waitForPlanReviewerNote(transcript, false);
            ComponentFixture planApprove = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@text='Approve']"), FIND_BUDGET);
            clickButton(planApprove);
            waitForTranscript(transcript, "fixture plan approve #3", FIND_BUDGET);
            waitForPlanReviewerNote(transcript, true);

            send(input, send, "journey:permission");
            ComponentFixture toolApprove = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@text='Approve Once']"), FIND_BUDGET);
            clickButton(toolApprove);
            waitForTranscript(transcript, "fixture permission approved #4", FIND_BUDGET);

            send(input, send, "journey:stop");
            waitForTranscript(transcript, "fixture stop waiting #5", FIND_BUDGET);
            java.util.Set<Long> stoppedProcesses = activeAgentProcessIds(frame);
            clickButton(stop);
            clickButton(stop);
            waitForTranscript(
                    transcript, "Stopping the agent; replacement waits for confirmed exit", FIND_BUDGET);
            waitForProcessExit(stoppedProcesses);

            send(input, send, "journey:resume");
            waitForTranscript(
                    transcript, "resumed previous conversation", FIND_BUDGET);
            waitForTranscript(transcript, "fixture stream complete #6", FIND_BUDGET);

            runRewindAction(robot, input, send, transcript,
                    "Restore code");
            runRewindAction(robot, input, send, transcript,
                    "Restore conversation");
            runRewindAction(robot, input, send, transcript,
                    "Restore code + conversation");
            runRewindAction(robot, input, send, transcript,
                    "Summarize from here");
            runRewindAction(robot, input, send, transcript,
                    "Summarize up to here");
            runRewindAction(robot, input, send, transcript,
                    "Branch from here");
            runModelConfigurationJourney(robot, false);
            saveProjectBeforeRestart(frame);
            runSessionsWorkbenchJourney(robot, false);
        } catch (Throwable t) {
            saveScreenshot(robot, "chat-control-journey");
            throw t;
        }
    }

    /** Observe the actual child tree before Stop; UI text alone is not exit proof. */
    private static java.util.Set<Long> activeAgentProcessIds(ComponentFixture frame) {
        Object value = frame.callJs("""
            function field(object, name) {
                var f = object.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(object);
            }
            var loader = Packages.com.intellij.ide.plugins.PluginManagerCore.getPlugin(
                Packages.com.intellij.openapi.extensions.PluginId.getId('com.chainlesschain.ide')).getPluginClassLoader();
            var factory = java.lang.Class.forName('com.chainlesschain.ide.intellij.ChatToolWindowFactory', true, loader);
            var registry = factory.getDeclaredField('REGISTRY'); registry.setAccessible(true);
            var panel = registry.get(null).get(component.getProject());
            var view = field(panel,'views').get(field(panel,'tabIds').get(field(panel,'tabs').getSelectedIndex()));
            var process = field(field(field(view,'conv'),'session'),'child');
            var ids = [String(process.pid())], children = process.descendants();
            try {
                var iterator = children.iterator();
                while (iterator.hasNext()) ids.push(String(iterator.next().pid()));
            } finally { children.close(); }
            ids.join(',');
            """, true);
        java.util.Set<Long> ids = new java.util.HashSet<>();
        for (String id : String.valueOf(value).split(",")) ids.add(Long.parseLong(id));
        org.junit.jupiter.api.Assertions.assertFalse(ids.isEmpty());
        return ids;
    }

    private static void waitForProcessExit(java.util.Set<Long> ids) throws Exception {
        long deadline = System.nanoTime() + FIND_BUDGET.toNanos();
        while (System.nanoTime() < deadline) {
            if (ids.stream().noneMatch(id -> ProcessHandle.of(id).map(ProcessHandle::isAlive).orElse(false))) return;
            Thread.sleep(25);
        }
        throw new AssertionError("Stop did not terminate the observed child processes: " + ids);
    }

    private static void restoreIdeWindow(ComponentFixture frame) {
        Object previousState = frame.callJs("component.getExtendedState();");
        System.out.println("[ui-smoke] IDE frame state before foreground: " + previousState);
        frame.runJs("component.setExtendedState(component.getExtendedState() & ~Packages.java.awt.Frame.ICONIFIED);"
                + "component.setVisible(true); component.toFront(); component.requestFocus();", true);
    }

    private static void saveProjectBeforeRestart(ComponentFixture frame) throws Exception {
        // The driver terminates the sandbox process tree between phases. Use
        // the IDE's normal Save All action first, so this verifies a saved
        // project reopening instead of depending on an autosave timer.
        Object sessionIdsValue = frame.callJs(
                "Packages.com.intellij.ide.util.PropertiesComponent.getInstance(component.getProject())"
                        + ".getValue('chainlesschain.chat.sessionIds');");
        String sessionIds = String.valueOf(sessionIdsValue);
        if (sessionIds.isBlank() || "null".equals(sessionIds))
            throw new AssertionError("No conversation resume IDs available before project save");
        Object projectPathValue = frame.callJs("component.getProject().getBasePath();");
        String projectPath = String.valueOf(projectPathValue);
        Path workspace = Paths.get(projectPath, ".idea", "workspace.xml");
        // Remote Robot's EDT dispatch does not acquire the write-intent lock
        // required by 2025.2. Dispatch through the platform, as normal actions do.
        frame.runJs("importClass(com.intellij.openapi.application.ApplicationManager);"
                + "importClass(java.lang.Runnable);"
                + "const target = component;"
                + "ApplicationManager.getApplication().invokeLater(new Runnable({run:function(){"
                + "const manager = Packages.com.intellij.openapi.actionSystem.ActionManager.getInstance();"
                + "manager.tryToExecute(manager.getAction('SaveAll'), null, target, null, true);"
                + "}}));", true);
        long deadline = System.nanoTime() + FIND_BUDGET.toNanos();
        while (System.nanoTime() < deadline) {
            if (Files.isRegularFile(workspace)
                    && Files.readString(workspace).contains(sessionIds)) {
                System.out.println("[ui-smoke] saved project conversation IDs before IDE restart");
                return;
            }
            Thread.sleep(200);
        }
        throw new AssertionError("Save All did not persist conversation resume IDs before IDE restart");
    }

    private static ComponentFixture namedModelField(RemoteRobot robot, String name) {
        return robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@name='" + name + "' and @visible='true']"), FIND_BUDGET);
    }

    private static ComponentFixture ensureChatInputVisible(RemoteRobot robot) {
        String inputPath = "//div[@class='JTextArea' and @visible='true']";
        try {
            return robot.find(ComponentFixture.class, Locators.byXpath(inputPath), PANEL_VISIBILITY_PROBE_BUDGET);
        } catch (RuntimeException notVisible) {
            if (!notVisible.getClass().getName().endsWith("WaitForConditionTimeoutException")) throw notVisible;
        }
        clickStripe(robot.find(ComponentFixture.class, Locators.byXpath(STRIPE_XPATH), FIND_BUDGET));
        return robot.find(ComponentFixture.class, Locators.byXpath(inputPath), FIND_BUDGET);
    }

    private static ComponentFixture openModelForm(RemoteRobot robot) throws InterruptedException {
        restoreIdeWindow(robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='IdeFrameImpl']"), FIND_BUDGET));
        clickButton(robot.find(ComponentFixture.class, Locators.byXpath(
                "//div[@accessiblename='Configure language model' and @visible='true']"), FIND_BUDGET));
        ComponentFixture menu = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='JPopupMenu' and @visible='true']"), FIND_BUDGET);
        menu.runJs("importClass(com.intellij.openapi.application.ApplicationManager);"
                + "importClass(java.lang.Runnable);"
                + "const item = component.getComponent(0);"
                + "ApplicationManager.getApplication().invokeLater(new Runnable({run:function(){item.doClick();}}));", true);
        ComponentFixture form = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='LlmConnectionPanel']"), FIND_BUDGET);
        waitUntilEnabled(namedModelField(robot, "llm.test"), "saved-model form", FIND_BUDGET);
        return form;
    }

    private static void closeModelForm(RemoteRobot robot, ComponentFixture form) throws InterruptedException {
        String dialogTitle = form.callJs(
                "Packages.javax.swing.SwingUtilities.getWindowAncestor(component).getTitle()");
        // Vendor notifications can expose another visible Close control. Bind
        // the action to the window containing the form we just exercised.
        clickButton(robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@title=" + xpathString(dialogTitle)
                        + " and @visible='true' and .//div[@class='LlmConnectionPanel']]"
                        + "//div[(@text='Close' or @text='关闭') and @visible='true']"), FIND_BUDGET));
        waitUntilHidden(form, "model configuration form", FIND_BUDGET);
    }

    /** Real native form, CLI process readback, existing-tab restart and IDE reopen. */
    private static void runModelConfigurationJourney(RemoteRobot robot, boolean afterRestart) throws Exception {
        ComponentFixture input = ensureChatInputVisible(robot);
        ComponentFixture transcript = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='JTextPane' and @visible='true']"), FIND_BUDGET);
        ComponentFixture send = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@text='Send' and @visible='true']"), FIND_BUDGET);
        if (!afterRestart) {
            send(input, send, "journey:model:initial-before");
            waitForTranscript(transcript, "fixture model deterministic-host-peer; vision=none; probe=journey:model:initial-before", FIND_BUDGET);
            ComponentFixture form = openModelForm(robot);
            namedModelField(robot, "llm.model").runJs("component.setText('ui-config-model')", true);
            namedModelField(robot, "llm.visionModel").runJs("component.setText('ui-config-vision')", true);
            if (componentEnabled(namedModelField(robot, "llm.test")))
                throw new AssertionError("Unsaved model changes were testable");
            clickButton(namedModelField(robot, "llm.save"));
            waitUntilEnabled(namedModelField(robot, "llm.test"), "saved-model test", FIND_BUDGET);
            clickButton(namedModelField(robot, "llm.test"));
            waitForComponentText(namedModelField(robot, "llm.connection.status"), "fixture saved connection accepted", FIND_BUDGET);
            saveModelFormScreenshot(form, "model-config-saved");
            closeModelForm(robot, form);

            form = openModelForm(robot);
            waitForComponentText(namedModelField(robot, "llm.model"), "ui-config-model", FIND_BUDGET);
            namedModelField(robot, "llm.model").runJs("component.setText('unsaved-must-not-apply')", true);
            closeModelForm(robot, form);
        }
        ComponentFixture form = openModelForm(robot);
        waitForComponentText(namedModelField(robot, "llm.model"), "ui-config-model", FIND_BUDGET);
        waitForComponentText(namedModelField(robot, "llm.visionModel"), "ui-config-vision", FIND_BUDGET);
        if (intValue(namedModelField(robot, "llm.apiKey").callJs("component.getPassword().length")) != 0)
            throw new AssertionError("Saved credentials were copied into the form");
        if (afterRestart) saveModelFormScreenshot(form, "model-config-reopened");
        closeModelForm(robot, form);
        String probe = afterRestart ? "journey:model:restart" : "journey:model:initial-after";
        send(input, send, probe);
        waitForTranscript(transcript, "fixture model ui-config-model; vision=ui-config-vision; probe=" + probe, FIND_BUDGET);
    }

    private static void saveModelFormScreenshot(ComponentFixture form, String name) throws IOException {
        // Capture the actual dialog window, keeping unrelated desktop content
        // outside this model-settings evidence.
        Object encoded = form.callJs("const window = Packages.javax.swing.SwingUtilities.getWindowAncestor(component);"
                + "const bytes = new Packages.java.io.ByteArrayOutputStream();"
                + "Packages.javax.imageio.ImageIO.write(new Packages.java.awt.Robot().createScreenCapture(window.getBounds()), 'png', bytes);"
                + "Packages.java.util.Base64.getEncoder().encodeToString(bytes.toByteArray());");
        Path directory = Paths.get("build", "reports", "ui-smoke");
        Files.createDirectories(directory);
        Files.write(directory.resolve(name + "-" + System.currentTimeMillis() + ".png"),
                java.util.Base64.getDecoder().decode(String.valueOf(encoded)));
    }

    private static void assertRequiredHostArchitecture(ComponentFixture frame) {
        String required = System.getenv("CC_IDE_REQUIRED_HOST_ARCH");
        if (required == null || required.isBlank()) return;
        Object actualValue = frame.callJs(
                "importClass(java.lang.System); System.getProperty('os.arch');");
        String actual = String.valueOf(actualValue);
        String normalizedActual = "aarch64".equalsIgnoreCase(actual)
                ? "arm64" : actual.toLowerCase();
        if (!required.equalsIgnoreCase(normalizedActual)) {
            throw new AssertionError(
                    "JetBrains IDE JVM architecture mismatch: expected "
                            + required + ", got " + actual);
        }
        System.out.println("[ui-smoke] verified IDE JVM architecture: " + actual);
    }

    private static void assertRequiredHostVersion(ComponentFixture frame) {
        String required = System.getenv("CC_IDE_REQUIRED_HOST_VERSION");
        if (required == null || required.isBlank()) return;
        Object actualValue = frame.callJs(
                "importClass(com.intellij.openapi.application.ApplicationInfo); "
                        + "ApplicationInfo.getInstance().getStrictVersion();");
        String actual = String.valueOf(actualValue);
        if (!equivalentNumericVersion(required, actual)) {
            throw new AssertionError(
                    "JetBrains IDE version mismatch: expected "
                            + required + ", got " + actual);
        }
        System.out.println("[ui-smoke] verified IDE version: " + actual);
    }

    static final String PLUGIN_CLASSLOADER_PENDING = "__cc_plugin_classloader_pending__";

    static String automaticCompletionContractScript() {
        return "importClass(com.intellij.ide.plugins.PluginManagerCore); "
                        + "importClass(com.intellij.openapi.extensions.PluginId); "
                        + "importClass(com.intellij.openapi.application.ApplicationManager); "
                        + "(function() { "
                        + "if (java.lang.System.getProperty('idea.auto.reload.plugins') != 'false') "
                        + "throw 'Packaged plugin journey requires development auto reload disabled'; "
                        + "var descriptor = PluginManagerCore.getPlugin("
                        + "PluginId.getId('com.chainlesschain.ide')); "
                        + "if (descriptor == null) throw 'ChainlessChain plugin not installed'; "
                        + "if (!descriptor.isEnabled()) throw 'ChainlessChain plugin is disabled'; "
                        + "var loader = descriptor.getPluginClassLoader(); "
                        // A restored frame and Robot can be available before plugin startup
                        // assigns its loader. Passing null to Class.forName selects the
                        // bootstrap loader, producing a misleading ClassNotFoundException.
                        // Robot's retrieveAny endpoint rejects null results as non-Serializable.
                        + "if (loader == null) return '" + PLUGIN_CLASSLOADER_PENDING + "'; "
                        + "var settingsClass = java.lang.Class.forName("
                        + "'com.chainlesschain.ide.intellij.CcSettings', true, loader); "
                        + "var policyClass = java.lang.Class.forName("
                        + "'com.chainlesschain.ide.CcAutomaticCompletionPolicy', true, loader); "
                        + "var settings = ApplicationManager.getApplication()"
                        + ".getService(settingsClass); "
                        + "var options = settings.getAutomaticCompletionOptions(); "
                        + "return [settings.isAutomaticCompletionEnabled(), "
                        + "options.debounceMs, options.maxRequestsPerHour, "
                        + "options.maxContextCharsPerHour, options.cacheTtlMs, "
                        + "options.maxCompletionChars, options.maxCompletionLines, "
                        + "policyClass.getField('SLO_P50_MS').get(null), "
                        + "policyClass.getField('SLO_P95_MS').get(null), "
                        + "policyClass.getField('SLO_MINIMUM_SAMPLES').get(null)]"
                        + ".join('|'); })();";
    }

    private static void assertAutomaticCompletionContract(ComponentFixture frame)
            throws InterruptedException {
        awaitAutomaticCompletionContract(
                () -> frame.callJs(automaticCompletionContractScript()), FRAME_BUDGET);
    }

    static void awaitAutomaticCompletionContract(java.util.function.Supplier<String> probe,
            Duration budget) throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        String actual;
        // Re-read the descriptor each time; do not retain an incomplete startup snapshot.
        // Only the explicit null-loader marker is transient. Remote errors, missing classes,
        // missing/disabled plugins and contract mismatches must still fail the journey.
        while (PLUGIN_CLASSLOADER_PENDING.equals(actual = probe.get())) {
            if (System.nanoTime() >= deadline) {
                throw new AssertionError("ChainlessChain plugin classloader did not become ready within "
                        + budget.toMillis() + " ms");
            }
            Thread.sleep(100);
        }
        String expected = "false|650|60|240000|30000|800|12|2000|5000|20";
        if (!expected.equals(actual)) {
            throw new AssertionError(
                    "JetBrains automatic-completion contract drifted: expected "
                            + expected + ", got " + actual);
        }
        System.out.println("[ui-smoke] verified governed automatic-completion contract: "
                + actual);
    }

    private static boolean equivalentNumericVersion(String expected, String actual) {
        if (!expected.matches("\\d+(?:\\.\\d+)*")
                || !actual.matches("\\d+(?:\\.\\d+)*")) {
            return false;
        }
        String[] expectedParts = expected.split("\\.");
        String[] actualParts = actual.split("\\.");
        int length = Math.max(expectedParts.length, actualParts.length);
        try {
            for (int index = 0; index < length; index++) {
                int expectedPart = index < expectedParts.length
                        ? Integer.parseInt(expectedParts[index]) : 0;
                int actualPart = index < actualParts.length
                        ? Integer.parseInt(actualParts[index]) : 0;
                if (expectedPart != actualPart) return false;
            }
            return true;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    /**
     * Close vendor-owned first-launch surfaces that can cover the real tool
     * window stripe on a fresh IDE profile. These controls are optional and
     * deliberately choose the non-enrolling actions: dismiss the trial notice
     * and skip the theme tour without accepting a trial or changing settings.
     */
    private static void dismissVendorOnboarding(RemoteRobot robot)
            throws InterruptedException {
        dismissOptionalTextControl(robot, "Close");
        dismissOptionalTextControl(robot, "Skip");
    }

    private static void dismissOptionalTextControl(
            RemoteRobot robot, String text) throws InterruptedException {
        try {
            ComponentFixture control = robot.find(
                    ComponentFixture.class,
                    Locators.byXpath("//div[@text='" + text + "']"),
                    OPTIONAL_ONBOARDING_BUDGET);
            control.click();
            Thread.sleep(500);
            System.out.println("[ui-smoke] dismissed vendor onboarding: " + text);
        } catch (RuntimeException notFound) {
            if (!notFound.getClass().getName()
                    .endsWith("WaitForConditionTimeoutException")) {
                throw notFound;
            }
        }
    }

    private static void runSessionsWorkbenchJourney(
            RemoteRobot robot, boolean restartPhase) throws InterruptedException {
        ComponentFixture table = ensureSessionsWorkbenchVisible(robot);
        waitForCanonicalWorkbenchRows(table, FIND_BUDGET);
        selectWorkbenchBackground(table);

        ComponentFixture detail = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='JTextArea'"
                        + " and @accessiblename='ChainlessChain session detail']"),
                FIND_BUDGET);
        if (restartPhase) {
            waitForTableStatus(table, "done", FIND_BUDGET);
            waitForComponentText(detail, "workbench-result.md", FIND_BUDGET);
            waitForComponentText(detail, "PR #88 merged", FIND_BUDGET);
            return;
        }

        waitForTableStatus(table, "done", FIND_BUDGET);
        ComponentFixture dispatch = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@text='Dispatch'"
                        + " and @accessiblename='ChainlessChain session dispatch']"),
                FIND_BUDGET);
        ComponentFixture reply = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@text='Reply'"
                        + " and @accessiblename='ChainlessChain session reply']"),
                FIND_BUDGET);
        int readinessSamples = awaitWorkbenchMeasurementReadiness(
                robot, table, dispatch, reply);
        waitForWorkbenchMeasurementQuiescence(table, dispatch, reply);
        System.out.println("[ui-smoke] Workbench measurement ready after "
                + readinessSamples + " pre-measurement lifecycle cycles");

        for (int sample = 1;
                sample <= NEEDS_INPUT_VISIBILITY_SAMPLE_COUNT;
                sample++) {
            long latencyMillis = dispatchWorkbenchCycle(
                    robot,
                    table,
                    dispatch,
                    "dispatch from JetBrains Workbench sample " + sample);
            recordNeedsInputVisibility(latencyMillis, sample);
            replyWorkbenchCycle(
                    robot, table, reply, "beta-" + sample);
        }
        waitForComponentText(detail, "workbench-result.md", FIND_BUDGET);
        waitForComponentText(detail, "PR #88 merged", FIND_BUDGET);
    }

    /**
     * Exercise the installed-plugin route before collecting the governed 100
     * samples. On two independent macOS hosts, the first ten-sample passing
     * streak completed at cycles 28 and 44. Readiness therefore has both an
     * evidence-backed minimum and a fail-closed consecutive-success condition.
     * These cycles are retained as metrics but never enter the product SLA
     * distribution.
     */
    private static int awaitWorkbenchMeasurementReadiness(
            RemoteRobot robot,
            ComponentFixture table,
            ComponentFixture dispatch,
            ComponentFixture reply) throws InterruptedException {
        int consecutivePassing = 0;
        for (int sample = 1;
                sample <= NEEDS_INPUT_READINESS_MAXIMUM_COUNT;
                sample++) {
            long latencyMillis = dispatchWorkbenchCycle(
                    robot,
                    table,
                    dispatch,
                    "dispatch from JetBrains Workbench readiness " + sample);
            consecutivePassing = latencyMillis < NEEDS_INPUT_VISIBILITY_SLA_MILLIS
                    ? consecutivePassing + 1 : 0;
            recordNeedsInputReadiness(
                    latencyMillis, sample, consecutivePassing);
            replyWorkbenchCycle(
                    robot, table, reply, "beta-readiness-" + sample);
            if (sample >= NEEDS_INPUT_READINESS_MINIMUM_COUNT
                    && consecutivePassing
                            >= NEEDS_INPUT_READINESS_CONSECUTIVE_COUNT) {
                return sample;
            }
        }
        throw new AssertionError(
                "Workbench did not become measurement-ready within "
                        + NEEDS_INPUT_READINESS_MAXIMUM_COUNT
                        + " lifecycle cycles; required at least "
                        + NEEDS_INPUT_READINESS_MINIMUM_COUNT + " cycles and "
                        + NEEDS_INPUT_READINESS_CONSECUTIVE_COUNT
                        + " consecutive needs_input observations under "
                        + NEEDS_INPUT_VISIBILITY_SLA_MILLIS + "ms");
    }

    private static long dispatchWorkbenchCycle(
            RemoteRobot robot,
            ComponentFixture table,
            ComponentFixture dispatch,
            String prompt) throws InterruptedException {
        waitUntilEnabled(dispatch, "session dispatch", FIND_BUDGET);
        openInputDialog(dispatch);
        long dispatchedAt = submitInputDialog(robot, "Resume", prompt);
        waitForTableStatus(table, "needs_input", FIND_BUDGET);
        return Duration.ofNanos(System.nanoTime() - dispatchedAt).toMillis();
    }

    private static void replyWorkbenchCycle(
            RemoteRobot robot,
            ComponentFixture table,
            ComponentFixture reply,
            String prompt) throws InterruptedException {
        waitUntilEnabled(reply, "session reply", FIND_BUDGET);
        openInputDialog(reply);
        submitInputDialog(robot, "Reply to Session", prompt);
        waitForTableStatus(table, "done", FIND_BUDGET);
    }

    /**
     * Four synchronous Remote Robot probes drain earlier EDT work and require
     * the selected Workbench row and both actions to remain in their idle
     * state for a full second. A pending projection refresh therefore cannot
     * be mistaken for readiness immediately before sample one.
     */
    private static void waitForWorkbenchMeasurementQuiescence(
            ComponentFixture table,
            ComponentFixture dispatch,
            ComponentFixture reply) throws InterruptedException {
        long deadline = System.nanoTime() + FIND_BUDGET.toNanos();
        int stableProbes = 0;
        String lastState = "";
        while (System.nanoTime() < deadline) {
            // runJs(..., true) is an EDT barrier: work queued before this
            // request completes before the state probes below are evaluated.
            table.runJs("component.revalidate();", true);
            lastState = selectedTableStatus(table);
            boolean dispatchEnabled = componentEnabled(dispatch);
            boolean replyEnabled = componentEnabled(reply);
            if ("done".equals(lastState)
                    && dispatchEnabled
                    && !replyEnabled) {
                stableProbes++;
                if (stableProbes >= WORKBENCH_QUIESCENCE_PROBE_COUNT) {
                    recordWorkbenchQuiescence(stableProbes);
                    return;
                }
            } else {
                stableProbes = 0;
                if (lastState.isEmpty()) selectWorkbenchBackground(table);
            }
            Thread.sleep(WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MILLIS);
        }
        throw new AssertionError(
                "Workbench did not remain quiescent within "
                        + FIND_BUDGET.toSeconds() + "s; lastState=" + lastState
                        + ", stableProbes=" + stableProbes);
    }

    /**
     * IDEA restores the active tool window across process restarts. Clicking
     * its stripe unconditionally therefore closes the already-restored
     * Sessions Workbench on the restart phase. Reuse the visible native table
     * when it is present; otherwise open it through the real stripe control.
     */
    private static ComponentFixture ensureSessionsWorkbenchVisible(
            RemoteRobot robot) throws InterruptedException {
        try {
            ComponentFixture restored = robot.find(
                    ComponentFixture.class,
                    Locators.byXpath(SESSIONS_TABLE_XPATH),
                    PANEL_VISIBILITY_PROBE_BUDGET);
            System.out.println("[ui-smoke] reused visible Sessions Workbench");
            return restored;
        } catch (RuntimeException notVisible) {
            if (!notVisible.getClass().getName()
                    .endsWith("WaitForConditionTimeoutException")) {
                throw notVisible;
            }
        }

        ComponentFixture stripe = robot.find(ComponentFixture.class,
                Locators.byXpath(SESSIONS_STRIPE_XPATH), FIND_BUDGET);
        clickStripe(stripe);
        ComponentFixture opened = robot.find(
                ComponentFixture.class,
                Locators.byXpath(SESSIONS_TABLE_XPATH),
                FIND_BUDGET);
        System.out.println("[ui-smoke] opened Sessions Workbench from stripe");
        return opened;
    }

    private static void waitForCanonicalWorkbenchRows(
            ComponentFixture table, Duration budget) throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        String last = "";
        while (System.nanoTime() < deadline) {
            int count = intValue(table.callJs("component.getRowCount()"));
            StringBuilder kinds = new StringBuilder();
            for (int row = 0; row < count; row++) {
                Object kind = table.callJs(
                        "component.getValueAt(" + row + ", 0)");
                kinds.append(String.valueOf(kind)).append(',');
            }
            last = kinds.toString();
            if (count >= 5
                    && last.contains("local")
                    && last.contains("background")
                    && last.contains("remote")
                    && last.contains("team")
                    && last.contains("workflow")) return;
            Thread.sleep(250);
        }
        throw new AssertionError(
                "canonical Workbench kinds did not render within "
                        + budget.toSeconds() + "s; kinds=" + last);
    }

    private static void selectWorkbenchBackground(ComponentFixture table) {
        int count = intValue(table.callJs("component.getRowCount()"));
        for (int row = 0; row < count; row++) {
            Object title = table.callJs(
                    "component.getValueAt(" + row + ", 1)");
            if (String.valueOf(title).contains("Workbench lifecycle fixture")) {
                table.runJs(
                        "component.setRowSelectionInterval(" + row + ", " + row + ");"
                                + "component.scrollRectToVisible(component.getCellRect("
                                + row + ", 0, true));",
                        true);
                return;
            }
        }
        throw new AssertionError("Workbench background fixture row is missing");
    }

    private static void waitForTableStatus(
            ComponentFixture table, String expected, Duration budget)
            throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        String last = "";
        while (System.nanoTime() < deadline) {
            last = selectedTableStatus(table);
            if (!last.isEmpty()) {
                // The real Workbench decorates needs-input/blocked states with
                // an approval marker in the status cell.  The lifecycle state
                // is still the first token; keep the journey strict about that
                // state without rejecting the independently rendered marker.
                if (expected.equals(last)
                        || last.startsWith(expected + " ")) return;
            } else {
                selectWorkbenchBackground(table);
            }
            Thread.sleep(250);
        }
        throw new AssertionError(
                "Workbench status did not become '" + expected + "' within "
                        + budget.toSeconds() + "s; last=" + last);
    }

    private static String selectedTableStatus(ComponentFixture table) {
        int selected = intValue(table.callJs("component.getSelectedRow()"));
        if (selected < 0) return "";
        Object value = table.callJs(
                "component.getValueAt(" + selected + ", 2)");
        return String.valueOf(value);
    }

    private static long submitInputDialog(
            RemoteRobot robot, String title, String text)
            throws InterruptedException {
        ComponentFixture dialog = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@visible='true' and @title="
                        + xpathString(title) + "]"), FIND_BUDGET);
        setInputDialogText(dialog, title, text, FIND_BUDGET);
        ComponentFixture ok = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@text='OK']"), FIND_BUDGET);
        long submittedAt = System.nanoTime();
        clickButton(ok);
        waitUntilHidden(dialog, title + " input dialog", FIND_BUDGET);
        return submittedAt;
    }

    private static void setInputDialogText(
            ComponentFixture dialog,
            String title,
            String text,
            Duration budget) throws InterruptedException {
        String script =
                "importClass(java.awt.Container);"
                        + "importClass(java.util.ArrayDeque);"
                        + "importClass(javax.swing.text.JTextComponent);"
                        + "var pending = new ArrayDeque();"
                        + "pending.add(component);"
                        + "var updated = false;"
                        + "while (!pending.isEmpty() && !updated) {"
                        + "var current = pending.removeFirst();"
                        + "if (current instanceof JTextComponent"
                        + " && current.isShowing() && current.isEditable()) {"
                        + "current.setText(" + jsString(text) + ");"
                        + "current.requestFocusInWindow();"
                        + "updated = true;"
                        + "} else if (current instanceof Container) {"
                        + "var children = current.getComponents();"
                        + "for (var index = 0; index < children.length; index += 1) {"
                        + "pending.add(children[index]);"
                        + "}"
                        + "}"
                        + "}"
                        + "updated;";
        long deadline = System.nanoTime() + budget.toNanos();
        while (System.nanoTime() < deadline) {
            Object updated = dialog.callJs(script);
            if (Boolean.TRUE.equals(updated)
                    || "true".equals(String.valueOf(updated))) return;
            // On IDEA 2024.2/Linux the modal window can be discoverable a few
            // EDT turns before its editor is attached. Traversing the dialog
            // avoids relying on the equally transient Window focus owner.
            Thread.sleep(100);
        }
        throw new AssertionError(title + " input editor did not become ready within "
                + budget.toSeconds() + "s");
    }

    private static void recordNeedsInputVisibility(
            long latencyMillis, int sample) {
        appendWorkbenchMetric(
                "\"metric\":\"needs-input-visible\""
                        + ",\"sample\":" + sample
                        + ",\"sampleCount\":"
                        + NEEDS_INPUT_VISIBILITY_SAMPLE_COUNT
                        + ",\"latencyMs\":" + latencyMillis
                        + ",\"thresholdMs\":"
                        + NEEDS_INPUT_VISIBILITY_SLA_MILLIS);
    }

    private static void recordNeedsInputReadiness(
            long latencyMillis,
            int sample,
            int consecutivePassing) {
        appendWorkbenchMetric(
                "\"metric\":\"needs-input-readiness\""
                        + ",\"sample\":" + sample
                        + ",\"minimumSampleCount\":"
                        + NEEDS_INPUT_READINESS_MINIMUM_COUNT
                        + ",\"maximumSampleCount\":"
                        + NEEDS_INPUT_READINESS_MAXIMUM_COUNT
                        + ",\"latencyMs\":" + latencyMillis
                        + ",\"thresholdMs\":"
                        + NEEDS_INPUT_VISIBILITY_SLA_MILLIS
                        + ",\"consecutivePassingSamples\":"
                        + consecutivePassing
                        + ",\"requiredConsecutivePassingSamples\":"
                        + NEEDS_INPUT_READINESS_CONSECUTIVE_COUNT);
    }

    private static void recordWorkbenchQuiescence(int stableProbes) {
        appendWorkbenchMetric(
                "\"metric\":\"workbench-quiescence\""
                        + ",\"state\":\"done\""
                        + ",\"dispatchEnabled\":true"
                        + ",\"replyEnabled\":false"
                        + ",\"stableProbes\":" + stableProbes
                        + ",\"requiredStableProbes\":"
                        + WORKBENCH_QUIESCENCE_PROBE_COUNT
                        + ",\"probeIntervalMs\":"
                        + WORKBENCH_QUIESCENCE_PROBE_INTERVAL_MILLIS);
    }

    private static void appendWorkbenchMetric(String fields) {
        String metricsPath = System.getProperty("ui.metrics.path", "").trim();
        if (metricsPath.isEmpty()) return;
        String record = "{\"at\":\"" + Instant.now()
                + "\",\"host\":\"jetbrains\""
                + "," + fields + "}\n";
        try {
            Files.writeString(
                    Paths.get(metricsPath),
                    record,
                    StandardOpenOption.CREATE,
                    StandardOpenOption.APPEND);
        } catch (IOException error) {
            throw new AssertionError(
                    "could not persist Workbench visibility metric", error);
        }
    }

    private static void waitUntilEnabled(
            ComponentFixture component, String label, Duration budget)
            throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        while (System.nanoTime() < deadline) {
            if (componentEnabled(component)) return;
            Thread.sleep(100);
        }
        throw new AssertionError(label + " did not become enabled within "
                + budget.toSeconds() + "s");
    }

    private static boolean componentEnabled(ComponentFixture component) {
        Object enabled = component.callJs("component.isEnabled()");
        return Boolean.TRUE.equals(enabled)
                || "true".equals(String.valueOf(enabled));
    }

    private static void waitForComponentText(
            ComponentFixture component, String expected, Duration budget)
            throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        String last = "";
        while (System.nanoTime() < deadline) {
            Object value = component.callJs("component.getText()");
            last = value == null ? "" : String.valueOf(value);
            if (last.contains(expected)) return;
            Thread.sleep(250);
        }
        throw new AssertionError(
                "component did not contain '" + expected + "' within "
                        + budget.toSeconds() + "s; text=" + tail(last, 1200));
    }

    private static int intValue(Object value) {
        return value instanceof Number
                ? ((Number) value).intValue()
                : Integer.parseInt(String.valueOf(value));
    }

    private static String xpathString(String value) {
        if (!value.contains("'")) return "'" + value + "'";
        if (!value.contains("\"")) return "\"" + value + "\"";
        throw new IllegalArgumentException("unsupported XPath string");
    }

    private static void runRewindAction(
            RemoteRobot robot,
            ComponentFixture input,
            ComponentFixture send,
            ComponentFixture transcript,
            String actionLabel) throws InterruptedException {
        System.out.println("[ui-smoke] opening timeline for " + actionLabel);
        send(input, send, "/rewind");
        ComponentFixture timeline;
        try {
            timeline = findPopupItem(robot, "partial  turn-2  ", true, FIRST_POPUP_BUDGET);
        } catch (RuntimeException firstPopupMissed) {
            // IDEA 2025.2 on a loaded Linux EDT has occasionally completed the
            // CLI timeline read without presenting its queued first chooser.
            // Re-enter through the same real /rewind UI path once; the second
            // attempt still has to render and complete under the full budget.
            send(input, send, "/rewind");
            timeline = findPopupItem(robot, "partial  turn-2  ", true, FIND_BUDGET);
        }
        clickPopupItem(timeline, "partial  turn-2  ", true);
        // A hidden list can also mean cancellation. The expected next-stage
        // item, then the matching preview, are the actual transition checks.
        ComponentFixture actions = findPopupItem(robot, actionLabel, false, FIND_BUDGET);
        clickPopupItem(actions, actionLabel, false);
        ComponentFixture confirm = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@text='Confirm action' and @visible='true']"), FIND_BUDGET);
        Boolean expectedPreview = confirm.callJs(
                "function hasActionLabel(c) {"
                        + "if (c instanceof javax.swing.JLabel && String(c.getText()).indexOf("
                        + jsString("<b>" + actionLabel + "</b>") + ") >= 0) return true;"
                        + "if (c instanceof java.awt.Container) {"
                        + "var children = c.getComponents();"
                        + "for (var i = 0; i < children.length; i++) {"
                        + "if (hasActionLabel(children[i])) return true;}} return false;}"
                        + "hasActionLabel(javax.swing.SwingUtilities.getWindowAncestor(component));",
                true);
        if (!Boolean.TRUE.equals(expectedPreview)) {
            throw new AssertionError("Wrong checkpoint preview for " + actionLabel);
        }
        System.out.println("[ui-smoke] confirming preview for " + actionLabel);
        clickButton(confirm);
        waitUntilHidden(confirm, "timeline confirmation", FIND_BUDGET);
        waitForTranscript(
                transcript,
                actionLabel + " completed at turn-2",
                FIND_BUDGET);
    }

    private static ComponentFixture findPopupItem(
            RemoteRobot robot, String label, boolean prefix, Duration budget)
            throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        String last = "";
        while (System.nanoTime() < deadline) {
            StringBuilder visibleItems = new StringBuilder();
            ComponentFixture match = null;
            for (ComponentFixture list : robot.findAll(ComponentFixture.class,
                    Locators.byXpath("//div[@class='JBList' and @visible='true']"))) {
                String items = list.callJs(
                        "var items = []; if (component.isShowing()) {"
                                + "var model = component.getModel();"
                                + "for (var i = 0; i < model.getSize(); i++) {"
                                + "items.push(String(model.getElementAt(i)));}} items.join('\\n');", true);
                visibleItems.append('[').append(items).append("] ");
                for (String item : items.split("\n")) {
                    if (prefix ? item.startsWith(label) : item.equals(label)) {
                        if (match != null) throw new AssertionError("Ambiguous popup item: " + label);
                        match = list;
                    }
                }
            }
            if (match != null) return match;
            last = visibleItems.toString();
            Thread.sleep(100);
        }
        throw new IllegalStateException("Popup item '" + label + "' did not appear within "
                + budget.toSeconds() + "s; visible lists=" + last);
    }

    private static void clickPopupItem(ComponentFixture list, String label, boolean prefix)
            throws InterruptedException {
        // Use the chooser's own Enter action. A physical click can dismiss a
        // native popup without invoking its chosen-item callback on ARM64.
        System.out.println("[ui-smoke] activating popup item " + label);
        list.runJs(popupActivationScript(label, prefix), true);
        long deadline = System.nanoTime() + FIND_BUDGET.toNanos();
        String last = "";
        while (System.nanoTime() < deadline) {
            last = String.valueOf((Object) list.callJs(
                    "String(component.getClientProperty('cc.uiTest.popupEnter') || 'missing')"
                            + "+'|'+(component.isShowing() ? 'visible' : 'hidden');", true));
            if (last.startsWith("failed:")) {
                throw new IllegalStateException("Popup Enter failed for " + label + ": " + last);
            }
            // Returning from Enter is not proof of the selected-item callback.
            // The caller must still observe the real next menu or preview.
            if ("dispatch-returned|hidden".equals(last)) return;
            Thread.sleep(100);
        }
        throw new IllegalStateException("Popup Enter did not dispatch and close for "
                + label + " within " + FIND_BUDGET.toSeconds() + "s; state=" + last);
    }

    static String popupActivationScript(String label, boolean prefix) {
        // Keep validation, selection and the real Enter action in one deferred
        // EDT operation. A popup can be cancelled between Robot requests.
        // IIFE parameters retain this target across later script evaluations.
        return "(function(target, expected, prefix) {"
                        + "function state(value) {"
                        + "target.putClientProperty('cc.uiTest.popupEnter', value);"
                        + "var owner = java.awt.KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner();"
                        + "java.lang.System.out.println('[ui-popup-enter] '+expected+' '+value"
                        + "+' showing='+target.isShowing()+' focusOwner='+target.isFocusOwner()"
                        + "+' focus='+(owner == null ? '<none>' : owner.getClass().getName()));}"
                        + "state('scheduled');"
                        + "Packages.com.intellij.openapi.application.ApplicationManager.getApplication()"
                        + ".invokeLater(new java.lang.Runnable({run:function(){"
                        + "try {state('entered');"
                        + "if (!target.isShowing()) throw new Error('Popup cancelled before Enter dispatch');"
                        + "var model = target.getModel(), index = -1, matches = 0;"
                        + "for (var i = 0; i < model.getSize(); i++) {"
                        + "var item = String(model.getElementAt(i));"
                        + "if (prefix ? item.indexOf(expected) === 0 : item === expected) {index=i; matches++;}}"
                        + "if (matches !== 1) throw new Error('Popup target missing or ambiguous at dispatch');"
                        + "target.setSelectedIndex(index); target.ensureIndexIsVisible(index);"
                        + "var enter = javax.swing.KeyStroke.getKeyStroke(java.awt.event.KeyEvent.VK_ENTER, 0);"
                        + "var action = target.getActionForKeyStroke(enter);"
                        + "if (action == null) throw new Error('Popup Enter action unavailable');"
                        + "state('validated');"
                        + "action.actionPerformed(new java.awt.event.ActionEvent(target,"
                        + "java.awt.event.ActionEvent.ACTION_PERFORMED, 'Enter'));"
                        + "state('dispatch-returned');"
                        + "} catch (failure) {state('failed:'+String(failure));"
                        + "java.lang.System.err.println('[ui-popup-enter] '+expected+' '+String(failure));}"
                        + "}}));})(component," + jsString(label) + "," + prefix + ");";
    }

    private static void send(
            ComponentFixture input, ComponentFixture send, String text) {
        input.runJs("component.setText(" + jsString(text) + ")", true);
        clickButton(send);
    }

    /**
     * Invoke the real Swing button action even when an IDE-owned notification
     * temporarily overlaps the narrow tool window. Remote Robot's physical
     * click otherwise lands on that notification on Windows/Linux, and a plan
     * editor button can be covered by the tool window on macOS. This still
     * exercises the production ActionListener and protocol path.
     */
    private static void clickButton(ComponentFixture button) {
        button.runJs("component.doClick()", true);
    }

    /**
     * Invoke the native tool-window action without depending on screen
     * coordinates. New-UI SquareStripeButton exposes ActionButton.click(),
     * while the classic StripeButton is a Swing AbstractButton.
     */
    private static void clickStripe(ComponentFixture stripe) {
        stripe.runJs(
                "importClass(javax.swing.AbstractButton);"
                        + "if (component instanceof AbstractButton) {"
                        + "component.doClick();"
                        + "} else { component.click(); }",
                true);
    }

    /**
     * Queue a real Swing button action after the current Remote Robot request
     * returns. A synchronous doClick() cannot return while its production
     * ActionListener is showing a modal input dialog, so the test client would
     * otherwise be unable to reach and submit that dialog. ApplicationManager
     * invokeLater is the Remote Robot project's documented Rhino-compatible
     * pattern for modal actions and remains independent of screen overlays.
     */
    private static void waitForPlanReviewerNote(ComponentFixture component, boolean requireProgress) throws InterruptedException {
        long deadline = System.nanoTime() + FIND_BUDGET.toNanos();
        while (System.nanoTime() < deadline) {
            Boolean retained = component.callJs(
                    "importClass(com.intellij.openapi.project.ProjectManager);"
                            + "importClass(com.intellij.openapi.fileEditor.FileEditorManager);"
                            + "var project=ProjectManager.getInstance().getOpenProjects()[0];"
                            + "var editor=FileEditorManager.getInstance(project).getSelectedTextEditor();"
                            + "editor != null && editor.getDocument().getText().contains('Reviewer fixture: preserve this note.')"
                            + (requireProgress ? " && editor.getDocument().getText().contains('- status: completed')" : "") + ";",
                    true);
            if (Boolean.TRUE.equals(retained)) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Plan editor did not retain the reviewer note");
    }

    private static void openInputDialog(ComponentFixture button) {
        button.runJs(
                "importClass(com.intellij.openapi.application.ApplicationManager);"
                        + "importClass(java.lang.Runnable);"
                        + "const click = new Runnable({run:function(){component.doClick();}});"
                        + "ApplicationManager.getApplication().invokeLater(click);",
                true);
    }

    private static void waitUntilHidden(
            ComponentFixture component, String label, Duration budget)
            throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        while (System.nanoTime() < deadline) {
            try {
                Object hidden = component.callJs("!component.isShowing()");
                if (Boolean.TRUE.equals(hidden)
                        || "true".equals(String.valueOf(hidden))) return;
            } catch (Throwable disposed) {
                // A disposed fixture is no longer visible, which is exactly
                // the transition this helper is waiting for.
                return;
            }
            Thread.sleep(100);
        }
        throw new AssertionError(label + " did not close within "
                + budget.toSeconds() + "s");
    }

    private static void waitForTranscript(
            ComponentFixture transcript, String expected, Duration budget)
            throws InterruptedException {
        long deadline = System.nanoTime() + budget.toNanos();
        String last = "";
        while (System.nanoTime() < deadline) {
            // JTextPane.getText() serializes through its EditorKit and returns
            // null if serialization fails, including a concurrent document
            // edit. Remote Robot cannot serialize that null.
            // Snapshot the actual document on the EDT, alongside its writers,
            // and let document errors fail instead of hiding them as no text.
            last = transcript.callJs("""
                    if (!javax.swing.SwingUtilities.isEventDispatchThread())
                        throw new Error('Transcript snapshot requires EDT');
                    var document = component.getDocument();
                    document.getText(0, document.getLength());
                    """, true);
            if (last.contains(expected)) return;
            Thread.sleep(250);
        }
        throw new AssertionError(
                "transcript did not contain '" + expected + "' within "
                        + budget.toSeconds() + "s; tail=" + tail(last, 1200));
    }

    private static String jsString(String value) {
        return "\"" + value
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n") + "\"";
    }

    private static String tail(String value, int max) {
        if (value == null || value.length() <= max) return value;
        return value.substring(value.length() - max);
    }

    private static RemoteRobot connectWithRetry() throws InterruptedException {
        long deadline = System.nanoTime() + CONNECT_BUDGET.toNanos();
        IOException last = null;
        while (System.nanoTime() < deadline) {
            try {
                if (robotServerIsReady()) return new RemoteRobot(ROBOT_URL);
            } catch (IOException e) {
                last = e;
            }
            Thread.sleep(5000);
        }
        throw new IllegalStateException(
                "robot server at " + ROBOT_URL + " did not come up within "
                        + CONNECT_BUDGET.toSeconds()
                        + "s - is runIdeForUiTests running?",
                last);
    }

    private static boolean robotServerIsReady() throws IOException {
        HttpURLConnection connection =
                (HttpURLConnection) URI.create(ROBOT_URL).toURL().openConnection();
        try {
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            connection.setUseCaches(false);
            int status = connection.getResponseCode();
            return status >= 200 && status < 400;
        } finally {
            connection.disconnect();
        }
    }

    private static void saveScreenshot(RemoteRobot robot, String name) {
        Path dir = Paths.get("build", "reports", "ui-smoke");
        String stem = name + "-" + System.currentTimeMillis();
        try {
            Files.createDirectories(dir);
            Path file = dir.resolve(stem + ".png");
            if (!ImageIO.write(robot.getScreenshot(), "png", file.toFile())) {
                throw new IOException("no PNG ImageIO writer is available");
            }
            System.err.println("[ui-smoke] failure screenshot: " + file.toAbsolutePath());
        } catch (Throwable t) {
            System.err.println("[ui-smoke] could not capture a screenshot: " + t);
        }
        try {
            Files.createDirectories(dir);
            // The host evidence collector retains .bin inputs byte-for-byte.
            // A large JSON tree must not enter its text redaction/tail path.
            Path file = dir.resolve(stem + ".swing.json.bin");
            UiFailureDiagnostics.capture(robot, file);
            System.err.println("[ui-smoke] failure Swing snapshot: " + file.toAbsolutePath());
        } catch (Throwable t) {
            System.err.println("[ui-smoke] could not capture Swing diagnostics: " + t);
        }
    }
}
