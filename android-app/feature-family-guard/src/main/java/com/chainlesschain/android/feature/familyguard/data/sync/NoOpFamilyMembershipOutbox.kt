package com.chainlesschain.android.feature.familyguard.data.sync

import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipOutbox
import com.chainlesschain.android.feature.familyguard.domain.sync.FamilyMembershipSyncRecord
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/** [FamilyMembershipOutbox] 默认 no-op (无 sync 宿主回退); :app SyncManager 适配器覆盖。 */
@Singleton
class NoOpFamilyMembershipOutbox @Inject constructor() : FamilyMembershipOutbox {
    override suspend fun enqueue(record: FamilyMembershipSyncRecord, targetDids: List<String>) {
        Timber.d("FamilyMembershipOutbox no-op: %s (FAMILY-26 上行未接通)", record.memberDid)
    }
}
