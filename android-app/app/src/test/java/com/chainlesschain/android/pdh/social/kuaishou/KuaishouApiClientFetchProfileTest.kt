package com.chainlesschain.android.pdh.social.kuaishou

import kotlinx.coroutines.test.runTest
import org.junit.Test
import java.net.URLEncoder
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §A8 v0.2 — Kuaishou fetchProfile cover.
 *
 * Kuaishou v0.2 fetchProfile is **cookie-parse only** (no HTTP) — it pulls
 * the `kuaishou.web.cp.api_ph` cookie field which is a URL-encoded JSON
 * carrying user_id / user_name / kuaishou_id / headurl / sex / city. No
 * MockWebServer needed.
 *
 * v0.3 will add real HTTP calls via NS_sig3 signed GraphQL; at that time
 * MockWebServer integration tests like Douyin/Toutiao will be added here.
 *
 * Error codes:
 *   - -1 — cookie empty
 *   - -3 — JSON parse error
 *   - -7 — JSON parsed but no user_id field
 *   - -8 — cookie missing kuaishou.web.cp.api_ph entirely
 *   - -9 — api_ph present but decoded value is not JSON (likely base64 — v0.3)
 */
class KuaishouApiClientFetchProfileTest {

    private val client = KuaishouApiClient()

    /** Helper: wrap a JSON string as URL-encoded api_ph cookie pair. */
    private fun apiPhCookie(jsonPayload: String, otherFields: String = ""): String {
        val encoded = URLEncoder.encode(jsonPayload, "UTF-8")
        val parts = mutableListOf("kuaishou.web.cp.api_ph=$encoded")
        if (otherFields.isNotBlank()) parts.add(otherFields)
        return parts.joinToString("; ")
    }

    // ─── Success path ──────────────────────────────────────────────────────

    @Test
    fun `fetchProfile parses full api_ph payload`() = runTest {
        val cookie = apiPhCookie(
            """{"user_id":77777,"user_name":"alice","kuaishou_id":"alice_KS","headurl":"https://p.kuaishou.com/u/alice.jpg","sex":"F","city":"Shanghai","constellation":"Libra","description":"hi"}""",
            "userId=77777; did=abc",
        )
        val profile = client.fetchProfile(cookie)
        assertNotNull(profile)
        assertEquals("77777", profile!!.uid)
        assertEquals("alice", profile.nickname)
        assertEquals("alice_KS", profile.kuaishouId)
        assertEquals("https://p.kuaishou.com/u/alice.jpg", profile.avatarUrl)
        assertEquals("F", profile.sex)
        assertEquals("Shanghai", profile.city)
        assertEquals("Libra", profile.constellation)
        assertEquals("hi", profile.description)
        assertEquals(0, client.lastErrorCode)
        assertNull(client.lastErrorMessage)
    }

    @Test
    fun `fetchProfile accepts userName camelCase fallback`() = runTest {
        // Legacy api_ph payload variants use camelCase keys (userName / userId / headUrl).
        val cookie = apiPhCookie("""{"userId":555,"userName":"bob","headUrl":"https://p/x.jpg"}""")
        val profile = client.fetchProfile(cookie)
        assertNotNull(profile)
        assertEquals("555", profile!!.uid)
        assertEquals("bob", profile.nickname)
        assertEquals("https://p/x.jpg", profile.avatarUrl)
    }

    @Test
    fun `fetchProfile accepts string user_id`() = runTest {
        // Some payloads stringify user_id ("user_id":"333")
        val cookie = apiPhCookie("""{"user_id":"333","user_name":"carol"}""")
        val profile = client.fetchProfile(cookie)
        assertNotNull(profile)
        assertEquals("333", profile!!.uid)
        assertEquals("carol", profile.nickname)
    }

    @Test
    fun `fetchProfile falls back to nickname when user_name missing`() = runTest {
        // Older variants emit nickname instead of user_name.
        val cookie = apiPhCookie("""{"user_id":111,"nickname":"dave"}""")
        val profile = client.fetchProfile(cookie)
        assertNotNull(profile)
        assertEquals("111", profile!!.uid)
        assertEquals("dave", profile.nickname)
    }

