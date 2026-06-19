package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AiStudyPromptsTest {

    @Test
    fun `learning prompt reflects grade subject and nickname`() {
        val profile = StudyProfile(grade = GradeLevel.M2, subject = Subject.PHYSICS, nickname = "小明")
        val prompt = AiStudyPrompts.learningSystemPrompt(profile)

        assertTrue(prompt.contains("小明"))
        assertTrue(prompt.contains("初中"))          // band
        assertTrue(prompt.contains("初中二年级"))      // grade label
        assertTrue(prompt.contains("物理"))           // subject label
        assertTrue(prompt.contains("作业模式"))        // homework-guidance guard
    }

    @Test
    fun `learning prompt falls back to default nickname when blank`() {
        val prompt = AiStudyPrompts.learningSystemPrompt(
            StudyProfile(grade = GradeLevel.P4, subject = Subject.MATH, nickname = ""),
        )
        assertTrue(prompt.contains("同学"))
        assertTrue(prompt.contains("数学"))
    }

    @Test
    fun `companion prompt embeds minor guardrails`() {
        val prompt = AiStudyPrompts.companionSystemPrompt("小红")

        assertTrue(prompt.contains("小红"))
        assertTrue(prompt.contains("自伤"))
        assertTrue(prompt.contains("霸凌"))
        assertTrue(prompt.contains("陌生人"))
        // 不讨论成人/暴力/极端内容护栏
        assertTrue(prompt.contains("成人内容"))
    }

    @Test
    fun `active task appends a strict guided-mode block`() {
        val profile = StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH, nickname = "小明")
        val task = StudyTask(id = "t1", title = "数学第3页")
        val prompt = AiStudyPrompts.learningSystemPrompt(profile, "", task)

        assertTrue(prompt.contains("任务进行中"))
        assertTrue(prompt.contains("数学第3页"))
        assertTrue(prompt.contains("绝不直接给出最终答案"))
    }

    @Test
    fun `null active task equals plain rag prompt`() {
        val profile = StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH, nickname = "小明")
        assertEquals(
            AiStudyPrompts.learningSystemPrompt(profile, ""),
            AiStudyPrompts.learningSystemPrompt(profile, "", null),
        )
    }

    @Test
    fun `homework-detected without task appends generic guided-mode block`() {
        val profile = StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH, nickname = "小明")
        val prompt = AiStudyPrompts.learningSystemPrompt(
            profile, "", activeTask = null, homeworkDetected = true,
        )
        // 内容检测到作业 → 真正进引导模式 (不再只是计数)。
        assertTrue(prompt.contains("作业模式"))
        assertTrue(prompt.contains("绝不直接给出最终答案"))
        // 通用块不绑定具体任务标题。
        assertTrue(!prompt.contains("任务进行中"))
    }

    @Test
    fun `active task takes precedence over homework detection`() {
        val profile = StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH, nickname = "小明")
        val task = StudyTask(id = "t1", title = "数学第3页")
        val prompt = AiStudyPrompts.learningSystemPrompt(
            profile, "", activeTask = task, homeworkDetected = true,
        )
        // 有任务时走任务级引导块 (绑定标题)，不再叠加通用块。
        assertTrue(prompt.contains("任务进行中"))
        assertTrue(prompt.contains("数学第3页"))
    }

    @Test
    fun `no task and no homework equals plain rag prompt`() {
        val profile = StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH, nickname = "小明")
        assertEquals(
            AiStudyPrompts.learningSystemPrompt(profile, ""),
            AiStudyPrompts.learningSystemPrompt(profile, "", activeTask = null, homeworkDetected = false),
        )
    }

    @Test
    fun `answer-seeking heuristic flags direct-answer requests only`() {
        assertTrue(AiStudyPrompts.looksLikeAnswerSeeking("直接告诉我答案"))
        assertTrue(AiStudyPrompts.looksLikeAnswerSeeking("帮我写完这篇作文"))
        assertTrue(!AiStudyPrompts.looksLikeAnswerSeeking("这道题的思路是什么"))
        assertTrue(!AiStudyPrompts.looksLikeAnswerSeeking(""))
    }
}
