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
import java.time.Duration;

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
 * interrupt escalation, child restart, session resume, and the canonical
 * partial-coverage checkpoint timeline. The latter executes code-only,
 * conversation-only, combined, and branch actions through the production
 * chooser/preview/confirmation path. It is not
 * live-provider evidence and does not claim Diff, Preview, remote transport,
 * or plugin-lifecycle coverage; those remain separate P0 host journeys.
 */
final class IdeUiSmokeTest {

    private static final String ROBOT_URL =
            System.getProperty("ui.robot.url", "http://127.0.0.1:8082");
    private static final Duration CONNECT_BUDGET = Duration.ofMinutes(3);
    private static final Duration FRAME_BUDGET = Duration.ofMinutes(5);
    private static final Duration FIND_BUDGET = Duration.ofSeconds(45);

    /** Match new-UI and classic-UI stripe buttons. */
    private static final String STRIPE_XPATH =
            "//div[(@class='SquareStripeButton' or @class='StripeButton')"
                    + " and (@text='ChainlessChain' or @tooltiptext='ChainlessChain'"
                    + " or @accessiblename='ChainlessChain')]";

    @Test
    void chainlessChainChatAndControlJourney() throws Exception {
        RemoteRobot robot = connectWithRetry();
        try {
            robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='IdeFrameImpl']"), FRAME_BUDGET);

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
                    5, "Branch from here");
        } catch (Throwable t) {
            saveScreenshot(robot, "chat-control-journey");
            throw t;
        }
    }

    private static void runRewindAction(
            RemoteRobot robot,
            ComponentFixture input,
            ComponentFixture send,
            ComponentFixture transcript,
            int actionIndex,
            String actionLabel) throws InterruptedException {
        send(input, send, "/rewind");
        choosePopupIndex(robot, 1); // turn-2: the canonical partial-coverage row
        choosePopupIndex(robot, actionIndex);
        ComponentFixture confirm = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@text='Confirm action']"), FIND_BUDGET);
        clickButton(confirm);
        waitForTranscript(
                transcript,
                actionLabel + " completed at turn-2",
                FIND_BUDGET);
    }

    private static void choosePopupIndex(RemoteRobot robot, int index)
            throws InterruptedException {
        ComponentFixture list = robot.find(ComponentFixture.class,
                Locators.byXpath("//div[@class='JBList' and @visible='true']"),
                FIND_BUDGET);
        list.runJs("component.setSelectedIndex(" + index + ");"
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
                + "java.awt.event.KeyEvent.CHAR_UNDEFINED));"
        );
        Thread.sleep(250);
    }

    private static void send(
            ComponentFixture input, ComponentFixture send, String text) {
        input.runJs("component.setText(" + jsString(text) + ")");
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
        button.runJs("component.doClick()");
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
