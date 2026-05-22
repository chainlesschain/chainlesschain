package com.chainlesschain.android.pdh.social.wechat

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
 * Phase 12.10.1 — JVM unit cover for [WeChatLocalCollector] orchestration.
 *
 * Covers the orchestration flow that doesn't depend on a real device:
 *   - NoCredentials short-circuit
 *   - NoRoot short-circuit
 *   - Frida path returning BinaryMissing maps to FridaInjectFailed
 *   - Frida path success → key persist → extract success → Ok with sync recorded
 *   - Frida path NOT triggered when keyProvider=md5 (Phase 12.10.2 7.x slice)
 *   - Extract failure maps to ExtractFailed
 *
 * The real frida injection + db extract paths are stubs (see
 * WeChatFridaInjector / WeChatDbExtractor) — those require a real rooted
 * device to verify, gated to Phase 12.10.4/6.
 */
class WeChatLocalCollectorTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var credentialsStore: WeChatCredentialsStore
    private lateinit var fridaInjector: WeChatFridaInjector
    private lateinit var dbExtractor: WeChatDbExtractor
    private lateinit var collector: WeChatLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "wechat-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        every { context.cacheDir } returns tempDir
        credentialsStore = mockk(relaxed = true)
        fridaInjector = mockk(relaxed = true)
        dbExtractor = mockk(relaxed = true)
        collector = WeChatLocalCollector(
            context = context,
            credentialsStore = credentialsStore,
            fridaInjector = fridaInjector,
            dbExtractor = dbExtractor,
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun `returns NoCredentials when store empty`() = runTest {
        every { credentialsStore.hasCredentials() } returns false
        val r = collector.snapshot()
        assertTrue(r is WeChatLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `returns NoCredentials when uin is null even if hasCredentials true`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns null
        val r = collector.snapshot()
        assertTrue(r is WeChatLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `returns NoRoot when su not available`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        coEvery { fridaInjector.isSuAvailable() } returns false
        val r = collector.snapshot()
        assertTrue(r is WeChatLocalCollector.SnapshotResult.NoRoot)
    }

    @Test
    fun `frida path with BinaryMissing maps to FridaInjectFailed`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        every { credentialsStore.getDbKeyHex() } returns null
        every { credentialsStore.getKeyProvider() } returns "frida"
        coEvery { fridaInjector.isSuAvailable() } returns true
        coEvery { fridaInjector.extractKey("1234567890") } returns
            WeChatFridaInjector.KeyResult.BinaryMissing

        val r = collector.snapshot() as WeChatLocalCollector.SnapshotResult.FridaInjectFailed
        assertEquals("binary-missing", r.reason)
    }

    @Test
    fun `frida path with PidofFailed maps to wechat-not-running reason`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        every { credentialsStore.getDbKeyHex() } returns null
        every { credentialsStore.getKeyProvider() } returns "frida"
        coEvery { fridaInjector.isSuAvailable() } returns true
        coEvery { fridaInjector.extractKey("1234567890") } returns
            WeChatFridaInjector.KeyResult.PidofFailed

        val r = collector.snapshot() as WeChatLocalCollector.SnapshotResult.FridaInjectFailed
        assertEquals("wechat-not-running", r.reason)
    }

    @Test
    fun `frida path with NoRoot maps to top-level NoRoot`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        every { credentialsStore.getDbKeyHex() } returns null
        every { credentialsStore.getKeyProvider() } returns "frida"
        coEvery { fridaInjector.isSuAvailable() } returns true
        coEvery { fridaInjector.extractKey("1234567890") } returns
            WeChatFridaInjector.KeyResult.NoRoot

        val r = collector.snapshot()
        assertTrue(r is WeChatLocalCollector.SnapshotResult.NoRoot)
    }

    @Test
    fun `md5 path skips frida even with null dbKeyHex`() = runTest {
        // Note: md5 path is Phase 12.10.2 7.x slice. With dbKeyHex=null + md5,
        // we still skip frida (it's not the right tool); we fall straight to
        // extract which (stubbed) returns NoDbKey.
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        every { credentialsStore.getDbKeyHex() } returns null
        every { credentialsStore.getKeyProvider() } returns "md5"
        coEvery { fridaInjector.isSuAvailable() } returns true
        coEvery { dbExtractor.extract() } returns WeChatDbExtractor.ExtractResult.NoDbKey

        val r = collector.snapshot()
        // dbKey missing on md5 path is a state-desync (should've been derived
        // at saveAccount time) — maps to a Failed result, not FridaInjectFailed.
        assertTrue(r is WeChatLocalCollector.SnapshotResult.Failed)
        verify(exactly = 0) { runBlocking { fridaInjector.extractKey(any()) } }
    }

    @Test
    fun `frida success → key persist → extract success → Ok with sync recorded`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        every { credentialsStore.getDbKeyHex() } returns null
        every { credentialsStore.getKeyProvider() } returns "frida"
        every { credentialsStore.setDbKeyHex(any()) } just runs
        every { credentialsStore.recordSync(any(), any()) } just runs

        coEvery { fridaInjector.isSuAvailable() } returns true
        val fakeKey = "a".repeat(64)
        coEvery { fridaInjector.extractKey("1234567890") } returns
            WeChatFridaInjector.KeyResult.Ok(dbKeyHex = fakeKey, durationMs = 1234L, source = "sqlite3_key_v2")

        val now = System.currentTimeMillis()
        coEvery { dbExtractor.extract() } returns WeChatDbExtractor.ExtractResult.Ok(
            stagingJsonPath = "$tempDir/wechat-staging.json",
            contactCount = 100,
            messageCount = 5000,
            chatroomCount = 10,
            totalRows = 5110,
            extractedAtMs = now,
            pragmaProfile = "wcdb-legacy",
        )

        val r = collector.snapshot() as WeChatLocalCollector.SnapshotResult.Ok
        assertEquals(5110, r.totalEvents)
        assertEquals(100, r.contactCount)
        assertEquals(5000, r.messageCount)
        assertEquals(10, r.chatroomCount)
        assertEquals("frida", r.keyProvider)
        assertEquals(now, r.snapshottedAt)
        verify { credentialsStore.setDbKeyHex(fakeKey) }
        verify { credentialsStore.recordSync(now, 5110) }
    }

    @Test
    fun `extract SourceDbMissing maps to ExtractFailed with hint`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        every { credentialsStore.getDbKeyHex() } returns "b".repeat(64)
        every { credentialsStore.getKeyProvider() } returns "frida"
        coEvery { fridaInjector.isSuAvailable() } returns true
        coEvery { dbExtractor.extract() } returns
            WeChatDbExtractor.ExtractResult.SourceDbMissing

        val r = collector.snapshot() as WeChatLocalCollector.SnapshotResult.ExtractFailed
        assertEquals("source-db-missing", r.reason)
    }

    @Test
    fun `extract DecryptFailed propagates message`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getUin() } returns "1234567890"
        every { credentialsStore.getDbKeyHex() } returns "c".repeat(64)
        every { credentialsStore.getKeyProvider() } returns "frida"
        coEvery { fridaInjector.isSuAvailable() } returns true
        coEvery { dbExtractor.extract() } returns
            WeChatDbExtractor.ExtractResult.DecryptFailed("file is not a database")

        val r = collector.snapshot() as WeChatLocalCollector.SnapshotResult.ExtractFailed
        assertEquals("decrypt-failed", r.reason)
        assertEquals("file is not a database", r.message)
    }
}

// Required for verify(exactly = 0) { runBlocking { ... } } in the md5 path test
private fun runBlocking(block: suspend () -> Unit) = kotlinx.coroutines.runBlocking { block() }
