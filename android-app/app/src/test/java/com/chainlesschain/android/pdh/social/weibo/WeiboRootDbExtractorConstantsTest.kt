package com.chainlesschain.android.pdh.social.weibo

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Phase 7.4 — sanity tests for [WeiboRootDbExtractor] companion
 * constants. v0.1 ships with best-effort candidate list per P7.3 §6
 * prediction (明文 SQLite assumed pending real-device probe). Schema-drift
 * correction (P7.3 §4 fill-in result) updates DB_FILENAME_CANDIDATES /
 * column candidate lists — bump these tests in the same commit.
 */
class WeiboRootDbExtractorConstantsTest {

    @Test
    fun `WEIBO_DB_REMOTE_DIR points at com_sina_weibo standard pkg`() {
        assertEquals(
            "/data/data/com.sina.weibo/databases",
            WeiboRootDbExtractor.WEIBO_DB_REMOTE_DIR,
        )
    }

    @Test
    fun `DB_FILENAME_CANDIDATES non-empty and ends with db extension`() {
        val candidates = WeiboRootDbExtractor.DB_FILENAME_CANDIDATES
        assertTrue(candidates.isNotEmpty(), "must have at least one candidate")
        candidates.forEach { name ->
            assertTrue(name.endsWith(".db"), "candidate '$name' must end with .db")
            assertTrue(!name.contains("/"), "candidate '$name' must be basename, not path")
        }
    }

    @Test
    fun `DB_FILENAME_CANDIDATES includes the v0_1 priority guess weibo_db`() {
        // v0.1 best-effort: weibo.db is the highest-priority guess based on
        // Weibo Android package-name convention (com.sina.weibo). Bumps
        // once P7.3 §4 probe fills the actual filename.
        assertEquals(
            "weibo.db",
            WeiboRootDbExtractor.DB_FILENAME_CANDIDATES.first(),
        )
    }

    @Test
    fun `SNAPSHOT_SCHEMA_VERSION matches social-weibo Node adapter`() {
        // Mirror check — Node-side
        // packages/personal-data-hub/lib/adapters/social-weibo/index.js
        // has SNAPSHOT_SCHEMA_VERSION=1.
        assertEquals(1, WeiboRootDbExtractor.SNAPSHOT_SCHEMA_VERSION)
    }

    @Test
    fun `STAGING_JSON_NAME stable across versions for sync-adapter handoff`() {
        assertEquals(
            "social-weibo-root.json",
            WeiboRootDbExtractor.STAGING_JSON_NAME,
        )
    }

    @Test
    fun `LIMIT constants reasonable for v0_1 (single-snapshot bounds)`() {
        assertTrue(
            WeiboRootDbExtractor.LIMIT_POST in 1000..50_000,
            "LIMIT_POST=${WeiboRootDbExtractor.LIMIT_POST} out of band",
        )
        assertTrue(
            WeiboRootDbExtractor.LIMIT_FAVOURITE in 100..10_000,
            "LIMIT_FAVOURITE=${WeiboRootDbExtractor.LIMIT_FAVOURITE} out of band",
        )
        assertTrue(
            WeiboRootDbExtractor.LIMIT_FOLLOW in 100..50_000,
            "LIMIT_FOLLOW=${WeiboRootDbExtractor.LIMIT_FOLLOW} out of band",
        )
    }
}
