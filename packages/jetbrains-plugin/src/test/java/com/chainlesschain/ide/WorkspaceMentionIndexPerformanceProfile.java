package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** Product-class 100k-path / 20-query profile used by IDE-INPUT-PERF. */
public final class WorkspaceMentionIndexPerformanceProfile {
    public static final int PATH_COUNT = 100_000;
    public static final int QUERY_COUNT = 20;
    public static final double P95_LIMIT_MS = 200.0;

    private WorkspaceMentionIndexPerformanceProfile() {}

    public static Evidence measure() throws Exception {
        String root = "/workspace";
        List<String> paths = new ArrayList<>(PATH_COUNT);
        for (int index = 0; index < PATH_COUNT; index++) {
            paths.add(String.format(Locale.ROOT,
                    "%s/src/pkg%03d/file%05d.ts", root, index % 100, index));
        }
        WorkspaceMentionIndex mentionIndex =
                new WorkspaceMentionIndex(List.of(root), true);
        int indexed = mentionIndex.replacePaths(paths);
        require(indexed == PATH_COUNT, "100k fixture was not fully indexed");

        // Incremental add/remove updates the workspace revision without a rescan.
        String displaced = paths.get(paths.size() - 1);
        require(mentionIndex.removePath(displaced), "incremental pre-delete was rejected");
        require(mentionIndex.upsertPath(root + "/src/live-created.ts"),
                "incremental create was rejected");
        require(mentionIndex.removePath(root + "/src/live-created.ts"),
                "incremental delete was rejected");
        require(mentionIndex.upsertPath(displaced), "incremental restore was rejected");
        require(!mentionIndex.upsertPath("/outside/private.txt"),
                "outside path entered the index");
        require(!mentionIndex.upsertPath(root + "/.git/config"),
                "denied path entered the index");

        WorkspaceMentionIndex.QueryTicket symbolTicket = mentionIndex.beginQuery();
        mentionIndex.replaceSymbols(symbolTicket, List.of(
                new Mentions.Symbol("NeedleSymbol", 4,
                        root + "/src/pkg042/file00042.ts"),
                new Mentions.Symbol("OutsideSymbol", 4,
                        "/outside/private.txt")));
        WorkspaceMentionIndex.QueryResult symbolResult =
                mentionIndex.query(symbolTicket, "needlesymbol");
        require(mentionIndex.commit(symbolTicket, symbolResult),
                "symbol query did not commit");
        boolean symbolObserved = symbolResult.items.stream().anyMatch(
                item -> "src/pkg042/file00042.ts".equals(item.value));
        require(symbolObserved, "trusted symbol metadata was not searchable");

        List<Double> samples = new ArrayList<>();
        int maxCandidates = 0;
        for (int query = 0; query < QUERY_COUNT; query++) {
            WorkspaceMentionIndex.QueryTicket ticket = mentionIndex.beginQuery();
            long started = System.nanoTime();
            WorkspaceMentionIndex.QueryResult result = mentionIndex.query(
                    ticket, query % 2 == 0 ? "file" + query
                            : String.format(Locale.ROOT, "pkg%03d", query % 100));
            samples.add((System.nanoTime() - started) / 1_000_000.0);
            require(mentionIndex.commit(ticket, result),
                    "consecutive query did not commit");
            maxCandidates = Math.max(maxCandidates, result.items.size());
            require(result.items.size() <= WorkspaceMentionIndex.MAX_CANDIDATES,
                    "candidate limit exceeded");
        }

        // All workers are held until every generation exists. Therefore the
        // first 19 are cancelled before product query code runs, and only the
        // twentieth generation is eligible to commit.
        ExecutorService executor = Executors.newFixedThreadPool(4);
        CountDownLatch start = new CountDownLatch(1);
        List<WorkspaceMentionIndex.QueryTicket> tickets = new ArrayList<>();
        List<Future<WorkspaceMentionIndex.QueryResult>> futures = new ArrayList<>();
        try {
            for (int query = 0; query < QUERY_COUNT; query++) {
                WorkspaceMentionIndex.QueryTicket ticket = mentionIndex.beginQuery();
                tickets.add(ticket);
                final int sequence = query;
                futures.add(executor.submit(() -> {
                    start.await();
                    return mentionIndex.query(ticket, "file" + sequence);
                }));
            }
            start.countDown();
            int committed = 0;
            long committedGeneration = 0;
            for (int index = 0; index < futures.size(); index++) {
                WorkspaceMentionIndex.QueryResult result = futures.get(index).get();
                if (!result.cancelled && mentionIndex.commit(tickets.get(index), result)) {
                    committed++;
                    committedGeneration = result.generation;
                }
            }
            require(committed == 1, "rapid queries committed " + committed + " generations");
            require(committedGeneration == tickets.get(QUERY_COUNT - 1).generation,
                    "the final generation was not the committed generation");
        } finally {
            start.countDown();
            executor.shutdownNow();
        }

        WorkspaceMentionIndex untrusted =
                new WorkspaceMentionIndex(List.of(root), false);
        require(untrusted.replacePaths(paths) == 0, "untrusted paths were indexed");
        WorkspaceMentionIndex.QueryTicket untrustedTicket = untrusted.beginQuery();
        WorkspaceMentionIndex.QueryResult untrustedResult =
                untrusted.query(untrustedTicket, "file");
        require(untrustedResult.items.isEmpty(), "untrusted file metadata leaked");

        Collections.sort(samples);
        double p50 = percentile(samples, 50);
        double p95 = percentile(samples, 95);
        double p99 = percentile(samples, 99);
        require(p95 <= P95_LIMIT_MS,
                String.format(Locale.ROOT, "P95 %.3fms exceeds %.0fms", p95, P95_LIMIT_MS));
        WorkspaceMentionIndex.Snapshot snapshot = mentionIndex.snapshot();
        require(snapshot.pathCount == PATH_COUNT, "path count changed");
        require(snapshot.staleCommitCount == 0, "stale result committed");
        require(snapshot.leakCount == 0, "out-of-bound path leaked");
        require(snapshot.contentReadCount == 0, "completion read file content");
        require(maxCandidates <= WorkspaceMentionIndex.MAX_CANDIDATES,
                "candidate maximum exceeded");
        return new Evidence(snapshot, samples, p50, p95, p99,
                maxCandidates, symbolObserved, true);
    }

