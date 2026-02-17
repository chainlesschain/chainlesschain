package com.chainlesschain.android.feature.ai.data.llm

import timber.log.Timber
import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
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

            return chatResponse.choices.firstOrNull()?.message?.content
                ?: throw Exception("无效响应")
        }
    }

    override suspend fun chatWithTools(
        messages: List<Message>,
        model: String,
        tools: List<Map<String, Any>>,
        temperature: Float,
        maxTokens: Int
    ): ChatWithToolsResponse {
        // Convert tools maps to JsonElements for serialization
        val toolsJson: List<JsonElement>? = if (tools.isNotEmpty()) {
            tools.map { json.parseToJsonElement(json.encodeToString(kotlinx.serialization.serializer<Map<String, Any>>(), it)) }
        } else null

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
            val choice = chatResponse.choices.firstOrNull()
                ?: throw Exception("无效响应")

            val responseMessage = choice.message
            val toolCallsList = responseMessage.tool_calls

            return if (!toolCallsList.isNullOrEmpty()) {
                ChatWithToolsResponse(
                    content = responseMessage.content,
                    toolCalls = toolCallsList.map { tc ->
                        val argsMap = try {
                            val parsed = json.parseToJsonElement(tc.function.arguments)
                            parsed.jsonObject.entries.associate { (k, v) ->
                                k to (v.jsonPrimitive.content as Any)
                            }
                        } catch (_: Exception) {
                            mapOf("input" to tc.function.arguments)
                        }
                        ToolCall(
                            id = tc.id,
                            name = tc.function.name,
                            arguments = argsMap
                        )
                    },
                    finishReason = choice.finish_reason
                )
            } else {
                ChatWithToolsResponse(
                    content = responseMessage.content,
                    finishReason = choice.finish_reason
                )
            }
        }
    }

    /**
     * Convert domain Message to OpenAI API message format.
     */
    private fun Message.toOpenAIMessage(): OpenAIMessage {
        return when (role) {
            MessageRole.TOOL -> OpenAIMessage(
                role = "tool",
                content = content,
                tool_call_id = toolCallId
            )
            else -> OpenAIMessage(
                role = role.value,
                content = content
            )
        }
    }

    override suspend fun checkAvailability(): Boolean {
        return try {
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
