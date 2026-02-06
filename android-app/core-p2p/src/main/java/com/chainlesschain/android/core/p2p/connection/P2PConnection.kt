package com.chainlesschain.android.core.p2p.connection

import com.chainlesschain.android.core.p2p.model.P2PDevice
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.flow.Flow

/**
 * P2P连接接口
 *
 * 定义点对点连接的统一接口
 */
interface P2PConnection {

    /**
     * 连接到远程设备
     *
     * @param device 目标设备
     */
    suspend fun connect(device: P2PDevice)

    /**
     * 断开连接
     */
    suspend fun disconnect()

    /**
     * 发送消息
     *
     * @param message 消息内容
     */
    suspend fun sendMessage(message: P2PMessage)

    /**
     * 接收消息流
     */
    fun observeMessages(): Flow<P2PMessage>

    /**
     * 观察连接状态
     */
    fun observeConnectionState(): Flow<ConnectionState>

    /**
     * 获取当前连接状态
     */
    fun getConnectionState(): ConnectionState

    /**
     * 是否已连接
     */
    fun isConnected(): Boolean
}

/**
 * 连接状态
 */
sealed class ConnectionState {
    /** 空闲 */
    data object Idle : ConnectionState()

    /** 连接中 */
    data object Connecting : ConnectionState()

    /** 已连接 */
    data class Connected(val device: P2PDevice) : ConnectionState()

    /** 断开连接 */
    data class Disconnected(val reason: String?) : ConnectionState()

    /** 连接失败 */
    data class Failed(val error: String) : ConnectionState()
}

/**
 * WebRTC会话描述
 */
data class SessionDescription(
    val type: Type,
    val sdp: String
) {
    enum class Type {
        OFFER,
        ANSWER
    }
}

/**
 * ICE候选
 */
data class IceCandidate(
    val sdpMid: String,
    val sdpMLineIndex: Int,
    val sdp: String
)

/**
 * 信令消息（用于建立WebRTC连接）
 */
sealed class SignalingMessage {
    /** Offer消息 */
    data class Offer(
        val fromDeviceId: String,
        val sessionDescription: SessionDescription
    ) : SignalingMessage()

    /** Answer消息 */
    data class Answer(
        val fromDeviceId: String,
        val sessionDescription: SessionDescription
    ) : SignalingMessage()

    /** ICE候选消息 */
    data class Candidate(
        val fromDeviceId: String,
        val iceCandidate: IceCandidate
    ) : SignalingMessage()

    /** 心跳消息 */
    data class Heartbeat(
        val id: String,
        val timestamp: Long = System.currentTimeMillis()
    ) : SignalingMessage()

    /** 心跳响应消息 */
    data class HeartbeatAck(
        val id: String,
        val timestamp: Long = System.currentTimeMillis()
    ) : SignalingMessage()

    /** 连接关闭消息 */
    data class Close(
        val fromDeviceId: String,
        val reason: String
    ) : SignalingMessage()
}

/**
 * 连接健康度统计
 */
data class ConnectionHealthStats(
    val isConnected: Boolean,
    val uptimeMs: Long,
    val heartbeatsSent: Int,
    val heartbeatsReceived: Int,
    val healthPercentage: Int,
    val reconnectAttempts: Int
)
