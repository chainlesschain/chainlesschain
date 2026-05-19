package com.chainlesschain.android.feature.ai.data.llm

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
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

    /**
     * Phase 5.6.3: Anthropic Messages API tool-use 协议接通：
     *  - canonical "parameters" → "input_schema" 重命名
     *  - 多轮 ASSISTANT.toolCalls → `content:[{type:"tool_use",...}]` 内容块
     *  - TOOL 消息 → role=**user** + `[{type:"tool_result",...}]`（与 OpenAI 不同）
     */
    override val supportsToolUse: Boolean = true

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

    override suspend fun chatWithTools(
        messages: List<Message>,
        model: String,
        tools: List<Map<String, Any>>,
        temperature: Float,
        maxTokens: Int
    ): ChatWithToolsResponse = withContext(Dispatchers.IO) {
        val systemMessage = messages.firstOrNull { it.role == MessageRole.SYSTEM }?.content
        val nonSystemMessages = messages.filter { it.role != MessageRole.SYSTEM }
        val claudeMessages = nonSystemMessages.map { msg -> toClaudeMessage(msg) }
        val claudeTools = tools.takeIf { it.isNotEmpty() }?.map { toAnthropicTool(it) }

        val requestBody = buildJsonObject {
            put("model", JsonPrimitive(model))
            put("max_tokens", JsonPrimitive(maxTokens))
            put("temperature", JsonPrimitive(temperature))
            systemMessage?.let { put("system", JsonPrimitive(it)) }
            put("messages", JsonArray(claudeMessages))
            claudeTools?.let { put("tools", JsonArray(it)) }
            put("stream", JsonPrimitive(false))
        }

        val request = Request.Builder()
            .url("$baseUrl/v1/messages")
            .post(json.encodeToString(JsonElement.serializer(), requestBody)
                .toRequestBody("application/json".toMediaType()))
            .addHeader("x-api-key", apiKey)
            .addHeader("anthropic-version", "2023-06-01")
            .addHeader("Content-Type", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("Claude API错误: ${response.code}")
            }
            val raw = response.body?.string() ?: throw Exception("响应为空")
            parseAnthropicResponse(raw)
        }
    }

    /** canonical `{name, description, parameters}` → Anthropic `{name, description, input_schema}`. */
    internal fun toAnthropicTool(canonical: Map<String, Any>): JsonElement = buildJsonObject {
        canonical["name"]?.let { put("name", JsonPrimitive(it.toString())) }
        canonical["description"]?.let { put("description", JsonPrimitive(it.toString())) }
        val schema = canonical["parameters"] ?: canonical["input_schema"]
        if (schema != null) put("input_schema", anyToJsonElement(schema))
    }

    /** Domain Message → Anthropic message object. TOOL role becomes role=user with tool_result block. */
    internal fun toClaudeMessage(msg: Message): JsonObject = buildJsonObject {
        when (msg.role) {
            MessageRole.USER -> {
                put("role", JsonPrimitive("user"))
                put("content", JsonPrimitive(msg.content))
            }
            MessageRole.ASSISTANT -> {
                put("role", JsonPrimitive("assistant"))
                val calls = msg.toolCalls
                if (calls.isNullOrEmpty()) {
                    put("content", JsonPrimitive(msg.content))
                } else {
                    put("content", buildJsonArray {
                        if (msg.content.isNotBlank() && !msg.content.startsWith("[tool_call ")) {
                            add(buildJsonObject {
                                put("type", JsonPrimitive("text"))
                                put("text", JsonPrimitive(msg.content))
                            })
                        }
                        calls.forEach { tc ->
                            add(buildJsonObject {
                                put("type", JsonPrimitive("tool_use"))
                                put("id", JsonPrimitive(tc.id))
                                put("name", JsonPrimitive(tc.name))
                                put("input", mapToJsonElement(tc.arguments as Map<String, Any?>))
                            })
                        }
                    })
                }
            }
            MessageRole.TOOL -> {
                put("role", JsonPrimitive("user"))
                put("content", buildJsonArray {
                    add(buildJsonObject {
                        put("type", JsonPrimitive("tool_result"))
                        put("tool_use_id", JsonPrimitive(msg.toolCallId ?: ""))
                        put("content", JsonPrimitive(msg.content))
                    })
                })
            }
            MessageRole.SYSTEM -> {
                put("role", JsonPrimitive("user"))
                put("content", JsonPrimitive(msg.content))
            }
        }
    }

    internal fun parseAnthropicResponse(rawBody: String): ChatWithToolsResponse {
        val obj = json.parseToJsonElement(rawBody).jsonObject
        val stopReason = obj["stop_reason"]?.jsonPrimitive?.contentOrNull()
        val contentArray = obj["content"]?.jsonArray ?: JsonArray(emptyList())

        val textBuilder = StringBuilder()
        val toolCalls = mutableListOf<ToolCall>()
        for (block in contentArray) {
            val blockObj = block.jsonObject
            when (blockObj["type"]?.jsonPrimitive?.contentOrNull()) {
                "text" -> blockObj["text"]?.jsonPrimitive?.contentOrNull()?.let { textBuilder.append(it) }
                "tool_use" -> {
                    val id = blockObj["id"]?.jsonPrimitive?.contentOrNull() ?: continue
                    val name = blockObj["name"]?.jsonPrimitive?.contentOrNull() ?: continue
                    val inputEl = blockObj["input"] ?: JsonObject(emptyMap())
                    val args = if (inputEl is JsonObject) {
                        inputEl.entries.associate { (k, v) -> k to (jsonElementToAny(v) ?: "") }
                    } else mapOf("input" to (jsonElementToAny(inputEl) ?: ""))
                    toolCalls += ToolCall(id = id, name = name, arguments = args)
                }
                else -> { /* unknown */ }
            }
        }
        return ChatWithToolsResponse(
            content = textBuilder.toString().takeIf { it.isNotEmpty() },
            toolCalls = toolCalls.takeIf { it.isNotEmpty() },
            finishReason = stopReason,
        )
    }

    // ---------------- JSON helpers (Claude-local copies; OpenAIAdapter has its own) ----------------

    internal fun jsonElementToAny(je: JsonElement): Any? = when (je) {
        is JsonNull -> null
        is JsonPrimitive -> when {
            je.isString -> je.content
            else -> je.booleanOrNull
                ?: je.intOrNull
                ?: je.longOrNull
                ?: je.doubleOrNull
                ?: je.content
        }
        is JsonArray -> je.map { jsonElementToAny(it) }
        is JsonObject -> je.entries.associate { (k, v) -> k to jsonElementToAny(v) }
    }

    internal fun mapToJsonElement(m: Map<String, Any?>): JsonElement = buildJsonObject {
        m.forEach { (k, v) -> put(k, anyToJsonElement(v)) }
    }

    private fun anyToJsonElement(v: Any?): JsonElement = when (v) {
        null -> JsonNull
        is JsonElement -> v
        is String -> JsonPrimitive(v)
        is Number -> JsonPrimitive(v)
        is Boolean -> JsonPrimitive(v)
        is Map<*, *> -> {
            @Suppress("UNCHECKED_CAST")
            mapToJsonElement(v as Map<String, Any?>)
        }
        is List<*> -> JsonArray(v.map { anyToJsonElement(it) })
        is Array<*> -> JsonArray(v.map { anyToJsonElement(it) })
        else -> JsonPrimitive(v.toString())
    }

    private fun JsonPrimitive.contentOrNull(): String? = if (this is JsonNull) null else content

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

    /** Doubao Volcengine Ark API 在 wire 层与 OpenAI 完全兼容（含 tool_calls 协议）。Phase 5.6.2。 */
    override val supportsToolUse: Boolean = true

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

    override suspend fun chatWithTools(
        messages: List<Message>,
        model: String,
        tools: List<Map<String, Any>>,
        temperature: Float,
        maxTokens: Int
    ): ChatWithToolsResponse {
        return openAIAdapter.chatWithTools(messages, model, tools, temperature, maxTokens)
    }

    override suspend fun checkAvailability(): Boolean {
        return openAIAdapter.checkAvailability()
    }

    /** Visible for testing — verifies delegate wiring. */
    internal val innerOpenAIAdapter: OpenAIAdapter get() = openAIAdapter
}
