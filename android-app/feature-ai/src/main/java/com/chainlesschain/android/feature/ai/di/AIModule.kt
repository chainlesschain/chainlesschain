package com.chainlesschain.android.feature.ai.di

import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.llm.DeepSeekAdapter
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.data.llm.OllamaAdapter
import com.chainlesschain.android.feature.ai.data.llm.OpenAIAdapter
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Named
import javax.inject.Singleton

/**
 * AI模块依赖注入配置
 */
@Module
@InstallIn(SingletonComponent::class)
object AIModule {

    /**
     * 提供LLM配置管理器
     */
    @Provides
    @Singleton
    fun provideLLMConfigManager(
        @dagger.hilt.android.qualifiers.ApplicationContext context: android.content.Context
    ): LLMConfigManager {
        val configManager = LLMConfigManager(context)
        configManager.load()
        return configManager
    }

    /**
     * 提供OpenAI适配器
     */
    @Provides
    @Singleton
    @Named("OpenAI")
    fun provideOpenAIAdapter(configManager: LLMConfigManager): LLMAdapter {
        val config = configManager.getConfig().openai
        return OpenAIAdapter(
            apiKey = config.apiKey,
            baseUrl = config.baseURL
        )
    }

    /**
     * 提供DeepSeek适配器
     */
    @Provides
    @Singleton
    @Named("DeepSeek")
    fun provideDeepSeekAdapter(configManager: LLMConfigManager): LLMAdapter {
        val config = configManager.getConfig().deepseek
        return DeepSeekAdapter(
            apiKey = config.apiKey,
            baseUrl = config.baseURL
        )
    }

    /**
     * 提供Ollama适配器（Named）
     */
    @Provides
    @Singleton
    @Named("Ollama")
    fun provideOllamaAdapterNamed(configManager: LLMConfigManager): LLMAdapter {
        val config = configManager.getConfig().ollama
        return OllamaAdapter(baseUrl = config.url)
    }

    /**
     * 提供Ollama适配器（直接类型）
     * 用于需要直接注入OllamaAdapter的场景（如FileSummarizer）
     */
    @Provides
    @Singleton
    fun provideOllamaAdapter(configManager: LLMConfigManager): OllamaAdapter {
        val config = configManager.getConfig().ollama
        return OllamaAdapter(baseUrl = config.url)
    }

    /**
     * 提供默认LLM适配器（根据配置选择）
     */
    @Provides
    @Singleton
    fun provideDefaultLLMAdapter(
        configManager: LLMConfigManager,
        @Named("Ollama") ollamaAdapter: LLMAdapter
    ): LLMAdapter {
        return ollamaAdapter // 默认使用Ollama
    }
}

/**
 * LLM适配器工厂
 * 根据provider动态创建adapter
 */
