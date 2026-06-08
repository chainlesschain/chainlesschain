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
