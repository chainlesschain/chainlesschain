package com.chainlesschain.android.feature.familyguard.domain.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class FamilyGroupMergeTest {

    private fun rec(
        id: String = "g1",
        name: String = "陈家",
        primaryDid: String = "did:chain:dad",
        createdAtMs: Long = 1_000L,
        metadataJson: String? = null,
    ) = FamilyGroupSyncRecord(id, name, primaryDid, createdAtMs, metadataJson)

    @Test
    fun `merge requires same id`() {
        assertThrows(IllegalArgumentException::class.java) {
            FamilyGroupMerge.merge(rec(id = "a"), rec(id = "b"))
        }
    }

    @Test
    fun `createdAt takes the earliest`() {
        val merged = FamilyGroupMerge.merge(rec(createdAtMs = 5_000L), rec(createdAtMs = 2_000L))
        assertEquals(2_000L, merged.createdAtMs)
    }

    @Test
    fun `primaryDid follows the earliest creator`() {
        val a = rec(primaryDid = "did:chain:mom", createdAtMs = 9_000L)
        val b = rec(primaryDid = "did:chain:dad", createdAtMs = 1_000L)
        assertEquals("did:chain:dad", FamilyGroupMerge.merge(a, b).primaryDid)
    }

    @Test
    fun `name prefers non-blank then deterministic lexical max`() {
        assertEquals("陈家", FamilyGroupMerge.merge(rec(name = "陈家"), rec(name = "")).name)
        // 双非空且不同：字典序大者 (确定性)
        val m = FamilyGroupMerge.merge(rec(name = "Alpha"), rec(name = "Beta"))
        assertEquals("Beta", m.name)
    }

    @Test
    fun `metadata prefers non-null then deterministic lexical max`() {
        assertEquals("{\"x\":1}", FamilyGroupMerge.merge(rec(metadataJson = "{\"x\":1}"), rec(metadataJson = null)).metadataJson)
        val m = FamilyGroupMerge.merge(rec(metadataJson = "{\"a\":1}"), rec(metadataJson = "{\"b\":1}"))
        assertEquals("{\"b\":1}", m.metadataJson)
    }

    @Test
    fun `merge is commutative across all field combos`() {
        val a = rec(name = "Alpha", primaryDid = "did:chain:mom", createdAtMs = 3_000L, metadataJson = "{\"a\":1}")
        val b = rec(name = "Beta", primaryDid = "did:chain:dad", createdAtMs = 1_000L, metadataJson = "{\"b\":2}")
        assertEquals(FamilyGroupMerge.merge(a, b), FamilyGroupMerge.merge(b, a))
    }

    @Test
    fun `merging identical records is a no-op`() {
        val a = rec(metadataJson = "{\"k\":1}")
        assertEquals(a, FamilyGroupMerge.merge(a, a.copy()))
    }
}
