package com.chainlesschain.android.pdh.social.xiaohongshu

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
 * Phase 7.5 — JVM unit cover for [XhsRootDbCollector] orchestration.
 * Kinds: note / liked / follow (mirror social-xiaohongshu adapter
 * VALID_SNAPSHOT_KINDS; history / like / favourite are sqlite-mode legacy
 * only, snapshot doesn't accept).
 */
class XhsRootDbCollectorTest {

    private lateinit var context: Context
    private lateinit var credentialsStore: XhsRootCredentialsStore
    private lateinit var extractor: XhsRootDbExtractor
    private lateinit var collector: XhsRootDbCollector

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        credentialsStore = mockk(relaxed = true)
        extractor = mockk()
        collector = XhsRootDbCollector(
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
        every { credentialsStore.getUid() } returns "5e8c8f7e1234567890abcdef"
        coEvery { extractor.extract() } returns
            XhsRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-xiaohongshu-root.json",
                noteCount = 25,
                likedCount = 300,
                followCount = 150,
                totalRows = 475,
                extractedAtMs = 1716383021000L,
                dbFilename = "xhs.db",
                hadNoteTable = true,
                hadLikedTable = true,
                hadFollowTable = true,
                schemaDriftWarnings = emptyList(),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals("/tmp/social-xiaohongshu-root.json", ok.snapshotPath)
        assertEquals(475, ok.totalEvents)
        assertEquals(25, ok.perCategoryCounts["note"])
        assertEquals(300, ok.perCategoryCounts["liked"])
        assertEquals(150, ok.perCategoryCounts["follow"])
        assertEquals(1716383021000L, ok.snapshottedAt)
        assertEquals("5e8c8f7e1234567890abcdef", ok.diagnosticFields["userId"])
        assertEquals("xhs.db", ok.diagnosticFields["dbFilename"])
        assertEquals("true", ok.diagnosticFields["hadNoteTable"])
        assertEquals("true", ok.diagnosticFields["hadLikedTable"])
        assertEquals("true", ok.diagnosticFields["hadFollowTable"])
        assertNull(ok.diagnosticFields["schemaDrift"])
        verify { credentialsStore.recordSync(1716383021000L, 475) }
    }

    @Test
    fun `snapshot surfaces schemaDrift warnings in diagnostic`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "5e8c8f7e1234567890abcdef"
        coEvery { extractor.extract() } returns
            XhsRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-xiaohongshu-root.json",
                noteCount = 0,
                likedCount = 5,
                followCount = 0,
                totalRows = 5,
                extractedAtMs = 1716383021000L,
                dbFilename = "xhs.db",
                hadNoteTable = true,
                hadLikedTable = true,
                hadFollowTable = false,
                schemaDriftWarnings = listOf(
                    "notes missing required columns (note_id + time); have: foo,bar",
                ),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals(
            "notes missing required columns (note_id + time); have: foo,bar",
            ok.diagnosticFields["schemaDrift"],
        )
        assertEquals("false", ok.diagnosticFields["hadFollowTable"])
    }

    @Test
    fun `snapshot returns NoRoot + recordError when extract returns NoRoot`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "5e8c8f7e1234567890abcdef"
        coEvery { extractor.extract() } returns XhsRootDbExtractor.ExtractResult.NoRoot
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoRoot)
        verify { credentialsStore.recordError(-10, "su not available") }
    }

    @Test
    fun `snapshot returns ExtractFailed source-db-missing with candidate-list hint`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "5e8c8f7e1234567890abcdef"
        coEvery { extractor.extract() } returns
            XhsRootDbExtractor.ExtractResult.SourceDbMissing
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("source-db-missing", ef.reason)
        assertTrue(ef.message?.contains("xhs.db") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("P7.5.0") == true, "msg=${ef.message}")
    }

    @Test
    fun `snapshot returns ExtractFailed likely-sqlcipher with v2 transition hint`() = runTest {
        // Plan §6.5: Xhs DB **likely SQLCipher** + libshield.so anti-frida.
        // The 'likely-sqlcipher' reason surfaces a clear v2.0 transition
        // hint so v0.1 → v2.0 transition is user-actionable (NOT dead-end).
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "5e8c8f7e1234567890abcdef"
        coEvery { extractor.extract() } returns
            XhsRootDbExtractor.ExtractResult.Failed(
                reason = "likely-sqlcipher",
                message = "file is not a database — Xhs DB 几乎确定 SQLCipher 加密 + libshield.so 反 frida (v2.0 路径: frida + libshield neuter + key 派生 hook, 见 Phase 7 plan §6.5)",
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("likely-sqlcipher", ef.reason)
        assertTrue(ef.message?.contains("SQLCipher") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("libshield") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("frida") == true, "msg=${ef.message}")
        verify { credentialsStore.recordError(-99, any()) }
    }

    @Test
    fun `snapshot returns ExtractFailed copy-failed with raw message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "5e8c8f7e1234567890abcdef"
        coEvery { extractor.extract() } returns
            XhsRootDbExtractor.ExtractResult.CopyFailed("permission denied")
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("copy-failed", ef.reason)
        assertEquals("permission denied", ef.message)
        verify { credentialsStore.recordError(-30, "permission denied") }
    }
}
