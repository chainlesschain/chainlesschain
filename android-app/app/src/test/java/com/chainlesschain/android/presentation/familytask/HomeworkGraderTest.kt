package com.chainlesschain.android.presentation.familytask

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeworkGraderTest {

    private fun req(
        title: String = "数学第3页",
        subject: String? = "math",
        grade: String? = "P5",
        submission: String = "1/2 + 1/3 = 2/5",
    ) = GradingRequest(title, "1-10 题", subject, grade, submission)

    // ---- GradingResultParser ----

    @Test
    fun `parses well-formed grading output`() {
        val raw = """
            分数: 85
            评语: 分数计算有进步，但通分时要先找最小公倍数。继续加油！
            错题: 分数通分
            异分母加法
        """.trimIndent()
        val r = GradingResultParser.parse(raw)
        assertEquals(85, r.score)
        assertTrue(r.feedback.contains("通分"))
        assertEquals(listOf("分数通分", "异分母加法"), r.mistakes)
    }

    @Test
    fun `clamps out-of-range score`() {
        assertEquals(100, GradingResultParser.parse("分数：150\n评语：满分").score)
    }

    @Test
    fun `no mistakes when says 无`() {
        val r = GradingResultParser.parse("分数: 100\n评语: 全对！\n错题: 无")
        assertTrue(r.mistakes.isEmpty())
    }

    @Test
    fun `falls back to whole text as feedback when unstructured`() {
        val r = GradingResultParser.parse("写得不错，继续努力")
        assertEquals(0, r.score) // 解析不到分数 → 0 而非负
        assertTrue(r.feedback.contains("继续努力"))
        assertTrue(r.mistakes.isEmpty())
    }

    @Test
    fun `blank output is a failure`() {
        assertTrue(GradingResultParser.parse("   ").score < 0)
    }

    @Test
    fun `strips list bullets from mistakes`() {
        val r = GradingResultParser.parse("分数:60\n评语:加油\n错题:\n- 通分\n· 约分")
        assertEquals(listOf("通分", "约分"), r.mistakes)
    }

    @Test
    fun `accepts score label variants (得分, 分數, markdown)`() {
        assertEquals(90, GradingResultParser.parse("得分: 90\n评语: 好").score)
        assertEquals(88, GradingResultParser.parse("分數：88\n评语: 不错").score)
        assertEquals(95, GradingResultParser.parse("**分数**: 95\n评语: 很棒").score)
    }

    @Test
    fun `recognizes more no-mistake phrasings`() {
        assertTrue(GradingResultParser.parse("分数:100\n评语:好\n错题: 没有错题").mistakes.isEmpty())
        assertTrue(GradingResultParser.parse("分数:100\n评语:好\n错题: 全部正确").mistakes.isEmpty())
        assertTrue(GradingResultParser.parse("分数:100\n评语:好\n错题: 暂无").mistakes.isEmpty())
        assertTrue(GradingResultParser.parse("分数:100\n评语:好\n错题: none").mistakes.isEmpty())
    }

    @Test
    fun `strips numbered and circled bullets from mistakes`() {
        val numbered = GradingResultParser.parse("分数:60\n评语:加油\n错题:\n1. 通分\n2、约分\n3) 化简")
        assertEquals(listOf("通分", "约分", "化简"), numbered.mistakes)
        val circled = GradingResultParser.parse("分数:60\n评语:加油\n错题:\n①通分\n②约分")
        assertEquals(listOf("通分", "约分"), circled.mistakes)
    }

    @Test
    fun `feedback text mentioning score does not false-match before labeled score`() {
        // 评语里出现"分数"但其后无紧邻数字，分数仍取 line1 的 85。
        val r = GradingResultParser.parse("分数: 85\n评语: 分数计算有进步\n错题: 无")
        assertEquals(85, r.score)
    }

    // ---- GradingPrompts ----

    @Test
    fun `system prompt embeds grade and subject label`() {
        val p = GradingPrompts.systemPrompt(req())
        assertTrue(p.contains("P5"))
        assertTrue(p.contains("数学"))
        assertTrue(p.contains("分数:")) // 要求结构化输出
        assertTrue(p.contains("错题:"))
    }

    @Test
    fun `user prompt carries title and submission`() {
        val p = GradingPrompts.userPrompt(req())
        assertTrue(p.contains("数学第3页"))
        assertTrue(p.contains("1/2 + 1/3 = 2/5"))
    }
}
