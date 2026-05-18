package com.chainlesschain.android.feature.p2p.repository.social

import com.chainlesschain.android.core.common.Result
import com.chainlesschain.android.core.database.dao.social.PostDao
import com.chainlesschain.android.core.database.dao.social.PostEditHistoryDao
import com.chainlesschain.android.core.database.dao.social.PostInteractionDao
import com.chainlesschain.android.core.database.dao.social.PostReportDao
import com.chainlesschain.android.core.database.entity.social.PostReportEntity
import com.chainlesschain.android.core.database.entity.social.ReportReason
import dagger.Lazy
import io.mockk.Runs
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * PostRepository 举报相关单元测试
 *
 * 验证 v0.31.x demo 残余被真正修掉：
 * 1. reportPost 落库（之前只 build entity 不 insert）
 * 2. 同人同帖重复举报 idempotent（不双插）
 * 3. getUserReports 走 DAO 查询（之前 hardcoded empty）
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PostRepositoryReportTest {

    private lateinit var postDao: PostDao
    private lateinit var interactionDao: PostInteractionDao
    private lateinit var editHistoryDao: PostEditHistoryDao
    private lateinit var reportDao: PostReportDao
    private lateinit var syncAdapter: Lazy<SocialSyncAdapter>
    private lateinit var repo: PostRepository

    @Before
    fun setup() {
        postDao = mockk(relaxed = true)
        interactionDao = mockk(relaxed = true)
        editHistoryDao = mockk(relaxed = true)
        reportDao = mockk(relaxed = true)
        val syncAdapterImpl = mockk<SocialSyncAdapter>(relaxed = true)
        syncAdapter = Lazy { syncAdapterImpl }
        repo = PostRepository(
            postDao = postDao,
            interactionDao = interactionDao,
            postEditHistoryDao = editHistoryDao,
            postReportDao = reportDao,
            syncAdapter = syncAdapter
        )
    }

    @Test
    fun `reportPost persists entity via DAO and syncs`() = runTest {
        coEvery { reportDao.hasReporterReportedPost(any(), any()) } returns false
        val captured = slot<PostReportEntity>()
        coEvery { reportDao.insertReport(capture(captured)) } just Runs

        val result = repo.reportPost(
            postId = "post-1",
            reporterDid = "did:key:reporter",
            reason = ReportReason.SPAM,
            description = "广告"
        )

        assertTrue("reportPost 返回 Success", result is Result.Success)
        coVerify(exactly = 1) { reportDao.insertReport(any()) }
        assertEquals("post-1", captured.captured.postId)
        assertEquals("did:key:reporter", captured.captured.reporterDid)
        assertEquals(ReportReason.SPAM, captured.captured.reason)
        assertEquals("广告", captured.captured.description)
        // sync 也要触发
        coVerify(exactly = 1) { syncAdapter.get().syncReportSubmitted(any()) }
    }

    @Test
    fun `reportPost is idempotent for duplicate reporter+post`() = runTest {
        coEvery { reportDao.hasReporterReportedPost("post-1", "did:key:r") } returns true

        val result = repo.reportPost(
            postId = "post-1",
            reporterDid = "did:key:r",
            reason = ReportReason.SPAM
        )

        assertTrue("重复举报仍返回 Success（idempotent）", result is Result.Success)
        coVerify(exactly = 0) { reportDao.insertReport(any()) }
        // 重复举报不应再次触发 sync——避免远端被刷屏
        coVerify(exactly = 0) { syncAdapter.get().syncReportSubmitted(any()) }
    }

    @Test
    fun `getUserReports queries DAO and wraps Result`() = runTest {
        val reports = listOf(
            PostReportEntity(
                id = "r1",
                postId = "p1",
                reporterDid = "did:key:r",
                reason = ReportReason.HARASSMENT,
                createdAt = 1L
            ),
            PostReportEntity(
                id = "r2",
                postId = "p2",
                reporterDid = "did:key:r",
                reason = ReportReason.SPAM,
                createdAt = 2L
            )
        )
        every { reportDao.getReportsByReporter("did:key:r") } returns flowOf(reports)

        val first = repo.getUserReports("did:key:r").first()
        assertTrue(first is Result.Success)
        assertEquals(2, (first as Result.Success).data.size)
        assertEquals("r1", first.data[0].id)
    }

    @Test
    fun `getPendingReportCount returns DAO count`() = runTest {
        coEvery { reportDao.getReportCountByPost("post-x") } returns 7
        val result = repo.getPendingReportCount("post-x")
        assertTrue(result is Result.Success)
        assertEquals(7, (result as Result.Success).data)
    }
}
