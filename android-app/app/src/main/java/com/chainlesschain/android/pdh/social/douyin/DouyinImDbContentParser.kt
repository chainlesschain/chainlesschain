package com.chainlesschain.android.pdh.social.douyin

import org.json.JSONObject

/**
 * Phase 2b — pure helper for parsing Douyin IM `msg.content` blobs and
 * normalizing epoch timestamps. Byte-parity port of
 * `packages/personal-data-hub/lib/adapters/social-douyin-adb/im-db-parser.js`
 * (`_internals.extractTextFromContent` + `_internals.normalizeEpochMs`).
 *
 * Both implementations live in lockstep — when a real-device trap surfaces
 * on one side, fix the other to match. Mirrors the same pattern used by
 * Bilibili WBI signing (Android Kotlin + Node both port the same
 * algorithm; tests verify byte-parity).
 */
object DouyinImDbContentParser {

    /**
     * Parse a Douyin `msg.content` TEXT column for user-visible text.
     *
     * Format priority:
     *   1. JSON `{"text": "..."}` — modern (2024+) shape
     *   2. JSON nested `{"content": {"text": "..."}}` — some legacy versions
     *   3. Plain string (not JSON) — very legacy / non-text message types
     *      (stickers, voice, video) whose blob is the raw content envelope
     *   4. null — empty input or JSON without any text field
     *
     * @param blob raw value from the `content` column
     * @return extracted user-visible text, or null when no text field present
     */
    fun extractTextFromContent(blob: String?): String? {
        if (blob.isNullOrEmpty()) return null
        return try {
            val parsed = JSONObject(blob)
            // Modern shape: top-level "text"
            if (parsed.has("text")) {
                val t = parsed.optString("text", "")
                if (t.isNotEmpty()) return t
            }
            // Legacy nested shape
            val nested = parsed.optJSONObject("content")
            if (nested != null && nested.has("text")) {
                val t = nested.optString("text", "")
                if (t.isNotEmpty()) return t
            }
            null
        } catch (_: Throwable) {
            // Not JSON — return the raw value as a fallback (could be a very
            // old plaintext row, or a non-text message whose envelope we
            // preserve verbatim).
            blob
        }
    }

    /**
     * Normalize a Douyin epoch timestamp to milliseconds.
     *
     * Douyin's IM db writes timestamps in different units depending on the
     * app version and column:
     *   - Modern: milliseconds (13 digits, > 1e12)
     *   - Legacy: seconds (10 digits, ≤ 1e12)
     *   - Very legacy: microseconds (16 digits, > 1e15)
     *
     * @return epoch ms, or null when input is non-positive / non-numeric
     */
    fun normalizeEpochMs(v: Long): Long? {
        if (v <= 0) return null
        // > 1e15 µs → / 1000
        if (v > 1_000_000_000_000_000L) return v / 1000
        // > 1e12 ms → keep
        if (v > 1_000_000_000_000L) return v
        // <= 1e12 seconds → × 1000
        return v * 1000
    }
}
