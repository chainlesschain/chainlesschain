package com.chainlesschain.android.pdh.social.toutiao

import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §A8 v0.2 — fetchProfile error-classification cover for Toutiao.
 *
 * Parallel to DouyinApiClientFetchProfileTest. Each branch sets a distinct
 * lastErrorCode so the UI (HubLocalViewModel.onToutiaoLoginCookie) can
 * surface what actually happened instead of the catch-all "登录未完成".
 *
 * Codes:
 *   - 2154 (or whatever upstream returns) — status_code != 0 (e.g. token expired)
 *   - -4 — non-JSON body (covered in [ToutiaoApiClientIntegrationTest])
 *   - -5 — JSON parsed but no status_code field (endpoint shape drift)
 *   - -6 — status_code=0 but no `data` object
 *   - -7 — status_code=0 + data present but lacks user_id (anonymous shape)
 */
class ToutiaoApiClientFetchProfileTest {

    private lateinit var server: MockWebServer
    private lateinit var client: ToutiaoApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = ToutiaoApiClient().apply {
            baseUrl = server.url("/").toString().toHttpUrl()
            httpClient = OkHttpClient.Builder().build()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `success populates ProfileInfo and clears lastError`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status_code": 0,
                  "data": {
                    "user_id": "99999",
                    "screen_name": "alice",
                    "avatar_url": "https://p.toutiao.com/u/alice.jpg",
                    "description": "hi",
                    "following_count": 12,
                    "followers_count": 34,
                    "media_id": "1234567890"
                  }
                }
                """.trimIndent()
            )
        )
        val profile = client.fetchProfile("passport_uid=99999; sessionid=ok")
        assertNotNull(profile)
        assertEquals("99999", profile!!.uid)
        assertEquals("alice", profile.nickname)
        assertEquals("https://p.toutiao.com/u/alice.jpg", profile.avatarUrl)
        assertEquals("hi", profile.description)
        assertEquals(12, profile.followingCount)
        assertEquals(34, profile.followerCount)
        assertEquals("1234567890", profile.mediaId)
        assertEquals(0, client.lastErrorCode)
        assertNull(client.lastErrorMessage)
    }

    @Test
    fun `status_code non-zero surfaces upstream code and status_msg`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"status_code":2154,"status_msg":"token expired"}"""
            )
        )
        assertNull(client.fetchProfile("passport_uid=99999; sessionid=expired"))
        assertEquals(2154, client.lastErrorCode)
        assertEquals("token expired", client.lastErrorMessage)
    }

    @Test
    fun `status_code missing entirely yields code -5 with top-level keys`() = runTest {
        // Endpoint shape drift — Toutiao occasionally returns
        // `{ok: true, message: ...}` instead of the canonical passport shape.
        server.enqueue(
            MockResponse().setBody(
                """{"ok":true,"message":"redirect","next":"/login"}"""
            )
        )
        assertNull(client.fetchProfile("passport_uid=99999"))
        assertEquals(-5, client.lastErrorCode)
        val msg = client.lastErrorMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("missing status_code"), "expected drift hint; got: $msg")
        assertTrue(msg.contains("ok"), "expected key list in error msg; got: $msg")
    }

    @Test
    fun `status_code 0 but no data yields code -6`() = runTest {
        server.enqueue(MockResponse().setBody("""{"status_code":0}"""))
        assertNull(client.fetchProfile("passport_uid=99999"))
        assertEquals(-6, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("no `data`"))
    }

    @Test
    fun `status_code 0 but data lacks user_id yields code -7 with dataKeys`() = runTest {
        // Anonymous-shape response: passport returns 200 ok with only device
        // fields when cookie lacks sessionid / passport_csrf_token. dataKeys
        // exposed in error message for UI debug.
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status_code": 0,
                  "data": {
                    "device_id": "abc",
                    "install_id": "def",
                    "ttwid": "tt-xyz"
                  }
                }
                """.trimIndent()
            )
        )
        assertNull(client.fetchProfile("tt_webid=anon-only"))
        assertEquals(-7, client.lastErrorCode)
        val msg = client.lastErrorMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("user_id"), "expected user_id mention; got: $msg")
        assertTrue(msg.contains("device_id"), "expected dataKeys hint; got: $msg")
        assertTrue(msg.contains("install_id"), "expected dataKeys hint; got: $msg")
    }

    @Test
    fun `accepts numeric user_id_str field as alias`() = runTest {
        // ByteDance passport endpoints sometimes return user_id_str as a numeric
        // wrapped in string. Treat as equivalent.
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status_code": 0,
                  "data": {
                    "user_id_str": "888777666",
                    "screen_name": "bob"
                  }
                }
                """.trimIndent()
            )
        )
        val profile = client.fetchProfile("passport_uid=888777666")
        assertNotNull(profile)
        assertEquals("888777666", profile!!.uid)
        assertEquals("bob", profile.nickname)
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun `falls back to name field when screen_name missing`() = runTest {
        // Legacy passport response uses `name` instead of `screen_name`.
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status_code": 0,
                  "data": {
                    "user_id": "555",
                    "name": "carol-legacy"
                  }
                }
                """.trimIndent()
            )
        )
        val profile = client.fetchProfile("passport_uid=555")
        assertNotNull(profile)
        assertEquals("555", profile!!.uid)
        assertEquals("carol-legacy", profile.nickname)
    }
}
