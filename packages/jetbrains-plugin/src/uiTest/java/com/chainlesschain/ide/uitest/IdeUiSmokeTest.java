package com.chainlesschain.ide.uitest;

import com.intellij.remoterobot.RemoteRobot;
import com.intellij.remoterobot.fixtures.ComponentFixture;
import com.intellij.remoterobot.search.locators.Locators;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.Base64;

/**
 * GUI smoke gate (gap #8) — the first Remote Robot smoke test. Drives a
 * sandbox IDE that was launched SEPARATELY with the robot-server plugin
 * ({@code ./gradlew runIdeForUiTests}, which also opens a throwaway sandbox
 * project) and talks to it over HTTP — no IntelliJ SDK on this classpath.
 *
 * Flow: connect (retry while the IDE cold-starts) → wait for the main IDE
 * frame → click the ChainlessChain tool-window stripe button → assert the
 * chat panel's conversation tab pane exists. On any failure a full-screen
 * PNG is saved under {@code build/reports/ui-smoke/} for the CI artifact.
 *
 * NIGHTLY-ONLY: this needs a downloaded IDE + a display (xvfb on CI) and is
 * deliberately NOT part of test/smokeTest/buildPlugin. It runs from
 * {@code .github/workflows/ide-jetbrains-ui-smoke.yml} (schedule +
 * workflow_dispatch); a red nightly stays red — no continue-on-error.
 *
 * Coverage expansion queue (see GLUE_TODO "GUI smoke gate"): first message,
 * diff accept / request changes, plan review, @mention, terminal, inline
 * completion, Remote QR.
 */
final class IdeUiSmokeTest {

    private static final String ROBOT_URL =
            System.getProperty("ui.robot.url", "http://127.0.0.1:8082");
    /** The IDE may still be cold-starting when the suite begins. */
    private static final Duration CONNECT_BUDGET = Duration.ofMinutes(3);
    /** First frame after opening the sandbox project (indexing etc.). */
    private static final Duration FRAME_BUDGET = Duration.ofMinutes(5);
    private static final Duration FIND_BUDGET = Duration.ofSeconds(45);

    /** New-UI (2024.2 default) square stripe buttons carry the tool-window id
     *  as accessible name; the classic UI uses StripeButton text. Match both. */
    private static final String STRIPE_XPATH =
            "//div[(@class='SquareStripeButton' or @class='StripeButton')"
                    + " and (@text='ChainlessChain' or @tooltiptext='ChainlessChain'"
                    + " or @accessiblename='ChainlessChain')]";

    @Test
    void chainlessChainToolWindowOpens() throws Exception {
        RemoteRobot robot = connectWithRetry();
        try {
            // 1. Main IDE frame is up (runIdeForUiTests opened the sandbox
            //    project; -Didea.trust.all.projects=true skips the trust modal).
            robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='IdeFrameImpl']"), FRAME_BUDGET);

            // 2. Open the ChainlessChain tool window via its stripe button.
            ComponentFixture stripe = robot.find(ComponentFixture.class,
                    Locators.byXpath(STRIPE_XPATH), FIND_BUDGET);
            stripe.click();

            // 3. The chat panel renders: ChatToolWindowFactory installs a
            //    JBTabbedPane of conversation tabs as the tool-window content.
            robot.find(ComponentFixture.class,
                    Locators.byXpath("//div[@class='JBTabbedPane']"), FIND_BUDGET);
        } catch (Throwable t) {
            saveScreenshot(robot, "tool-window-smoke");
            throw t;
        }
    }

    /** Connect to the robot server, retrying while the sandbox IDE starts. */
    private static RemoteRobot connectWithRetry() throws InterruptedException {
        long deadline = System.nanoTime() + CONNECT_BUDGET.toNanos();
        Throwable last = null;
        while (System.nanoTime() < deadline) {
            try {
                RemoteRobot robot = new RemoteRobot(ROBOT_URL);
                // Cheap liveness probe — throws until the server answers.
                Boolean ok = robot.callJs("true");
                if (Boolean.TRUE.equals(ok)) return robot;
            } catch (Throwable t) {
                last = t;
            }
            Thread.sleep(5000);
        }
        throw new IllegalStateException(
                "robot server at " + ROBOT_URL + " did not come up within "
                        + CONNECT_BUDGET.toSeconds() + "s — is runIdeForUiTests running?",
                last);
    }

    /** Full-screen PNG into build/reports/ui-smoke/ (best-effort). */
    private static void saveScreenshot(RemoteRobot robot, String name) {
        try {
            // Canonical remote-robot screenshot script (Rhino on the IDE side).
            String base64 = robot.callJs(
                    "importPackage(java.io);"
                            + "importPackage(java.util);"
                            + "importPackage(javax.imageio);"
                            + "const screenShot = new java.awt.Robot().createScreenCapture("
                            + "  new java.awt.Rectangle(java.awt.Toolkit.getDefaultToolkit().getScreenSize()));"
                            + "let pictureBytes;"
                            + "const baos = new ByteArrayOutputStream();"
                            + "try { ImageIO.write(screenShot, 'png', baos);"
                            + "  pictureBytes = baos.toByteArray(); } finally { baos.close(); }"
                            + "Base64.getEncoder().encodeToString(pictureBytes);");
            Path dir = Paths.get("build", "reports", "ui-smoke");
            Files.createDirectories(dir);
            Path file = dir.resolve(name + "-" + System.currentTimeMillis() + ".png");
            Files.write(file, Base64.getDecoder().decode(base64));
            System.err.println("[ui-smoke] failure screenshot: " + file.toAbsolutePath());
        } catch (Throwable t) {
            System.err.println("[ui-smoke] could not capture a screenshot: " + t);
        }
    }
}
