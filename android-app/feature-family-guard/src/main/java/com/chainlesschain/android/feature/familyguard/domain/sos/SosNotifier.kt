package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * SOS → 家长推送 seam (FAMILY-44; 真实推送 FAMILY-43/46).
 *
 * 误触撤销成功后通知家长 (主文档 §3.7 "通知 guardian 撤销")。默认实装
 * [com.chainlesschain.android.feature.familyguard.data.sos.NoOpSosNotifier] 仅记日志;
 * :app 层接 P2P / PushVendor 的真实实装覆盖 (同 GuardianAnomalyNotifier / TelemetryOutbox
 * 的 NoOp 默认 + :app 覆盖 seam 模式)。
 *
 * 后续 SOS 通知 (trigger 广播给 guardians / acknowledge "已接通" 提示, FAMILY-43/46)
 * 扩展本接口。
 */
interface SosNotifier {

    /** 通知家长某 SOS 已被孩子撤销为误触。 */
    suspend fun notifyFalseAlarm(
        sosEventId: String,
        childDid: String,
        familyGroupId: String,
        reason: String,
    )
}
