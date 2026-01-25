package com.chainlesschain.android.feature.ai.domain.recommendation

import com.chainlesschain.android.feature.ai.domain.model.LLMProvider
import javax.inject.Inject
import javax.inject.Singleton

/**
 * LLM智能推荐引擎
 * 根据使用场景推荐最合适的LLM提供商
 */
@Singleton
class LLMRecommendationEngine @Inject constructor() {

    /**
     * 使用场景
     */
    enum class UseCase {
        FREE,           // 免费/本地
        COST_EFFECTIVE, // 性价比
        HIGH_QUALITY,   // 高质量
        CHINESE,        // 中文场景
        FAST_RESPONSE,  // 快速响应
        LONG_CONTEXT,   // 长文本/大上下文
        CODE,           // 代码相关
        CREATIVE,       // 创意写作
        ANALYSIS,       // 数据分析
        TRANSLATION,    // 翻译
        CHAT,           // 日常对话
        SUMMARIZATION   // 文本摘要
    }

    /**
     * 推荐结果
     */
    data class Recommendation(
        val provider: LLMProvider,
        val model: String,
        val score: Float,  // 推荐分数 0-1
        val reason: String // 推荐理由
    )

    /**
     * 根据场景推荐LLM
     *
     * @param useCase 使用场景
     * @param budget 预算约束 (UNLIMITED, LOW, MEDIUM, HIGH)
     * @param languagePreference 语言偏好 (CHINESE, ENGLISH, ANY)
     * @return 推荐列表（按分数排序）
     */
    fun recommend(
        useCase: UseCase,
        budget: Budget = Budget.MEDIUM,
        languagePreference: Language = Language.ANY
    ): List<Recommendation> {
        val recommendations = mutableListOf<Recommendation>()

        when (useCase) {
            UseCase.FREE -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OLLAMA,
                        model = "qwen2:7b",
                        score = 1.0f,
                        reason = "完全免费，本地运行，隐私安全"
                    )
                )
            }

            UseCase.COST_EFFECTIVE -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.95f,
                        reason = "性价比极高，质量不错，价格低廉（¥0.1/1M tokens）"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OLLAMA,
                        model = "qwen2:7b",
                        score = 0.9f,
                        reason = "完全免费，适合大量使用"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DOUBAO,
                        model = "doubao-seed-1-6-251015",
                        score = 0.85f,
                        reason = "国内价格低，速度快（¥0.3/1M tokens）"
                    )
                )
            }

            UseCase.HIGH_QUALITY -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CLAUDE,
                        model = "claude-3-5-sonnet-20241022",
                        score = 1.0f,
                        reason = "推理能力最强，适合复杂任务"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OPENAI,
                        model = "gpt-4o",
                        score = 0.95f,
                        reason = "GPT-4o，多模态能力强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.85f,
                        reason = "性价比高的高质量选择"
                    )
                )
            }

            UseCase.CHINESE -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.QWEN,
                        model = "qwen-plus",
                        score = 0.95f,
                        reason = "阿里通义千问，中文理解能力强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.ERNIE,
                        model = "ernie-bot-4",
                        score = 0.9f,
                        reason = "百度文心一言，中文原生支持"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CHATGLM,
                        model = "glm-4",
                        score = 0.85f,
                        reason = "智谱AI，中文效果好"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.9f,
                        reason = "DeepSeek中文能力强，性价比高"
                    )
                )
            }

            UseCase.FAST_RESPONSE -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OPENAI,
                        model = "gpt-4o-mini",
                        score = 0.95f,
                        reason = "GPT-4o-mini，速度快，质量高"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.9f,
                        reason = "响应速度快，性价比高"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DOUBAO,
                        model = "doubao-seed-1-6-251015",
                        score = 0.85f,
                        reason = "国内服务器，延迟低"
                    )
                )
            }

            UseCase.LONG_CONTEXT -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CLAUDE,
                        model = "claude-3-5-sonnet-20241022",
                        score = 1.0f,
                        reason = "支持200K上下文，长文本处理能力最强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.MOONSHOT,
                        model = "moonshot-v1-128k",
                        score = 0.9f,
                        reason = "Kimi 128K上下文，中文长文本能力强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OPENAI,
                        model = "gpt-4o",
                        score = 0.85f,
                        reason = "GPT-4o 128K上下文"
                    )
                )
            }

            UseCase.CODE -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CLAUDE,
                        model = "claude-3-5-sonnet-20241022",
                        score = 0.95f,
                        reason = "Claude代码能力强，支持多种编程语言"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-coder",
                        score = 0.9f,
                        reason = "DeepSeek专门的代码模型"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OPENAI,
                        model = "gpt-4o",
                        score = 0.85f,
                        reason = "GPT-4o代码生成和理解能力强"
                    )
                )
            }

            UseCase.CREATIVE -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CLAUDE,
                        model = "claude-3-opus-20240229",
                        score = 0.95f,
                        reason = "Claude Opus创意写作能力最强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OPENAI,
                        model = "gpt-4o",
                        score = 0.9f,
                        reason = "GPT-4o创意生成能力强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.MOONSHOT,
                        model = "moonshot-v1-8k",
                        score = 0.8f,
                        reason = "Kimi中文创意写作不错"
                    )
                )
            }

            UseCase.ANALYSIS -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CLAUDE,
                        model = "claude-3-5-sonnet-20241022",
                        score = 0.95f,
                        reason = "Claude分析推理能力强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OPENAI,
                        model = "gpt-4o",
                        score = 0.9f,
                        reason = "GPT-4o数据分析能力强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.8f,
                        reason = "DeepSeek分析能力不错，性价比高"
                    )
                )
            }

            UseCase.TRANSLATION -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CLAUDE,
                        model = "claude-3-5-sonnet-20241022",
                        score = 0.95f,
                        reason = "Claude翻译质量高，保留语境"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.QWEN,
                        model = "qwen-plus",
                        score = 0.9f,
                        reason = "通义千问中英翻译能力强"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.85f,
                        reason = "DeepSeek翻译质量好，性价比高"
                    )
                )
            }

            UseCase.CHAT -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OPENAI,
                        model = "gpt-4o-mini",
                        score = 0.9f,
                        reason = "GPT-4o-mini对话流畅，性价比高"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.85f,
                        reason = "DeepSeek对话能力强，价格低"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.OLLAMA,
                        model = "qwen2:7b",
                        score = 0.8f,
                        reason = "Ollama免费，日常对话够用"
                    )
                )
            }

            UseCase.SUMMARIZATION -> {
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.CLAUDE,
                        model = "claude-3-5-sonnet-20241022",
                        score = 0.95f,
                        reason = "Claude摘要能力强，支持长文本"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.DEEPSEEK,
                        model = "deepseek-chat",
                        score = 0.9f,
                        reason = "DeepSeek摘要质量高，性价比好"
                    )
                )
                recommendations.add(
                    Recommendation(
                        provider = LLMProvider.MOONSHOT,
                        model = "moonshot-v1-128k",
                        score = 0.85f,
                        reason = "Kimi长文本摘要能力强"
                    )
                )
            }
        }

        // 根据预算过滤
        val filteredByBudget = filterByBudget(recommendations, budget)

        // 根据语言偏好调整分数
        val adjustedByLanguage = adjustByLanguage(filteredByBudget, languagePreference)

        // 按分数排序
        return adjustedByLanguage.sortedByDescending { it.score }
    }

    /**
     * 获取最佳推荐
     */
    fun getBestRecommendation(
        useCase: UseCase,
        budget: Budget = Budget.MEDIUM,
        languagePreference: Language = Language.ANY
    ): Recommendation? {
        return recommend(useCase, budget, languagePreference).firstOrNull()
    }

    /**
     * 获取场景描述
     */
    fun getUseCaseDescription(useCase: UseCase): String {
        return when (useCase) {
            UseCase.FREE -> "完全免费，本地运行"
            UseCase.COST_EFFECTIVE -> "高性价比，价格优先"
            UseCase.HIGH_QUALITY -> "最高质量，不考虑成本"
            UseCase.CHINESE -> "中文理解和生成"
            UseCase.FAST_RESPONSE -> "快速响应，低延迟"
            UseCase.LONG_CONTEXT -> "长文本处理，大上下文"
            UseCase.CODE -> "代码生成、理解、调试"
            UseCase.CREATIVE -> "创意写作、文案生成"
            UseCase.ANALYSIS -> "数据分析、推理任务"
            UseCase.TRANSLATION -> "翻译任务"
            UseCase.CHAT -> "日常对话"
            UseCase.SUMMARIZATION -> "文本摘要"
        }
    }

    // ===== 私有方法 =====

    /**
     * 根据预算过滤
     */
    private fun filterByBudget(
        recommendations: List<Recommendation>,
        budget: Budget
    ): List<Recommendation> {
        return when (budget) {
            Budget.UNLIMITED -> recommendations
            Budget.HIGH -> recommendations // 不过滤
            Budget.MEDIUM -> recommendations.filter {
                it.provider in listOf(
                    LLMProvider.DEEPSEEK,
                    LLMProvider.OPENAI,
                    LLMProvider.DOUBAO,
                    LLMProvider.QWEN,
                    LLMProvider.OLLAMA
                )
            }
            Budget.LOW -> recommendations.filter {
                it.provider in listOf(
                    LLMProvider.DEEPSEEK,
                    LLMProvider.DOUBAO,
                    LLMProvider.OLLAMA
                )
            }
        }
    }

    /**
     * 根据语言偏好调整分数
     */
    private fun adjustByLanguage(
        recommendations: List<Recommendation>,
        language: Language
    ): List<Recommendation> {
        return when (language) {
            Language.ANY -> recommendations
            Language.CHINESE -> recommendations.map { rec ->
                if (rec.provider in listOf(
                        LLMProvider.QWEN,
                        LLMProvider.ERNIE,
                        LLMProvider.CHATGLM,
                        LLMProvider.MOONSHOT,
                        LLMProvider.DOUBAO,
                        LLMProvider.DEEPSEEK
                    )
                ) {
                    rec.copy(score = (rec.score * 1.1f).coerceAtMost(1.0f))
                } else {
                    rec
                }
            }
            Language.ENGLISH -> recommendations.map { rec ->
                if (rec.provider in listOf(
                        LLMProvider.OPENAI,
                        LLMProvider.CLAUDE,
                        LLMProvider.GEMINI
                    )
                ) {
                    rec.copy(score = (rec.score * 1.1f).coerceAtMost(1.0f))
                } else {
                    rec
                }
            }
        }
    }

    /**
     * 预算枚举
     */
    enum class Budget {
        UNLIMITED,  // 无限制
        HIGH,       // 高预算 ($10+/day)
        MEDIUM,     // 中等预算 ($2-10/day)
        LOW         // 低预算 (<$2/day)
    }

    /**
     * 语言偏好
     */
    enum class Language {
        ANY,        // 任意
        CHINESE,    // 中文
        ENGLISH     // 英文
    }
}
