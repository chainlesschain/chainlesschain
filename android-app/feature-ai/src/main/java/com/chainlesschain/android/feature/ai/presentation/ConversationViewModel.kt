package com.chainlesschain.android.feature.ai.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.ai.data.rag.RAGRetriever
import com.chainlesschain.android.feature.ai.data.repository.ConversationRepository
import com.chainlesschain.android.feature.ai.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 对话视图模型
 *
 * 管理AI对话状态和流式响应
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    private val repository: ConversationRepository,
    private val ragRetriever: RAGRetriever
) : ViewModel() {

    // UI状态
    private val _uiState = MutableStateFlow(ConversationUiState())
    val uiState: StateFlow<ConversationUiState> = _uiState.asStateFlow()

    // 对话列表
    val conversations: Flow<List<Conversation>> = repository.getAllConversations()

    // 当前对话
    private val _currentConversation = MutableStateFlow<Conversation?>(null)
    val currentConversation: StateFlow<Conversation?> = _currentConversation.asStateFlow()

    // 消息列表
    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages.asStateFlow()

    // 流式响应内容
    private val _streamingContent = MutableStateFlow("")
    val streamingContent: StateFlow<String> = _streamingContent.asStateFlow()

    /**
     * 加载对话
     */
    fun loadConversation(id: String) {
        viewModelScope.launch {
            repository.getConversationById(id).collect { conversation ->
                _currentConversation.value = conversation
            }
        }

        viewModelScope.launch {
            repository.getMessages(id).collect { messageList ->
                _messages.value = messageList
            }
        }
    }

    /**
     * 创建新对话
     */
    fun createConversation(title: String, model: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            when (val result = repository.createConversation(title, model)) {
                is Result.Success -> {
                    _currentConversation.value = result.data
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            operationSuccess = true
                        )
                    }
                }
                is Result.Error -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            error = result.message ?: "创建失败"
                        )
                    }
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * 发送消息（带RAG增强）
     */
    fun sendMessage(
        content: String,
        enableRAG: Boolean = true
    ) {
        val conversation = _currentConversation.value ?: return

        if (content.isBlank()) {
            _uiState.update { it.copy(error = "消息不能为空") }
            return
        }

        viewModelScope.launch {
            try {
                _uiState.update { it.copy(isSending = true, streamingContent = "") }
                _streamingContent.value = ""

                // 添加用户消息
                val userMessageResult = repository.addUserMessage(
                    conversationId = conversation.id,
                    content = content
                )

                if (userMessageResult.isError) {
                    _uiState.update {
                        it.copy(
                            isSending = false,
                            error = "添加消息失败"
                        )
                    }
                    return@launch
                }

                // 构建RAG上下文
                val ragContext = if (enableRAG) {
                    ragRetriever.buildContext(content, topK = 3)
                } else {
                    ""
                }

                // 准备消息历史（包含RAG上下文）
                val messageHistory = _messages.value.toMutableList()

                // 如果有RAG上下文，添加系统消息
                if (ragContext.isNotEmpty()) {
                    messageHistory.add(
                        Message(
                            id = "rag-context",
                            conversationId = conversation.id,
                            role = MessageRole.SYSTEM,
                            content = ragContext,
                            createdAt = System.currentTimeMillis()
                        )
                    )
                }

                // 添加当前用户消息
                messageHistory.add(userMessageResult.getOrNull()!!)

                // 流式获取AI响应
                val provider = getProviderFromModel(conversation.model)
                val apiKey = _uiState.value.currentApiKey

                var fullResponse = ""

                repository.sendMessageStream(
                    conversationId = conversation.id,
                    messages = messageHistory,
                    model = conversation.model,
                    provider = provider,
                    apiKey = apiKey
                ).collect { chunk ->
                    if (chunk.error != null) {
                        _uiState.update {
                            it.copy(
                                isSending = false,
                                error = chunk.error
                            )
                        }
                        return@collect
                    }

                    fullResponse += chunk.content
                    _streamingContent.value = fullResponse

                    if (chunk.isDone) {
                        // 保存AI响应
                        repository.saveAssistantMessage(
                            conversationId = conversation.id,
                            content = fullResponse
                        )

                        _uiState.update {
                            it.copy(
                                isSending = false,
                                streamingContent = ""
                            )
                        }
                        _streamingContent.value = ""
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isSending = false,
                        error = e.message ?: "发送失败"
                    )
                }
            }
        }
    }

    /**
     * 删除对话
     */
    fun deleteConversation(id: String) {
        viewModelScope.launch {
            when (repository.deleteConversation(id)) {
                is Result.Success -> {
                    _uiState.update {
                        it.copy(operationSuccess = true)
                    }
                }
                is Result.Error -> {
                    _uiState.update {
                        it.copy(error = "删除失败")
                    }
                }
                is Result.Loading -> {}
            }
        }
    }

    /**
     * 切换置顶状态
     */
    fun togglePinned(id: String) {
        viewModelScope.launch {
            repository.togglePinned(id)
        }
    }

    /**
     * 设置当前模型
     */
    fun setCurrentModel(model: LLMModel) {
        _uiState.update { it.copy(currentModel = model) }
    }

    /**
     * 设置API Key
     */
    fun setApiKey(apiKey: String) {
        _uiState.update { it.copy(currentApiKey = apiKey) }
    }

    /**
     * 检查LLM可用性
     */
    fun checkLLMAvailability(provider: LLMProvider, apiKey: String? = null) {
        viewModelScope.launch {
            val available = repository.checkLLMAvailability(provider, apiKey)
            _uiState.update {
                it.copy(llmAvailable = available)
            }
        }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 清除成功消息
     */
    fun clearSuccess() {
        _uiState.update { it.copy(operationSuccess = false) }
    }

    /**
     * 从模型名称推断提供商
     */
    private fun getProviderFromModel(model: String): LLMProvider {
        return when {
            model.startsWith("gpt") -> LLMProvider.OPENAI
            model.startsWith("deepseek") -> LLMProvider.DEEPSEEK
            model.contains("/") || model.contains(":") -> LLMProvider.OLLAMA
            else -> LLMProvider.CUSTOM
        }
    }
}

/**
 * 对话UI状态
 */
data class ConversationUiState(
    val isLoading: Boolean = false,
    val isSending: Boolean = false,
    val error: String? = null,
    val operationSuccess: Boolean = false,
    val streamingContent: String = "",
    val currentModel: LLMModel? = null,
    val currentApiKey: String? = null,
    val llmAvailable: Boolean = false
)
