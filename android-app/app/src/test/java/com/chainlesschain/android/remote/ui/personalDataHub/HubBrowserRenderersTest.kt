package com.chainlesschain.android.remote.ui.personalDataHub

import org.junit.Test
import kotlin.test.assertEquals

/**
 * Phase 16 — categoryFor() dispatcher mapping. Mirror of the
 * frontend pdhCategories-getCategory.test.js + backend categories.test.js
 * — keep all three in sync.
 *
 * Renderer Composable tests live in androidTest (need Compose UI test
 * runtime). This JVM file only covers the pure dispatch logic.
 */
class HubBrowserRenderersTest {

    @Test
    fun `wechat exact match maps to chat`() {
        assertEquals("chat", categoryFor("wechat"))
    }

    @Test
    fun `messaging prefix maps to chat`() {
        assertEquals("chat", categoryFor("messaging-qq"))
        assertEquals("chat", categoryFor("messaging-telegram"))
        assertEquals("chat", categoryFor("messaging-whatsapp"))
    }

    @Test
    fun `social prefix maps to social`() {
        assertEquals("social", categoryFor("social-bilibili"))
        assertEquals("social", categoryFor("social-weibo"))
        assertEquals("social", categoryFor("social-douyin"))
        assertEquals("social", categoryFor("social-xiaohongshu"))
    }

    @Test
    fun `email prefix maps to email`() {
        assertEquals("email", categoryFor("email-imap"))
        assertEquals("email", categoryFor("email-imap-qq"))
        assertEquals("email", categoryFor("email-imap-gmail"))
    }

    @Test
    fun `shopping and alipay prefixes map to shopping`() {
        assertEquals("shopping", categoryFor("shopping-taobao"))
        assertEquals("shopping", categoryFor("shopping-jd"))
        assertEquals("shopping", categoryFor("alipay-bill"))
    }

    @Test
    fun `travel prefix maps to travel`() {
        assertEquals("travel", categoryFor("travel-12306"))
        assertEquals("travel", categoryFor("travel-amap"))
    }

    @Test
    fun `system-data prefix maps to system`() {
        assertEquals("system", categoryFor("system-data"))
        assertEquals("system", categoryFor("system-data-android"))
    }

    @Test
    fun `browser-history prefix maps to system`() {
        assertEquals("system", categoryFor("browser-history-chrome"))
    }

    @Test
    fun `ai-chat prefix maps to ai-chat`() {
        assertEquals("ai-chat", categoryFor("ai-chat-history"))
        assertEquals("ai-chat", categoryFor("ai-chat-deepseek"))
    }

    @Test
    fun `unknown adapter falls back to other`() {
        assertEquals("other", categoryFor("unknown-collector"))
        assertEquals("other", categoryFor("foo"))
    }

    @Test
    fun `null and empty fall back to other`() {
        assertEquals("other", categoryFor(null))
        assertEquals("other", categoryFor(""))
    }
}
