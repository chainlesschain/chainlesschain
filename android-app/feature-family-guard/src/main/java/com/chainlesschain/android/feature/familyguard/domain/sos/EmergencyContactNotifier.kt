package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * SOS 兜底外部联系人推送 seam (FAMILY-45; 真实 SMS 由 :app 接云厂商短信 API 覆盖)。
 *
 * 60s 内无 guardian acknowledge → [SosEscalationCoordinator] 经本 seam 把"孩子 SOS 求助 +
 * 位置"推给 emergency_contacts。默认实装 [com.chainlesschain.android.feature.familyguard
 * .data.sos.NoOpEmergencyContactNotifier] 仅记日志；:app 层接 SMS / PushVendor 覆盖
 * （同 [SosNotifier] / [GuardianAnomalyNotifier] 的 NoOp 默认 + :app 覆盖模式）。
 *
 * v0.1 推送方式 = SMS；自动报警（110）留 D10 决策，不在本 seam。
 */
interface EmergencyContactNotifier {

    suspend fun notifyEmergencyContacts(
        sosEventId: String,
        childDid: String,
        contacts: List<EmergencyContact>,
        locationSnapshot: String?,
    )
}
