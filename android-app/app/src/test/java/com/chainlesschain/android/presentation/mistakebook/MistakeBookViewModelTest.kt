package com.chainlesschain.android.presentation.mistakebook

import com.chainlesschain.android.presentation.aistudy.GradeLevel
import com.chainlesschain.android.presentation.aistudy.InMemoryMistakeBook
import com.chainlesschain.android.presentation.aistudy.InMemoryPointsLedger
import com.chainlesschain.android.presentation.aistudy.MistakeEntry
import com.chainlesschain.android.presentation.aistudy.PointsEventType
import com.chainlesschain.android.presentation.aistudy.Subject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MistakeBookViewModelTest {

    private lateinit var book: InMemoryMistakeBook
    private lateinit var ledger: InMemoryPointsLedger

    @Before
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        book = InMemoryMistakeBook()
        ledger = InMemoryPointsLedger()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun vm() = MistakeBookViewModel(book, ledger)

    private fun seed(count: Int): List<String> = (1..count).map { i ->
        book.add(
            MistakeEntry(
                id = "",
                grade = GradeLevel.P4,
                subject = Subject.MATH,
                knowledgeNode = "知识点$i",
                question = "题$i",
                wrongAnswer = "w",
                correctAnswer = "c",
                note = "",
                createdAt = i.toLong(),
            ),
        )
    }

    @Test
    fun `review marks the entry and reports daily progress`() = runTest {
        val ids = seed(2)
        val viewModel = vm()

        viewModel.review(ids[0]).join()
        assertEquals(1, book.snapshot().first { it.id == ids[0] }.reviewCount)
        assertTrue(ledger.events.value.isEmpty()) // 未满 5 题不发分
    }

    @Test
    fun `fifth distinct review of the day awards mistake-review points once`() = runTest {
        val ids = seed(6)
        val viewModel = vm()

        ids.take(5).forEach { viewModel.review(it).join() }

        val earn = ledger.events.value.single()
        assertEquals(PointsEventType.EARN, earn.type)
        assertEquals(8, earn.amount) // EarnRules.mistakeReview5
        assertTrue(earn.relatedTaskId!!.startsWith("mistake-review-"))

        // 第 6 条复习: 按日去重, 不再发
        viewModel.review(ids[5]).join()
        assertEquals(1, ledger.events.value.size)
        // 同一条再复习也不重复发
        viewModel.review(ids[0]).join()
        assertEquals(1, ledger.events.value.size)
    }

    @Test
    fun `reviewing the same entry repeatedly counts once toward the daily target`() = runTest {
        val ids = seed(1)
        val viewModel = vm()

        repeat(5) { viewModel.review(ids[0]).join() }
        assertTrue(ledger.events.value.isEmpty()) // 1 条刷 5 遍 ≠ 5 题
        assertEquals(5, book.snapshot().single().reviewCount) // 打点照常累计
    }
}
