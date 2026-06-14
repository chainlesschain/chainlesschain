package com.chainlesschain.android.familyguard.sync

import com.chainlesschain.android.core.p2p.sync.FamilyGuardSyncApplier
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyGroupRepository
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupSyncApplier
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyGroupSyncRecord
import com.chainlesschain.android.feature.familyguard.domain.sync.toSyncRecord
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [FamilyGuardSyncApplier] 的 :app 实装 (FAMILY-26 双向同步入站)。
 *
 * 收到对端推来的 family_group SyncItem → 解码 [FamilyGroupSyncRecord] → 经
 * [FamilyGroupSyncApplier.decide] (合并冲突, 与本地 merge) → [FamilyGroupRepository.upsertReplica]
 * 按原 id 落库。放 :app 因它同时依赖 core-p2p (接口) + feature-family-guard (repo/record);
 * feature-family-guard 不依赖 core-p2p。
 */
@Singleton
class FamilyGuardSyncApplierImpl @Inject constructor(
    private val familyGroupRepository: FamilyGroupRepository,
) : FamilyGuardSyncApplier {

    override suspend fun saveFamilyGroupFromSync(resourceId: String, data: String) = apply(data)

    override suspend fun updateFamilyGroupFromSync(resourceId: String, data: String) = apply(data)

    private suspend fun apply(data: String) {
        val incoming = runCatching { FamilyGroupSyncRecord.decode(data) }.getOrElse {
            Timber.w(it, "[FamilyGuardSync] bad family_group sync data")
            return
        }
        val local = familyGroupRepository.findById(incoming.id)?.toSyncRecord()
        when (val decision = FamilyGroupSyncApplier.decide(incoming, local)) {
            is FamilyGroupSyncApplier.Decision.Write -> {
                runCatching { familyGroupRepository.upsertReplica(decision.record) }
                    .onFailure { Timber.e(it, "[FamilyGuardSync] upsertReplica failed ${incoming.id}") }
            }
            FamilyGroupSyncApplier.Decision.Noop -> Unit
        }
    }
}
