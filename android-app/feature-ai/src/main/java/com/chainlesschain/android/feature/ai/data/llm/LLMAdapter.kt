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
     * 非流式对话（带函数调用/工具支持）
     *
     * @param messages 历史消息列表
     * @param model 模型ID
     * @param tools OpenAI格式的工具定义列表
     * @param temperature 温度参数
     * @param maxTokens 最大令牌数
     * @return ChatWithToolsResponse，可能包含文本或工具调用
     */
    suspend fun chatWithTools(
        messages: List<Message>,
        model: String,
        tools: List<Map<String, Any>> = emptyList(),
        temperature: Float = 0.7f,
        maxTokens: Int = 4096
    ): ChatWithToolsResponse {
        // Default implementation: ignore tools, return text-only response
        val text = chat(messages, model, temperature, maxTokens)
        return ChatWithToolsResponse(content = text, finishReason = "stop")
    }

    /**
     * 检查API可用性
     */
    suspend fun checkAvailability(): Boolean
}

/**
 * Response from chatWithTools that may contain tool calls.
 */
data class ChatWithToolsResponse(
    val content: String? = null,
    val toolCalls: List<ToolCall>? = null,
    val finishReason: String? = null
) {
    val hasToolCalls: Boolean get() = !toolCalls.isNullOrEmpty()
}

/**
 * A single tool call requested by the LLM.
 */
data class ToolCall(
    val id: String,
    val name: String,
    val arguments: Map<String, Any>
)

/**
 * OpenAI API请求体
 */
@kotlinx.serialization.Serializable
data class OpenAIChatRequest(
    val model: String,
    val messages: List<OpenAIMessage>,
    val temperature: Float = 0.7f,
    val max_tokens: Int = 4096,
    val stream: Boolean = false,
    val tools: List<kotlinx.serialization.json.JsonElement>? = null
)

@kotlinx.serialization.Serializable
data class OpenAIMessage(
    val role: String,
    val content: String? = null,
    val tool_calls: List<OpenAIToolCall>? = null,
    val tool_call_id: String? = null
)

/**
 * OpenAI tool call in response
 */
@kotlinx.serialization.Serializable
data class OpenAIToolCall(
    val id: String,
    val type: String = "function",
    val function: OpenAIFunctionCall
)

@kotlinx.serialization.Serializable
data class OpenAIFunctionCall(
    val name: String,
    val arguments: String  // JSON string of arguments
)

/**
 * OpenAI API响应
 */
@kotlinx.serialization.Serializable
data class OpenAIChatResponse(
    val id: String,
    val choices: List<OpenAIChoice>,
    val usage: OpenAIUsage? = null
)

@kotlinx.serialization.Serializable
data class OpenAIChoice(
    val message: OpenAIResponseMessage,
    val finish_reason: String? = null
)

@kotlinx.serialization.Serializable
data class OpenAIResponseMessage(
    val role: String? = null,
    val content: String? = null,
    val tool_calls: List<OpenAIToolCall>? = null
)

@kotlinx.serialization.Serializable
data class OpenAIUsage(
    val prompt_tokens: Int,
    val completion_tokens: Int,
    val total_tokens: Int
)

/**
 * OpenAI流式响应
 */
@kotlinx.serialization.Serializable
data class OpenAIStreamResponse(
    val id: String,
    val choices: List<OpenAIStreamChoice>
)

@kotlinx.serialization.Serializable
data class OpenAIStreamChoice(
    val delta: OpenAIDelta,
    val finish_reason: String? = null
)

@kotlinx.serialization.Serializable
data class OpenAIDelta(
    val role: String? = null,
    val content: String? = null
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
