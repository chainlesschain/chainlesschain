package com.chainlesschain.android.presentation.aistudy

import com.chainlesschain.android.core.p2p.sync.PointsLedgerSyncApplier
import com.chainlesschain.android.feature.familyguard.domain.model.MemberRole
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyRelationshipRepository
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [PointsLedgerSyncApplier] 的 :app 实装 (FAMILY-67 积分下行落库)。
 *
 * 收到对端 [com.chainlesschain.android.core.p2p.sync.ResourceType.POINTS_EVENT] sync item →
 * [PointsEventSyncData.decode] 解码 → 业务级鉴权 → [PointsLedger.append] 落库 (DAO
 * `INSERT … IGNORE` 按 id 去重，append-only 幂等)。
 *
 * **业务鉴权**：流水必须属于本机活跃家庭——孩子 (childDid) 或发放者 (granterDid) 至少一方是
 * 活跃 family_relationship 好友。覆盖双向：家长端收孩子 earn 时 childDid=孩子(好友)，孩子端收
 * 家长 grant 时 granterDid=家长(好友)。**GRANT 防御纵深**：发放者必须是活跃家庭里的
 * PARENT/GUARDIAN，否则丢弃 (防伪造发放刷分)。
 *
 * 鲁棒：坏 JSON / 未知 type ([PointsEventSyncData.decode] 抛 IllegalArgumentException)
 * → 记日志丢弃，**不落库** (积分宁缺勿错，错算余额比丢一条更糟)。
 */
@Singleton
class PointsLedgerSyncApplierImpl @Inject constructor(
    private val ledger: PointsLedger,
    private val relationshipRepository: FamilyRelationshipRepository,
) : PointsLedgerSyncApplier {

    override suspend fun savePointsEventFromSync(resourceId: String, data: String) {
        val event = runCatching { PointsEventSyncData.decode(data) }.getOrElse {
            Timber.w(it, "[PointsLedgerSync] malformed/unknown points event: %s", resourceId)
            return
        }
        if (!belongsToActiveFamily(event)) {
            Timber.w("[PointsLedgerSync] rejected — child/granter not active family: %s", resourceId)
            return
        }
        if (event.type == PointsEventType.GRANT && !granterIsGuardian(event)) {
            Timber.w("[PointsLedgerSync] GRANT rejected — granter not parent/guardian: %s", resourceId)
            return
        }
        runCatching { ledger.append(event) }
            .onFailure { Timber.e(it, "[PointsLedgerSync] append failed: %s", event.id) }
    }

    private suspend fun belongsToActiveFamily(event: PointsEvent): Boolean =
        isActiveFamilyFriend(event.childDid) ||
            (event.granterDid?.let { isActiveFamilyFriend(it) } ?: false)

    /** GRANT 防御纵深：发放者必须是活跃家庭里的 PARENT/GUARDIAN。 */
    private suspend fun granterIsGuardian(event: PointsEvent): Boolean {
        val granter = event.granterDid ?: return false
        val rel = runCatching { relationshipRepository.findByFriendDid(granter) }.getOrNull() ?: return false
        if (rel.status != ACTIVE_STATUS) return false
        return when (MemberRole.fromStorage(rel.roleOther)) {
            MemberRole.PARENT, MemberRole.GUARDIAN -> true
            else -> false
        }
    }

    private suspend fun isActiveFamilyFriend(did: String): Boolean {
        if (did.isBlank()) return false
        val rel = runCatching { relationshipRepository.findByFriendDid(did) }.getOrNull() ?: return false
        return rel.status == ACTIVE_STATUS
    }

    private companion object {
        const val ACTIVE_STATUS = "active"
    }
}
