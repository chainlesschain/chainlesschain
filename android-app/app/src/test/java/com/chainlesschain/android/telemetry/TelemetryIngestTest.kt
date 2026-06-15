package com.chainlesschain.android.telemetry

import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.runBlocking
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * FAMILY-26 下行侧验收：TelemetryIngest 把孩子端 [TelemetrySyncData] JSON 还原成
 * 类型化 [TelemetryEvent]，且鲁棒拒绝坏数据。核心用例走**真实 outbox 编码 → 解码**
 * 往返，证明孩子端 → 家长端字段保真。
 */
class TelemetryIngestTest {

    private val event = TelemetryEvent(
        childDid = "did:chain:kid",
        source = TelemetrySourceType.FOREGROUND_APP,
        kind = "run",
        payload = """{"package":"com.tencent.tmgp.sgame","duration_ms":90000}""",
        timestampMs = 1000L,
        durationMs = 90_000L,
        level = TelemetryLevel.L1,
    )

    /** 用真实 SyncManagerTelemetryOutbox 编码，捕获其 SyncItem.data（= 家长端会收到的字节）。 */
    private fun encodeViaOutbox(
        e: TelemetryEvent,
        rowId: Long,
        guardians: List<String>,
    ): String {
        val syncManager = mockk<SyncManager>()
        val captured = slot<SyncItem>()
        every { syncManager.recordChange(capture(captured)) } returns Unit
        runBlocking { SyncManagerTelemetryOutbox(syncManager).enqueue(e, rowId, guardians) }
        return captured.captured.data
    }

    @Test
    fun `round-trips a foreground app event from outbox encoding`() {
        val json = encodeViaOutbox(event, rowId = 42L, guardians = listOf("did:chain:mom", "did:chain:dad"))

        val result = TelemetryIngest.decode(json)

        val accepted = assertIs<TelemetryIngest.Result.Accepted>(result)
        val r = accepted.received
        assertEquals(event, r.event) // 全字段保真（source/level 类型化还原正确）
        assertEquals(42L, r.sourceRowId)
        assertEquals(listOf("did:chain:mom", "did:chain:dad"), r.guardianDids)
        assertTrue(r.notes.isEmpty())
    }

    @Test
    fun `malformed JSON is rejected, not thrown`() {
        val result = TelemetryIngest.decode("{not valid json")
        val rejected = assertIs<TelemetryIngest.Result.Rejected>(result)
        assertTrue(rejected.reason.contains("malformed", ignoreCase = true))
    }

    @Test
    fun `missing required field is rejected`() {
        // 缺 timestampMs / rowId / guardianDids 等必填键
        val result = TelemetryIngest.decode("""{"childDid":"did:chain:kid","source":"foreground_app"}""")
        assertIs<TelemetryIngest.Result.Rejected>(result)
    }

    @Test
    fun `unknown source is rejected`() {
        val json = encodeViaOutbox(event, 1L, listOf("did:chain:mom")).replace("foreground_app", "telepathy")
        val rejected = assertIs<TelemetryIngest.Result.Rejected>(TelemetryIngest.decode(json))
        assertTrue(rejected.reason.contains("telepathy"))
    }

    @Test
    fun `blank childDid is rejected`() {
        val json = encodeViaOutbox(event.copy(childDid = " "), 1L, emptyList())
        assertIs<TelemetryIngest.Result.Rejected>(TelemetryIngest.decode(json))
    }

    @Test
    fun `non-positive timestamp is rejected`() {
        val json = encodeViaOutbox(event.copy(timestampMs = 0L), 1L, emptyList())
        assertIs<TelemetryIngest.Result.Rejected>(TelemetryIngest.decode(json))
    }

    @Test
    fun `unknown level defaults to L1 with a note`() {
        val json = encodeViaOutbox(event, 1L, listOf("did:chain:mom")).replace("\"L1\"", "\"L9\"")
        val accepted = assertIs<TelemetryIngest.Result.Accepted>(TelemetryIngest.decode(json))
        assertEquals(TelemetryLevel.L1, accepted.received.event.level)
        assertTrue(accepted.received.notes.any { it.contains("L9") })
    }

    @Test
    fun `negative duration is clamped to zero with a note`() {
        // outbox 不产负值，故手拼一条合法 schema 的 JSON
        val json = """
            {"childDid":"did:chain:kid","source":"foreground_app","kind":"run",
             "payload":"{}","timestampMs":1000,"durationMs":-5,"level":"L1",
             "rowId":1,"guardianDids":[]}
        """.trimIndent()
        val accepted = assertIs<TelemetryIngest.Result.Accepted>(TelemetryIngest.decode(json))
        assertEquals(0L, accepted.received.event.durationMs)
        assertTrue(accepted.received.notes.any { it.contains("clamped", ignoreCase = true) })
    }
}
