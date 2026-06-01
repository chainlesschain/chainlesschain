package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * FAMILY-21 验收: ForegroundAppTelemetrySource wraps aggregator + emit
 * TelemetryEvent + pause/resume 行为.
 *
 * SharedFlow 投递在 [runTest] 下必须用 [UnconfinedTestDispatcher] —
 * StandardTestDispatcher 会静默丢 emit ([[android_runtest_sharedflow_unconfined_dispatcher]])。
 * collector 走 [kotlinx.coroutines.test.TestScope.backgroundScope] 自动随 test 结束
 * cancel, 不用 GlobalScope (会脱离 test scheduler 跑真 wall-clock → CI flaky)。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ForegroundAppTelemetrySourceTest {

    private val pkgGame = "com.tencent.tmgp.sgame"
    private val pkgChat = "com.tencent.mm"
    private val childDid = "did:chain:kid"

    @Test
    fun `sourceType is FOREGROUND_APP`() {
        val src = ForegroundAppTelemetrySource()
        assertEquals(TelemetrySourceType.FOREGROUND_APP, src.sourceType)
    }

    @Test
    fun `single sample does not emit (aggregator延伸态)`() = runTest {
        val src = ForegroundAppTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        // 单 sample 不切段, aggregator 仍延伸; emit 不发生
        src.submitSample(childDid, pkgGame, 1000L)
        assertTrue(emitted.isEmpty())
    }

    @Test
    fun `package change emits one TelemetryEvent`() = runTest {
        val src = ForegroundAppTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        src.submitSample(childDid, pkgGame, 1000L)
        src.submitSample(childDid, pkgGame, 61_000L) // 延伸
        src.submitSample(childDid, pkgChat, 120_000L) // 切包 → emit game run
        assertEquals(1, emitted.size)
        val ev = emitted[0]
        assertEquals(TelemetrySourceType.FOREGROUND_APP, ev.source)
        assertEquals("run", ev.kind)
        assertEquals(childDid, ev.childDid)
        assertEquals(1000L, ev.timestampMs)
        assertEquals(60_000L, ev.durationMs)
        assertTrue(ev.payload.contains(pkgGame))
    }

    @Test
    fun `flushCurrent emits pending run and clears aggregator`() = runTest {
        val src = ForegroundAppTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        src.submitSample(childDid, pkgGame, 1000L)
        src.submitSample(childDid, pkgGame, 61_000L)

        val count = src.flushCurrent(childDid)

        assertEquals(1, count)
        assertEquals(1, emitted.size)
    }

    @Test
    fun `pause blocks submit and drops partial run`() = runTest {
        val src = ForegroundAppTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        src.submitSample(childDid, pkgGame, 1000L)
        src.pause()
        assertTrue(src.isPaused())

        // pause 后 submit 应 no-op; pause() 调 aggregator.flush 丢 partial run 不 emit.
        src.submitSample(childDid, pkgChat, 2000L)
        assertEquals(0, emitted.size)
    }

    @Test
    fun `resume after pause allows new emits`() = runTest {
        val src = ForegroundAppTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        src.pause()
        src.resume()
        assertFalse(src.isPaused())

        src.submitSample(childDid, pkgGame, 1000L)
        src.submitSample(childDid, pkgChat, 60_000L) // 切包 → emit
        assertEquals(1, emitted.size)
        assertNotNull(emitted[0])
    }

    @Test
    fun `child switch finalizes prior run under the previous child`() = runTest {
        val src = ForegroundAppTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        val childA = "did:chain:kidA"
        val childB = "did:chain:kidB"
        // child A 在飞一段 game run
        src.submitSample(childA, pkgGame, 1000L)
        src.submitSample(childA, pkgGame, 61_000L)
        // 切到 child B: 旧 game run 必须 finalize 并归属 A (不是 B)
        src.submitSample(childB, pkgChat, 120_000L)

        assertEquals(1, emitted.size)
        val ev = emitted[0]
        assertEquals(childA, ev.childDid) // 关键: 归属旧 child, 不串到 B
        assertTrue(ev.payload.contains(pkgGame))
        assertEquals(60_000L, ev.durationMs)
    }

    @Test
    fun `pause is idempotent`() = runTest {
        val src = ForegroundAppTelemetrySource()
        src.pause()
        src.pause() // 第二次 no-op
        assertTrue(src.isPaused())
    }
}
