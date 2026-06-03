package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * 围栏边界事件类型 (FAMILY-52 Geofencing API 透出的 transition; FAMILY-54 引擎消费)。
 *
 *   - ENTER  进入围栏 → 触发 on_enter_action（迟到时附加 on_late_action）
 *   - EXIT   离开围栏 → 触发 on_exit_action
 *   - DWELL  停留 → 本期**不映射动作**（保留给 FAMILY-55 异常停留检测，引擎对 DWELL 返空）
 */
enum class GeofenceBoundary {
    ENTER,
    EXIT,
    DWELL,
}

/**
 * 触发槽 — 标注一条 [com.chainlesschain.android.feature.familyguard.domain.geofence.ResolvedGeofenceAction]
 * 来自哪个动作列，决定 dedupKey 分桶与人读摘要。
 */
enum class GeofenceTrigger {
    ON_ENTER,
    ON_EXIT,
    ON_LATE,
}
