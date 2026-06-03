package com.chainlesschain.android.feature.familyguard.domain.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel

/**
 * Plan C snapshot writer 采集的记录类别 (FAMILY-22). 主文档 §3.2 三大数据源之
 * SNAPSHOT_WRITER (ContentResolver 直采): 通讯录 / 通话 / 短信 / 通知历史。
 *
 * [storageValue] 写入 child_event.kind 列 (与 [TelemetryEvent.kind] 约定一致:
 * "contact" / "call" / "sms" / "notification"); 不许改值 (破坏 on-disk)。
 *
 * [defaultLevel] 是该类记录的默认分级 (主文档 §3.2 数据分级 v0 映射): 内容性强的
 * 通讯录 / 短信 = L2 (默认关, 需家长申请 + 孩子同意); 元数据性的通话 / 通知 = L1。
 * 实际上行由 FamilyPermissionChecker (FAMILY-25 上行权限闸) 按 level 把关。
 */
enum class SnapshotRecordType(
    val storageValue: String,
    val defaultLevel: TelemetryLevel,
) {
    CONTACT("contact", TelemetryLevel.L2),
    CALL("call", TelemetryLevel.L1),
    SMS("sms", TelemetryLevel.L2),
    NOTIFICATION("notification", TelemetryLevel.L1),

    ;

    companion object {
        fun fromStorage(value: String): SnapshotRecordType? =
            entries.firstOrNull { it.storageValue == value }
    }
}
