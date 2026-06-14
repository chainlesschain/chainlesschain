package com.chainlesschain.android.feature.familyguard.domain.sync

/**
 * family_group 上行 outbox 端口 (FAMILY-26 seam)。
 *
 * 家长端创建组 / 生成邀请后调 [enqueue]，把 family_group 记录排入同步 outbox，由
 * sync engine 推到对端 (孩子端 / 其他监护人)，使对端 `acceptInvite` 不再因本地无
 * family_group 而 [com.chainlesschain.android.feature.familyguard.domain.model.pairing
 * .PairingResult.UnknownFamilyGroup]。
 *
 * :feature-family-guard **不依赖** :core-p2p (SyncManager 在那边)，故此处只定义端口；
 * 默认 [com.chainlesschain.android.feature.familyguard.data.sync.NoOpFamilyGroupOutbox]
 * 不上行，真实 SyncManager 适配器在 :app 层 (FAMILY-26) 绑定覆盖。与 [com.chainlesschain
 * .android.feature.familyguard.domain.telemetry.TelemetryOutbox] 同款 seam 取向。
 */
interface FamilyGroupOutbox {

    /**
     * @param record 要同步的 family_group 记录。
     * @param targetDids 已知的 fan-out 目标 (家庭成员 DID)；广播路由细节由真实适配器决定。
     */
    suspend fun enqueue(record: FamilyGroupSyncRecord, targetDids: List<String>)
}
