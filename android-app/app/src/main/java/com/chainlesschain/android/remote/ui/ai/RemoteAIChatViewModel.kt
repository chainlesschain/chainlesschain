package com.chainlesschain.android.remote.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.ChatResponse
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

/**
 * 远程 AI 对话 ViewModel
 *
 * 功能：
 * - 发送消息到 PC 端 LLM
 * - 管理对话历史
 * - 切换模型
 * - 显示 Token 使用情况
 */
@HiltViewModel
class RemoteAIChatViewModel @Inject constructor(
    private val aiCommands: AICommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    // UI 状态
    private val _uiState = MutableStateFlow(RemoteAIChatUiState())
    val uiState: StateFlow<RemoteAIChatUiState> = _uiState.asStateFlow()

    // 连接状态
    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    // 对话消息列表
    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    init {
        // 加载可用模型列表
        loadModels()
    }

    /**
     * 加载可用模型列表
     */
    private fun loadModels() {
        viewModelScope.launch {
            val result = aiCommands.getModels()

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    _uiState.update { it.copy(
                        availableModels = response.models.map { model -> model.name },
                        selectedModel = response.models.firstOrNull()?.name
                    )}
                }
            } else {
                Timber.e(result.exceptionOrNull(), "加载模型列表失败")
            }
        }
    }

    /**
     * 发送消息
     */
    fun sendMessage(message: String) {
        if (message.isBlank()) return

        viewModelScope.launch {
            // 添加用户消息到列表
            val userMessage = ChatMessage(
                id = System.currentTimeMillis().toString(),
                role = MessageRole.USER,
                content = message,
                timestamp = System.currentTimeMillis()
            )
            _messages.update { it + userMessage }

            // 显示加载状态
            _uiState.update { it.copy(isLoading = true, error = null) }

            // 调用 PC 端 LLM
            val result = aiCommands.chat(
                message = message,
                conversationId = _uiState.value.conversationId,
                model = _uiState.value.selectedModel,
                temperature = _uiState.value.temperature
            )

            _uiState.update { it.copy(isLoading = false) }

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    // 添加 AI 回复到列表
                    val assistantMessage = ChatMessage(
                        id = "${System.currentTimeMillis()}-assistant",
                        role = MessageRole.ASSISTANT,
                        content = response.reply,
                        timestamp = System.currentTimeMillis(),
                        model = response.model,
                        tokenUsage = response.tokens
                    )
                    _messages.update { it + assistantMessage }

                    // 更新对话 ID
                    _uiState.update { it.copy(
                        conversationId = response.conversationId,
                        totalTokens = (_uiState.value.totalTokens ?: 0) + (response.tokens?.total ?: 0)
                    )}
                }
            } else {
                val error = result.exceptionOrNull()?.message ?: "发送消息失败"
                Timber.e(result.exceptionOrNull(), "发送消息失败")
                _uiState.update { it.copy(error = error) }
            }
        }
    }

    /**
     * 切换模型
     */
    fun selectModel(model: String) {
        _uiState.update { it.copy(selectedModel = model) }
    }

    /**
     * 设置温度
     */
    fun setTemperature(temperature: Float) {
        _uiState.update { it.copy(temperature = temperature) }
    }

    /**
     * 清空对话
     */
    fun clearConversation() {
        _messages.value = emptyList()
        _uiState.update { it.copy(
            conversationId = null,
            totalTokens = null,
            error = null
        )}
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

/**
 * UI 状态
 */
data class RemoteAIChatUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val conversationId: String? = null,
    val availableModels: List<String> = emptyList(),
    val selectedModel: String? = null,
    val temperature: Float = 0.7f,
    val totalTokens: Int? = null
)

/**
 * 聊天消息
 */
data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val content: String,
    val timestamp: Long,
    val model: String? = null,
    val tokenUsage: com.chainlesschain.android.remote.commands.TokenUsage? = null
)

/**
 * 消息角色
 */
enum class MessageRole {
    USER,
    ASSISTANT,
    SYSTEM
}
