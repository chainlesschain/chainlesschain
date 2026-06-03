package com.chainlesschain.android.feature.familyguard.domain.sos

import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import com.chainlesschain.android.feature.familyguard.domain.repository.SosEventRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * FAMILY-43 验收: SosBroadcastCoordinator 广播去重 + 首接通胜出仲裁 + stand-down 通知。
 * Fake repo (可编排 acknowledge 结果) + 记录型 notifier；竞态安全本身由 repo 守卫保证，
 * 这里验协调器对各 SosTransitionResult 的翻译。
 */
class SosBroadcastCoordinatorTest {

    private val child = "did:child:1"
    private val pA = "did:parent:A"
    private val pB = "did:parent:B"
    private val pC = "did:parent:C"

    private fun sos(id: String = "sos1", loc: String? = "31.2,121.4") = SosEventEntity(
        id = id,
        childDid = child,
        familyGroupId = "grp",
        triggeredAt = 1_000L,
        triggerSource = "in_app",
        locationSnapshot = loc,
    )

    private class RecordingNotifier : SosNotifier {
        var broadcastTargets: List<String>? = null
        var broadcastLoc: String? = null
        var ackedBy: String? = null
        var standDown: List<String>? = null
        var acknowledgedCalls = 0

        override suspend fun notifyFalseAlarm(sosEventId: String, childDid: String, familyGroupId: String, reason: String) {}
        override suspend fun notifyBroadcast(
            sosEventId: String,
            childDid: String,
            familyGroupId: String,
            guardianDids: List<String>,
            locationSnapshot: String?,
        ) {
            broadcastTargets = guardianDids
            broadcastLoc = locationSnapshot
        }
        override suspend fun notifyAcknowledged(sosEventId: String, acknowledgedByDid: String, standDownGuardianDids: List<String>) {
            acknowledgedCalls++
            ackedBy = acknowledgedByDid
            standDown = standDownGuardianDids
        }
    }

    /** acknowledge 返回值可编排; 其余方法本协调器不触达。 */
    private class FakeSosRepository(private val ackResult: SosTransitionResult) : SosEventRepository {
        var ackCalls = 0
        override suspend fun trigger(childDid: String, familyGroupId: String, source: SosTriggerSource, locationSnapshot: String?, audioRecordingRef: String?) = error("unused")
        override suspend fun acknowledge(id: String, guardianDid: String): SosTransitionResult {
            ackCalls++
            return ackResult
        }
        override suspend fun resolve(id: String, note: String?) = error("unused")
        override suspend fun cancelAsFalseAlarm(id: String, reason: String) = error("unused")
        override fun observePending(): Flow<List<SosEventEntity>> = error("unused")
        override fun observeRecentForChild(childDid: String, limit: Int): Flow<List<SosEventEntity>> = error("unused")
        override suspend fun findById(id: String): SosEventEntity? = error("unused")
    }

    private fun coordinator(ack: SosTransitionResult) =
        SosBroadcastCoordinator(FakeSosRepository(ack), RecordingNotifier())

    // ─── broadcast ───

    @Test
    fun `broadcast dedupes drops blanks and child self then notifies all`() = runTest {
        val notifier = RecordingNotifier()
        val coord = SosBroadcastCoordinator(FakeSosRepository(SosTransitionResult.Success), notifier)
        val targets = coord.broadcast(sos(), listOf(pA, pB, pA, "  ", child, pC))
        assertEquals(listOf(pA, pB, pC), targets)
        assertEquals(listOf(pA, pB, pC), notifier.broadcastTargets)
        assertEquals("31.2,121.4", notifier.broadcastLoc)
    }

    @Test
    fun `broadcast with no valid targets does not notify`() = runTest {
        val notifier = RecordingNotifier()
        val coord = SosBroadcastCoordinator(FakeSosRepository(SosTransitionResult.Success), notifier)
        val targets = coord.broadcast(sos(), listOf(child, "  ", child))
        assertTrue(targets.isEmpty())
        assertEquals(null, notifier.broadcastTargets) // notifyBroadcast 未调用
    }

    // ─── onGuardianAck ───

    @Test
    fun `first ack wins and others get stand-down`() = runTest {
        val notifier = RecordingNotifier()
        val repo = FakeSosRepository(SosTransitionResult.Success)
        val coord = SosBroadcastCoordinator(repo, notifier)
        val outcome = coord.onGuardianAck("sos1", pA, listOf(pA, pB, pC, pA))
        assertTrue(outcome is SosAckOutcome.FirstAck)
        assertEquals(pA, outcome.acknowledgedBy)
        assertEquals(listOf(pB, pC), outcome.standDownTargets) // 去掉接通者 + 去重
        assertEquals(1, repo.ackCalls)
        assertEquals(1, notifier.acknowledgedCalls)
        assertEquals(listOf(pB, pC), notifier.standDown)
    }

    @Test
    fun `second ack sees already acknowledged and does not re-notify`() = runTest {
        val notifier = RecordingNotifier()
        val coord = SosBroadcastCoordinator(
            FakeSosRepository(SosTransitionResult.InvalidState(SosStatus.ACKNOWLEDGED)),
            notifier,
        )
        val outcome = coord.onGuardianAck("sos1", pB, listOf(pA, pB))
        assertEquals(SosAckOutcome.AlreadyAcknowledged, outcome)
        assertEquals(0, notifier.acknowledgedCalls)
    }

    @Test
    fun `ack on resolved event is invalid with current state`() = runTest {
        val coord = coordinator(SosTransitionResult.InvalidState(SosStatus.RESOLVED))
        val outcome = coord.onGuardianAck("sos1", pA, listOf(pA, pB))
        assertEquals(SosAckOutcome.Invalid(SosStatus.RESOLVED), outcome)
    }

    @Test
    fun `ack on missing event is not found`() = runTest {
        val coord = coordinator(SosTransitionResult.NotFound)
        assertEquals(SosAckOutcome.NotFound, coord.onGuardianAck("nope", pA, listOf(pA)))
    }
}
