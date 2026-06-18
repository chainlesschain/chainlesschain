package com.chainlesschain.android.call

import com.chainlesschain.android.core.did.manager.DIDManager
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

/**
 * FAMILY-67 通话状态机（[CallManager]）单测——驱动 onSignal + 用户动作，验状态机（不依赖媒体/WebRTC）。
 * 媒体用 NOOP；signaling.send 用 mockk（记录/返回 true）。直接 onSignal 驱动，避免 collect 协程。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CallManagerTest {

    private lateinit var signaling: CallSignalingClient
    private lateinit var didManager: DIDManager
    private lateinit var mgr: CallManager

    private val ME = "did:key:zMe"
    private val PEER = "did:key:zPeer"

    @Before
    fun setup() {
        signaling = mockk(relaxed = true)
        coEvery { signaling.send(any(), any(), any(), any(), any(), any(), any()) } returns true
        didManager = mockk(relaxed = true)
        coEvery { didManager.getCurrentDID() } returns ME
        mgr = CallManager(signaling, didManager).apply {
            clock = { 1000L }
            genCallId = { "call-mine" }
        }
    }

    @Test
    fun `startCall sets OUTGOING`() {
        mgr.startCall(PEER, CallMediaType.AUDIO)
        val s = mgr.callState.value!!
        assertEquals(CallState.OUTGOING, s.state)
        assertEquals(CallDirection.OUTGOING, s.direction)
        assertEquals(PEER, s.peerDid)
        assertEquals("call-mine", s.callId)
    }

    @Test
    fun `incoming invite goes INCOMING`() = runTest {
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-peer", PEER, CallMediaType.AUDIO))
        val s = mgr.callState.value!!
        assertEquals(CallState.INCOMING, s.state)
        assertEquals(CallDirection.INCOMING, s.direction)
        assertEquals(PEER, s.peerDid)
    }

    @Test
    fun `ringing advances OUTGOING to OUTGOING_RINGING`() = runTest {
        mgr.startCall(PEER)
        mgr.onSignal(CallSignal(CallSignalTypes.RINGING, "call-mine", PEER))
        assertEquals(CallState.OUTGOING_RINGING, mgr.callState.value!!.state)
    }

    @Test
    fun `accept on incoming goes CONNECTING`() = runTest {
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-peer", PEER))
        mgr.accept()
        assertEquals(CallState.CONNECTING, mgr.callState.value!!.state)
    }

    @Test
    fun `remote accept on outgoing goes CONNECTING`() = runTest {
        mgr.startCall(PEER)
        mgr.onSignal(CallSignal(CallSignalTypes.ACCEPT, "call-mine", PEER))
        assertEquals(CallState.CONNECTING, mgr.callState.value!!.state)
    }

    @Test
    fun `remote reject ends call`() = runTest {
        mgr.startCall(PEER)
        mgr.onSignal(CallSignal(CallSignalTypes.REJECT, "call-mine", PEER, reason = "declined"))
        assertEquals(CallState.ENDED, mgr.callState.value!!.state)
        assertEquals(CallEndReason.REJECTED, mgr.callState.value!!.endReason)
    }

    @Test
    fun `remote reject busy maps to BUSY`() = runTest {
        mgr.startCall(PEER)
        mgr.onSignal(CallSignal(CallSignalTypes.REJECT, "call-mine", PEER, reason = "busy"))
        assertEquals(CallEndReason.BUSY, mgr.callState.value!!.endReason)
    }

    @Test
    fun `remote hangup ends call`() = runTest {
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-peer", PEER))
        mgr.onSignal(CallSignal(CallSignalTypes.HANGUP, "call-peer", PEER))
        assertEquals(CallState.ENDED, mgr.callState.value!!.state)
        assertEquals(CallEndReason.REMOTE_HANGUP, mgr.callState.value!!.endReason)
    }

    @Test
    fun `media connected goes ACTIVE with connectedAt`() = runTest {
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-peer", PEER))
        mgr.accept()
        mgr.onMediaConnected("call-peer")
        val s = mgr.callState.value!!
        assertEquals(CallState.ACTIVE, s.state)
        assertEquals(1000L, s.connectedAtMs)
    }

    @Test
    fun `busy rejects second invite from other peer, keeps current`() = runTest {
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-a", PEER))   // INCOMING from PEER
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-b", "did:key:zOther"))
        // 当前通话仍是与 PEER 的 call-a
        assertEquals("call-a", mgr.callState.value!!.callId)
        assertEquals(PEER, mgr.callState.value!!.peerDid)
    }

    @Test
    fun `glare keep mine when my callId smaller`() = runTest {
        mgr.genCallId = { "call-aaa" }
        mgr.startCall(PEER)                                                  // OUTGOING call-aaa
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-zzz", PEER))   // 对端来电 call-zzz
        // 保留己方：仍 OUTGOING call-aaa
        assertEquals(CallState.OUTGOING, mgr.callState.value!!.state)
        assertEquals("call-aaa", mgr.callState.value!!.callId)
    }

    @Test
    fun `glare let go when my callId larger - switch to incoming`() = runTest {
        mgr.genCallId = { "call-zzz" }
        mgr.startCall(PEER)                                                  // OUTGOING call-zzz
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-aaa", PEER))   // 对端来电 call-aaa（较小）
        // 让步：转为接受对端来电 call-aaa
        assertEquals(CallState.INCOMING, mgr.callState.value!!.state)
        assertEquals("call-aaa", mgr.callState.value!!.callId)
        assertEquals(CallDirection.INCOMING, mgr.callState.value!!.direction)
    }

    @Test
    fun `startCall ignored when already in a call`() {
        mgr.startCall(PEER)
        val first = mgr.callState.value!!.callId
        mgr.startCall("did:key:zOther")
        assertEquals(first, mgr.callState.value!!.callId)   // 未被覆盖
    }

    @Test
    fun `stale signal for other callId ignored`() = runTest {
        mgr.startCall(PEER)
        mgr.onSignal(CallSignal(CallSignalTypes.HANGUP, "some-other-call", PEER))
        assertEquals(CallState.OUTGOING, mgr.callState.value!!.state)   // 未受影响
    }

    @Test
    fun `no state initially`() {
        assertNull(mgr.callState.value)
    }

    // ---- P3：serviceLauncher seam 转发（start() 里的 callState collector）----

    private class RecordingLauncher : CallServiceLauncher {
        val states = java.util.concurrent.CopyOnWriteArrayList<CallState>()
        @Volatile var cleared = 0
        override fun onCall(session: CallSession) { states.add(session.state) }
        override fun clear() { cleared++ }
    }

    /** 轮询等待（seam collector 跑在 Dispatchers.Default 真线程上）。 */
    private fun awaitTrue(timeoutMs: Long = 2000, cond: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (cond()) return
            Thread.sleep(15)
        }
    }

    @Test
    fun `serviceLauncher receives onCall OUTGOING when starting a call`() {
        every { signaling.incoming } returns kotlinx.coroutines.flow.MutableSharedFlow()
        val rec = RecordingLauncher()
        mgr.serviceLauncher = rec
        mgr.start()
        mgr.startCall(PEER)
        awaitTrue { rec.states.contains(CallState.OUTGOING) }
        org.junit.Assert.assertTrue("launcher should see OUTGOING", rec.states.contains(CallState.OUTGOING))
    }

    @Test
    fun `serviceLauncher receives onCall INCOMING on remote invite`() = runTest {
        every { signaling.incoming } returns kotlinx.coroutines.flow.MutableSharedFlow()
        val rec = RecordingLauncher()
        mgr.serviceLauncher = rec
        mgr.start()
        mgr.onSignal(CallSignal(CallSignalTypes.INVITE, "call-peer", PEER))
        awaitTrue { rec.states.contains(CallState.INCOMING) }
        org.junit.Assert.assertTrue("launcher should see INCOMING", rec.states.contains(CallState.INCOMING))
    }

    @Test
    fun `serviceLauncher clear called when call fully ends`() {
        every { signaling.incoming } returns kotlinx.coroutines.flow.MutableSharedFlow()
        val rec = RecordingLauncher()
        mgr.serviceLauncher = rec
        // END_LINGER 后状态回 null → clear()。用短 linger 不可注入，故缩短等待窗到 > END_LINGER_MS。
        mgr.start()
        mgr.startCall(PEER)
        mgr.hangup() // → ENDED，2.5s 后 → null → clear()
        awaitTrue(timeoutMs = 5000) { rec.cleared >= 1 }
        org.junit.Assert.assertTrue("launcher.clear() should fire after END_LINGER", rec.cleared >= 1)
    }
}
