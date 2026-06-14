package com.chainlesschain.android.feature.familyguard.domain.sync

/**
 * family_membership 上行 outbox 端口 (FAMILY-26 双向同步)。
 *
 * 孩子 acceptInvite 写自己的 membership 后 enqueue → 推到家长端 → 家长家人页显示孩子。
 * 同 [FamilyGroupOutbox]: :feature-family-guard 不依赖 :core-p2p, 真实 SyncManager 适配器
 * 在 :app 绑定; 默认无绑定 (无 sync 宿主可用 [com.chainlesschain.android.feature.familyguard
 * .data.sync.NoOpFamilyMembershipOutbox])。
 */
interface FamilyMembershipOutbox {
    suspend fun enqueue(record: FamilyMembershipSyncRecord, targetDids: List<String>)
}
