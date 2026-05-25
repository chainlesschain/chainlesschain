package com.chainlesschain.android.pdh.social.common

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase B0 — JVM unit cover for [RootShellRunner].
 *
 * What we cover (Win + CI runnable, no Android SDK / device required):
 *  - Default impl returns false on machines without `su` (every CI / dev
 *    box that's not a rooted phone) — the ENOENT path through the catch
 *    block in [DefaultRootShellRunner]
 *  - Fake-runner contract: tests can substitute a stateful fake and
 *    record calls, validating the interface boundary contract for
 *    downstream consumers like [DbCohortCopier]
 *
 * What we DON'T cover (gated to real-device E2E, Phase 1+ per platform):
 *  - Actual `su` fork under Magisk / MIUI / HyperOS (Trap 4)
 *  - Timeout behavior under heavy stdout buffer fill (the cohort copy
 *    script's output is tiny — single-shot read is fine)
 */
class RootShellRunnerTest {

    // ─── Default impl on non-root host ─────────────────────────────────────

    @Test
    fun `default isSuAvailable returns false on CI machine (no su binary)`() {
        // Every CI runner and dev box lacks `su` — the impl catches the
        // ENOENT IOException and returns false.
        val runner = DefaultRootShellRunner()
        assertFalse(runner.isSuAvailable(), "su should not be available on the test host")
    }

    @Test
    fun `default exec returns false when su missing`() {
        val runner = DefaultRootShellRunner()
        val ok = runner.exec("id -u", timeoutMs = 2_000L)
        assertFalse(ok, "exec should return false when su can't fork")
    }

    @Test
    fun `default execAndCapture returns null when su missing`() {
        val runner = DefaultRootShellRunner()
        val out = runner.execAndCapture("echo hi", timeoutMs = 2_000L)
        assertNull(out, "execAndCapture should return null when su can't fork")
    }

    // ─── Fake-runner contract ──────────────────────────────────────────────

    /**
     * Recording fake — used by [DbCohortCopier] tests + future platform
     * extractor tests. Captures every call so assertions can verify the
     * exact command shape sent to `su`.
     */
    private class RecordingFakeRunner(
        var rootAvailable: Boolean = true,
        var execReturns: Boolean = true,
        var captureReturns: String? = "ok",
    ) : RootShellRunner {
        val isSuAvailableCalls = mutableListOf<Unit>()
        val execCalls = mutableListOf<Pair<String, Long>>()
        val captureCalls = mutableListOf<Pair<String, Long>>()

        override fun isSuAvailable(): Boolean {
            isSuAvailableCalls.add(Unit)
            return rootAvailable
        }

        override fun exec(cmd: String, timeoutMs: Long): Boolean {
            execCalls.add(cmd to timeoutMs)
            return execReturns
        }

        override fun execAndCapture(cmd: String, timeoutMs: Long): String? {
            captureCalls.add(cmd to timeoutMs)
            return captureReturns
        }
    }

    @Test
    fun `fake runner records exec calls + returns configured result`() {
        val fake = RecordingFakeRunner(execReturns = true)
        assertTrue(fake.exec("cp /foo /bar", timeoutMs = 5_000L))
        assertEquals(1, fake.execCalls.size)
        assertEquals("cp /foo /bar" to 5_000L, fake.execCalls[0])
    }

    @Test
    fun `fake runner can simulate non-root device`() {
        val fake = RecordingFakeRunner(rootAvailable = false)
        assertFalse(fake.isSuAvailable())
    }

    @Test
    fun `fake runner default timeout is 30s when caller omits`() {
        val fake = RecordingFakeRunner()
        fake.exec("ls /")
        assertEquals(30_000L, fake.execCalls[0].second, "default timeout from interface signature")
    }

    @Test
    fun `fake runner execAndCapture can return null to simulate failure`() {
        val fake = RecordingFakeRunner(captureReturns = null)
        assertNull(fake.execAndCapture("base64 /foo"))
        assertEquals(1, fake.captureCalls.size)
    }

    @Test
    fun `fake runner execAndCapture returns configured payload`() {
        val fake = RecordingFakeRunner(captureReturns = "deadbeef")
        assertEquals("deadbeef", fake.execAndCapture("base64 /foo"))
    }
}
