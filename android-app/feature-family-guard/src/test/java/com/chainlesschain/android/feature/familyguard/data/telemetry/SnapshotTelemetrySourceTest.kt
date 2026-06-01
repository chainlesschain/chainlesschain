package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.SnapshotPayload
import com.chainlesschain.android.feature.familyguard.domain.telemetry.SnapshotRecord
import com.chainlesschain.android.feature.familyguard.domain.telemetry.SnapshotRecordType
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * FAMILY-22 验收: SnapshotTelemetrySource 把 Plan C 记录打 child_did + 包 TelemetryEvent
 * emit; level 取类型默认; pause/resume。
 *
 * SharedFlow 投递在 runTest 下必须 UnconfinedTestDispatcher + backgroundScope collector
 * ([[android_runtest_sharedflow_unconfined_dispatcher]])。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SnapshotTelemetrySourceTest {

    private val childDid = "did:chain:kid"

    private fun contact() = SnapshotRecord(
        type = SnapshotRecordType.CONTACT,
        occurredAtMs = 1000L,
        fields = mapOf("name" to "妈妈", "numbers" to "13800000000"),
    )

    @Test
    fun `sourceType is SNAPSHOT_WRITER`() {
        assertEquals(TelemetrySourceType.SNAPSHOT_WRITER, SnapshotTelemetrySource().sourceType)
    }

    @Test
    fun `submitRecord emits one child-tagged event`() = runTest {
        val src = SnapshotTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }

        val count = src.submitRecord(childDid, contact())

        assertEquals(1, count)
        assertEquals(1, emitted.size)
        val ev = emitted[0]
        assertEquals(TelemetrySourceType.SNAPSHOT_WRITER, ev.source)
        assertEquals("contact", ev.kind)
        assertEquals(childDid, ev.childDid)
        assertEquals(1000L, ev.timestampMs)
        assertEquals(TelemetryLevel.L2, ev.level) // CONTACT 默认 L2
        // payload round-trips
        assertEquals(mapOf("name" to "妈妈", "numbers" to "13800000000"), SnapshotPayload.decodeOrEmpty(ev.payload))
    }

    @Test
    fun `submitRecords batch emits all records`() = runTest {
        val src = SnapshotTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }

        val records = listOf(
            SnapshotRecord(SnapshotRecordType.CALL, 2000L, mapOf("number" to "110", "type" to "incoming")),
            SnapshotRecord(SnapshotRecordType.SMS, 3000L, mapOf("address" to "955xx", "type" to "inbox")),
            SnapshotRecord(SnapshotRecordType.NOTIFICATION, 4000L, mapOf("package" to "com.x", "title" to "hi")),
        )
        val count = src.submitRecords(childDid, records)

        assertEquals(3, count)
        assertEquals(3, emitted.size)
        assertEquals(listOf("call", "sms", "notification"), emitted.map { it.kind })
    }

    @Test
    fun `level follows record type default mapping`() = runTest {
        val src = SnapshotTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        src.submitRecords(
            childDid,
            listOf(
                SnapshotRecord(SnapshotRecordType.CONTACT, 1L, emptyMap()),
                SnapshotRecord(SnapshotRecordType.CALL, 2L, emptyMap()),
                SnapshotRecord(SnapshotRecordType.SMS, 3L, emptyMap()),
                SnapshotRecord(SnapshotRecordType.NOTIFICATION, 4L, emptyMap()),
            ),
        )
        assertEquals(
            listOf(TelemetryLevel.L2, TelemetryLevel.L1, TelemetryLevel.L2, TelemetryLevel.L1),
            emitted.map { it.level },
        )
    }

    @Test
    fun `pause drops emits and returns zero`() = runTest {
        val src = SnapshotTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        src.pause()
        assertTrue(src.isPaused())

        assertEquals(0, src.submitRecord(childDid, contact()))
        assertEquals(0, src.submitRecords(childDid, listOf(contact(), contact())))
        assertTrue(emitted.isEmpty())
    }

    @Test
    fun `resume re-enables emits`() = runTest {
        val src = SnapshotTelemetrySource()
        val emitted = mutableListOf<TelemetryEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            src.events().collect { emitted.add(it) }
        }
        src.pause()
        src.resume()
        assertFalse(src.isPaused())

        assertEquals(1, src.submitRecord(childDid, contact()))
        assertEquals(1, emitted.size)
    }
}
