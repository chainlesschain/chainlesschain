package com.chainlesschain.android.presentation.familytask

import com.chainlesschain.android.presentation.aistudy.Subject

/**
 * M5 群作业自动导入的**解析核** (主文档 §3.5: 群消息 → SUGGESTED 待家长确认)。
 *
 * 纯函数、时间注入、零设备: 家长把班级群通知粘进来 (v0.1 手动粘贴;
 * PDH QQ/微信 collector 自动喂是设备/后端 follow-up), 启发式抽出候选作业。
 * 解析是**建议性**的 —— 全部落 SUGGESTED, 家长确认才 ASSIGNED, 误抽可忽略,
 * 故启发式宁可多抽不漏。
 */
object GroupHomeworkParser {

    /** 一条候选作业 (解析产物, 未入库)。 */
    data class HomeworkCandidate(
        val title: String,
        /** 13 学科 code; 识别不出为 null。 */
        val subjectCode: String?,
        /** 截止时间 (ms); 识别不出为 null。 */
        val dueAtMs: Long?,
    )

    private const val DAY_MS = 24 * 60 * 60 * 1000L
    private const val MAX_TITLE = 60

    /** 作业信号词 (命中任一即视为作业行)。 */
    private val HOMEWORK_SIGNALS = listOf(
        "作业", "练习", "试卷", "卷子", "习题", "背诵", "抄写", "默写", "预习", "复习",
        "完成第", "做完", "听写",
    )

    /** 编号行判定 ("1. xxx" / "2、xxx" / "①xxx")。在含「作业」的消息里编号行也算候选。 */
    private val NUMBERED_ITEM = Regex("""^\s*([0-9]{1,2}[.、)]|[①②③④⑤⑥⑦⑧⑨])\s*\S""")

    /** 编号前缀剥离 (不吃 title 首字符)。 */
    private val NUMBER_PREFIX = Regex("""^\s*([0-9]{1,2}[.、)]|[①②③④⑤⑥⑦⑧⑨])\s*""")

    /**
     * 解析群消息 → 候选列表 (可能为空)。
     *
     * 行级启发式:
     *   1) 命中作业信号词的行直接成候选;
     *   2) 整条消息含「作业」时, 编号行也成候选 (老师常用 "今日作业: 1. … 2. …");
     *   3) 纯标头行 ("今日作业：") 不成候选 — 实体在编号行里;
     *   4) 学科按 13 学科中文 label 子串识别; 截止按 今天/今晚→当天、明天→+1 天、
     *      后天→+2 天 (粗粒度, 家长确认时可改 — v0.1 不做 周X/具体日期 解析);
     *   5) 同 title 去重保序。
     */
    fun parse(text: String, now: Long): List<HomeworkCandidate> {
        val trimmed = text.trim()
        if (trimmed.isBlank()) return emptyList()
        val messageMentionsHomework = trimmed.contains("作业")

        return trimmed.lines()
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .filter { raw ->
                HOMEWORK_SIGNALS.any { raw.contains(it) } ||
                    (messageMentionsHomework && NUMBERED_ITEM.containsMatchIn(raw))
            }
            .map { raw -> raw.replace(NUMBER_PREFIX, "").trim() }
            .filterNot { it.isBareHeader() }
            .map { title ->
                HomeworkCandidate(
                    title = title.take(MAX_TITLE),
                    subjectCode = detectSubject(title),
                    dueAtMs = detectDue(title, now),
                )
            }
            .distinctBy { it.title }
    }

    /** 学科识别: 13 学科中文 label 子串 (先命中先得)。 */
    fun detectSubject(line: String): String? =
        Subject.entries.firstOrNull { line.contains(it.label) }?.code

    /** 截止识别 (粗粒度, 按消息时刻 + N 天)。 */
    fun detectDue(line: String, now: Long): Long? = when {
        line.contains("后天") -> now + 2 * DAY_MS
        line.contains("明天") || line.contains("明早") || line.contains("明晚") -> now + DAY_MS
        line.contains("今天") || line.contains("今晚") -> now
        else -> null
    }

    /** 纯标头行 ("今日作业：" / "作业" / "…作业如下") — 实体在后续编号行。 */
    private fun String.isBareHeader(): Boolean =
        isBlank() || endsWith("：") || endsWith(":") || this == "作业" || endsWith("作业如下")
}
