package com.chainlesschain.android.feature.familyguard.domain.sync

/**
 * family_group 同步**入站决策核** (FAMILY-26)。纯函数：给定一条到达的同步记录
 * [incoming] 与本地同 id 记录 [local] (无则 null)，决定该写什么。
 *
 * 写库 I/O (DAO upsert) 由 :app 的 SyncManager 入站适配器执行 —— 适配器收到
 * SyncItem 后调本 [decide]，按结果走 `FamilyGroupDao.upsert`。这样冲突语义留在
 * 可单测的纯层 (本对象 + [FamilyGroupMerge])，与 task / points 同步核一致。
 */
object FamilyGroupSyncApplier {

    sealed interface Decision {
        /** 需写入此记录 (本地缺失 → 新建；本地存在但 merge 后有变化 → 覆盖)。 */
        data class Write(val record: FamilyGroupSyncRecord) : Decision

        /** 本地已与到达记录一致 (或 merge 后无变化)，无需写库。 */
        data object Noop : Decision
    }

    fun decide(incoming: FamilyGroupSyncRecord, local: FamilyGroupSyncRecord?): Decision = when {
        local == null -> Decision.Write(incoming)
        else -> {
            val merged = FamilyGroupMerge.merge(incoming, local)
            if (merged == local) Decision.Noop else Decision.Write(merged)
        }
    }
}
