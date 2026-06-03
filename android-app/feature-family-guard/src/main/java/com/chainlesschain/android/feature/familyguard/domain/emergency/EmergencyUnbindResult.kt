package com.chainlesschain.android.feature.familyguard.domain.emergency

/**
 * 紧急解绑流程结果 (FAMILY-16). 主文档 §3.1 v0.2 + 验收准则:
 *   - 复活码正确 → [Success] (含 freeze + DB 写 emergency_unbind_* + 外部通知)
 *   - 错码 → [WrongCode] (UI 显剩余尝试次数)
 *   - 3 次错 → [LockedOut] (UI 显锁时间; 后续调用直接 LockedOut, 不递增 attempts)
 *   - 复活码已用过 → [AlreadyConsumed]
 *   - 该 child 配对时未生成 → [NoCodeRegistered]
 *   - 复活码关联的 relationship 不存在 (孤儿 / 旧数据) → [OrphanCode]
 */
sealed interface EmergencyUnbindResult {

    /**
     * 紧急解绑成功生效:
     *   - family_relationship.status = 'emergency_unbound'
     *   - UpstreamFreezer 已 freeze
     *   - ExternalContactNotifier 已通知 (notifiedCount = 实际推送数)
     */
    data class Success(
        val familyRelationshipId: Long,
        val notifiedCount: Int,
    ) : EmergencyUnbindResult

    data class WrongCode(val remainingAttempts: Int) : EmergencyUnbindResult

    data class LockedOut(val unlockAtMs: Long) : EmergencyUnbindResult

    data object NoCodeRegistered : EmergencyUnbindResult

    data object AlreadyConsumed : EmergencyUnbindResult

    /**
     * 复活码生效但其 familyRelationshipId 在 family_relationship 表里不存在 (孤儿).
     * Freeze 已触发 (保护性默认), 但 DB 写 emergency_unbound 失败。UI 应提示
     * "已 freeze, 请联系客服" + 写 audit。
     */
    data class OrphanCode(val frozen: Boolean) : EmergencyUnbindResult
}
