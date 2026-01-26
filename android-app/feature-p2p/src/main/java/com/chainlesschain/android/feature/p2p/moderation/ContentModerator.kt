package com.chainlesschain.android.feature.p2p.moderation

import com.chainlesschain.android.core.llm.LLMAdapter
import com.chainlesschain.android.core.llm.Message
import com.chainlesschain.android.core.llm.MessageRole
import com.chainlesschain.android.core.model.Result
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * AI内容审核器
 *
 * 使用LLM进行智能内容审核，检测违规内容并提供处理建议
 *
 * 功能特性：
 * - 6种违规类型检测（色情、暴力、仇恨言论、骚扰、自残、非法活动）
 * - 4级严重程度评估（无、低、中、高）
 * - 置信度评分（0.0-1.0）
 * - 批量审核支持
 * - 上下文感知
 *
 * 使用示例：
 * ```kotlin
 * val result = contentModerator.moderateContent(
 *     content = "用户发布的帖子内容",
 *     context = "社交帖子"
 * )
 * when (result) {
 *     is Result.Success -> {
 *         if (result.data.isViolation) {
 *             // 处理违规内容
 *         }
 *     }
 *     is Result.Error -> {
 *         // 处理错误
 *     }
 * }
 * ```
 */
@Singleton
class ContentModerator @Inject constructor(
    private val llmAdapter: LLMAdapter
) {
    companion object {
        private const val DEFAULT_MODEL = "gpt-4o-mini"  // 使用性价比更高的模型

        /**
         * 系统提示词 - 定义审核规则和输出格式
         */
        private val SYSTEM_PROMPT = """
你是一个专业的内容审核AI助手。你的任务是分析用户提交的内容，判断是否违反社区规范。

## 违规类型定义

1. **性内容 (SEXUAL_CONTENT)**
   - 露骨的性描述或性暗示
   - 色情图片、视频链接
   - 性服务招揽

2. **暴力内容 (VIOLENCE)**
   - 暴力威胁或煽动暴力
   - 血腥、残忍的描述
   - 恐怖主义宣传

3. **仇恨言论 (HATE_SPEECH)**
   - 基于种族、性别、宗教、性取向的歧视
   - 侮辱性言论针对特定群体
   - 煽动仇恨和分裂

4. **骚扰 (HARASSMENT)**
   - 人身攻击或侮辱
   - 恶意跟踪或骚扰
   - 泄露他人隐私信息

5. **自残内容 (SELF_HARM)**
   - 鼓励或美化自杀、自残
   - 自残方法分享
   - 厌食症等自我伤害行为宣扬

6. **非法活动 (ILLEGAL_ACTIVITY)**
   - 毒品交易、枪支买卖
   - 诈骗、洗钱等犯罪活动
   - 侵犯知识产权

## 严重程度定义

- **NONE**: 无违规
- **LOW**: 轻微违规，边缘内容（警告）
- **MEDIUM**: 明确违规，需要删除（删除+警告）
- **HIGH**: 严重违规，需要封禁（删除+封禁）

## 审核原则

1. **准确性**: 仔细分析内容，避免误判
2. **上下文**: 考虑内容的完整语境（如新闻报道、教育讨论）
3. **文化敏感性**: 理解中文语境和文化背景
4. **客观性**: 不带个人偏见，基于明确的规则

## 输出格式

必须返回JSON格式（不要使用markdown代码块）：

{
  "is_violation": true/false,
  "violation_categories": ["SEXUAL_CONTENT", "VIOLENCE"],
  "severity": "NONE" | "LOW" | "MEDIUM" | "HIGH",
  "confidence": 0.95,
  "reason": "详细说明违规原因",
  "suggestion": "处理建议（如：删除、警告、封禁）"
}

如果没有违规，返回：
{
  "is_violation": false,
  "violation_categories": [],
  "severity": "NONE",
  "confidence": 0.9,
  "reason": "内容符合社区规范",
  "suggestion": "允许发布"
}
""".trimIndent()
    }

    /**
     * 审核单条内容
     *
     * @param content 待审核的内容
     * @param context 可选的上下文信息（如"社交帖子"、"评论"、"私信"）
     * @param model LLM模型名称，默认使用 gpt-4o-mini
     * @return 审核结果，包含是否违规、违规类型、严重程度等信息
     */
    suspend fun moderateContent(
        content: String,
        context: String? = null,
        model: String = DEFAULT_MODEL
    ): Result<ModerationResult> = withContext(Dispatchers.IO) {
        try {
            if (content.isBlank()) {
                return@withContext Result.Error(IllegalArgumentException("内容不能为空"))
            }

            val prompt = buildModerationPrompt(content, context)
            val messages = listOf(
                Message(role = MessageRole.SYSTEM, content = SYSTEM_PROMPT),
                Message(role = MessageRole.USER, content = prompt)
            )

            val response = llmAdapter.chat(
                messages = messages,
                model = model,
                temperature = 0.1f,  // 低温度确保一致性
                maxTokens = 500
            )

            val result = parseModerationResult(response)
            Result.Success(result)

        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 批量审核多条内容
     *
     * @param contents 待审核的内容列表
     * @param model LLM模型名称
     * @return 审核结果列表，顺序与输入一致
     */
    suspend fun moderateBatch(
        contents: List<String>,
        model: String = DEFAULT_MODEL
    ): Result<List<ModerationResult>> = withContext(Dispatchers.IO) {
        try {
            if (contents.isEmpty()) {
                return@withContext Result.Success(emptyList())
            }

            val results = contents.map { content ->
                when (val result = moderateContent(content, model = model)) {
                    is Result.Success -> result.data
                    is Result.Error -> ModerationResult.createSafeDefault(
                        reason = "审核失败: ${result.exception.message}"
                    )
                }
            }

            Result.Success(results)

        } catch (e: Exception) {
            Result.Error(e)
        }
    }

    /**
     * 检查LLM服务是否可用
     */
    suspend fun isAvailable(): Boolean {
        return try {
            llmAdapter.chat(
                messages = listOf(Message(MessageRole.USER, "test")),
                model = DEFAULT_MODEL,
                maxTokens = 10
            )
            true
        } catch (e: Exception) {
            false
        }
    }

    /**
     * 构建审核提示词
     */
    private fun buildModerationPrompt(content: String, context: String?): String {
        return buildString {
            append("请审核以下内容：\n\n")
            if (context != null) {
                append("【内容类型】：$context\n")
            }
            append("【内容】：\n$content\n\n")
            append("请分析该内容是否违反社区规范，并返回JSON格式的审核结果。")
        }
    }

    /**
     * 解析LLM返回的审核结果
     *
     * 支持两种格式：
     * 1. 纯JSON
     * 2. Markdown代码块包裹的JSON
     */
    fun parseModerationResult(response: String): ModerationResult {
        return try {
            // 移除可能的markdown代码块标记
            val jsonStr = response
                .trim()
                .removePrefix("```json")
                .removePrefix("```")
                .removeSuffix("```")
                .trim()

            val json = JSONObject(jsonStr)

            ModerationResult(
                isViolation = json.optBoolean("is_violation", false),
                violationCategories = parseViolationCategories(json.optJSONArray("violation_categories")),
                severity = parseSeverity(json.optString("severity", "NONE")),
                confidence = json.optDouble("confidence", 0.0),
                reason = json.optString("reason", ""),
                suggestion = json.optString("suggestion", "")
            )

        } catch (e: Exception) {
            // JSON解析失败，返回安全默认值
            ModerationResult.createSafeDefault(
                reason = "解析审核结果失败: ${e.message}"
            )
        }
    }

    /**
     * 解析违规类型数组
     */
    private fun parseViolationCategories(jsonArray: JSONArray?): List<ViolationCategory> {
        if (jsonArray == null) return emptyList()

        return (0 until jsonArray.length())
            .mapNotNull { index ->
                val categoryStr = jsonArray.optString(index, null)
                ViolationCategory.fromString(categoryStr)
            }
    }

    /**
     * 解析严重程度
     */
    private fun parseSeverity(severityStr: String): ModerationSeverity {
        return ModerationSeverity.fromString(severityStr) ?: ModerationSeverity.NONE
    }
}

/**
 * 审核结果数据类
 */
data class ModerationResult(
    /** 是否违规 */
    val isViolation: Boolean,

    /** 违规类型列表（可能同时违反多种规范） */
    val violationCategories: List<ViolationCategory>,

    /** 严重程度 */
    val severity: ModerationSeverity,

    /** 置信度 (0.0-1.0) */
    val confidence: Double,

    /** 违规原因说明 */
    val reason: String,

    /** 处理建议 */
    val suggestion: String
) {
    companion object {
        /**
         * 创建安全默认值（审核失败时使用）
         * 保守策略：默认标记为可疑，需要人工复审
         */
        fun createSafeDefault(reason: String = "审核异常"): ModerationResult {
            return ModerationResult(
                isViolation = false,  // 默认不阻止发布，但标记为低置信度
                violationCategories = emptyList(),
                severity = ModerationSeverity.NONE,
                confidence = 0.0,  // 低置信度表示需要人工复审
                reason = reason,
                suggestion = "建议人工复审"
            )
        }
    }
}

/**
 * 违规类型枚举
 */
enum class ViolationCategory(val displayName: String) {
    /** 色情内容 */
    SEXUAL_CONTENT("色情内容"),

    /** 暴力内容 */
    VIOLENCE("暴力内容"),

    /** 仇恨言论 */
    HATE_SPEECH("仇恨言论"),

    /** 骚扰 */
    HARASSMENT("骚扰"),

    /** 自残内容 */
    SELF_HARM("自残内容"),

    /** 非法活动 */
    ILLEGAL_ACTIVITY("非法活动");

    companion object {
        /**
         * 从字符串解析违规类型
         */
        fun fromString(value: String?): ViolationCategory? {
            if (value == null) return null
            return try {
                valueOf(value.uppercase())
            } catch (e: IllegalArgumentException) {
                null  // 未知类型忽略
            }
        }
    }
}

/**
 * 审核严重程度枚举
 */
enum class ModerationSeverity(val displayName: String, val level: Int) {
    /** 无违规 */
    NONE("无违规", 0),

    /** 低严重度（警告） */
    LOW("轻微违规", 1),

    /** 中等严重度（删除+警告） */
    MEDIUM("明确违规", 2),

    /** 高严重度（删除+封禁） */
    HIGH("严重违规", 3);

    companion object {
        /**
         * 从字符串解析严重程度
         */
        fun fromString(value: String?): ModerationSeverity? {
            if (value == null) return null
            return try {
                valueOf(value.uppercase())
            } catch (e: IllegalArgumentException) {
                null
            }
        }
    }
}
