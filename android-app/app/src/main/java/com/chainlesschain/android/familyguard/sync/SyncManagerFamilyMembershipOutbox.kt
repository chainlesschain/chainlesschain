package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipSyncRecord
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [FamilyMembershipOutbox] 的 :app 真实实装 (FAMILY-26 双向同步出站)。
 * 把 membership 包成 [ResourceType.FAMILY_MEMBERSHIP] SyncItem → [SyncManager.recordChange]。
 * resourceId 用自然键 (group|member|device) → 同成员重复 enqueue 不重复入队。
 */
@Singleton
class SyncManagerFamilyMembershipOutbox @Inject constructor(
    private val syncManager: SyncManager,
) : FamilyMembershipOutbox {

    override suspend fun enqueue(record: FamilyMembershipSyncRecord, targetDids: List<String>) {
        val item = SyncItem(
            resourceId = "family_membership|${record.familyGroupId}|${record.memberDid}|${record.deviceId}",
            resourceType = ResourceType.FAMILY_MEMBERSHIP,
            operation = SyncOperation.CREATE,
            data = FamilyMembershipSyncRecord.encode(record),
            timestamp = record.joinedAtMs,
        )
        syncManager.recordChange(item)
        Timber.d("family_membership → sync queue: %s (targets=%d)", record.memberDid, targetDids.size)
    }
}
