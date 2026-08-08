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
 * sandbox process. No production test hook is involved: CLI resolution,
 * process spawn, NDJSON transport, event mapping, Swing rendering, and control
 * replies all use the normal plugin path.
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
    private static final Duration FIRST_POPUP_BUDGET = Duration.ofSeconds(15);
    private static final long NEEDS_INPUT_VISIBILITY_SLA_MILLIS = 2_000L;
    private static final int NEEDS_INPUT_VISIBILITY_SAMPLE_COUNT = 100;
    private static final int NEEDS_INPUT_VISIBILITY_WARMUP_COUNT = 1;

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

    @Test
    void chainlessChainChatAndControlJourney() throws Exception {
        RemoteRobot robot = connectWithRetry();
        try {
            ComponentFixture frame = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='IdeFrameImpl']"), FRAME_BUDGET);
            assertRequiredHostArchitecture(frame);

            if ("restart".equals(System.getProperty("ui.journey.phase"))) {
                runSessionsWorkbenchJourney(robot, true);
                return;
            }

            ComponentFixture stripe = robot.find(ComponentFixture.class,
                    Locators.byXpath(STRIPE_XPATH), FIND_BUDGET);
            stripe.click();

            robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='JBTabbedPane']"), FIND_BUDGET);
            ComponentFixture input = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='JTextArea']"), FIND_BUDGET);
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
            ComponentFixture planApprove = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@text='Approve']"), FIND_BUDGET);
            clickButton(planApprove);
            waitForTranscript(transcript, "fixture plan approve #3", FIND_BUDGET);

            send(input, send, "journey:permission");
            ComponentFixture toolApprove = robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@text='Approve']"), FIND_BUDGET);
            clickButton(toolApprove);
            waitForTranscript(transcript, "fixture permission approved #4", FIND_BUDGET);

            send(input, send, "journey:stop");
            clickButton(stop);
            clickButton(stop);
            waitForTranscript(
                    transcript, "force-stopped the agent process", FIND_BUDGET);

            send(input, send, "journey:resume");
            waitForTranscript(
                    transcript, "resumed previous conversation", FIND_BUDGET);
            waitForTranscript(transcript, "fixture stream complete #6", FIND_BUDGET);

            runRewindAction(robot, input, send, transcript,
                    0, "Restore code");
            runRewindAction(robot, input, send, transcript,
                    1, "Restore conversation");
            runRewindAction(robot, input, send, transcript,
                    2, "Restore code + conversation");
            runRewindAction(robot, input, send, transcript,
                    3, "Summarize from here");
            runRewindAction(robot, input, send, transcript,
                    4, "Summarize up to here");
            runRewindAction(robot, input, send, transcript,
                    5, "Branch from here");
            runSessionsWorkbenchJourney(robot, false);
        } catch (Throwable t) {
            saveScreenshot(robot, "chat-control-journey");
            throw t;
        }
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

    private static void runSessionsWorkbenchJourney(
            RemoteRobot robot, boolean restartPhase) throws InterruptedException {
        ComponentFixture stripe = robot.find(ComponentFixture.class,
                Locators.byXpath(SESSIONS_STRIPE_XPATH), FIND_BUDGET);
        stripe.click();
        ComponentFixture table = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='JBTable'"
                        + " and @accessiblename='ChainlessChain sessions table']"),
                FIND_BUDGET);
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
        int totalCycles = NEEDS_INPUT_VISIBILITY_WARMUP_COUNT
                + NEEDS_INPUT_VISIBILITY_SAMPLE_COUNT;
        for (int cycle = 0; cycle < totalCycles; cycle++) {
            int sample = cycle - NEEDS_INPUT_VISIBILITY_WARMUP_COUNT + 1;
            boolean measured = sample > 0;
            waitUntilEnabled(dispatch, "session dispatch", FIND_BUDGET);
            openInputDialog(dispatch);
            long dispatchedAt = submitInputDialog(
                    robot,
                    "Resume",
                    measured
                            ? "dispatch from JetBrains Workbench sample " + sample
                            : "dispatch from JetBrains Workbench warmup");
            waitForTableStatus(table, "needs_input", FIND_BUDGET);
            if (measured) recordNeedsInputVisibility(dispatchedAt, sample);

            waitUntilEnabled(reply, "session reply", FIND_BUDGET);
            openInputDialog(reply);
            submitInputDialog(
                    robot,
                    "Reply to Session",
                    measured ? "beta-" + sample : "beta-warmup");
            waitForTableStatus(table, "done", FIND_BUDGET);
        }
        waitForComponentText(detail, "workbench-result.md", FIND_BUDGET);
        waitForComponentText(detail, "PR #88 merged", FIND_BUDGET);
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
            int selected = intValue(table.callJs("component.getSelectedRow()"));
            if (selected >= 0) {
                Object value = table.callJs(
                        "component.getValueAt(" + selected + ", 2)");
                last = String.valueOf(value);
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
            long submittedAt, int sample) {
        long latencyMillis = Duration.ofNanos(
                System.nanoTime() - submittedAt).toMillis();
        String metricsPath = System.getProperty("ui.metrics.path", "").trim();
        if (metricsPath.isEmpty()) return;
        String record = "{\"at\":\"" + Instant.now()
                + "\",\"host\":\"jetbrains\""
                + ",\"metric\":\"needs-input-visible\""
                + ",\"sample\":" + sample
                + ",\"sampleCount\":"
                + NEEDS_INPUT_VISIBILITY_SAMPLE_COUNT
                + ",\"latencyMs\":" + latencyMillis
                + ",\"thresholdMs\":"
                + NEEDS_INPUT_VISIBILITY_SLA_MILLIS + "}\n";
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
            Object enabled = component.callJs("component.isEnabled()");
            if (Boolean.TRUE.equals(enabled)
                    || "true".equals(String.valueOf(enabled))) return;
            Thread.sleep(100);
        }
        throw new AssertionError(label + " did not become enabled within "
                + budget.toSeconds() + "s");
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
            int actionIndex,
            String actionLabel) throws InterruptedException {
        send(input, send, "/rewind");
        try {
            choosePopupIndex(
                    robot, 1, FIRST_POPUP_BUDGET); // canonical partial row
        } catch (RuntimeException firstPopupMissed) {
            // IDEA 2025.2 on a loaded Linux EDT has occasionally completed the
            // CLI timeline read without presenting its queued first chooser.
            // Re-enter through the same real /rewind UI path once; the second
            // attempt still has to render and complete under the full budget.
            send(input, send, "/rewind");
            choosePopupIndex(robot, 1, FIND_BUDGET);
        }
        choosePopupIndex(robot, actionIndex);
        ComponentFixture confirm = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@text='Confirm action']"), FIND_BUDGET);
        clickButton(confirm);
        waitUntilHidden(confirm, "timeline confirmation", FIND_BUDGET);
        waitForTranscript(
                transcript,
                actionLabel + " completed at turn-2",
                FIND_BUDGET);
    }

    private static void choosePopupIndex(RemoteRobot robot, int index)
            throws InterruptedException {
        choosePopupIndex(robot, index, FIND_BUDGET);
    }

    private static void choosePopupIndex(
            RemoteRobot robot, int index, Duration budget)
            throws InterruptedException {
        ComponentFixture list = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='JBList' and @visible='true']"),
                budget);
        list.runJs(
                "component.setSelectedIndex(" + index + ");"
                        + "component.requestFocusInWindow();"
                        + "component.dispatchEvent(new java.awt.event.KeyEvent("
                        + "component, java.awt.event.KeyEvent.KEY_PRESSED,"
                        + "java.lang.System.currentTimeMillis(), 0,"
                        + "java.awt.event.KeyEvent.VK_ENTER,"
                        + "java.awt.event.KeyEvent.CHAR_UNDEFINED));"
                        + "component.dispatchEvent(new java.awt.event.KeyEvent("
                        + "component, java.awt.event.KeyEvent.KEY_RELEASED,"
                        + "java.lang.System.currentTimeMillis(), 0,"
                        + "java.awt.event.KeyEvent.VK_ENTER,"
                        + "java.awt.event.KeyEvent.CHAR_UNDEFINED));",
                true);
        // The next timeline stage also uses a JBList. On a loaded Linux EDT,
        // a fixed sleep could let the next lookup bind to the outgoing list,
        // eventually leaving a hidden popup stack that suppressed later
        // actions. Require the selected popup to be disposed before looking
        // for the next stage.
        waitUntilHidden(list, "selected timeline popup", FIND_BUDGET);
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
     * Queue a real Swing button action after the current Remote Robot request
     * returns. A synchronous doClick() cannot return while its production
     * ActionListener is showing a modal input dialog, so the test client would
     * otherwise be unable to reach and submit that dialog. ApplicationManager
     * invokeLater is the Remote Robot project's documented Rhino-compatible
     * pattern for modal actions and remains independent of screen overlays.
     */
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
            Object value = transcript.callJs("component.getText()");
            last = value == null ? "" : String.valueOf(value);
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
        try {
            Path dir = Paths.get("build", "reports", "ui-smoke");
            Files.createDirectories(dir);
            Path file = dir.resolve(name + "-" + System.currentTimeMillis() + ".png");
            if (!ImageIO.write(robot.getScreenshot(), "png", file.toFile())) {
                throw new IOException("no PNG ImageIO writer is available");
            }
            System.err.println("[ui-smoke] failure screenshot: " + file.toAbsolutePath());
        } catch (Throwable t) {
            System.err.println("[ui-smoke] could not capture a screenshot: " + t);
        }
    }
}
