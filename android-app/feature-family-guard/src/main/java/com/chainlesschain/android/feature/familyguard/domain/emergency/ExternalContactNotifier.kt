package com.chainlesschain.android.feature.familyguard.domain.emergency

/**
 * 外部紧急联系人通知抽象 (FAMILY-16).
 *
 * 主文档 §3.1 v0.2: "紧急解绑触发 → 通知第三方 (默认 12355 青少年服务热线 +
 * 中华少年儿童慈善救助基金会)"。v0.1 仅暴露接口 + NoOp 实装让 service 层
 * 端到端跑通; 真接通走 FAMILY-45 SOS 60s 兜底外部联系人 (短信 / 推送)。
 *
 * payload 含触发原因 + 时间戳 + 孩子端 device 指纹, 不含具体 PII (主文档
 * §5.1 法律合规: 未成年信息保护)。
 */
interface ExternalContactNotifier {

    /**
     * 通知外部联系人; 实际渠道 (SMS / FCM / API call) 由实现决定。
     * 返成功推送数; 0 表示无可用渠道 (如离线 / 未配置)。
     */
    suspend fun notify(payload: EmergencyNotification): Int

    data class EmergencyNotification(
        val triggerKind: TriggerKind,
        val familyRelationshipId: Long?,
        val timestampMs: Long,
        val deviceFingerprint: String?,
        val reason: String,
    )

    enum class TriggerKind {
        REVIVAL_CODE_TRIGGERED,
        SOS_FALLBACK,        // FAMILY-45 用
        MANUAL_ESCALATION,   // 家长 misbehavior reporting
    }
}
