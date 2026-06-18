package com.chainlesschain.android.call

import org.json.JSONObject

/**
 * FAMILY-67 通话信令（call:* 类型，经信令服务器 type:"message" 中继转发）。
 *
 * 复用消息链路的 `WebRTCClient.sendForwardedMessage` / `forwardedMessages`（同信令通道，按
 * type 前缀分流）。设计见 §4 / §10.3。纯逻辑，单元可测。
 */
object CallSignalTypes {
    const val INVITE = "call:invite"   // 主叫→被叫：发起呼叫
    const val RINGING = "call:ringing" // 被叫→主叫：已收到、响铃中
    const val ACCEPT = "call:accept"   // 被叫→主叫：接听
    const val REJECT = "call:reject"   // 被叫→主叫：拒接/忙
    const val OFFER = "call:offer"     // 媒体 SDP offer
    const val ANSWER = "call:answer"   // 媒体 SDP answer
    const val ICE = "call:ice"         // ICE 候选
    const val HANGUP = "call:hangup"   // 任一方挂断

    val ALL = setOf(INVITE, RINGING, ACCEPT, REJECT, OFFER, ANSWER, ICE, HANGUP)

    fun isCallSignal(type: String): Boolean = type in ALL
}

/**
 * 解析后的通话信令帧。`from` 为发送方 DID（载荷自带，用于响应路由 + glare 裁决）。
 */
data class CallSignal(
    val type: String,
    val callId: String,
    val fromDid: String,
    val media: CallMediaType = CallMediaType.AUDIO,
    val sdp: String? = null,
    val candidate: String? = null,
    val reason: String? = null,
) {
    fun toPayload(): JSONObject = JSONObject().apply {
        put("type", type)
        put("callId", callId)
        put("from", fromDid)
        put("media", media.name)
        sdp?.let { put("sdp", it) }
        candidate?.let { put("candidate", it) }
        reason?.let { put("reason", it) }
    }

    companion object {
        /** 从信令转发流的 payload 解析；非 call:* 或缺 callId 返回 null。 */
        fun fromPayload(obj: JSONObject): CallSignal? {
            val type = obj.optString("type")
            if (!CallSignalTypes.isCallSignal(type)) return null
            val callId = obj.optString("callId")
            if (callId.isEmpty()) return null
            return CallSignal(
                type = type,
                callId = callId,
                fromDid = obj.optString("from"),
                media = runCatching { CallMediaType.valueOf(obj.optString("media", "AUDIO")) }
                    .getOrDefault(CallMediaType.AUDIO),
                sdp = obj.optString("sdp").ifEmpty { null },
                candidate = obj.optString("candidate").ifEmpty { null },
                reason = obj.optString("reason").ifEmpty { null },
            )
        }

        fun fromRaw(raw: String): CallSignal? =
            runCatching { fromPayload(JSONObject(raw)) }.getOrNull()
    }
}

/**
 * Glare 裁决：双方几乎同时呼叫对方时各持一个 callId。约定保留 **callId 字典序较小**者，
 * 另一方自动让步（reject 自己的呼叫，接受对端的）。纯函数、确定性，两端对同一对 callId 得相反结论。
 *
 * @return 本端是否「胜出」（保留自己发起的呼叫）。true=保留己方 invite；false=让步（GLARE_LOST）。
 */
fun resolveGlareKeepMine(myCallId: String, peerCallId: String): Boolean = myCallId < peerCallId
