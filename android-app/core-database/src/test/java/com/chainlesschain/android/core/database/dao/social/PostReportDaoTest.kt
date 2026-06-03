package com.chainlesschain.android.core.database.dao.social

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.chainlesschain.android.core.database.ChainlessChainDatabase
import com.chainlesschain.android.core.database.entity.social.PostReportEntity
import com.chainlesschain.android.core.database.entity.social.ReportReason
import com.chainlesschain.android.core.database.entity.social.ReportStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * PostReportDao Room 集成测试
 *
 * 验证 DAO 各项查询走的是真实 SQLite（in-memory Room），catch v0 demo 残余里
 * "schema 有 entity 但没人查/写" 这种陷阱。
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class PostReportDaoTest {

    private lateinit var database: ChainlessChainDatabase
    private lateinit var dao: PostReportDao

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, ChainlessChainDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        dao = database.postReportDao()
    }

    @After
    fun tearDown() {
        database.close()
    }

    private fun makeReport(
        id: String,
        postId: String = "post-1",
        reporterDid: String = "did:key:reporter",
        reason: ReportReason = ReportReason.SPAM,
        description: String? = null,
        createdAt: Long = System.currentTimeMillis(),
        status: ReportStatus = ReportStatus.PENDING
    ) = PostReportEntity(
        id = id,
        postId = postId,
        reporterDid = reporterDid,
        reason = reason,
        description = description,
        createdAt = createdAt,
        status = status
    )

    @Test
    fun `insertReport then getReportsByReporter returns the row`() = runTest {
        val report = makeReport(id = "r1")
        dao.insertReport(report)

        val rows = dao.getReportsByReporter("did:key:reporter").first()
        assertEquals(1, rows.size)
        assertEquals("r1", rows[0].id)
    }

    @Test
    fun `getReportsByReporter is ordered DESC by createdAt`() = runTest {
        dao.insertReport(makeReport(id = "old", createdAt = 1000L))
        dao.insertReport(makeReport(id = "new", createdAt = 2000L))
        dao.insertReport(makeReport(id = "mid", createdAt = 1500L))

        val rows = dao.getReportsByReporter("did:key:reporter").first()
        assertEquals(listOf("new", "mid", "old"), rows.map { it.id })
    }

    @Test
    fun `getReportsByPost filters by postId`() = runTest {
        dao.insertReport(makeReport(id = "a", postId = "p1"))
        dao.insertReport(makeReport(id = "b", postId = "p2"))
        dao.insertReport(makeReport(id = "c", postId = "p1"))

        val p1Rows = dao.getReportsByPost("p1").first()
        assertEquals(setOf("a", "c"), p1Rows.map { it.id }.toSet())
        val p2Rows = dao.getReportsByPost("p2").first()
        assertEquals(setOf("b"), p2Rows.map { it.id }.toSet())
    }

    @Test
    fun `getReportCountByPost counts only PENDING by default`() = runTest {
        dao.insertReport(makeReport(id = "pending-1", status = ReportStatus.PENDING))
        dao.insertReport(makeReport(id = "pending-2", status = ReportStatus.PENDING))
        dao.insertReport(makeReport(id = "resolved", status = ReportStatus.RESOLVED))

        assertEquals(2, dao.getReportCountByPost("post-1"))
        assertEquals(1, dao.getReportCountByPost("post-1", ReportStatus.RESOLVED))
    }

    @Test
    fun `hasReporterReportedPost detects duplicates`() = runTest {
        assertFalse(dao.hasReporterReportedPost("post-1", "did:key:r"))
        dao.insertReport(makeReport(id = "r1", reporterDid = "did:key:r"))
        assertTrue(dao.hasReporterReportedPost("post-1", "did:key:r"))
        // different reporter on same post → independent
        assertFalse(dao.hasReporterReportedPost("post-1", "did:key:other"))
    }

    @Test
    fun `updateStatus changes row status`() = runTest {
        dao.insertReport(makeReport(id = "r1", status = ReportStatus.PENDING))
        dao.updateStatus("r1", ReportStatus.RESOLVED)
        val rows = dao.getReportsByReporter("did:key:reporter").first()
        assertEquals(ReportStatus.RESOLVED, rows[0].status)
    }

    @Test
    fun `deleteReport removes the row`() = runTest {
        dao.insertReport(makeReport(id = "r1"))
        dao.deleteReport("r1")
        val rows = dao.getReportsByReporter("did:key:reporter").first()
        assertEquals(0, rows.size)
    }

    @Test
    fun `REPLACE conflict strategy lets re-insert update fields`() = runTest {
        // 不是 idempotency 的契约（repository 层用 hasReporterReportedPost 做去重），
        // 但 OnConflict.REPLACE 让 DAO 单元的 race 重发不至于 crash。
        dao.insertReport(makeReport(id = "r1", description = "first"))
        dao.insertReport(makeReport(id = "r1", description = "second"))
        val rows = dao.getReportsByReporter("did:key:reporter").first()
        assertEquals(1, rows.size)
        assertEquals("second", rows[0].description)
    }
}
