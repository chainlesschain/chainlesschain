package com.chainlesschain.android.pdh.social.douyin

import android.content.Context
import io.mockk.coEvery
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.test.runTest
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
 * §A8 v0.2 — JVM unit cover for [DouyinLocalCollector] orchestration.
 *
 * Mirrors WeiboLocalCollectorTest. Verifies:
 *   - snapshot JSON shape matches SNAPSHOT_SCHEMA_VERSION=1 (the contract
 *     between Kotlin and packages/personal-data-hub/lib/adapters/social-douyin
 *     /index.js _syncViaSnapshot — drift here = silent ingest failure)
 *   - profile kind round-trips into events when fetchProfile succeeds
 *   - NoCredentials when not logged in
 *   - everythingEmpty=true when fetchProfile fails (cookie expired etc.)
 *   - acceptLoginCookie persists when fetchProfile returns ProfileInfo, refuses
 *     otherwise (key behavior diff from Bilibili: sec_user_id needs HTTP
 *     roundtrip and is not derivable from cookie)
 */
class DouyinLocalCollectorTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var apiClient: DouyinApiClient
    private lateinit var credentialsStore: DouyinCredentialsStore
    private lateinit var collector: DouyinLocalCollector

    @Before
    fun setUp() {
        tempDir = createTempDir(prefix = "douyin-collector-")
        context = mockk()
        every { context.filesDir } returns tempDir
        apiClient = mockk()
        // Collector reads apiClient.lastErrorCode + lastErrorMessage to surface
        // status_code=2154 (cookie expired) vs HTTP / IO error distinctions.
        // Stub default zero/null so unstubbed code paths don't throw.
        every { apiClient.lastErrorCode } returns 0
        every { apiClient.lastErrorMessage } returns null
        credentialsStore = mockk(relaxed = true)
        collector = DouyinLocalCollector(
            context = context,
            apiClient = apiClient,
            credentialsStore = credentialsStore,
        )
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    private fun stubCredentialsLoggedIn(
        secUid: String = "MS4wLjABAAAA_alice",
        shortId: String? = "12345678",
    ) {
        every { credentialsStore.hasCredentials() } returns true
        every { credentialsStore.getCookie() } returns "sessionid=x; sid_guard=y; uid_tt=z"
        every { credentialsStore.getSecUid() } returns secUid
        every { credentialsStore.getShortId() } returns shortId
        every { credentialsStore.getDisplayName() } returns "alice"
        every { credentialsStore.recordSync(any(), any()) } just runs
    }

    @Test
    fun `returns NoCredentials when not logged in`() = runTest {
        every { credentialsStore.hasCredentials() } returns false
        val result = collector.snapshot()
        assertTrue(result is DouyinLocalCollector.SnapshotResult.NoCredentials)
    }

    @Test
    fun `writes snapshot with 1 profile event when fetchProfile succeeds`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchProfile(any()) } returns DouyinApiClient.ProfileInfo(
            secUid = "MS4wLjABAAAA_alice",
            shortId = "12345678",
            nickname = "alice",
            signature = "hello world",
            avatarUrl = "https://example.com/a.jpg",
            followingCount = 100,
            followerCount = 200,
            awemeCount = 5,
            favoritingCount = 30,
            totalFavorited = 1500,
        )

        val result = collector.snapshot()
        assertTrue(result is DouyinLocalCollector.SnapshotResult.Ok)
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        assertEquals(1, ok.profileCount)
        assertEquals(1, ok.totalEvents)
        assertFalse(ok.everythingEmpty)

        val file = File(ok.snapshotPath)
        assertTrue(file.exists())
        val raw = JSONObject(file.readText(Charsets.UTF_8))
        assertEquals(1, raw.getInt("schemaVersion"))
        assertNotNull(raw.optJSONObject("account"))
        assertEquals("MS4wLjABAAAA_alice", raw.optJSONObject("account")!!.getString("secUid"))
        assertEquals("12345678", raw.optJSONObject("account")!!.getString("shortId"))
        val events = raw.getJSONArray("events")
        assertEquals(1, events.length())
        val first = events.getJSONObject(0)
        assertEquals("profile", first.getString("kind"))
        assertEquals("profile-MS4wLjABAAAA_alice", first.getString("id"))
        assertEquals("alice", first.getString("nickname"))
        assertEquals("hello world", first.getString("signature"))
        assertEquals(200, first.getInt("followerCount"))
        assertEquals(1500, first.getInt("totalFavorited"))

        verify { credentialsStore.recordSync(any(), 1) }
    }

    @Test
    fun `everythingEmpty when fetchProfile returns null`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchProfile(any()) } returns null
        // Surface upstream cookie-expired hint via lastError*
        every { apiClient.lastErrorCode } returns 2154
        every { apiClient.lastErrorMessage } returns "token expired"

        val result = collector.snapshot()
        assertTrue(result is DouyinLocalCollector.SnapshotResult.Ok)
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.profileCount)
        assertEquals(0, ok.totalEvents)
        assertTrue(ok.everythingEmpty)
        assertEquals(2154, ok.lastErrorCode)
        assertEquals("token expired", ok.lastErrorMessage)
    }

    @Test
    fun `fetchProfile throwing does not crash collector`() = runTest {
        stubCredentialsLoggedIn()
        coEvery { apiClient.fetchProfile(any()) } throws RuntimeException("transient 5xx")

        val result = collector.snapshot()
        assertTrue(result is DouyinLocalCollector.SnapshotResult.Ok)
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        assertEquals(0, ok.profileCount)
        assertTrue(ok.everythingEmpty)
    }

    @Test
    fun `snapshot account falls back to stored secUid when fetchProfile null`() = runTest {
        stubCredentialsLoggedIn(secUid = "MS4wLjABAAAA_stored")
        coEvery { apiClient.fetchProfile(any()) } returns null

        val result = collector.snapshot()
        assertTrue(result is DouyinLocalCollector.SnapshotResult.Ok)
        val ok = result as DouyinLocalCollector.SnapshotResult.Ok
        val raw = JSONObject(File(ok.snapshotPath).readText(Charsets.UTF_8))
        // Account section still carries the secUid from store so a follow-up
        // sync (after re-login) doesn't lose the user identity in audit history.
        assertEquals("MS4wLjABAAAA_stored", raw.optJSONObject("account")!!.getString("secUid"))
    }

    // ─── acceptLoginCookie (suspend — key diff from Bilibili) ──────────────

    @Test
    fun `acceptLoginCookie returns true and persists when fetchProfile succeeds`() = runTest {
        coEvery { apiClient.fetchProfile("sessionid=x; sid_guard=y") } returns
            DouyinApiClient.ProfileInfo(
                secUid = "MS4wLjABAAAA_new",
                shortId = "99887766",
                nickname = "newbie",
                signature = null,
                avatarUrl = null,
                followingCount = 0,
                followerCount = 0,
                awemeCount = 0,
                favoritingCount = 0,
                totalFavorited = 0,
            )
        every {
            credentialsStore.saveCredentials(any(), any(), any(), any())
        } just runs

        val ok = collector.acceptLoginCookie("sessionid=x; sid_guard=y", null)
        assertTrue(ok)
        verify {
            credentialsStore.saveCredentials(
                "sessionid=x; sid_guard=y",
                "MS4wLjABAAAA_new",
                "99887766",
                "newbie",
            )
        }
    }

    @Test
    fun `acceptLoginCookie returns false when fetchProfile returns null`() = runTest {
        coEvery { apiClient.fetchProfile("sessionid=expired") } returns null
        val ok = collector.acceptLoginCookie("sessionid=expired", null)
        assertFalse(ok)
        verify(exactly = 0) {
            credentialsStore.saveCredentials(any(), any(), any(), any())
        }
    }

    @Test
    fun `acceptLoginCookie falls back to cookie shortId when API does not return one`() = runTest {
        // Some passport/info/v2 responses omit short_id. The collector should
        // best-effort fill from cookie's sid_uid_tt field.
        coEvery {
            apiClient.fetchProfile("sid_uid_tt=44332211; sessionid=x")
        } returns DouyinApiClient.ProfileInfo(
            secUid = "MS4wLjABAAAA_noshort",
            shortId = null,  // <-- API didn't give one
            nickname = "ns",
            signature = null,
            avatarUrl = null,
            followingCount = 0,
            followerCount = 0,
            awemeCount = 0,
            favoritingCount = 0,
            totalFavorited = 0,
        )

        val ok = collector.acceptLoginCookie("sid_uid_tt=44332211; sessionid=x", null)
        assertTrue(ok)
        verify {
            credentialsStore.saveCredentials(
                "sid_uid_tt=44332211; sessionid=x",
                "MS4wLjABAAAA_noshort",
                "44332211", // <-- pulled from cookie
                "ns",
            )
        }
    }

    @Test
    fun `logout clears credentials store`() {
        every { credentialsStore.clear() } just runs
        collector.logout()
        verify { credentialsStore.clear() }
    }
}
