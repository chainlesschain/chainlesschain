package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.MessagePriority
import com.chainlesschain.android.core.database.entity.QueueStatus
import com.chainlesschain.android.feature.p2p.queue.OfflineMessageQueue
import com.chainlesschain.android.feature.p2p.ui.MessageStatus
import com.chainlesschain.android.feature.p2p.ui.QueuedMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 消息队列 ViewModel
 *
 * 管理待发送和待接收的消息队列
 * 集成 OfflineMessageQueue 实现完整的离线消息功能
 */
@HiltViewModel
class MessageQueueViewModel @Inject constructor(
    private val offlineMessageQueue: OfflineMessageQueue
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(MessageQueueUiState())
    val uiState: StateFlow<MessageQueueUiState> = _uiState.asStateFlow()

    // 待发送消息列表
    val outgoingMessages: StateFlow<List<QueuedMessage>> = offlineMessageQueue
        .getAllPendingMessages()
        .map { entities ->
            entities.map { entity ->
                QueuedMessage(
                    id = entity.id,
                    peerId = entity.peerId,
                    messageType = entity.messageType,
                    payload = entity.payload,
                    status = mapQueueStatusToMessageStatus(entity.status),
                    priority = mapPriorityToPriority(entity.priority),
                    retryCount = entity.retryCount,
                    maxRetries = entity.maxRetries,
                    createdAt = entity.createdAt,
                    updatedAt = entity.updatedAt
                )
            }
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    // 总待发送数量
    val totalPendingCount: StateFlow<Int> = offlineMessageQueue
        .getTotalPendingCount()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = 0
        )

    init {
        // 监听消息状态变化
        viewModelScope.launch {
            offlineMessageQueue.messageStatusChanged.collect { event ->
                Timber.d("Message status changed: ${event.messageId} -> ${event.status}")
                _uiState.update { it.copy(lastStatusChange = event.messageId) }
            }
        }

        // 监听重试就绪消息
        viewModelScope.launch {
            offlineMessageQueue.retryReadyMessages.collect { message ->
                Timber.d("Message ready for retry: ${message.id}")
                // 触发重试逻辑（由外部P2P连接处理）
            }
        }
    }

    /**
     * 添加消息到队列
     */
    fun enqueueMessage(
        peerId: String,
        messageType: String,
        payload: String,
        priority: com.chainlesschain.android.feature.p2p.ui.MessagePriority = com.chainlesschain.android.feature.p2p.ui.MessagePriority.NORMAL,
        requireAck: Boolean = true,
        expiresInMs: Long? = null
    ) {
        viewModelScope.launch {
            try {
                val messageId = offlineMessageQueue.enqueue(
                    peerId = peerId,
                    messageType = messageType,
                    payload = payload,
                    priority = mapPriorityToDb(priority),
                    requireAck = requireAck,
                    expiresInMs = expiresInMs
                )
                Timber.d("Message enqueued: $messageId")
                _uiState.update { it.copy(successMessage = "消息已加入队列") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to enqueue message")
                _uiState.update { it.copy(errorMessage = "加入队列失败: ${e.message}") }
            }
        }
    }

    /**
     * 重试发送消息
     */
    fun retryMessage(messageId: String) {
        viewModelScope.launch {
            try {
                // 标记为失败并触发重试
                offlineMessageQueue.markAsFailed(messageId, shouldRetry = true)
                Timber.d("Message retry requested: $messageId")
                _uiState.update { it.copy(successMessage = "消息已安排重试") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to retry message")
                _uiState.update { it.copy(errorMessage = "重试失败: ${e.message}") }
            }
        }
    }

    /**
     * 取消消息（标记为失败）
     */
    fun cancelMessage(messageId: String) {
        viewModelScope.launch {
            try {
                // 标记为失败且不重试
                offlineMessageQueue.markAsFailed(messageId, shouldRetry = false)
                Timber.d("Message cancelled: $messageId")
                _uiState.update { it.copy(successMessage = "消息已取消") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to cancel message")
                _uiState.update { it.copy(errorMessage = "取消失败: ${e.message}") }
            }
        }
    }

    /**
     * 清除已完成的消息（已发送、已过期、已失败）
     */
    fun clearCompleted() {
        viewModelScope.launch {
            try {
                offlineMessageQueue.cleanupOldMessages()
                Timber.d("Cleared completed messages")
                _uiState.update { it.copy(successMessage = "已清除完成的消息") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear completed messages")
                _uiState.update { it.copy(errorMessage = "清除失败: ${e.message}") }
            }
        }
    }

    /**
     * 清除所有队列
     */
    fun clearAll() {
        viewModelScope.launch {
            try {
                offlineMessageQueue.clearAllQueues()
                Timber.d("Cleared all queues")
                _uiState.update { it.copy(successMessage = "已清空所有队列") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear all queues")
                _uiState.update { it.copy(errorMessage = "清空失败: ${e.message}") }
            }
        }
    }

    /**
     * 清除指定设备的队列
     */
    fun clearQueueForPeer(peerId: String) {
        viewModelScope.launch {
            try {
                offlineMessageQueue.clearQueue(peerId)
                Timber.d("Cleared queue for peer: $peerId")
                _uiState.update { it.copy(successMessage = "已清空设备队列") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear queue for peer")
                _uiState.update { it.copy(errorMessage = "清空失败: ${e.message}") }
            }
        }
    }

    /**
     * 获取队列统计
     */
    suspend fun getQueueStats(): QueueStats {
        val statistics = offlineMessageQueue.getStatistics()
        val outgoing = outgoingMessages.value

        return QueueStats(
            totalPending = statistics.totalPending,
            totalRetrying = statistics.totalRetrying,
            failedCount = outgoing.count { it.status == MessageStatus.FAILED },
            byPeer = statistics.byPeer
        )
    }

    /**
     * 清除错误消息
     */
    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    /**
     * 清除成功消息
     */
    fun clearSuccess() {
        _uiState.update { it.copy(successMessage = null) }
    }

    // ===== 辅助方法 =====

    /**
     * 映射数据库优先级到UI优先级
     */
    private fun mapPriorityToPriority(priority: String): com.chainlesschain.android.feature.p2p.ui.MessagePriority {
        return when (priority) {
            MessagePriority.HIGH -> com.chainlesschain.android.feature.p2p.ui.MessagePriority.HIGH
            MessagePriority.LOW -> com.chainlesschain.android.feature.p2p.ui.MessagePriority.LOW
            else -> com.chainlesschain.android.feature.p2p.ui.MessagePriority.NORMAL
        }
    }

    /**
     * 映射UI优先级到数据库优先级
     */
    private fun mapPriorityToDb(priority: com.chainlesschain.android.feature.p2p.ui.MessagePriority): String {
        return when (priority) {
            com.chainlesschain.android.feature.p2p.ui.MessagePriority.HIGH -> MessagePriority.HIGH
            com.chainlesschain.android.feature.p2p.ui.MessagePriority.LOW -> MessagePriority.LOW
            com.chainlesschain.android.feature.p2p.ui.MessagePriority.NORMAL -> MessagePriority.NORMAL
        }
    }

    /**
     * 映射队列状态到消息状态
     */
    private fun mapQueueStatusToMessageStatus(status: String): MessageStatus {
        return when (status) {
            QueueStatus.PENDING -> MessageStatus.PENDING
            QueueStatus.RETRYING -> MessageStatus.SENDING
            QueueStatus.SENT -> MessageStatus.SENT
            QueueStatus.FAILED -> MessageStatus.FAILED
            QueueStatus.EXPIRED -> MessageStatus.FAILED
            else -> MessageStatus.PENDING
        }
    }

    override fun onCleared() {
        super.onCleared()
        // 注意：不要在这里调用 offlineMessageQueue.stop()
        // 因为 OfflineMessageQueue 是 Singleton，其他地方可能还在使用
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
