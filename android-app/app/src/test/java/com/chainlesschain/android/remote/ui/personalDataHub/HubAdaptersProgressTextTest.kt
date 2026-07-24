package com.chainlesschain.android.remote.ui.personalDataHub

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Phase 14.3.3 — `progressTextFor` localization lock.
 *
 * The Compose UI calls this helper to render the streaming progress text
 * shown under each adapter row when [HubAdaptersViewModel.syncStream] is
 * mid-flight. Pure function — no Robolectric required.
 */
class HubAdaptersProgressTextTest {

    @Test
    fun `null kind shows generic 同步中`() {
        assertEquals("同步中…", progressTextFor(null, null, null))
    }

    @Test
    fun `connecting maps to 连接中`() {
        assertEquals("连接中…", progressTextFor("connecting", null, null))
    }

    @Test
    fun `fetching with partition + uidsScanned shows both`() {
        val text = progressTextFor("fetching", "INBOX", mapOf("uidsScanned" to 250L))
        assertEquals("拉取中 (INBOX) · 250 条", text)
    }

    @Test
    fun `fetching without partition still shows count`() {
        val text = progressTextFor("fetching", null, mapOf("uidsScanned" to 100L))
        assertEquals("拉取中 · 100 条", text)
    }

    @Test
    fun `fetching with no detail shows minimal text`() {
        val text = progressTextFor("fetching", "INBOX", null)
        assertEquals("拉取中 (INBOX)", text)
    }

    @Test
    fun `fetching falls back to first detail value if uidsScanned absent`() {
        val text = progressTextFor("fetching", null, mapOf("rowsRead" to 42L))
        assertEquals("拉取中 · 42 条", text)
    }

    @Test
    fun `normalizing shows eventsBuilt count`() {
        val text = progressTextFor("normalizing", "INBOX", mapOf("eventsBuilt" to 30L))
        assertEquals("归一化中 · 30 事件", text)
    }

    @Test
    fun `normalizing falls back to first detail value if eventsBuilt absent`() {
        val text = progressTextFor("normalizing", null, mapOf("processed" to 99L))
        assertEquals("归一化中 · 99 事件", text)
    }

    @Test
    fun `retrying shows next attempt and delay`() {
        val text =
            progressTextFor(
                "retrying",
                null,
                mapOf("nextAttempt" to 3L, "delayMs" to 1000L),
            )
        assertTrue(text.contains("3"))
        assertTrue(text.contains("1000ms"))
    }

    @Test
    fun `request throttled shows operation page and delay`() {
        val text =
            progressTextFor(
                "request_throttled",
                "order",
                mapOf("page" to 3L, "delayMs" to 10000L),
            )
        assertTrue(text.contains("order"))
        assertTrue(text.contains("3"))
        assertTrue(text.contains("10000ms"))
    }

    @Test
    fun `rate limited shows reason and retry delay`() {
        val text =
            progressTextFor(
                "rate_limited",
                "per_minute",
                mapOf("retryAfterMs" to 45000L),
            )
        assertTrue(text.contains("per_minute"))
        assertTrue(text.contains("45000ms"))
    }

    @Test
    fun `unknown kind shows generic with kind in parens`() {
        val text = progressTextFor("xyz", null, null)
        assertTrue(text.contains("xyz"))
        assertTrue(text.startsWith("同步中"))
    }
}