    private static double percentile(List<Double> sorted, int percentile) {
        int index = Math.max(0,
                (int) Math.ceil((percentile / 100.0) * sorted.size()) - 1);
        return sorted.get(index);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    public static final class Evidence {
        public final WorkspaceMentionIndex.Snapshot snapshot;
        public final List<Double> samples;
        public final double p50Ms;
        public final double p95Ms;
        public final double p99Ms;
        public final int maxCandidates;
        public final boolean symbolObserved;
        public final boolean workspaceTrustEnforced;

        Evidence(WorkspaceMentionIndex.Snapshot snapshot, List<Double> samples,
                 double p50Ms, double p95Ms, double p99Ms, int maxCandidates,
                 boolean symbolObserved, boolean workspaceTrustEnforced) {
            this.snapshot = snapshot;
            this.samples = samples;
            this.p50Ms = p50Ms;
            this.p95Ms = p95Ms;
            this.p99Ms = p99Ms;
            this.maxCandidates = maxCandidates;
            this.symbolObserved = symbolObserved;
            this.workspaceTrustEnforced = workspaceTrustEnforced;
        }

        public String toJson() {
            return "{"
                    + "\"schema\":\"chainlesschain.ide-input-performance-host.v1\","
                    + "\"host\":\"jetbrains\","
                    + "\"measurementSurface\":\"metadata-only-product-index\","
                    + "\"profileVersion\":\"ide-input-perf/v1\","
                    + "\"runtime\":{\"java\":\"" + json(System.getProperty("java.version")) + "\"},"
                    + "\"thresholds\":{\"pathCount\":" + PATH_COUNT
                    + ",\"consecutiveQueries\":" + QUERY_COUNT
                    + ",\"rapidQueries\":" + QUERY_COUNT
                    + ",\"p95Ms\":" + (int) P95_LIMIT_MS
                    + ",\"maxCandidates\":" + WorkspaceMentionIndex.MAX_CANDIDATES
                    + ",\"staleCommitCount\":0,\"leakCount\":0,\"contentReadCount\":0},"
                    + "\"measurements\":{\"pathCount\":" + snapshot.pathCount
                    + ",\"consecutiveQueries\":" + QUERY_COUNT
                    + ",\"rapidQueries\":" + QUERY_COUNT
                    + ",\"samplesMs\":" + numbers(samples)
                    + String.format(Locale.ROOT,
                            ",\"p50Ms\":%.6f,\"p95Ms\":%.6f,\"p99Ms\":%.6f",
                            p50Ms, p95Ms, p99Ms)
                    + ",\"maxCandidates\":" + maxCandidates
                    + ",\"workspaceRevision\":" + snapshot.workspaceRevision
                    + ",\"queryGeneration\":" + snapshot.queryGeneration
                    + ",\"cancellationCount\":" + snapshot.cancellationCount
                    + ",\"discardedQueryCount\":" + snapshot.discardedQueryCount
                    + ",\"deniedPathCount\":" + snapshot.deniedPathCount
                    + ",\"staleCommitCount\":" + snapshot.staleCommitCount
                    + ",\"leakCount\":" + snapshot.leakCount
                    + ",\"contentReadCount\":" + snapshot.contentReadCount
                    + ",\"symbolObserved\":" + symbolObserved
                    + ",\"workspaceTrustEnforced\":" + workspaceTrustEnforced + "},"
                    + "\"testIds\":[\"WorkspaceMentionIndexPerformanceTest#profiles100kPathsAndRapidQueries\"],"
                    + "\"disposition\":\"required\",\"outcome\":\"pass\"}";
        }
    }

    private static String numbers(List<Double> values) {
        StringBuilder output = new StringBuilder("[");
        for (int index = 0; index < values.size(); index++) {
            if (index > 0) output.append(',');
            output.append(String.format(Locale.ROOT, "%.6f", values.get(index)));
        }
        return output.append(']').toString();
    }

    private static String json(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    public static void write(Path output, Evidence evidence) throws IOException {
        Path parent = output.toAbsolutePath().getParent();
        if (parent != null) Files.createDirectories(parent);
        Files.writeString(output, evidence.toJson() + "\n", StandardCharsets.UTF_8);
    }

    public static void main(String[] args) throws Exception {
        Evidence evidence = measure();
        if (args.length > 0) write(Path.of(args[0]), evidence);
        System.out.println(evidence.toJson());
    }
}
