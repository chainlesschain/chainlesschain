package com.chainlesschain.android.call

/**
 * FAMILY-67 通话媒体控制器 seam。
 *
 * 把 WebRTC 媒体（PeerConnection + 音视频轨 + DTLS-SRTP）与 [CallManager] 的信令状态机解耦：
 * - P0（纯信令）：媒体控制器为 null/no-op，状态机在 CONNECTING 即视为「信令打通」。
 * - P1（音频）/P2（视频）：[WebRtcCallMediaController] 实现本接口，接听后建独立媒体 PeerConnection、
 *   走 call:offer/answer/ice 协商，ICE 连通后回调 [CallMediaListener.onMediaConnected] 转 ACTIVE。
 */
interface CallMediaController {
    /** 接听方（answerer）准备媒体（采集本地音轨、建 PeerConnection，等对端 offer）。 */
    suspend fun startAsAnswerer(callId: String, peerDid: String, media: CallMediaType)

    /** 发起方（offerer）准备媒体并产出 offer（经回调 [CallMediaListener.onLocalSdp] 发出）。 */
    suspend fun startAsOfferer(callId: String, peerDid: String, media: CallMediaType)

    suspend fun onRemoteOffer(callId: String, sdp: String)
    suspend fun onRemoteAnswer(callId: String, sdp: String)
    suspend fun onRemoteIce(callId: String, candidate: String)

    /** 静音 / 扬声器（P1）。 */
    fun setMuted(muted: Boolean) {}
    fun setSpeakerphone(on: Boolean) {}

    /** 释放媒体资源（PeerConnection close + 采集停止 + 音频路由恢复）。 */
    fun close()

    companion object {
        /** P0 占位：不做媒体，仅让状态机走到 CONNECTING。 */
        val NOOP = object : CallMediaController {
            override suspend fun startAsAnswerer(callId: String, peerDid: String, media: CallMediaType) {}
            override suspend fun startAsOfferer(callId: String, peerDid: String, media: CallMediaType) {}
            override suspend fun onRemoteOffer(callId: String, sdp: String) {}
            override suspend fun onRemoteAnswer(callId: String, sdp: String) {}
            override suspend fun onRemoteIce(callId: String, candidate: String) {}
            override fun close() {}
        }
    }
}

/**
 * 媒体控制器回调 [CallManager]（媒体层 → 信令层）。
 */
interface CallMediaListener {
    /** 媒体层产出本地 SDP（offer/answer），需经 call:offer/call:answer 发给对端。 */
    fun onLocalSdp(callId: String, type: String, sdp: String)

    /** 媒体层产出本地 ICE 候选，需经 call:ice 发给对端。 */
    fun onLocalIce(callId: String, candidate: String)

    /** 媒体 ICE 连通 + 远端轨就绪 → 转 ACTIVE。 */
    fun onMediaConnected(callId: String)

    /** 媒体连接失败（ICE 始终不通）。 */
    fun onMediaFailed(callId: String)
}
