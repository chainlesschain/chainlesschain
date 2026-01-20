package com.chainlesschain.android.feature.ai.data.llm

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.flow.Flow

/**
 * LLM适配器接口
 *
 * 定义统一的LLM API调用接口
 */
interface LLMAdapter {
    /**
     * 流式对话
     *
     * @param messages 历史消息列表
     * @param model 模型ID
     * @param temperature 温度参数 (0.0-2.0)
     * @param maxTokens 最大令牌数
     * @return 流式响应块Flow
     */
    fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float = 0.7f,
        maxTokens: Int = 4096
    ): Flow<StreamChunk>

    /**
     * 非流式对话
     *
     * @param messages 历史消息列表
     * @param model 模型ID
     * @param temperature 温度参数
     * @param maxTokens 最大令牌数
     * @return 完整响应内容
     */
    suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float = 0.7f,
        maxTokens: Int = 4096
    ): String

    /**
     * 检查API可用性
     */
    suspend fun checkAvailability(): Boolean
}

/**
 * OpenAI API请求体
 */
data class OpenAIChatRequest(
    val model: String,
    val messages: List<OpenAIMessage>,
    val temperature: Float = 0.7f,
    val max_tokens: Int = 4096,
    val stream: Boolean = false
)

data class OpenAIMessage(
    val role: String,
    val content: String
)

/**
 * OpenAI API响应
 */
data class OpenAIChatResponse(
    val id: String,
    val choices: List<OpenAIChoice>,
    val usage: OpenAIUsage?
)

data class OpenAIChoice(
    val message: OpenAIMessage,
    val finish_reason: String?
)

data class OpenAIUsage(
    val prompt_tokens: Int,
    val completion_tokens: Int,
    val total_tokens: Int
)

/**
 * OpenAI流式响应
 */
data class OpenAIStreamResponse(
    val id: String,
    val choices: List<OpenAIStreamChoice>
)

data class OpenAIStreamChoice(
    val delta: OpenAIDelta,
    val finish_reason: String?
)

data class OpenAIDelta(
    val role: String?,
    val content: String?
)

/**
 * DeepSeek API请求体（格式与OpenAI兼容）
 */
typealias DeepSeekChatRequest = OpenAIChatRequest
typealias DeepSeekChatResponse = OpenAIChatResponse

/**
 * Ollama API请求体
 */
data class OllamaChatRequest(
    val model: String,
    val messages: List<OllamaMessage>,
    val stream: Boolean = false
)

data class OllamaMessage(
    val role: String,
    val content: String
)

/**
 * Ollama API响应
 */
data class OllamaChatResponse(
    val model: String,
    val message: OllamaMessage,
    val done: Boolean
)
