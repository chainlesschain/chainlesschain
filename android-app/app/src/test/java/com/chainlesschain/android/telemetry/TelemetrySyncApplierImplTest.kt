package com.chainlesschain.android.telemetry

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.data.telemetry.TelemetryEventConverter
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import com.chainlesschain.android.feature.familyguard.domain.telemetry.ForegroundAppRun
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-26 下行落库验收：TelemetrySyncApplierImpl 解码收到的 sync data 并落
 * child_event 镜像表；拒绝坏数据时不落库、不抛异常。
 */
class TelemetrySyncApplierImplTest {

    /** 记录 saveTelemetryEvent 调用的 fake repo（其余方法不参与本测，给最小实现）。 */
    private class RecordingChildEventRepository : ChildEventRepository {
        val saved = mutableListOf<TelemetryEvent>()
        override suspend fun saveTelemetryEvent(event: TelemetryEvent): Long {
            saved += event
            return saved.size.toLong()
        }
        override suspend fun saveForegroundAppRun(childDid: String, run: ForegroundAppRun): Long = 0L
        override suspend fun saveEvent(event: ChildEventEntity): Long = 0L
        override suspend fun querySince(childDid: String, sinceMs: Long): List<ChildEventEntity> = emptyList()
        override fun observeRecent(childDid: String, limit: Int): Flow<List<ChildEventEntity>> = flowOf(emptyList())
        override fun observeRecentAnyChild(limit: Int): Flow<List<ChildEventEntity>> = flowOf(emptyList())
        override suspend fun deleteOlderThan(cutoffMs: Long): Int = 0
    }

    private val event = TelemetryEvent(
        childDid = "did:chain:kid",
        source = TelemetrySourceType.FOREGROUND_APP,
        kind = "run",
        payload = """{"package":"com.tencent.tmgp.sgame","duration_ms":90000}""",
        timestampMs = 1000L,
        durationMs = 90_000L,
        level = TelemetryLevel.L1,
    )

    /**
     * 家长端会收到的 TelemetrySyncData JSON（schema 同孩子端 outbox 编码）。
     * outbox→ingest 字节保真已由 TelemetryIngestTest 经真实编码往返证实；本测只需合法 JSON。
     */
    private fun syncJson(
        source: String = "foreground_app",
        childDid: String = "did:chain:kid",
    ): String = """
        {"childDid":"$childDid","source":"$source","kind":"run",
         "payload":"{\"package\":\"com.tencent.tmgp.sgame\",\"duration_ms\":90000}",
         "timestampMs":1000,"durationMs":90000,"level":"L1",
         "rowId":7,"guardianDids":["did:chain:mom"]}
    """.trimIndent()

    @Test
    fun `accepted sync data is stored via repository`() = runBlocking {
        val repo = RecordingChildEventRepository()
        TelemetrySyncApplierImpl(repo).saveTelemetryFromSync("res-1", syncJson())

        assertEquals(1, repo.saved.size)
        assertEquals(event, repo.saved[0])
        // 落库后可经 converter 还原为 child_event 行（家长端镜像表）
        assertEquals("foreground_app", TelemetryEventConverter.toEntity(repo.saved[0]).source)
    }

    @Test
    fun `rejected sync data is not stored and does not throw`() = runBlocking {
        val repo = RecordingChildEventRepository()
        TelemetrySyncApplierImpl(repo).saveTelemetryFromSync("res-bad", "{not json")
        TelemetrySyncApplierImpl(repo).saveTelemetryFromSync("res-unknown-source", syncJson(source = "telepathy"))
        assertTrue(repo.saved.isEmpty())
    }
}
