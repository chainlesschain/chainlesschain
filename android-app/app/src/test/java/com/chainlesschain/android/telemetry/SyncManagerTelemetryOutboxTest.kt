package com.chainlesschain.android.telemetry

import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-26 验收: SyncManagerTelemetryOutbox 把 TelemetryEvent 包成
 * ResourceType.TELEMETRY 的 SyncItem 并 recordChange。
 */
class SyncManagerTelemetryOutboxTest {

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
    fun `enqueue records a TELEMETRY SyncItem with stable id`() = runBlocking {
        val syncManager = mockk<SyncManager>()
        val captured = slot<SyncItem>()
        every { syncManager.recordChange(capture(captured)) } returns Unit

        val outbox = SyncManagerTelemetryOutbox(syncManager)
        outbox.enqueue(event, savedRowId = 42L, guardianDids = listOf("did:chain:mom"))

        verify(exactly = 1) { syncManager.recordChange(any()) }
        val item = captured.captured
        assertEquals(ResourceType.TELEMETRY, item.resourceType)
        assertEquals(SyncOperation.CREATE, item.operation)
        assertEquals(1000L, item.timestamp)
        // resourceId 确定且含来源标识 → 同事件不重复入队
        assertEquals("telemetry|did:chain:kid|foreground_app|run|1000", item.resourceId)
    }

    @Test
    fun `enqueue serializes event fields into data JSON`() = runBlocking {
        val syncManager = mockk<SyncManager>()
        val captured = slot<SyncItem>()
        every { syncManager.recordChange(capture(captured)) } returns Unit

        val outbox = SyncManagerTelemetryOutbox(syncManager)
        outbox.enqueue(event, savedRowId = 42L, guardianDids = listOf("did:chain:mom", "did:chain:dad"))

        val data = Json.parseToJsonElement(captured.captured.data).jsonObject
        assertEquals("did:chain:kid", data["childDid"]!!.jsonPrimitive.content)
        assertEquals("foreground_app", data["source"]!!.jsonPrimitive.content) // storageValue 非 ordinal
        assertEquals("run", data["kind"]!!.jsonPrimitive.content)
        assertEquals("L1", data["level"]!!.jsonPrimitive.content) // enum name 非 ordinal
        assertEquals(42L, data["rowId"]!!.jsonPrimitive.content.toLong())
        assertTrue(captured.captured.data.contains("did:chain:dad")) // guardian fan-out 记录
    }
}
