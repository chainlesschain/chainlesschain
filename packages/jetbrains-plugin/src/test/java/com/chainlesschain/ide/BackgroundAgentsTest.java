package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link BackgroundAgents} — pid-identity liveness decisions (VS twin
 * isSameProcess parity), needs-attention classification (waiting_permission /
 * needs_input / pendingApprovals) and the seek-based log tail.
 */
final class BackgroundAgentsTest {

    // ── pid liveness (B: JB twin of VS effectiveStatus pid legs) ──────────

    @Test
    void pidLostReasonDecisions() {
        long startedAt = 1_000_000L;
        // dead pid → process-exited, regardless of creation time
        assertEquals("process-exited",
                BackgroundAgents.pidLostReason(false, null, startedAt));
        // alive, created before/at startedAt (+tolerance) → still ours
        assertNull(BackgroundAgents.pidLostReason(true, startedAt - 5_000, startedAt));
        assertNull(BackgroundAgents.pidLostReason(true,
                startedAt + BackgroundAgents.PID_IDENTITY_TOLERANCE_MS, startedAt));
        // alive but created well AFTER startedAt → the OS reused the pid
        assertEquals("pid-reused", BackgroundAgents.pidLostReason(true,
                startedAt + BackgroundAgents.PID_IDENTITY_TOLERANCE_MS + 1, startedAt));
        // unknown creation time / unknown startedAt → fail open (display-only)
        assertNull(BackgroundAgents.pidLostReason(true, null, startedAt));
        assertNull(BackgroundAgents.pidLostReason(true, 999_999_999L, 0L));
    }

    @Test
    void effectiveStatusUsesInjectedPidProbe() {
        long now = 10_000_000L;
        long fresh = now - 1_000; // heartbeat fresh
        // Probe says the pid is gone → lost/process-exited.
        String[] gone = BackgroundAgents.effectiveStatus("running", fresh, now,
                42L, 5_000_000L, pid -> new BackgroundAgents.PidInfo(false, null));
        assertEquals("lost", gone[0]);
        assertEquals("process-exited", gone[1]);
        // Probe says alive but created long after startedAt → pid-reused.
        String[] reused = BackgroundAgents.effectiveStatus("running", fresh, now,
                42L, 5_000_000L, pid -> new BackgroundAgents.PidInfo(true, 9_000_000L));
        assertEquals("lost", reused[0]);
        assertEquals("pid-reused", reused[1]);
        // Alive with a matching creation time → running.
        String[] ok = BackgroundAgents.effectiveStatus("running", fresh, now,
                42L, 5_000_000L, pid -> new BackgroundAgents.PidInfo(true, 4_999_000L));
        assertEquals("running", ok[0]);
        assertNull(ok[1]);
        // Stale heartbeat wins before the pid probe runs.
        String[] stale = BackgroundAgents.effectiveStatus("running",
                now - BackgroundAgents.HEARTBEAT_STALE_MS - 1, now,
                42L, 5_000_000L, pid -> {
                    throw new AssertionError("probe must not run on stale heartbeat");
                });
        assertEquals("lost", stale[0]);
        assertEquals("heartbeat-stale", stale[1]);
        // No pid in the state file → the pid leg is skipped (older CLI states).
        String[] noPid = BackgroundAgents.effectiveStatus("running", fresh, now,
                0L, 5_000_000L, pid -> new BackgroundAgents.PidInfo(false, null));
        assertEquals("running", noPid[0]);
    }

    @Test
    void listAppliesPidCorrectionFromStateFile() throws Exception {
        Path dir = Files.createTempDirectory("cc-bg-test-");
        long now = 2_000_000L;
        Files.writeString(dir.resolve("bg-dead.json"),
                "{\"id\":\"bg-dead\",\"status\":\"running\",\"pid\":4242,"
                        + "\"startedAt\":1500000,\"heartbeatAt\":1999000}");
        List<BackgroundAgents.Session> list = BackgroundAgents.list(dir, now,
                pid -> new BackgroundAgents.PidInfo(false, null));
        assertEquals(1, list.size());
        assertEquals("lost", list.get(0).status);
        assertEquals("process-exited", list.get(0).lostReason);
        assertFalse(list.get(0).interactive, "lost is never interactive");
    }

    // ── needs-attention classification (waiting_permission visibility) ─────

