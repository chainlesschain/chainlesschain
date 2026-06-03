package com.chainlesschain.android.feature.ai.data.llm

import timber.log.Timber
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
/**
 * OpenAI API适配器
 *
 * 支持GPT-4, GPT-3.5-Turbo等模型
 */
class OpenAIAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://api.openai.com/v1"
) : LLMAdapter {

    /**
     * Phase 5.6.1: chatWithTools 正确接通 OpenAI tools 协议（wrap with type:function +
     * 序列化 Message.toolCalls + 解析嵌套 JSON 参数）。
     */
    override val supportsToolUse: Boolean = true

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    override fun streamChat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): Flow<StreamChunk> = flow {
        try {
            val requestBody = OpenAIChatRequest(
                model = model,
                messages = messages.map { msg -> msg.toOpenAIMessage() },
                temperature = temperature,
                max_tokens = maxTokens,
                stream = true
            )

            val request = Request.Builder()
                .url("$baseUrl/chat/completions")
                .post(json.encodeToString(requestBody).toRequestBody("application/json".toMediaType()))
                .addHeader("Authorization", "Bearer $apiKey")
                .addHeader("Content-Type", "application/json")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    emit(StreamChunk("", isDone = true, error = "API错误: ${response.code}"))
                    return@flow
                }

                response.body?.source()?.let { source ->
                    while (!source.exhausted()) {
                        val line = source.readUtf8Line() ?: continue

                        if (line.startsWith("data: ")) {
                            val data = line.substring(6).trim()

                            if (data == "[DONE]") {
                                emit(StreamChunk("", isDone = true))
                                break
                            }

                            try {
                                val streamResponse = json.decodeFromString<OpenAIStreamResponse>(data)
                                val content = streamResponse.choices.firstOrNull()?.delta?.content
                                val finishReason = streamResponse.choices.firstOrNull()?.finish_reason

                                if (content != null) {
                                    emit(StreamChunk(content, isDone = false))
                                }

                                // 如果有finish_reason，说明流式响应结束
                                if (finishReason != null) {
                                    emit(StreamChunk("", isDone = true))
                                    break
                                }
                            } catch (e: Exception) {
                                // 忽略解析错误，继续处理下一行
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            emit(StreamChunk("", isDone = true, error = e.message ?: "未知错误"))
        }
    }.flowOn(Dispatchers.IO)

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String = withContext(Dispatchers.IO) {
        val requestBody = OpenAIChatRequest(
            model = model,
            messages = messages.map { msg -> msg.toOpenAIMessage() },
            temperature = temperature,
            max_tokens = maxTokens,
            stream = false
        )

        val request = Request.Builder()
            .url("$baseUrl/chat/completions")
            .post(json.encodeToString(requestBody).toRequestBody("application/json".toMediaType()))
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("Content-Type", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("API错误: ${response.code}")
            }

            val responseBody = response.body?.string() ?: throw Exception("响应为空")
            val chatResponse = json.decodeFromString<OpenAIChatResponse>(responseBody)

            chatResponse.choices.firstOrNull()?.message?.content
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
        val toolsJson: List<JsonElement>? = tools.takeIf { it.isNotEmpty() }
            ?.map { wrapAsOpenAITool(it) }

        val requestBody = OpenAIChatRequest(
            model = model,
            messages = messages.map { msg -> msg.toOpenAIMessage() },
            temperature = temperature,
            max_tokens = maxTokens,
            stream = false,
            tools = toolsJson
        )

        val request = Request.Builder()
            .url("$baseUrl/chat/completions")
            .post(json.encodeToString(requestBody).toRequestBody("application/json".toMediaType()))
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("Content-Type", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("API错误: ${response.code}")
            }
            val responseBody = response.body?.string() ?: throw Exception("响应为空")
            val chatResponse = json.decodeFromString<OpenAIChatResponse>(responseBody)
            val choice = chatResponse.choices.firstOrNull() ?: throw Exception("无效响应")
            parseChatChoiceResponse(choice)
        }
    }

    /** Wrap canonical tool descriptor with OpenAI's `{type:"function", function:{...}}` envelope. */
    internal fun wrapAsOpenAITool(canonical: Map<String, Any>): JsonElement = buildJsonObject {
        put("type", JsonPrimitive("function"))
        put("function", mapToJsonElement(canonical))
    }

    /** Parse OpenAI choice into canonical [ChatWithToolsResponse], preserving nested array args. */
    internal fun parseChatChoiceResponse(choice: OpenAIChoice): ChatWithToolsResponse {
        val responseMessage = choice.message
        val toolCallsList = responseMessage.tool_calls
        return if (!toolCallsList.isNullOrEmpty()) {
            ChatWithToolsResponse(
                content = responseMessage.content,
                toolCalls = toolCallsList.map { tc ->
                    ToolCall(
                        id = tc.id,
                        name = tc.function.name,
                        arguments = parseToolArguments(tc.function.arguments),
                    )
                },
                finishReason = choice.finish_reason,
            )
        } else {
            ChatWithToolsResponse(
                content = responseMessage.content,
                finishReason = choice.finish_reason,
            )
        }
    }

    /** Decode tool_call.function.arguments stringified JSON, preserving nested arrays/objects. */
    internal fun parseToolArguments(rawJson: String): Map<String, Any> = try {
        val obj = json.parseToJsonElement(rawJson).jsonObject
        obj.entries.associate { (k, v) -> k to (jsonElementToAny(v) ?: "") }
    } catch (_: Exception) {
        mapOf("input" to rawJson)
    }

    /** Recursive JsonElement → Any tree. */
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

    /** Inverse: Map<String,Any> → JsonObject tree. */
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

    /**
     * Convert domain Message to OpenAI API message format.
     *
     * Phase 5.6.1: ASSISTANT 携带 toolCalls 时序列化 structured tool_calls 字段，
     * 多轮 tool-use 时 LLM 才能看到自己上轮调用的完整上下文。Placeholder text
     * (`[tool_call ...]`) 自动过滤。
     */
    internal fun Message.toOpenAIMessage(): OpenAIMessage {
        return when (role) {
            MessageRole.TOOL -> OpenAIMessage(
                role = "tool",
                content = content,
                tool_call_id = toolCallId,
            )
            MessageRole.ASSISTANT -> {
                val calls = toolCalls
                if (!calls.isNullOrEmpty()) {
                    OpenAIMessage(
                        role = "assistant",
                        content = content.takeIf { it.isNotBlank() && !it.startsWith("[tool_call ") },
                        tool_calls = calls.map { tc ->
                            OpenAIToolCall(
                                id = tc.id,
                                type = "function",
                                function = OpenAIFunctionCall(
                                    name = tc.name,
                                    arguments = json.encodeToString(
                                        JsonElement.serializer(),
                                        mapToJsonElement(tc.arguments as Map<String, Any?>),
                                    ),
                                ),
                            )
                        },
                    )
                } else {
                    OpenAIMessage(role = "assistant", content = content)
                }
            }
            else -> OpenAIMessage(role = role.value, content = content)
        }
    }

    override suspend fun checkAvailability(): Boolean = withContext(Dispatchers.IO) {
        try {
            Timber.tag("OpenAIAdapter").d("checkAvailability: baseUrl=$baseUrl, apiKey=${apiKey.take(10)}...")
            val url = "$baseUrl/models"
            Timber.tag("OpenAIAdapter").d("checkAvailability: requesting URL=$url")

            val request = Request.Builder()
                .url(url)
                .get()
                .addHeader("Authorization", "Bearer $apiKey")
                .build()

            Timber.tag("OpenAIAdapter").d("checkAvailability: executing request...")
            val result = client.newCall(request).execute().use { response ->
                Timber.tag("OpenAIAdapter").d("checkAvailability: response code=${response.code}, message=${response.message}")
                response.isSuccessful
            }
            Timber.tag("OpenAIAdapter").d("checkAvailability: result=$result")
            result
        } catch (e: Exception) {
            Timber.tag("OpenAIAdapter").e(e, "checkAvailability: exception")
            false
        }
    }
}

/**
 * DeepSeek API适配器
 *
 * API格式与OpenAI兼容
 */
class DeepSeekAdapter(
    private val apiKey: String,
    private val baseUrl: String = "https://api.deepseek.com/v1"
) : LLMAdapter {

    private val openAIAdapter = OpenAIAdapter(apiKey, baseUrl)

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
}
