package com.chainlesschain.android.feature.familyguard.domain.audit

/**
 * 可审计的家庭动作 (FAMILY-63). 主文档 §4.6: 所有家庭动作写不可删 audit_log (2y 保留,
 * 法律要求)。涵盖配对 / 解绑 / 规则修改 / SOS / 强接通 / 静音旁观 / 暂停 + 系统动作。
 *
 * [storageValue] 写入 audit_log.action 列; 不许改值 (破坏 on-disk 审计记录)。
 */
enum class AuditAction(val storageValue: String) {
    PAIRING("pairing"),
    UNBIND_REQUEST("unbind_request"),
    UNBIND_CANCEL("unbind_cancel"),
    UNBIND_FINALIZE("unbind_finalize"),
    EMERGENCY_UNBIND("emergency_unbind"),
    RULE_CHANGE("rule_change"),
    PERMISSION_CHANGE("permission_change"),
    SOS_TRIGGER("sos_trigger"),
    FORCE_PICKUP("force_pickup"),
    SILENT_OBSERVE("silent_observe"),
    PAUSE("pause"),
    RESUME("resume"),

    /** 系统动作: 数据生命周期清理 (FAMILY-28 DataLifecycleCleaner 写入)。 */
    DATA_LIFECYCLE_CLEANUP("data_lifecycle_cleanup"),

    ;

    companion object {
        fun fromStorage(value: String): AuditAction? =
            entries.firstOrNull { it.storageValue == value }
    }
}
