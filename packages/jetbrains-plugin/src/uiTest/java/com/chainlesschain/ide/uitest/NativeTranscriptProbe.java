package com.chainlesschain.ide.uitest;

import java.awt.GraphicsEnvironment;
import java.awt.Point;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.FutureTask;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextPane;
import javax.swing.JViewport;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.text.StyleConstants;

/**
 * Test-only probe loaded into the real IDE JVM, never shipped in the plugin ZIP.
 * Measures sampled EDT updates and synchronous visible-region paint requests.
 * Timer intervals are NOT display frames; long tasks cover these callbacks only.
 */
public final class NativeTranscriptProbe {
    private static final int[] SIZES = {10_000, 100_000, 200_000};
    private static final int TICKS = 64;
    private static final int PERIOD_MS = 16;
    private final Object transcript;
    private final JTextPane pane;
    private final JViewport viewport;
    private final JScrollPane scroll;
    private final Path destination;
    private final Map<String, Object> report = new LinkedHashMap<>();
    private final List<Object> cases = new ArrayList<>();
    private final Timer timer;
    private Map<String, Object> current;
    private List<Object> samples;
    private String payload;
    private int caseIndex;
    private int tick;
    private int sent;
    private int runStart;
    private long previousTick;

    public static Object activeView(Object frame, ClassLoader pluginLoader) throws Exception {
        return onEdt(() -> {
            Class<?> factory = Class.forName("com.chainlesschain.ide.intellij.ChatToolWindowFactory", true, pluginLoader);
            Field registry = factory.getDeclaredField("REGISTRY");
            registry.setAccessible(true);
            Object project = frame.getClass().getMethod("getProject").invoke(frame);
            Object panel = ((Map<?, ?>) registry.get(null)).get(project);
            int index = ((JTabbedPane) read(panel, "tabs")).getSelectedIndex();
            Object id = ((List<?>) read(panel, "tabIds")).get(index);
            return ((Map<?, ?>) read(panel, "views")).get(id);
        });
    }

    public static void start(Object view, String destination, String token,
                             String ideVersion, String ideBuild) throws Exception {
        if (GraphicsEnvironment.isHeadless())
            throw new IllegalStateException("A real non-headless IDE is required");
        Object identity = observeIdentity(view);
        onEdt(() -> {
            Map<String, Object> readiness = readyState(view, identity);
            if (!Boolean.TRUE.equals(readiness.get("ready"))) throw new IllegalStateException("Transcript is not ready");
            NativeTranscriptProbe probe = new NativeTranscriptProbe(read(view, "transcript"), Path.of(destination), token, ideVersion, ideBuild);
            probe.report.put("readiness", readiness);
            probe.beginCase();
            return null;
        });
    }

    public static String readiness(Object view) throws Exception {
        Object identity = observeIdentity(view);
        return json(onEdt(() -> readyState(view, identity)));
    }

    // The production view deliberately has no process-global version cache.
    // Observe the actual configured command off the EDT, then verify its
    // configuration revision together with the visible state on the EDT.
    private static Object observeIdentity(Object view) throws Exception {
        if (SwingUtilities.isEventDispatchThread())
            throw new IllegalStateException("CLI identity must be observed off EDT");
        ClassLoader loader = view.getClass().getClassLoader();
        File cwd = onEdt(() -> {
            Object project = read(view, "project");
            Class<?> projectApi = Class.forName("com.intellij.openapi.project.Project", true, loader);
            String basePath = (String) projectApi.getMethod("getBasePath").invoke(project);
            return basePath == null ? null : new File(basePath);
        });
        Class<?> session = Class.forName("com.chainlesschain.ide.AgentChatSession", true, loader);
        return session.getMethod("probeCliIdentity", File.class, long.class).invoke(null, cwd, 12000L);
    }

    private static <T> T onEdt(Callable<T> operation) throws Exception {
        FutureTask<T> task = new FutureTask<>(operation);
        SwingUtilities.invokeAndWait(task);
        return task.get();
    }

