package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StudyReportGeneratorTest {

    private fun snap(
        learning: Int = 0,
        companion: Int = 0,
        guided: Int = 0,
        added: Int = 0,
        reviewed: Int = 0,
        total: Int = 0,
        categories: List<RiskCategory> = emptyList(),
    ) = StudyActivitySnapshot(
        learningTurns = learning, companionTurns = companion, guidedModeTurns = guided,
        mistakesAdded = added, mistakesReviewed = reviewed, mistakeBookTotal = total,
        guardrailCategories = categories,
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
}
