package com.chainlesschain.android.core.p2p.sync

/**
 * 家庭守护数据的同步入口 (FAMILY-26 双向同步)。
 *
 * 跨模块 DI 翻转 (同 [KnowledgeSyncApplier]): [com.chainlesschain.android.feature.p2p
 * .sync.DefaultSyncDataApplier] 在 feature-p2p, 而 family_group 落库逻辑在
 * feature-family-guard; 且 **feature-family-guard 不依赖 core-p2p** (FamilyGroupOutbox
 * 是其内部 seam)。故本接口落在 core-p2p, 由 **:app** 实现 (它同时依赖 core-p2p +
 * feature-family-guard), 经 Hilt @Binds 绑定, DefaultSyncDataApplier 注入本接口。
 *
 * data JSON = feature-family-guard 的 FamilyGroupSyncRecord 编码; 入站经
 * FamilyGroupSyncApplier.decide (合并冲突) → FamilyGroupRepository.upsertReplica 落库。
 */
interface FamilyGuardSyncApplier {

    /** 入站 family_group: 本地无则建、有则按 merge 决策覆盖 (保留来源 id)。 */
    suspend fun saveFamilyGroupFromSync(resourceId: String, data: String)

    /** family_group 更新 (同 save 语义: upsert + merge)。 */
    suspend fun updateFamilyGroupFromSync(resourceId: String, data: String)

    /** 入站 family_membership: 按自然键 (group, member, device) upsert。 */
    suspend fun saveFamilyMembershipFromSync(resourceId: String, data: String)

    /** family_membership 更新 (同 save 语义)。 */
    suspend fun updateFamilyMembershipFromSync(resourceId: String, data: String)
}
