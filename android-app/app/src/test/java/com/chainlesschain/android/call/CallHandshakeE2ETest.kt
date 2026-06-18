package com.chainlesschain.android.call

import com.chainlesschain.android.core.did.manager.DIDManager
import io.mockk.coEvery
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * FAMILY-67 通话握手端到端测试（JVM，无设备）。
 *
 * 两个真实 [CallManager]（主叫 A / 被叫 B）经一个 fake 信令总线互联：A.signaling.send → B.onSignal，
 * 反之亦然。媒体用自动接通的 fake（startAsOfferer/Answerer 立刻回 onMediaConnected）。验完整协议链路：
 * INVITE → RINGING → ACCEPT → media → ACTIVE（双方）→ HANGUP → ENDED（双方）。
 *
 * 设备级 e2e（真 WebRTC 音视频 + TURN + 锁屏来电）需两台真机，见设计文档 §10.5；本测试覆盖协议状态机闭环。
 */
class CallHandshakeE2ETest {

    private val A_DID = "did:key:zAaa" // 较小 → A 为 offerer（electOfferer = myDid < peerDid）
    private val B_DID = "did:key:zBbb"

    /** startAsOfferer/Answerer 立即回 onMediaConnected，模拟 ICE 秒连。 */
    private class AutoConnectMedia : CallMediaController {
        var listener: CallMediaListener? = null
        override suspend fun startAsOfferer(callId: String, peerDid: String, media: CallMediaType) {
            listener?.onMediaConnected(callId)
        }
        override suspend fun startAsAnswerer(callId: String, peerDid: String, media: CallMediaType) {
            listener?.onMediaConnected(callId)
        }
        override suspend fun onRemoteOffer(callId: String, sdp: String) {}
        override suspend fun onRemoteAnswer(callId: String, sdp: String) {}
        override suspend fun onRemoteIce(callId: String, candidate: String) {}
        override fun setMuted(muted: Boolean) {}
        override fun setSpeakerphone(on: Boolean) {}
        override fun close() {}
    }

    private fun awaitTrue(timeoutMs: Long = 3000, cond: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (cond()) return
            Thread.sleep(15)
        }
    }

    @Test
    fun `full audio call handshake reaches ACTIVE on both peers then ENDED on hangup`() {
        lateinit var a: CallManager
        lateinit var b: CallManager

        fun signalingFor(selfDid: String, peer: () -> CallManager): CallSignalingClient {
            val s = mockk<CallSignalingClient>(relaxed = true)
            coEvery { s.send(any(), any(), any(), any(), any(), any(), any()) } coAnswers {
                val type = arg<String>(1)
                val callId = arg<String>(2)
                val media = arg<CallMediaType>(3)
                val sdp = arg<String?>(4)
                val candidate = arg<String?>(5)
                val reason = arg<String?>(6)
                // 投递到对端：from = 本机 DID
                peer().onSignal(CallSignal(type, callId, selfDid, media, sdp, candidate, reason))
                true
            }
            return s
        }

        val didA = mockk<DIDManager>(relaxed = true).also { coEvery { it.getCurrentDID() } returns A_DID }
        val didB = mockk<DIDManager>(relaxed = true).also { coEvery { it.getCurrentDID() } returns B_DID }

        val mediaA = AutoConnectMedia()
        val mediaB = AutoConnectMedia()

        a = CallManager(signalingFor(A_DID) { b }, didA).apply {
            genCallId = { "call-A" }
            media = mediaA
        }
        b = CallManager(signalingFor(B_DID) { a }, didB).apply {
            genCallId = { "call-B" }
            media = mediaB
        }
        mediaA.listener = a
        mediaB.listener = b

        // A 拨号 B（语音）
        a.startCall(B_DID, CallMediaType.AUDIO)
        awaitTrue { b.callState.value?.state == CallState.INCOMING }
        assertEquals(CallState.INCOMING, b.callState.value?.state)
        assertEquals(A_DID, b.callState.value?.peerDid)

        // A 收到 RINGING
        awaitTrue { a.callState.value?.state == CallState.OUTGOING_RINGING }
        assertEquals(CallState.OUTGOING_RINGING, a.callState.value?.state)

        // B 接听 → 双方走媒体 → ACTIVE
        b.accept()
        awaitTrue { a.callState.value?.state == CallState.ACTIVE && b.callState.value?.state == CallState.ACTIVE }
        assertEquals(CallState.ACTIVE, a.callState.value?.state)
        assertEquals(CallState.ACTIVE, b.callState.value?.state)

        // A 挂断 → 双方 ENDED
        a.hangup()
        awaitTrue { b.callState.value?.state == CallState.ENDED }
        assertEquals(CallState.ENDED, a.callState.value?.state)
        assertEquals(CallState.ENDED, b.callState.value?.state)
        assertEquals(CallEndReason.LOCAL_HANGUP, a.callState.value?.endReason)
        assertEquals(CallEndReason.REMOTE_HANGUP, b.callState.value?.endReason)
    }

    @Test
    fun `callee rejects - caller ends with REJECTED`() {
        lateinit var a: CallManager
        lateinit var b: CallManager
        fun signalingFor(selfDid: String, peer: () -> CallManager): CallSignalingClient {
            val s = mockk<CallSignalingClient>(relaxed = true)
            coEvery { s.send(any(), any(), any(), any(), any(), any(), any()) } coAnswers {
                peer().onSignal(CallSignal(arg(1), arg(2), selfDid, arg(3), arg(4), arg(5), arg(6)))
                true
            }
            return s
        }
        val didA = mockk<DIDManager>(relaxed = true).also { coEvery { it.getCurrentDID() } returns A_DID }
        val didB = mockk<DIDManager>(relaxed = true).also { coEvery { it.getCurrentDID() } returns B_DID }
        a = CallManager(signalingFor(A_DID) { b }, didA).apply { genCallId = { "call-A" } }
        b = CallManager(signalingFor(B_DID) { a }, didB).apply { genCallId = { "call-B" } }

        a.startCall(B_DID)
        awaitTrue { b.callState.value?.state == CallState.INCOMING }
        b.reject()
        awaitTrue { a.callState.value?.state == CallState.ENDED }
        assertEquals(CallState.ENDED, a.callState.value?.state)
        assertEquals(CallEndReason.REJECTED, a.callState.value?.endReason)
    }
}
