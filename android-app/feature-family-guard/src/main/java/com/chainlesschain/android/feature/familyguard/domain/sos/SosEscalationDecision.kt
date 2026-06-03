package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * [SosEscalationCoordinator.evaluate] 的兜底升级判定 (FAMILY-45)。
 */
sealed interface SosEscalationDecision {

    /** 满足兜底条件: 应向 [contacts] 推送 SOS（含位置）。 */
    data class Escalate(val contacts: List<EmergencyContact>) : SosEscalationDecision

    /** 暂不升级; [reason] 说明原因。 */
    data class Hold(val reason: HoldReason) : SosEscalationDecision
}

/** [SosEscalationDecision.Hold] 的原因。 */
enum class HoldReason {
    /** 尚未到 60s 兜底窗口。 */
    WITHIN_WINDOW,

    /** 已有 guardian 接通 / 已 resolved / 已撤销，无需外部升级。 */
    ALREADY_HANDLED,

    /** 无有效外部紧急联系人。 */
    NO_CONTACTS,
}
