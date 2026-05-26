package com.chainlesschain.android.pdh.social.xiaohongshu

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Phase 7.5 — sanity tests for [XhsRootDbExtractor] companion
 * constants. v0.1 ships with best-effort candidate list per plan §6.5
 * (Xhs Mode B = zero public refs + likely SQLCipher). Schema-drift
 * correction (P7.5.0 probe result) updates DB_FILENAME_CANDIDATES /
 * column candidate lists — bump these tests in the same commit.
 */
class XhsRootDbExtractorConstantsTest {

    @Test
    fun `XHS_DB_REMOTE_DIR points at com_xingin_xhs standard pkg`() {
        assertEquals(
            "/data/data/com.xingin.xhs/databases",
            XhsRootDbExtractor.XHS_DB_REMOTE_DIR,
        )
    }

    @Test
    fun `DB_FILENAME_CANDIDATES non-empty and ends with db extension`() {
        val candidates = XhsRootDbExtractor.DB_FILENAME_CANDIDATES
        assertTrue(candidates.isNotEmpty(), "must have at least one candidate")
        candidates.forEach { name ->
            assertTrue(name.endsWith(".db"), "candidate '$name' must end with .db")
            assertTrue(!name.contains("/"), "candidate '$name' must be basename, not path")
        }
    }

    @Test
    fun `DB_FILENAME_CANDIDATES includes the v0_1 priority guess xhs_db`() {
        // v0.1 best-effort: xhs.db is the highest-priority guess based on
        // Xhs Android package-name convention (com.xingin.xhs). Bumps once
        // P7.5.0 probe fills the actual filename.
        assertEquals(
            "xhs.db",
            XhsRootDbExtractor.DB_FILENAME_CANDIDATES.first(),
        )
    }

    @Test
    fun `SNAPSHOT_SCHEMA_VERSION matches social-xiaohongshu Node adapter`() {
        // Mirror check — Node-side
        // packages/personal-data-hub/lib/adapters/social-xiaohongshu/index.js
        // has SNAPSHOT_SCHEMA_VERSION=1.
        assertEquals(1, XhsRootDbExtractor.SNAPSHOT_SCHEMA_VERSION)
    }

    @Test
    fun `STAGING_JSON_NAME stable across versions for sync-adapter handoff`() {
        assertEquals(
            "social-xiaohongshu-root.json",
            XhsRootDbExtractor.STAGING_JSON_NAME,
        )
    }

    @Test
    fun `LIMIT constants reasonable for v0_1 (single-snapshot bounds)`() {
        assertTrue(
            XhsRootDbExtractor.LIMIT_NOTE in 100..10_000,
            "LIMIT_NOTE=${XhsRootDbExtractor.LIMIT_NOTE} out of band",
        )
        assertTrue(
            XhsRootDbExtractor.LIMIT_LIKED in 1000..50_000,
            "LIMIT_LIKED=${XhsRootDbExtractor.LIMIT_LIKED} out of band",
        )
        assertTrue(
            XhsRootDbExtractor.LIMIT_FOLLOW in 100..50_000,
            "LIMIT_FOLLOW=${XhsRootDbExtractor.LIMIT_FOLLOW} out of band",
        )
    }
}
