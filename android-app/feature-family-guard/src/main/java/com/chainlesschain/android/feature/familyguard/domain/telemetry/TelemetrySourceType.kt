package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * Telemetry 数据来源分类 (FAMILY-21).
 *
 * 主文档 §3.2 v0.2 三大数据源 + Accessibility (4 类):
 *   - PDH_COLLECTOR: PDH 17 + N collectors (微信 / 抖音 / 王者 / etc.)
 *   - FOREGROUND_APP: UsageStatsManager 分钟轮询 (FAMILY-20)
 *   - SNAPSHOT_WRITER: Plan C Kotlin ContentResolver 直采 (通讯录 / 通话 / SMS)
 *   - ACCESSIBILITY: AccessibilityService UI 事件流 (M4 Enforce; spike 3 异步白名单)
 *
 * storageValue 写入 child_event.source 列 (跨 FAMILY-20 schema 兼容);
 * 改 storageValue 会破坏 on-disk 已 sync 的事件, 不许改值。
 */
enum class TelemetrySourceType(val storageValue: String) {
    FOREGROUND_APP("foreground_app"),
    PDH_COLLECTOR("pdh"),
    SNAPSHOT_WRITER("snapshot"),
    ACCESSIBILITY("accessibility"),
    ;

    companion object {
        fun fromStorage(value: String): TelemetrySourceType? =
            entries.firstOrNull { it.storageValue == value }
    }
}
