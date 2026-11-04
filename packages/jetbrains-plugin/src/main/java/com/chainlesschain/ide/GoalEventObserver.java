package com.chainlesschain.ide;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/** Bounded native-event protocol and an owned CLI child; never reads credentials. */
public final class GoalEventObserver implements AutoCloseable {
    private volatile boolean stopped;
    private volatile boolean unexpectedStop;
    private volatile Process child;

    public static List<String> arguments(String id, String name, String scope, String connection) {
        if (connection == null || connection.isEmpty()) throw invalid();
        List<String> args = PluginManager.buildCliGoalPanelsArgs(id, name, scope, null, connection);
        args.set(1, "watch");
        args.add("--interval=1000"); args.add("--duration=60");
        return List.copyOf(args);
    }
    private static IllegalArgumentException invalid() { return new IllegalArgumentException("Goal event stream unavailable or invalid"); }
    private static Map<?, ?> exact(Object value, String... fields) {
        if (!(value instanceof Map<?, ?> map) || !map.keySet().equals(Set.of(fields))) throw invalid();
        return map;
    }
    private static boolean text(Object value, int max) {
        return value instanceof String s && !s.isEmpty() && s.length() <= max
                && !java.util.regex.Pattern.compile("[\\x00-\\x1f\\x7f-\\x9f\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]").matcher(s).find();
    }
    private static boolean counter(Object value, long min) {
        if (!(value instanceof Number n)) return false;
        double number = n.doubleValue();
        return Double.isFinite(number) && number == Math.rint(number) && number >= min && number <= 9007199254740991d;
    }
    /** Protocol state is per observation; no retained grant or reconnect token. */
    public static final class Decoder {
        private final String id, name, scope;
        private String binding;
        private int total;
        private final ArrayDeque<String> lines = new ArrayDeque<>();
        public Decoder(String id, String name, String scope, String connection) {
            arguments(id, name, scope, connection);
            this.id = id; this.name = name; this.scope = scope;
        }
        public synchronized String accept(byte[] bytes) {
            total += bytes.length + 1;
            if (bytes.length > 16384 || total > 256 * 1024) throw invalid();
            try {
                String raw = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                Map<?, ?> record = (Map<?, ?>) MiniJson.parse(raw);
                String kind = String.valueOf(record.get("kind"));
                if ("ready".equals(kind)) exact(record, "schema", "kind", "source", "plugin", "goalRef", "observedAt", "delivery", "replay");
                else exact(record, "schema", "kind", "source", "plugin", "event", "observedAt", "delivery", "replay");
                if (!"chainlesschain.goal-extension-stream/v1".equals(record.get("schema"))
                        || !"desktop-project".equals(record.get("source")) || !"polling".equals(record.get("delivery"))
                        || !Boolean.FALSE.equals(record.get("replay")) || !text(record.get("observedAt"),64)) throw invalid();
                Instant.parse((String)record.get("observedAt"));
                Map<?, ?> plugin = exact(record.get("plugin"), "name", "scope", "version");
                if (!name.equals(plugin.get("name")) || !scope.equals(plugin.get("scope")) || !text(plugin.get("version"),128)
                        || !((String)plugin.get("version")).matches("\\d+\\.\\d+\\.\\d+(?:[-+][A-Za-z0-9.+-]+)?")) throw invalid();
                Map<?, ?> event = "ready".equals(kind) ? null : exact(record.get("event"), "type", "goalRef", "summary", "occurredAt");
                Map<?, ?> ref = exact(event == null ? record.get("goalRef") : event.get("goalRef"), "id", "storeId", "revision", "controlGeneration");
                if (!id.equals(ref.get("id")) || !text(ref.get("storeId"),256)
                        || !((String)ref.get("storeId")).matches("project-goals-[a-f0-9-]{36}")
                        || !counter(ref.get("revision"),1) || !counter(ref.get("controlGeneration"),0)) throw invalid();
                String current = MiniJson.stringify(Arrays.asList(id, ref.get("storeId"), ((Number)ref.get("revision")).longValue(), ((Number)ref.get("controlGeneration")).longValue(), plugin.get("version")));
                String display;
                if ("ready".equals(kind)) {
                    if (binding != null) throw invalid();
                    binding = current;
                    display = "Observing " + id + "; polling, no history replay.";
                } else {
                    if (!"event".equals(kind) || binding == null || !binding.equals(current)
                            || !List.of("risk.review.completed", "action.receipt.updated").contains(event.get("type"))
                            || !text(event.get("summary"),4096) || !record.get("observedAt").equals(event.get("occurredAt"))) throw invalid();
                    display = record.get("observedAt") + " " + event.get("type") + ": " + event.get("summary");
                }
                lines.addLast(display);
                while (lines.size() > 50 || String.join("\n", lines).length() > 60000) lines.removeFirst();
                return String.join("\n", lines);
            } catch (Exception error) { throw invalid(); }
        }
        public synchronized void finish() { if (binding == null) throw invalid(); }
    }
    @Override public void close() {
        stopped = true;
        AgentChatSession.destroyTreeForcibly(child);
    }
    /** Blocking on the caller's worker thread; callbacks must marshal onto the EDT. */
    public void run(String binary, String id, String name, String scope, String connection,
            File cwd, Consumer<String> onText, Consumer<String> onEnd) {
        List<String> args = arguments(id, name, scope, connection);
        Decoder decoder = new Decoder(id, name, scope, connection);
        List<String> command = AgentChatSession.buildCaptureCommand(binary, args, File.separatorChar == '\\');
        if (command.isEmpty()) { onEnd.accept("unavailable"); return; }
        var deadline = Executors.newSingleThreadScheduledExecutor(runnable -> { Thread t = new Thread(runnable,"cc-goal-event-deadline"); t.setDaemon(true); return t; });
        boolean failed = false;
        Process process = null;
        Thread stderr = null;
        try {
            if (stopped) return;
            ProcessBuilder builder = new ProcessBuilder(command);
            if (cwd != null) builder.directory(cwd);
            CliLauncher.augmentPath(builder);
            process = builder.start();
            child = process;
            process.getOutputStream().close();
            if (stopped) { AgentChatSession.destroyTreeForcibly(process); return; }
            deadline.schedule(() -> { unexpectedStop = true; close(); },70,TimeUnit.SECONDS);
            Process owned = process;
            stderr = new Thread(() -> {
                try (InputStream input = owned.getErrorStream()) {
                    byte[] buffer = new byte[4096]; int count, total = 0;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > 65536) { unexpectedStop = true; close(); break; }
                    }
                } catch (Exception ignored) { }
            }, "cc-goal-event-stderr");
            stderr.setDaemon(true); stderr.start();
            try (InputStream input = process.getInputStream()) {
                byte[] buffer = new byte[4096]; int count;
                ByteArrayOutputStream line = new ByteArrayOutputStream();
                while (!stopped && (count = input.read(buffer)) != -1) {
                    for (int i=0; i<count && !stopped; i++) {
                        if (buffer[i] == '\n') {
                            byte[] bytes = line.toByteArray(); line.reset();
                            if (bytes.length > 0 && bytes[bytes.length-1] == '\r') bytes = Arrays.copyOf(bytes,bytes.length-1);
                            String display = decoder.accept(bytes);
                            if (!stopped) onText.accept(display);
                        } else { line.write(buffer[i]); if (line.size()>16384) throw invalid(); }
                    }
                }
                if (!stopped) { if (line.size()!=0) throw invalid(); decoder.finish(); }
            }
            if (!stopped && (!process.waitFor(5,TimeUnit.SECONDS) || process.exitValue()!=0)) failed = true;
        } catch (Exception error) { failed = !stopped; }
        finally {
            deadline.shutdownNow();
            if (process != null) {
                if (process.isAlive()) AgentChatSession.destroyTreeForcibly(process);
                try { if (!process.waitFor(5,TimeUnit.SECONDS)) failed = true; } catch (InterruptedException error) { Thread.currentThread().interrupt(); failed = true; }
            }
            child = null;
            if (stderr != null) try { stderr.join(1000); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            onEnd.accept(failed || unexpectedStop ? "unavailable" : stopped ? "stopped" : "ended");
        }
    }
}
