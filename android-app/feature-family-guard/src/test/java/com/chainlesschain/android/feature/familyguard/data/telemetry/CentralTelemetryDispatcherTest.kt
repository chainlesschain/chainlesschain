package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.emergency.UpstreamFreezer
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryOutbox
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryUploadGate
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-21 验收: CentralTelemetryDispatcher.process 上行管线 —
 * freeze 丢弃 / 无授权 guardian 丢弃 / 去重不重复上行 / 正常落库+排上行。
 *
 * 直接驱动 [CentralTelemetryDispatcher.process] (不经 start() 收集协程), 避免
 * hot-flow 时序 flaky。
 */
class CentralTelemetryDispatcherTest {

    private val event = TelemetryEvent(
        childDid = "did:chain:kid",
        source = TelemetrySourceType.FOREGROUND_APP,
        kind = "run",
        payload = """{"package":"com.x","duration_ms":60000}""",
        timestampMs = 1000L,
        durationMs = 60_000L,
        level = TelemetryLevel.L1,
    )

    @Test
    fun `permitted event is saved and enqueued with guardians`() = runTest {
        val repo = RecordingRepo(nextRowId = 42L)
        val outbox = RecordingOutbox()
        val dispatcher = dispatcher(
            gate = FakeGate(listOf("did:chain:mom", "did:chain:dad")),
            repo = repo,
            outbox = outbox,
            freezer = FakeFreezer(frozen = false),
        )

        dispatcher.process(event)

        assertEquals(1, repo.saved.size)
        assertEquals(event, repo.saved[0])
        assertEquals(1, outbox.enqueued.size)
        val (ev, rowId, guardians) = outbox.enqueued[0]
        assertEquals(event, ev)
        assertEquals(42L, rowId)
        assertEquals(listOf("did:chain:mom", "did:chain:dad"), guardians)
    }

    @Test
    fun `frozen drops event without save or enqueue`() = runTest {
        val repo = RecordingRepo()
        val outbox = RecordingOutbox()
        val dispatcher = dispatcher(
            gate = FakeGate(listOf("did:chain:mom")),
            repo = repo,
            outbox = outbox,
            freezer = FakeFreezer(frozen = true),
        )

        dispatcher.process(event)

        assertTrue(repo.saved.isEmpty())
        assertTrue(outbox.enqueued.isEmpty())
    }

    @Test
    fun `no permitted guardian drops event without save or enqueue`() = runTest {
        val repo = RecordingRepo()
        val outbox = RecordingOutbox()
        val gate = FakeGate(emptyList())
        val dispatcher = dispatcher(gate = gate, repo = repo, outbox = outbox, freezer = FakeFreezer())

        dispatcher.process(event)

        assertEquals(1, gate.calls) // 闸被问过
        assertTrue(repo.saved.isEmpty())
        assertTrue(outbox.enqueued.isEmpty())
    }

    @Test
    fun `dedup insert (rowId le 0) saves but does not enqueue`() = runTest {
        val repo = RecordingRepo(nextRowId = -1L) // OnConflictStrategy.IGNORE 命中
        val outbox = RecordingOutbox()
        val dispatcher = dispatcher(
            gate = FakeGate(listOf("did:chain:mom")),
            repo = repo,
            outbox = outbox,
            freezer = FakeFreezer(),
        )

        dispatcher.process(event)

        assertEquals(1, repo.saved.size) // 仍尝试插入
        assertTrue(outbox.enqueued.isEmpty()) // 但去重命中, 不重复上行
    }

    // ─── fakes ───

    private fun dispatcher(
        gate: TelemetryUploadGate,
        repo: ChildEventRepository,
        outbox: TelemetryOutbox,
        freezer: UpstreamFreezer,
    ) = CentralTelemetryDispatcher(
        sources = emptySet(),
        uploadGate = gate,
        childEventRepository = repo,
        outbox = outbox,
        upstreamFreezer = freezer,
    )

    private class FakeFreezer(frozen: Boolean = false) : UpstreamFreezer {
        private val state = MutableStateFlow(frozen)
        override val isFrozen: StateFlow<Boolean> = state
        override suspend fun freeze(reason: String): Boolean = state.compareAndSet(false, true)
        override suspend fun unfreeze(): Boolean = state.compareAndSet(true, false)
    }

    private class FakeGate(private val guardians: List<String>) : TelemetryUploadGate {
        var calls = 0
        override suspend fun permittedGuardians(event: TelemetryEvent): List<String> {
            calls++
            return guardians
        }
    }

    private class RecordingOutbox : TelemetryOutbox {
        val enqueued = mutableListOf<Triple<TelemetryEvent, Long, List<String>>>()
        override suspend fun enqueue(event: TelemetryEvent, savedRowId: Long, guardianDids: List<String>) {
            enqueued.add(Triple(event, savedRowId, guardianDids))
        }
    }

    private class RecordingRepo(private val nextRowId: Long = 1L) : ChildEventRepository {
        val saved = mutableListOf<TelemetryEvent>()
        override suspend fun saveTelemetryEvent(event: TelemetryEvent): Long {
            saved.add(event)
            return nextRowId
        }

        override suspend fun saveForegroundAppRun(childDid: String, run: ForegroundAppRun): Long = nextRowId
        override suspend fun saveEvent(event: ChildEventEntity): Long = nextRowId
        override suspend fun querySince(childDid: String, sinceMs: Long): List<ChildEventEntity> = emptyList()
        override fun observeRecent(childDid: String, limit: Int): Flow<List<ChildEventEntity>> = emptyFlow()
        override fun observeRecentAnyChild(limit: Int): Flow<List<ChildEventEntity>> = emptyFlow()
        override suspend fun deleteOlderThan(cutoffMs: Long): Int = 0
    }
}
