package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * [SosBroadcastCoordinator.onGuardianAck] 的仲裁结果 (FAMILY-43)。
 *
 * 多 guardian 并发接通同一条 broadcast SOS 时，底层 [com.chainlesschain.android.feature
 * .familyguard.domain.repository.SosEventRepository.acknowledge] 带 `WHERE status='pending'`
 * 守卫 → 只有**第一个**返回 [SosTransitionResult.Success]，故"任一接通即 acknowledged"
 * 的竞态由数据库原子性保证，本结果只是把它翻译成广播语义。
 */
sealed interface SosAckOutcome {

    /** 本次是首个成功接通: [acknowledgedBy] 胜出, 需让 [standDownTargets] 其余 guardian 收起告警。 */
    data class FirstAck(
        val acknowledgedBy: String,
        val standDownTargets: List<String>,
    ) : SosAckOutcome

    /** 已被其他 guardian 抢先接通; 本次接通方应显示 "已由他人接通"。 */
    data object AlreadyAcknowledged : SosAckOutcome

    /** SOS 事件不存在。 */
    data object NotFound : SosAckOutcome

    /** 事件处于不可接通的状态 (e.g. 已 resolved / false_alarm); 附当前状态。 */
    data class Invalid(val current: SosStatus) : SosAckOutcome
}
