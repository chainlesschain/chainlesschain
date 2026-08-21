package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.SessionsWorkbench;
import com.chainlesschain.ide.TranscriptCap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import javax.swing.JTextPane;
import javax.swing.SwingUtilities;
import org.junit.jupiter.api.Test;

/**
 * Headless Swing evidence for the P2-4 scale gate. The test drives the same
 * transcript and session projection classes used by the installed plugin and
 * optionally emits a content-free JSON measurement document for Actions.
 */
class AccessibilityPerformanceEvidenceTest {

    private static final int MIB = 1024 * 1024;
    private static final int MESSAGE_COUNT = 2_000;
    private static final int DIFF_BYTES = 16 * MIB;
    private static final int LOG_BYTES = 64 * MIB;
    private static final int SESSION_COUNT = 128;

    @Test
    void measuresNativeTranscriptPaintAndSessionProjectionAtRequiredScale()
            throws Exception {
        final Evidence[] holder = new Evidence[1];
        SwingUtilities.invokeAndWait(() -> holder[0] = measureOnEdt());
        Evidence evidence = holder[0];

        assertEquals(MESSAGE_COUNT, evidence.messageCount);
        assertEquals(DIFF_BYTES, evidence.diffBytes);
        assertEquals(LOG_BYTES, evidence.logBytes);
        assertEquals(SESSION_COUNT, evidence.sessionCount);
        assertTrue(evidence.renderedChars <= TranscriptCap.DEFAULT_MAX_CHARS);
        assertTrue(evidence.diffMarkerVisible, evidence.toJson());
        assertTrue(evidence.logMarkerVisible, evidence.toJson());
        assertTrue(evidence.accessibleNamePresent);
        assertTrue(evidence.accessibleDescriptionPresent);
        assertTrue(evidence.focusable);
        assertFalse(evidence.inputToPaintMs.isEmpty());
        assertFalse(evidence.scrollToPaintMs.isEmpty());

        String output = System.getenv("CC_P2_JETBRAINS_EVIDENCE");
        if (output != null && !output.isBlank()) {
            writeEvidence(Path.of(output), evidence);
        }
    }

    private static Evidence measureOnEdt() {
        long heapBefore = usedHeap();
        ChatTranscript transcript = new ChatTranscript();
        JTextPane pane = transcript.pane();
        pane.setSize(1_200, 800);
        BufferedImage image = new BufferedImage(
                1_200, 800, BufferedImage.TYPE_INT_ARGB);
        Graphics2D graphics = image.createGraphics();
        List<Double> inputToPaint = new ArrayList<>();
        try {
            for (int batch = 0; batch < 100; batch++) {
                long started = System.nanoTime();
                for (int offset = 0; offset < 20; offset++) {
                    int index = batch * 20 + offset;
                    transcript.append(String.format(
                            Locale.ROOT, "%04d:%s%n", index, "x".repeat(122)));
                }
                pane.paint(graphics);
                inputToPaint.add(elapsedMillis(started));
            }

            String rendered = pane.getText().replace("\r\n", "\n");
            boolean newestVisible = rendered.contains("1999:");
            boolean oldestRemoved = !rendered.contains("0000:");

            transcript.clear();
            long diffPaintStarted = System.nanoTime();
            transcript.appendAssistantDelta("DIFF_HEAD");
            appendRepeated(transcript, 'd', DIFF_BYTES - 18);
            transcript.appendAssistantDelta("DIFF_TAIL");
            transcript.finalizeAssistantRun();
            pane.paint(graphics);
            double diffPaintMs = elapsedMillis(diffPaintStarted);
            String diff = pane.getText().replace("\r\n", "\n");

            transcript.clear();
            long logPaintStarted = System.nanoTime();
            transcript.appendAssistantDelta("LOG_HEAD");
            appendRepeated(transcript, 'l', LOG_BYTES - 16);
            transcript.appendAssistantDelta("LOG_TAIL");
            transcript.finalizeAssistantRun();
            pane.paint(graphics);
            double logPaintMs = elapsedMillis(logPaintStarted);
            String log = pane.getText().replace("\r\n", "\n");

            List<Double> scrollToPaint = new ArrayList<>();
            int documentLength = pane.getDocument().getLength();
            for (int sample = 0; sample < 100; sample++) {
                long started = System.nanoTime();
                int position = (int) (((long) documentLength * sample) / 99L);
                pane.setCaretPosition(Math.min(position, documentLength));
                pane.paint(graphics);
                scrollToPaint.add(elapsedMillis(started));
            }

            StringBuilder sessionsJson = new StringBuilder("[");
            for (int index = 0; index < SESSION_COUNT; index++) {
                if (index > 0) sessionsJson.append(',');
                sessionsJson.append(String.format(
                        Locale.ROOT,
                        "{\"id\":\"session-%d\",\"title\":\"Scale session %d\","
                                + "\"updated_at\":\"2026-08-20T00:00:00Z\"}",
                        index, index));
            }
            sessionsJson.append(']');
            List<SessionsWorkbench.Row> sessions =
                    SessionsWorkbench.chatRows(sessionsJson.toString());
            long sessionStarted = System.nanoTime();
            List<SessionsWorkbench.Row> filtered =
                    SessionsWorkbench.filter(sessions, "scale session 127");
            double sessionProjectionMs = elapsedMillis(sessionStarted);

            return new Evidence(
                    MESSAGE_COUNT,
                    DIFF_BYTES,
                    LOG_BYTES,
                    sessions.size(),
                    rendered.length(),
                    rendered.length() <= TranscriptCap.DEFAULT_MAX_CHARS
                            && newestVisible
                            && oldestRemoved,
                    diff.contains("Turn 1, Assistant response\nDIFF_HEAD")
                            && diff.contains("characters omitted")
                            && diff.endsWith("DIFF_TAIL"),
                    log.contains("Turn 1, Assistant response\nLOG_HEAD")
                            && log.contains("characters omitted")
                            && log.endsWith("LOG_TAIL"),
                    "Conversation transcript".equals(
                            pane.getAccessibleContext().getAccessibleName()),
                    pane.getAccessibleContext().getAccessibleDescription() != null,
                    pane.isFocusable(),
                    filtered.size() == 1 && "session-127".equals(filtered.get(0).id),
                    inputToPaint,
                    scrollToPaint,
                    diffPaintMs,
                    logPaintMs,
                    sessionProjectionMs,
                    heapBefore,
                    usedHeap(),
                    openFileDescriptorCount());
        } finally {
            graphics.dispose();
        }
    }

