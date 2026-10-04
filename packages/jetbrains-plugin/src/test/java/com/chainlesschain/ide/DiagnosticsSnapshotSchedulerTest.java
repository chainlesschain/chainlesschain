package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

class DiagnosticsSnapshotSchedulerTest {

    @Test
    void publishesOnlyTheNewestStableUriVersion() throws Exception {
        try (DiagnosticsSnapshotScheduler scheduler =
                new DiagnosticsSnapshotScheduler(10_000, 2_000, 10L)) {
            scheduler.schedule(List.of(update(1L, "old")));
            scheduler.schedule(List.of(update(2L, "new")));
            DiagnosticsSnapshotScheduler.Snapshot snapshot =
                    scheduler.flushNow(5_000L);
            assertTrue(snapshot.stable);
            assertEquals(1L, snapshot.summary.get("total"));
            assertEquals(2L,
                    snapshot.diagnostics.get(0).get("documentVersion"));
            assertEquals("new", snapshot.diagnostics.get(0).get("message"));
            assertEquals(0L,
                    scheduler.getStats().get("publishedStaleVersionCount"));

            scheduler.schedule(List.of(update(1L, "stale")));
            scheduler.flushNow(5_000L);
            assertEquals("new",
                    scheduler.getSnapshot().diagnostics.get(0).get("message"));
            assertEquals(1L,
                    scheduler.getStats().get("staleRequestSuppressedCount"));
        }
    }

    @Test
    void deduplicatesAndBoundsThePublishedPayload() throws Exception {
        try (DiagnosticsSnapshotScheduler scheduler =
                new DiagnosticsSnapshotScheduler(2, 8, 0L)) {
            List<Map<String, Object>> values = new ArrayList<>();
            values.add(diagnostic("duplicate-long-message", "error", 1));
            values.add(diagnostic("duplicate-long-message", "error", 1));
            values.add(diagnostic("warning", "warning", 2));
            values.add(diagnostic("hint", "hint", 3));
            scheduler.schedule(List.of(new DiagnosticsSnapshotScheduler.Update(
                    "file:///workspace/a.java", "/workspace/a.java", 7L,
                    Boolean.FALSE, () -> values)));
            DiagnosticsSnapshotScheduler.Snapshot snapshot =
                    scheduler.flushNow(5_000L);
            assertEquals(2L, snapshot.summary.get("total"));
            assertEquals(1L, snapshot.summary.get("error"));
            assertEquals(1L, snapshot.summary.get("warning"));
            assertEquals(1L, snapshot.summary.get("truncatedCount"));
            assertEquals("duplicat",
                    snapshot.diagnostics.get(0).get("message"));
            assertEquals(1L, scheduler.getStats()
                    .get("duplicateDiagnosticSuppressedCount"));
            assertTrue(DiagnosticsSnapshotScheduler.contextText(snapshot)
                    .startsWith("stable diagnostics snapshot"));
        }
    }

