package com.chainlesschain.android.call

/**
 * FAMILY-67 好友 P2P 音视频通话 —— 通话域模型。
 *
 * 设计见 docs/design/FAMILY-67_Friend_P2P_AudioVideo_Call_Design.md。
 * P1 仅音频（[CallMediaType.AUDIO]），P2 加视频。
 */

/** 媒体类型。 */
enum class CallMediaType { AUDIO, VIDEO }

/** 通话方向（本端视角）。 */
enum class CallDirection { OUTGOING, INCOMING }

/** 通话状态机状态（设计文档 §10.2）。 */
enum class CallState {
    /** 空闲，无通话。 */
    IDLE,

    /** 主叫：已发 call:invite，等待对端 ringing/accept。 */
    OUTGOING,

    /** 主叫：对端已响铃（收到 call:ringing）。 */
    OUTGOING_RINGING,

    /** 被叫：收到 call:invite，本端响铃中。 */
    INCOMING,

    /** 已接听，媒体协商中（offer/answer/ICE）。 */
    CONNECTING,

    /** 媒体连通，通话进行中。 */
    ACTIVE,

    /** 通话结束。 */
    ENDED,
    ;

    val isTerminal: Boolean get() = this == ENDED
    val isRinging: Boolean get() = this == OUTGOING_RINGING || this == INCOMING
    val inProgress: Boolean get() = this != IDLE && this != ENDED
}

/** 通话结束原因。 */
enum class CallEndReason {
    /** 本端挂断。 */
    LOCAL_HANGUP,

    /** 对端挂断。 */
    REMOTE_HANGUP,

    /** 被对端拒接。 */
    REJECTED,

    /** 对端忙（已在另一通话中）。 */
    BUSY,

    /** 无人接听超时。 */
    TIMEOUT_NO_ANSWER,

    /** 媒体协商/连通超时。 */
    TIMEOUT_MEDIA,

    /** 媒体连接失败（ICE 始终不通）。 */
    MEDIA_FAILED,

    /** Glare 让步（双方同时呼叫，本端 callId 较大主动让步）。 */
    GLARE_LOST,

    /** 其它错误。 */
    ERROR,
}

/**
 * 一次通话会话（不可变快照，[CallManager] 持有并经 StateFlow 推给 UI）。
 *
 * @param callId 唯一通话 ID（发起方生成，全程不变，用于信令去重 + glare 裁决）
 * @param peerDid 对端 DID（did:key）
 */
data class CallSession(
    val callId: String,
    val peerDid: String,
    val direction: CallDirection,
    val media: CallMediaType,
    val state: CallState,
    /** 发起/收到时刻（ms）。 */
    val startedAtMs: Long = 0L,
    /** 接通（进入 ACTIVE）时刻；0 = 未接通。 */
    val connectedAtMs: Long = 0L,
    /** 结束时刻；0 = 未结束。 */
    val endedAtMs: Long = 0L,
    val endReason: CallEndReason? = null,
    val muted: Boolean = false,
    val speakerOn: Boolean = false,
) {
    /** 通话时长（ms）：仅在已接通后有意义。 */
    fun durationMs(nowMs: Long): Long {
        if (connectedAtMs <= 0L) return 0L
        val end = if (endedAtMs > 0L) endedAtMs else nowMs
        return (end - connectedAtMs).coerceAtLeast(0L)
    }
}
