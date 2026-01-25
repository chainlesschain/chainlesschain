package com.chainlesschain.android.feature.ai.domain.adapter

import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.llm.DeepSeekAdapter
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.data.llm.OllamaAdapter
import com.chainlesschain.android.feature.ai.data.llm.OpenAIAdapter
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LLM适配器工厂
 * 根据提供商和配置动态创建适配器实例
 */
@Singleton
class LLMAdapterFactory @Inject constructor(
    private val configManager: LLMConfigManager
) {
    /**
     * 根据提供商创建适配器
     */
    fun createAdapter(provider: LLMProvider): LLMAdapter {
        val config = configManager.getConfig()

        return when (provider) {
            LLMProvider.OLLAMA -> {
                OllamaAdapter(baseUrl = config.ollama.url)
            }

            LLMProvider.OPENAI -> {
                OpenAIAdapter(
                    apiKey = config.openai.apiKey,
                    baseUrl = config.openai.baseURL
                )
            }

            LLMProvider.DEEPSEEK -> {
                DeepSeekAdapter(
                    apiKey = config.deepseek.apiKey,
                    baseUrl = config.deepseek.baseURL
                )
            }

            LLMProvider.CLAUDE -> {
                // TODO: Implement Claude adapter when available
                // For now, return a mock adapter
                createGenericAdapter(
                    config.anthropic.apiKey,
                    config.anthropic.baseURL
                )
            }

            LLMProvider.DOUBAO -> {
                createGenericAdapter(
                    config.volcengine.apiKey,
                    config.volcengine.baseURL
                )
            }

            LLMProvider.QWEN -> {
                createGenericAdapter(
                    config.qwen.apiKey,
                    config.qwen.baseURL
                )
            }

            LLMProvider.ERNIE -> {
                createGenericAdapter(
                    config.ernie.apiKey,
                    config.ernie.baseURL
                )
            }

            LLMProvider.CHATGLM -> {
                createGenericAdapter(
                    config.chatglm.apiKey,
                    config.chatglm.baseURL
                )
            }

            LLMProvider.MOONSHOT -> {
                createGenericAdapter(
                    config.moonshot.apiKey,
                    config.moonshot.baseURL
                )
            }

            LLMProvider.SPARK -> {
                createGenericAdapter(
                    config.spark.apiKey,
                    config.spark.baseURL
                )
            }

            LLMProvider.GEMINI -> {
                createGenericAdapter(
                    config.gemini.apiKey,
                    config.gemini.baseURL
                )
            }

            LLMProvider.CUSTOM -> {
                createGenericAdapter(
                    config.custom.apiKey,
                    config.custom.baseURL
                )
            }
        }
    }

    /**
     * 创建通用适配器（OpenAI兼容格式）
     * 大多数国内云厂商都兼容OpenAI API格式
     */
    private fun createGenericAdapter(apiKey: String, baseUrl: String): LLMAdapter {
        return OpenAIAdapter(
            apiKey = apiKey,
            baseUrl = baseUrl
        )
    }

    /**
     * 测试适配器连接
     */
    suspend fun testConnection(provider: LLMProvider): Result<String> {
        return try {
            val adapter = createAdapter(provider)
            val isAvailable = adapter.checkAvailability()

            if (isAvailable) {
                Result.success("连接成功！${provider.displayName} 服务正常")
            } else {
                Result.failure(Exception("连接失败：服务不可用"))
            }
        } catch (e: Exception) {
            Result.failure(Exception("连接失败：${e.message ?: "未知错误"}"))
        }
    }
}
