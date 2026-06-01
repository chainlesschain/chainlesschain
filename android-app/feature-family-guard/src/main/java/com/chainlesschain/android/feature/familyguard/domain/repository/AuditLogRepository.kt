package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.data.entity.AuditLogEntity
import com.chainlesschain.android.feature.familyguard.domain.audit.AuditAction
import kotlinx.coroutines.flow.Flow

/**
 * 不可删审计日志仓储 (FAMILY-63). 所有家庭动作经 [record] 写入; 查询用 [observeRecent] /
 * [queryRange] / [queryByGroup]。无删除/更新方法 —— 主文档 §4.6 不可删。
 */
interface AuditLogRepository {

    /**
     * 记一条审计。append-only。
     *
     * @param actorDid 发起方; 系统动作传 [SYSTEM_ACTOR]
     * @param actionAtMs 动作发生时刻; null = 用当前时钟
     * @return 新行 rowId
     */
    suspend fun record(
        action: AuditAction,
        actorDid: String = SYSTEM_ACTOR,
        targetDid: String? = null,
        familyGroupId: String? = null,
        detail: String = "",
        actionAtMs: Long? = null,
    ): Long

    /** UI 观察最近 N 条审计 (按动作时间倒序)。 */
    fun observeRecent(limit: Int = 100): Flow<List<AuditLogEntity>>

    /** 查时间窗内全部审计。 */
    suspend fun queryRange(sinceMs: Long, untilMs: Long): List<AuditLogEntity>

    /** 查某家庭组时间窗内审计。 */
    suspend fun queryByGroup(familyGroupId: String, sinceMs: Long, untilMs: Long): List<AuditLogEntity>

    /** 审计总条数 (验收 / 监控)。 */
    suspend fun count(): Int

    companion object {
        /** 系统发起动作的 actor 占位 (如数据生命周期清理)。 */
        const val SYSTEM_ACTOR = "system"
    }
}
