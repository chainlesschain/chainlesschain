package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * FAMILY-32 验收: CallKind track 配置 + CallKindGate 权限闸（5 类启动 + 拒绝路径）。
 */
class CallKindGateTest {

    private val kid = "did:chain:kid"

    private class FakeChecker(
        private val decision: PermissionDecision = PermissionDecision.Allow,
    ) : FamilyPermissionChecker {
        var lastAction: FamilyAction? = null
        var callCount = 0
        override suspend fun check(action: FamilyAction, targetDid: String): PermissionDecision {
            callCount++
            lastAction = action
            return decision
        }
    }

    @Test
    fun `5 kinds expose correct track config + banner + action`() {
        assertEquals(TrackConfig(TrackDir.SENDRECV, TrackDir.NONE), CallKind.AUDIO.tracks)
        assertEquals(FamilyAction.StartAudioCall, CallKind.AUDIO.requiredAction)
        assertEquals(CallBanner.NONE, CallKind.AUDIO.banner)

        assertEquals(TrackDir.SENDRECV, CallKind.VIDEO.tracks.video)
        assertEquals(FamilyAction.StartVideoCall, CallKind.VIDEO.requiredAction)

        assertEquals(TrackConfig(TrackDir.RECVONLY, TrackDir.RECVONLY), CallKind.SILENT_OBSERVE.tracks)
        assertEquals(FamilyAction.StartSilentObserve, CallKind.SILENT_OBSERVE.requiredAction)
        assertEquals(CallBanner.RED_ALERT, CallKind.SILENT_OBSERVE.banner)

        assertEquals(FamilyAction.StartForcePickup, CallKind.URGENT.requiredAction)
        assertEquals(CallBanner.RED_ALERT, CallKind.URGENT.banner)

        assertEquals(TrackConfig(TrackDir.SENDONLY, TrackDir.SENDONLY), CallKind.SOS_BROADCAST.tracks)
        assertEquals(null, CallKind.SOS_BROADCAST.requiredAction) // 无权限闸
        assertEquals(CallBanner.RED_ALERT, CallKind.SOS_BROADCAST.banner)

        assertEquals(5, CallKind.entries.size)
    }

    @Test
    fun `gated kind allowed when checker allows + maps to right action`() = runTest {
        val checker = FakeChecker(PermissionDecision.Allow)
        val gate = CallKindGate(checker)
        assertTrue(gate.isAllowed(CallKind.AUDIO, kid))
        assertEquals(FamilyAction.StartAudioCall, checker.lastAction)
    }

    @Test
    fun `gated kind denied returns Deny (权限拒绝路径)`() = runTest {
        val checker = FakeChecker(PermissionDecision.Deny(PermissionDecision.DenyReason.PERMISSION_DISABLED))
        val gate = CallKindGate(checker)
        val decision = gate.authorize(CallKind.VIDEO, kid)
        assertTrue(decision is PermissionDecision.Deny)
        assertFalse(gate.isAllowed(CallKind.VIDEO, kid))
        assertEquals(FamilyAction.StartVideoCall, checker.lastAction)
    }

    @Test
    fun `SOS_BROADCAST allowed without consulting checker`() = runTest {
        // 即使 checker 全 Deny，SOS 仍放行且不查 checker。
        val checker = FakeChecker(PermissionDecision.Deny(PermissionDecision.DenyReason.PERMISSION_DISABLED))
        val gate = CallKindGate(checker)
        assertEquals(PermissionDecision.Allow, gate.authorize(CallKind.SOS_BROADCAST, kid))
        assertEquals(0, checker.callCount) // 未查 checker
    }

    @Test
    fun `each gated kind maps to its FamilyAction`() = runTest {
        val expected = mapOf(
            CallKind.AUDIO to FamilyAction.StartAudioCall,
            CallKind.VIDEO to FamilyAction.StartVideoCall,
            CallKind.SILENT_OBSERVE to FamilyAction.StartSilentObserve,
            CallKind.URGENT to FamilyAction.StartForcePickup,
        )
        for ((kind, action) in expected) {
            val checker = FakeChecker(PermissionDecision.Allow)
            CallKindGate(checker).authorize(kind, kid)
            assertEquals(action, checker.lastAction, "$kind should gate on $action")
        }
    }

    @Test
    fun `NotApplicable (no relationship) propagates`() = runTest {
        val gate = CallKindGate(FakeChecker(PermissionDecision.NotApplicable))
        assertEquals(PermissionDecision.NotApplicable, gate.authorize(CallKind.AUDIO, kid))
        assertFalse(gate.isAllowed(CallKind.AUDIO, kid))
    }
}
