package com.chainlesschain.android.feature.localterminal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Phase 1.2 instrumented tests — drives [LocalPtyClient] against a real
 * libmksh.so on the connected device.
 *
 * Complements the unit tests in [LocalPtyClientTest] (fake JNI; logic-only)
 * by exercising the full Kotlin → JNI → kernel → mksh round-trip end to end.
 */
@RunWith(AndroidJUnit4::class)
class LocalPtyClientIntegrationTest {

    private val scope = CoroutineScope(SupervisorJob())
    private lateinit var client: LocalPtyClient

    private fun mkshPath(): String {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return File(ctx.applicationInfo.nativeLibraryDir, "libmksh.so").absolutePath
    }

    private fun cfg(cmd: String) = LocalPtyClient.Config(
        executable = mkshPath(),
        argv = arrayOf(mkshPath(), "-c", cmd),
        envp = arrayOf("PATH=/system/bin", "TERM=dumb"),
        cwd = null,
        rows = 24,
        cols = 80,
    )

    @Before
    fun setup() {
        client = LocalPtyClient(scope)
    }

    @After
    fun tearDown() = runBlocking {
        withTimeoutOrNull(10_000) { client.shutdown() }
        scope.cancel()
    }

    @Test
    fun startAndReadEchoOutput() = runBlocking {
        val result = client.start(cfg("echo phase-1.2"))
        assertTrue("start should succeed: ${result.exceptionOrNull()}", result.isSuccess)
        assertEquals(LocalPtyClient.State.RUNNING, client.state)

        // Collect stdout until EOF (child exits → slave hangup → emit then loop ends).
        // We can't easily wait for "end of flow"; use a timeout and let exit signal end.
        val outputs = mutableListOf<ByteArray>()
        val collectJob = scope.launch {
            client.stdoutFlow.collect { chunk -> outputs.add(chunk) }
        }

        // Wait for the child to exit. exitFlow has replay=1 so we'll see the
        // value even if it emits before we subscribe.
        val exit = withTimeout(5_000) { client.exitFlow.first() }
        assertEquals(0, exit)

        // Give the read loop a moment to drain any remaining bytes before we
        // shutdown (it would otherwise drop the final EOF chunk).
        withTimeoutOrNull(500) {
            kotlinx.coroutines.delay(500)
        }
        collectJob.cancel()

        val combined = outputs.fold(StringBuilder()) { sb, bytes ->
            sb.append(String(bytes, Charsets.UTF_8))
        }.toString()
        assertTrue(
            "expected stdout to contain 'phase-1.2'; got: ${combined.toByteArray().toHexString()}",
            combined.contains("phase-1.2")
        )
    }

    @Test
    fun writeStdinIsEchoedByPtyDriver() = runBlocking {
        // Start mksh in interactive mode so it actually reads from stdin.
        // `-i` forces interactive (mksh would otherwise detect non-tty), and we
        // give it a single command via stdin that produces deterministic output.
        client.start(cfg("read line && echo got=\$line")).getOrThrow()

        // The pty driver echoes input bytes back. Write a line and expect to
        // see both the echo and the `got=...` output.
        client.writeStdin("ping\n".toByteArray())

        val outputs = mutableListOf<ByteArray>()
        val collectJob = scope.launch {
            client.stdoutFlow.collect { chunk -> outputs.add(chunk) }
        }

        val exit = withTimeout(5_000) { client.exitFlow.first() }
        assertEquals(0, exit)
        withTimeoutOrNull(500) { kotlinx.coroutines.delay(500) }
        collectJob.cancel()

        val combined = outputs.fold(StringBuilder()) { sb, bytes ->
            sb.append(String(bytes, Charsets.UTF_8))
        }.toString()
        assertTrue(
            "expected 'got=ping' in output; got: ${combined.toByteArray().toHexString()}",
            combined.contains("got=ping")
        )
    }

    @Test
    fun shutdownTerminatesLongRunningChild() = runBlocking {
        client.start(cfg("sleep 30")).getOrThrow()
        assertEquals(LocalPtyClient.State.RUNNING, client.state)

        // Sleep briefly so the spawn fully landed before shutdown.
        kotlinx.coroutines.delay(100)

        val shutdownStart = System.currentTimeMillis()
        withTimeout(7_000) {  // graceful grace=5s + slack
            client.shutdown()
        }
        val elapsed = System.currentTimeMillis() - shutdownStart

        assertEquals(LocalPtyClient.State.EXITED, client.state)
        assertTrue(
            "shutdown of `sleep 30` should complete within grace period (5s) + slack, took ${elapsed}ms",
            elapsed < 6_500
        )
    }
}

private fun ByteArray.toHexString(): String =
    joinToString(separator = " ") { b -> "%02x".format(b) }
