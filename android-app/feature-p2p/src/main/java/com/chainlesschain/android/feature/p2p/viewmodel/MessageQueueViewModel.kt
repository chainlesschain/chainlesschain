package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.MessagePriority
import com.chainlesschain.android.core.database.entity.QueueStatus
import com.chainlesschain.android.feature.p2p.queue.OfflineMessageQueue
import com.chainlesschain.android.feature.p2p.ui.MessageStatus
import com.chainlesschain.android.feature.p2p.ui.QueuedMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class MessageQueueViewModel @Inject constructor(
    private val offlineMessageQueue: OfflineMessageQueue
) : ViewModel() {

    private val _uiState = MutableStateFlow(MessageQueueUiState())
    val uiState: StateFlow<MessageQueueUiState> = _uiState.asStateFlow()

    val outgoingMessages: StateFlow<List<QueuedMessage>> = offlineMessageQueue
        .getAllPendingMessages()
        .map { entities ->
            entities.map { entity ->
                QueuedMessage(
                    id = entity.id,
                    peerId = entity.peerId,
                    preview = "${entity.messageType}: ${entity.payload.take(50)}${if (entity.payload.length > 50) "..." else ""}",
                    timestamp = entity.createdAt,
                    status = mapQueueStatusToMessageStatus(entity.status),
                    priority = mapDbPriorityToUiPriority(entity.priority),
                    error = if (entity.status == QueueStatus.FAILED) "Failed after ${entity.retryCount} retries" else null
                )
            }
        }
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = emptyList()
        )

    private val _incomingMessages = MutableStateFlow<List<QueuedMessage>>(emptyList())
    val incomingMessages: StateFlow<List<QueuedMessage>> = _incomingMessages.asStateFlow()

    val totalPendingCount: StateFlow<Int> = offlineMessageQueue
        .getTotalPendingCount()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5000),
            initialValue = 0
        )

    init {
        viewModelScope.launch {
            offlineMessageQueue.messageStatusChanged.collect { event ->
                Timber.d("Message status changed: ${event.messageId} -> ${event.status}")
                _uiState.update { it.copy(lastStatusChange = event.messageId) }
            }
        }

        viewModelScope.launch {
            offlineMessageQueue.retryReadyMessages.collect { message ->
                Timber.d("Message ready for retry: ${message.id}")
            }
        }
    }

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
                    priority = mapUiPriorityToDbPriority(priority),
                    requireAck = requireAck,
                    expiresInMs = expiresInMs
                )
                Timber.d("Message enqueued: $messageId")
                _uiState.update { it.copy(successMessage = "Message enqueued") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to enqueue message")
                _uiState.update { it.copy(errorMessage = "Failed to enqueue message: ${e.message}") }
            }
        }
    }

    fun retryMessage(messageId: String) {
        viewModelScope.launch {
            try {
                offlineMessageQueue.markAsFailed(messageId, shouldRetry = true)
                Timber.d("Message retry requested: $messageId")
                _uiState.update { it.copy(successMessage = "Retry scheduled") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to retry message")
                _uiState.update { it.copy(errorMessage = "Failed to retry message: ${e.message}") }
            }
        }
    }

    fun cancelMessage(messageId: String) {
        viewModelScope.launch {
            try {
                offlineMessageQueue.markAsFailed(messageId, shouldRetry = false)
                Timber.d("Message cancelled: $messageId")
                _uiState.update { it.copy(successMessage = "Message cancelled") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to cancel message")
                _uiState.update { it.copy(errorMessage = "Failed to cancel message: ${e.message}") }
            }
        }
    }

    fun clearCompleted() {
        viewModelScope.launch {
            try {
                offlineMessageQueue.cleanupOldMessages()
                Timber.d("Cleared completed messages")
                _uiState.update { it.copy(successMessage = "Completed messages cleared") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear completed messages")
                _uiState.update { it.copy(errorMessage = "Failed to clear completed messages: ${e.message}") }
            }
        }
    }

    fun clearAll() {
        viewModelScope.launch {
            try {
                offlineMessageQueue.clearAllQueues()
                Timber.d("Cleared all queues")
                _uiState.update { it.copy(successMessage = "All queues cleared") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear all queues")
                _uiState.update { it.copy(errorMessage = "Failed to clear all queues: ${e.message}") }
            }
        }
    }

    fun clearQueueForPeer(peerId: String) {
        viewModelScope.launch {
            try {
                offlineMessageQueue.clearQueue(peerId)
                Timber.d("Cleared queue for peer: $peerId")
                _uiState.update { it.copy(successMessage = "Queue cleared for peer") }
            } catch (e: Exception) {
                Timber.e(e, "Failed to clear queue for peer")
                _uiState.update { it.copy(errorMessage = "Failed to clear queue: ${e.message}") }
            }
        }
    }

    suspend fun getQueueStats(): QueueStats {
        val outgoing = outgoingMessages.value
        val incoming = incomingMessages.value

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

    fun clearError() {
        _uiState.update { it.copy(errorMessage = null) }
    }

    fun clearSuccess() {
        _uiState.update { it.copy(successMessage = null) }
    }

    private fun mapDbPriorityToUiPriority(priority: String): com.chainlesschain.android.feature.p2p.ui.MessagePriority {
        return when (priority) {
            MessagePriority.HIGH -> com.chainlesschain.android.feature.p2p.ui.MessagePriority.HIGH
            MessagePriority.LOW -> com.chainlesschain.android.feature.p2p.ui.MessagePriority.LOW
            else -> com.chainlesschain.android.feature.p2p.ui.MessagePriority.NORMAL
        }
    }

    private fun mapUiPriorityToDbPriority(priority: com.chainlesschain.android.feature.p2p.ui.MessagePriority): String {
        return when (priority) {
            com.chainlesschain.android.feature.p2p.ui.MessagePriority.HIGH -> MessagePriority.HIGH
            com.chainlesschain.android.feature.p2p.ui.MessagePriority.LOW -> MessagePriority.LOW
            com.chainlesschain.android.feature.p2p.ui.MessagePriority.NORMAL -> MessagePriority.NORMAL
        }
    }

    private fun mapQueueStatusToMessageStatus(status: String): MessageStatus {
        return when (status) {
            QueueStatus.PENDING -> MessageStatus.PENDING
            QueueStatus.RETRYING -> MessageStatus.SENDING
            QueueStatus.SENT -> MessageStatus.COMPLETED
            QueueStatus.FAILED -> MessageStatus.FAILED
            QueueStatus.EXPIRED -> MessageStatus.FAILED
            else -> MessageStatus.PENDING
        }
    }
}

data class MessageQueueUiState(
    val errorMessage: String? = null,
    val successMessage: String? = null,
    val lastStatusChange: String? = null
)

data class QueueStats(
    val totalOutgoing: Int,
    val pendingOutgoing: Int,
    val sendingOutgoing: Int,
    val failedOutgoing: Int,
    val totalIncoming: Int,
    val pendingIncoming: Int,
    val receivingIncoming: Int
)
