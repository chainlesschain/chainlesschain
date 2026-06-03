package com.chainlesschain.android.feature.familyguard.data.repository

import com.chainlesschain.android.core.database.dao.social.FriendDao
import com.chainlesschain.android.core.did.manager.DIDManager
import com.chainlesschain.android.feature.familyguard.data.dao.FamilyRelationshipDao
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyFriend
import com.chainlesschain.android.feature.familyguard.domain.repository.FamilyFriendRepository
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * FAMILY-03 implementation. 内嵌 client-side join 而非 raw SQL JOIN —— 因为
 * FriendEntity 在 ChainlessChainDatabase, FamilyRelationshipEntity 在
 * FamilyGuardDatabase, 两库分离 (FAMILY-02 设计决策)。
 *
 * Trade-off: O(N) 串行查 friendDao.getFriendByDid(); N 在 v0.1 预期 < 10
 * (家长 + 1-3 孩子 + 1-2 secondary guardian), 性能不是问题。如未来 N 变大,
 * 加 batch query API 即可。
 */
@Singleton
class FamilyFriendRepositoryImpl @Inject constructor(
    private val friendDao: FriendDao,
    private val familyRelationshipDao: FamilyRelationshipDao,
    private val didManager: DIDManager,
) : FamilyFriendRepository {

    override fun observeAllFamilyFriends(): Flow<List<FamilyFriend>> =
        familyRelationshipDao.observeAllActive().map { relationships ->
            relationships.mapNotNull { rel ->
                val friend = friendDao.getFriendByDid(rel.friendDid) ?: return@mapNotNull null
                FamilyFriend(friend = friend, relationship = rel)
            }
        }

    override suspend fun isFamily(friendDid: String): Boolean =
        familyRelationshipDao.isActiveFamily(friendDid)

    override suspend fun markAsFamily(relationship: FamilyRelationshipEntity): Long =
        familyRelationshipDao.upsert(relationship)

    override suspend fun unmarkAsFamily(friendDid: String): Boolean {
        val existing = familyRelationshipDao.findByFriendDid(friendDid) ?: return false
        val updated = familyRelationshipDao.updateStatus(
            id = existing.id,
            newStatus = "unbound",
            updatedAt = System.currentTimeMillis(),
        )
        return updated > 0
    }

    override suspend fun currentSelfDid(): String? = didManager.getCurrentDID()
}
