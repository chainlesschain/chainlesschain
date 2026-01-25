package com.chainlesschain.android.feature.ai.di

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
     * 提供OpenAI适配器
     */
    @Provides
    @Singleton
    @Named("OpenAI")
    fun provideOpenAIAdapter(): LLMAdapter {
        // TODO: 从配置中读取API Key
        val apiKey = System.getenv("OPENAI_API_KEY") ?: ""
        return OpenAIAdapter(apiKey)
    }

    /**
     * 提供DeepSeek适配器
     */
    @Provides
    @Singleton
    @Named("DeepSeek")
    fun provideDeepSeekAdapter(): LLMAdapter {
        // TODO: 从配置中读取API Key
        val apiKey = System.getenv("DEEPSEEK_API_KEY") ?: ""
        return DeepSeekAdapter(apiKey)
    }

    /**
     * 提供Ollama适配器
     */
    @Provides
    @Singleton
    @Named("Ollama")
    fun provideOllamaAdapter(): LLMAdapter {
        // TODO: 从配置中读取base URL
        val baseUrl = System.getenv("OLLAMA_BASE_URL") ?: "http://localhost:11434"
        return OllamaAdapter(baseUrl)
    }

    /**
     * 提供默认LLM适配器（DeepSeek）
     */
    @Provides
    @Singleton
    fun provideDefaultLLMAdapter(
        @Named("DeepSeek") deepSeekAdapter: LLMAdapter
    ): LLMAdapter {
        return deepSeekAdapter
    }
}

/**
 * LLM适配器工厂
 * 根据provider动态创建adapter
 */
class LLMAdapterFactory @javax.inject.Inject constructor() {
    /**
     * 根据提供商和API Key创建适配器
     */
    fun createAdapter(provider: LLMProvider, apiKey: String?): LLMAdapter {
        requireNotNull(apiKey) { "API Key不能为空" }

        return when (provider) {
            LLMProvider.OPENAI -> OpenAIAdapter(apiKey)
            LLMProvider.DEEPSEEK -> DeepSeekAdapter(apiKey)
            LLMProvider.OLLAMA -> throw IllegalArgumentException("请使用createOllamaAdapter创建Ollama适配器")
            else -> {
                // 其他提供商使用CloudLLMAdapters
                createCloudAdapter(provider, apiKey)
            }
        }
    }

    /**
     * 创建Ollama适配器
     */
    fun createOllamaAdapter(baseUrl: String): LLMAdapter {
        return OllamaAdapter(baseUrl)
    }

    /**
     * 创建云端LLM适配器
     */
    private fun createCloudAdapter(provider: LLMProvider, apiKey: String): LLMAdapter {
        // 动态加载CloudLLMAdapters中的适配器
        return try {
            when (provider) {
                LLMProvider.CLAUDE -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.ClaudeAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.GEMINI -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.GeminiAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.QWEN -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.QwenAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.ERNIE -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.ErnieAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.CHATGLM -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.ChatGLMAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.MOONSHOT -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.MoonshotAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.SPARK -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.SparkAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.DOUBAO -> {
                    val clazz = Class.forName("com.chainlesschain.android.feature.ai.data.llm.DoubaoAdapter")
                    val constructor = clazz.getConstructor(String::class.java)
                    constructor.newInstance(apiKey) as LLMAdapter
                }
                LLMProvider.CUSTOM -> OpenAIAdapter(apiKey)
                else -> throw IllegalArgumentException("不支持的提供商: $provider")
            }
        } catch (e: Exception) {
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
}
