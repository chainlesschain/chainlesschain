package com.chainlesschain.android.pdh.social.xiaohongshu

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
 * §A8 v0.2 debug instrumentation — fetchMe error-classification cover.
 *
 * Mirrors DouyinApiClientFetchProfileTest. The hardcoded
 * "cookie 缺 a1 字段或 /user/me 调用失败" UI string used to swallow 4+ distinct
 * failure modes. Each branch now sets a distinct lastErrorCode so the UI
 * (HubLocalViewModel.onXhsLoginCookie) can surface what actually happened.
 *
 * Codes (apiClient side — collector adds -10 for missing-a1 pre-flight):
 *   - upstream code (e.g. 461 X-S signature fail) — doGetJson sets, preserved
 *   - 4xx/5xx — doGetJson sets HTTP code
 *   - -4 — non-JSON body (anti-bot HTML redirect)
 *   - -5 — JSON has success=false but no code field (shape drift, defensive)
 *   - -6 — success=true + code=0 but no `data` object
 *   - -7 — success=true + code=0 + data present but user_id blank
 */
class XhsApiClientFetchMeTest {

    private lateinit var server: MockWebServer
    private lateinit var client: XhsApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = XhsApiClient().apply {
            baseUrl = server.url("/").toString().toHttpUrl()
            httpClient = OkHttpClient.Builder().build()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun `success populates MeResult and clears lastError`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "success": true,
                  "code": 0,
                  "data": {
                    "user_id": "5e8c8f7e0000000000abcdef",
                    "nickname": "alice"
                  }
                }
                """.trimIndent()
            )
        )
        val me = client.fetchMe("web_session=ok; a1=fp")
        assertNotNull(me)
        assertEquals("5e8c8f7e0000000000abcdef", me!!.userId)
        assertEquals("alice", me.nickname)
        assertEquals(0, client.lastErrorCode)
        assertNull(client.lastErrorMessage)
    }

    @Test
    fun `upstream code 461 surfaces verbatim (X-S signature fail or anti-bot ban)`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"success":false,"code":461,"msg":"X-S verify failed"}"""
            )
        )
        assertNull(client.fetchMe("web_session=ok; a1=fp"))
        assertEquals(461, client.lastErrorCode)
        assertEquals("X-S verify failed", client.lastErrorMessage)
    }

    @Test
    fun `HTTP 401 from xhs server is surfaced as code 401`() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("Unauthorized"))
        assertNull(client.fetchMe("web_session=expired; a1=fp"))
        assertEquals(401, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("HTTP 401"))
    }

    @Test
    fun `non-JSON body from anti-bot redirect surfaces code -4`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                "<html><body>请登录</body></html>"
            ).setHeader("Content-Type", "text/html")
        )
        assertNull(client.fetchMe("web_session=stale; a1=fp"))
        assertEquals(-4, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("non-json"))
    }

    @Test
    fun `success+code 0 but no data object yields code -6`() = runTest {
        server.enqueue(MockResponse().setBody("""{"success":true,"code":0}"""))
        assertNull(client.fetchMe("web_session=x; a1=fp"))
        assertEquals(-6, client.lastErrorCode)
        assertNotNull(client.lastErrorMessage)
        assertTrue(client.lastErrorMessage!!.contains("no `data`"))
    }

    @Test
    fun `success+code 0 but user_id blank yields code -7 with dataKeys`() = runTest {
        // The most actionable symptom: cookie has a1 but lacks web_session,
        // so xhs returns 200 ok but only echoes anonymous device fields.
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "success": true,
                  "code": 0,
                  "data": {
                    "nickname": "",
                    "fans": 0,
                    "follows": 0
                  }
                }
                """.trimIndent()
            )
        )
        assertNull(client.fetchMe("web_session=missing; a1=fp"))
        assertEquals(-7, client.lastErrorCode)
        val msg = client.lastErrorMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("user_id blank"), "expected user_id mention; got: $msg")
        assertTrue(msg.contains("web_session"), "expected web_session hint; got: $msg")
        assertTrue(msg.contains("nickname") || msg.contains("fans") || msg.contains("follows"),
            "expected dataKeys hint; got: $msg")
    }

    @Test
    fun `user_id present-but-empty-string yields code -7 (not silent success)`() = runTest {
        // Defensive: optString returns "" when the value is JSON null or empty;
        // ensure the blank-check at line 113 (was line 111) catches both.
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "success": true,
                  "code": 0,
                  "data": {
                    "user_id": "",
                    "nickname": "alice"
                  }
                }
                """.trimIndent()
            )
        )
        assertNull(client.fetchMe("web_session=weird; a1=fp"))
        assertEquals(-7, client.lastErrorCode)
    }
}
