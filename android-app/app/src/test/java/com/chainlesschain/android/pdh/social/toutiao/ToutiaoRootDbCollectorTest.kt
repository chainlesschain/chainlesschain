package com.chainlesschain.android.pdh.social.toutiao

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
 * Phase 7.1 — JVM unit cover for [ToutiaoRootDbCollector] orchestration.
 *
 * Mocks credentialsStore + extractor to verify the orchestration logic
 * (state checks, ExtractResult → LocalSnapshotResult mapping, error
 * recording) without spawning real su or SQLite.
 *
 * Mirrors DouyinRootDbCollectorTest.
 */
class ToutiaoRootDbCollectorTest {

    private lateinit var context: Context
    private lateinit var credentialsStore: ToutiaoRootCredentialsStore
    private lateinit var extractor: ToutiaoRootDbExtractor
    private lateinit var collector: ToutiaoRootDbCollector

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        credentialsStore = mockk(relaxed = true)
        extractor = mockk()
        collector = ToutiaoRootDbCollector(
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
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            ToutiaoRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-toutiao-root.json",
                readCount = 50,
                collectionCount = 10,
                searchCount = 5,
                totalRows = 65,
                extractedAtMs = 1716383021000L,
                dbFilename = "article.db",
                hadReadTable = true,
                hadCollectionTable = true,
                hadSearchTable = true,
                schemaDriftWarnings = emptyList(),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals("/tmp/social-toutiao-root.json", ok.snapshotPath)
        assertEquals(65, ok.totalEvents)
        assertEquals(50, ok.perCategoryCounts["read"])
        assertEquals(10, ok.perCategoryCounts["collection"])
        assertEquals(5, ok.perCategoryCounts["search"])
        assertEquals(1716383021000L, ok.snapshottedAt)
        assertEquals("1234567890", ok.diagnosticFields["uid"])
        assertEquals("article.db", ok.diagnosticFields["dbFilename"])
        assertEquals("true", ok.diagnosticFields["hadReadTable"])
        assertEquals("true", ok.diagnosticFields["hadCollectionTable"])
        assertEquals("true", ok.diagnosticFields["hadSearchTable"])
        assertNull(ok.diagnosticFields["schemaDrift"])
        verify { credentialsStore.recordSync(1716383021000L, 65) }
    }

    @Test
    fun `snapshot surfaces schemaDrift warnings in diagnostic`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            ToutiaoRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-toutiao-root.json",
                readCount = 0,
                collectionCount = 5,
                searchCount = 0,
                totalRows = 5,
                extractedAtMs = 1716383021000L,
                dbFilename = "article.db",
                hadReadTable = true,
                hadCollectionTable = true,
                hadSearchTable = false,
                schemaDriftWarnings = listOf(
                    "read_history missing required columns (itemId/readTime); have: foo,bar",
                ),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals(
            "read_history missing required columns (itemId/readTime); have: foo,bar",
            ok.diagnosticFields["schemaDrift"],
        )
        assertEquals("false", ok.diagnosticFields["hadSearchTable"])
    }

    @Test
    fun `snapshot returns NoRoot + recordError when extract returns NoRoot`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns ToutiaoRootDbExtractor.ExtractResult.NoRoot
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoRoot)
        verify { credentialsStore.recordError(-10, "su not available") }
    }

    @Test
    fun `snapshot returns ExtractFailed source-db-missing with candidate-list hint`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            ToutiaoRootDbExtractor.ExtractResult.SourceDbMissing
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("source-db-missing", ef.reason)
        // Banner must mention the candidate list + P7.1.0 探测 follow-up
        assertTrue(ef.message?.contains("article.db") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("P7.1.0") == true, "msg=${ef.message}")
    }

    @Test
    fun `snapshot returns ExtractFailed copy-failed with raw message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            ToutiaoRootDbExtractor.ExtractResult.CopyFailed("permission denied")
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
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            ToutiaoRootDbExtractor.ExtractResult.Failed(
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
