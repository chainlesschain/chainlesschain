package com.chainlesschain.android.feature.familyguard.domain.sos

/**
 * SOS → 家长推送 seam (FAMILY-44; 真实推送 FAMILY-43/46).
 *
 * 误触撤销成功后通知家长 (主文档 §3.7 "通知 guardian 撤销")。默认实装
 * [com.chainlesschain.android.feature.familyguard.data.sos.NoOpSosNotifier] 仅记日志;
 * :app 层接 P2P / PushVendor 的真实实装覆盖 (同 GuardianAnomalyNotifier / TelemetryOutbox
 * 的 NoOp 默认 + :app 覆盖 seam 模式)。
 *
 * FAMILY-43 扩展: [notifyBroadcast] (trigger 广播给所有 guardian) + [notifyAcknowledged]
 * (任一接通后给其余 guardian 发 "已接通" 提示)。真实推送仍由 :app 覆盖。
 */
interface SosNotifier {

    /** 通知家长某 SOS 已被孩子撤销为误触。 */
    suspend fun notifyFalseAlarm(
        sosEventId: String,
        childDid: String,
        familyGroupId: String,
        reason: String,
    )

    /**
     * FAMILY-43: SOS 触发后高优广播给本组所有 guardian (锁屏全屏弹 "⚠️ SOS 求助"，
     * 绕过勿扰，FAMILY-46)。[guardianDids] 已去重 (含去掉孩子自身 did)。
     */
    suspend fun notifyBroadcast(
        sosEventId: String,
        childDid: String,
        familyGroupId: String,
        guardianDids: List<String>,
        locationSnapshot: String?,
    )

    /**
     * FAMILY-43: 某 guardian 首次接通后，给**其余** guardian ([standDownGuardianDids],
     * 不含接通者) 发 "已由 X 接通" 提示，让他们停止响铃 / 收起全屏告警。
     */
    suspend fun notifyAcknowledged(
        sosEventId: String,
        acknowledgedByDid: String,
        standDownGuardianDids: List<String>,
    )
}
