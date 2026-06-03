package com.chainlesschain.android.feature.familyguard.domain.geofence

import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceAction
import com.chainlesschain.android.feature.familyguard.domain.model.GeofenceTrigger

/**
 * [GeofenceActionEngine] 的一条输出 — 某围栏某触发槽解析出的待下发动作 (FAMILY-54)。
 *
 * @property dedupKey 幂等键 `"<geofenceId>:<trigger>:<localDate>"` — 同围栏同触发同一本地
 *   日只下发一次（避免边界抖动反复 ENTER/EXIT 时重复推送；下游 dispatcher / 审计表对该列去重，
 *   同 [com.chainlesschain.android.feature.familyguard.domain.anomaly.DetectedAnomaly.dedupKey] 模式）。
 * @property summary 一句话人读摘要（推送标题）。
 * @property triggeredAtMs 触发时刻 epoch ms（= 边界事件的 now）。
 */
data class ResolvedGeofenceAction(
    val action: GeofenceAction,
    val trigger: GeofenceTrigger,
    val geofenceId: String,
    val geofenceName: String,
    val childDid: String,
    val dedupKey: String,
    val summary: String,
    val triggeredAtMs: Long,
)
