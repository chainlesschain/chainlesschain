package com.chainlesschain.android.feature.familyguard.domain.sync

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import org.junit.Assert.assertEquals
import org.junit.Test

class FamilyGroupSyncRecordTest {

    @Test
    fun `encode then decode round-trips`() {
        val r = FamilyGroupSyncRecord(
            id = "g-1",
            name = "陈家",
            primaryDid = "did:chain:dad",
            createdAtMs = 1_700_000_000_000L,
            metadataJson = "{\"motto\":\"温和\"}",
        )
        assertEquals(r, FamilyGroupSyncRecord.decode(FamilyGroupSyncRecord.encode(r)))
    }

    @Test
    fun `null metadata round-trips`() {
        val r = FamilyGroupSyncRecord("g-2", "李家", "did:chain:mom", 1L, null)
        assertEquals(r, FamilyGroupSyncRecord.decode(FamilyGroupSyncRecord.encode(r)))
    }

    @Test
    fun `entity to record to entity is identity`() {
        val e = FamilyGroupEntity(
            id = "g-3",
            name = "王家",
            primaryDid = "did:chain:grandpa",
            createdAt = 42L,
            metadataJson = "{}",
        )
        assertEquals(e, e.toSyncRecord().toEntity())
    }

    @Test
    fun `decode tolerates unknown keys`() {
        val json = "{\"id\":\"g\",\"name\":\"n\",\"primary_did\":\"did:chain:x\"," +
            "\"created_at\":7,\"metadata_json\":null,\"future_field\":123}"
        val r = FamilyGroupSyncRecord.decode(json)
        assertEquals("g", r.id)
        assertEquals(7L, r.createdAtMs)
    }
}
