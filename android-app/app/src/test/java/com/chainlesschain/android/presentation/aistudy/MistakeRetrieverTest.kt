package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MistakeRetrieverTest {

    private fun mistake(
        id: String,
        subject: Subject,
        node: String,
        question: String = "q",
        reviewCount: Int = 0,
        createdAt: Long = 0L,
    ) = MistakeEntry(
        id = id, grade = GradeLevel.P5, subject = subject, knowledgeNode = node,
        question = question, wrongAnswer = "w", correctAnswer = "c", note = "",
        createdAt = createdAt, reviewCount = reviewCount,
    )

    private val mathProfile = StudyProfile(grade = GradeLevel.P5, subject = Subject.MATH)

    @Test
    fun `filters to current subject only`() {
        val all = listOf(
            mistake("a", Subject.MATH, "分数加减"),
            mistake("b", Subject.ENGLISH, "分数加减"),
        )
        val got = MistakeRetriever.retrieve("分数怎么加", mathProfile, all)
        assertEquals(listOf("a"), got.map { it.id })
    }

    @Test
    fun `returns empty when query matches nothing`() {
        val all = listOf(mistake("a", Subject.MATH, "分数加减"))
        assertTrue(MistakeRetriever.retrieve("三角形面积", mathProfile, all).isEmpty())
    }

    @Test
    fun `knowledge-node match outranks question-only match`() {
        val all = listOf(
            mistake("nodeHit", Subject.MATH, "方程求解", question = "无关"),
            mistake("qHit", Subject.MATH, "几何", question = "解一个方程"),
        )
        val got = MistakeRetriever.retrieve("怎么解方程", mathProfile, all)
        assertEquals("nodeHit", got.first().id)
    }

    @Test
    fun `ties broken by fewer reviews first`() {
        val all = listOf(
            mistake("reviewed", Subject.MATH, "分数", reviewCount = 5),
            mistake("fresh", Subject.MATH, "分数", reviewCount = 0),
        )
        val got = MistakeRetriever.retrieve("分数", mathProfile, all)
        assertEquals("fresh", got.first().id)
    }

    @Test
    fun `respects topK`() {
        val all = (1..5).map { mistake("m$it", Subject.MATH, "分数") }
        assertEquals(2, MistakeRetriever.retrieve("分数", mathProfile, all, topK = 2).size)
    }

    @Test
    fun `renderContext is empty for empty list and labelled otherwise`() {
        assertEquals("", MistakeRetriever.renderContext(emptyList()))
        val rendered = MistakeRetriever.renderContext(listOf(mistake("a", Subject.MATH, "分数加减")))
        assertTrue(rendered.contains("相关错题"))
        assertTrue(rendered.contains("分数加减"))
    }
}
