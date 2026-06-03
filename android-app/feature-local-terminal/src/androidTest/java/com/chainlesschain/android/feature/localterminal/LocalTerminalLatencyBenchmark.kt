package com.chainlesschain.android.feature.localterminal

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Phase 3.4 — Kotlin-side PTY round-trip latency benchmark.
 *
 * Measures: write 1 byte to PTY master → PTY echo line discipline puts it
 * back on the master read side → Kotlin's stdoutFlow emits it → record
 * timestamp. Excludes the xterm.js WebView render step (separate UI-test
 * gate to be added in Phase 4 once RemoteOperate is wired in).
 *
 * Gate threshold: p99 < 5 ms.
 *
 * Rationale: the original design doc set the end-to-end stdin→DOM gate at
 * p99 < 30 ms. Subtract typical xterm.js render time (5-15 ms on mid-range
 * Android) and Kotlin↔PTY round-trip has ~15 ms of headroom. We set the
 * Kotlin-only target at 5 ms p99 to leave 25 ms for everything else; if
 * this gate fails, the entire pipeline is in trouble and Phase 4 WebView
 * tests won't save us.
 */
@RunWith(AndroidJUnit4::class)
class LocalTerminalLatencyBenchmark {

    private val scope = CoroutineScope(SupervisorJob())
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val bootstrapper = LocalFilesystemBootstrapper(context)
    private val env = PtyEnvironment(context, bootstrapper)

    @After
    fun cleanup() = runBlocking {
        scope.cancel()
    }

    @Test
    fun ptyEchoRoundtrip_p99_under_5ms() = runBlocking {
        // 1. Bootstrap and spawn an idle mksh (sleeps so it doesn't read
        //    stdin; PTY line-discipline echo bounces our bytes back).
        bootstrapper.bootstrap().getOrThrow()
        val client = LocalPtyClient(scope)
        val mksh = File(bootstrapper.prefixDir, "bin/mksh").absolutePath
        client.start(
            LocalPtyClient.Config(
                executable = mksh,
                argv = arrayOf(mksh, "-c", "sleep 60"),
                envp = env.envp(mapOf("TERM" to "dumb")),
                cwd = null,
            )
        ).getOrThrow()

        // 2. Subscribe to stdoutFlow and push bytes into a blocking queue.
        //    Each iteration writes 'X' and waits for the queue to deliver
        //    the next byte. ArrayBlockingQueue's blocking poll gives us a
        //    precise wakeup; Kotlin Flow collectors have higher dispatch
        //    overhead than we want for sub-millisecond timing.
        val rxQueue = ArrayBlockingQueue<Byte>(8192)
        val collectorJob = scope.launch {
            client.stdoutFlow.collect { chunk ->
                for (b in chunk) {
                    rxQueue.offer(b)
                }
            }
        }

        // 3. Warm-up: let mksh / PTY settle. Drain whatever the shell
        //    prints during startup before timing begins.
        delay(200)
        rxQueue.clear()

        // 4. Iterate 500 times. Each iteration records nanos for the
        //    write-to-echo round trip.
        val iterations = 500
        val latenciesNanos = LongArray(iterations)
        val payload = byteArrayOf('X'.code.toByte())

        for (i in 0 until iterations) {
            val startNanos = System.nanoTime()
            client.writeStdin(payload)
            val received = rxQueue.poll(500, TimeUnit.MILLISECONDS)
            val endNanos = System.nanoTime()
            check(received != null) {
                "iteration $i timed out waiting for PTY echo after 500ms"
            }
            latenciesNanos[i] = endNanos - startNanos
        }

        // 5. Compute stats.
        latenciesNanos.sort()
        val p50us = latenciesNanos[iterations / 2] / 1_000
        val p95us = latenciesNanos[(iterations * 95) / 100] / 1_000
        val p99us = latenciesNanos[(iterations * 99) / 100] / 1_000
        val maxUs = latenciesNanos.last() / 1_000

        // Log to System.out so Gradle test report captures it.
        println(
            "Phase 3.4 PTY echo latency benchmark on " +
                "${android.os.Build.MODEL} (${android.os.Build.VERSION.RELEASE}): " +
                "n=$iterations p50=${p50us}us p95=${p95us}us p99=${p99us}us max=${maxUs}us"
        )

        collectorJob.cancel()
        withTimeoutOrNull(2_000) { client.shutdown() }

        // Gate: p99 < 5 ms. Convert: 5 ms = 5000 us.
        assertTrue(
            "Phase 3.4 gate FAIL — p99 PTY echo latency ${p99us}us " +
                "exceeds 5000us baseline (5ms). Investigate before " +
                "promoting to Phase 4 wiring.",
            p99us < 5_000
        )
    }
}
