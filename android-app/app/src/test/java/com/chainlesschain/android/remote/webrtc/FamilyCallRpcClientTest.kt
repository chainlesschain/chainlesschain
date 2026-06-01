package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction
import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyPermissionChecker
import com.chainlesschain.android.feature.familyguard.domain.permission.PermissionDecision
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * FAMILY-34 验收: FamilyCallRpcClient 6 方法 envelope + 权限闸 + 入向 dispatch + LRU 去重。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FamilyCallRpcClientTest {

    private val targetPeer = "did:chain:zzz-kid" // > parentDid → 邀请方 INITIATOR
    private val targetDid = "did:chain:kid"
    private val parentDid = "did:chain:aaa-parent"

    private class FakeChecker(private val decision: PermissionDecision) : FamilyPermissionChecker {
        var lastAction: FamilyAction? = null
        override suspend fun check(action: FamilyAction, targetDid: String): PermissionDecision {
            lastAction = action
            return decision
        }
    }

    private class FakeSignalClient : SignalClient {
        var lastToPeerId: String? = null
        var lastPayload: JSONObject? = null
        var sendCount = 0
        private val _forwarded = MutableSharedFlow<String>(extraBufferCapacity = 64)
        override val forwardedMessages: SharedFlow<String> = _forwarded.asSharedFlow()

        override suspend fun connect(): Result<Unit> = Result.success(Unit)
        override suspend fun register(peerId: String, deviceInfo: Map<String, String>) {}
        override suspend fun sendOffer(peerId: String, offer: org.webrtc.SessionDescription) {}
        override suspend fun sendIceCandidate(peerId: String, candidate: org.webrtc.IceCandidate) {}
        override suspend fun waitForAnswer(peerId: String, timeout: Long): org.webrtc.SessionDescription =
            throw UnsupportedOperationException()
        override suspend fun sendAnswer(peerId: String, answer: org.webrtc.SessionDescription) {}
        override suspend fun waitForOffer(peerId: String, timeout: Long): org.webrtc.SessionDescription =
            throw UnsupportedOperationException()
        override suspend fun receiveIceCandidate(): org.webrtc.IceCandidate =
            throw UnsupportedOperationException()
        override suspend fun sendForwardedMessage(toPeerId: String, payload: JSONObject): Result<Unit> {
            sendCount++
            lastToPeerId = toPeerId
            lastPayload = payload
            return Result.success(Unit)
        }
        override fun disconnect() {}
        override fun setOnForwardedMessageReceived(callback: ((String) -> Unit)?) {}
    }

    private fun didManager(): DIDManager =
        mockk { every { getCurrentDID() } returns parentDid }

    private fun client(checker: FamilyPermissionChecker, signal: FakeSignalClient) =
        FamilyCallRpcClient(signal, didManager(), CallNegotiator(), CallKindGate(checker))

    @Test
    fun `invite AUDIO allowed sends invite envelope with callKind + inviterRole`() = runTest {
        val checker = FakeChecker(PermissionDecision.Allow)
        val signal = FakeSignalClient()
        val res = client(checker, signal).invite(targetPeer, targetDid, CallKind.AUDIO)

        assertTrue(res.isSuccess)
        assertEquals(FamilyAction.StartAudioCall, checker.lastAction)
        assertEquals(targetPeer, signal.lastToPeerId)
        val p = signal.lastPayload!!
        assertEquals("chainlesschain:family:call:invite", p.getString("type"))
        assertEquals("AUDIO", p.getString("callKind"))
        assertEquals(parentDid, p.getString("from"))
        assertTrue(p.getString("callId").startsWith("call-"))
        assertNotNull(p.optString("inviterRole", null)) // negotiator role included
    }

    @Test
    fun `invite denied returns CallPermissionDenied and does not send`() = runTest {
        val checker = FakeChecker(PermissionDecision.Deny(PermissionDecision.DenyReason.PERMISSION_DISABLED))
        val signal = FakeSignalClient()
        val res = client(checker, signal).invite(targetPeer, targetDid, CallKind.VIDEO)

        assertTrue(res.isFailure)
        assertTrue(res.exceptionOrNull() is CallPermissionDeniedException)
        assertEquals(0, signal.sendCount)
    }

    @Test
    fun `silentObserve gates on StartSilentObserve + sends silent_observe`() = runTest {
        val checker = FakeChecker(PermissionDecision.Allow)
        val signal = FakeSignalClient()
        client(checker, signal).silentObserve(targetPeer, targetDid)
        assertEquals(FamilyAction.StartSilentObserve, checker.lastAction)
        assertEquals("chainlesschain:family:call:silent_observe", signal.lastPayload!!.getString("type"))
        assertEquals("SILENT_OBSERVE", signal.lastPayload!!.getString("callKind"))
    }

    @Test
    fun `urgentForce gates on StartForcePickup`() = runTest {
        val checker = FakeChecker(PermissionDecision.Allow)
        val signal = FakeSignalClient()
        client(checker, signal).urgentForce(targetPeer, targetDid)
        assertEquals(FamilyAction.StartForcePickup, checker.lastAction)
        assertEquals("chainlesschain:family:call:urgent_force", signal.lastPayload!!.getString("type"))
    }

    @Test
    fun `accept reject hangup send control envelopes (no gate)`() = runTest {
        val checker = FakeChecker(PermissionDecision.Allow)
        val signal = FakeSignalClient()
        val c = client(checker, signal)
        c.accept(targetPeer, "call-1")
        assertEquals("chainlesschain:family:call:accept", signal.lastPayload!!.getString("type"))
        c.reject(targetPeer, "call-1", reason = "busy")
        assertEquals("chainlesschain:family:call:reject", signal.lastPayload!!.getString("type"))
        assertEquals("busy", signal.lastPayload!!.getString("reason"))
        c.hangup(targetPeer, "call-1")
        assertEquals("chainlesschain:family:call:hangup", signal.lastPayload!!.getString("type"))
        // control 方法不查 checker
        assertEquals(null, checker.lastAction)
    }

    @Test
    fun `inbound invite is parsed and emitted`() = runTest {
        val signal = FakeSignalClient()
        val c = client(FakeChecker(PermissionDecision.Allow), signal)
        val events = mutableListOf<FamilyCallEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            c.observeCallEvents().collect { events.add(it) }
        }
        c.handleForwarded(inviteFrame("call-9", seq = 1, kind = "AUDIO"))
        assertEquals(1, events.size)
        assertEquals(FamilyCallType.INVITE, events[0].type)
        assertEquals("call-9", events[0].callId)
        assertEquals(CallKind.AUDIO, events[0].callKind)
    }

    @Test
    fun `LRU dedup drops duplicate callId-seq`() = runTest {
        val signal = FakeSignalClient()
        val c = client(FakeChecker(PermissionDecision.Allow), signal)
        val events = mutableListOf<FamilyCallEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            c.observeCallEvents().collect { events.add(it) }
        }
        c.handleForwarded(inviteFrame("call-9", seq = 1, kind = "AUDIO"))
        c.handleForwarded(inviteFrame("call-9", seq = 1, kind = "AUDIO")) // dup
        c.handleForwarded(inviteFrame("call-9", seq = 2, kind = "AUDIO")) // new seq
        assertEquals(2, events.size) // dup dropped, seq=2 kept
    }

    @Test
    fun `non family-call forwarded message ignored`() = runTest {
        val signal = FakeSignalClient()
        val c = client(FakeChecker(PermissionDecision.Allow), signal)
        val events = mutableListOf<FamilyCallEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            c.observeCallEvents().collect { events.add(it) }
        }
        c.handleForwarded("""{"type":"chainlesschain:command:response","payload":{}}""")
        c.handleForwarded("not json")
        assertTrue(events.isEmpty())
    }

    private fun inviteFrame(callId: String, seq: Long, kind: String): String =
        JSONObject().apply {
            put("type", "chainlesschain:family:call:invite")
            put("callId", callId)
            put("from", targetPeer)
            put("seq", seq)
            put("callKind", kind)
        }.toString()
}
