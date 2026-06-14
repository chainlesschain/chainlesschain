package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StudyReportGeneratorTest {

    private fun snap(
        learning: Int = 0,
        companion: Int = 0,
        guided: Int = 0,
        answerSeeking: Int = 0,
        added: Int = 0,
        reviewed: Int = 0,
        total: Int = 0,
        categories: List<RiskCategory> = emptyList(),
        pointsEarnedToday: Int = 0,
        pointsBalance: Int? = null,
        geofenceViolationsToday: Int = 0,
        gentleness: GentlenessReport? = null,
    ) = StudyActivitySnapshot(
        learningTurns = learning, companionTurns = companion, guidedModeTurns = guided,
        answerSeekingAttempts = answerSeeking,
        mistakesAdded = added, mistakesReviewed = reviewed, mistakeBookTotal = total,
        guardrailCategories = categories,
        pointsEarnedToday = pointsEarnedToday,
        pointsBalance = pointsBalance,
        geofenceViolationsToday = geofenceViolationsToday,
        gentleness = gentleness,
    )

    @Test
    fun `always has AI usage and mistake-book sections`() {
        val report = StudyReportGenerator.generate("小明", snap(learning = 3, total = 4))
        assertEquals(listOf("AI 借力", "错题本"), report.sections.map { it.title })
        assertTrue(report.render().contains("学习答疑 3 次"))
    }

    @Test
    fun `guided mode percentage is reported`() {
        val report = StudyReportGenerator.generate("小明", snap(learning = 4, guided = 2))
        assertTrue(report.render().contains("占 50%"))
    }

    @Test
    fun `answer-seeking attempts surface in AI usage section only when present`() {
        assertTrue(!StudyReportGenerator.generate("小明", snap(learning = 2)).render().contains("尝试直接要答案"))
        assertTrue(
            StudyReportGenerator.generate("小明", snap(learning = 2, answerSeeking = 3))
                .render().contains("尝试直接要答案 3 次"),
        )
    }

    @Test
    fun `guardrail section appears only when there are findings`() {
        assertTrue(StudyReportGenerator.generate("小明", snap()).sections.none { it.title == "需要关注" })

        val withRisk = StudyReportGenerator.generate(
            "小明",
            snap(categories = listOf(RiskCategory.SELF_HARM, RiskCategory.SELF_HARM)),
        )
        val section = withRisk.sections.first { it.title == "需要关注" }
        assertTrue(section.lines.first().contains("出现 2 次"))
        assertTrue(section.lines.first().contains("自伤"))
    }

    @Test
    fun `blank nickname falls back`() {
        assertEquals("同学", StudyReportGenerator.generate("", snap()).nickname)
    }

    @Test
    fun `report never contains chat content - only categories`() {
        // 隐私契约：报告里只有类别标签，没有任何聊天原文 (snapshot 本就不含原文)。
        val report = StudyReportGenerator.generate("小明", snap(categories = listOf(RiskCategory.BULLYING)))
        assertTrue(report.render().contains("霸凌"))
    }

    // ---- v0.2 §3.6 6 块扩展 ----

    @Test
    fun `v0_1 callers without extra data still get exactly the two base sections`() {
        // 缺省 (pointsBalance=null / geofence=0 / gentleness=null) 时新块不出现，零破坏。
        val report = StudyReportGenerator.generate("小明", snap(learning = 1))
        assertEquals(listOf("AI 借力", "错题本"), report.sections.map { it.title })
    }

    @Test
    fun `M9 incentive section appears only when balance is available`() {
        assertTrue(StudyReportGenerator.generate("小明", snap()).sections.none { it.title == "正向激励" })

        val r = StudyReportGenerator.generate("小明", snap(pointsEarnedToday = 30, pointsBalance = 200))
        val section = r.sections.first { it.title == "正向激励" }
        assertTrue(section.lines.any { it.contains("赚 30 分") })
        assertTrue(section.lines.any { it.contains("余额 200 分") })
    }

    @Test
    fun `M9 incentive section nudges gently when nothing earned today`() {
        val r = StudyReportGenerator.generate("小明", snap(pointsEarnedToday = 0, pointsBalance = 50))
        val section = r.sections.first { it.title == "正向激励" }
        assertTrue(section.lines.any { it.contains("今日暂未赚到积分") })
        assertTrue(section.lines.any { it.contains("余额 50 分") })
    }

    @Test
    fun `M8 geofence section appears only on violations`() {
        assertTrue(
            StudyReportGenerator.generate("小明", snap(geofenceViolationsToday = 0))
                .sections.none { it.title == "围栏异常" },
        )
        val r = StudyReportGenerator.generate("小明", snap(geofenceViolationsToday = 3))
        assertTrue(r.sections.first { it.title == "围栏异常" }.lines.first().contains("围栏异常 3 次"))
    }

    @Test
    fun `M10 gentleness section reflects monthly report`() {
        assertTrue(StudyReportGenerator.generate("小明", snap()).sections.none { it.title == "您的监管温和度" })

        val report = ParentEducationEngine.generateReport(
            metrics = GuardianMetrics(rejectionRate = 0.1),
            peerScores = listOf(40, 50, 60, 70, 80),
        )
        val r = StudyReportGenerator.generate("小明", snap(gentleness = report))
        val section = r.sections.first { it.title == "您的监管温和度" }
        assertTrue(section.lines.any { it.contains("本月监管温和度 ${report.score} 分") })
        // 无滥用信号时推荐正向课程
        assertTrue(section.lines.any { it.contains(Course.APPRECIATE_PROGRESS.title) })
    }

    @Test
    fun `full six-block report keeps spec order`() {
        val report = ParentEducationEngine.generateReport(GuardianMetrics(), peerScores = listOf(50))
        val r = StudyReportGenerator.generate(
            "小明",
            snap(
                learning = 2, total = 3,
                categories = listOf(RiskCategory.SELF_HARM),
                pointsEarnedToday = 20, pointsBalance = 120,
                geofenceViolationsToday = 1,
                gentleness = report,
            ),
        )
        assertEquals(
            listOf("AI 借力", "错题本", "正向激励", "围栏异常", "需要关注", "您的监管温和度"),
            r.sections.map { it.title },
        )
    }
}
