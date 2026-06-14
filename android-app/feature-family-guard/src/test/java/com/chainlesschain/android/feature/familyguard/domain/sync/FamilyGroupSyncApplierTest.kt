package com.chainlesschain.android.feature.familyguard.domain.sync

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilyGroupSyncApplierTest {

    private fun rec(
        id: String = "g1",
        name: String = "陈家",
        primaryDid: String = "did:chain:dad",
        createdAtMs: Long = 1_000L,
        metadataJson: String? = null,
    ) = FamilyGroupSyncRecord(id, name, primaryDid, createdAtMs, metadataJson)

    @Test
    fun `absent local writes incoming verbatim`() {
        val incoming = rec()
        val d = FamilyGroupSyncApplier.decide(incoming, local = null)
        assertEquals(FamilyGroupSyncApplier.Decision.Write(incoming), d)
    }

    @Test
    fun `identical local is a no-op`() {
        val r = rec(metadataJson = "{\"k\":1}")
        assertEquals(FamilyGroupSyncApplier.Decision.Noop, FamilyGroupSyncApplier.decide(r, r.copy()))
    }

    @Test
    fun `differing local writes the merged record`() {
        val incoming = rec(name = "Beta", createdAtMs = 1_000L)
        val local = rec(name = "Alpha", createdAtMs = 3_000L)
        val d = FamilyGroupSyncApplier.decide(incoming, local)
        assertTrue(d is FamilyGroupSyncApplier.Decision.Write)
        val written = (d as FamilyGroupSyncApplier.Decision.Write).record
        // merge: createdAt min + name 字典序大者
        assertEquals(1_000L, written.createdAtMs)
        assertEquals("Beta", written.name)
    }

    @Test
    fun `decision write matches merge result`() {
        // 选 merged != local 的组合 (incoming 名字字典序更大) → Write 且等于 merge 输出。
        val incoming = rec(name = "Z", createdAtMs = 5_000L)
        val local = rec(name = "Y", createdAtMs = 5_000L)
        val written = (FamilyGroupSyncApplier.decide(incoming, local) as FamilyGroupSyncApplier.Decision.Write).record
        assertEquals(FamilyGroupMerge.merge(incoming, local), written)
    }
}
