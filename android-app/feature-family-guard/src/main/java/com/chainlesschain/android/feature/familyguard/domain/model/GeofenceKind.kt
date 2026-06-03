package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * 电子围栏类别 (FAMILY-50，主文档 §3.8)。
 *
 * storageValue 写入 geofence.kind 列（与 FAMILY-02 schema 兼容，不许改值）。
 *   - HOME   家
 *   - SCHOOL 学校
 *   - CLASS  培训班 / 兴趣班
 *   - BANNED 禁入区（进入即触发 on_enter 告警）
 */
enum class GeofenceKind(val storageValue: String) {
    HOME("home"),
    SCHOOL("school"),
    CLASS("class"),
    BANNED("banned"),
    ;

    companion object {
        fun fromStorage(value: String): GeofenceKind? =
            entries.firstOrNull { it.storageValue == value }
    }
}
