package com.chainlesschain.android.feature.familyguard.data.dao

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.feature.familyguard.data.FamilyGuardDatabase
import com.chainlesschain.android.feature.familyguard.data.entity.MistakeEntryEntity
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** M6 mistake_book DAO (主文档 §3.6)。Room in-memory 真 SQL。 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [33])
class MistakeBookDaoTest {

    private lateinit var db: FamilyGuardDatabase
    private lateinit var dao: MistakeBookDao

    @Before
    fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            FamilyGuardDatabase::class.java,
        )
            .allowMainThreadQueries()
            .build()
        dao = db.mistakeBookDao()
    }

    @After
    fun tearDown() = db.close()

    private fun entry(id: String, createdAt: Long = 1_000L) = MistakeEntryEntity(
        id = id,
        grade = "P4",
        subject = "MATH",
        knowledgeNode = "分数通分",
        question = "1/2 + 1/3 = ?",
        wrongAnswer = "2/5",
        correctAnswer = "5/6",
        note = "来自作业批改",
        createdAt = createdAt,
        reviewCount = 0,
        lastReviewedAt = null,
    )

    @Test
    fun `upsert round-trips all fields ordered by created_at`() = runBlocking {
        dao.upsert(entry("b", createdAt = 2_000L))
        dao.upsert(entry("a", createdAt = 1_000L))

        val all = dao.getAll()
        assertEquals(listOf("a", "b"), all.map { it.id })
        val first = all.first()
        assertEquals("P4", first.grade)
        assertEquals("MATH", first.subject)
        assertEquals("分数通分", first.knowledgeNode)
        assertNull(first.lastReviewedAt)
        assertEquals(2, dao.count())
    }

    @Test
    fun `markReviewed increments count and stamps time`() = runBlocking {
        dao.upsert(entry("a"))
        assertEquals(1, dao.markReviewed("a", at = 5_000L))
        assertEquals(1, dao.markReviewed("a", at = 6_000L))
        assertEquals(0, dao.markReviewed("missing", at = 5_000L))

        val row = dao.getAll().single()
        assertEquals(2, row.reviewCount)
        assertEquals(6_000L, row.lastReviewedAt)
    }

    @Test
    fun `delete removes the row`() = runBlocking {
        dao.upsert(entry("a"))
        assertEquals(1, dao.delete("a"))
        assertEquals(0, dao.delete("a"))
        assertEquals(0, dao.count())
    }
}
