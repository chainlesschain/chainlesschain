package com.chainlesschain.android.presentation.aistudy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MistakeReviewSchedulerTest {

    private val day = 86_400_000L

    private fun entry(
        id: String = "m",
        createdAt: Long = 0L,
        reviewCount: Int = 0,
        lastReviewedAt: Long? = null,
    ) = MistakeEntry(
        id = id,
        grade = GradeLevel.P4,
        subject = Subject.MATH,
        knowledgeNode = "n",
        question = "q",
        wrongAnswer = "w",
        correctAnswer = "c",
        note = "",
        createdAt = createdAt,
        reviewCount = reviewCount,
        lastReviewedAt = lastReviewedAt,
    )

    @Test
    fun `never-reviewed entry is due one day after creation`() {
        val e = entry(createdAt = 0L)
        assertEquals(1 * day, MistakeReviewScheduler.nextReviewAt(e))
        assertFalse(MistakeReviewScheduler.isDue(e, day - 1))
        assertTrue(MistakeReviewScheduler.isDue(e, day))
    }

    @Test
    fun `interval escalates with review count from last reviewed time`() {
        // reviewCount=1 → 第 2 档 = 2 天, 从 lastReviewedAt 起算
        val e = entry(reviewCount = 1, lastReviewedAt = 10 * day)
        assertEquals(12 * day, MistakeReviewScheduler.nextReviewAt(e))
    }

    @Test
    fun `review count saturates at the last interval bucket`() {
        val e = entry(reviewCount = 100, lastReviewedAt = 0L)
        val last = MistakeReviewScheduler.INTERVAL_DAYS.last()
        assertEquals(last * day, MistakeReviewScheduler.nextReviewAt(e))
    }

    @Test
    fun `dueForReview returns only due entries, most overdue first`() {
        val now = 100 * day
        val veryOverdue = entry(id = "old", createdAt = 0L) // due since 1*day → overdue ~99d
        val justDue = entry(id = "new", createdAt = 98 * day) // due at 99*day → overdue 1d
        val notDue = entry(id = "future", createdAt = 100 * day) // due at 101*day
        val due = MistakeReviewScheduler.dueForReview(listOf(justDue, notDue, veryOverdue), now)
        assertEquals(listOf("old", "new"), due.map { it.id })
    }

    @Test
    fun `dueForReview honors the limit`() {
        val now = 100 * day
        val es = (1..5).map { entry(id = "e$it", createdAt = 0L) }
        assertEquals(2, MistakeReviewScheduler.dueForReview(es, now, limit = 2).size)
    }

    @Test
    fun `orderForReview puts due before not-due`() {
        val now = 50 * day
        val due = entry(id = "due", createdAt = 0L)
        val far = entry(id = "far", createdAt = 100 * day) // due at 101*day, not due
        val ordered = MistakeReviewScheduler.orderForReview(listOf(far, due), now)
        assertEquals("due", ordered.first().id)
        assertEquals("far", ordered.last().id)
    }
}
