package com.chainlesschain.android.feature.localterminal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Phase 1.1 instrumented tests — exercises the real PTY JNI surface on a
 * real Android device (Xiaomi 24115RA8EC + Android 16 + arm64-v8a per
 * project memory).
 *
 * The Phase 0.5 [LocalTerminalSmokeTest] used Runtime.exec without a pty
 * (one-shot, captures stdout via pipe). Phase 1.1 proves the PTY pathway
 * works: pty master/slave allocation, posix_spawn into the slave, stdin
 * round-trip, exit handling, signal delivery.
 */
@RunWith(AndroidJUnit4::class)
class LocalPtyNativeTest {

    private val pty = LocalPtyNative()

    /** master fd opened per-test — cleaned up in @After even on failure. */
    private var masterFd = -1
    /** child pid spawned per-test — reaped in @After. */
    private var childPid = -1

    private fun mkshPath(): String {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return File(ctx.applicationInfo.nativeLibraryDir, "libmksh.so").absolutePath
    }

    @Before
    fun resetFds() {
        masterFd = -1
        childPid = -1
    }

    @After
    fun cleanup() {
        if (childPid > 0) {
            // Best-effort SIGTERM (kill, not killpg — killpg requires pgid==pid
            // which POSIX_SPAWN_SETSID doesn't reliably establish on Android 16,
            // see killpgVsKillSignalReachability test below for diagnosis).
            pty.nativeKill(childPid, LocalPtyNative.SIGTERM)
            pty.nativeWaitpid(childPid)
            childPid = -1
        }
        if (masterFd >= 0) {
            pty.nativeClose(masterFd)
            masterFd = -1
        }
    }

    @Test
    fun versionStringReflectsPhase11() {
        assertEquals("phase-1.1-real-pty", pty.nativeVersion())
    }

    @Test
    fun openPtyReturnsTwoValidFds() {
        val fds = pty.nativeOpenPty()
        assertEquals(2, fds.size)
        assertTrue("master fd should be >= 0 (got ${fds[0]})", fds[0] >= 0)
        assertTrue("slave fd should be >= 0 (got ${fds[1]})", fds[1] >= 0)
        assertNotEquals(
            "master and slave fds should be distinct",
            fds[0],
            fds[1]
        )
        // Manual cleanup (no spawn here, so the @After path doesn't apply).
        pty.nativeClose(fds[0])
        pty.nativeClose(fds[1])
    }

    @Test
    fun setWinsizeOnFreshMasterSucceeds() {
        val fds = pty.nativeOpenPty()
        assertTrue(fds[0] >= 0)
        masterFd = fds[0]
        val slaveFd = fds[1]

        val rc = pty.nativeSetWinsize(masterFd, rows = 24, cols = 80, xpixel = 0, ypixel = 0)
        assertEquals("TIOCSWINSZ should accept 24x80 on fresh master", 0, rc)

        pty.nativeClose(slaveFd)
        // masterFd cleaned by @After.
    }

    @Test
    fun spawnMkshAndReadHelloRoundtrip() {
        val fds = pty.nativeOpenPty()
        assertTrue("openPty failed: ${fds[0]}", fds[0] >= 0)
        masterFd = fds[0]
        val slaveFd = fds[1]

        // mksh -c "echo hi" — runs the command and exits. PATH-free invocation
        // via absolute libmksh.so path (the APK-installed binary).
        val pid = pty.nativeSpawn(
            slaveFd = slaveFd,
            masterFd = masterFd,
            executable = mkshPath(),
            argv = arrayOf(mkshPath(), "-c", "echo hi"),
            envp = arrayOf("PATH=/system/bin", "TERM=dumb"),
            cwd = null
        )
        assertTrue("spawn returned -errno: $pid", pid > 0)
        childPid = pid

        val buf = ByteArray(256)
        val totalOutput = StringBuilder()
        while (true) {
            val n = pty.nativeRead(masterFd, buf, 0, buf.size)
            if (n == 0) break  // EOF after slave hangup
            if (n < 0) {
                // Shouldn't happen on a clean exit; surface for debugging.
                throw AssertionError("nativeRead returned -errno=$n")
            }
            totalOutput.append(String(buf, 0, n, Charsets.UTF_8))
        }

        val exitCode = pty.nativeWaitpid(pid)
        childPid = -1  // already reaped; tell @After to skip.
        assertEquals("mksh -c 'echo hi' should exit 0", 0, exitCode)

        // PTY echoes by default — but with no input written from our side
        // and TERM=dumb, the output should just be the echoed "hi" plus
        // line-discipline-added \r\n. Accept either "hi\n" or "hi\r\n".
        val out = totalOutput.toString()
        assertTrue(
            "expected output to contain 'hi' (got: ${out.toByteArray().toHexString()})",
            out.contains("hi")
        )
    }

