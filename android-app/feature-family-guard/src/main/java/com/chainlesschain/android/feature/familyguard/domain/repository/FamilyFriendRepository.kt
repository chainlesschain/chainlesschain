package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyFriend
import kotlinx.coroutines.flow.Flow

/**
 * Repository abstraction for reading social-graph friends through the family-guard
 * lens (FAMILY-03).
 *
 * 验收 (ticket FAMILY-03):
 *   1. observeAllFamilyFriends() 可读现有 Friend list (joined with active relationships)
 *   2. markAsFamily() / unmarkAsFamily() 标记 / 取消 family-friend 关系
 *
 * 高级关系语义 (配对协议 / 复活码 / 多家长冲突) 留 FAMILY-12..17 实装。
 */
interface FamilyFriendRepository {

    /**
     * 观察当前所有 active family-friend (跨 family_groups)。
     * Friend ↔ relationship 通过 friend_did 关联; 找不到 FriendEntity 的孤儿
     * relationship 会被自然过滤掉 (typically: 好友已删但 relationship 残留)。
     */
    fun observeAllFamilyFriends(): Flow<List<FamilyFriend>>

    /** 给定 DID 当前是否标记为 family-friend (active 状态)。 */
    suspend fun isFamily(friendDid: String): Boolean

    /**
     * 标记一个普通好友为 family-friend (FAMILY-03 v1: 仅写 active row 给定字段;
     * 真正的 invite-code / 冷却 / KYC 流程在 FAMILY-13)。
     */
    suspend fun markAsFamily(relationship: FamilyRelationshipEntity): Long

    /**
     * 取消 family-friend 标记 (FAMILY-03 v1: 改 status='unbound', 不走 24h 冷却;
     * 冷却流程在 FAMILY-15, 紧急解绑在 FAMILY-16)。
     */
    suspend fun unmarkAsFamily(friendDid: String): Boolean

    /** 暴露当前 self DID, 供调用方判断 self vs other。 */
    suspend fun currentSelfDid(): String?
}
