package com.chainlesschain.android.pdh.social.kuaishou

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
 * Phase 7.6 — JVM unit cover for [KuaishouRootDbCollector] orchestration.
 * Kinds: watch / collect / search (Mode B 3 of social-kuaishou's 4 valid
 * snapshot kinds; KIND_PROFILE is the user themselves, derived from
 * credentialsStore — skip in Mode B v0.1).
 */
class KuaishouRootDbCollectorTest {

    private lateinit var context: Context
    private lateinit var credentialsStore: KuaishouRootCredentialsStore
    private lateinit var extractor: KuaishouRootDbExtractor
    private lateinit var collector: KuaishouRootDbCollector

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        credentialsStore = mockk(relaxed = true)
        extractor = mockk()
        collector = KuaishouRootDbCollector(
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
            KuaishouRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-kuaishou-root.json",
                watchCount = 200,
                collectCount = 40,
                searchCount = 25,
                totalRows = 265,
                extractedAtMs = 1716383021000L,
                dbFilename = "kwai.db",
                hadWatchTable = true,
                hadCollectTable = true,
                hadSearchTable = true,
                schemaDriftWarnings = emptyList(),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals("/tmp/social-kuaishou-root.json", ok.snapshotPath)
        assertEquals(265, ok.totalEvents)
        assertEquals(200, ok.perCategoryCounts["watch"])
        assertEquals(40, ok.perCategoryCounts["collect"])
        assertEquals(25, ok.perCategoryCounts["search"])
        assertEquals(1716383021000L, ok.snapshottedAt)
        assertEquals("1234567890", ok.diagnosticFields["uid"])
        assertEquals("kwai.db", ok.diagnosticFields["dbFilename"])
        assertEquals("true", ok.diagnosticFields["hadWatchTable"])
        assertEquals("true", ok.diagnosticFields["hadCollectTable"])
        assertEquals("true", ok.diagnosticFields["hadSearchTable"])
        assertNull(ok.diagnosticFields["schemaDrift"])
        verify { credentialsStore.recordSync(1716383021000L, 265) }
    }

    @Test
    fun `snapshot surfaces schemaDrift warnings in diagnostic`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            KuaishouRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-kuaishou-root.json",
                watchCount = 0,
                collectCount = 5,
                searchCount = 0,
                totalRows = 5,
                extractedAtMs = 1716383021000L,
                dbFilename = "kwai.db",
                hadWatchTable = true,
                hadCollectTable = true,
                hadSearchTable = false,
                schemaDriftWarnings = listOf(
                    "play_history missing required columns (photo_id + time); have: foo,bar",
                ),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals(
            "play_history missing required columns (photo_id + time); have: foo,bar",
            ok.diagnosticFields["schemaDrift"],
        )
        assertEquals("false", ok.diagnosticFields["hadSearchTable"])
    }

    @Test
    fun `snapshot returns NoRoot + recordError when extract returns NoRoot`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns KuaishouRootDbExtractor.ExtractResult.NoRoot
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoRoot)
        verify { credentialsStore.recordError(-10, "su not available") }
    }

    @Test
    fun `snapshot returns ExtractFailed source-db-missing with candidate-list hint`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            KuaishouRootDbExtractor.ExtractResult.SourceDbMissing
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("source-db-missing", ef.reason)
        assertTrue(ef.message?.contains("kwai.db") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("P7.6.0") == true, "msg=${ef.message}")
    }

    @Test
    fun `snapshot returns ExtractFailed likely-sqlcipher with v2 transition hint`() = runTest {
        // Plan §6.6: Kuaishou DB likely SQLCipher / 自研 + libmsaoaidsec.so 反 frida.
        // 'likely-sqlcipher' must surface explicit v2.0 path mention so
        // v0.1 → v2.0 transition is user-actionable (not a dead end).
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            KuaishouRootDbExtractor.ExtractResult.Failed(
                reason = "likely-sqlcipher",
                message = "file is not a database — Kuaishou DB 几乎确定 SQLCipher 或自研加密 + libmsaoaidsec.so 反 frida (v2.0 路径: frida + libmsaoaidsec neuter + key 派生 hook, 见 Phase 7 plan §6.6)",
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("likely-sqlcipher", ef.reason)
        assertTrue(ef.message?.contains("SQLCipher") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("libmsaoaidsec") == true, "msg=${ef.message}")
        assertTrue(ef.message?.contains("frida") == true, "msg=${ef.message}")
        verify { credentialsStore.recordError(-99, any()) }
    }

    @Test
    fun `snapshot returns ExtractFailed copy-failed with raw message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890"
        coEvery { extractor.extract() } returns
            KuaishouRootDbExtractor.ExtractResult.CopyFailed("permission denied")
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("copy-failed", ef.reason)
        assertEquals("permission denied", ef.message)
        verify { credentialsStore.recordError(-30, "permission denied") }
    }
}
