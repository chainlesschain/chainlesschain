package com.chainlesschain.android.feature.ai.presentation

import android.content.Context
import timber.log.Timber
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.feature.ai.R
import com.chainlesschain.android.feature.ai.data.rag.RAGRetriever
import com.chainlesschain.android.feature.ai.data.repository.ConversationRepository
import com.chainlesschain.android.feature.ai.domain.model.*
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import androidx.compose.runtime.Immutable
import javax.inject.Inject

/**
 * 对话视图模型
 *
 * 管理AI对话状态和流式响应
 */
@HiltViewModel
class ConversationViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
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

                // 自动加载对应模型的API Key
                conversation?.let {
                    val provider = getProviderFromModel(it.model)
                    loadApiKey(provider)
                }
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
        Timber.tag("ConversationViewModel").d("sendMessage called with content: ${content.take(50)}")

        val conversation = _currentConversation.value
        if (conversation == null) {
            Timber.tag("ConversationViewModel").e("No conversation loaded! Cannot send message.")
            _uiState.update { it.copy(error = "请先创建或选择一个对话") }
            return
        }

        Timber.tag("ConversationViewModel").d("Current conversation: id=${conversation.id}, model=${conversation.model}")

        if (content.isBlank()) {
            Timber.tag("ConversationViewModel").w("Message content is blank")
            _uiState.update { it.copy(error = "消息不能为空") }
            return
        }

        // 检查API Key（非Ollama模型需要）
        val provider = getProviderFromModel(conversation.model)
        Timber.tag("ConversationViewModel").d("Detected provider: $provider for model: ${conversation.model}")

        // 直接从repository获取最新API Key，不依赖uiState缓存
        val apiKey = repository.getApiKey(provider)
        Timber.tag("ConversationViewModel").d("API Key present: ${!apiKey.isNullOrEmpty()}")

        if (provider != LLMProvider.OLLAMA && apiKey.isNullOrEmpty()) {
            Timber.tag("ConversationViewModel").w("API Key missing for provider: $provider")
            _uiState.update {
                it.copy(error = context.getString(R.string.error_api_key_not_configured, provider.displayName))
            }
            return
        }

        viewModelScope.launch {
            try {
                Timber.tag("ConversationViewModel").d("Starting message send process")
                _uiState.update { it.copy(isSending = true) }
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

                // 如果有RAG上下文，添加系统消息（使用唯一ID避免冲突）
                if (ragContext.isNotEmpty()) {
                    messageHistory.add(
                        Message(
                            id = "rag-context-${java.util.UUID.randomUUID()}",
                            conversationId = conversation.id,
                            role = MessageRole.SYSTEM,
                            content = ragContext,
                            createdAt = System.currentTimeMillis()
                        )
                    )
                }

                // 添加当前用户消息
                val userMessage = userMessageResult.getOrNull()
                if (userMessage == null) {
                    _uiState.update {
                        it.copy(
                            isSending = false,
                            error = "娣诲姞娑堟伅澶辫触"
                        )
                    }
                    return@launch
                }
                messageHistory.add(userMessage)

                // 流式获取AI响应
                val provider = getProviderFromModel(conversation.model)
                // 直接从repository获取最新API Key，确保使用最新配置
                val apiKey = repository.getApiKey(provider)

                Timber.tag("ConversationViewModel").d("Calling sendMessageStream with provider=$provider, model=${conversation.model}, messageCount=${messageHistory.size}")

                var fullResponse = ""

                repository.sendMessageStream(
                    conversationId = conversation.id,
                    messages = messageHistory,
                    model = conversation.model,
                    provider = provider,
                    apiKey = apiKey
                ).collect { chunk ->
                    Timber.tag("ConversationViewModel").d("Received chunk: content='${chunk.content.take(50)}', isDone=${chunk.isDone}, error=${chunk.error}")

                    if (chunk.error != null) {
                        Timber.tag("ConversationViewModel").e("Stream error: ${chunk.error}")
                        _uiState.update {
                            it.copy(
                                isSending = false,
                                error = chunk.error
                            )
                        }
                        _streamingContent.value = ""
                        return@collect
                    }

                    fullResponse += chunk.content
                    _streamingContent.value = fullResponse

                    if (chunk.isDone) {
                        Timber.tag("ConversationViewModel").i("Stream complete, total response length: ${fullResponse.length}")
                        // 保存AI响应
                        repository.saveAssistantMessage(
                            conversationId = conversation.id,
                            content = fullResponse
                        )

                        _uiState.update {
                            it.copy(
                                isSending = false
                            )
                        }
                        _streamingContent.value = ""
                    }
                }
                Timber.tag("ConversationViewModel").d("Stream collection completed")
            } catch (e: Exception) {
                Timber.tag("ConversationViewModel").e(e, "Exception in sendMessage")
                val errorMsg = when (e) {
                    is java.net.UnknownHostException -> "网络连接失败，请检查网络设置"
                    is java.net.SocketTimeoutException -> "连接超时，请检查网络或服务地址"
                    is java.net.ConnectException -> "无法连接到AI服务，请检查服务是否启动"
                    is IllegalArgumentException -> e.message ?: "参数错误"
                    else -> "发送失败: ${e.message ?: "未知错误"}"
                }
                _uiState.update {
                    it.copy(
                        isSending = false,
                        error = errorMsg
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

        // 加载该模型对应的API Key
        loadApiKey(model.provider)
    }

    /**
     * 设置API Key（并加密保存）
     */
    fun setApiKey(apiKey: String) {
        val currentModel = _uiState.value.currentModel ?: return

        // 保存到加密存储
        if (apiKey.isNotEmpty()) {
            repository.saveApiKey(currentModel.provider, apiKey)
        }

        // 更新UI状态
        _uiState.update { it.copy(currentApiKey = apiKey) }
    }

    /**
     * 加载API Key（从加密存储）
     */
    fun loadApiKey(provider: LLMProvider) {
        val apiKey = repository.getApiKey(provider)
        _uiState.update { it.copy(currentApiKey = apiKey) }
    }

    /**
     * 获取API Key（从加密存储）
     */
    fun getApiKey(provider: LLMProvider): String? {
        return repository.getApiKey(provider)
    }

    /**
     * 检查是否已保存API Key
     */
    fun hasApiKey(provider: LLMProvider): Boolean {
        return repository.hasApiKey(provider)
    }

    /**
     * 清除API Key
     */
    fun clearApiKey(provider: LLMProvider) {
        repository.clearApiKey(provider)
        _uiState.update { it.copy(currentApiKey = null) }
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
    fun getProviderFromModel(model: String): LLMProvider {
        return when {
            model.startsWith("gpt") -> LLMProvider.OPENAI
            model.startsWith("deepseek") -> LLMProvider.DEEPSEEK
            model.startsWith("doubao") -> LLMProvider.DOUBAO
            model.startsWith("claude") -> LLMProvider.CLAUDE
            model.startsWith("gemini") -> LLMProvider.GEMINI
            model.startsWith("qwen") -> LLMProvider.QWEN
            model.startsWith("ernie") -> LLMProvider.ERNIE
            model.startsWith("glm") -> LLMProvider.CHATGLM
            model.startsWith("moonshot") -> LLMProvider.MOONSHOT
            model.startsWith("spark") -> LLMProvider.SPARK
            model.contains("/") || model.contains(":") -> LLMProvider.OLLAMA
            else -> LLMProvider.CUSTOM
        }
    }
}

/**
 * 对话UI状态
 */
@Immutable
data class ConversationUiState(
    val isLoading: Boolean = false,
    val isSending: Boolean = false,
    val error: String? = null,
    val operationSuccess: Boolean = false,
    val currentModel: LLMModel? = null,
    val currentApiKey: String? = null,
    val llmAvailable: Boolean = false
)