    @Test
    fun `fetchProfile labels nickname unnamed when no name fields present`() = runTest {
        val cookie = apiPhCookie("""{"user_id":222}""")
        val profile = client.fetchProfile(cookie)
        assertNotNull(profile)
        assertEquals("222", profile!!.uid)
        assertEquals("(unnamed)", profile.nickname)
    }

    // ─── Error branches ─────────────────────────────────────────────────────

    @Test
    fun `fetchProfile empty cookie sets code -1`() = runTest {
        assertNull(client.fetchProfile(""))
        assertEquals(-1, client.lastErrorCode)
    }

    @Test
    fun `fetchProfile cookie without api_ph sets code -8`() = runTest {
        // userId-only login state (some cross-app login flows skip the api_ph
        // write). uid extractable but profile detail unavailable until v0.3.
        assertNull(client.fetchProfile("userId=44444; did=anon; kpf=PC_WEB"))
        assertEquals(-8, client.lastErrorCode)
        assertTrue(client.lastErrorMessage!!.contains("api_ph"))
    }

    @Test
    fun `fetchProfile api_ph not JSON sets code -9`() = runTest {
        // api_ph value sometimes turns into base64 / opaque token — fall through
        // to -9 so v0.3 can add a base64-decode fallback path.
        val opaqueValue = URLEncoder.encode("base64Like+/Token=", "UTF-8")
        val cookie = "kuaishou.web.cp.api_ph=$opaqueValue; userId=99"
        assertNull(client.fetchProfile(cookie))
        assertEquals(-9, client.lastErrorCode)
        assertTrue(client.lastErrorMessage!!.contains("non JSON") ||
            client.lastErrorMessage!!.contains("非 JSON"))
    }

    @Test
    fun `fetchProfile api_ph JSON missing user_id sets code -7 with keys`() = runTest {
        val cookie = apiPhCookie("""{"sex":"F","city":"Beijing","headurl":"x"}""")
        assertNull(client.fetchProfile(cookie))
        assertEquals(-7, client.lastErrorCode)
        val msg = client.lastErrorMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("user_id"))
        assertTrue(msg.contains("sex"), "expected keys list: $msg")
        assertTrue(msg.contains("city"), "expected keys list: $msg")
    }

    @Test
    fun `fetchProfile malformed JSON in api_ph sets code -3`() = runTest {
        // Truncated / corrupt JSON inside api_ph.
        val cookie = "kuaishou.web.cp.api_ph=" + URLEncoder.encode("{\"user_id\":111,", "UTF-8")
        assertNull(client.fetchProfile(cookie))
        assertEquals(-3, client.lastErrorCode)
        assertTrue(client.lastErrorMessage!!.startsWith("parse:"))
    }

    @Test
    fun `fetchProfile user_id zero treated as missing -7`() = runTest {
        // user_id=0 is not a real account (some preview / guest states).
        val cookie = apiPhCookie("""{"user_id":0,"user_name":"guest"}""")
        assertNull(client.fetchProfile(cookie))
        assertEquals(-7, client.lastErrorCode)
    }

    // ─── extractUid pure-cookie shortcut (unchanged from v0.1) ──────────────

    @Test
    fun `extractUid pulls userId from cookie`() {
        val uid = client.extractUid("userId=99999; did=abc")
        assertEquals("99999", uid)
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun `extractUid falls back to api_ph embedded user_id`() {
        // When the simple `userId=` cookie is absent but api_ph is present.
        val cookie = apiPhCookie("""{"user_id":12345,"user_name":"x"}""")
        // strip the userId= prefix to force api_ph fallback
        val uid = client.extractUid(cookie)
        assertEquals("12345", uid)
    }

    @Test
    fun `extractUid returns null on anonymous cookie + sets code -7`() {
        assertNull(client.extractUid("did=anon-only; kpf=PC_WEB; kpn=KUAISHOU_VISION"))
        assertEquals(-7, client.lastErrorCode)
    }

    @Test
    fun `extractUid handles userId=0 as missing`() {
        // Some session states write userId=0 — treat as anonymous.
        assertNull(client.extractUid("userId=0; did=abc"))
        assertEquals(-7, client.lastErrorCode)
    }
}
