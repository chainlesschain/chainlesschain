package com.chainlesschain.android.pdh.messaging.qq

import android.content.Context
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §Phase 13.5 v0.2 — JVM unit cover for [QQLocalCollector] orchestration.
 *
 * Mirrors WeChatLocalCollectorTest. Verifies:
 *   - SnapshotResult.NoCredentials when not logged in
 *   - SnapshotResult.NoRoot when su unavailable
 *   - SnapshotResult.SourceDbMissing → ExtractFailed surfaces the uin-hint
 *   - SnapshotResult.CopyFailed → ExtractFailed propagates message
 *   - SnapshotResult.Ok on full happy path (extractor returns Ok, store
 *     records sync, collector forwards counts)
 *   - extractor.NoCredentials → orchestrator surfaces NoCredentials (state
 *     desync defense)
 *
 * Does NOT cover (deferred to Phase 13.5.6 real-device E2E):
 *   - actual su cp pipeline
 *   - actual SQLite open + table walks
 *   - actual XOR-decrypt of real msgData BLOBs
 */
class QQLocalCollectorTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var credentialsStore: QQCredentialsStore
    private lateinit var dbExtractor: QQDbExtractor
    private lateinit var collector: QQLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "qq-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        every { context.cacheDir } returns tempDir
        credentialsStore = mockk(relaxed = true)
        dbExtractor = mockk()
        collector = QQLocalCollector(
            context = context,
            credentialsStore = credentialsStore,
            dbExtractor = dbExtractor,
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun `returns NoCredentials when not logged in`() = runTest {
        every { credentialsStore.hasCredentials() } returns false
        val result = collector.snapshot()
        assertTrue(result is QQLocalCollector.SnapshotResult.NoCredentials)
        // Extractor never called — gated by hasCredentials check.
        io.mockk.coVerify(exactly = 0) { dbExtractor.extract() }
    }

    @Test
    fun `surfaces NoRoot from extractor`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        coEvery { dbExtractor.extract() } returns QQDbExtractor.ExtractResult.NoRoot
        val result = collector.snapshot()
        assertTrue(result is QQLocalCollector.SnapshotResult.NoRoot)
    }

    @Test
    fun `surfaces SourceDbMissing as ExtractFailed with uin-hint message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.recordError(any(), any()) } just runs
        coEvery { dbExtractor.extract() } returns QQDbExtractor.ExtractResult.SourceDbMissing

        val result = collector.snapshot()
        assertTrue(result is QQLocalCollector.SnapshotResult.ExtractFailed)
        val ef = result as QQLocalCollector.SnapshotResult.ExtractFailed
        assertEquals("source-db-missing", ef.reason)
        // Hint mentions uin / 未登录 — UI surface
        assertTrue(ef.message?.contains("uin") == true || ef.message?.contains("未登录") == true)
        verify { credentialsStore.recordError(-2, "qq-db-not-found") }
    }

    @Test
    fun `surfaces CopyFailed`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.recordError(any(), any()) } just runs
        coEvery { dbExtractor.extract() } returns
            QQDbExtractor.ExtractResult.CopyFailed("permission denied during su cp")

        val result = collector.snapshot()
        assertTrue(result is QQLocalCollector.SnapshotResult.ExtractFailed)
        val ef = result as QQLocalCollector.SnapshotResult.ExtractFailed
        assertEquals("copy-failed", ef.reason)
        assertEquals("permission denied during su cp", ef.message)
        verify { credentialsStore.recordError(-3, "permission denied during su cp") }
    }

    @Test
    fun `surfaces generic Failed from extractor`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.recordError(any(), any()) } just runs
        coEvery { dbExtractor.extract() } returns
            QQDbExtractor.ExtractResult.Failed("dump-failed", "JSON write threw")

        val result = collector.snapshot()
        assertTrue(result is QQLocalCollector.SnapshotResult.ExtractFailed)
        val ef = result as QQLocalCollector.SnapshotResult.ExtractFailed
        assertEquals("dump-failed", ef.reason)
        assertEquals("JSON write threw", ef.message)
        verify { credentialsStore.recordError(-99, "JSON write threw") }
    }

    @Test
    fun `surfaces extractor NoCredentials as collector NoCredentials (desync defense)`() = runTest {
        // hasCredentials says yes but extractor disagrees — possible if
        // user cleared store mid-extract via another action.
        every { credentialsStore.hasCredentials() } returns true
        coEvery { dbExtractor.extract() } returns QQDbExtractor.ExtractResult.NoCredentials
        val result = collector.snapshot()
        assertTrue(result is QQLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `Ok path records sync + propagates counts`() = runTest {
        val extractedAt = 1716000000000L
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.recordSync(any(), any()) } just runs
        coEvery { dbExtractor.extract() } returns QQDbExtractor.ExtractResult.Ok(
            stagingJsonPath = "/tmp/qq-staging/messaging-qq.json",
            contactCount = 5,
            groupCount = 2,
            messageCount = 87,
            totalRows = 94,
            extractedAtMs = extractedAt,
        )

        val result = collector.snapshot()
        assertTrue(result is QQLocalCollector.SnapshotResult.Ok)
        val ok = result as QQLocalCollector.SnapshotResult.Ok
        assertEquals("/tmp/qq-staging/messaging-qq.json", ok.snapshotPath)
        assertEquals(5, ok.contactCount)
        assertEquals(2, ok.groupCount)
        assertEquals(87, ok.messageCount)
        assertEquals(94, ok.totalEvents)
        assertEquals(extractedAt, ok.snapshottedAt)

        verify { credentialsStore.recordSync(extractedAt, 94) }
    }

    @Test
    fun `SNAPSHOT_SCHEMA_VERSION matches js adapter constant (lockstep gate)`() {
        // §A8 v0.2 trap reminder — if you bump this, also bump
        // packages/personal-data-hub/lib/adapters/messaging-qq/index.js
        // SNAPSHOT_SCHEMA_VERSION. Drift = silent ingest failure.
        assertEquals(1, QQLocalCollector.SNAPSHOT_SCHEMA_VERSION)
    }
}
