package com.chainlesschain.android.feature.ai.data.voice

import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import timber.log.Timber
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Volcengine SeedASR 大模型客户端 —— submit + poll 异步模式。
 *
 * 移植自 yiyuan/backend/volc_seedasr_test.js（同款单 x-api-key 鉴权）。
 *
 * 用法：
 * ```
 * val text = client.transcribe(wavFile)
 * ```
 *
 * 失败时抛 [VolcengineAsrException]，message 含 status code + msg，便于 toast。
 */
@Singleton
class VolcengineAsrClient @Inject constructor(
    private val configManager: LLMConfigManager
) : AsrEngine {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * 把 wav 文件提交到 SeedASR 大模型识别，轮询直到完成或超时。
     *
     * @param audioFile WAV 文件（16kHz mono PCM）
     * @param maxPollSeconds 最长轮询秒数（默认 30s，对应 ~37 次 800ms 轮询）
     * @return 识别后的文字
     * @throws VolcengineAsrException 调用方应捕获并显示给用户
     */
    override suspend fun transcribe(audioFile: File): String = transcribe(audioFile, maxPollSeconds = 30)

    suspend fun transcribe(audioFile: File, maxPollSeconds: Int): String =
        withContext(Dispatchers.IO) {
            configManager.load()
            val cfg = configManager.getConfig().asrVolcengine
            if (cfg.apiKey.isBlank()) {
                throw VolcengineAsrException("ASR_NOT_CONFIGURED", "未配置 SeedASR API Key（设置 → LLM 设置 → 语音识别）")
            }

            val wavBytes = audioFile.readBytes()
            if (wavBytes.isEmpty()) {
                throw VolcengineAsrException("EMPTY_AUDIO", "录音内容为空")
            }
            val wavB64 = android.util.Base64.encodeToString(wavBytes, android.util.Base64.NO_WRAP)

            val reqId = UUID.randomUUID().toString()
            val submitBody = buildJsonObject {
                put("user", buildJsonObject { put("uid", "chainlesschain-android") })
                put("audio", buildJsonObject {
                    put("data", wavB64)
                    put("format", "wav")
                })
                put("request", buildJsonObject {
                    put("model_name", "bigmodel")
                    put("enable_itn", true)   // 数字标准化
                    put("enable_punc", true)  // 自动标点
                    put("enable_ddc", true)   // 智能去口语
                })
            }
            submit(cfg, reqId, submitBody)
            return@withContext pollUntilDone(cfg, reqId, maxPollSeconds)
        }

    private fun submit(
        cfg: com.chainlesschain.android.feature.ai.data.config.VolcengineAsrConfig,
        reqId: String,
        body: JsonObject
    ) {
        val req = Request.Builder()
            .url(cfg.submitUrl)
            .post(json.encodeToString(JsonObject.serializer(), body).toRequestBody("application/json".toMediaType()))
            .header("Content-Type", "application/json")
            .header("x-api-key", cfg.apiKey)
            .header("X-Api-Resource-Id", cfg.resourceId)
            .header("X-Api-Request-Id", reqId)
            .header("X-Api-Sequence", "-1")
            .build()

        http.newCall(req).execute().use { resp ->
            val status = resp.header("x-api-status-code") ?: ""
            val msg = resp.header("x-api-message") ?: ""
            Timber.tag("VolcAsr").i("submit reqId=$reqId http=${resp.code} status=$status msg=$msg")
            if (resp.code != 200 || (status.isNotBlank() && status != "20000000")) {
                val text = resp.body?.string()?.take(500) ?: ""
                throw VolcengineAsrException(status.ifBlank { "HTTP_${resp.code}" }, "submit 失败：$msg $text")
            }
        }
    }

    private suspend fun pollUntilDone(
        cfg: com.chainlesschain.android.feature.ai.data.config.VolcengineAsrConfig,
        reqId: String,
        maxSeconds: Int
    ): String {
        val deadline = System.currentTimeMillis() + maxSeconds * 1000L
        while (System.currentTimeMillis() < deadline) {
            delay(800)
            val req = Request.Builder()
                .url(cfg.queryUrl)
                .post("{}".toRequestBody("application/json".toMediaType()))
                .header("Content-Type", "application/json")
                .header("x-api-key", cfg.apiKey)
                .header("X-Api-Resource-Id", cfg.resourceId)
                .header("X-Api-Request-Id", reqId)
                .header("X-Api-Sequence", "-1")
                .build()

            http.newCall(req).execute().use { resp ->
                val status = resp.header("x-api-status-code") ?: ""
                val msg = resp.header("x-api-message") ?: ""
                val text = resp.body?.string() ?: ""
                Timber.tag("VolcAsr").d("poll reqId=$reqId http=${resp.code} status=$status msg=$msg")

                when {
                    status == "20000000" -> {
                        // success — 解析 result.text
                        val parsed = try {
                            json.parseToJsonElement(text).jsonObject
                        } catch (_: Exception) { null }
                        val resultText = parsed?.get("result")?.jsonObject
                            ?.get("text")?.jsonPrimitive?.content
                        if (resultText.isNullOrBlank()) {
                            throw VolcengineAsrException("EMPTY_RESULT", "识别结果为空：${text.take(300)}")
                        }
                        return resultText
                    }
                    // 仍在处理 / 已接收 - keep polling
                    status == "20000001" || status == "20000002" -> Unit
                    else -> {
                        throw VolcengineAsrException(status.ifBlank { "HTTP_${resp.code}" }, "识别失败：$msg ${text.take(300)}")
                    }
                }
            }
        }
        throw VolcengineAsrException("TIMEOUT", "识别超时（${maxSeconds}s）")
    }
}

class VolcengineAsrException(
    val statusCode: String,
    message: String
) : Exception(message)
