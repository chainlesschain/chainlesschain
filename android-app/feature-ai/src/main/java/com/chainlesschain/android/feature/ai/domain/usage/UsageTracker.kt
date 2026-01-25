package com.chainlesschain.android.feature.ai.domain.usage

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import androidx.datastore.preferences.preferencesDataStore
import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Token使用追踪器
 * 记录和统计LLM的Token使用量和成本
 */

private val Context.usageDataStore: DataStore<Preferences> by preferencesDataStore(name = "llm_usage")

@Singleton
class UsageTracker @Inject constructor(
    @ApplicationContext private val context: Context
) {

    companion object {
        // 价格表（美元/1M tokens）
        private val PRICING = mapOf(
            LLMProvider.OPENAI to Pair(0.15, 0.60),        // gpt-4o-mini (input, output)
            LLMProvider.DEEPSEEK to Pair(0.00014, 0.00028), // ~¥0.1/1M -> $0.014/1M
            LLMProvider.CLAUDE to Pair(3.0, 15.0),          // claude-3-5-sonnet
            LLMProvider.DOUBAO to Pair(0.004, 0.008),       // ~¥0.3/1M -> $0.04/1M
            LLMProvider.QWEN to Pair(0.0007, 0.002),        // qwen-plus
            LLMProvider.ERNIE to Pair(0.002, 0.004),
            LLMProvider.CHATGLM to Pair(0.007, 0.014),
            LLMProvider.MOONSHOT to Pair(0.002, 0.002),
            LLMProvider.SPARK to Pair(0.003, 0.006),
            LLMProvider.GEMINI to Pair(0.125, 0.375),
            LLMProvider.OLLAMA to Pair(0.0, 0.0),           // 免费
            LLMProvider.CUSTOM to Pair(0.001, 0.002)
        )
    }

    /**
     * 记录Token使用
     */
    suspend fun recordUsage(
        provider: LLMProvider,
        inputTokens: Int,
        outputTokens: Int
    ) {
        val today = LocalDate.now().format(DateTimeFormatter.ISO_DATE)
        val providerKey = provider.name

        context.usageDataStore.edit { preferences ->
            // 总使用量
            val totalInputKey = stringPreferencesKey("${providerKey}_total_input")
            val totalOutputKey = stringPreferencesKey("${providerKey}_total_output")
            val currentTotalInput = preferences[totalInputKey]?.toLongOrNull() ?: 0L
            val currentTotalOutput = preferences[totalOutputKey]?.toLongOrNull() ?: 0L
            preferences[totalInputKey] = (currentTotalInput + inputTokens).toString()
            preferences[totalOutputKey] = (currentTotalOutput + outputTokens).toString()

            // 今日使用量
            val dailyInputKey = stringPreferencesKey("${providerKey}_${today}_input")
            val dailyOutputKey = stringPreferencesKey("${providerKey}_${today}_output")
            val currentDailyInput = preferences[dailyInputKey]?.toIntOrNull() ?: 0
            val currentDailyOutput = preferences[dailyOutputKey]?.toIntOrNull() ?: 0
            preferences[dailyInputKey] = (currentDailyInput + inputTokens).toString()
            preferences[dailyOutputKey] = (currentDailyOutput + outputTokens).toString()

            // 使用次数
            val countKey = stringPreferencesKey("${providerKey}_count")
            val currentCount = preferences[countKey]?.toLongOrNull() ?: 0L
            preferences[countKey] = (currentCount + 1).toString()
        }
    }

    /**
     * 获取总使用统计
     */
    fun getTotalUsage(provider: LLMProvider): Flow<UsageStatistics> {
        val providerKey = provider.name
        return context.usageDataStore.data.map { preferences ->
            val inputTokens = preferences[stringPreferencesKey("${providerKey}_total_input")]?.toLongOrNull() ?: 0L
            val outputTokens = preferences[stringPreferencesKey("${providerKey}_total_output")]?.toLongOrNull() ?: 0L
            val count = preferences[stringPreferencesKey("${providerKey}_count")]?.toLongOrNull() ?: 0L

            val pricing = PRICING[provider] ?: Pair(0.0, 0.0)
            val cost = calculateCost(inputTokens, outputTokens, pricing)

            UsageStatistics(
                provider = provider,
                inputTokens = inputTokens,
                outputTokens = outputTokens,
                totalTokens = inputTokens + outputTokens,
                requestCount = count,
                estimatedCost = cost,
                currency = "USD"
            )
        }
    }

    /**
     * 获取今日使用统计
     */
    fun getTodayUsage(provider: LLMProvider): Flow<UsageStatistics> {
        val today = LocalDate.now().format(DateTimeFormatter.ISO_DATE)
        val providerKey = provider.name

        return context.usageDataStore.data.map { preferences ->
            val inputTokens = preferences[stringPreferencesKey("${providerKey}_${today}_input")]?.toLongOrNull() ?: 0L
            val outputTokens = preferences[stringPreferencesKey("${providerKey}_${today}_output")]?.toLongOrNull() ?: 0L

            val pricing = PRICING[provider] ?: Pair(0.0, 0.0)
            val cost = calculateCost(inputTokens, outputTokens, pricing)

            UsageStatistics(
                provider = provider,
                inputTokens = inputTokens,
                outputTokens = outputTokens,
                totalTokens = inputTokens + outputTokens,
                requestCount = 0L, // 今日请求数需要单独统计
                estimatedCost = cost,
                currency = "USD"
            )
        }
    }

    /**
     * 获取所有提供商的统计
     */
    fun getAllUsage(): Flow<List<UsageStatistics>> {
        return context.usageDataStore.data.map { preferences ->
            LLMProvider.values().map { provider ->
                val providerKey = provider.name
                val inputTokens = preferences[stringPreferencesKey("${providerKey}_total_input")]?.toLongOrNull() ?: 0L
                val outputTokens = preferences[stringPreferencesKey("${providerKey}_total_output")]?.toLongOrNull() ?: 0L
                val count = preferences[stringPreferencesKey("${providerKey}_count")]?.toLongOrNull() ?: 0L

                val pricing = PRICING[provider] ?: Pair(0.0, 0.0)
                val cost = calculateCost(inputTokens, outputTokens, pricing)

                UsageStatistics(
                    provider = provider,
                    inputTokens = inputTokens,
                    outputTokens = outputTokens,
                    totalTokens = inputTokens + outputTokens,
                    requestCount = count,
                    estimatedCost = cost,
                    currency = "USD"
                )
            }.filter { it.totalTokens > 0 } // 只返回有使用记录的
        }
    }

    /**
     * 清除统计数据
     */
    suspend fun clearUsage(provider: LLMProvider? = null) {
        context.usageDataStore.edit { preferences ->
            if (provider != null) {
                // 清除特定提供商
                val providerKey = provider.name
                preferences.asMap().keys.filter {
                    it.name.startsWith(providerKey)
                }.forEach { key ->
                    preferences.remove(key)
                }
            } else {
                // 清除所有
                preferences.clear()
            }
        }
    }

    /**
     * 计算成本
     */
    private fun calculateCost(
        inputTokens: Long,
        outputTokens: Long,
        pricing: Pair<Double, Double>
    ): Double {
        val (inputPrice, outputPrice) = pricing
        return (inputTokens / 1_000_000.0) * inputPrice + (outputTokens / 1_000_000.0) * outputPrice
    }
}

/**
 * 使用统计数据
 */
data class UsageStatistics(
    val provider: LLMProvider,
    val inputTokens: Long,
    val outputTokens: Long,
    val totalTokens: Long,
    val requestCount: Long,
    val estimatedCost: Double,
    val currency: String
)
