package com.chainlesschain.android.presentation.aistudy

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
}
