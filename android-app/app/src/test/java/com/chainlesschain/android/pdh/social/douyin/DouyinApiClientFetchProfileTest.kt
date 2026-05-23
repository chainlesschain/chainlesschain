package com.chainlesschain.android.pdh.social.douyin

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
 * §A8 v0.2 debug instrumentation — fetchProfile error-classification cover.
 *
 * The hardcoded "未返 sec_user_id" UI string used to swallow 5 distinct
 * failure modes. Each branch now sets a distinct lastErrorCode so the UI
 * (HubLocalViewModel.onDouyinLoginCookie) can surface what actually happened.
 *
 * Codes:
 *   - 2154 (or whatever upstream returns) — status_code != 0 (e.g. token expired)
 *   - -4 — non-JSON body (already covered in doGetJson, anti-bot HTML redirect)
 *   - -5 — JSON parsed but no status_code field (endpoint shape drift)
 *   - -6 — status_code=0 but no `data` object
 *   - -7 — status_code=0 + data present but lacks sec_user_id (anonymous shape)
 */
class DouyinApiClientFetchProfileTest {

    private lateinit var server: MockWebServer
    private lateinit var client: DouyinApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = DouyinApiClient().apply {
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
                    "sec_user_id": "MS4wLjABAAAA_alice",
                    "short_id": "12345678",
                    "screen_name": "alice",
                    "signature": "hi"
                  }
                }
                """.trimIndent()
            )
        )
        val profile = client.fetchProfile("sessionid=ok; sid_guard=g")
        assertNotNull(profile)
        assertEquals("MS4wLjABAAAA_alice", profile!!.secUid)
        assertEquals("alice", profile.nickname)
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
        assertNull(client.fetchProfile("sessionid=expired"))
        assertEquals(2154, client.lastErrorCode)
        assertEquals("token expired", client.lastErrorMessage)
    }

    @Test
    fun `status_code missing entirely yields code -5 with top-level keys`() = runTest {
        // Endpoint shape drift — Douyin sometimes moves to ok/message/error_code.
        server.enqueue(
            MockResponse().setBody(
                """{"ok":true,"message":"redirect","next":"/login"}"""
            )
        )
        assertNull(client.fetchProfile("sessionid=stale"))
        assertEquals(-5, client.lastErrorCode)
        val msg = client.lastErrorMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("missing status_code"), "expected drift hint; got: $msg")
        assertTrue(msg.contains("ok"), "expected key list in error msg; got: $msg")
    }

    @Test
    fun `status_code 0 but no data yields code -6`() = runTest {
        server.enqueue(MockResponse().setBody("""{"status_code":0}"""))
        assertNull(client.fetchProfile("sessionid=x"))
        assertEquals(-6, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("no `data`"))
    }

    @Test
    fun `status_code 0 but data lacks sec_user_id yields code -7 with dataKeys`() = runTest {
        // The user's actual symptom: passport returns 200 ok with anonymous-
        // shape data (just device fields) when cookie lacks sessionid.
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
        assertNull(client.fetchProfile("sessionid=incomplete"))
        assertEquals(-7, client.lastErrorCode)
        val msg = client.lastErrorMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("sec_user_id"), "expected sec_user_id mention; got: $msg")
        assertTrue(msg.contains("device_id"), "expected dataKeys hint; got: $msg")
        assertTrue(msg.contains("install_id"), "expected dataKeys hint; got: $msg")
    }

    @Test
    fun `accepts sec_uid alias when sec_user_id missing`() = runTest {
        // Older passport responses use sec_uid; treat as equivalent.
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status_code": 0,
                  "data": {
                    "sec_uid": "MS4wLjABAAAA_legacy",
                    "screen_name": "bob"
                  }
                }
                """.trimIndent()
            )
        )
        val profile = client.fetchProfile("sessionid=ok")
        assertNotNull(profile)
        assertEquals("MS4wLjABAAAA_legacy", profile!!.secUid)
        assertEquals(0, client.lastErrorCode)
    }
}
