package com.chainlesschain.android.pdh.social.bilibili

import android.content.Context
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * A8 v0.1 — JVM unit cover for [BilibiliLocalCollector] orchestration.
 *
 * Mocks the API client + credentials store + Context so the test can verify:
 *   - snapshot JSON shape matches SNAPSHOT_SCHEMA_VERSION=1 (the contract
 *     between Kotlin and packages/personal-data-hub/lib/adapters/social-
 *     bilibili/adapter.js — drift here = silent ingest failure)
 *   - all 4 kinds (history/favourite/dynamic/follow) round-trip into events
 *   - NoCredentials when not logged in
 *   - everythingEmpty=true surfaces correctly
 *   - one API throwing doesn't tank the others
 *   - acceptLoginCookie persists when DedeUserID present, refuses otherwise
 */
class BilibiliLocalCollectorTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var apiClient: BilibiliApiClient
    private lateinit var credentialsStore: BilibiliCredentialsStore
    private lateinit var collector: BilibiliLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "bili-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        apiClient = mockk()
        // f7e11d6a5 added lastErrorCode/lastErrorMessage reads in
        // SnapshotResult.Ok construction. Stub the strict mock so unrelated
        // tests don't trip on getLastErrorCode() during snapshot finalize.
        every { apiClient.lastErrorCode } returns 0
        every { apiClient.lastErrorMessage } returns null
        credentialsStore = mockk(relaxed = true)
        collector = BilibiliLocalCollector(
            context = context,
            apiClient = apiClient,
            credentialsStore = credentialsStore,
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    private fun stubCredentialsLoggedIn(uid: Long = 12345L) {
        every { credentialsStore.hasCredentials() } returns true
        // snapshot() now re-validates the stored cookie against REQUIRED_FIELDS
        // before doing any work (2026-05-24 fix for pre-2c8f41f9 cookies that
        // sailed through hasCredentials but lacked buvid3 / bili_jct). The
        // stubbed cookie must include all 4 fields or every snapshot test
        // routes to SnapshotResult.StaleCookie instead of the path under test.
        every { credentialsStore.getCookie() } returns
            "SESSDATA=fake; DedeUserID=$uid; bili_jct=jct$uid; buvid3=buvid-$uid"
        every { credentialsStore.getUid() } returns uid
        every { credentialsStore.getDisplayName() } returns "tester"
        every { credentialsStore.recordSync(any(), any()) } just runs
    }

    @Test
    fun `returns NoCredentials when not logged in`() = runTest {
        every { credentialsStore.hasCredentials() } returns false
        val result = collector.snapshot()
        assertTrue(result is BilibiliLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `writes snapshot with 4 kinds when all APIs succeed`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchHistory(any(), any()) } returns listOf(
            BilibiliApiClient.HistoryItem(
                bvid = "BV1abc", avid = 42, title = "Rust 异步",
                viewAt = 1715000000, duration = 600, uploader = "UpA", uploaderMid = 100,
                part = "01",
            )
        )
        coEvery { apiClient.fetchFavourites(any(), any(), any()) } returns listOf(
            BilibiliApiClient.FavouriteItem(
                bvid = "BV2def", title = "前端", savedAt = 1714000000L * 1000,
                folderName = "学习", uploader = "码农UP",
            )
        )
        coEvery { apiClient.fetchDynamics(any(), any()) } returns listOf(
            BilibiliApiClient.DynamicItem(
                rid = "999", summary = "新视频", dynamicType = "av",
                publishedAt = 1713000000L * 1000, authorMid = 200, authorName = "UP",
            )
        )
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns listOf(
            BilibiliApiClient.FollowItem(
                mid = 300, uname = "美食UP", face = "url", sign = "sig",
                followedAt = 1712000000L * 1000,
            )
        )

        val result = collector.snapshot()
        assertTrue(result is BilibiliLocalCollector.SnapshotResult.Ok)
        val ok = result as BilibiliLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.historyCount)
        assertEquals(1, ok.favouriteCount)
        assertEquals(1, ok.dynamicCount)
        assertEquals(1, ok.followCount)
        assertEquals(4, ok.totalEvents)
        assertFalse(ok.everythingEmpty)

        // Snapshot file written + JSON shape matches adapter contract
        val file = File(ok.snapshotPath)
        assertTrue(file.exists())
        val raw = JSONObject(file.readText(Charsets.UTF_8))
        assertEquals(1, raw.getInt("schemaVersion"))
        assertNotNull(raw.optJSONObject("account"))
        assertEquals("12345", raw.optJSONObject("account")!!.getString("uid"))
        val events = raw.getJSONArray("events")
        assertEquals(4, events.length())
        val kinds = (0 until events.length()).map { events.getJSONObject(it).getString("kind") }.sorted()
        assertEquals(listOf("dynamic", "favourite", "follow", "history"), kinds)

        // Verify recordSync called with non-zero values
        verify { credentialsStore.recordSync(any(), 4) }
    }

    @Test
    fun `everythingEmpty when all 4 APIs return empty`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchHistory(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFavourites(any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchDynamics(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns emptyList()

        val result = collector.snapshot()
        assertTrue(result is BilibiliLocalCollector.SnapshotResult.Ok)
        val ok = result as BilibiliLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.totalEvents)
        assertTrue(ok.everythingEmpty)
    }

    @Test
    fun `one API throwing does not tank the others`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchHistory(any(), any()) } throws RuntimeException("transient 5xx")
        coEvery { apiClient.fetchFavourites(any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchDynamics(any(), any()) } returns listOf(
            BilibiliApiClient.DynamicItem(
                rid = "x", summary = "ok", dynamicType = "av",
                publishedAt = 1L, authorMid = null, authorName = null,
            )
        )
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns emptyList()

        val result = collector.snapshot()
        assertTrue(result is BilibiliLocalCollector.SnapshotResult.Ok)
        val ok = result as BilibiliLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.historyCount) // crashed → 0
        assertEquals(1, ok.dynamicCount) // success → 1
        assertEquals(1, ok.totalEvents)
    }

    @Test
    fun `snapshot events have flat kind field expected by JS adapter`() = runTest {
        // Adapter's _syncViaSnapshot reads ev.kind directly off each event object.
        // Drift here = the JS adapter sees unknown kinds and silently drops them
        // (test for this contract).
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchHistory(any(), any()) } returns listOf(
            BilibiliApiClient.HistoryItem(
                bvid = "BV1", avid = 1, title = "t", viewAt = 100,
                duration = null, uploader = null, uploaderMid = null, part = null,
            )
        )
        coEvery { apiClient.fetchFavourites(any(), any(), any()) } returns emptyList()
        coEvery { apiClient.fetchDynamics(any(), any()) } returns emptyList()
        coEvery { apiClient.fetchFollows(any(), any(), any()) } returns emptyList()

        val result = collector.snapshot() as BilibiliLocalCollector.SnapshotResult.Ok
        val raw = JSONObject(File(result.snapshotPath).readText(Charsets.UTF_8))
        val events: JSONArray = raw.getJSONArray("events")
        val first = events.getJSONObject(0)
        // Must have flat kind, id, capturedAt — these are what adapter.js reads
        assertEquals("history", first.getString("kind"))
        assertEquals("BV1", first.getString("id"))
        assertTrue(first.has("capturedAt"))
        assertEquals("BV1", first.getString("bvid"))
        assertEquals("t", first.getString("title"))
    }

    // ─── acceptLoginCookie ──────────────────────────────────────────────────
    //
    // 2026-05-23: real-device Xiaomi 24115RA8EC exposed that DedeUserID alone
    // is not enough — Bilibili's anti-spider mode returns `{code:0, data:
    // {list:[]}}` (silent empty, no error code) when buvid3 / bili_jct are
    // missing. acceptLoginCookie now validates all 4 required fields up-front
    // and returns AcceptResult.MissingField with the missing key names so the
    // UI can prompt the user instead of silently storing a half-baked cookie.

    /** All 4 required Bilibili fields present in a single cookie string. */
    private val fullCookie =
        "SESSDATA=fakesess; DedeUserID=12345; bili_jct=jct123; buvid3=buvid-abc"

    @Test
    fun `acceptLoginCookie returns Ok and persists when all 4 required fields present`() {
        every { apiClient.extractUid(fullCookie) } returns 12345L
        every { credentialsStore.saveCredentials(any(), any(), any()) } just runs

        val r = collector.acceptLoginCookie(fullCookie)
        assertTrue(r is BilibiliLocalCollector.AcceptResult.Ok)
        verify { credentialsStore.saveCredentials(fullCookie, 12345L, null) }
    }

    @Test
    fun `acceptLoginCookie returns MissingField DedeUserID when DedeUserID absent`() {
        every { apiClient.extractUid("SESSDATA=expired") } returns null
        val r = collector.acceptLoginCookie("SESSDATA=expired")
        assertTrue(r is BilibiliLocalCollector.AcceptResult.MissingField)
        assertEquals("DedeUserID", (r as BilibiliLocalCollector.AcceptResult.MissingField).name)
        verify(exactly = 0) { credentialsStore.saveCredentials(any(), any(), any()) }
    }

    @Test
    fun `acceptLoginCookie returns MissingField buvid3 when only buvid3 missing`() {
        // DedeUserID parses fine; SESSDATA + bili_jct present; only buvid3 absent.
        // This is the exact 2026-05-23 real-device pattern: WebView captured
        // cookie right at onPageFinished before post-onload JS wrote buvid3.
        val cookie = "SESSDATA=fakesess; DedeUserID=12345; bili_jct=jct123"
        every { apiClient.extractUid(cookie) } returns 12345L

        val r = collector.acceptLoginCookie(cookie)
        assertTrue(r is BilibiliLocalCollector.AcceptResult.MissingField)
        assertEquals("buvid3", (r as BilibiliLocalCollector.AcceptResult.MissingField).name)
        verify(exactly = 0) { credentialsStore.saveCredentials(any(), any(), any()) }
    }

    @Test
    fun `acceptLoginCookie returns MissingField with comma-joined names when bili_jct and buvid3 both missing`() {
        val cookie = "SESSDATA=fakesess; DedeUserID=12345"
        every { apiClient.extractUid(cookie) } returns 12345L

        val r = collector.acceptLoginCookie(cookie)
        assertTrue(r is BilibiliLocalCollector.AcceptResult.MissingField)
        // Order follows REQUIRED_FIELDS declaration order: bili_jct then buvid3.
        assertEquals("bili_jct, buvid3", (r as BilibiliLocalCollector.AcceptResult.MissingField).name)
        verify(exactly = 0) { credentialsStore.saveCredentials(any(), any(), any()) }
    }

    @Test
    fun `acceptLoginCookie returns MissingField SESSDATA when SESSDATA blank`() {
        // Edge case: extractUid is lenient enough to pull "12345" out of the
        // DedeUserID even when SESSDATA is present-but-blank ("SESSDATA=;…").
        // Required-field check must catch this — a blank SESSDATA breaks API
        // auth same as a missing one.
        val cookie = "SESSDATA=; DedeUserID=12345; bili_jct=jct123; buvid3=buvid-abc"
        every { apiClient.extractUid(cookie) } returns 12345L

        val r = collector.acceptLoginCookie(cookie)
        assertTrue(r is BilibiliLocalCollector.AcceptResult.MissingField)
        assertEquals("SESSDATA", (r as BilibiliLocalCollector.AcceptResult.MissingField).name)
        verify(exactly = 0) { credentialsStore.saveCredentials(any(), any(), any()) }
    }

    @Test
    fun `logout clears credentials store`() {
        every { credentialsStore.clear() } just runs
        collector.logout()
        verify { credentialsStore.clear() }
    }

    // ─── clearIfStoredCookieStale + snapshot StaleCookie path ───────────────
    //
    // 2026-05-24 real-device follow-up: cookies saved on pre-2c8f41f9 APKs
    // (no AcceptResult validation) silently pass hasCredentials() and trip
    // "4 API empty" on every sync until manual logout. Re-validating at
    // snapshot entry self-heals: store is cleared, SnapshotResult.StaleCookie
    // surfaces a re-login prompt.

    @Test
    fun `clearIfStoredCookieStale returns null when not logged in`() {
        every { credentialsStore.hasCredentials() } returns false
        val r = collector.clearIfStoredCookieStale()
        kotlin.test.assertNull(r)
        verify(exactly = 0) { credentialsStore.clear() }
    }

    @Test
    fun `clearIfStoredCookieStale returns null when stored cookie has all 4 fields`() {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns fullCookie
        val r = collector.clearIfStoredCookieStale()
        kotlin.test.assertNull(r)
        verify(exactly = 0) { credentialsStore.clear() }
    }

    @Test
    fun `clearIfStoredCookieStale clears store and reports missing buvid3 when only buvid3 absent`() {
        // The exact pre-2c8f41f9 cookie shape — SESSDATA + DedeUserID + bili_jct
        // captured but buvid3 not yet set by post-onload XHR.
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns
            "SESSDATA=fake; DedeUserID=12345; bili_jct=jct123"
        every { credentialsStore.clear() } just runs

        val r = collector.clearIfStoredCookieStale()
        assertEquals("buvid3", r)
        verify(exactly = 1) { credentialsStore.clear() }
    }

    @Test
    fun `clearIfStoredCookieStale reports comma-joined names when bili_jct and buvid3 both absent`() {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns
            "SESSDATA=fake; DedeUserID=12345"
        every { credentialsStore.clear() } just runs

        val r = collector.clearIfStoredCookieStale()
        // Order follows REQUIRED_FIELDS declaration: SESSDATA / DedeUserID /
        // bili_jct / buvid3 — first two are present, last two missing.
        assertEquals("bili_jct, buvid3", r)
        verify(exactly = 1) { credentialsStore.clear() }
    }

    @Test
    fun `snapshot returns StaleCookie when stored cookie missing buvid3 AND clears store`() = runTest {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns
            "SESSDATA=fake; DedeUserID=12345; bili_jct=jct123"
        every { credentialsStore.clear() } just runs

        val result = collector.snapshot()
        assertTrue(result is BilibiliLocalCollector.SnapshotResult.StaleCookie)
        assertEquals(
            "buvid3",
            (result as BilibiliLocalCollector.SnapshotResult.StaleCookie).missingFields,
        )
        verify(exactly = 1) { credentialsStore.clear() }
        // Snapshot file NOT written; recordSync NOT called.
        verify(exactly = 0) { credentialsStore.recordSync(any(), any()) }
    }
}
