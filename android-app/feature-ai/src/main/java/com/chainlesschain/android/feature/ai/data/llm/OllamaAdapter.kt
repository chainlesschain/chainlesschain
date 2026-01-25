package com.chainlesschain.android.feature.ai.data.llm

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.feature.ai.domain.model.StreamChunk
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit
import javax.inject.Inject

/**
 * Ollama API适配器
 *
 * 官方文档: https://github.com/ollama/ollama/blob/main/docs/api.md
 * 支持模型: llama3, qwen2, deepseek-coder, 等等
 * 默认端口: 11434
 */
class OllamaAdapter @Inject constructor(
    private val baseUrl: String = "http://localhost:11434"
) : LLMAdapter {

    // 不需要API key，Ollama是本地运行的
    companion object {
        private const val TAG = "OllamaAdapter"
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
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
            val requestBody = OllamaChatRequest(
                model = model,
                messages = messages.map { msg ->
                    OllamaMessage(
                        role = when (msg.role) {
                            MessageRole.SYSTEM -> "system"
                            MessageRole.USER -> "user"
                            MessageRole.ASSISTANT -> "assistant"
                        },
                        content = msg.content
                    )
                },
                stream = true
            )

            val request = Request.Builder()
                .url("$baseUrl/api/chat")
                .post(json.encodeToString(requestBody).toRequestBody("application/json".toMediaType()))
                .addHeader("Content-Type", "application/json")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    emit(StreamChunk("", isDone = true, error = "Ollama API错误: ${response.code}"))
                    return@flow
                }

                response.body?.source()?.let { source ->
                    while (!source.exhausted()) {
                        val line = source.readUtf8Line() ?: continue
                        if (line.isBlank()) continue

                        try {
                            val streamResponse = json.decodeFromString<OllamaChatResponse>(line)
                            val content = streamResponse.message.content
                            val isDone = streamResponse.done

                            if (content.isNotEmpty()) {
                                emit(StreamChunk(content, isDone = isDone))
                            }

                            if (isDone) {
                                break
                            }
                        } catch (e: Exception) {
                            // 忽略解析错误
                            android.util.Log.e(TAG, "Error parsing stream response", e)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Error in streamChat", e)
            emit(StreamChunk("", isDone = true, error = e.message ?: "Ollama连接失败"))
        }
    }

    override suspend fun chat(
        messages: List<Message>,
        model: String,
        temperature: Float,
        maxTokens: Int
    ): String {
        val requestBody = OllamaChatRequest(
            model = model,
            messages = messages.map { msg ->
                OllamaMessage(
                    role = when (msg.role) {
                        MessageRole.SYSTEM -> "system"
                        MessageRole.USER -> "user"
                        MessageRole.ASSISTANT -> "assistant"
                    },
                    content = msg.content
                )
            },
            stream = false
        )

        val request = Request.Builder()
            .url("$baseUrl/api/chat")
            .post(json.encodeToString(requestBody).toRequestBody("application/json".toMediaType()))
            .addHeader("Content-Type", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw Exception("Ollama API错误: ${response.code}")
            }

            val responseBody = response.body?.string() ?: throw Exception("响应为空")
            val chatResponse = json.decodeFromString<OllamaChatResponse>(responseBody)

            return chatResponse.message.content
        }
    }

    override suspend fun checkAvailability(): Boolean {
        return try {
            val request = Request.Builder()
                .url("$baseUrl/api/tags")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                response.isSuccessful
            }
        } catch (e: Exception) {
            android.util.Log.e(TAG, "Ollama not available", e)
            false
        }
    }
}
