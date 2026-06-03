package com.chainlesschain.android.remote.ui.personalDataHub

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Phase 8.1 — JVM cover for the 4 new fields added to
 * [HubLocalViewModel.SocialCardState] enabling WeChat/QQ refactor
 * (P8.2 / P8.3):
 *
 *  - uidStr:           String-form uid (WeChat/QQ multi-digit UIN with
 *                      leading-zero matter; Xhs 24-char hex ObjectId).
 *                      Overrides Long uid display when non-null.
 *  - pendingUinEntry:  Gates UIN-entry dialog (vs WebView cookie scrape).
 *  - keyProvider:      WeChat-specific "md5" (7.x) / "frida" (8.0+).
 *  - requiresUinEntry: Login flow selector — UIN dialog vs WebView.
 *
 * Defaults preserve the 6 existing social platforms (Bilibili / Weibo /
 * Douyin / Xhs / Toutiao / Kuaishou) unchanged — new fields all default
 * to null/false.
 */
class SocialCardStateP81Test {

    @Test
    fun `defaults preserve 6 social platforms behavior`() {
        val s = HubLocalViewModel.SocialCardState(
            adapterName = "social-bilibili",
            displayName = "哔哩哔哩",
            implemented = true,
        )
        assertNull(s.uidStr, "uidStr should default null for backwards compat")
        assertFalse(s.pendingUinEntry, "pendingUinEntry should default false")
        assertNull(s.keyProvider, "keyProvider should default null")
        assertFalse(s.requiresUinEntry, "requiresUinEntry should default false")
    }

    @Test
    fun `WeChat-shaped state populates all 4 new fields`() {
        // P8.2 preview — WeChat state will look like this after refactor.
        val s = HubLocalViewModel.SocialCardState(
            adapterName = "wechat",
            displayName = "微信",
            implemented = true,
            isLoggedIn = true,
            // WeChat UIN can be 12+ digit with leading-zero matter — must be
            // String not Long; uid stays null
            uid = null,
            uidStr = "012345678901",
            pendingUinEntry = false,
            keyProvider = "frida",
            requiresUinEntry = true,
        )
        assertEquals("012345678901", s.uidStr)
        assertEquals("frida", s.keyProvider)
        assertTrue(s.requiresUinEntry)
        assertFalse(s.pendingUinEntry)
        assertNull(s.uid)
    }

    @Test
    fun `QQ-shaped state populates 3 of 4 new fields (no keyProvider)`() {
        // P8.3 preview — QQ has no keyProvider (XOR-IMEI is the only path,
        // no md5-vs-frida distinction like WeChat).
        val s = HubLocalViewModel.SocialCardState(
            adapterName = "qq",
            displayName = "QQ",
            implemented = true,
            isLoggedIn = true,
            uidStr = "1234567890",
            pendingUinEntry = false,
            requiresUinEntry = true,
        )
        assertEquals("1234567890", s.uidStr)
        assertNull(s.keyProvider, "QQ should have null keyProvider")
        assertTrue(s.requiresUinEntry)
    }

    @Test
    fun `pendingUinEntry true gates UIN dialog mode for IM platforms`() {
        val s = HubLocalViewModel.SocialCardState(
            adapterName = "wechat",
            displayName = "微信",
            implemented = true,
            isLoggedIn = false,
            pendingUinEntry = true,
            requiresUinEntry = true,
        )
        assertTrue(s.pendingUinEntry, "pendingUinEntry=true must surface UIN dialog")
    }

    @Test
    fun `uidStr overrides uid display when both set (edge case)`() {
        // Defensive — if both set, uidStr wins. SocialAdapterCard rendering
        // logic: `state.uidStr ?: state.uid?.toString()`.
        val s = HubLocalViewModel.SocialCardState(
            adapterName = "wechat",
            displayName = "微信",
            implemented = true,
            isLoggedIn = true,
            uid = 999L,
            uidStr = "012345678901",
        )
        val display = s.uidStr ?: s.uid?.toString()
        assertEquals("012345678901", display)
    }
}