    static boolean fixtureIdentityObserved(Object identity) throws Exception {
        return Boolean.TRUE.equals(identity.getClass().getMethod("isCurrent").invoke(identity))
                && String.valueOf(read(identity, "output")).trim().equals("0.999.0-ui-journey")
                && read(identity, "version") != null;
    }

    private static Object read(Object object, String name) throws Exception {
        Field field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(object);
    }

    private static Map<String, Object> readyState(Object view, Object identity) throws Exception {
        if (!SwingUtilities.isEventDispatchThread()) throw new IllegalStateException("Readiness must be observed on EDT");
        Object transcript = read(view, "transcript"), drafts = read(view, "drafts"), history = read(view, "history"), conv = read(view, "conv");
        JTextPane pane = (JTextPane) read(transcript, "pane");
        Method draftReady = drafts.getClass().getDeclaredMethod("ready");
        draftReady.setAccessible(true);
        Class<?> bundle = Class.forName("com.chainlesschain.ide.intellij.CcBundle", true, view.getClass().getClassLoader());
        String onboarding = (String) bundle.getMethod("message", String.class, Object[].class).invoke(null, "chat.noLlm", new Object[0]);
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("initialProbesStarted", read(view, "initialProbesStarted"));
        state.put("fixtureVersionObserved", fixtureIdentityObserved(identity));
        state.put("onboardingObserved", pane.getDocument().getText(0, pane.getDocument().getLength()).contains(onboarding));
        state.put("draftReady", draftReady.invoke(drafts));
        state.put("inputEditable", ((javax.swing.JTextArea) read(view, "input")).isEditable());
        state.put("historyIdle", read(history, "request") == null && read(history, "deferred") == null && !((Boolean) read(history, "pending")));
        state.put("turnIdle", !((Boolean) read(view, "sendInFlight")) && !((Boolean) read(view, "turnActive")));
        state.put("sessionAbsent", read(conv, "session") == null);
        state.put("paneShowing", pane.isShowing());
        state.put("ready", state.values().stream().allMatch(Boolean.TRUE::equals));
        state.put("conversationId", String.valueOf(read(conv, "draftKey")));
        state.put("documentChars", pane.getDocument().getLength());
        return state;
    }

    private NativeTranscriptProbe(Object transcript, Path destination, String token,
                                  String ideVersion, String ideBuild) throws Exception {
        this.transcript = transcript;
        this.destination = destination;
        pane = (JTextPane) field("pane");
        if (!pane.isShowing() || !(pane.getParent() instanceof JViewport))
            throw new IllegalStateException("The installed transcript must be showing in a viewport");
        viewport = (JViewport) pane.getParent();
        scroll = (JScrollPane) SwingUtilities.getAncestorOfClass(JScrollPane.class, pane);
        if (scroll == null) throw new IllegalStateException("Missing transcript scroll pane");
        report.put("schema", "cc-jetbrains-native-transcript/v1");
        report.put("profile", "installed-plugin-native-swing");
        report.put("instrumentation", "ui-test-reflection");
        report.put("paintMode", "visible-region-paintImmediately");
        report.put("longTaskScope", "sampled-probe-edt-tasks");
        report.put("timingDomain", "jvm-System.nanoTime");
        report.put("chromiumFrames", false);
        report.put("sloStatus", "not-evaluated");
        report.put("headless", GraphicsEnvironment.isHeadless());
        report.put("processId", String.valueOf(ProcessHandle.current().pid()));
        report.put("javaVersion", System.getProperty("java.version"));
        report.put("osName", System.getProperty("os.name"));
        report.put("osArch", System.getProperty("os.arch"));
        report.put("ideVersion", ideVersion);
        report.put("ideBuild", ideBuild);
        report.put("runToken", token);
        report.put("startedAt", Instant.now().toString());
        report.put("periodMs", PERIOD_MS);
        report.put("longTaskThresholdMs", 50);
        report.put("cases", cases);
        timer = new Timer(PERIOD_MS, ignored -> sample());
        timer.setCoalesce(true);
    }

