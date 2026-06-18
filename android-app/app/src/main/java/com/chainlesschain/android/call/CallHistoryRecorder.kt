package com.chainlesschain.android.call

import com.chainlesschain.android.core.database.entity.call.CallHistoryEntity
import com.chainlesschain.android.core.database.entity.call.CallStatus
import com.chainlesschain.android.core.database.entity.call.CallType
import com.chainlesschain.android.core.database.entity.call.MediaType

/**
 * FAMILY-67 通话历史记录 seam（P3+）。[CallManager] 在通话结束时调用，把会话落库到 `call_history`。
 * 默认 [NOOP]（保单测纯净）；真实现 [RoomCallHistoryRecorder] 由 `MainActivity` 注入。
 */
interface CallHistoryRecorder {
    /** 记录一通已结束的通话（应在终态调用）。 */
    fun record(session: CallSession)

    companion object {
        val NOOP = object : CallHistoryRecorder {
            override fun record(session: CallSession) {}
        }

        /**
         * 纯映射 [CallSession]（终态）→ [CallHistoryEntity]，便于单测：
         * - 来电且从未接通 → MISSED；否则按方向 INCOMING/OUTGOING
         * - 接通过 → COMPLETED；媒体失败 → FAILED；其余（拒接/忙/无应答/未接通即挂断）→ CANCELLED
         * - 时长 = 接通到结束（秒），未接通为 0
         */
        fun toEntity(s: CallSession): CallHistoryEntity {
            val active = s.connectedAtMs > 0L
            val callType = when {
                s.direction == CallDirection.INCOMING && !active -> CallType.MISSED
                s.direction == CallDirection.INCOMING -> CallType.INCOMING
                else -> CallType.OUTGOING
            }
            val media = if (s.media == CallMediaType.VIDEO) MediaType.VIDEO else MediaType.AUDIO
            val durationSec =
                if (active && s.endedAtMs > 0L) ((s.endedAtMs - s.connectedAtMs) / 1000L).coerceAtLeast(0L) else 0L
            val status = when {
                active -> CallStatus.COMPLETED
                s.endReason == CallEndReason.MEDIA_FAILED -> CallStatus.FAILED
                else -> CallStatus.CANCELLED
            }
            return CallHistoryEntity(
                id = s.callId,
                peerDid = s.peerDid,
                peerName = shortPeer(s.peerDid),
                callType = callType,
                mediaType = media,
                startTime = s.startedAtMs,
                endTime = if (s.endedAtMs > 0L) s.endedAtMs else null,
                duration = durationSec,
                status = status,
                failureReason = s.endReason?.name,
                createdAt = if (s.endedAtMs > 0L) s.endedAtMs else s.startedAtMs,
            )
        }

        private fun shortPeer(did: String): String =
            if (did.length <= 22) did else did.take(14) + "…" + did.takeLast(6)
    }
}
