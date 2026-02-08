package com.chainlesschain.android.feature.p2p.bridge

import android.util.Log
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.sync.MessageQueue
import com.chainlesschain.android.feature.p2p.webrtc.channel.DataChannelManager
import com.chainlesschain.android.feature.p2p.webrtc.channel.IncomingMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.nio.charset.StandardCharsets
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * P2P 消息桥接器
 *
 * 将 DataChannelManager 收到的原始消息反序列化为 P2PMessage，
 * 并分发到 MessageQueue 的入站消息流，从而触发 RealtimeEventManager 等下游组件。
 */
@Singleton
class P2PMessageBridge @Inject constructor(
    private val dataChannelManager: DataChannelManager,
    private val messageQueue: MessageQueue
) {

    companion object {
        private const val TAG = "P2PMessageBridge"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val json = Json { ignoreUnknownKeys = true }
    private var isRunning = false

    /**
     * 启动桥接，监听 DataChannel 入站消息并转发到 MessageQueue
     */
    fun start() {
        if (isRunning) {
            Log.w(TAG, "Bridge already running")
            return
        }

        isRunning = true
        Log.i(TAG, "Starting P2P message bridge")

        scope.launch {
            dataChannelManager.incomingMessages.collect { incoming ->
                try {
                    val message = deserializeMessage(incoming)
                    if (message != null) {
                        messageQueue.dispatchIncoming(message)
                        Log.d(TAG, "Bridged message: ${message.id} (type: ${message.type})")
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to bridge incoming message from ${incoming.peerId}", e)
                }
            }
        }
    }

    /**
     * 停止桥接
     */
    fun stop() {
        isRunning = false
        Log.i(TAG, "P2P message bridge stopped")
    }

    /**
     * 将 DataChannel 的 IncomingMessage 反序列化为 P2PMessage
     */
    private fun deserializeMessage(incoming: IncomingMessage): P2PMessage? {
        return try {
            if (incoming.binary) {
                // 二进制消息：尝试作为 JSON 解析
                val jsonStr = String(incoming.data, StandardCharsets.UTF_8)
                json.decodeFromString(P2PMessage.serializer(), jsonStr)
            } else {
                // 文本消息：直接作为 JSON 解析
                val jsonStr = String(incoming.data, StandardCharsets.UTF_8)
                try {
                    json.decodeFromString(P2PMessage.serializer(), jsonStr)
                } catch (e: Exception) {
                    // 如果不是 P2PMessage 格式，包装为 TEXT 类型消息
                    P2PMessage(
                        id = UUID.randomUUID().toString(),
                        fromDeviceId = incoming.peerId,
                        toDeviceId = "",
                        type = MessageType.TEXT,
                        payload = jsonStr,
                        timestamp = incoming.timestamp
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to deserialize message from ${incoming.peerId}", e)
            null
        }
    }
}
