package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * FAMILY-21 验收: TelemetryEvent ↔ ChildEventEntity 双向 round-trip + 边界.
 * 全 pure 单测; 无 IO。
 */
class TelemetryEventConverterTest {

    @Test
    fun `toEntity preserves all fields with enum storageValue + level name`() {
        val event = TelemetryEvent(
            childDid = "did:chain:kid",
            source = TelemetrySourceType.PDH_COLLECTOR,
            kind = "message",
            payload = """{"chat":"abc"}""",
            timestampMs = 1_700_000_000_000L,
            durationMs = 5_000L,
            level = TelemetryLevel.L2,
        )
        val entity = TelemetryEventConverter.toEntity(event)
        assertEquals("did:chain:kid", entity.childDid)
        assertEquals("pdh", entity.source)
        assertEquals("message", entity.kind)
        assertEquals("""{"chat":"abc"}""", entity.payload)
        assertEquals(1_700_000_000_000L, entity.timestamp)
        assertEquals(5_000L, entity.durationMs)
        assertEquals("L2", entity.level)
    }

    @Test
    fun `fromEntity inverts toEntity (round-trip equality)`() {
        val original = TelemetryEvent(
            childDid = "did:chain:kid",
            source = TelemetrySourceType.FOREGROUND_APP,
            kind = "run",
            payload = """{"package":"com.x","duration_ms":60000}""",
            timestampMs = 1_700_000_000_000L,
            durationMs = 60_000L,
            level = TelemetryLevel.L1,
        )
        val decoded = TelemetryEventConverter.fromEntity(
            TelemetryEventConverter.toEntity(original),
        )
        assertEquals(original, decoded)
    }

    @Test
    fun `fromEntity returns null on unknown source`() {
        val bad = ChildEventEntity(
            childDid = "did",
            source = "unknown_source",
            kind = "x",
            payload = "{}",
            timestamp = 0L,
            durationMs = 0L,
            level = "L1",
        )
        assertNull(TelemetryEventConverter.fromEntity(bad))
    }

    @Test
    fun `fromEntity returns null on unknown level`() {
        val bad = ChildEventEntity(
            childDid = "did",
            source = "pdh",
            kind = "x",
            payload = "{}",
            timestamp = 0L,
            durationMs = 0L,
            level = "L9", // 不存在
        )
        assertNull(TelemetryEventConverter.fromEntity(bad))
    }

    @Test
    fun `all 4 source types round-trip`() {
        TelemetrySourceType.entries.forEach { source ->
            val event = TelemetryEvent(
                childDid = "did:chain:kid",
                source = source,
                kind = "test",
                payload = "{}",
                timestampMs = 1L,
            )
            val decoded = TelemetryEventConverter.fromEntity(
                TelemetryEventConverter.toEntity(event),
            )
            assertNotNull(decoded, "source $source must round-trip")
            assertEquals(source, decoded.source)
        }
    }

    @Test
    fun `all 4 TelemetryLevel round-trip`() {
        TelemetryLevel.entries.forEach { level ->
            val event = TelemetryEvent(
                childDid = "did:chain:kid",
                source = TelemetrySourceType.FOREGROUND_APP,
                kind = "test",
                payload = "{}",
                timestampMs = 1L,
                level = level,
            )
            val decoded = TelemetryEventConverter.fromEntity(
                TelemetryEventConverter.toEntity(event),
            )
            assertNotNull(decoded)
            assertEquals(level, decoded.level)
        }
    }

    @Test
    fun `TelemetrySourceType fromStorage rejects unknown value`() {
        assertNull(TelemetrySourceType.fromStorage("nonexistent"))
        assertEquals(
            TelemetrySourceType.ACCESSIBILITY,
            TelemetrySourceType.fromStorage("accessibility"),
        )
    }
}
