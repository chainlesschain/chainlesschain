package com.chainlesschain.android.pdh.social.kuaishou

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Phase 7.6 — sanity tests for [KuaishouRootDbExtractor] companion
 * constants. v0.1 ships with best-effort candidate list per plan §6.6
 * (Kuaishou Mode B = zero public refs + likely SQLCipher 或自研加密).
 * Schema-drift correction (P7.6.0 probe result) updates
 * DB_FILENAME_CANDIDATES / column candidate lists — bump these tests
 * in the same commit.
 */
class KuaishouRootDbExtractorConstantsTest {

    @Test
    fun `KUAISHOU_DB_REMOTE_DIR points at com_smile_gifmaker standard pkg`() {
        assertEquals(
            "/data/data/com.smile.gifmaker/databases",
            KuaishouRootDbExtractor.KUAISHOU_DB_REMOTE_DIR,
        )
    }

    @Test
    fun `DB_FILENAME_CANDIDATES non-empty and ends with db extension`() {
        val candidates = KuaishouRootDbExtractor.DB_FILENAME_CANDIDATES
        assertTrue(candidates.isNotEmpty(), "must have at least one candidate")
        candidates.forEach { name ->
            assertTrue(name.endsWith(".db"), "candidate '$name' must end with .db")
            assertTrue(!name.contains("/"), "candidate '$name' must be basename, not path")
        }
    }

    @Test
    fun `DB_FILENAME_CANDIDATES includes the v0_1 priority guess kwai_db`() {
        // v0.1 best-effort: kwai.db is the highest-priority guess based
        // on Kuaishou's English brand naming convention. Bumps once
        // P7.6.0 probe fills the actual filename.
        assertEquals(
            "kwai.db",
            KuaishouRootDbExtractor.DB_FILENAME_CANDIDATES.first(),
        )
    }

    @Test
    fun `SNAPSHOT_SCHEMA_VERSION matches social-kuaishou Node adapter`() {
        // Mirror check — Node-side
        // packages/personal-data-hub/lib/adapters/social-kuaishou/index.js
        // has SNAPSHOT_SCHEMA_VERSION=1.
        assertEquals(1, KuaishouRootDbExtractor.SNAPSHOT_SCHEMA_VERSION)
    }

    @Test
    fun `STAGING_JSON_NAME stable across versions for sync-adapter handoff`() {
        assertEquals(
            "social-kuaishou-root.json",
            KuaishouRootDbExtractor.STAGING_JSON_NAME,
        )
    }

    @Test
    fun `LIMIT constants reasonable for v0_1 (single-snapshot bounds)`() {
        assertTrue(
            KuaishouRootDbExtractor.LIMIT_WATCH in 1000..50_000,
            "LIMIT_WATCH=${KuaishouRootDbExtractor.LIMIT_WATCH} out of band",
        )
        assertTrue(
            KuaishouRootDbExtractor.LIMIT_COLLECT in 100..10_000,
            "LIMIT_COLLECT=${KuaishouRootDbExtractor.LIMIT_COLLECT} out of band",
        )
        assertTrue(
            KuaishouRootDbExtractor.LIMIT_SEARCH in 100..5_000,
            "LIMIT_SEARCH=${KuaishouRootDbExtractor.LIMIT_SEARCH} out of band",
        )
    }
}
