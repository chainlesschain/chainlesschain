package com.chainlesschain.android.call

import com.chainlesschain.android.core.database.entity.call.CallStatus
import com.chainlesschain.android.core.database.entity.call.CallType
import com.chainlesschain.android.core.database.entity.call.MediaType
import org.junit.Assert.assertEquals
import org.junit.Test

/** FAMILY-67 [CallHistoryRecorder.toEntity] 纯映射单测（CallSession 终态 → CallHistoryEntity）。 */
class CallHistoryRecorderTest {

    private fun ended(
        direction: CallDirection,
        media: CallMediaType = CallMediaType.AUDIO,
        connectedAtMs: Long = 0L,
        endedAtMs: Long = 5_000L,
        reason: CallEndReason? = CallEndReason.LOCAL_HANGUP,
    ) = CallSession(
        callId = "c1", peerDid = "did:key:zPeer", direction = direction, media = media,
        state = CallState.ENDED, startedAtMs = 1_000L,
        connectedAtMs = connectedAtMs, endedAtMs = endedAtMs, endReason = reason,
    )

    @Test
    fun `outgoing answered is OUTGOING + COMPLETED with duration`() {
        val e = CallHistoryRecorder.toEntity(
            ended(CallDirection.OUTGOING, connectedAtMs = 2_000L, endedAtMs = 12_000L),
        )
        assertEquals(CallType.OUTGOING, e.callType)
        assertEquals(CallStatus.COMPLETED, e.status)
        assertEquals(10L, e.duration) // (12000-2000)/1000
        assertEquals(MediaType.AUDIO, e.mediaType)
        assertEquals("c1", e.id)
    }

    @Test
    fun `incoming answered is INCOMING + COMPLETED`() {
        val e = CallHistoryRecorder.toEntity(
            ended(CallDirection.INCOMING, connectedAtMs = 3_000L, endedAtMs = 9_000L),
        )
        assertEquals(CallType.INCOMING, e.callType)
        assertEquals(CallStatus.COMPLETED, e.status)
        assertEquals(6L, e.duration)
    }

    @Test
    fun `incoming never answered is MISSED + CANCELLED with zero duration`() {
        val e = CallHistoryRecorder.toEntity(
            ended(CallDirection.INCOMING, connectedAtMs = 0L, reason = CallEndReason.TIMEOUT_NO_ANSWER),
        )
        assertEquals(CallType.MISSED, e.callType)
        assertEquals(CallStatus.CANCELLED, e.status)
        assertEquals(0L, e.duration)
    }

    @Test
    fun `outgoing rejected before answer is OUTGOING + CANCELLED`() {
        val e = CallHistoryRecorder.toEntity(
            ended(CallDirection.OUTGOING, connectedAtMs = 0L, reason = CallEndReason.REJECTED),
        )
        assertEquals(CallType.OUTGOING, e.callType)
        assertEquals(CallStatus.CANCELLED, e.status)
    }

    @Test
    fun `media failed is FAILED`() {
        val e = CallHistoryRecorder.toEntity(
            ended(CallDirection.OUTGOING, connectedAtMs = 0L, reason = CallEndReason.MEDIA_FAILED),
        )
        assertEquals(CallStatus.FAILED, e.status)
        assertEquals("MEDIA_FAILED", e.failureReason)
    }

    @Test
    fun `video media type preserved`() {
        val e = CallHistoryRecorder.toEntity(
            ended(CallDirection.OUTGOING, media = CallMediaType.VIDEO, connectedAtMs = 2_000L, endedAtMs = 5_000L),
        )
        assertEquals(MediaType.VIDEO, e.mediaType)
    }
}
