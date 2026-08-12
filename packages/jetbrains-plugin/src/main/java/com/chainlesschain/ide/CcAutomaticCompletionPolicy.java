package com.chainlesschain.ide;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Iterator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

/**
 * Cost, cache, quality and latency policy for opt-in automatic ghost text.
 *
 * <p>This class is deliberately SDK-free so the JetBrains adapter and its JUnit
 * tests share the same deterministic rules. Manual completion never calls this
 * policy and therefore never consumes the automatic hourly budget.
 */
public final class CcAutomaticCompletionPolicy {

    public static final long SLO_P50_MS = 2_000L;
    public static final long SLO_P95_MS = 5_000L;
    public static final int SLO_MINIMUM_SAMPLES = 20;

    public static final class Options {
        public final int debounceMs;
        public final int cacheTtlMs;
        public final int cacheEntries;
        public final int maxRequestsPerHour;
        public final int maxContextCharsPerHour;
        public final int maxCompletionChars;
        public final int maxCompletionLines;

        public Options(int debounceMs, int cacheTtlMs, int cacheEntries,
                       int maxRequestsPerHour, int maxContextCharsPerHour,
                       int maxCompletionChars, int maxCompletionLines) {
            this.debounceMs = clamp(debounceMs, 650, 100, 3_000);
            this.cacheTtlMs = clamp(cacheTtlMs, 30_000, 1_000, 300_000);
            this.cacheEntries = clamp(cacheEntries, 64, 1, 256);
            this.maxRequestsPerHour = clamp(maxRequestsPerHour, 60, 1, 10_000);
            this.maxContextCharsPerHour = clamp(
                    maxContextCharsPerHour, 240_000, 1_000, 10_000_000);
            this.maxCompletionChars = clamp(
                    maxCompletionChars, 800, 32, CcCompletion.MAX_COMPLETION_CHARS);
            this.maxCompletionLines = clamp(maxCompletionLines, 12, 1, 100);
        }

        public static Options defaults() {
            return new Options(650, 30_000, 64, 60, 240_000, 800, 12);
        }

        private static int clamp(int value, int fallback, int min, int max) {
            int normalized = value <= 0 ? fallback : value;
            return Math.max(min, Math.min(max, normalized));
        }
    }

    public static final class Metrics {
        public final long requests;
        public final long cacheHits;
        public final long dedupeHits;
        public final long budgetRejects;
        public final long qualityRejects;
        public final long sloRejects;
        public final long cancellations;
        public final long p50Ms;
        public final long p95Ms;
        public final int samples;
        public final boolean sloEvaluable;
        public final boolean sloMet;

        private Metrics(long requests, long cacheHits, long dedupeHits,
                        long budgetRejects, long qualityRejects, long sloRejects,
                        long cancellations, long p50Ms, long p95Ms, int samples,
                        boolean sloEvaluable, boolean sloMet) {
            this.requests = requests;
            this.cacheHits = cacheHits;
            this.dedupeHits = dedupeHits;
            this.budgetRejects = budgetRejects;
            this.qualityRejects = qualityRejects;
            this.sloRejects = sloRejects;
            this.cancellations = cancellations;
            this.p50Ms = p50Ms;
            this.p95Ms = p95Ms;
            this.samples = samples;
            this.sloEvaluable = sloEvaluable;
            this.sloMet = sloMet;
        }

        @Override
        public String toString() {
            return "requests=" + requests
                    + " cacheHits=" + cacheHits
                    + " dedupeHits=" + dedupeHits
                    + " budgetRejects=" + budgetRejects
                    + " qualityRejects=" + qualityRejects
                    + " sloRejects=" + sloRejects
                    + " cancellations=" + cancellations
                    + " p50=" + p50Ms + "ms"
                    + " p95=" + p95Ms + "ms"
                    + " samples=" + samples;
        }
    }

    private static final long HOUR_MS = 3_600_000L;

    private static final class Usage {
        private final long at;
        private final int chars;

        private Usage(long at, int chars) {
            this.at = at;
            this.chars = chars;
        }
    }

    private static final class CacheEntry {
        private final String value;
        private final long expiresAt;

        private CacheEntry(String value, long expiresAt) {
            this.value = value;
            this.expiresAt = expiresAt;
        }
    }

    private final LongSupplier clock;
    private final Deque<Usage> usage = new ArrayDeque<>();
    private final LinkedHashMap<String, CacheEntry> cache =
            new LinkedHashMap<>(16, 0.75f, true);
    private final Set<String> inFlight = new HashSet<>();
    private final Deque<Long> latencies = new ArrayDeque<>();
    private long requests;
    private long cacheHits;
    private long dedupeHits;
    private long budgetRejects;
    private long qualityRejects;
    private long sloRejects;
    private long cancellations;

