package com.chainlesschain.android.feature.p2p.webrtc.signaling

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonClassDiscriminator
import kotlinx.serialization.json.JsonElement

/**
 * WebRTC signaling message types
 *
 * Defines the protocol for P2P connection establishment:
 * 1. Initiator sends OFFER with SDP
 * 2. Responder sends ANSWER with SDP
 * 3. Both sides exchange ICE_CANDIDATE as they're discovered
 * 4. Either side sends BYE to terminate
 *
 * **Why `@JsonClassDiscriminator("_kind")`**：每个子类有 `val type: String` 字段
 * (e.g. Offer 默认 "offer"), 与 kotlinx.serialization sealed 多态序列化的默认
 * class discriminator `"type"` 冲突，序列化时抛 IllegalStateException。改用 `_kind`
 * 作鉴别字段名规避冲突；子类的 `type` 字段保留兼容现有线协议。
 */
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("_kind")
sealed class SignalingMessage {
    abstract val from: String
    abstract val to: String
    abstract val timestamp: Long

    /**
     * Session Description Protocol offer
     * Sent by the initiator to propose connection parameters
     */
    @Serializable
    data class Offer(
        override val from: String,
        override val to: String,
        override val timestamp: Long = System.currentTimeMillis(),
        val sdp: String,
        val type: String = "offer"
    ) : SignalingMessage()

    /**
     * Session Description Protocol answer
     * Sent by the responder to accept connection
     */
    @Serializable
    data class Answer(
        override val from: String,
        override val to: String,
        override val timestamp: Long = System.currentTimeMillis(),
        val sdp: String,
        val type: String = "answer"
    ) : SignalingMessage()

    /**
     * ICE (Interactive Connectivity Establishment) candidate
     * Contains network address information for NAT traversal
     */
    @Serializable
    data class IceCandidate(
        override val from: String,
        override val to: String,
        override val timestamp: Long = System.currentTimeMillis(),
        val candidate: String,
        val sdpMid: String,
        val sdpMLineIndex: Int
    ) : SignalingMessage()

    /**
     * Termination signal
     * Gracefully closes the connection
     */
    @Serializable
    data class Bye(
        override val from: String,
        override val to: String,
        override val timestamp: Long = System.currentTimeMillis(),
        val reason: String? = null
    ) : SignalingMessage()

    /**
     * Heartbeat/ping message
     * Keeps connection alive and detects disconnections
     */
    @Serializable
    data class Ping(
        override val from: String,
        override val to: String,
        override val timestamp: Long = System.currentTimeMillis()
    ) : SignalingMessage()

    /**
     * Heartbeat response
     */
    @Serializable
    data class Pong(
        override val from: String,
        override val to: String,
        override val timestamp: Long = System.currentTimeMillis()
    ) : SignalingMessage()
}

/**
 * Wrapper for signaling messages sent over the wire
 */
@Serializable
data class SignalingEnvelope(
    val type: String,
    val payload: JsonElement
)
