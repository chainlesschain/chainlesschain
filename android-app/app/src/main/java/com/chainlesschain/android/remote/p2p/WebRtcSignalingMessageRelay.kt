package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.core.p2p.connection.RemoteMessageRelay
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.mapNotNull
import org.json.JSONObject
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [RemoteMessageRelay] 生产实现 —— 经生产信令服务器 `wss://signaling.chainlesschain.com`
 * 中继聊天消息（复用 [WebRTCClient.sendForwardedMessage] / [WebRTCClient.forwardedMessages]，
 * 即通话/RPC 同款、已验证跨网可达的链路）。
 *
 * 让聊天（绑在 core-p2p 的 LAN-only 栈）在无直连 P2P 时也能送达——健壮性兜底。
 *
 * 协议：把 [P2PMessage] 平铺进一个 `type="p2p-relay-msg"` 的 JSON payload，经
 * `sendForwardedMessage` 发出；对端 [WebRTCClient.forwardedMessages] 收到**解包后的内层
 * payload 字符串**（envelope 已被剥），解析回 [P2PMessage]。该 type 不与
 * offer/answer/ice-candidate/pairing 冲突（那些在 forwardedMessages 之前已被处理）。
 *
 * 端到端加密不变：[P2PMessage.payload] 已是密文，信令服务器只转发密文。
 */
@Singleton
class WebRtcSignalingMessageRelay @Inject constructor(
    private val webRTCClient: WebRTCClient,
) : RemoteMessageRelay {

    override suspend fun relay(peerId: String, message: P2PMessage): Boolean {
        val payload = JSONObject().apply {
            put("type", RELAY_TYPE)
            put("id", message.id)
            put("from", message.fromDeviceId)
            put("to", message.toDeviceId)
            put("msgType", message.type.name)
            put("payload", message.payload)
            put("timestamp", message.timestamp)
            put("requiresAck", message.requiresAck)
            put("isAcknowledged", message.isAcknowledged)
        }
        return runCatching { webRTCClient.sendForwardedMessage(peerId, payload).isSuccess }
            .onFailure { Timber.w(it, "[Relay] sendForwardedMessage failed → $peerId") }
            .getOrDefault(false)
    }

    override val incoming: Flow<P2PMessage> =
        webRTCClient.forwardedMessages.mapNotNull { raw -> parse(raw) }

    private fun parse(raw: String): P2PMessage? = try {
        val o = JSONObject(raw)
        if (o.optString("type") != RELAY_TYPE) {
            null
        } else {
            P2PMessage(
                id = o.getString("id"),
                fromDeviceId = o.getString("from"),
                toDeviceId = o.getString("to"),
                type = runCatching { MessageType.valueOf(o.getString("msgType")) }
                    .getOrDefault(MessageType.TEXT),
                payload = o.getString("payload"),
                timestamp = o.optLong("timestamp", System.currentTimeMillis()),
                requiresAck = o.optBoolean("requiresAck", true),
                isAcknowledged = o.optBoolean("isAcknowledged", false),
            )
        }
    } catch (e: Exception) {
        // 非本协议的 forwarded message（offer/answer 等已在上游处理，这里只会见到其它）→ 忽略
        null
    }

    companion object {
        private const val RELAY_TYPE = "p2p-relay-msg"
    }
}
