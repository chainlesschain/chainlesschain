package com.chainlesschain.android.feature.ai.domain.model

/**
 * AI对话会话领域模型
 */
data class Conversation(
    val id: String,
    val title: String,
    val model: String,
    val createdAt: Long,
    val updatedAt: Long,
    val messageCount: Int = 0,
    val isPinned: Boolean = false
)

/**
 * AI对话消息领域模型
 */
data class Message(
    val id: String,
    val conversationId: String,
    val role: MessageRole,
    val content: String,
    val createdAt: Long,
    val tokenCount: Int? = null,
    val isStreaming: Boolean = false  // 标记是否正在流式输出
)

/**
 * 消息角色枚举
 */
enum class MessageRole(val value: String) {
    USER("user"),
    ASSISTANT("assistant"),
    SYSTEM("system");

    companion object {
        fun fromValue(value: String): MessageRole {
            return entries.find { it.value == value } ?: USER
        }
    }
}

/**
 * LLM模型配置
 */
data class LLMModel(
    val id: String,
    val name: String,
    val provider: LLMProvider,
    val maxTokens: Int = 4096,
    val temperature: Float = 0.7f,
    val apiEndpoint: String? = null,
    val apiKey: String? = null
)

/**
 * LLM提供商枚举
 */
enum class LLMProvider(val displayName: String) {
    OPENAI("OpenAI"),
    DEEPSEEK("DeepSeek"),
    OLLAMA("Ollama (本地)"),
    CUSTOM("自定义");

    companion object {
        val DEFAULT_MODELS = mapOf(
            OPENAI to listOf(
                LLMModel("gpt-4", "GPT-4", OPENAI, 8192),
                LLMModel("gpt-3.5-turbo", "GPT-3.5 Turbo", OPENAI, 4096)
            ),
            DEEPSEEK to listOf(
                LLMModel("deepseek-chat", "DeepSeek Chat", DEEPSEEK, 32768),
                LLMModel("deepseek-coder", "DeepSeek Coder", DEEPSEEK, 16384)
            ),
            OLLAMA to listOf(
                LLMModel("qwen2:7b", "Qwen2 7B", OLLAMA, 8192),
                LLMModel("llama3:8b", "Llama 3 8B", OLLAMA, 8192)
            )
        )
    }
}

/**
 * 流式响应块
 */
data class StreamChunk(
    val content: String,
    val isDone: Boolean = false,
    val error: String? = null
)
