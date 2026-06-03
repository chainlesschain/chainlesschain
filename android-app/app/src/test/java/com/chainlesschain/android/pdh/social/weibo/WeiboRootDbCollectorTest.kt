package com.chainlesschain.android.pdh.social.weibo

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
 * Phase 7.4 — JVM unit cover for [WeiboRootDbCollector] orchestration.
 * Mirrors BilibiliRootDbCollectorTest pattern.
 *
 * Kinds: post / favourite / follow (search is sqlite-mode-only in
 * social-weibo Node adapter, not snapshot-accepted).
 */
class WeiboRootDbCollectorTest {

    private lateinit var context: Context
    private lateinit var credentialsStore: WeiboRootCredentialsStore
    private lateinit var extractor: WeiboRootDbExtractor
    private lateinit var collector: WeiboRootDbCollector

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        credentialsStore = mockk(relaxed = true)
        extractor = mockk()
        collector = WeiboRootDbCollector(
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
            WeiboRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-weibo-root.json",
                postCount = 120,
                favouriteCount = 30,
                followCount = 180,
                totalRows = 330,
                extractedAtMs = 1716383021000L,
                dbFilename = "weibo.db",
                hadPostTable = true,
                hadFavouriteTable = true,
                hadFollowTable = true,
                schemaDriftWarnings = emptyList(),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals("/tmp/social-weibo-root.json", ok.snapshotPath)
        assertEquals(330, ok.totalEvents)
        assertEquals(120, ok.perCategoryCounts["post"])
        assertEquals(30, ok.perCategoryCounts["favourite"])
        assertEquals(180, ok.perCategoryCounts["follow"])
        assertEquals(1716383021000L, ok.snapshottedAt)
        assertEquals("1234567890", ok.diagnosticFields["uid"])
        assertEquals("weibo.db", ok.diagnosticFields["dbFilename"])
        assertEquals("true", ok.diagnosticFields["hadPostTable"])
        assertEquals("true", ok.diagnosticFields["hadFavouriteTable"])
        assertEquals("true", ok.diagnosticFields["hadFollowTable"])
        assertNull(ok.diagnosticFields["schemaDrift"])
        verify { credentialsStore.recordSync(1716383021000L, 330) }
    }

    @Test
    fun `snapshot surfaces schemaDrift warnings in diagnostic`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            WeiboRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-weibo-root.json",
                postCount = 0,
                favouriteCount = 5,
                followCount = 0,
                totalRows = 5,
                extractedAtMs = 1716383021000L,
                dbFilename = "weibo.db",
                hadPostTable = true,
                hadFavouriteTable = true,
                hadFollowTable = false,
                schemaDriftWarnings = listOf(
                    "status missing required columns (mid + time); have: foo,bar",
                ),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals(
            "status missing required columns (mid + time); have: foo,bar",
            ok.diagnosticFields["schemaDrift"],
        )
        assertEquals("false", ok.diagnosticFields["hadFollowTable"])
    }

    @Test
    fun `snapshot returns NoRoot + recordError when extract returns NoRoot`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns WeiboRootDbExtractor.ExtractResult.NoRoot
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoRoot)
        verify { credentialsStore.recordError(-10, "su not available") }
    }

    @Test
    fun `snapshot returns ExtractFailed source-db-missing with candidate-list hint`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            WeiboRootDbExtractor.ExtractResult.SourceDbMissing
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("source-db-missing", ef.reason)
        // Banner must mention weibo.db candidate + P7.3 探测 follow-up
        assertTrue(ef.message?.contains("weibo.db") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("P7.3") == true, "msg=${ef.message}")
    }

    @Test
    fun `snapshot returns ExtractFailed likely-sqlcipher with frida hint`() = runTest {
        // P7.3 §6 prediction: Weibo Mode B = 明文 OR SQLCipher possible.
        // The "likely-sqlcipher" reason surfaces a clear next-step pointer
        // so v0.1 → v0.2 transition is user-actionable (NOT dead-end).
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            WeiboRootDbExtractor.ExtractResult.Failed(
                reason = "likely-sqlcipher",
                message = "file is not a database — 可能是 SQLCipher 加密 (P7.3 §3.4-3.6 frida hook path 解锁 v0.2)",
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("likely-sqlcipher", ef.reason)
        assertTrue(ef.message?.contains("SQLCipher") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("frida") == true, "msg=${ef.message}")
        verify { credentialsStore.recordError(-99, any()) }
    }

    @Test
    fun `snapshot returns ExtractFailed copy-failed with raw message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            WeiboRootDbExtractor.ExtractResult.CopyFailed("permission denied")
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("copy-failed", ef.reason)
        assertEquals("permission denied", ef.message)
        verify { credentialsStore.recordError(-30, "permission denied") }
    }
}
