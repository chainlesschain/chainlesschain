package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

/**
 * Debounced URI/version diagnostics scheduler shared by the JetBrains facade
 * and the fixed-scale evidence profile.
 *
 * <p>Readers execute on one daemon worker, never on the Swing EDT. A newer
 * generation cancels publication by an older generation. Callers only receive
 * the last complete immutable snapshot, and payload size/message length are
 * bounded before data reaches Context Center or the bridge.</p>
 */
public final class DiagnosticsSnapshotScheduler implements AutoCloseable {

    public static final String SCHEMA = "cc-diagnostics-snapshot/v1";
    public static final int DEFAULT_MAX_DIAGNOSTICS = 10_000;
    public static final int DEFAULT_MAX_MESSAGE_CHARS = 2_000;
    public static final long DEFAULT_DEBOUNCE_MS = 50L;
    public static final int DEFAULT_CONTEXT_BYTES = 64 * 1024;
    private static final int SLICE_ITEMS = 256;

    @FunctionalInterface
    public interface Reader {
        List<Map<String, Object>> read() throws Exception;
    }

    public static final class Update {
        public final String uri;
        public final String file;
        public final Long documentVersion;
        public final Boolean dirty;
        public final Reader reader;

        public Update(
                String uri,
                String file,
                Long documentVersion,
                Boolean dirty,
                Reader reader) {
            this.uri = bound(uri, 2_048);
            this.file = bound(file, 2_048);
            this.documentVersion = documentVersion;
            this.dirty = dirty;
            this.reader = reader;
        }
    }

    public static final class Snapshot {
        public final String schema;
        public final long generation;
        public final boolean stable;
        public final long capturedAtMs;
        public final List<Map<String, Object>> diagnostics;
        public final List<Map<String, Object>> versions;
        public final Map<String, Long> summary;

        private Snapshot(
                long generation,
                List<Map<String, Object>> diagnostics,
                List<Map<String, Object>> versions,
                Map<String, Long> summary) {
            this.schema = SCHEMA;
            this.generation = generation;
            this.stable = true;
            this.capturedAtMs = generation == 0L
                    ? 0L : System.currentTimeMillis();
            this.diagnostics = Collections.unmodifiableList(diagnostics);
            this.versions = Collections.unmodifiableList(versions);
            this.summary = Collections.unmodifiableMap(summary);
        }
    }

    private static final class DocumentState {
        final Long version;
        final List<Map<String, Object>> diagnostics;

        DocumentState(Long version, List<Map<String, Object>> diagnostics) {
            this.version = version;
            this.diagnostics = diagnostics;
        }
    }

    private static final class PendingUpdate {
        final Update update;
        final long generation;

        PendingUpdate(Update update, long generation) {
            this.update = update;
            this.generation = generation;
        }
    }

    private final Object lock = new Object();
    private final int maxDiagnostics;
    private final int maxMessageChars;
    private final long debounceMs;
    private final ScheduledExecutorService executor;
    private final Map<String, DocumentState> documents = new HashMap<>();
    private final Map<String, PendingUpdate> pending = new HashMap<>();
    private final Map<String, Long> latestRequestedVersions = new HashMap<>();
    private final Map<String, Long> stats = new LinkedHashMap<>();
    private Snapshot snapshot = emptySnapshot();
    private ScheduledFuture<?> scheduled;
    private long generation;
    private boolean processing;
    private boolean replaceAllPending;
    private boolean closed;

    public DiagnosticsSnapshotScheduler() {
        this(DEFAULT_MAX_DIAGNOSTICS, DEFAULT_MAX_MESSAGE_CHARS,
                DEFAULT_DEBOUNCE_MS);
    }

