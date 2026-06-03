package com.chainlesschain.android.feature.familyguard.domain.anomaly

/**
 * 异常严重度 (FAMILY-27). 家长端推送通道按此分优先级 (FAMILY-61 PushVendor):
 * CRITICAL 走高优 bypass-DND 通道; WARNING 普通推送; INFO 进列表不打扰。
 *
 * [storageValue] 写入 anomaly.severity 列, 不许改值。
 */
enum class AnomalySeverity(val storageValue: String) {
    INFO("info"),
    WARNING("warning"),
    CRITICAL("critical"),

    ;

    companion object {
        fun fromStorage(value: String): AnomalySeverity? =
            entries.firstOrNull { it.storageValue == value }
    }
}
