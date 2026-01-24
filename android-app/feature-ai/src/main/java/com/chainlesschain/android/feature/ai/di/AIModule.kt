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
 * 根据provider选择合适的adapter
 */
class LLMAdapterFactory(
    @Named("OpenAI") private val openAIAdapter: LLMAdapter,
    @Named("DeepSeek") private val deepSeekAdapter: LLMAdapter,
    @Named("Ollama") private val ollamaAdapter: LLMAdapter
) {
    fun getAdapter(provider: LLMProvider): LLMAdapter {
        return when (provider) {
            LLMProvider.OPENAI -> openAIAdapter
            LLMProvider.DEEPSEEK -> deepSeekAdapter
            LLMProvider.OLLAMA -> ollamaAdapter
            LLMProvider.CUSTOM -> deepSeekAdapter // 默认使用DeepSeek
        }
    }
}
