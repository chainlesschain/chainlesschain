package com.chainlesschain.android.remote.ui.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.remote.commands.AICommands
import com.chainlesschain.android.remote.commands.TokenUsage
import com.chainlesschain.android.remote.p2p.ConnectionState
import com.chainlesschain.android.remote.p2p.P2PClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

@HiltViewModel
class RemoteAIChatViewModel @Inject constructor(
    private val aiCommands: AICommands,
    private val p2pClient: P2PClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(RemoteAIChatUiState())
    val uiState: StateFlow<RemoteAIChatUiState> = _uiState.asStateFlow()

    val connectionState: StateFlow<ConnectionState> = p2pClient.connectionState

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    init {
        loadModels()
    }

    private fun loadModels() {
        viewModelScope.launch {
            val result = aiCommands.getModels()
            if (result.isSuccess) {
                val models = result.getOrNull()?.models.orEmpty()
                _uiState.update {
                    it.copy(
                        availableModels = models.map { m -> m.name },
                        selectedModel = it.selectedModel ?: models.firstOrNull()?.name
                    )
                }
            }
        }
    }

    fun sendMessage(message: String) {
        val text = message.trim()
        if (text.isEmpty()) return
        if (connectionState.value != ConnectionState.CONNECTED) {
            _uiState.update { it.copy(error = "Not connected to PC") }
            return
        }

        val userMessage = ChatMessage(
            id = System.currentTimeMillis().toString(),
            role = MessageRole.USER,
            content = text,
            timestamp = System.currentTimeMillis()
        )
        _messages.update { it + userMessage }
        _uiState.update { it.copy(isLoading = true, error = null, lastFailedMessage = null) }

        viewModelScope.launch {
            val result = aiCommands.chat(
                message = text,
                conversationId = _uiState.value.conversationId,
                model = _uiState.value.selectedModel,
                temperature = _uiState.value.temperature
            )

            if (result.isSuccess) {
                val response = result.getOrNull()
                if (response != null) {
                    val assistantMessage = ChatMessage(
                        id = "${System.currentTimeMillis()}-assistant",
                        role = MessageRole.ASSISTANT,
                        content = response.reply,
                        timestamp = System.currentTimeMillis(),
                        model = response.model,
                        tokenUsage = response.tokens
                    )
                    _messages.update { it + assistantMessage }
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            conversationId = response.conversationId,
                            totalTokens = (it.totalTokens ?: 0) + (response.tokens?.total ?: 0)
                        )
                    }
                } else {
                    _uiState.update { it.copy(isLoading = false, error = "Empty response") }
                }
            } else {
                val errorMsg = result.exceptionOrNull()?.message ?: "Send failed"
                Timber.e(result.exceptionOrNull(), "Chat failed")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        error = errorMsg,
                        lastFailedMessage = text
                    )
                }
            }
        }
    }

    fun retryLastMessage() {
        val last = _uiState.value.lastFailedMessage ?: return
        sendMessage(last)
    }

    fun selectModel(model: String) {
        _uiState.update { it.copy(selectedModel = model) }
    }

    fun setTemperature(temperature: Float) {
        _uiState.update { it.copy(temperature = temperature.coerceIn(0f, 2f)) }
    }

    fun clearConversation() {
        _messages.value = emptyList()
        _uiState.update {
            it.copy(
                conversationId = null,
                totalTokens = null,
                error = null,
                lastFailedMessage = null
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}

data class RemoteAIChatUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val conversationId: String? = null,
    val availableModels: List<String> = emptyList(),
    val selectedModel: String? = null,
    val temperature: Float = 0.7f,
    val totalTokens: Int? = null,
    val lastFailedMessage: String? = null
)

data class ChatMessage(
    val id: String,
    val role: MessageRole,
    val content: String,
    val timestamp: Long,
    val model: String? = null,
    val tokenUsage: TokenUsage? = null
)

enum class MessageRole {
    USER,
    ASSISTANT,
    SYSTEM
}