    @Test
    void needsAttentionCoversCanonicalBlockingSignals() {
        assertTrue(BackgroundAgents.needsAttention("waiting_permission", 0));
        assertTrue(BackgroundAgents.needsAttention("waiting-permission", 0));
        assertTrue(BackgroundAgents.needsAttention("needs_input", 0));
        assertTrue(BackgroundAgents.needsAttention("waiting_approval", 0));
        assertTrue(BackgroundAgents.needsAttention("working", 3),
                "pendingApprovals wins over the phase label");
        assertTrue(BackgroundAgents.needsAttention(null, 1));
        assertFalse(BackgroundAgents.needsAttention("working", 0));
        assertFalse(BackgroundAgents.needsAttention("idle", 0));
        assertFalse(BackgroundAgents.needsAttention(null, 0));
    }

    @Test
    void rowAndDetailSurfaceThePendingApprovals() throws Exception {
        Path dir = Files.createTempDirectory("cc-bg-test-");
        long now = 2_000_000L;
        Files.writeString(dir.resolve("bg-blocked.json"),
                "{\"id\":\"bg-blocked\",\"status\":\"running\",\"startedAt\":1500000,"
                        + "\"heartbeatAt\":1999000,\"phase\":\"waiting_permission\","
                        + "\"pendingApprovals\":2,\"title\":\"blocked work\"}");
        BackgroundAgents.Session s =
                BackgroundAgents.list(dir, now, null).get(0);
        assertEquals(2, s.pendingApprovals);
        String row = BackgroundAgents.formatRow(s, now);
        assertTrue(row.contains("waiting for approval (2 pending)"), row);
        String detail = BackgroundAgents.formatDetail(s, now, 5);
        assertTrue(detail.contains("attention: waiting for approval (2 pending)"), detail);
    }

    @Test
    void needsInputPhaseReadsAsWaitingForInput() throws Exception {
        Path dir = Files.createTempDirectory("cc-bg-test-");
        long now = 2_000_000L;
        Files.writeString(dir.resolve("bg-q.json"),
                "{\"id\":\"bg-q\",\"status\":\"running\",\"startedAt\":1500000,"
                        + "\"heartbeatAt\":1999000,\"phase\":\"needs_input\"}");
        String row = BackgroundAgents.formatRow(
                BackgroundAgents.list(dir, now, null).get(0), now);
        assertTrue(row.contains("waiting for input"), row);
    }

    // ── seek-based tail (multi-MB logs must not be read whole) ────────────

    @Test
    void tailSeeksInsteadOfReadingTheWholeFile() throws Exception {
        Path dir = Files.createTempDirectory("cc-bg-test-");
        Path log = dir.resolve("big.log");
        // > 64KB of CJK lines so the seek window starts mid-file (and, for most
        // offsets, mid-UTF-8-char) — the tail must still decode cleanly.
        StringBuilder sb = new StringBuilder();
        int total = 4000;
        for (int i = 0; i < total; i++) {
            sb.append("行 ").append(i).append(" 的日志内容——中文多字节\n");
        }
        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        assertTrue(bytes.length > BackgroundAgents.TAIL_READ_BYTES,
                "fixture must exceed the tail cap");
        Files.write(log, bytes);

        String tail = BackgroundAgents.tailLog(log.toString(), 3);
        // Trailing newline splits into a final "" element, so 3 lines = the
        // last two real lines + "".
        assertTrue(tail.contains("行 " + (total - 1) + " 的日志内容"), tail);
        assertTrue(tail.contains("行 " + (total - 2) + " 的日志内容"), tail);
        assertFalse(tail.contains("�"), "no torn UTF-8 at the seek boundary");
    }

    @Test
    void tailOnSmallFilesMatchesTheOldBehavior() throws Exception {
        Path dir = Files.createTempDirectory("cc-bg-test-");
        Path log = dir.resolve("small.log");
        Files.writeString(log, "one\ntwo\nthree\n");
        assertEquals("three\n", BackgroundAgents.tailLog(log.toString(), 2));
        assertEquals("", BackgroundAgents.tailLog(
                dir.resolve("missing.log").toString(), 5));
    }

    @Test
    void readTailDropsThePartialFirstLineOnlyWhenSeeking() throws Exception {
        Path dir = Files.createTempDirectory("cc-bg-test-");
        Path f = dir.resolve("t.log");
        Files.writeString(f, "alpha\nbeta\ngamma\n");
        // No seek (file below cap) → byte-identical content.
        assertEquals("alpha\nbeta\ngamma\n",
                BackgroundAgents.readTail(f, 1024));
        // Cap smaller than the file → the cut-off head line is dropped.
        String tail = BackgroundAgents.readTail(f, 12); // window: "beta\ngamma\n" + partial
        assertFalse(tail.contains("alpha"), tail);
        assertTrue(tail.endsWith("gamma\n"), tail);
        assertFalse(tail.startsWith("a\n"), "partial first line dropped: " + tail);
    }
}