class LLMAdapterFactory @javax.inject.Inject constructor(
    private val configManager: LLMConfigManager
) {
    /**
     * 根据提供商和API Key创建适配器
     */
    fun createAdapter(provider: LLMProvider, apiKey: String?): LLMAdapter {
        // Ollama不需要API Key
        if (provider == LLMProvider.OLLAMA) {
            val config = configManager.getConfig().ollama
            return OllamaAdapter(config.url)
        }

        // 其他提供商需要API Key
        val finalApiKey = apiKey ?: configManager.getApiKey(provider)
        requireNotNull(finalApiKey.takeIf { it.isNotBlank() }) { "API Key不能为空" }

        return when (provider) {
            LLMProvider.OPENAI -> {
                val config = configManager.getConfig().openai
                OpenAIAdapter(finalApiKey, config.baseURL)
            }
            LLMProvider.DEEPSEEK -> {
                val config = configManager.getConfig().deepseek
                DeepSeekAdapter(finalApiKey, config.baseURL)
            }
            LLMProvider.OLLAMA -> {
                // 已在上面处理
                val config = configManager.getConfig().ollama
                OllamaAdapter(config.url)
            }
            else -> {
                // 其他提供商使用CloudLLMAdapters
                createCloudAdapter(provider, finalApiKey)
            }
        }
    }

    /**
     * 创建Ollama适配器
     */
    fun createOllamaAdapter(baseUrl: String? = null): LLMAdapter {
        val url = baseUrl ?: configManager.getConfig().ollama.url
        return OllamaAdapter(url)
    }

    /**
     * 创建云端LLM适配器
     */
    private fun createCloudAdapter(provider: LLMProvider, apiKey: String): LLMAdapter {
        // 动态加载CloudLLMAdapters中的适配器，同时传递baseURL以确保使用正确的API端点
        return try {
            when (provider) {
                LLMProvider.CLAUDE -> {
                    val config = configManager.getConfig().anthropic
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.ClaudeAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.GEMINI -> {
                    val config = configManager.getConfig().gemini
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.GeminiAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.QWEN -> {
                    val config = configManager.getConfig().qwen
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.QwenAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.ERNIE -> {
                    val config = configManager.getConfig().ernie
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.ErnieAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.CHATGLM -> {
                    val config = configManager.getConfig().chatglm
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.ChatGLMAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.MOONSHOT -> {
                    val config = configManager.getConfig().moonshot
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.MoonshotAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.SPARK -> {
                    val config = configManager.getConfig().spark
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.SparkAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.DOUBAO -> {
                    val config = configManager.getConfig().volcengine
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.DoubaoAdapter")
                    val constructor = clazz.getConstructor(String::class.java, String::class.java)
                    constructor.newInstance(apiKey, config.baseURL) as LLMAdapter
                }
                LLMProvider.CUSTOM -> OpenAIAdapter(apiKey)
                else -> throw IllegalArgumentException("不支持的提供商: $provider")
            }
        } catch (e: Exception) {
            android.util.Log.e("LLMAdapterFactory", "Failed to create cloud adapter for $provider", e)
            // 如果反射失败，使用OpenAI适配器作为兼容方案
            OpenAIAdapter(apiKey)
        }
    }

    /**
     * 根据预配置获取适配器（用于向后兼容）
     */
    fun getAdapter(provider: LLMProvider): LLMAdapter {
        return when (provider) {
            LLMProvider.OPENAI -> OpenAIAdapter(System.getenv("OPENAI_API_KEY") ?: "")
            LLMProvider.DEEPSEEK -> DeepSeekAdapter(System.getenv("DEEPSEEK_API_KEY") ?: "")
            LLMProvider.OLLAMA -> OllamaAdapter(System.getenv("OLLAMA_BASE_URL") ?: "http://localhost:11434")
            else -> OpenAIAdapter("")
        }
    }

    /**
     * 测试连接
     * 检查指定提供商的API是否可用
     */
    suspend fun testConnection(provider: LLMProvider): Result<String> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        return@withContext try {
            android.util.Log.d("LLMAdapterFactory", "Testing connection for provider: ${provider.name}")

            // 获取API Key（如果需要）
            val apiKey = if (provider != LLMProvider.OLLAMA) {
                configManager.getApiKey(provider)
            } else {
                null
            }

            // 创建适配器
            val adapter = if (provider == LLMProvider.OLLAMA) {
                val url = configManager.getConfig().ollama.url
                android.util.Log.d("LLMAdapterFactory", "Creating Ollama adapter with URL: $url")
                createOllamaAdapter()
            } else {
                if (apiKey.isNullOrBlank()) {
                    android.util.Log.w("LLMAdapterFactory", "API Key is blank for ${provider.displayName}")
                    return@withContext Result.failure(Exception("请先配置${provider.displayName}的API Key"))
                }
                createAdapter(provider, apiKey)
            }

            // 测试可用性
            android.util.Log.d("LLMAdapterFactory", "Checking availability...")
            val isAvailable = adapter.checkAvailability()
            android.util.Log.d("LLMAdapterFactory", "Availability check result: $isAvailable")

            if (isAvailable) {
                val successMsg = "连接成功！${provider.displayName}服务正常"
                android.util.Log.i("LLMAdapterFactory", successMsg)
                Result.success(successMsg)
            } else {
                val failMsg = "连接失败：服务不可用"
                android.util.Log.w("LLMAdapterFactory", failMsg)
                Result.failure(Exception(failMsg))
            }
        } catch (e: Exception) {
            val errorMsg = "连接失败：${e.message ?: "未知错误"}"
            android.util.Log.e("LLMAdapterFactory", errorMsg, e)
            Result.failure(Exception(errorMsg))
        }
    }
}
