package com.chainlesschain.android.pdh.social.douyin

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Phase 2b — pure JVM unit cover for [DouyinImDbContentParser].
 *
 * Byte-parity contract with the Node-side
 * `packages/personal-data-hub/lib/adapters/social-douyin-adb/im-db-parser.js`
 * — same inputs MUST produce the same outputs. If a real-device trap
 * forces a fix on one side, the other side must update in lockstep.
 *
 * Test cases mirror social-douyin-adb-im-db-parser.test.js
 * `_internals.extractTextFromContent` + `_internals.normalizeEpochMs`
 * sections.
 */
class DouyinImDbContentParserTest {

    // ─── extractTextFromContent ─────────────────────────────────────────

    @Test
    fun `extractTextFromContent parses modern shape (top-level text)`() {
        assertEquals("hi", DouyinImDbContentParser.extractTextFromContent("""{"text":"hi"}"""))
    }

    @Test
    fun `extractTextFromContent parses legacy nested shape`() {
        assertEquals(
            "nested",
            DouyinImDbContentParser.extractTextFromContent("""{"content":{"text":"nested"}}"""),
        )
    }

    @Test
    fun `extractTextFromContent falls back to raw string when not JSON`() {
        assertEquals(
            "legacy plaintext",
            DouyinImDbContentParser.extractTextFromContent("legacy plaintext"),
        )
    }

    @Test
    fun `extractTextFromContent returns null for empty input`() {
        assertNull(DouyinImDbContentParser.extractTextFromContent(""))
        assertNull(DouyinImDbContentParser.extractTextFromContent(null))
    }

    @Test
    fun `extractTextFromContent returns null when JSON has no text field`() {
        assertNull(
            DouyinImDbContentParser.extractTextFromContent("""{"type":"sticker"}"""),
        )
    }

    @Test
    fun `extractTextFromContent returns null when text is empty string`() {
        // Empty string in `text` is treated as no-text — same as Node
        // implementation (typeof parsed.text === "string" check + truthiness)
        assertNull(
            DouyinImDbContentParser.extractTextFromContent("""{"text":""}"""),
        )
    }

    @Test
    fun `extractTextFromContent handles modern shape preferred over nested`() {
        // Top-level text wins when both present (matches Node order)
        assertEquals(
            "outer",
            DouyinImDbContentParser.extractTextFromContent(
                """{"text":"outer","content":{"text":"inner"}}""",
            ),
        )
    }

    @Test
    fun `extractTextFromContent preserves Chinese characters`() {
        assertEquals(
            "你好，世界",
            DouyinImDbContentParser.extractTextFromContent("""{"text":"你好，世界"}"""),
        )
    }

    @Test
    fun `extractTextFromContent handles emoji + multi-byte UTF-8`() {
        assertEquals(
            "hello 👋 🎉",
            DouyinImDbContentParser.extractTextFromContent(
                """{"text":"hello 👋 🎉"}""",
            ),
        )
    }

    // ─── normalizeEpochMs ───────────────────────────────────────────────

    @Test
    fun `normalizeEpochMs treats 10-digit seconds as seconds`() {
        // 1716383021 seconds = 1716383021000 ms
        assertEquals(1716383021000L, DouyinImDbContentParser.normalizeEpochMs(1716383021))
    }

    @Test
    fun `normalizeEpochMs treats 13-digit milliseconds as ms`() {
        assertEquals(1716383021000L, DouyinImDbContentParser.normalizeEpochMs(1716383021000L))
    }

    @Test
    fun `normalizeEpochMs treats 16-digit microseconds as us`() {
        // 1716383021000000 µs / 1000 = 1716383021000 ms
        assertEquals(
            1716383021000L,
            DouyinImDbContentParser.normalizeEpochMs(1716383021000000L),
        )
    }

    @Test
    fun `normalizeEpochMs rejects zero`() {
        assertNull(DouyinImDbContentParser.normalizeEpochMs(0))
    }

    @Test
    fun `normalizeEpochMs rejects negative`() {
        assertNull(DouyinImDbContentParser.normalizeEpochMs(-1))
        assertNull(DouyinImDbContentParser.normalizeEpochMs(-1716383021000L))
    }

    @Test
    fun `normalizeEpochMs boundary at 1e12 (seconds vs ms cutover)`() {
        // 1e12 - 1 → still seconds → × 1000
        assertEquals(999999999999_000L, DouyinImDbContentParser.normalizeEpochMs(999999999999L))
        // 1e12 + 1 → ms → keep
        assertEquals(1000000000001L, DouyinImDbContentParser.normalizeEpochMs(1000000000001L))
    }

    @Test
    fun `normalizeEpochMs boundary at 1e15 (ms vs us cutover)`() {
        // 1e15 - 1 → still ms → keep
        assertEquals(999999999999999L, DouyinImDbContentParser.normalizeEpochMs(999999999999999L))
        // 1e15 + 1 → us → / 1000
        assertEquals(1000000000000L, DouyinImDbContentParser.normalizeEpochMs(1000000000000001L))
    }
}
