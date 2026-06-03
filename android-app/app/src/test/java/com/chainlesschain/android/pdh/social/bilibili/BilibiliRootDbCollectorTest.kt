package com.chainlesschain.android.pdh.social.bilibili

import android.content.Context
import com.chainlesschain.android.pdh.social.common.LocalSnapshotResult
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.unmockkAll
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 7.2 — JVM unit cover for [BilibiliRootDbCollector] orchestration.
 * Mirrors ToutiaoRootDbCollectorTest pattern.
 */
class BilibiliRootDbCollectorTest {

    private lateinit var context: Context
    private lateinit var credentialsStore: BilibiliRootCredentialsStore
    private lateinit var extractor: BilibiliRootDbExtractor
    private lateinit var collector: BilibiliRootDbCollector

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        credentialsStore = mockk(relaxed = true)
        extractor = mockk()
        collector = BilibiliRootDbCollector(
            context = context,
            credentialsStore = credentialsStore,
            extractor = extractor,
        )
    }

    @After
    fun tearDown() {
        unmockkAll()
    }

    @Test
    fun `snapshot returns NoCredentials when hasCredentials false`() = runTest {
        every { credentialsStore.hasCredentials() } returns false
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoCredentials)
    }

    @Test
    fun `snapshot returns NoCredentials when uid null despite hasCredentials true`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns null
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoCredentials)
    }

    @Test
    fun `snapshot returns Ok with counts + diagnostic on extract Ok`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "12345678"
        coEvery { extractor.extract() } returns
            BilibiliRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-bilibili-root.json",
                historyCount = 100,
                favouriteCount = 50,
                followCount = 200,
                totalRows = 350,
                extractedAtMs = 1716383021000L,
                dbFilename = "bili.db",
                hadHistoryTable = true,
                hadFavouriteTable = true,
                hadFollowTable = true,
                schemaDriftWarnings = emptyList(),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals("/tmp/social-bilibili-root.json", ok.snapshotPath)
        assertEquals(350, ok.totalEvents)
        assertEquals(100, ok.perCategoryCounts["history"])
        assertEquals(50, ok.perCategoryCounts["favourite"])
        assertEquals(200, ok.perCategoryCounts["follow"])
        assertEquals(1716383021000L, ok.snapshottedAt)
        assertEquals("12345678", ok.diagnosticFields["uid"])
        assertEquals("bili.db", ok.diagnosticFields["dbFilename"])
        assertEquals("true", ok.diagnosticFields["hadHistoryTable"])
        assertEquals("true", ok.diagnosticFields["hadFavouriteTable"])
        assertEquals("true", ok.diagnosticFields["hadFollowTable"])
        assertNull(ok.diagnosticFields["schemaDrift"])
        verify { credentialsStore.recordSync(1716383021000L, 350) }
    }

    @Test
    fun `snapshot surfaces schemaDrift warnings in diagnostic`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "12345678"
        coEvery { extractor.extract() } returns
            BilibiliRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-bilibili-root.json",
                historyCount = 0,
                favouriteCount = 5,
                followCount = 0,
                totalRows = 5,
                extractedAtMs = 1716383021000L,
                dbFilename = "bili.db",
                hadHistoryTable = true,
                hadFavouriteTable = true,
                hadFollowTable = false,
                schemaDriftWarnings = listOf(
                    "history missing required columns (bvid/avid + time); have: foo,bar",
                ),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals(
            "history missing required columns (bvid/avid + time); have: foo,bar",
            ok.diagnosticFields["schemaDrift"],
        )
        assertEquals("false", ok.diagnosticFields["hadFollowTable"])
    }

    @Test
    fun `snapshot returns NoRoot + recordError when extract returns NoRoot`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "12345678"
        coEvery { extractor.extract() } returns BilibiliRootDbExtractor.ExtractResult.NoRoot
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoRoot)
        verify { credentialsStore.recordError(-10, "su not available") }
    }

    @Test
    fun `snapshot returns ExtractFailed source-db-missing with candidate-list hint`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "12345678"
        coEvery { extractor.extract() } returns
            BilibiliRootDbExtractor.ExtractResult.SourceDbMissing
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("source-db-missing", ef.reason)
        // Banner must mention bili.db candidate + P7.2.0 探测 follow-up
        assertTrue(ef.message?.contains("bili.db") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("P7.2.0") == true, "msg=${ef.message}")
    }

    @Test
    fun `snapshot returns ExtractFailed copy-failed with raw message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "12345678"
        coEvery { extractor.extract() } returns
            BilibiliRootDbExtractor.ExtractResult.CopyFailed("permission denied")
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("copy-failed", ef.reason)
        assertEquals("permission denied", ef.message)
        verify { credentialsStore.recordError(-30, "permission denied") }
    }

    @Test
    fun `snapshot returns ExtractFailed with generic reason on Failed`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "12345678"
        coEvery { extractor.extract() } returns
            BilibiliRootDbExtractor.ExtractResult.Failed(
                reason = "open-error",
                message = "file is not a database",
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("open-error", ef.reason)
        assertEquals("file is not a database", ef.message)
        verify { credentialsStore.recordError(-99, "file is not a database") }
    }
}
