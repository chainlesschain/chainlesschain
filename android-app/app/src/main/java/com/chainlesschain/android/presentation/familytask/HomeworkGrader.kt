package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.feature.ai.domain.model.Message
import com.chainlesschain.android.feature.ai.domain.model.MessageRole
import com.chainlesschain.android.presentation.aistudy.AiStudyLlm
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/** 一次批改请求 (来自 family_task + 孩子提交)。 */
data class GradingRequest(
    val title: String,
    val description: String,
    val subjectCode: String?,
    val gradeLevelCode: String?,
    val submission: String,
)

/**
 * 批改结果。[score] < 0 表示批改失败/不可用 ([feedback] 为原因)。
 * [mistakes] 为识别出的薄弱知识点, 接错题本 (主文档 §3.5 error_book ← source_task_id)。
 */
data class GradingResult(
    val score: Int,
    val feedback: String,
    val mistakes: List<String>,
) {
    companion object {
        fun failed(reason: String) = GradingResult(score = -1, feedback = reason, mistakes = emptyList())
    }
}

/**
 * 作业 AI 批改 (主文档 §3.5 AI 批改 + §3.6)。接口化以便 ViewModel 注 fake。
 */
interface HomeworkGrader {
    suspend fun grade(request: GradingRequest): GradingResult
}

/**
 * 真批改实现：复用 [AiStudyLlm] (app 已配置的模型) 跑批改 prompt, 解析结构化结果。
 * 不另起模型选择 —— 与 AI 陪学同一个模型出口。
 */
@Singleton
class LlmHomeworkGrader @Inject constructor(
    private val llm: AiStudyLlm,
) : HomeworkGrader {

    override suspend fun grade(request: GradingRequest): GradingResult {
        if (request.submission.isBlank()) return GradingResult.failed("还没有可批改的作答内容")

        val messages = listOf(
            Message(
                id = UUID.randomUUID().toString(),
                conversationId = CONV,
                role = MessageRole.SYSTEM,
                content = GradingPrompts.systemPrompt(request),
                createdAt = 0L,
            ),
            Message(
                id = UUID.randomUUID().toString(),
                conversationId = CONV,
                role = MessageRole.USER,
                content = GradingPrompts.userPrompt(request),
                createdAt = 0L,
            ),
        )

        val sb = StringBuilder()
        var error: String? = null
        llm.stream(messages).collect { chunk ->
            if (chunk.error != null) {
                error = chunk.error
            } else {
                sb.append(chunk.content)
            }
        }
        return if (error != null) {
            GradingResult.failed("批改失败：$error")
        } else {
            GradingResultParser.parse(sb.toString())
        }
    }

    private companion object {
        const val CONV = "homework-grading"
    }
}

/** 批改 prompt (纯逻辑, 可单测)。要求模型输出固定三段, 便于 [GradingResultParser] 解析。 */
object GradingPrompts {

    fun systemPrompt(req: GradingRequest): String {
        val role = buildString {
            req.gradeLevelCode?.let { append(it).append(' ') }
            req.subjectCode?.let { append(GradingPrompts.subjectLabel(it)) }
            append("老师")
        }
        return """
            你是一位$role，正在给学生批改作业。要求：
            - 严格但鼓励，指出对错和原因，语气温暖、适合未成年人。
            - 严格按下面格式输出，三行/块都要有：
            分数: <0-100 的整数>
            评语: <一段话，先肯定再指出问题，给改进建议>
            错题: <每行一个出错的知识点，如「分数通分」；全对则写：无>
        """.trimIndent()
    }

    fun userPrompt(req: GradingRequest): String = buildString {
        append("作业题目：").append(req.title).append('\n')
        if (req.description.isNotBlank()) append("题目说明：").append(req.description).append('\n')
        append("学生的作答：\n").append(req.submission)
    }

    private val SUBJECT_LABELS = mapOf(
        "chinese" to "语文", "math" to "数学", "english" to "英语", "ideology" to "道法",
        "science" to "科学", "pe" to "体育", "physics" to "物理", "chemistry" to "化学",
        "biology" to "生物", "history" to "历史", "geography" to "地理", "politics" to "政治",
        "ict" to "信息技术",
    )

    fun subjectLabel(code: String): String = SUBJECT_LABELS[code] ?: code
}

/**
 * 把模型输出的批改文本解析成 [GradingResult] (纯逻辑, 可单测)。
 * 容错：分数缺失/越界 → clamp 或回退；评语/错题尽量提取。
 */
object GradingResultParser {

    // 分数：容忍 分数/得分/分數 前缀 + 中间 0-4 个非数字符 (冒号/空格/markdown ** 等) → 取数字。
    private val SCORE = Regex("""(?:分数|得分|分數)[^\d\n]{0,4}(\d{1,3})""")
    private val FEEDBACK = Regex("""评语[:：]\s*([\s\S]*?)(?:\n\s*错题[:：]|$)""")
    private val MISTAKES = Regex("""错题[:：]\s*([\s\S]*)$""")

    // 行首项目符号 (符号 / 数字编号 / 圈号)，解析错题时剥离。
    private val BULLET = Regex("""^(?:[-*·•‣◦]\s*)+|^(?:\d+[.、)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*""")

    fun parse(raw: String): GradingResult {
        val text = raw.trim()
        if (text.isBlank()) return GradingResult.failed("批改结果为空")

        val score = SCORE.find(text)?.groupValues?.get(1)?.toIntOrNull()?.coerceIn(0, 100) ?: -1
        val feedback = FEEDBACK.find(text)?.groupValues?.get(1)?.trim()
            ?.takeIf { it.isNotBlank() }
            ?: text // 格式没对上时，整段当评语，不丢内容
        val mistakes = MISTAKES.find(text)?.groupValues?.get(1)
            ?.lines()
            ?.map { stripBullet(it.trim()) }
            ?.filter { it.isNotBlank() && !isNoMistakes(it) }
            ?: emptyList()

        return GradingResult(
            score = if (score < 0) 0 else score, // 解析不到分数时给 0 而非负 (避免 UI 显示 -1)
            feedback = feedback,
            mistakes = mistakes,
        )
    }

    private fun stripBullet(s: String): String = BULLET.replace(s.trim(), "").trim()

    /** 模型表达"无错题"的多种说法，命中即不计入错题 (否则会变成一条伪错题)。 */
    private fun isNoMistakes(line: String): Boolean {
        val s = line.trim().trimEnd('。', '.', '!', '！', '，', ',').lowercase()
        if (s.isEmpty() || s == "none" || s == "n/a" || s == "na" || s == "-") return true
        return s.startsWith("无") || s.startsWith("没有") || s == "暂无" ||
            s == "全对" || s == "全部正确" || s == "全部答对" || s == "无误"
    }
}
