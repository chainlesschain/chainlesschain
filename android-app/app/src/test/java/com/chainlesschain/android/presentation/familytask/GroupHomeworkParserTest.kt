package com.chainlesschain.android.presentation.familytask

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** M5 群作业导入解析核 ([GroupHomeworkParser])。 */
class GroupHomeworkParserTest {

    private val now = 1_000_000L
    private val dayMs = 24 * 60 * 60 * 1000L

    @Test
    fun `numbered homework list under a header is parsed per line`() {
        val msg = """
            各位家长好，今日作业：
            1. 数学课本第32页 1-10 题
            2、语文背诵《静夜思》明天检查
            ③英语抄写单元词汇
        """.trimIndent()

        val candidates = GroupHomeworkParser.parse(msg, now)
        assertEquals(3, candidates.size)
        assertEquals("数学课本第32页 1-10 题", candidates[0].title)
        assertEquals("math", candidates[0].subjectCode)
        assertEquals("chinese", candidates[1].subjectCode)
        assertEquals(now + dayMs, candidates[1].dueAtMs) // 明天检查
        assertEquals("english", candidates[2].subjectCode)
        assertNull(candidates[0].dueAtMs)
    }

    @Test
    fun `signal words match without numbering or header`() {
        val candidates = GroupHomeworkParser.parse("请同学们今晚完成物理练习册第5章", now)
        assertEquals(1, candidates.size)
        assertEquals("physics", candidates[0].subjectCode)
        assertEquals(now, candidates[0].dueAtMs) // 今晚 → 当天
    }

    @Test
    fun `noise messages yield nothing`() {
        assertTrue(GroupHomeworkParser.parse("明天上午九点开家长会，请准时参加", now).isEmpty())
        assertTrue(GroupHomeworkParser.parse("", now).isEmpty())
        assertTrue(GroupHomeworkParser.parse("收到", now).isEmpty())
    }

    @Test
    fun `bare header line is not a candidate and duplicates collapse`() {
        val msg = """
            作业：
            1. 数学口算练习
            2. 数学口算练习
        """.trimIndent()
        val candidates = GroupHomeworkParser.parse(msg, now)
        assertEquals(1, candidates.size)
        assertEquals("数学口算练习", candidates[0].title)
    }

    @Test
    fun `due detection covers day offsets`() {
        assertEquals(now + 2 * dayMs, GroupHomeworkParser.detectDue("后天交作文", now))
        assertEquals(now + dayMs, GroupHomeworkParser.detectDue("明早默写", now))
        assertNull(GroupHomeworkParser.detectDue("周五交", now)) // v0.1 不解析周X
    }

    @Test
    fun `subject detection is label substring over 13 subjects`() {
        assertEquals("ideology", GroupHomeworkParser.detectSubject("道法第3课预习"))
        assertEquals("ict", GroupHomeworkParser.detectSubject("信息技术上机练习"))
        assertNull(GroupHomeworkParser.detectSubject("口算练习 20 道"))
    }
}
