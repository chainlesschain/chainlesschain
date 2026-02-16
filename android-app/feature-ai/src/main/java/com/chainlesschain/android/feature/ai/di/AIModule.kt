package com.chainlesschain.android.feature.ai.di

import timber.log.Timber
import com.chainlesschain.android.core.database.dao.VectorEmbeddingDao
import com.chainlesschain.android.feature.ai.R
import com.chainlesschain.android.feature.ai.context.ContextManager
import com.chainlesschain.android.feature.ai.cowork.CoworkOrchestrator
import com.chainlesschain.android.feature.ai.cowork.agent.AgentPool
import com.chainlesschain.android.feature.ai.cowork.sandbox.FileSandbox
import com.chainlesschain.android.feature.ai.cowork.task.LongRunningTaskManager
import com.chainlesschain.android.feature.ai.data.config.LLMConfigManager
import com.chainlesschain.android.feature.ai.data.llm.DeepSeekAdapter
import com.chainlesschain.android.feature.ai.data.llm.LLMAdapter
import com.chainlesschain.android.feature.ai.data.llm.OllamaAdapter
import com.chainlesschain.android.feature.ai.data.llm.OpenAIAdapter
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import com.chainlesschain.android.feature.ai.entity.EntityExtractor
import com.chainlesschain.android.feature.ai.vector.VectorStore
import com.chainlesschain.android.feature.ai.vector.VectorStoreRepository
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

    // ===== Context Manager =====

    /**
     * 提供上下文管理器
     */
    @Provides
    @Singleton
    fun provideContextManager(): ContextManager {
        return ContextManager()
    }

    // ===== Vector Store =====

    /**
     * 提供向量存储仓库
     */
    @Provides
    @Singleton
    fun provideVectorStoreRepository(
        vectorEmbeddingDao: VectorEmbeddingDao
    ): VectorStoreRepository {
        return VectorStoreRepository(vectorEmbeddingDao)
    }

    /**
     * 提供向量存储
     */
    @Provides
    @Singleton
    fun provideVectorStore(
        repository: VectorStoreRepository
    ): VectorStore {
        return VectorStore(repository)
    }

    // ===== Entity Extractor =====

    /**
     * 提供实体提取器
     */
    @Provides
    @Singleton
    fun provideEntityExtractor(): EntityExtractor {
        return EntityExtractor()
    }

    // ===== Cowork System =====

    /**
     * 提供Agent池
     */
    @Provides
    @Singleton
    fun provideAgentPool(): AgentPool {
        return AgentPool()
    }

    /**
     * 提供长时任务管理器
     */
    @Provides
    @Singleton
    fun provideLongRunningTaskManager(): LongRunningTaskManager {
        return LongRunningTaskManager()
    }

    /**
     * 提供文件沙箱
     */
    @Provides
    @Singleton
    fun provideFileSandbox(): FileSandbox {
        return FileSandbox()
    }

    /**
     * 提供Cowork编排器
     */
    @Provides
    @Singleton
    fun provideCoworkOrchestrator(
        agentPool: AgentPool,
        taskManager: LongRunningTaskManager,
        fileSandbox: FileSandbox
    ): CoworkOrchestrator {
        return CoworkOrchestrator(agentPool, taskManager, fileSandbox)
    }
}

/**
 * LLM适配器工厂
 * 根据provider动态创建adapter
 */
class LLMAdapterFactory @javax.inject.Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
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
        if (finalApiKey.isNullOrBlank()) {
            throw IllegalArgumentException(context.getString(R.string.error_api_key_not_set, provider.displayName))
        }

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
                LLMProvider.CUSTOM -> {
                    val config = configManager.getConfig().custom
                    OpenAIAdapter(apiKey, config.baseURL.ifBlank { "https://api.openai.com/v1" })
                }
                else -> throw IllegalArgumentException(context.getString(R.string.error_unsupported_provider, provider.name))
            }
        } catch (e: Exception) {
            Timber.tag("LLMAdapterFactory").e(e, "Failed to create cloud adapter for $provider")
            // 如果反射失败，使用OpenAI适配器作为兼容方案
            OpenAIAdapter(apiKey)
        }
    }

    /**
     * 根据预配置获取适配器（用于向后兼容）
     * 从配置管理器读取API Key和URL
     */
    fun getAdapter(provider: LLMProvider): LLMAdapter {
        val config = configManager.getConfig()
        return when (provider) {
            LLMProvider.OPENAI -> OpenAIAdapter(config.openai.apiKey)
            LLMProvider.DEEPSEEK -> DeepSeekAdapter(config.deepseek.apiKey)
            LLMProvider.OLLAMA -> OllamaAdapter(config.ollama.url.ifBlank { "http://localhost:11434" })
            else -> OpenAIAdapter("")
        }
    }

    /**
     * 测试连接
     * 检查指定提供商的API是否可用
     */
    suspend fun testConnection(provider: LLMProvider): Result<String> = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        return@withContext try {
            Timber.tag("LLMAdapterFactory").d("Testing connection for provider: ${provider.name}")

            // 获取API Key（如果需要）
            val apiKey = if (provider != LLMProvider.OLLAMA) {
                configManager.getApiKey(provider)
            } else {
                null
            }

            // 创建适配器
            val adapter = if (provider == LLMProvider.OLLAMA) {
                val url = configManager.getConfig().ollama.url
                Timber.tag("LLMAdapterFactory").d("Creating Ollama adapter with URL: $url")
                createOllamaAdapter()
            } else {
                if (apiKey.isNullOrBlank()) {
                    Timber.tag("LLMAdapterFactory").w("API Key is blank for ${provider.displayName}")
                    return@withContext Result.failure(Exception(context.getString(R.string.error_configure_api_key, provider.displayName)))
                }
                createAdapter(provider, apiKey)
            }

            // 测试可用性
            Timber.tag("LLMAdapterFactory").d("Checking availability...")
            val isAvailable = adapter.checkAvailability()
            Timber.tag("LLMAdapterFactory").d("Availability check result: $isAvailable")

            if (isAvailable) {
                val successMsg = context.getString(R.string.connection_success_message, provider.displayName)
                Timber.tag("LLMAdapterFactory").i(successMsg)
                Result.success(successMsg)
            } else {
                val failMsg = context.getString(R.string.connection_failed_service_unavailable)
                Timber.tag("LLMAdapterFactory").w(failMsg)
                Result.failure(Exception(failMsg))
            }
        } catch (e: Exception) {
            val errorMsg = context.getString(R.string.connection_failed_with_error, e.message ?: context.getString(R.string.error_unknown))
            Timber.tag("LLMAdapterFactory").e(e, errorMsg)
            Result.failure(Exception(errorMsg))
        }
    }
}