    public CcAutomaticCompletionPolicy() {
        this(System::currentTimeMillis);
    }

    CcAutomaticCompletionPolicy(LongSupplier clock) {
        this.clock = clock;
    }

    public static String key(String prefix, String suffix, String language) {
        return String.valueOf(language) + "\u0000"
                + String.valueOf(prefix) + "\u0000" + String.valueOf(suffix);
    }

    public static boolean isContextEligible(String prefix) {
        if (prefix == null || prefix.isEmpty()
                || Character.isWhitespace(prefix.charAt(prefix.length() - 1))) {
            return false;
        }
        int newline = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r'));
        return prefix.substring(newline + 1).trim().length() >= 2;
    }

    public static boolean isCompletionUsable(
            String completion, String suffix, Options options) {
        if (completion == null || completion.isEmpty()) return false;
        if (completion.length() > options.maxCompletionChars) return false;
        if (completion.split("\\R", -1).length > options.maxCompletionLines) return false;
        if (suffix != null && !suffix.isEmpty() && suffix.startsWith(completion)) return false;
        String normalized = completion.trim().toLowerCase(java.util.Locale.ROOT);
        return !(normalized.startsWith("here is")
                || normalized.startsWith("here's")
                || normalized.startsWith("explanation:")
                || normalized.startsWith("```"));
    }

    public synchronized String cached(String key, Options options) {
        prune(options);
        CacheEntry entry = cache.get(key);
        if (entry == null) return "";
        cacheHits++;
        return entry.value;
    }

    public synchronized boolean reserve(int contextChars, Options options) {
        prune(options);
        int chars = usage.stream().mapToInt(entry -> entry.chars).sum();
        if (usage.size() >= options.maxRequestsPerHour
                || chars + contextChars > options.maxContextCharsPerHour) {
            budgetRejects++;
            return false;
        }
        usage.addLast(new Usage(clock.getAsLong(), Math.max(0, contextChars)));
        requests++;
        return true;
    }

    public synchronized boolean begin(String key) {
        if (!inFlight.add(key)) {
            dedupeHits++;
            return false;
        }
        return true;
    }

    public synchronized void end(String key) {
        inFlight.remove(key);
    }

    /** Records every completed backend request and rejects stale, slow ghost text. */
    public synchronized boolean recordLatency(long latencyMs) {
        long normalized = Math.max(0L, latencyMs);
        latencies.addLast(normalized);
        while (latencies.size() > 200) latencies.removeFirst();
        if (normalized > SLO_P95_MS) {
            sloRejects++;
            return false;
        }
        return true;
    }

    public synchronized void store(
            String key, String value, Options options) {
        cache.put(key, new CacheEntry(value, clock.getAsLong() + options.cacheTtlMs));
        prune(options);
    }

    public synchronized void recordQualityReject() {
        qualityRejects++;
    }

    public synchronized void recordCancellation() {
        cancellations++;
    }

    public synchronized Metrics metrics() {
        long[] values = latencies.stream().mapToLong(Long::longValue).sorted().toArray();
        long p50Ms = percentile(values, 0.50);
        long p95Ms = percentile(values, 0.95);
        boolean sloEvaluable = values.length >= SLO_MINIMUM_SAMPLES;
        return new Metrics(
                requests, cacheHits, dedupeHits, budgetRejects, qualityRejects,
                sloRejects, cancellations, p50Ms, p95Ms, values.length,
                sloEvaluable,
                sloEvaluable && p50Ms <= SLO_P50_MS && p95Ms <= SLO_P95_MS);
    }

    private void prune(Options options) {
        long now = clock.getAsLong();
        while (!usage.isEmpty() && usage.peekFirst().at < now - HOUR_MS) {
            usage.removeFirst();
        }
        Iterator<Map.Entry<String, CacheEntry>> iterator = cache.entrySet().iterator();
        while (iterator.hasNext()) {
            if (iterator.next().getValue().expiresAt <= now) iterator.remove();
        }
        while (cache.size() > options.cacheEntries) {
            cache.remove(cache.keySet().iterator().next());
        }
    }

    private static long percentile(long[] sorted, double p) {
        if (sorted.length == 0) return 0L;
        int index = Math.max(0, (int) Math.ceil(sorted.length * p) - 1);
        return sorted[index];
    }
}