    public DiagnosticsSnapshotScheduler(
            int maxDiagnostics,
            int maxMessageChars,
            long debounceMs) {
        this.maxDiagnostics = Math.max(1, maxDiagnostics);
        this.maxMessageChars = Math.max(1, maxMessageChars);
        this.debounceMs = Math.max(0L, debounceMs);
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(
                    runnable, "chainlesschain-diagnostics-snapshot");
            thread.setDaemon(true);
            return thread;
        };
        executor = Executors.newSingleThreadScheduledExecutor(factory);
        for (String key : List.of(
                "requestedGenerationCount",
                "committedGenerationCount",
                "canceledGenerationCount",
                "staleRequestSuppressedCount",
                "duplicateDiagnosticSuppressedCount",
                "readErrorCount",
                "maxWorkSliceMicros",
                "publishedDuplicateCount",
                "publishedStaleVersionCount")) {
            stats.put(key, 0L);
        }
    }

    public long schedule(Collection<Update> updates) {
        return schedule(updates, false);
    }

    public long schedule(Collection<Update> updates, boolean replaceAll) {
        synchronized (lock) {
            if (closed) return generation;
            generation += 1L;
            increment("requestedGenerationCount");
            if (scheduled != null || processing) {
                increment("canceledGenerationCount");
            }
            if (replaceAll) {
                pending.clear();
                latestRequestedVersions.clear();
            }
            if (updates != null) {
                for (Update update : updates) {
                    if (update == null || update.uri.isEmpty()
                            || update.reader == null) continue;
                    Long latest = latestRequestedVersions.get(update.uri);
                    if (update.documentVersion != null && latest != null
                            && update.documentVersion < latest) {
                        increment("staleRequestSuppressedCount");
                        continue;
                    }
                    if (update.documentVersion != null) {
                        latestRequestedVersions.put(
                                update.uri, update.documentVersion);
                    }
                    pending.put(update.uri,
                            new PendingUpdate(update, generation));
                }
            }
            replaceAllPending = replaceAllPending || replaceAll;
            if (scheduled != null) scheduled.cancel(false);
            long requestedGeneration = generation;
            scheduled = executor.schedule(
                    () -> drain(requestedGeneration),
                    debounceMs,
                    TimeUnit.MILLISECONDS);
            return generation;
        }
    }

    public Snapshot flushNow(long timeoutMs) throws InterruptedException {
        synchronized (lock) {
            if (closed) return snapshot;
            if (scheduled != null) {
                scheduled.cancel(false);
                scheduled = null;
            }
            if (!processing && (!pending.isEmpty() || replaceAllPending)) {
                long requestedGeneration = generation;
                executor.execute(() -> drain(requestedGeneration));
            }
        }
        return awaitStable(timeoutMs);
    }

    public Snapshot awaitStable(long timeoutMs) throws InterruptedException {
        long deadline = System.nanoTime()
                + TimeUnit.MILLISECONDS.toNanos(Math.max(1L, timeoutMs));
        synchronized (lock) {
            while (!closed && (processing || scheduled != null
                    || !pending.isEmpty() || replaceAllPending)) {
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0L) {
                    throw new IllegalStateException(
                            "diagnostics snapshot did not stabilize before timeout");
                }
                TimeUnit.NANOSECONDS.timedWait(lock, remaining);
            }
            return snapshot;
        }
    }

    public Snapshot getSnapshot() {
        synchronized (lock) {
            return snapshot;
        }
    }

    public Map<String, Long> getStats() {
        synchronized (lock) {
            return Collections.unmodifiableMap(new LinkedHashMap<>(stats));
        }
    }

    public List<Map<String, Object>> diagnosticsForPath(String path) {
        Snapshot current = getSnapshot();
        if (path == null || path.isEmpty()) return current.diagnostics;
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> diagnostic : current.diagnostics) {
            if (samePath(path, String.valueOf(diagnostic.get("file")))) {
                out.add(diagnostic);
            }
        }
        return Collections.unmodifiableList(out);
    }

    public static String contextText(Snapshot snapshot) {
        if (snapshot == null || !snapshot.stable) return "";
        Map<String, Long> summary = snapshot.summary;
        String first = "stable diagnostics snapshot generation="
                + snapshot.generation + " total=" + summary.get("total")
                + " errors=" + summary.get("error")
                + " warnings=" + summary.get("warning")
                + " information=" + summary.get("information")
                + " hints=" + summary.get("hint")
                + " truncated=" + summary.get("truncatedCount");
        StringBuilder out = new StringBuilder(first);
        int bytes = first.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
        for (Map<String, Object> item : snapshot.diagnostics) {
            String line = "\n" + item.get("severity") + " "
                    + (String.valueOf(item.get("file")).isEmpty()
                            ? item.get("documentUri") : item.get("file"))
                    + ":" + oneBased(item.get("line"))
                    + ":" + oneBased(item.get("character"))
                    + " " + item.get("message");
            int lineBytes = line.getBytes(
                    java.nio.charset.StandardCharsets.UTF_8).length;
            if (bytes + lineBytes > DEFAULT_CONTEXT_BYTES) {
                out.append("\n…(diagnostics context payload bounded)");
                break;
            }
            out.append(line);
            bytes += lineBytes;
        }
        return out.toString();
    }

    private void drain(long requestedGeneration) {
        final List<PendingUpdate> updates;
        final boolean replaceAll;
        synchronized (lock) {
            if (closed || processing) return;
            processing = true;
            scheduled = null;
            updates = new ArrayList<>();
            for (PendingUpdate value : pending.values()) {
                if (value.generation <= requestedGeneration) {
                    updates.add(value);
                }
            }
            for (PendingUpdate value : updates) {
                pending.remove(value.update.uri);
            }
            replaceAll = replaceAllPending;
            replaceAllPending = false;
        }

        Map<String, DocumentState> next;
        synchronized (lock) {
            next = replaceAll ? new HashMap<>() : new HashMap<>(documents);
        }
        boolean publish = true;
        try {
            updates.sort(Comparator.comparing(value -> value.update.uri));
            for (PendingUpdate pendingUpdate : updates) {
                if (!isCurrent(requestedGeneration)) {
                    publish = false;
                    break;
                }
                Update update = pendingUpdate.update;
                List<Map<String, Object>> raw;
                try {
                    raw = update.reader.read();
                } catch (Exception error) {
                    synchronized (lock) { increment("readErrorCount"); }
                    continue;
                }
                if (!isCurrent(requestedGeneration)) {
                    publish = false;
                    break;
                }
                List<Map<String, Object>> normalized = normalize(update, raw);
                if (normalized.isEmpty()) next.remove(update.uri);
                else next.put(update.uri,
                        new DocumentState(update.documentVersion, normalized));
            }
            if (publish && isCurrent(requestedGeneration)) {
                Snapshot nextSnapshot = buildSnapshot(
                        requestedGeneration, next);
                synchronized (lock) {
                    if (requestedGeneration == generation && !closed) {
                        documents.clear();
                        documents.putAll(next);
                        snapshot = nextSnapshot;
                        increment("committedGenerationCount");
                    }
                }
            }
        } finally {
            synchronized (lock) {
                processing = false;
                if (!closed && requestedGeneration != generation) {
                    boolean newerReplaceAll = replaceAllPending;
                    if (!newerReplaceAll) {
                        for (PendingUpdate value : updates) {
                            if (!pending.containsKey(value.update.uri)) {
                                pending.put(value.update.uri,
                                        new PendingUpdate(
                                                value.update, generation));
                            }
                        }
                    }
                    replaceAllPending = newerReplaceAll || replaceAll;
                }
                if (!closed && scheduled == null
                        && (!pending.isEmpty() || replaceAllPending)) {
                    long nextGeneration = generation;
                    scheduled = executor.schedule(
                            () -> drain(nextGeneration),
                            debounceMs,
                            TimeUnit.MILLISECONDS);
                }
                lock.notifyAll();
            }
        }
    }

    private List<Map<String, Object>> normalize(
            Update update, List<Map<String, Object>> raw) {
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> keys = new HashSet<>();
        long sliceStarted = System.nanoTime();
        List<Map<String, Object>> values = raw == null ? List.of() : raw;
        for (int index = 0; index < values.size(); index++) {
            Map<String, Object> record = normalizeRecord(
                    update, values.get(index));
            if (record != null) {
                String key = key(record);
                if (!keys.add(key)) {
                    synchronized (lock) {
                        increment("duplicateDiagnosticSuppressedCount");
                    }
                } else {
                    out.add(record);
                }
            }
            if ((index + 1) % SLICE_ITEMS == 0) {
                recordSlice(sliceStarted);
                Thread.yield();
                sliceStarted = System.nanoTime();
            }
        }
        recordSlice(sliceStarted);
        return Collections.unmodifiableList(out);
    }

    private Snapshot buildSnapshot(
            long snapshotGeneration,
            Map<String, DocumentState> source) {
        List<Map<String, Object>> diagnostics = new ArrayList<>();
        List<Map<String, Object>> versions = new ArrayList<>();
        Map<String, Long> summary = emptySummaryMap();
        Set<String> seen = new HashSet<>();
        List<String> uris = new ArrayList<>(source.keySet());
        Collections.sort(uris);
        long sliceStarted = System.nanoTime();
        int visited = 0;
        for (String uri : uris) {
            DocumentState document = source.get(uri);
            Map<String, Object> version = new LinkedHashMap<>();
            version.put("uri", uri);
            version.put("documentVersion", document.version);
            versions.add(Collections.unmodifiableMap(version));
            add(summary, "uriCount", 1L);
            for (Map<String, Object> record : document.diagnostics) {
                if (!seen.add(key(record))) {
                    synchronized (lock) { increment("publishedDuplicateCount"); }
                    continue;
                }
                if (diagnostics.size() < maxDiagnostics) {
                    diagnostics.add(record);
                    String severity = String.valueOf(record.get("severity"));
                    add(summary, summary.containsKey(severity)
                            ? severity : "unknown", 1L);
                } else {
                    add(summary, "truncatedCount", 1L);
                }
                visited += 1;
                if (visited % SLICE_ITEMS == 0) {
                    recordSlice(sliceStarted);
                    Thread.yield();
                    sliceStarted = System.nanoTime();
                }
            }
        }
        recordSlice(sliceStarted);
        summary.put("total", (long) diagnostics.size());
        long stale = 0L;
        Map<String, Long> versionByUri = new HashMap<>();
        for (String uri : uris) versionByUri.put(uri, source.get(uri).version);
        for (Map<String, Object> diagnostic : diagnostics) {
            Long latest = versionByUri.get(diagnostic.get("documentUri"));
            Object actual = diagnostic.get("documentVersion");
            if (latest != null && (!(actual instanceof Number)
                    || ((Number) actual).longValue() != latest)) stale += 1L;
        }
        synchronized (lock) {
            stats.put("publishedStaleVersionCount", stale);
        }
        return new Snapshot(
                snapshotGeneration, diagnostics, versions, summary);
    }

    private Map<String, Object> normalizeRecord(
            Update update, Map<String, Object> raw) {
        if (raw == null) return null;
        String uri = bound(raw.get("documentUri") == null
                ? update.uri : raw.get("documentUri"), 2_048);
        if (uri.isEmpty()) return null;
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("file", bound(raw.get("file") == null
                ? update.file : raw.get("file"), 2_048));
        record.put("documentUri", uri);
        Object version = raw.get("documentVersion");
        record.put("documentVersion",
                version instanceof Number
                        ? ((Number) version).longValue()
                        : update.documentVersion);
        record.put("isDirty", raw.containsKey("isDirty")
                ? raw.get("isDirty") : update.dirty);
        record.put("severity", severity(raw.get("severity")));
        record.put("message", bound(raw.get("message"), maxMessageChars));
        record.put("line", nonNegativeLong(raw.get("line")));
        record.put("character", nonNegativeLong(raw.get("character")));
        record.put("source", bound(raw.get("source"), 128));
        Object code = raw.get("code");
        if (code instanceof Map) code = ((Map<?, ?>) code).get("value");
        record.put("code", bound(code, 256));
        return Collections.unmodifiableMap(record);
    }

    private boolean isCurrent(long requestedGeneration) {
        synchronized (lock) {
            return !closed && requestedGeneration == generation;
        }
    }

    private void recordSlice(long startedNanos) {
        long micros = Math.max(0L,
                TimeUnit.NANOSECONDS.toMicros(
                        System.nanoTime() - startedNanos));
        synchronized (lock) {
            stats.put("maxWorkSliceMicros", Math.max(
                    stats.get("maxWorkSliceMicros"), micros));
        }
    }

    private void increment(String key) {
        stats.put(key, stats.get(key) + 1L);
    }

    private static void add(Map<String, Long> value, String key, long amount) {
        value.put(key, value.get(key) + amount);
    }

    private static Snapshot emptySnapshot() {
        return new Snapshot(0L, List.of(), List.of(), emptySummaryMap());
    }

    private static Map<String, Long> emptySummaryMap() {
        Map<String, Long> out = new LinkedHashMap<>();
        for (String key : List.of(
                "total", "error", "warning", "information", "hint",
                "unknown", "uriCount", "truncatedCount")) {
            out.put(key, 0L);
        }
        return out;
    }

    private static String severity(Object value) {
        String text = String.valueOf(value == null ? "unknown" : value)
                .toLowerCase(java.util.Locale.ROOT);
        if (text.contains("error")) return "error";
        if (text.contains("warn")) return "warning";
        if (text.contains("info")) return "information";
        if (text.contains("hint") || text.contains("weak")) return "hint";
        return bound(text, 32);
    }

    private static Long nonNegativeLong(Object value) {
        if (!(value instanceof Number)) return null;
        long number = ((Number) value).longValue();
        return number < 0L ? null : number;
    }

    private static String key(Map<String, Object> record) {
        return String.join("\u0000", List.of(
                String.valueOf(record.get("documentUri")),
                String.valueOf(record.get("documentVersion")),
                String.valueOf(record.get("severity")),
                String.valueOf(record.get("line")),
                String.valueOf(record.get("character")),
                String.valueOf(record.get("source")),
                String.valueOf(record.get("code")),
                String.valueOf(record.get("message"))));
    }

    private static String oneBased(Object value) {
        return value instanceof Number
                ? String.valueOf(((Number) value).intValue() + 1) : "?";
    }

    private static String bound(Object value, int limit) {
        String text = value == null ? "" : String.valueOf(value);
        return text.length() <= limit ? text : text.substring(0, limit);
    }

    private static boolean samePath(String left, String right) {
        String a = left.replace('\\', '/');
        String b = right.replace('\\', '/');
        return FileSeparator.WINDOWS
                ? a.equalsIgnoreCase(b) : a.equals(b);
    }

    private static final class FileSeparator {
        static final boolean WINDOWS = java.io.File.separatorChar == '\\';
    }

    @Override
    public void close() {
        synchronized (lock) {
            closed = true;
            if (scheduled != null) scheduled.cancel(false);
            scheduled = null;
            pending.clear();
            replaceAllPending = false;
            lock.notifyAll();
        }
        executor.shutdownNow();
    }
}
