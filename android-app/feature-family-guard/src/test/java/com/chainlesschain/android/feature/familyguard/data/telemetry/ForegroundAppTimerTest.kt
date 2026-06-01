package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.telemetry.ChildIdentityProvider
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppQuery
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-20 验收: ForegroundAppTimer.pollOnce 轮询闸 + 提交逻辑。
 *
 * 直驱 [ForegroundAppTimer.pollOnce] (不经 while-delay 生产协程, 避开
 * [[android_runtest_production_scope_hang]]); 用**真**
 * [ForegroundAppTelemetrySource] 收集其 events 验证提交链路 (SharedFlow 在
 * runTest 下走 [UnconfinedTestDispatcher], 见 [[android_runtest_sharedflow_unconfined_dispatcher]])。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ForegroundAppTimerTest {

    private val childDid = "did:chain:kid"
    private val pkgGame = "com.tencent.tmgp.sgame"
    private val pkgChat = "com.tencent.mm"

    @Test
    fun `non-child device does not sample`() = runTest {
        val source = ForegroundAppTelemetrySource()
        val emitted = collect(source)
        val timer = timer(
            source = source,
            identity = FakeIdentity(did = null), // 家长端 / 未选角色
            query = FakeQuery(granted = true, current = pkgGame),
        )

        timer.pollOnce(1000L)
        timer.pollOnce(61_000L)
        timer.pollOnce(nowMs = 121_000L)

        assertTrue(emitted.isEmpty())
    }

    @Test
    fun `no usage access does not sample`() = runTest {
        val source = ForegroundAppTelemetrySource()
        val emitted = collect(source)
        val timer = timer(
            source = source,
            identity = FakeIdentity(did = childDid),
            query = FakeQuery(granted = false, current = pkgGame), // 未授予 Usage Access
        )

        timer.pollOnce(1000L)
        timer.pollOnce(61_000L)

        assertTrue(emitted.isEmpty())
    }

    @Test
    fun `child device samples foreground app and emits run on package change`() = runTest {
        val source = ForegroundAppTelemetrySource()
        val emitted = collect(source)
        val query = FakeQuery(granted = true, current = pkgGame)
        val timer = timer(source = source, identity = FakeIdentity(did = childDid), query = query)

        timer.pollOnce(1000L) // 起 pkgGame run
        timer.pollOnce(61_000L) // 延伸
        query.current = pkgChat
        timer.pollOnce(121_000L) // 切包 → emit pkgGame run

        assertEquals(1, emitted.size)
        val ev = emitted[0]
        assertEquals(childDid, ev.childDid)
        assertTrue(ev.payload.contains(pkgGame))
        assertEquals(60_000L, ev.durationMs) // 61000 - 1000
    }

    @Test
    fun `null query result reuses last foreground package so run keeps extending`() = runTest {
        val source = ForegroundAppTelemetrySource()
        val emitted = collect(source)
        val query = FakeQuery(granted = true, current = pkgGame)
        val timer = timer(source = source, identity = FakeIdentity(did = childDid), query = query)

        timer.pollOnce(1000L) // pkgGame
        query.current = null // 窗口内无新前台事件 (用户停在 pkgGame 没切)
        timer.pollOnce(61_000L) // 沿用 pkgGame → 延伸到 61000
        query.current = pkgChat
        timer.pollOnce(121_000L) // 切包 → emit pkgGame run

        assertEquals(1, emitted.size)
        // 若没"沿用上次包"逻辑, 中间 poll 会跳过, pkgGame run 时长会是 0 而非 60000。
        assertEquals(60_000L, emitted[0].durationMs)
    }

    // ─── helpers / fakes ───

    /** Subscribe to [source] under Unconfined so emits land in source order, no timing. */
    private fun TestScope.collect(source: ForegroundAppTelemetrySource): List<TelemetryEvent> {
        val out = mutableListOf<TelemetryEvent>()
        val scope: CoroutineScope = backgroundScope
        scope.launch(UnconfinedTestDispatcher(testScheduler)) {
            source.events().collect { out.add(it) }
        }
        return out
    }

    private fun timer(
        source: ForegroundAppTelemetrySource,
        identity: ChildIdentityProvider,
        query: ForegroundAppQuery,
    ) = ForegroundAppTimer(query = query, childIdentityProvider = identity, source = source)

    private class FakeIdentity(private val did: String?) : ChildIdentityProvider {
        override suspend fun childDidOrNull(): String? = did
    }

    private class FakeQuery(
        var granted: Boolean = true,
        var current: String? = null,
    ) : ForegroundAppQuery {
        override fun isAccessGranted(): Boolean = granted
        override fun currentForegroundPackage(sinceMs: Long, nowMs: Long): String? = current
    }
}
