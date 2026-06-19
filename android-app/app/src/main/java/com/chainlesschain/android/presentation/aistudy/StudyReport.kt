package com.chainlesschain.android.presentation.aistudy

/**
 * 学情报告输入快照 (主文档 §3.6 学情报告 / 家长端日报)。
 *
 * §3.6 的家长端日报为 **6 块结构**：正向激励(M9) / 围栏异常(M8) / AI 借力 / 错题本 /
 * 需要关注(护栏) / 监管温和度(M10)。
 *
 * 端侧直接可得的几块 (AI 借力、错题、护栏信号——只计数/类别，不含内容) 始终生成；
 * M9 积分 / M8 围栏 / M10 温和度三块是 **v0.2 扩展**：M9 引擎 ([PointsEngine]) 与
 * M10 引擎 ([ParentEducationEngine]) 已是同模块内的纯逻辑，故这里直接消费其产出；
 * M8 围栏采集仍设备阻塞，但**异常计数**可由调用方预聚合后传入 (同 [guardrailCategories]
 * 的契约)。三块对应字段缺省 (null / 0) 时该块不出现，保证 v0.1 调用方零破坏。
 *
 * 设计取向同 [PointsEngine] / [ParentEducationEngine]：生成器纯函数，所有聚合 (今日积分、
 * 围栏异常次数、温和度分值与同类档位) 由调用方 (VM/Repository) 预聚合后传入，生成器本身
 * 确定性、可单测、零设备。
 */
data class StudyActivitySnapshot(
    val learningTurns: Int,
    val companionTurns: Int,
    /** 进入"作业引导模式"的次数 (防作弊视角)。 */
    val guidedModeTurns: Int,
    /** 任务进行中尝试直接索要答案的次数 (已被引导模式拦截)。 */
    val answerSeekingAttempts: Int = 0,
    val mistakesAdded: Int,
    val mistakesReviewed: Int,
    val mistakeBookTotal: Int,
    /** 护栏命中类别 (只类别，绝不含原文)。 */
    val guardrailCategories: List<RiskCategory>,
    // ---- v0.2 §3.6 6 块扩展 (调用方按"今日"预聚合后传入；缺省时对应块不出现) ----
    /** M9 当日赚取积分；> 0 才进入正向激励块。 */
    val pointsEarnedToday: Int = 0,
    /** M9 当前积分余额；null = 积分子系统数据不可得 → 跳过正向激励块。 */
    val pointsBalance: Int? = null,
    /** M8 联动：今日围栏违规 (应到未到 / 异常停留) 次数；> 0 才出现围栏异常块。 */
    val geofenceViolationsToday: Int = 0,
    /** M10 监管温和度月报 (来自 [ParentEducationEngine.generateReport])；null = 跳过温和度块。 */
    val gentleness: GentlenessReport? = null,
    /** §3.2 今日前台 app 使用汇总 (真 telemetry 聚合)；总时长 > 0 才出现"今日使用"块。 */
    val usageToday: ForegroundUsageSummary? = null,
    /**
     * §3.2 今日 AnomalyDetector 检出的行为异常**类型友好名** (每条一项，调用方已脱包名)；
     * 非空才出现"行为提醒"块。同护栏块契约：只报类别 + 次数，不含具体 app/明细。
     */
    val behaviorAlertsToday: List<String> = emptyList(),
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
                if (snap.answerSeekingAttempts > 0) {
                    add("任务中尝试直接要答案 ${snap.answerSeekingAttempts} 次，已被引导模式拦截")
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

        // 2.5) 今日使用 (§3.2 真 telemetry 聚合；总时长 > 0 才出现)
        snap.usageToday?.takeIf { it.totalMinutes > 0 }?.let { u ->
            sections += StudyReportSection(
                title = "今日使用",
                lines = buildList {
                    add("今日前台使用约 ${formatMinutes(u.totalMinutes)}")
                    if (u.topApps.isNotEmpty()) {
                        add("用得最多：" + u.topApps.joinToString("、") { "${it.label} ${formatMinutes(it.minutes)}" })
                    }
                },
            )
        }

        // 2.6) 行为提醒 (§3.2 AnomalyDetector 真 telemetry 检出；非空才出现，只报类别+次数)
        if (snap.behaviorAlertsToday.isNotEmpty()) {
            val byType = snap.behaviorAlertsToday.groupingBy { it }.eachCount()
            sections += StudyReportSection(
                title = "行为提醒",
                lines = byType.entries.map { (label, n) ->
                    "今日 $n 次「$label」，建议找机会温和聊聊，不必直接质问"
                },
            )
        }

        // 3) 正向激励 (M9 积分；数据不可得时跳过)
        snap.pointsBalance?.let { balance ->
            sections += StudyReportSection(
                title = "正向激励",
                lines = buildList {
                    if (snap.pointsEarnedToday > 0) {
                        add("今日完成任务赚 ${snap.pointsEarnedToday} 分，给 $name 一句具体的肯定吧")
                    } else {
                        add("今日暂未赚到积分，可一起看看哪个任务适合开始")
                    }
                    add("当前积分余额 $balance 分")
                },
            )
        }

        // 4) 围栏异常 (M8 联动；今日无异常时不出现)
        if (snap.geofenceViolationsToday > 0) {
            sections += StudyReportSection(
                title = "围栏异常",
                lines = listOf(
                    "今日围栏异常 ${snap.geofenceViolationsToday} 次 (应到未到 / 异常停留)，" +
                        "建议温和确认 $name 的行程，不必直接质问",
                ),
            )
        }

        // 5) 关注信号 (护栏)
        if (snap.guardrailCategories.isNotEmpty()) {
            val byCat = snap.guardrailCategories.groupingBy { it }.eachCount()
            sections += StudyReportSection(
                title = "需要关注",
                lines = byCat.entries.map { (cat, n) ->
                    "出现 $n 次「${cat.label}」类信号，建议找机会温和关心 $name (内容仍为 ta 的隐私)"
                },
            )
        }

        // 6) 监管温和度 (M10；月报不可得时跳过)
        snap.gentleness?.let { g ->
            sections += StudyReportSection(
                title = "您的监管温和度",
                lines = buildList {
                    val peer = g.peerBand.percentile?.let { "（同类家长中${g.peerBand.label}）" } ?: ""
                    add("本月监管温和度 ${g.score} 分$peer")
                    g.recommendedCourses.firstOrNull()?.let { add("推荐：${it.title}") }
                },
            )
        }

        return StudyReport(nickname = name, sections = sections)
    }

    /** 分钟 → "X 小时 Y 分钟" / "Y 分钟" (家长可读)。 */
    private fun formatMinutes(min: Int): String {
        if (min < 60) return "$min 分钟"
        val h = min / 60
        val m = min % 60
        return if (m == 0) "$h 小时" else "$h 小时 $m 分钟"
    }
}
