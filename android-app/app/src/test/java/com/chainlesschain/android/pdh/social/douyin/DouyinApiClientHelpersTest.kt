package com.chainlesschain.android.pdh.social.douyin

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * §A8 v0.2 — DouyinApiClient companion helpers (extractShortIdFromCookie).
 *
 * Full HTTP path test requires MockWebServer (Robolectric) — kept light here
 * because the JSON parse logic is exercised by DouyinLocalCollectorTest via
 * coEvery stubs on the suspend fetchProfile.
 */
class DouyinApiClientHelpersTest {

    @Test
    fun `extractShortIdFromCookie returns null on blank input`() {
        assertNull(DouyinApiClient.extractShortIdFromCookie(null))
        assertNull(DouyinApiClient.extractShortIdFromCookie(""))
        assertNull(DouyinApiClient.extractShortIdFromCookie("   "))
    }

    @Test
    fun `extractShortIdFromCookie matches sid_uid_tt numeric field`() {
        val cookie = "ttwid=abc; sid_uid_tt=12345678; sessionid=xyz"
        assertEquals("12345678", DouyinApiClient.extractShortIdFromCookie(cookie))
    }

    @Test
    fun `extractShortIdFromCookie matches uid_tt numeric field`() {
        // Some sessions only carry uid_tt; if it happens to be numeric, accept.
        val cookie = "ttwid=abc; uid_tt=87654321"
        assertEquals("87654321", DouyinApiClient.extractShortIdFromCookie(cookie))
    }

    @Test
    fun `extractShortIdFromCookie returns null when uid_tt is hex not numeric`() {
        // Real uid_tt is typically 32-char hex which we cannot parse as short id.
        val cookie = "ttwid=abc; uid_tt=a1b2c3d4e5f6a7b8"
        assertNull(DouyinApiClient.extractShortIdFromCookie(cookie))
    }

    @Test
    fun `extractShortIdFromCookie matches aweme_user_id numeric field`() {
        val cookie = "aweme_user_id=99887766; other=value"
        assertEquals("99887766", DouyinApiClient.extractShortIdFromCookie(cookie))
    }

    @Test
    fun `extractShortIdFromCookie returns null when no candidate field present`() {
        val cookie = "ttwid=abc; sessionid=xyz; sid_guard=guard"
        assertNull(DouyinApiClient.extractShortIdFromCookie(cookie))
    }

    @Test
    fun `extractShortIdFromCookie prefers first match in order`() {
        // sid_uid_tt comes first in the regex alternation, so it wins.
        val cookie = "sid_uid_tt=11111111; aweme_user_id=22222222"
        assertEquals("11111111", DouyinApiClient.extractShortIdFromCookie(cookie))
    }
}
