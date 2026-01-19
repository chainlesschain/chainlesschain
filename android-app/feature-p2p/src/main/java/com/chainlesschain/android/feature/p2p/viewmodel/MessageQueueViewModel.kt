package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.e2ee.messaging.PersistentMessageQueueManager
import com.chainlesschain.android.core.e2ee.messaging.QueuedOutgoingMessage
import com.chainlesschain.android.core.e2ee.messaging.QueuedIncomingMessage
import com.chainlesschain.android.feature.p2p.ui.MessagePriority
import com.chainlesschain.android.feature.p2p.ui.MessageStatus
import com.chainlesschain.android.feature.p2p.ui.QueuedMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 消息队列 ViewModel
 *
 * 管理待发送和待接收的消息队列
 */
@HiltViewModel
class MessageQueueViewModel @Inject constructor(
    private val queueManager: PersistentMessageQueueManager
) : ViewModel() {

    private val _outgoingMessages = MutableStateFlow<List<QueuedMessage>>(emptyList())
    val outgoingMessages: StateFlow<List<QueuedMessage>> = _outgoingMessages.asStateFlow()

    private val _incomingMessages = MutableStateFlow<List<QueuedMessage>>(emptyList())
    val incomingMessages: StateFlow<List<QueuedMessage>> = _incomingMessages.asStateFlow()

    init {
        loadQueues()
    }

    /**
     * 加载消息队列
     */
    private fun loadQueues() {
        viewModelScope.launch {
            // Monitor outgoing queue
            launch {
                queueManager.outgoingQueue.collect { outgoingQueue ->
                    _outgoingMessages.value = outgoingQueue.flatMap { (peerId, messages) ->
                        messages.map { message ->
                            mapToQueuedMessage(peerId, message, isOutgoing = true)
                        }
                    }.sortedByDescending { it.timestamp }
                }
            }

            // Monitor incoming queue
            launch {
                queueManager.incomingQueue.collect { incomingQueue ->
                    _incomingMessages.value = incomingQueue.flatMap { (peerId, messages) ->
                        messages.map { message ->
                            mapToQueuedMessage(peerId, message, isOutgoing = false)
                        }
                    }.sortedByDescending { it.timestamp }
                }
            }
        }
    }

    /**
     * 映射到 UI 数据模型
     */
    private fun mapToQueuedMessage(
        peerId: String,
        message: Any,
        isOutgoing: Boolean
    ): QueuedMessage {
        return when (message) {
            is QueuedOutgoingMessage -> QueuedMessage(
                id = message.messageId,
                peerId = peerId,
                preview = generatePreview(message.encryptedMessage.ciphertext),
                timestamp = message.queuedAt,
                status = mapStatus(message.retryCount, message.lastError),
                priority = mapPriority(message.priority),
                error = message.lastError
            )
            is QueuedIncomingMessage -> QueuedMessage(
                id = message.messageId,
                peerId = peerId,
                preview = generatePreview(message.encryptedMessage.ciphertext),
                timestamp = message.receivedAt,
                status = MessageStatus.PENDING,
                priority = MessagePriority.NORMAL,
                error = null
            )
            else -> throw IllegalArgumentException("Unknown message type")
        }
    }

    /**
     * 生成消息预览
     */
    private fun generatePreview(ciphertext: ByteArray): String {
        // Show encrypted message indicator
        val size = ciphertext.size
        return when {
            size < 100 -> "加密消息（小）"
            size < 1024 -> "加密消息（中）"
            size < 10240 -> "加密消息（大）"
            else -> "加密消息（${size / 1024}KB）"
        }
    }

    /**
     * 映射消息状态
     */
    private fun mapStatus(retryCount: Int, lastError: String?): MessageStatus {
        return when {
            lastError != null -> MessageStatus.FAILED
            retryCount > 0 -> MessageStatus.SENDING
            else -> MessageStatus.PENDING
        }
    }

    /**
     * 映射消息优先级
     */
    private fun mapPriority(priority: Int): MessagePriority {
        return when {
            priority >= 100 -> MessagePriority.HIGH
            priority >= 50 -> MessagePriority.NORMAL
            else -> MessagePriority.LOW
        }
    }

    /**
     * 重试发送消息
     */
    fun retryMessage(messageId: String) {
        viewModelScope.launch {
            try {
                // Find the message in outgoing queue
                val message = _outgoingMessages.value.find { it.id == messageId }
                if (message != null) {
                    queueManager.retryMessage(message.peerId, messageId)
                }
            } catch (e: Exception) {
                // Handle retry error
            }
        }
    }

    /**
     * 取消消息
     */
    fun cancelMessage(messageId: String) {
        viewModelScope.launch {
            try {
                // Find the message
                val outgoingMessage = _outgoingMessages.value.find { it.id == messageId }
                val incomingMessage = _incomingMessages.value.find { it.id == messageId }

                when {
                    outgoingMessage != null -> {
                        queueManager.removeOutgoingMessage(outgoingMessage.peerId, messageId)
                    }
                    incomingMessage != null -> {
                        queueManager.removeIncomingMessage(incomingMessage.peerId, messageId)
                    }
                }
            } catch (e: Exception) {
                // Handle cancel error
            }
        }
    }

    /**
     * 清除已完成的消息
     */
    fun clearCompleted() {
        viewModelScope.launch {
            try {
                // Filter out completed messages
                val completedOutgoing = _outgoingMessages.value
                    .filter { it.status == MessageStatus.COMPLETED }

                val completedIncoming = _incomingMessages.value
                    .filter { it.status == MessageStatus.COMPLETED }

                // Remove them from queue
                completedOutgoing.forEach { message ->
                    queueManager.removeOutgoingMessage(message.peerId, message.id)
                }

                completedIncoming.forEach { message ->
                    queueManager.removeIncomingMessage(message.peerId, message.id)
                }
            } catch (e: Exception) {
                // Handle clear error
            }
        }
    }

    /**
     * 获取队列统计
     */
    fun getQueueStats(): QueueStats {
        val outgoing = _outgoingMessages.value
        val incoming = _incomingMessages.value

        return QueueStats(
            totalOutgoing = outgoing.size,
            pendingOutgoing = outgoing.count { it.status == MessageStatus.PENDING },
            sendingOutgoing = outgoing.count { it.status == MessageStatus.SENDING },
            failedOutgoing = outgoing.count { it.status == MessageStatus.FAILED },
            totalIncoming = incoming.size,
            pendingIncoming = incoming.count { it.status == MessageStatus.PENDING },
            receivingIncoming = incoming.count { it.status == MessageStatus.RECEIVING }
        )
    }

    override fun onCleared() {
        super.onCleared()
        // ViewModel cleanup
    }
}

/**
 * 队列统计数据
 */
data class QueueStats(
    val totalOutgoing: Int,
    val pendingOutgoing: Int,
    val sendingOutgoing: Int,
    val failedOutgoing: Int,
    val totalIncoming: Int,
    val pendingIncoming: Int,
    val receivingIncoming: Int
)
