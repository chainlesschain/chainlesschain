package com.chainlesschain.android.feature.p2p.call

import com.chainlesschain.android.core.p2p.P2PManager
import com.chainlesschain.android.core.p2p.message.P2PMessage
import com.chainlesschain.android.core.p2p.message.P2PMessageType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.webrtc.IceCandidate
import org.webrtc.SessionDescription
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * WebRTC信令管理器
 *
 * 通过P2P网络传输WebRTC信令消息：
 * - Offer/Answer
 * - ICE候选
 * - 通话控制（挂断、拒绝等）
 *
 * 信令消息格式：
 * {
 *   "type": "offer" | "answer" | "ice_candidate" | "hangup",
 *   "data": {...}
 * }
 *
 * @since v0.32.0
 */
@Singleton
class SignalingManager @Inject constructor(
    private val p2pManager: P2PManager,
    private val json: Json
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // 收到的信令消息
    private val _signalingMessage = MutableSharedFlow<SignalingMessage>()
    val signalingMessage: SharedFlow<SignalingMessage> = _signalingMessage.asSharedFlow()

    init {
        // 监听P2P消息
        scope.launch {
            p2pManager.messageFlow.collect { message ->
                if (message.type == P2PMessageType.WEBRTC_SIGNALING) {
                    handleIncomingSignaling(message)
                }
            }
        }
    }

    /**
     * 发送Offer
     */
    suspend fun sendOffer(targetDid: String, sdp: SessionDescription) {
        Timber.d("Sending offer to $targetDid")

        val signalingData = SignalingData.Offer(
            sdp = sdp.description,
            type = sdp.type.canonicalForm()
        )

        val signalingMessage = SignalingMessage(
            type = SignalingType.OFFER,
            data = json.encodeToString(SignalingData.Offer.serializer(), signalingData)
        )

        sendSignalingMessage(targetDid, signalingMessage)
    }

    /**
     * 发送Answer
     */
    suspend fun sendAnswer(targetDid: String, sdp: SessionDescription) {
        Timber.d("Sending answer to $targetDid")

        val signalingData = SignalingData.Answer(
            sdp = sdp.description,
            type = sdp.type.canonicalForm()
        )

        val signalingMessage = SignalingMessage(
            type = SignalingType.ANSWER,
            data = json.encodeToString(SignalingData.Answer.serializer(), signalingData)
        )

        sendSignalingMessage(targetDid, signalingMessage)
    }

    /**
     * 发送ICE候选
     */
    suspend fun sendIceCandidate(targetDid: String, candidate: IceCandidate) {
        Timber.d("Sending ICE candidate to $targetDid")

        val signalingData = SignalingData.IceCandidate(
            sdpMid = candidate.sdpMid,
            sdpMLineIndex = candidate.sdpMLineIndex,
            sdp = candidate.sdp
        )

        val signalingMessage = SignalingMessage(
            type = SignalingType.ICE_CANDIDATE,
            data = json.encodeToString(SignalingData.IceCandidate.serializer(), signalingData)
        )

        sendSignalingMessage(targetDid, signalingMessage)
    }

    /**
     * 发送挂断信号
     */
    suspend fun sendHangup(targetDid: String) {
        Timber.d("Sending hangup to $targetDid")

        val signalingMessage = SignalingMessage(
            type = SignalingType.HANGUP,
            data = ""
        )

        sendSignalingMessage(targetDid, signalingMessage)
    }

    /**
     * 发送拒绝信号
     */
    suspend fun sendReject(targetDid: String, reason: String = "Rejected") {
        Timber.d("Sending reject to $targetDid: $reason")

        val signalingData = SignalingData.Reject(reason = reason)

        val signalingMessage = SignalingMessage(
            type = SignalingType.REJECT,
            data = json.encodeToString(SignalingData.Reject.serializer(), signalingData)
        )

        sendSignalingMessage(targetDid, signalingMessage)
    }

    /**
     * 发送信令消息（通过P2P网络）
     */
    private suspend fun sendSignalingMessage(targetDid: String, message: SignalingMessage) {
        val p2pMessage = P2PMessage(
            id = generateMessageId(),
            type = P2PMessageType.WEBRTC_SIGNALING,
            from = p2pManager.getLocalDid(),
            to = targetDid,
            content = json.encodeToString(SignalingMessage.serializer(), message),
            timestamp = System.currentTimeMillis()
        )

        p2pManager.sendMessage(p2pMessage)
    }

    /**
     * 处理收到的信令消息
     */
    private suspend fun handleIncomingSignaling(message: P2PMessage) {
        try {
            val signalingMessage = json.decodeFromString<SignalingMessage>(message.content)
            Timber.d("Received signaling message: ${signalingMessage.type} from ${message.from}")

            _signalingMessage.emit(
                signalingMessage.copy(
                    fromDid = message.from
                )
            )

        } catch (e: Exception) {
            Timber.e(e, "Failed to parse signaling message")
        }
    }

    /**
     * 生成消息ID
     */
    private fun generateMessageId(): String {
        return "webrtc_${System.currentTimeMillis()}_${(Math.random() * 10000).toInt()}"
    }
}

/**
 * 信令消息
 */
@Serializable
data class SignalingMessage(
    val type: SignalingType,
    val data: String,
    val fromDid: String = ""
)

/**
 * 信令类型
 */
@Serializable
enum class SignalingType {
    OFFER,          // Offer SDP
    ANSWER,         // Answer SDP
    ICE_CANDIDATE,  // ICE候选
    HANGUP,         // 挂断
    REJECT          // 拒绝
}

/**
 * 信令数据
 */
sealed class SignalingData {
    /**
     * Offer数据
     */
    @Serializable
    data class Offer(
        val sdp: String,
        val type: String
    ) : SignalingData()

    /**
     * Answer数据
     */
    @Serializable
    data class Answer(
        val sdp: String,
        val type: String
    ) : SignalingData()

    /**
     * ICE候选数据
     */
    @Serializable
    data class IceCandidate(
        val sdpMid: String,
        val sdpMLineIndex: Int,
        val sdp: String
    ) : SignalingData()

    /**
     * 拒绝数据
     */
    @Serializable
    data class Reject(
        val reason: String
    ) : SignalingData()
}
