package com.chainlesschain.android.presentation.aistudy

/**
 * 学情报告输入快照 (主文档 §3.6 学情报告 / 家长端日报)。
 *
 * v0.1 取**端侧可得**的几块：AI 借力、错题、护栏信号 (只计数/类别，不含内容)。
 * M9 积分 / M8 围栏 / M10 温和度等块依赖其它子系统，留 follow-up。
 */
data class StudyActivitySnapshot(
    val learningTurns: Int,
    val companionTurns: Int,
    /** 进入"作业引导模式"的次数 (防作弊视角)。 */
    val guidedModeTurns: Int,
    val mistakesAdded: Int,
    val mistakesReviewed: Int,
    val mistakeBookTotal: Int,
    /** 护栏命中类别 (只类别，绝不含原文)。 */
    val guardrailCategories: List<RiskCategory>,
)

/** 报告中的一块。 */
data class StudyReportSection(val title: String, val lines: List<String>)

data class StudyReport(
    val nickname: String,
    val sections: List<StudyReportSection>,
) {
    fun render(): String = buildString {
        append("📊 $nickname 的学情简报\n")
        sections.forEach { s ->
            append("\n【${s.title}】\n")
            s.lines.forEach { append("· $it\n") }
        }
    }.trimEnd()
}

/**
 * 学情报告生成器 (纯函数)。给定 [StudyActivitySnapshot] 产出结构化分块报告。
 *
 * 注意护栏块**只报类别 + 次数**，与 [GuardrailFinding] 的隐私契约一致 —— 家长能看到
 * "今天出现过 1 次自伤类信号"，但看不到任何聊天原文。
 */
object StudyReportGenerator {

    fun generate(nickname: String, snap: StudyActivitySnapshot): StudyReport {
        val name = nickname.ifBlank { "同学" }
        val sections = mutableListOf<StudyReportSection>()

        // 1) AI 借力
        sections += StudyReportSection(
            title = "AI 借力",
            lines = buildList {
                add("学习答疑 ${snap.learningTurns} 次，陪伴聊天 ${snap.companionTurns} 次")
                if (snap.learningTurns > 0) {
                    val pct = if (snap.learningTurns == 0) 0
                    else (snap.guidedModeTurns * 100) / snap.learningTurns
                    add("其中 ${snap.guidedModeTurns} 次进入作业引导模式 (占 $pct%)，未直接给答案")
                }
            },
        )

        // 2) 错题
        sections += StudyReportSection(
            title = "错题本",
            lines = buildList {
                add("今日新增错题 ${snap.mistakesAdded} 道，复习 ${snap.mistakesReviewed} 道")
                add("错题本累计 ${snap.mistakeBookTotal} 道待巩固")
            },
        )

        // 3) 关注信号 (护栏)
        if (snap.guardrailCategories.isNotEmpty()) {
            val byCat = snap.guardrailCategories.groupingBy { it }.eachCount()
            sections += StudyReportSection(
                title = "需要关注",
                lines = byCat.entries.map { (cat, n) ->
                    "出现 $n 次「${cat.label}」类信号，建议找机会温和关心 $name (内容仍为 ta 的隐私)"
                },
            )
        }

        return StudyReport(nickname = name, sections = sections)
    }
}
