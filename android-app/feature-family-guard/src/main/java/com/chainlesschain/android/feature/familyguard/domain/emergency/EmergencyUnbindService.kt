package com.chainlesschain.android.feature.familyguard.domain.emergency

import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode

/**
 * 紧急解绑触发协议 (FAMILY-16). 主文档 §3.1 v0.2 紧急解绑通道:
 *   - 孩子端在登录页输入复活码
 *   - 验证: RevivalCodeRepository 跑 3 错锁 24h 状态机
 *   - 正确码后端到端执行:
 *     1. UpstreamFreezer.freeze (立刻; 不等 DB 写完, 保护性默认)
 *     2. family_relationship.status = 'emergency_unbound' + emergency_unbind_at/reason
 *     3. ExternalContactNotifier.notify (默认 12355 / 救助基金)
 *
 * 7 天宽限期内孩子可撤销 (调 [revoke]); 7 天后系统自动转 'unbound' (FAMILY-19 Worker)。
 */
interface EmergencyUnbindService {

    /**
     * 主入口. 调用前 UI 必须显示警告 "此操作会断开监管, 通知第三方"; 用户确认后才调。
     *
     * @param deviceFingerprint 触发设备指纹 (用于审计 + 外部通知 payload)
     */
    suspend fun trigger(
        revivalCode: RevivalCode,
        deviceFingerprint: String,
    ): EmergencyUnbindResult

    /**
     * 撤销紧急解绑 (7 天宽限期内孩子主动撤回). 撤销条件:
     *   - status='emergency_unbound'
     *   - emergency_unbind_at + 7 day > clock.now()
     * 撤销后: status='active' + 清 emergency_unbind_* + UpstreamFreezer.unfreeze
     */
    suspend fun revoke(familyRelationshipId: Long): RevokeResult

    sealed interface RevokeResult {
        data object Success : RevokeResult
        data object NotEmergencyUnbound : RevokeResult
        data object GracePeriodExpired : RevokeResult
        data object NotFound : RevokeResult
    }

    companion object {
        /** 7 天宽限期 (主文档 §3.1 v0.2). */
        const val GRACE_PERIOD_MS: Long = 7L * 24L * 60L * 60L * 1000L

        const val REASON_REVIVAL_CODE = "revival_code_triggered"
    }
}
