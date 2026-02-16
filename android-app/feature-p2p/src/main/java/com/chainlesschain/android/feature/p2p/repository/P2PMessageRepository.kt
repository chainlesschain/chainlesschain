package com.chainlesschain.android.feature.p2p.repository

import timber.log.Timber
import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.entity.MessageSendStatus
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.core.e2ee.protocol.RatchetMessage
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * P2P消息仓库
 *
 * 负责：
 * - 消息持久化
 * - E2EE加密/解密
 * - 消息发送/接收
 * - 消息状态管理
 */
@Singleton
class P2PMessageRepository @Inject constructor(
    private val p2pMessageDao: P2PMessageDao,
    private val sessionManager: PersistentSessionManager,
    private val connectionManager: P2PConnectionManager
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val json = Json { ignoreUnknownKeys = true }
    private var observeJob: Job? = null

    // 接收到的消息流（用于通知UI）
    private val _incomingMessages = MutableSharedFlow<P2PMessageEntity>()
    val incomingMessages: SharedFlow<P2PMessageEntity> = _incomingMessages.asSharedFlow()

    init {
        // 监听P2P网络接收的消息
        observeNetworkMessages()
    }

    /**
     * 获取与指定设备的聊天消息
     */
    fun getMessages(peerId: String): Flow<List<P2PMessageEntity>> {
        return p2pMessageDao.getMessagesByPeer(peerId)
    }

    /**
     * 获取最近消息
     */
    suspend fun getRecentMessages(peerId: String, limit: Int = 50): List<P2PMessageEntity> {
        return p2pMessageDao.getRecentMessages(peerId, limit).reversed()
    }

    /**
     * 获取未读消息数量
     */
    fun getUnreadCount(peerId: String): Flow<Int> {
        return p2pMessageDao.getUnreadCount(peerId)
    }

    /**
     * 发送消息
     *
     * @param peerId 对等设备ID
     * @param localDeviceId 本地设备ID
     * @param content 消息内容
     * @return 发送的消息实体
     */
    suspend fun sendMessage(
        peerId: String,
        localDeviceId: String,
        content: String
    ): Result<P2PMessageEntity> {
        return try {
            Timber.d("Sending message to peer: $peerId")

            // 检查是否有会话
            if (!sessionManager.hasSession(peerId)) {
                return Result.failure(IllegalStateException("No E2EE session with peer: $peerId"))
            }

            // 加密消息
            val encryptedMessage = sessionManager.encrypt(peerId, content)
            val encryptedPayload = json.encodeToString(encryptedMessage)

            // 创建消息ID
            val messageId = UUID.randomUUID().toString()

            // 创建数据库实体
            val messageEntity = P2PMessageEntity(
                id = messageId,
                peerId = peerId,
                fromDeviceId = localDeviceId,
                toDeviceId = peerId,
                type = MessageType.TEXT.name,
                content = content,
                encryptedPayload = encryptedPayload,
                timestamp = System.currentTimeMillis(),
                isOutgoing = true,
                requiresAck = true,
                isAcknowledged = false,
                sendStatus = MessageSendStatus.PENDING
            )

            // 保存到数据库
            p2pMessageDao.insertMessage(messageEntity)

            // 创建网络消息
            val p2pMessage = P2PMessage(
                id = messageId,
                fromDeviceId = localDeviceId,
                toDeviceId = peerId,
                type = MessageType.TEXT,
                payload = encryptedPayload,
                timestamp = messageEntity.timestamp,
                requiresAck = true,
                isAcknowledged = false
            )

            // 发送到P2P网络
            connectionManager.sendMessage(peerId, p2pMessage)

            // 更新发送状态
            p2pMessageDao.updateSendStatus(messageId, MessageSendStatus.SENT)

            Timber.d("Message sent successfully: $messageId")
            Result.success(messageEntity.copy(sendStatus = MessageSendStatus.SENT))

        } catch (e: Exception) {
            Timber.e(e, "Failed to send message")
            Result.failure(e)
        }
    }

    /**
     * 接收并处理消息
     */
    suspend fun receiveMessage(p2pMessage: P2PMessage, localDeviceId: String): Result<P2PMessageEntity> {
        return try {
            Timber.d("Receiving message from: ${p2pMessage.fromDeviceId}")

            val peerId = p2pMessage.fromDeviceId

            // 检查是否有会话
            if (!sessionManager.hasSession(peerId)) {
                return Result.failure(IllegalStateException("No E2EE session with peer: $peerId"))
            }

            // 解密消息
            val encryptedMessage = json.decodeFromString<RatchetMessage>(p2pMessage.payload)
            val decryptedContent = sessionManager.decryptToString(peerId, encryptedMessage)

            // 创建数据库实体
            val messageEntity = P2PMessageEntity(
                id = p2pMessage.id,
                peerId = peerId,
                fromDeviceId = peerId,
                toDeviceId = localDeviceId,
                type = p2pMessage.type.name,
                content = decryptedContent,
                encryptedPayload = p2pMessage.payload,
                timestamp = p2pMessage.timestamp,
                isOutgoing = false,
                requiresAck = p2pMessage.requiresAck,
                isAcknowledged = false,
                sendStatus = MessageSendStatus.DELIVERED
            )

            // 保存到数据库
            p2pMessageDao.insertMessage(messageEntity)

            // 通知UI
            _incomingMessages.emit(messageEntity)

            // 发送ACK确认
            if (p2pMessage.requiresAck) {
                sendAck(p2pMessage.id, peerId, localDeviceId)
            }

            Timber.d("Message received and processed: ${p2pMessage.id}")
            Result.success(messageEntity)

        } catch (e: Exception) {
            Timber.e(e, "Failed to receive message")
            Result.failure(e)
        }
    }

    /**
     * 发送ACK确认
     */
    private suspend fun sendAck(messageId: String, toPeerId: String, localDeviceId: String) {
        try {
            val ackMessage = P2PMessage(
                id = UUID.randomUUID().toString(),
                fromDeviceId = localDeviceId,
                toDeviceId = toPeerId,
                type = MessageType.ACK,
                payload = messageId,
                timestamp = System.currentTimeMillis(),
                requiresAck = false,
                isAcknowledged = true
            )

            connectionManager.sendMessage(toPeerId, ackMessage)
            Timber.d("ACK sent for message: $messageId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to send ACK")
        }
    }

    /**
     * 处理收到的ACK
     */
    suspend fun handleAck(messageId: String) {
        try {
            p2pMessageDao.markAsAcknowledged(messageId)
            Timber.d("Message acknowledged: $messageId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle ACK")
        }
    }

    /**
     * 标记消息为已读
     */
    suspend fun markAsRead(peerId: String) {
        p2pMessageDao.markAllAsRead(peerId)
    }

    /**
     * 删除与设备的所有消息
     */
    suspend fun deleteMessages(peerId: String) {
        p2pMessageDao.deleteMessagesByPeer(peerId)
    }

    /**
     * 获取待发送的消息（用于重传）
     */
    suspend fun getPendingMessages(peerId: String): List<P2PMessageEntity> {
        return p2pMessageDao.getPendingMessages(peerId)
    }

    /**
     * 重新发送失败的消息
     */
    suspend fun retryFailedMessages(peerId: String, localDeviceId: String) {
        val pendingMessages = getPendingMessages(peerId)
        for (message in pendingMessages) {
            try {
                val p2pMessage = P2PMessage(
                    id = message.id,
                    fromDeviceId = localDeviceId,
                    toDeviceId = peerId,
                    type = MessageType.valueOf(message.type),
                    payload = message.encryptedPayload ?: "",
                    timestamp = message.timestamp,
                    requiresAck = message.requiresAck,
                    isAcknowledged = false
                )
                connectionManager.sendMessage(peerId, p2pMessage)
                p2pMessageDao.updateSendStatus(message.id, MessageSendStatus.SENT)
            } catch (e: Exception) {
                Timber.e(e, "Failed to retry message: ${message.id}")
            }
        }
    }

    /**
     * 监听网络消息
     */
    private fun observeNetworkMessages() {
        observeJob = scope.launch {
            connectionManager.receivedMessages.collect { p2pMessage ->
                when (p2pMessage.type) {
                    MessageType.ACK -> {
                        handleAck(p2pMessage.payload)
                    }
                    MessageType.TEXT -> {
                        // 由ViewModel调用receiveMessage处理
                        // 这里只是记录日志
                        Timber.d("Received text message from network: ${p2pMessage.id}")
                    }
                    else -> {
                        Timber.d("Received message of type: ${p2pMessage.type}")
                    }
                }
            }
        }
    }

    /**
     * 搜索消息
     */
    suspend fun searchMessages(peerId: String, query: String): List<P2PMessageEntity> {
        return p2pMessageDao.searchMessages(peerId, query)
    }

    /**
     * 获取所有聊天的设备ID
     */
    fun getAllPeerIds(): Flow<List<String>> {
        return p2pMessageDao.getAllPeerIds()
    }

    /**
     * 获取每个设备的最后一条消息
     */
    fun getLastMessagePerPeer(): Flow<List<P2PMessageEntity>> {
        return p2pMessageDao.getLastMessagePerPeer()
    }

    // ===== 同步接口 =====

    suspend fun saveMessageFromSync(resourceId: String, data: String) {
        try {
            val entity = json.decodeFromString<P2PMessageEntity>(data)
            p2pMessageDao.insertMessage(entity)
            Timber.d("Message saved from sync: $resourceId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to save message from sync: $resourceId")
        }
    }

    suspend fun updateMessageFromSync(resourceId: String, data: String) {
        try {
            val entity = json.decodeFromString<P2PMessageEntity>(data)
            p2pMessageDao.insertMessage(entity)
            Timber.d("Message updated from sync: $resourceId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to update message from sync: $resourceId")
        }
    }

    suspend fun deleteMessageFromSync(resourceId: String) {
        try {
            p2pMessageDao.deleteMessageById(resourceId)
            Timber.d("Message deleted from sync: $resourceId")
        } catch (e: Exception) {
            Timber.e(e, "Failed to delete message from sync: $resourceId")
        }
    }

    fun cleanup() {
        observeJob?.cancel()
        observeJob = null
    }
}
