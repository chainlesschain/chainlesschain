package com.chainlesschain.android.feature.familyguard.domain.model

import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity

/**
 * Family-friend wrapper (FAMILY-03).
 *
 * 主文档 §3.1: "亲子 = 好友的一个子类型 (typed friend)"。FAMILY-03 选 wrapper
 * 模式 (而非给 [FriendEntity] 加 `type` 字段) 因为:
 *   1. 不动 :core-database 共享 schema, 避免 migration v25 影响其他 module
 *   2. family-friend "类型" 即等价于"存在 active family_relationship row"; FAMILY-02
 *      schema 已天然支持, 无需冗余字段
 *   3. 解绑 / 紧急解绑 (FAMILY-15/16) 后, FriendEntity 仍然在 (仍是普通好友), 仅
 *      关系 status 流转。两层数据天然解耦。
 *
 * 取数: [com.chainlesschain.android.feature.familyguard.domain.repository.FamilyFriendRepository]
 * 通过 join 计算 (FriendDao + FamilyRelationshipDao)。
 */
data class FamilyFriend(
    /** Underlying social-graph friend (备注名 / 头像 / status 等) */
    val friend: FriendEntity,

    /** Family relationship metadata (role / 权限 / 解绑冷却 / 紧急解绑 等) */
    val relationship: FamilyRelationshipEntity,
) {
    /** 简写: 对方在本 family_group 中的角色 (parent | child | guardian) */
    val otherRole: String get() = relationship.roleOther

    /** 简写: monitor tier (primary | secondary | null=child) */
    val guardianTier: String? get() = relationship.guardianTierOther

    /** 简写: 解绑流程是否进行中 */
    val isUnbindPending: Boolean
        get() = relationship.status == "unbind_pending"

    /** 简写: 紧急解绑 (FAMILY-16) 是否触发 */
    val isEmergencyUnbound: Boolean
        get() = relationship.status == "emergency_unbound"
}