    private static double elapsedMillis(long startedNanos) {
        return (System.nanoTime() - startedNanos) / 1_000_000.0;
    }

    private static void appendRepeated(
            ChatTranscript transcript, char value, int count) {
        String chunk = String.valueOf(value).repeat(MIB);
        int remaining = count;
        while (remaining > 0) {
            int length = Math.min(remaining, chunk.length());
            transcript.appendAssistantDelta(
                    length == chunk.length() ? chunk : chunk.substring(0, length));
            remaining -= length;
        }
    }

    private static long usedHeap() {
        Runtime runtime = Runtime.getRuntime();
        return runtime.totalMemory() - runtime.freeMemory();
    }

    private static long openFileDescriptorCount() {
        java.lang.management.OperatingSystemMXBean bean =
                ManagementFactory.getOperatingSystemMXBean();
        if (bean instanceof com.sun.management.UnixOperatingSystemMXBean) {
            return ((com.sun.management.UnixOperatingSystemMXBean) bean)
                    .getOpenFileDescriptorCount();
        }
        return -1L;
    }

    private static void writeEvidence(Path output, Evidence evidence)
            throws IOException {
        Path parent = output.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);
        Files.writeString(
                output,
                evidence.toJson() + "\n",
                StandardCharsets.UTF_8);
    }

    private static String numbers(List<Double> values) {
        StringBuilder out = new StringBuilder("[");
        for (int index = 0; index < values.size(); index++) {
            if (index > 0) out.append(',');
            out.append(String.format(Locale.ROOT, "%.6f", values.get(index)));
        }
        return out.append(']').toString();
    }

    private static String percentiles(List<Double> values) {
        List<Double> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        return String.format(
                Locale.ROOT,
                "{\"samples\":%d,\"p50Ms\":%.6f,\"p95Ms\":%.6f,\"p99Ms\":%.6f}",
                sorted.size(),
                percentile(sorted, 50),
                percentile(sorted, 95),
                percentile(sorted, 99));
    }

    private static double percentile(List<Double> sorted, int percentile) {
        int index = Math.max(
                0,
                (int) Math.ceil((percentile / 100.0) * sorted.size()) - 1);
        return sorted.get(index);
    }

    private static final class Evidence {
        final int messageCount;
        final int diffBytes;
        final int logBytes;
        final int sessionCount;
        final int renderedChars;
        final boolean transcriptBounded;
        final boolean diffMarkerVisible;
        final boolean logMarkerVisible;
        final boolean accessibleNamePresent;
        final boolean accessibleDescriptionPresent;
        final boolean focusable;
        final boolean sessionProjectionComplete;
        final List<Double> inputToPaintMs;
        final List<Double> scrollToPaintMs;
        final double diffPaintMs;
        final double logPaintMs;
        final double sessionProjectionMs;
        final long heapBeforeBytes;
        final long heapAfterBytes;
        final long openFileDescriptorCount;

        Evidence(
                int messageCount,
                int diffBytes,
                int logBytes,
                int sessionCount,
                int renderedChars,
                boolean transcriptBounded,
                boolean diffMarkerVisible,
                boolean logMarkerVisible,
                boolean accessibleNamePresent,
                boolean accessibleDescriptionPresent,
                boolean focusable,
                boolean sessionProjectionComplete,
                List<Double> inputToPaintMs,
                List<Double> scrollToPaintMs,
                double diffPaintMs,
                double logPaintMs,
                double sessionProjectionMs,
                long heapBeforeBytes,
                long heapAfterBytes,
                long openFileDescriptorCount) {
            this.messageCount = messageCount;
            this.diffBytes = diffBytes;
            this.logBytes = logBytes;
            this.sessionCount = sessionCount;
            this.renderedChars = renderedChars;
            this.transcriptBounded = transcriptBounded;
            this.diffMarkerVisible = diffMarkerVisible;
            this.logMarkerVisible = logMarkerVisible;
            this.accessibleNamePresent = accessibleNamePresent;
            this.accessibleDescriptionPresent = accessibleDescriptionPresent;
            this.focusable = focusable;
            this.sessionProjectionComplete = sessionProjectionComplete;
            this.inputToPaintMs = inputToPaintMs;
            this.scrollToPaintMs = scrollToPaintMs;
            this.diffPaintMs = diffPaintMs;
            this.logPaintMs = logPaintMs;
            this.sessionProjectionMs = sessionProjectionMs;
            this.heapBeforeBytes = heapBeforeBytes;
            this.heapAfterBytes = heapAfterBytes;
            this.openFileDescriptorCount = openFileDescriptorCount;
        }

        String toJson() {
            return "{"
                    + "\"schema\":\"chainlesschain.jetbrains-accessibility-performance.v1\","
                    + "\"measurementSurface\":\"headless-swing-product-components\","
                    + "\"messageCount\":" + messageCount + ','
                    + "\"diffBytes\":" + diffBytes + ','
                    + "\"logBytes\":" + logBytes + ','
                    + "\"sessionCount\":" + sessionCount + ','
                    + "\"renderedChars\":" + renderedChars + ','
                    + "\"transcriptBounded\":" + transcriptBounded + ','
                    + "\"diffMarkerVisible\":" + diffMarkerVisible + ','
                    + "\"logMarkerVisible\":" + logMarkerVisible + ','
                    + "\"accessibleNamePresent\":" + accessibleNamePresent + ','
                    + "\"accessibleDescriptionPresent\":"
                    + accessibleDescriptionPresent + ','
                    + "\"focusable\":" + focusable + ','
                    + "\"sessionProjectionComplete\":"
                    + sessionProjectionComplete + ','
                    + "\"inputToPaint\":" + percentiles(inputToPaintMs) + ','
                    + "\"scrollToPaint\":" + percentiles(scrollToPaintMs) + ','
                    + "\"inputToPaintSamplesMs\":" + numbers(inputToPaintMs) + ','
                    + "\"scrollToPaintSamplesMs\":" + numbers(scrollToPaintMs) + ','
                    + String.format(
                            Locale.ROOT,
                            "\"diffPaintMs\":%.6f,\"logPaintMs\":%.6f,"
                                    + "\"sessionProjectionMs\":%.6f,",
                            diffPaintMs, logPaintMs, sessionProjectionMs)
                    + "\"heapBeforeBytes\":" + heapBeforeBytes + ','
                    + "\"heapAfterBytes\":" + heapAfterBytes + ','
                    + "\"openFileDescriptorCount\":" + openFileDescriptorCount
                    + "}";
        }
    }
}
