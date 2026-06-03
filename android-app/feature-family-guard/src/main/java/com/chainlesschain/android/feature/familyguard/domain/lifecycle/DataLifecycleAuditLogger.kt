package com.chainlesschain.android.feature.familyguard.domain.lifecycle

/**
 * 清理运行审计 seam (FAMILY-28; 真实 audit_log FAMILY-63).
 *
 * 主文档 §4.6 要求清理含 audit log 写入。[DataLifecycleCleaner] 每次清理后调本接口
 * 记录 [DataLifecycleReport]。默认实装
 * [com.chainlesschain.android.feature.familyguard.data.lifecycle.NoOpDataLifecycleAuditLogger]
 * 仅记日志; FAMILY-63 提供写不可删 audit_log (2y 保留) 的真实实装覆盖本绑定。
 *
 * 注: audit_log 本身**不**被本 cleaner 清理 (§4.6: 不可删)。
 */
interface DataLifecycleAuditLogger {

    /** 记录一次数据生命周期清理结果。 */
    suspend fun recordCleanup(report: DataLifecycleReport)
}