    @Test
    fun killTerminatesRunningChild() {
        val fds = pty.nativeOpenPty()
        masterFd = fds[0]
        val slaveFd = fds[1]

        val pid = pty.nativeSpawn(
            slaveFd = slaveFd,
            masterFd = masterFd,
            executable = mkshPath(),
            argv = arrayOf(mkshPath(), "-c", "sleep 30"),
            envp = arrayOf("PATH=/system/bin", "TERM=dumb"),
            cwd = null
        )
        assertTrue("spawn returned -errno: $pid", pid > 0)
        childPid = pid

        Thread.sleep(50)

        val killRc = pty.nativeKill(pid, LocalPtyNative.SIGTERM)
        assertEquals("kill should succeed on a live child", 0, killRc)

        val reaped = CountDownLatch(1)
        var exitStatus = Int.MAX_VALUE
        thread(name = "kill-waitpid") {
            exitStatus = pty.nativeWaitpid(pid)
            reaped.countDown()
        }
        val finishedInTime = reaped.await(5, TimeUnit.SECONDS)
        assertTrue("waitpid did not return within 5s of SIGTERM", finishedInTime)
        childPid = -1

        assertTrue(
            "expected -SIGTERM(15) or -SIGKILL(9), got $exitStatus",
            exitStatus == -LocalPtyNative.SIGTERM ||
                exitStatus == -LocalPtyNative.SIGKILL
        )
    }

    /**
     * Diagnostic: did POSIX_SPAWN_SETSID actually take effect?
     *
     * On Xiaomi 24115RA8EC + Android 16 (Phase 1.1 first real-device run)
     * killpg returned ESRCH on a freshly-spawned mksh — the spawned pid was
     * NOT its own process-group leader, meaning POSIX_SPAWN_SETSID was either
     * silently ignored or the implementation differs from bionic upstream.
     *
     * This test records the observed pgid so we can detect regressions /
     * Android version drift. It does NOT assert pgid == pid (because that's
     * exactly what we observed to be false), it only asserts pgid > 0.
     */
    @Test
    fun spawnedPgidDiagnostic() {
        val fds = pty.nativeOpenPty()
        masterFd = fds[0]
        val slaveFd = fds[1]

        val pid = pty.nativeSpawn(
            slaveFd = slaveFd,
            masterFd = masterFd,
            executable = mkshPath(),
            argv = arrayOf(mkshPath(), "-c", "sleep 5"),
            envp = arrayOf("PATH=/system/bin", "TERM=dumb"),
            cwd = null
        )
        assertTrue("spawn failed: $pid", pid > 0)
        childPid = pid
        Thread.sleep(50)

        val pgid = pty.nativeGetpgid(pid)
        val ourPgid = pty.nativeGetpgid(0)
        assertTrue("getpgid(child) failed: $pgid", pgid > 0)
        assertTrue("getpgid(self) failed: $ourPgid", ourPgid > 0)
        // Log via assertion message so failure output captures observed state.
        // If pgid == pid: POSIX_SPAWN_SETSID worked, use nativeKillpg freely.
        // If pgid == ourPgid: SETSID ignored — must use nativeKill.
        // If pgid is something else: weirder, investigate.
        println("Phase 1.1 spawn pgid diagnostic: childPid=$pid childPgid=$pgid ourPgid=$ourPgid")
    }
}

private fun ByteArray.toHexString(): String =
    joinToString(separator = " ") { b -> "%02x".format(b) }
