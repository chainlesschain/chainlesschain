package com.chainlesschain.android.feature.p2p.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.e2ee.session.PersistentSessionManager
import com.chainlesschain.android.core.e2ee.verification.VerificationManager
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.model.MessageType
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

/**
 * P2P聊天 ViewModel
 *
 * 管理P2P设备间的聊天消息
 */
@HiltViewModel
class P2PChatViewModel @Inject constructor(
    private val sessionManager: PersistentSessionManager,
    private val verificationManager: VerificationManager
) : ViewModel() {

    // 聊天消息列表
    private val _messages = MutableStateFlow<List<P2PMessage>>(emptyList())
    val messages: StateFlow<List<P2PMessage>> = _messages.asStateFlow()

    // 设备验证状态
    private val _isDeviceVerified = MutableStateFlow(false)
    val isDeviceVerified: StateFlow<Boolean> = _isDeviceVerified.asStateFlow()

    // 连接状态
    private val _connectionStatus = MutableStateFlow("DISCONNECTED")
    val connectionStatus: StateFlow<String> = _connectionStatus.asStateFlow()

    // UI状态
    private val _uiState = MutableStateFlow(P2PChatUiState())
    val uiState: StateFlow<P2PChatUiState> = _uiState.asStateFlow()

    // 当前设备ID
    private var currentDeviceId: String? = null

    /**
     * 加载聊天历史
     */
    fun loadChat(deviceId: String) {
        currentDeviceId = deviceId
        viewModelScope.launch {
            try {
                // 检查设备验证状态
                _isDeviceVerified.value = verificationManager.isVerified(deviceId)

                // 检查会话状态
                val session = sessionManager.getSession(deviceId)
                _connectionStatus.value = if (session != null) "CONNECTED" else "DISCONNECTED"

                // 加载聊天历史
                // TODO: 从数据库加载历史消息
                // 临时使用空列表
                _messages.value = emptyList()

            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    error = "加载聊天失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 发送消息
     */
    fun sendMessage(deviceId: String, content: String) {
        viewModelScope.launch {
            try {
                _uiState.value = _uiState.value.copy(isSending = true, error = null)

                // 获取会话
                val session = sessionManager.getSession(deviceId)
                if (session == null) {
                    _uiState.value = _uiState.value.copy(
                        isSending = false,
                        error = "设备未连接"
                    )
                    return@launch
                }

                // 创建消息
                val message = P2PMessage(
                    id = UUID.randomUUID().toString(),
                    fromDeviceId = "local", // TODO: 获取本地设备ID
                    toDeviceId = deviceId,
                    type = MessageType.TEXT,
                    payload = content, // TODO: 使用E2EE加密
                    timestamp = System.currentTimeMillis(),
                    requiresAck = true,
                    isAcknowledged = false
                )

                // 添加到消息列表
                _messages.value = _messages.value + message

                // TODO: 实际发送消息到P2P网络
                // 这里应该调用P2P连接管理器发送加密消息

                _uiState.value = _uiState.value.copy(isSending = false)

            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isSending = false,
                    error = "发送失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 接收消息（由P2P连接管理器调用）
     */
    fun receiveMessage(message: P2PMessage) {
        viewModelScope.launch {
            try {
                // TODO: 使用E2EE解密消息

                // 添加到消息列表
                _messages.value = _messages.value + message

                // 发送ACK确认
                if (message.requiresAck) {
                    sendAck(message.id, message.fromDeviceId)
                }

            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    error = "接收消息失败: ${e.message}"
                )
            }
        }
    }

    /**
     * 发送ACK确认
     */
    private suspend fun sendAck(messageId: String, toDeviceId: String) {
        try {
            val ackMessage = P2PMessage(
                id = UUID.randomUUID().toString(),
                fromDeviceId = "local", // TODO: 获取本地设备ID
                toDeviceId = toDeviceId,
                type = MessageType.ACK,
                payload = messageId,
                timestamp = System.currentTimeMillis(),
                requiresAck = false,
                isAcknowledged = true
            )

            // TODO: 发送ACK到P2P网络
        } catch (e: Exception) {
            // ACK发送失败不影响主流程
        }
    }

    /**
     * 标记消息为已读
     */
    fun markMessageAsRead(messageId: String) {
        viewModelScope.launch {
            _messages.value = _messages.value.map { message ->
                if (message.id == messageId) {
                    message.copy(isAcknowledged = true)
                } else {
                    message
                }
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
        currentDeviceId?.let { deviceId ->
            viewModelScope.launch {
                try {
                    _connectionStatus.value = "CONNECTING"
                    // TODO: 实现重连逻辑
                    _connectionStatus.value = "CONNECTED"
                } catch (e: Exception) {
                    _connectionStatus.value = "DISCONNECTED"
                    _uiState.value = _uiState.value.copy(
                        error = "重连失败: ${e.message}"
                    )
                }
            }
        }
    }
}

/**
 * P2P聊天UI状态
 */
data class P2PChatUiState(
    val isSending: Boolean = false,
    val error: String? = null
)
