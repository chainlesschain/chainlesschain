package com.chainlesschain.android.pdh.social.toutiao

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Phase 7.1 — sanity tests for [ToutiaoRootDbExtractor] companion
 * constants. v0.1 ships with best-effort candidate list; this test
 * locks the contract so a parallel-session edit doesn't accidentally
 * drop a candidate or change schemaVersion.
 *
 * Schema-drift correction (real-device 探测 result) goes through
 * editing the candidate list intentionally — this test must be updated
 * in the same commit when that happens.
 */
class ToutiaoRootDbExtractorConstantsTest {

    @Test
    fun `TOUTIAO_DB_REMOTE_DIR points at com_ss_android_article_news standard pkg`() {
        assertEquals(
            "/data/data/com.ss.android.article.news/databases",
            ToutiaoRootDbExtractor.TOUTIAO_DB_REMOTE_DIR,
        )
    }

    @Test
    fun `DB_FILENAME_CANDIDATES non-empty and ends with db extension`() {
        val candidates = ToutiaoRootDbExtractor.DB_FILENAME_CANDIDATES
        assertTrue(candidates.isNotEmpty(), "must have at least one candidate")
        candidates.forEach { name ->
            assertTrue(name.endsWith(".db"), "candidate '$name' must end with .db")
            assertTrue(!name.contains("/"), "candidate '$name' must be basename, not path")
        }
    }

    @Test
    fun `DB_FILENAME_CANDIDATES includes the v0_1 priority guess article_db`() {
        // v0.1 best-effort: article.db is the highest-priority guess based
        // on 字节系 framework conventions. P7.1.0 schema 探测 may shift this.
        assertEquals(
            "article.db",
            ToutiaoRootDbExtractor.DB_FILENAME_CANDIDATES.first(),
        )
    }

    @Test
    fun `SNAPSHOT_SCHEMA_VERSION matches social-toutiao Node adapter`() {
        // Mirror check — Node-side
        // packages/personal-data-hub/lib/adapters/social-toutiao/index.js has
        // SNAPSHOT_SCHEMA_VERSION=1. If we change this, Node adapter must too.
        assertEquals(1, ToutiaoRootDbExtractor.SNAPSHOT_SCHEMA_VERSION)
    }

    @Test
    fun `STAGING_JSON_NAME stable across versions for sync-adapter handoff`() {
        assertEquals(
            "social-toutiao-root.json",
            ToutiaoRootDbExtractor.STAGING_JSON_NAME,
        )
    }

    @Test
    fun `LIMIT constants reasonable for v0_1 (single-snapshot bounds)`() {
        assertTrue(
            ToutiaoRootDbExtractor.LIMIT_READ in 1000..50_000,
            "LIMIT_READ=${ToutiaoRootDbExtractor.LIMIT_READ} out of band",
        )
        assertTrue(
            ToutiaoRootDbExtractor.LIMIT_COLLECTION in 100..10_000,
            "LIMIT_COLLECTION=${ToutiaoRootDbExtractor.LIMIT_COLLECTION} out of band",
        )
        assertTrue(
            ToutiaoRootDbExtractor.LIMIT_SEARCH in 100..10_000,
            "LIMIT_SEARCH=${ToutiaoRootDbExtractor.LIMIT_SEARCH} out of band",
        )
    }
}
