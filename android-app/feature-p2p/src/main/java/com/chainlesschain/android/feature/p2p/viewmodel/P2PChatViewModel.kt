package com.chainlesschain.android.feature.p2p.viewmodel

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.database.entity.MessageSendStatus
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.p2p.connection.P2PConnectionManager
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.feature.p2p.repository.P2PMessageRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * P2P聊天 ViewModel
 *
 * 管理P2P设备间的聊天消息，包括：
 * - E2EE加密/解密
 * - 消息持久化
 * - 网络消息收发
 * - 消息状态管理
 */
@HiltViewModel
class P2PChatViewModel @Inject constructor(
    private val sessionManager: PersistentSessionManager,
    private val verificationManager: VerificationManager,
    private val connectionManager: P2PConnectionManager,
    private val didManager: DIDManager,
    private val messageRepository: P2PMessageRepository
) : ViewModel() {

    companion object {
        private const val TAG = "P2PChatViewModel"
    }

    // 聊天消息列表
    private val _messages = MutableStateFlow<List<P2PMessageEntity>>(emptyList())
    val messages: StateFlow<List<P2PMessageEntity>> = _messages.asStateFlow()

    // 设备验证状态
    private val _isDeviceVerified = MutableStateFlow(false)
    val isDeviceVerified: StateFlow<Boolean> = _isDeviceVerified.asStateFlow()

    // 连接状态
    private val _connectionStatus = MutableStateFlow(ConnectionStatus.DISCONNECTED)
    val connectionStatus: StateFlow<ConnectionStatus> = _connectionStatus.asStateFlow()

    // UI状态
    private val _uiState = MutableStateFlow(P2PChatUiState())
    val uiState: StateFlow<P2PChatUiState> = _uiState.asStateFlow()

    // 当前对话的设备ID
    private var currentPeerId: String? = null

    // 本地设备ID (DID)
    private val localDeviceId: String
        get() = didManager.getCurrentDID() ?: ""

    init {
        // 监听接收到的消息
        observeIncomingMessages()
        // 监听网络消息
        observeNetworkMessages()
    }

    /**
     * 加载聊天历史
     */
    fun loadChat(peerId: String) {
        currentPeerId = peerId
        Log.d(TAG, "Loading chat with peer: $peerId")

        viewModelScope.launch {
            try {
                _uiState.value = _uiState.value.copy(isLoading = true, error = null)

                // 检查设备验证状态
                _isDeviceVerified.value = verificationManager.isVerified(peerId)

                // 检查会话状态
                val session = sessionManager.getSession(peerId)
                _connectionStatus.value = if (session != null) {
                    ConnectionStatus.CONNECTED
                } else {
                    ConnectionStatus.DISCONNECTED
                }

                // 加载历史消息
                messageRepository.getMessages(peerId).collect { messageList ->
                    _messages.value = messageList
                    Log.d(TAG, "Loaded ${messageList.size} messages")
                }

            } catch (e: Exception) {
                Log.e(TAG, "Failed to load chat", e)
                _uiState.value = _uiState.value.copy(
                    isLoading = false,
                    error = "加载聊天失败: ${e.message}"
                )
            } finally {
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }
    }

    /**
     * 发送消息
     */
    fun sendMessage(peerId: String, content: String) {
        if (content.isBlank()) return

        viewModelScope.launch {
            try {
                _uiState.value = _uiState.value.copy(isSending = true, error = null)

                // 检查会话
                val session = sessionManager.getSession(peerId)
                if (session == null) {
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = "设备未连接，请先建立安全连接"
                    )
                    return@launch
                }

                // 检查本地设备ID
                if (localDeviceId.isEmpty()) {
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = "本地身份未初始化"
                    )
                    return@launch
                }

                // 通过仓库发送消息（包含加密和网络发送）
                val result = messageRepository.sendMessage(peerId, localDeviceId, content)

                result.fold(
                    onSuccess = { message ->
                        Log.d(TAG, "Message sent: ${message.id}")
                        // 消息会通过Flow自动更新到UI
                    },
                    onFailure = { error ->
                        Log.e(TAG, "Failed to send message", error)
                        _uiState.value = _uiState.value.copy(
                            error = "发送失败: ${error.message}"
                        )
                    }
                )

            } catch (e: Exception) {
                Log.e(TAG, "Send message error", e)
                _uiState.value = _uiState.value.copy(
                    error = "发送失败: ${e.message}"
                )
            } finally {
                _uiState.value = _uiState.value.copy(isSending = false)
            }
        }
    }

    /**
     * 监听从仓库接收到的消息
     */
    private fun observeIncomingMessages() {
        viewModelScope.launch {
            messageRepository.incomingMessages.collect { message ->
                if (message.peerId == currentPeerId) {
                    // 消息已通过Flow自动更新，这里可以做额外处理
                    Log.d(TAG, "New message received for current chat: ${message.id}")
                }
            }
        }
    }

    /**
     * 监听网络消息
     */
    private fun observeNetworkMessages() {
        viewModelScope.launch {
            connectionManager.receivedMessages.collect { p2pMessage ->
                Log.d(TAG, "Network message received: ${p2pMessage.type}")

                when (p2pMessage.type) {
                    MessageType.TEXT -> {
                        // 处理文本消息
                        if (p2pMessage.fromDeviceId == currentPeerId) {
                            handleIncomingTextMessage(p2pMessage)
                        }
                    }
                    MessageType.ACK -> {
                        // ACK由仓库处理
                    }
                    else -> {
                        Log.d(TAG, "Unhandled message type: ${p2pMessage.type}")
                    }
                }
            }
        }
    }

    /**
     * 处理收到的文本消息
     */
    private suspend fun handleIncomingTextMessage(p2pMessage: P2PMessage) {
        val result = messageRepository.receiveMessage(p2pMessage, localDeviceId)
        result.fold(
            onSuccess = { message ->
                Log.d(TAG, "Incoming message processed: ${message.id}")
            },
            onFailure = { error ->
                Log.e(TAG, "Failed to process incoming message", error)
            }
        )
    }

    /**
     * 标记消息为已读
     */
    fun markAsRead() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                messageRepository.markAsRead(peerId)
            }
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    /**
     * 重新连接设备
     */
    fun reconnect() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    _connectionStatus.value = ConnectionStatus.CONNECTING

                    // 检查会话是否存在
                    if (!sessionManager.hasSession(peerId)) {
                        _uiState.value = _uiState.value.copy(
                            error = "需要重新建立安全连接"
                        )
                        _connectionStatus.value = ConnectionStatus.DISCONNECTED
                        return@launch
                    }

                    // 重试发送失败的消息
                    messageRepository.retryFailedMessages(peerId, localDeviceId)

                    _connectionStatus.value = ConnectionStatus.CONNECTED
                    Log.d(TAG, "Reconnected to peer: $peerId")

                } catch (e: Exception) {
                    Log.e(TAG, "Reconnect failed", e)
                    _connectionStatus.value = ConnectionStatus.DISCONNECTED
                    _uiState.value = _uiState.value.copy(
                        error = "重连失败: ${e.message}"
                    )
                }
            }
        }
    }

    /**
     * 重新发送失败的消息
     */
    fun retryFailedMessages() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    messageRepository.retryFailedMessages(peerId, localDeviceId)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to retry messages", e)
                }
            }
        }
    }

    /**
     * 删除所有消息
     */
    fun deleteAllMessages() {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    messageRepository.deleteMessages(peerId)
                    Log.d(TAG, "All messages deleted for peer: $peerId")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to delete messages", e)
                    _uiState.value = _uiState.value.copy(
                        error = "删除失败: ${e.message}"
                    )
                }
            }
        }
    }

    /**
     * 搜索消息
     */
    fun searchMessages(query: String) {
        currentPeerId?.let { peerId ->
            viewModelScope.launch {
                try {
                    val results = messageRepository.searchMessages(peerId, query)
                    _messages.value = results
                } catch (e: Exception) {
                    Log.e(TAG, "Search failed", e)
                }
            }
        }
    }

    /**
     * 清除搜索，恢复全部消息
     */
    fun clearSearch() {
        currentPeerId?.let { loadChat(it) }
    }

    override fun onCleared() {
        super.onCleared()
        Log.d(TAG, "ViewModel cleared")
    }
}

/**
 * 连接状态
 */
enum class ConnectionStatus {
    DISCONNECTED,
    CONNECTING,
    CONNECTED
}

/**
 * P2P聊天UI状态
 */
data class P2PChatUiState(
    val isLoading: Boolean = false,
    val isSending: Boolean = false,
    val error: String? = null
)