    private Object field(String name) throws Exception {
        Field field = transcript.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(transcript);
    }

    private void invoke(String name, String value) throws Exception {
        Method method = transcript.getClass().getDeclaredMethod(name, String.class);
        method.setAccessible(true);
        method.invoke(transcript, value);
    }

    private void invoke(String name) throws Exception {
        Method method = transcript.getClass().getDeclaredMethod(name);
        method.setAccessible(true);
        method.invoke(transcript);
    }

    private void beginCase() throws Exception {
        invoke("clear");
        current = new LinkedHashMap<>();
        samples = new ArrayList<>();
        int size = SIZES[caseIndex];
        String line = "**stream** code 中文 with stable selection and scrolling.\n";
        payload = line.repeat(size / line.length() + 1).substring(0, size);
        current.put("requestedChars", size);
        current.put("samples", samples);
        current.put("sampleCount", TICKS);
        current.put("allSamplesOnEdt", true);
        current.put("allSamplesShowing", true);
        cases.add(current);
        tick = 0; sent = 0;
        previousTick = System.nanoTime();
        timer.start();
    }

    private Map<String, Object> snapshot() throws Exception {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("selectionStart", pane.getSelectionStart());
        value.put("selectionEnd", pane.getSelectionEnd());
        value.put("selectedText", pane.getSelectedText() == null ? "" : pane.getSelectedText());
        value.put("viewportY", viewport.getViewPosition().y);
        value.put("viewportHeight", viewport.getExtentSize().height);
        value.put("paneHeight", pane.getHeight());
        value.put("documentLength", pane.getDocument().getLength());
        value.put("caretPosition", pane.getCaretPosition());
        value.put("bottomSlop", Math.max(24, pane.getFont().getSize() * 2));
        value.put("followingBottom", viewport.getViewPosition().y + viewport.getExtentSize().height
                >= pane.getHeight() - Math.max(24, pane.getFont().getSize() * 2));
        return value;
    }

    private double paint() {
        scroll.validate();
        var visible = pane.getVisibleRect();
        if (!pane.isShowing() || visible.width <= 0 || visible.height <= 0)
            throw new IllegalStateException("No visible native paint region");
        long start = System.nanoTime();
        pane.paintImmediately(visible);
        return elapsed(start);
    }

    private static double elapsed(long start) { return (System.nanoTime() - start) / 1_000_000.0; }

    private void sample() {
        long start = System.nanoTime();
        try {
            if (!SwingUtilities.isEventDispatchThread()) throw new IllegalStateException("Not EDT");
            if (tick > 0 && (!(Boolean) field("inAssistantRun")
                    || ((Number) field("assistantRunStart")).intValue() != runStart
                    || pane.getDocument().getLength() != Math.min(200_000, runStart + sent))) {
                report.put("failureKind", "concurrent-transcript-mutation");
                throw new IllegalStateException("Concurrent transcript mutation invalidates the measurement");
            }
            if (tick == TICKS) { finishCase(); return; }
            // Observe the previous phase after caret/revalidate invokeLater work
            // has settled, before this callback's next document insertion.
            if (tick == 16) {
                current.put("followingBeforeSelection", snapshot());
                pane.select(runStart + 16, runStart + 28);
                viewport.setViewPosition(new Point(0, 0));
                current.put("selectionBefore", snapshot());
            } else if (tick == 32) {
                current.put("selectionAfter", snapshot());
                pane.setCaretPosition(runStart + 16);
                viewport.setViewPosition(new Point(0, 0));
                current.put("scrollBefore", snapshot());
            } else if (tick == 48) {
                current.put("scrollAfter", snapshot());
                pane.setCaretPosition(pane.getDocument().getLength());
                viewport.setViewPosition(new Point(0,
                        Math.max(0, pane.getHeight() - viewport.getExtentSize().height)));
            }
            Map<String, Object> sample = new LinkedHashMap<>();
            double interval = (start - previousTick) / 1_000_000.0;
            previousTick = start;
            int end = (tick + 1) * payload.length() / TICKS;
            long update = System.nanoTime();
            invoke("appendAssistantDelta", payload.substring(sent, end));
            double updateMs = elapsed(update);
            if (tick == 0) runStart = ((Number) field("assistantRunStart")).intValue();
            sample.put("ordinal", tick + 1);
            sample.put("appendedChars", end - sent);
            sample.put("updateMs", updateMs);
            sample.put("paintMs", paint());
            sample.put("intervalMs", interval);
            sample.put("queueDelayMs", Math.max(0, interval - PERIOD_MS));
            sent = end;
            tick++;
            sample.put("taskMs", elapsed(start));
            samples.add(sample);
        } catch (Throwable error) { fail(error); }
    }

