package com.chainlesschain.android.pdh.social.bilibili

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Phase 7.2 — sanity tests for [BilibiliRootDbExtractor] companion
 * constants. v0.1 ships with best-effort candidate list; lock contract.
 * Schema-drift correction (P7.2.0 result) goes through editing this
 * intentionally — update this test in the same commit.
 */
class BilibiliRootDbExtractorConstantsTest {

    @Test
    fun `BILIBILI_DB_REMOTE_DIR points at tv_danmaku_bili standard pkg`() {
        assertEquals(
            "/data/data/tv.danmaku.bili/databases",
            BilibiliRootDbExtractor.BILIBILI_DB_REMOTE_DIR,
        )
    }

    @Test
    fun `DB_FILENAME_CANDIDATES non-empty and ends with db extension`() {
        val candidates = BilibiliRootDbExtractor.DB_FILENAME_CANDIDATES
        assertTrue(candidates.isNotEmpty(), "must have at least one candidate")
        candidates.forEach { name ->
            assertTrue(name.endsWith(".db"), "candidate '$name' must end with .db")
            assertTrue(!name.contains("/"), "candidate '$name' must be basename, not path")
        }
    }

    @Test
    fun `DB_FILENAME_CANDIDATES includes the v0_1 priority guess bili_db`() {
        // v0.1 best-effort: bili.db is the highest-priority guess based
        // on public Bilibili Android decompile.
        assertEquals(
            "bili.db",
            BilibiliRootDbExtractor.DB_FILENAME_CANDIDATES.first(),
        )
    }

    @Test
    fun `SNAPSHOT_SCHEMA_VERSION matches social-bilibili Node adapter`() {
        // Mirror check — Node-side
        // packages/personal-data-hub/lib/adapters/social-bilibili/adapter.js
        // has SNAPSHOT_SCHEMA_VERSION=1.
        assertEquals(1, BilibiliRootDbExtractor.SNAPSHOT_SCHEMA_VERSION)
    }

    @Test
    fun `STAGING_JSON_NAME stable across versions for sync-adapter handoff`() {
        assertEquals(
            "social-bilibili-root.json",
            BilibiliRootDbExtractor.STAGING_JSON_NAME,
        )
    }

    @Test
    fun `LIMIT constants reasonable for v0_1 (single-snapshot bounds)`() {
        assertTrue(
            BilibiliRootDbExtractor.LIMIT_HISTORY in 1000..50_000,
            "LIMIT_HISTORY=${BilibiliRootDbExtractor.LIMIT_HISTORY} out of band",
        )
        assertTrue(
            BilibiliRootDbExtractor.LIMIT_FAVOURITE in 100..10_000,
            "LIMIT_FAVOURITE=${BilibiliRootDbExtractor.LIMIT_FAVOURITE} out of band",
        )
        assertTrue(
            BilibiliRootDbExtractor.LIMIT_FOLLOW in 100..50_000,
            "LIMIT_FOLLOW=${BilibiliRootDbExtractor.LIMIT_FOLLOW} out of band",
        )
    }
}
