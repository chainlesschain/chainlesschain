package com.chainlesschain.android.feature.familyguard.data.sync

import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupSyncRecord
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [FamilyGroupOutbox] 默认 no-op 实装。
 *
 * family_group 已落本地 family_group 表, 但**不上行** — :feature-family-guard 不依赖
 * :core-p2p 的 SyncManager。FAMILY-26 在 :app 层提供把 [FamilyGroupSyncRecord] 包成
 * SyncItem 并 `SyncManager.recordChange` 的真实适配器, 在 Hilt 图中覆盖本绑定;
 * 入站侧由该适配器收 SyncItem → [com.chainlesschain.android.feature.familyguard.domain
 * .sync.FamilyGroupSyncApplier.decide] → `FamilyGroupDao.upsert` 落库。
 */
@Singleton
class NoOpFamilyGroupOutbox @Inject constructor() : FamilyGroupOutbox {

    override suspend fun enqueue(record: FamilyGroupSyncRecord, targetDids: List<String>) {
        Timber.d(
            "FamilyGroupOutbox no-op: group=%s targets=%d (FAMILY-26 上行未接通)",
            record.id,
            targetDids.size,
        )
    }
}