    private void finishCase() throws Exception {
        timer.stop();
        current.put("followingAfterResume", snapshot());
        current.put("streamedChars", sent);
        String retained = pane.getDocument().getText(runStart, pane.getDocument().getLength() - runStart);
        current.put("retainedChars", retained.length());
        current.put("capApplied", retained.length() < sent);
        current.put("plainBeforeFinalize", !StyleConstants.isBold(
                pane.getStyledDocument().getCharacterElement(runStart).getAttributes()));
        Map<String, Object> finish = new LinkedHashMap<>();
        long taskStart = System.nanoTime();
        finish.put("activeBefore", field("inAssistantRun"));
        finish.put("beforeLength", pane.getDocument().getLength());
        long update = System.nanoTime();
        invoke("finalizeAssistantRun");
        finish.put("updateMs", elapsed(update));
        finish.put("paintMs", paint());
        finish.put("taskMs", elapsed(taskStart));
        finish.put("finalizeCalls", 1);
        // No production counters/bytecode patches: do not claim parse-call counts.
        finish.put("markdownParseCalls", null);
        finish.put("markdownParseInstrumentation", "not-instrumented");
        finish.put("activeAfter", field("inAssistantRun"));
        finish.put("afterLength", pane.getDocument().getLength());
        finish.put("boldAfterFinalize", StyleConstants.isBold(
                pane.getStyledDocument().getCharacterElement(runStart).getAttributes()));
        current.put("finish", finish);
        caseIndex++;
        if (caseIndex < SIZES.length) {
            SwingUtilities.invokeLater(() -> { try { beginCase(); } catch (Throwable error) { fail(error); } });
        } else {
            invoke("clear");
            report.put("finishedAt", Instant.now().toString());
            report.put("status", "measured");
            write();
        }
    }

    private void fail(Throwable error) {
        timer.stop();
        report.put("finishedAt", Instant.now().toString());
        report.put("status", "failed");
        report.put("failureClass", error.getClass().getName());
        try { write(); } catch (Exception ignored) { /* polling driver fails without a receipt */ }
    }

    private void write() throws Exception {
        // Atomic rename prevents the polling UI-test client from reading partial JSON.
        Path temporary = destination.resolveSibling(destination.getFileName() + ".pending");
        Files.writeString(temporary, json(report) + "\n", StandardOpenOption.CREATE_NEW);
        Files.move(temporary, destination, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
    }

    private static String json(Object value) {
        if (value == null) return "null";
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?, ?> map) {
            List<String> entries = new ArrayList<>();
            for (var entry : map.entrySet()) entries.add(json(entry.getKey()) + ":" + json(entry.getValue()));
            return "{" + String.join(",", entries) + "}";
        }
        if (value instanceof List<?> list) {
            List<String> entries = new ArrayList<>();
            for (Object entry : list) entries.add(json(entry));
            return "[" + String.join(",", entries) + "]";
        }
        String text = String.valueOf(value);
        StringBuilder result = new StringBuilder("\"");
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '\\' || c == '"') result.append('\\').append(c);
            else if (c < 32) result.append(String.format("\\u%04x", (int)c));
            else result.append(c);
        }
        return result.append('"').toString();
    }
}
