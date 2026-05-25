package com.chainlesschain.android.pdh.social.douyin

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
 * Phase 2b — JVM unit cover for [DouyinRootDbCollector] orchestration.
 *
 * Mocks credentialsStore + extractor to verify the orchestration logic
 * (state checks, ExtractResult → LocalSnapshotResult mapping, error
 * recording) without spawning real su or SQLite.
 *
 * Mirrors WeChat/QQ LocalCollectorTest pattern. The actual extract()
 * pipeline (su gate / cohort copy / SQLite parse) needs Robolectric or
 * real-device E2E to test — gated to Phase 2c.
 */
class DouyinRootDbCollectorTest {

    private lateinit var context: Context
    private lateinit var credentialsStore: DouyinRootCredentialsStore
    private lateinit var extractor: DouyinRootDbExtractor
    private lateinit var collector: DouyinRootDbCollector

    @Before
    fun setUp() {
        context = mockk(relaxed = true)
        credentialsStore = mockk(relaxed = true)
        extractor = mockk()
        collector = DouyinRootDbCollector(
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
    fun `snapshot returns NoCredentials when uid null despite hasCredentials true`() =
        runTest {
            // State-desync defense: hasCredentials returned true but getUid
            // gave null (could happen on EncryptedSharedPreferences key
            // rotation mid-read).
            every { credentialsStore.hasCredentials() } returns true
            every { credentialsStore.getUid() } returns null
            val r = collector.snapshot()
            assertTrue(r is LocalSnapshotResult.NoCredentials)
        }

    @Test
    fun `snapshot returns Ok with counts + diagnostic on extract Ok`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890123456789"
        coEvery { extractor.extract() } returns
            DouyinRootDbExtractor.ExtractResult.Ok(
                stagingJsonPath = "/tmp/social-douyin-root.json",
                messageCount = 50,
                contactCount = 10,
                totalRows = 60,
                extractedAtMs = 1716383021000L,
                hadMsgTable = true,
                hadSimpleUserTable = true,
                schemaDriftWarnings = emptyList(),
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.Ok)
        val ok = r as LocalSnapshotResult.Ok
        assertEquals("/tmp/social-douyin-root.json", ok.snapshotPath)
        assertEquals(60, ok.totalEvents)
        assertEquals(50, ok.perCategoryCounts["message"])
        assertEquals(10, ok.perCategoryCounts["contact"])
        assertEquals(1716383021000L, ok.snapshottedAt)
        assertEquals("1234567890123456789", ok.diagnosticFields["uid"])
        assertEquals("true", ok.diagnosticFields["hadMsgTable"])
        assertEquals("true", ok.diagnosticFields["hadSimpleUserTable"])
        // Schema drift warnings absent when list is empty
        assertNull(ok.diagnosticFields["schemaDrift"])
        verify { credentialsStore.recordSync(1716383021000L, 60) }
    }

    @Test
    fun `snapshot Ok with schema drift warnings surfaces them in diagnostic`() =
        runTest {
            every { credentialsStore.hasCredentials() } returns true
            every { credentialsStore.getUid() } returns "1234567890123456789"
            coEvery { extractor.extract() } returns
                DouyinRootDbExtractor.ExtractResult.Ok(
                    stagingJsonPath = "/tmp/x.json",
                    messageCount = 0,
                    contactCount = 0,
                    totalRows = 0,
                    extractedAtMs = 1L,
                    hadMsgTable = true,
                    hadSimpleUserTable = false,
                    schemaDriftWarnings = listOf(
                        "msg table missing required columns (have: id,foo,bar)",
                        "SIMPLE_USER table absent",
                    ),
                )
            val r = collector.snapshot()
            assertTrue(r is LocalSnapshotResult.Ok)
            val ok = r as LocalSnapshotResult.Ok
            val drift = ok.diagnosticFields["schemaDrift"]
            assertTrue(drift != null && drift.contains("msg table missing"))
            assertTrue(drift.contains("SIMPLE_USER table absent"))
        }

    @Test
    fun `snapshot NoRoot records error and returns NoRoot`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890123456789"
        coEvery { extractor.extract() } returns DouyinRootDbExtractor.ExtractResult.NoRoot
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.NoRoot)
        verify { credentialsStore.recordError(-10, any()) }
    }

    @Test
    fun `snapshot SourceDbMissing maps to ExtractFailed + records error`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890123456789"
        coEvery { extractor.extract() } returns
            DouyinRootDbExtractor.ExtractResult.SourceDbMissing
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("source-db-missing", ef.reason)
        assertTrue(ef.message != null && ef.message!!.contains("1234567890123456789"))
        verify { credentialsStore.recordError(-20, any()) }
    }

    @Test
    fun `snapshot CopyFailed propagates message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890123456789"
        coEvery { extractor.extract() } returns
            DouyinRootDbExtractor.ExtractResult.CopyFailed("su cp returned non-zero")
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("copy-failed", ef.reason)
        assertEquals("su cp returned non-zero", ef.message)
        verify { credentialsStore.recordError(-30, "su cp returned non-zero") }
    }

    @Test
    fun `snapshot Failed passes reason + message through verbatim`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUid() } returns "1234567890123456789"
        coEvery { extractor.extract() } returns
            DouyinRootDbExtractor.ExtractResult.Failed(
                reason = "open-error",
                message = "database disk image is malformed",
            )
        val r = collector.snapshot()
        assertTrue(r is LocalSnapshotResult.ExtractFailed)
        val ef = r as LocalSnapshotResult.ExtractFailed
        assertEquals("open-error", ef.reason)
        assertEquals("database disk image is malformed", ef.message)
        verify { credentialsStore.recordError(-99, "database disk image is malformed") }
    }
}
