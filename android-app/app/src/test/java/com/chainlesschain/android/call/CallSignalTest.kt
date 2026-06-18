package com.chainlesschain.android.call

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * FAMILY-67 音视频通话 P0 基础（信令序列化 + glare + 状态机模型）单元测试。
 */
class CallSignalTest {

    @Test
    fun `signal payload round-trips`() {
        val s = CallSignal(
            type = CallSignalTypes.OFFER,
            callId = "call-123",
            fromDid = "did:key:zAlice",
            media = CallMediaType.AUDIO,
            sdp = "v=0\r\no=- ...",
        )
        val parsed = CallSignal.fromPayload(s.toPayload())!!
        assertEquals(s.type, parsed.type)
        assertEquals(s.callId, parsed.callId)
        assertEquals(s.fromDid, parsed.fromDid)
        assertEquals(s.media, parsed.media)
        assertEquals(s.sdp, parsed.sdp)
        assertNull(parsed.candidate)
    }

    @Test
    fun `fromPayload rejects non-call type`() {
        val obj = JSONObject().put("type", "sync.push").put("callId", "x")
        assertNull(CallSignal.fromPayload(obj))
    }

    @Test
    fun `fromPayload rejects missing callId`() {
        val obj = JSONObject().put("type", CallSignalTypes.INVITE)
        assertNull(CallSignal.fromPayload(obj))
    }

    @Test
    fun `isCallSignal recognizes all call types and rejects others`() {
        assertTrue(CallSignalTypes.isCallSignal(CallSignalTypes.INVITE))
        assertTrue(CallSignalTypes.isCallSignal(CallSignalTypes.HANGUP))
        assertFalse(CallSignalTypes.isCallSignal("sync.push"))
        assertFalse(CallSignalTypes.isCallSignal("offer"))
    }

    @Test
    fun `glare keeps smaller callId deterministically`() {
        // 两端对同一对 callId 必得相反结论
        assertTrue(resolveGlareKeepMine("call-aaa", "call-bbb"))
        assertFalse(resolveGlareKeepMine("call-bbb", "call-aaa"))
    }

    @Test
    fun `call state helpers`() {
        assertTrue(CallState.ENDED.isTerminal)
        assertFalse(CallState.ACTIVE.isTerminal)
        assertTrue(CallState.INCOMING.isRinging)
        assertTrue(CallState.OUTGOING_RINGING.isRinging)
        assertFalse(CallState.ACTIVE.isRinging)
        assertTrue(CallState.CONNECTING.inProgress)
        assertFalse(CallState.IDLE.inProgress)
        assertFalse(CallState.ENDED.inProgress)
    }

    @Test
    fun `session duration only after connected`() {
        val notConnected = CallSession("c1", "did:key:zB", CallDirection.OUTGOING, CallMediaType.AUDIO, CallState.CONNECTING, startedAtMs = 1000)
        assertEquals(0L, notConnected.durationMs(5000))

        val active = notConnected.copy(state = CallState.ACTIVE, connectedAtMs = 2000)
        assertEquals(3000L, active.durationMs(5000))

        val ended = active.copy(state = CallState.ENDED, endedAtMs = 4000)
        assertEquals(2000L, ended.durationMs(9999)) // 用 endedAtMs，不用 now
    }
}
