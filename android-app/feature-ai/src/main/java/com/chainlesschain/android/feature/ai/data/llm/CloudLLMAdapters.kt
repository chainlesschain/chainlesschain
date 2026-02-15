package com.chainlesschain.android.feature.ai.data.llm

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
/**
 * Claude (Anthropic) API适配器
 *
 * 官方文档: https://docs.anthropic.com/claude/reference/
 * 支持模型: claude-3-opus-20240229, claude-3-sonnet-20240229, claude-3-haiku-20240307
 */
class ClaudeAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://api.anthropic.com"
) : LLMAdapter {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    @Serializable
    data class ClaudeRequest(
        val model: String,
        val messages: List<ClaudeMessage>,
        val max_tokens: Int = 4096,
        val temperature: Float = 0.7f,
        val system: String? = null,
        val stream: Boolean = false
    )

    @Serializable
    data class ClaudeMessage(
        val role: String,
        val content: String
    )

    @Serializable
    data class ClaudeResponse(
        val id: String,
        val content: List<ContentBlock>,
        val usage: Usage? = null
    )

    @Serializable
    data class ContentBlock(
        val type: String,
        val text: String? = null
    )

    @Serializable
    data class Usage(
        val input_tokens: Int,
        val output_tokens: Int
    )

    @Serializable
    data class ClaudeStreamResponse(
        val type: String,
        val delta: Delta? = null,
        val content_block: ContentBlock? = null
    )

    @Serializable
    data class Delta(
        val type: String? = null,
        val text: String? = null,
        val stop_reason: String? = null
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> = flow {
        try {
            // Claude要求system消息独立
            val systemMessage = messages.firstOrNull { it.role == MessageRole.SYSTEM }?.content
            val userMessages = messages.filter { it.role != MessageRole.SYSTEM }

            val requestBody = ClaudeRequest(
                model = model,
                messages = userMessages.map { msg ->
                    ClaudeMessage(
                        role = if (msg.role == MessageRole.USER) "user" else "assistant",
                        content = msg.content
                    )
                },
                max_tokens = maxTokens,
                temperature = temperature,
                system = systemMessage,
                stream = true
            )

            val request = Request.Builder()
                .url("$baseUrl/v1/messages")
                .post(json.encodeToString(requestBody).toRequestBody("application/json".toMediaType()))
                .addHeader("x-api-key", apiKey)
                .addHeader("anthropic-version", "2023-06-01")
                .addHeader("Content-Type", "application/json")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    emit(StreamChunk("", isDone = true, error = "Claude API错误: ${response.code}"))
                    return@flow
                }

                response.body?.source()?.let { source ->
                    while (!source.exhausted()) {
                        val line = source.readUtf8Line() ?: continue

                        when {
                            line.startsWith("data: ") -> {
                                val data = line.substring(6).trim()
                                if (data == "[DONE]") {
                                    emit(StreamChunk("", isDone = true))
                                    break
                                }

                                try {
                                    val streamResponse = json.decodeFromString<ClaudeStreamResponse>(data)
                                    val content = streamResponse.delta?.text ?: streamResponse.content_block?.text
                                    val isDone = streamResponse.delta?.stop_reason != null

                                    if (content != null) {
                                        emit(StreamChunk(content, isDone = isDone))
                                    }
                                } catch (e: Exception) {
                                    // 忽略解析错误
                                }
                            }
                            line.startsWith("event: message_stop") -> {
                                emit(StreamChunk("", isDone = true))
                                break
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            emit(StreamChunk("", isDone = true, error = e.message ?: "Claude连接失败"))
        }
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        val systemMessage = messages.firstOrNull { it.role == MessageRole.SYSTEM }?.content
        val userMessages = messages.filter { it.role != MessageRole.SYSTEM }

        val requestBody = ClaudeRequest(
            model = model,
            messages = userMessages.map { msg ->
                ClaudeMessage(
                    role = if (msg.role == MessageRole.USER) "user" else "assistant",
                    content = msg.content
                )
            },
            max_tokens = maxTokens,
            temperature = temperature,
            system = systemMessage,
            stream = false
        )

        val request = Request.Builder()
            .url("$baseUrl/v1/messages")
            .post(json.encodeToString(requestBody).toRequestBody("application/json".toMediaType()))
            .addHeader("x-api-key", apiKey)
            .addHeader("anthropic-version", "2023-06-01")
            .addHeader("Content-Type", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("Claude API错误: ${response.code}")
            }

            val responseBody = response.body?.string() ?: throw Exception("响应为空")
            val chatResponse = json.decodeFromString<ClaudeResponse>(responseBody)

            return chatResponse.content.firstOrNull { it.type == "text" }?.text
                ?: throw Exception("无效响应")
        }
    }

    override suspend fun checkAvailability(): Boolean {
        return try {
            val request = Request.Builder()
                .url("$baseUrl/v1/messages")
                .post("{}".toRequestBody("application/json".toMediaType()))
                .addHeader("x-api-key", apiKey)
                .addHeader("anthropic-version", "2023-06-01")
                .build()

            client.newCall(request).execute().use { response ->
                // 401表示API Key无效，400表示请求格式错误但API可达
                response.code in 400..499
            }
        } catch (e: Exception) {
            false
        }
    }
}

/**
 * Gemini (Google) API适配器
 *
 * 官方文档: https://ai.google.dev/docs
 * 支持模型: gemini-pro, gemini-pro-vision
 * 使用OpenAI兼容格式 (通过OpenAI SDK proxy)
 */
class GeminiAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://generativelanguage.googleapis.com/v1beta"
) : LLMAdapter {

    private val openAIAdapter = OpenAIAdapter(
        apiKey = apiKey,
        baseUrl = baseUrl
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> {
        return openAIAdapter.streamChat(messages, model, temperature, maxTokens)
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        return openAIAdapter.chat(messages, model, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }
}

/**
 * Qwen (通义千问-阿里云) API适配器
 *
 * 官方文档: https://help.aliyun.com/zh/dashscope/
 * 支持模型: qwen-turbo, qwen-plus, qwen-max
 * API格式与OpenAI兼容
 */
class QwenAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://dashscope.aliyuncs.com/compatible-mode/v1"
) : LLMAdapter {

    private val openAIAdapter = OpenAIAdapter(
        apiKey = apiKey,
        baseUrl = baseUrl
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> {
        return openAIAdapter.streamChat(messages, model, temperature, maxTokens)
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        return openAIAdapter.chat(messages, model, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }
}

/**
 * Ernie (文心一言-百度) API适配器
 *
 * 官方文档: https://cloud.baidu.com/doc/WENXINWORKSHOP/
 * 支持模型: ernie-bot-4, ernie-bot-turbo
 * API格式与OpenAI兼容
 */
class ErnieAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop"
) : LLMAdapter {

    private val openAIAdapter = OpenAIAdapter(
        apiKey = apiKey,
        baseUrl = baseUrl
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> {
        return openAIAdapter.streamChat(messages, model, temperature, maxTokens)
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        return openAIAdapter.chat(messages, model, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }
}

/**
 * ChatGLM (智谱AI) API适配器
 *
 * 官方文档: https://open.bigmodel.cn/dev/api
 * 支持模型: glm-4, glm-3-turbo
 * API格式与OpenAI兼容
 */
class ChatGLMAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://open.bigmodel.cn/api/paas/v4"
) : LLMAdapter {

    private val openAIAdapter = OpenAIAdapter(
        apiKey = apiKey,
        baseUrl = baseUrl
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> {
        return openAIAdapter.streamChat(messages, model, temperature, maxTokens)
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        return openAIAdapter.chat(messages, model, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }
}

/**
 * Moonshot (月之暗面Kimi) API适配器
 *
 * 官方文档: https://platform.moonshot.cn/docs
 * 支持模型: moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k
 * API格式与OpenAI兼容
 */
class MoonshotAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://api.moonshot.cn/v1"
) : LLMAdapter {

    private val openAIAdapter = OpenAIAdapter(
        apiKey = apiKey,
        baseUrl = baseUrl
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> {
        return openAIAdapter.streamChat(messages, model, temperature, maxTokens)
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        return openAIAdapter.chat(messages, model, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }
}

/**
 * Spark (讯飞星火) API适配器
 *
 * 官方文档: https://www.xfyun.cn/doc/spark/
 * 支持模型: spark-v3.5, spark-v3.0
 * API格式与OpenAI兼容
 */
class SparkAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://spark-api-open.xf-yun.com/v1"
) : LLMAdapter {

    private val openAIAdapter = OpenAIAdapter(
        apiKey = apiKey,
        baseUrl = baseUrl
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> {
        return openAIAdapter.streamChat(messages, model, temperature, maxTokens)
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        return openAIAdapter.chat(messages, model, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }
}

/**
 * Doubao (豆包-火山引擎) API适配器
 *
 * 官方文档: https://www.volcengine.com/docs/82379/
 * 支持模型: doubao-seed-1-8-251228 (推荐), doubao-seed-1-6-251015, doubao-pro-32k-240515
 * API格式与OpenAI兼容
 */
class DoubaoAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://ark.cn-beijing.volces.com/api/v3"
) : LLMAdapter {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val openAIAdapter = OpenAIAdapter(
        apiKey = apiKey,
        baseUrl = baseUrl
    )

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> {
        return openAIAdapter.streamChat(messages, model, temperature, maxTokens)
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        return openAIAdapter.chat(messages, model, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }
}