    @Test
    void inFlightCancellationRetainsUntouchedUris() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (DiagnosticsSnapshotScheduler scheduler =
                new DiagnosticsSnapshotScheduler(10_000, 2_000, 0L)) {
            DiagnosticsSnapshotScheduler.Update first =
                    new DiagnosticsSnapshotScheduler.Update(
                            "file:///workspace/a.java",
                            "/workspace/a.java",
                            1L,
                            Boolean.FALSE,
                            () -> {
                                started.countDown();
                                if (!release.await(5, TimeUnit.SECONDS)) {
                                    throw new IllegalStateException("fixture timeout");
                                }
                                return List.of(diagnostic("a-old", "error", 0));
                            });
            DiagnosticsSnapshotScheduler.Update second =
                    new DiagnosticsSnapshotScheduler.Update(
                            "file:///workspace/b.java",
                            "/workspace/b.java",
                            1L,
                            Boolean.FALSE,
                            () -> List.of(diagnostic("b-stable", "error", 0)));
            scheduler.schedule(List.of(first, second), true);
            CompletableFuture<DiagnosticsSnapshotScheduler.Snapshot> flushing =
                    CompletableFuture.supplyAsync(() -> {
                        try {
                            return scheduler.flushNow(10_000L);
                        } catch (InterruptedException error) {
                            throw new RuntimeException(error);
                        }
                    });
            assertTrue(started.await(5, TimeUnit.SECONDS));
            scheduler.schedule(List.of(update(2L, "a-new")));
            release.countDown();
            DiagnosticsSnapshotScheduler.Snapshot snapshot =
                    flushing.get(10, TimeUnit.SECONDS);
            assertEquals(List.of("a-new", "b-stable"),
                    snapshot.diagnostics.stream()
                            .map(value -> String.valueOf(value.get("message")))
                            .sorted()
                            .toList());
            assertEquals(2L, snapshot.summary.get("uriCount"));
            assertEquals(1L,
                    scheduler.getStats().get("committedGenerationCount"));
        }
    }

    @Test
    void newerReplaceAllDoesNotRestoreOldUris() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (DiagnosticsSnapshotScheduler scheduler =
                new DiagnosticsSnapshotScheduler(10_000, 2_000, 0L)) {
            DiagnosticsSnapshotScheduler.Update first =
                    new DiagnosticsSnapshotScheduler.Update(
                            "file:///workspace/a.java",
                            "/workspace/a.java",
                            1L,
                            Boolean.FALSE,
                            () -> {
                                started.countDown();
                                if (!release.await(5, TimeUnit.SECONDS)) {
                                    throw new IllegalStateException("fixture timeout");
                                }
                                return List.of(diagnostic("a-old", "error", 0));
                            });
            DiagnosticsSnapshotScheduler.Update second =
                    new DiagnosticsSnapshotScheduler.Update(
                            "file:///workspace/b.java",
                            "/workspace/b.java",
                            1L,
                            Boolean.FALSE,
                            () -> List.of(diagnostic("b-old", "error", 0)));
            scheduler.schedule(List.of(first, second), true);
            CompletableFuture<DiagnosticsSnapshotScheduler.Snapshot> flushing =
                    CompletableFuture.supplyAsync(() -> {
                        try {
                            return scheduler.flushNow(10_000L);
                        } catch (InterruptedException error) {
                            throw new RuntimeException(error);
                        }
                    });
            assertTrue(started.await(5, TimeUnit.SECONDS));
            scheduler.schedule(List.of(update(2L, "a-new")), true);
            release.countDown();
            DiagnosticsSnapshotScheduler.Snapshot snapshot =
                    flushing.get(10, TimeUnit.SECONDS);
            assertEquals(List.of("a-new"),
                    snapshot.diagnostics.stream()
                            .map(value -> String.valueOf(value.get("message")))
                            .toList());
            assertEquals(1L, snapshot.summary.get("uriCount"));
        }
    }

    @Test
    void alreadyEnteredScheduledDrainCannotCommitTwiceAfterFlushCancellation()
            throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (DiagnosticsSnapshotScheduler scheduler =
                new DiagnosticsSnapshotScheduler(10_000, 2_000, 0L)) {
            Object monitor = field(scheduler, "lock");
            ScheduledExecutorService executor = executor(scheduler);
            Thread worker = executor.submit(Thread::currentThread)
                    .get(5, TimeUnit.SECONDS);
            DiagnosticsSnapshotScheduler.Update first =
                    new DiagnosticsSnapshotScheduler.Update(
                            "file:///workspace/a.java", "/workspace/a.java",
                            1L, Boolean.FALSE, () -> {
                                started.countDown();
                                assertTrue(release.await(5, TimeUnit.SECONDS));
                                return List.of(diagnostic("a-old", "error", 0));
                            });
            CompletableFuture<Void> replacement = CompletableFuture.runAsync(() -> {
                try {
                    assertTrue(started.await(5, TimeUnit.SECONDS));
                    scheduler.schedule(List.of(update(2L, "a-new")));
                } catch (InterruptedException error) {
                    throw new RuntimeException(error);
                } finally {
                    release.countDown();
                }
            });
            try {
                DiagnosticsSnapshotScheduler.Snapshot snapshot;
                synchronized (monitor) {
                    scheduler.schedule(List.of(first,
                            new DiagnosticsSnapshotScheduler.Update(
                                    "file:///workspace/b.java", "/workspace/b.java",
                                    1L, Boolean.FALSE,
                                    () -> List.of(diagnostic("b-stable", "error", 0)))),
                            true);
                    // The actual scheduled task has entered drain, so cancel(false)
                    // cannot stop its body. Holding this monitor guarantees that
                    // flushNow observes processing=false and queues its own drain.
                    awaitBlockedDrain(worker);
                    snapshot = scheduler.flushNow(10_000L);
                }
                replacement.get(5, TimeUnit.SECONDS);
                assertEquals(List.of("a-new", "b-stable"), snapshot.diagnostics.stream()
                        .map(value -> String.valueOf(value.get("message"))).toList());
                assertEquals(2L, snapshot.summary.get("uriCount"));
                assertEquals(1L, scheduler.getStats().get("committedGenerationCount"));
                // Drain every task already queued at flush's stable boundary.
                // None may publish another snapshot behind its caller's back.
                executor.submit(() -> {}).get(5, TimeUnit.SECONDS);
                assertSame(snapshot, scheduler.getSnapshot());
                assertEquals(1L, scheduler.getStats().get("committedGenerationCount"));
            } finally {
                release.countDown();
            }
        }
    }

    @Test
    void staleDrainCannotConsumeTheNewScheduledHandleOrReplaceAllBatch()
            throws Exception {
        CountDownLatch workerPaused = new CountDownLatch(1);
        CountDownLatch releaseWorker = new CountDownLatch(1);
        try (DiagnosticsSnapshotScheduler scheduler =
                new DiagnosticsSnapshotScheduler(10_000, 2_000, 0L)) {
            ScheduledExecutorService executor = executor(scheduler);
            executor.execute(() -> {
                workerPaused.countDown();
                try {
                    releaseWorker.await();
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                }
            });
            assertTrue(workerPaused.await(5, TimeUnit.SECONDS));
            try {
                long stale = scheduler.schedule(List.of(update(1L, "old")), true);
                long current = scheduler.schedule(List.of(
                        new DiagnosticsSnapshotScheduler.Update(
                                "file:///workspace/b.java", "/workspace/b.java",
                                2L, Boolean.FALSE,
                                () -> List.of(diagnostic("only-new-b", "error", 0)))),
                        true);
                Object handle = field(scheduler, "scheduled");
                // Invoke the body of an obsolete, already-entered task while
                // the executor queue is held. No timing assumptions are needed.
                drain(scheduler, stale);
                assertSame(handle, field(scheduler, "scheduled"));
                assertEquals(Boolean.TRUE, field(scheduler, "replaceAllPending"));
                assertEquals(1, ((Map<?, ?>) field(scheduler, "pending")).size());
                drain(scheduler, current);
                DiagnosticsSnapshotScheduler.Snapshot snapshot = scheduler.awaitStable(5_000L);
                assertEquals(List.of("only-new-b"), snapshot.diagnostics.stream()
                        .map(value -> String.valueOf(value.get("message"))).toList());
                releaseWorker.countDown();
                executor.submit(() -> {}).get(5, TimeUnit.SECONDS);
                assertSame(snapshot, scheduler.getSnapshot());
                assertEquals(1L, scheduler.getStats().get("committedGenerationCount"));
                long emptyGeneration = scheduler.schedule(List.of());
                DiagnosticsSnapshotScheduler.Snapshot emptyUpdate = scheduler.awaitStable(5_000L);
                assertEquals(emptyGeneration, emptyUpdate.generation);
                assertEquals(snapshot.diagnostics, emptyUpdate.diagnostics);
                assertEquals(2L, scheduler.getStats().get("committedGenerationCount"));
            } finally {
                releaseWorker.countDown();
            }
        }
    }

    private static Object field(DiagnosticsSnapshotScheduler scheduler, String name)
            throws Exception {
        Field field = DiagnosticsSnapshotScheduler.class.getDeclaredField(name);
        field.setAccessible(true);
        return field.get(scheduler);
    }

    private static ScheduledExecutorService executor(DiagnosticsSnapshotScheduler scheduler)
            throws Exception {
        return (ScheduledExecutorService) field(scheduler, "executor");
    }

    private static void drain(DiagnosticsSnapshotScheduler scheduler, long generation)
            throws Exception {
        Method method = DiagnosticsSnapshotScheduler.class.getDeclaredMethod("drain", long.class);
        method.setAccessible(true);
        method.invoke(scheduler, generation);
    }

    private static void awaitBlockedDrain(Thread worker) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (worker.getState() != Thread.State.BLOCKED) {
            assertTrue(System.nanoTime() < deadline, "scheduled drain did not enter its monitor");
            Thread.onSpinWait();
        }
        assertTrue(java.util.Arrays.stream(worker.getStackTrace()).anyMatch(frame ->
                frame.getClassName().equals(DiagnosticsSnapshotScheduler.class.getName())
                        && frame.getMethodName().equals("drain")));
    }

    private static DiagnosticsSnapshotScheduler.Update update(
            long version, String message) {
        return new DiagnosticsSnapshotScheduler.Update(
                "file:///workspace/a.java", "/workspace/a.java", version,
                Boolean.FALSE,
                () -> List.of(diagnostic(message, "error", 0)));
    }

    private static Map<String, Object> diagnostic(
            String message, String severity, int line) {
        return Map.of(
                "message", message,
                "severity", severity,
                "line", line,
                "character", 0,
                "source", "fixture");
    }
}
