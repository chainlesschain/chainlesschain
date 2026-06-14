package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupSyncRecord
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [FamilyGroupOutbox] 的 :app 真实实装 (FAMILY-26 双向同步出站)。
 *
 * 把 family_group 记录包成 [ResourceType.FAMILY_GROUP] 的 [SyncItem] 排入
 * [SyncManager] pendingChanges; SyncCoordinator 推到已配对对端 (家长/孩子另一台机
 * 或桌面)。覆盖 feature-family-guard 的 NoOpFamilyGroupOutbox 默认 (feature 不依赖 core-p2p)。
 *
 * resourceId 稳定 (family_group|id) → 同组重复 enqueue 不重复入队 (recordChange 以
 * resourceId 为 key)。
 */
@Singleton
class SyncManagerFamilyGroupOutbox @Inject constructor(
    private val syncManager: SyncManager,
) : FamilyGroupOutbox {

    override suspend fun enqueue(record: FamilyGroupSyncRecord, targetDids: List<String>) {
        val item = SyncItem(
            resourceId = "family_group|${record.id}",
            resourceType = ResourceType.FAMILY_GROUP,
            operation = SyncOperation.CREATE,
            data = FamilyGroupSyncRecord.encode(record),
            timestamp = record.createdAtMs,
        )
        syncManager.recordChange(item)
        Timber.d("family_group → sync queue: %s (targets=%d)", item.resourceId, targetDids.size)
    }
}
