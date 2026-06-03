package com.chainlesschain.android.remote.webrtc

import com.chainlesschain.android.feature.familyguard.domain.permission.FamilyAction

/** 媒体轨方向（addTrack 配置）。 */
enum class TrackDir { NONE, SENDONLY, RECVONLY, SENDRECV }

/** 一次通话的音/视频轨配置。 */
data class TrackConfig(val audio: TrackDir, val video: TrackDir)

/** 通话期间挂的横幅（隐私/合规可见性）。 */
enum class CallBanner {
    /** 普通通话，常规呼叫 UI 即可。 */
    NONE,

    /** 持久状态横幅（如监管中）。 */
    PERSISTENT,

    /** 高可见红色横幅（旁观 / 强接通 / SOS — 即使勿扰也要可见，主文档 §3 + spike 3 §3.2）。 */
    RED_ALERT,
}

/**
 * 5 类通话（FAMILY-32，主文档 §3 Live Comm）。每类绑定：
 *   - [tracks] 音/视频轨方向（addTrack 配置）；
 *   - [requiredAction] addTrack 前要过的 [FamilyPermissionChecker] 动作；null = 不设权限闸
 *     （SOS_BROADCAST 是孩子安全功能，永远允许）；
 *   - [banner] 通话期间的可见性横幅。
 *
 * 角色协商见 [CallNegotiator]；权限闸见 [CallKindGate]。
 */
enum class CallKind(
    val tracks: TrackConfig,
    val requiredAction: FamilyAction?,
    val banner: CallBanner,
) {
    /** 普通语音。 */
    AUDIO(
        TrackConfig(audio = TrackDir.SENDRECV, video = TrackDir.NONE),
        FamilyAction.StartAudioCall,
        CallBanner.NONE,
    ),

    /** 普通视频。 */
    VIDEO(
        TrackConfig(audio = TrackDir.SENDRECV, video = TrackDir.SENDRECV),
        FamilyAction.StartVideoCall,
        CallBanner.NONE,
    ),

    /** 静音旁观：家长单向接收孩子音视频；孩子端必挂红色横幅（合规知情，spike 3 §3.2）。 */
    SILENT_OBSERVE(
        TrackConfig(audio = TrackDir.RECVONLY, video = TrackDir.RECVONLY),
        FamilyAction.StartSilentObserve,
        CallBanner.RED_ALERT,
    ),

    /** 强接通：自动接听的紧急语音；红色横幅。 */
    URGENT(
        TrackConfig(audio = TrackDir.SENDRECV, video = TrackDir.NONE),
        FamilyAction.StartForcePickup,
        CallBanner.RED_ALERT,
    ),

    /** SOS 广播：孩子单向外发音视频求助。无权限闸（安全功能恒允许）；红色横幅。 */
    SOS_BROADCAST(
        TrackConfig(audio = TrackDir.SENDONLY, video = TrackDir.SENDONLY),
        null,
        CallBanner.RED_ALERT,
    ),
}
