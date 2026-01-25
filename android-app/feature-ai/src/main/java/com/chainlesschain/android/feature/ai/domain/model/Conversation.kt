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
    CLAUDE("Claude (Anthropic)"),
    GEMINI("Gemini (Google)"),
    QWEN("通义千问 (阿里云)"),
    ERNIE("文心一言 (百度)"),
    CHATGLM("智谱AI (ChatGLM)"),
    MOONSHOT("月之暗面 (Kimi)"),
    SPARK("讯飞星火"),
    DOUBAO("豆包 (火山引擎)"),
    OLLAMA("Ollama (本地)"),
    CUSTOM("自定义");

    companion object {
        val DEFAULT_MODELS = mapOf(
            OPENAI to listOf(
                LLMModel("gpt-4o", "GPT-4o", OPENAI, 128000),
                LLMModel("gpt-4o-mini", "GPT-4o Mini", OPENAI, 128000),
                LLMModel("gpt-3.5-turbo", "GPT-3.5 Turbo", OPENAI, 16385)
            ),
            DEEPSEEK to listOf(
                LLMModel("deepseek-chat", "DeepSeek Chat", DEEPSEEK, 64000),
                LLMModel("deepseek-coder", "DeepSeek Coder", DEEPSEEK, 64000)
            ),
            CLAUDE to listOf(
                LLMModel("claude-3-opus-20240229", "Claude 3 Opus", CLAUDE, 200000),
                LLMModel("claude-3-sonnet-20240229", "Claude 3 Sonnet", CLAUDE, 200000),
                LLMModel("claude-3-haiku-20240307", "Claude 3 Haiku", CLAUDE, 200000)
            ),
            GEMINI to listOf(
                LLMModel("gemini-pro", "Gemini Pro", GEMINI, 32768),
                LLMModel("gemini-pro-vision", "Gemini Pro Vision", GEMINI, 16384)
            ),
            QWEN to listOf(
                LLMModel("qwen-max", "通义千问Max", QWEN, 8000),
                LLMModel("qwen-plus", "通义千问Plus", QWEN, 32000),
                LLMModel("qwen-turbo", "通义千问Turbo", QWEN, 8000)
            ),
            ERNIE to listOf(
                LLMModel("ernie-bot-4", "文心一言 4.0", ERNIE, 8192),
                LLMModel("ernie-bot-turbo", "文心一言 Turbo", ERNIE, 8192)
            ),
            CHATGLM to listOf(
                LLMModel("glm-4", "GLM-4", CHATGLM, 128000),
                LLMModel("glm-3-turbo", "GLM-3 Turbo", CHATGLM, 128000)
            ),
            MOONSHOT to listOf(
                LLMModel("moonshot-v1-8k", "Kimi 8K", MOONSHOT, 8192),
                LLMModel("moonshot-v1-32k", "Kimi 32K", MOONSHOT, 32768),
                LLMModel("moonshot-v1-128k", "Kimi 128K", MOONSHOT, 131072)
            ),
            SPARK to listOf(
                LLMModel("spark-v3.5", "星火 v3.5", SPARK, 8192),
                LLMModel("spark-v3.0", "星火 v3.0", SPARK, 8192)
            ),
            DOUBAO to listOf(
                LLMModel("doubao-seed-1-6-251015", "豆包 Seed 1.6", DOUBAO, 256000),
                LLMModel("doubao-seed-1-6-flash-250828", "豆包 Seed 1.6 快速版", DOUBAO, 256000),
                LLMModel("doubao-pro-32k-240515", "豆包 Pro 32K", DOUBAO, 32000),
                LLMModel("doubao-lite-32k-240515", "豆包 Lite 32K", DOUBAO, 32000)
            ),
            OLLAMA to listOf(
                LLMModel("qwen2:7b", "Qwen2 7B", OLLAMA, 8192),
                LLMModel("llama3:8b", "Llama 3 8B", OLLAMA, 8192),
                LLMModel("deepseek-coder:6.7b", "DeepSeek Coder 6.7B", OLLAMA, 16384),
                LLMModel("gemma:7b", "Gemma 7B", OLLAMA, 8192)
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
