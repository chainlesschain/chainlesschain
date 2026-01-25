package com.chainlesschain.android.presentation.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.chainlesschain.android.core.security.SecurePreferences
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.di.LLMAdapterFactory
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import javax.inject.Inject

/**
 * LLM测试对话ViewModel
 *
 * 功能：
 * 1. 管理测试对话消息
 * 2. 发送消息并处理流式响应
 * 3. 性能统计（响应时间、Token统计）
 * 4. RAG功能测试
 */
@HiltViewModel
class LLMTestChatViewModel @Inject constructor(
    private val llmAdapterFactory: LLMAdapterFactory,
    private val securePreferences: SecurePreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow(LLMTestChatUiState())
    val uiState: StateFlow<LLMTestChatUiState> = _uiState.asStateFlow()

    private var currentAdapter: LLMAdapter? = null

    /**
     * 设置提供商
     */
    fun setProvider(provider: LLMProvider) {
        _uiState.update { it.copy(provider = provider) }

        // 加载API密钥并创建adapter
        viewModelScope.launch {
            try {
                val apiKey = when (provider) {
                    LLMProvider.OPENAI -> securePreferences.getOpenAIApiKey()
                    LLMProvider.DEEPSEEK -> securePreferences.getDeepSeekApiKey()
                    LLMProvider.OLLAMA -> null
                    else -> securePreferences.getApiKeyForProvider(provider.name)
                }

                currentAdapter = if (provider == LLMProvider.OLLAMA) {
                    val baseUrl = securePreferences.getOllamaBaseUrl() ?: "http://localhost:11434"
                    llmAdapterFactory.createOllamaAdapter(baseUrl)
                } else {
                    apiKey?.let { llmAdapterFactory.createAdapter(provider, it) }
                }

                // 获取当前模型
                val model = getDefaultModel(provider)
                _uiState.update { it.copy(currentModel = model) }

                if (currentAdapter == null) {
                    _uiState.update { it.copy(
                        error = "未配置${provider.displayName}的API密钥，请先在AI配置中设置"
                    )}
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(
                    error = "初始化失败: ${e.message}"
                )}
            }
        }
    }

    /**
     * 发送消息
     */
    fun sendMessage(content: String, enableRAG: Boolean) {
        if (currentAdapter == null) {
            _uiState.update { it.copy(
                error = "LLM适配器未初始化，请检查API密钥配置"
            )}
            return
        }

        viewModelScope.launch {
            val startTime = System.currentTimeMillis()

            try {
                // 添加用户消息
                val userMessage = Message(
                    id = UUID.randomUUID().toString(),
                    conversationId = "test",
                    role = MessageRole.USER,
                    content = content,
                    createdAt = System.currentTimeMillis(),
                    tokenCount = estimateTokenCount(content)
                )

                _uiState.update { state ->
                    state.copy(
                        messages = state.messages + userMessage,
                        isLoading = true,
                        streamingContent = "",
                        error = null
                    )
                }

                // 构建对话历史
                val conversationHistory = _uiState.value.messages

                // 发送消息并收集流式响应
                var fullResponse = ""
                withContext(Dispatchers.IO) {
                    currentAdapter?.streamChat(
                        messages = conversationHistory,
                        model = _uiState.value.currentModel,
                        temperature = 0.7f,
                        maxTokens = 2048
                    )?.catch { e ->
                        _uiState.update { it.copy(
                            isLoading = false,
                            streamingContent = "",
                            error = "发送失败: ${e.message}"
                        )}
                    }?.collect { chunk ->
                        fullResponse += chunk.content
                        _uiState.update { it.copy(
                            streamingContent = fullResponse
                        )}
                    }
                }

                // 计算响应时间
                val responseTime = System.currentTimeMillis() - startTime

                // 添加助手消息
                val assistantMessage = Message(
                    id = UUID.randomUUID().toString(),
                    conversationId = "test",
                    role = MessageRole.ASSISTANT,
                    content = fullResponse,
                    createdAt = System.currentTimeMillis(),
                    tokenCount = estimateTokenCount(fullResponse)
                )

                _uiState.update { state ->
                    val newMessages = state.messages + assistantMessage
                    val totalTokens = newMessages.sumOf { it.tokenCount ?: 0 }

                    state.copy(
                        messages = newMessages,
                        isLoading = false,
                        streamingContent = "",
                        performanceStats = state.performanceStats.copy(
                            lastResponseTime = responseTime,
                            totalTokens = totalTokens,
                            messageCount = newMessages.size,
                            successRate = 100 // 简化版本，实际应该计算成功/失败比例
                        )
                    )
                }
            } catch (e: Exception) {
                _uiState.update { state ->
                    state.copy(
                        isLoading = false,
                        streamingContent = "",
                        error = "发送失败: ${e.message}",
                        performanceStats = state.performanceStats.copy(
                            successRate = calculateSuccessRate(state.messages.size, 1)
                        )
                    )
                }
            }
        }
    }

    /**
     * 清空消息
     */
    fun clearMessages() {
        _uiState.update { it.copy(
            messages = emptyList(),
            streamingContent = "",
            error = null,
            performanceStats = PerformanceStats()
        )}
    }

    /**
     * 切换统计显示
     */
    fun toggleStats() {
        _uiState.update { it.copy(showStats = !it.showStats) }
    }

    /**
     * 切换RAG
     */
    fun toggleRAG() {
        _uiState.update { it.copy(ragEnabled = !it.ragEnabled) }
    }

    /**
     * 清除错误
     */
    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    /**
     * 获取默认模型
     */
    private fun getDefaultModel(provider: LLMProvider): String {
        return when (provider) {
            LLMProvider.OPENAI -> "gpt-3.5-turbo"
            LLMProvider.DEEPSEEK -> "deepseek-chat"
            LLMProvider.CLAUDE -> "claude-3-sonnet-20240229"
            LLMProvider.GEMINI -> "gemini-pro"
            LLMProvider.QWEN -> "qwen-max"
            LLMProvider.ERNIE -> "ernie-bot-turbo"
            LLMProvider.CHATGLM -> "glm-4"
            LLMProvider.MOONSHOT -> "moonshot-v1-8k"
            LLMProvider.SPARK -> "spark-v3.5"
            LLMProvider.DOUBAO -> "doubao-pro-32k"
            LLMProvider.OLLAMA -> "qwen2:7b"
            LLMProvider.CUSTOM -> "custom-model"
        }
    }

    /**
     * 估算Token数量（简化版本）
     * 实际应该使用tokenizer，这里使用字符数/4作为估算
     */
    private fun estimateTokenCount(text: String): Int {
        // 中文按每个字符1个token，英文按4个字符1个token
        val chineseChars = text.count { it.code > 127 }
        val englishChars = text.length - chineseChars
        return chineseChars + (englishChars / 4)
    }

    /**
     * 计算成功率
     */
    private fun calculateSuccessRate(totalMessages: Int, failedMessages: Int): Int {
        if (totalMessages == 0) return 100
        return ((totalMessages - failedMessages) * 100 / totalMessages)
    }
}

/**
 * LLM测试对话UI状态
 */
data class LLMTestChatUiState(
    val provider: LLMProvider = LLMProvider.DOUBAO,
    val currentModel: String = "",
    val messages: List<Message> = emptyList(),
    val isLoading: Boolean = false,
    val streamingContent: String = "",
    val error: String? = null,
    val ragEnabled: Boolean = false,
    val showStats: Boolean = true,
    val performanceStats: PerformanceStats = PerformanceStats()
)
