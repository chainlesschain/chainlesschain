package com.chainlesschain.android.presentation.aistudy

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.MistakeEntryEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * M6 错题本真持久 ([RoomMistakeBook] write-through ↔ mistake_book)。
 * Room in-memory 真 SQL; 验 落库/重启回灌/间隔重复/删除/未知枚举丢弃。
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class RoomMistakeBookTest {

    private lateinit var db: FamilyGuardDatabase

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
    }

    @After
    fun tearDown() = db.close()

    private fun entry(node: String = "分数通分") = MistakeEntry(
        id = "",
        grade = GradeLevel.P4,
        subject = Subject.MATH,
        knowledgeNode = node,
        question = "1/2 + 1/3 = ?",
        wrongAnswer = "2/5",
        correctAnswer = "5/6",
        note = "来自作业批改",
        createdAt = 1_000L,
    )

    @Test
    fun `add lands in memory immediately and persists to the table`() = runBlocking {
        val book = RoomMistakeBook(db.mistakeBookDao())
        val id = book.add(entry())

        // 内存立即可见 (RAG/报告同步读)
        assertEquals(1, book.snapshot().size)
        book.awaitIdle()
        // 真落库
        val row = db.mistakeBookDao().getAll().single()
        assertEquals(id, row.id)
        assertEquals("P4", row.grade)
        assertEquals("分数通分", row.knowledgeNode)
    }

    @Test
    fun `restart restores persisted entries (the original gap)`() = runBlocking {
        val first = RoomMistakeBook(db.mistakeBookDao())
        first.add(entry("一元一次方程"))
        first.awaitIdle()

        // 模拟重启: 新实例同一 db
        val second = RoomMistakeBook(db.mistakeBookDao())
        second.awaitLoaded()
        assertEquals(1, second.snapshot().size)
        assertEquals("一元一次方程", second.snapshot()[0].knowledgeNode)
    }

    @Test
    fun `markReviewed and remove write through`() = runBlocking {
        val book = RoomMistakeBook(db.mistakeBookDao())
        val id = book.add(entry())
        book.awaitIdle()

        book.markReviewed(id, at = 9_000L)
        book.awaitIdle()
        assertEquals(1, db.mistakeBookDao().getAll().single().reviewCount)
        assertEquals(9_000L, db.mistakeBookDao().getAll().single().lastReviewedAt)
        assertEquals(1, book.snapshot().single().reviewCount)

        book.remove(id)
        book.awaitIdle()
        assertTrue(book.snapshot().isEmpty())
        assertEquals(0, db.mistakeBookDao().count())
    }

    @Test
    fun `unknown persisted enum rows are dropped instead of crashing`() = runBlocking {
        db.mistakeBookDao().upsert(
            MistakeEntryEntity(
                id = "future-1",
                grade = "P99", // 未来版本学段
                subject = "MATH",
                knowledgeNode = "n",
                question = "q",
                wrongAnswer = "w",
                correctAnswer = "c",
                note = "",
                createdAt = 1_000L,
                reviewCount = 0,
                lastReviewedAt = null,
            ),
        )
        val book = RoomMistakeBook(db.mistakeBookDao())
        book.awaitLoaded()
        assertTrue(book.snapshot().isEmpty())
    }
}
