package com.chainlesschain.android.feature.familyguard.domain.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel

/**
 * Domain-level telemetry event (FAMILY-21). 中间层抽象, 解耦 4 类
 * [TelemetrySourceType] 的 source 实现 ↔ ChildEventEntity DB 写入。
 *
 * 与 [com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity]
 * 的区别:
 *   - ChildEventEntity: Room 持久化对象, source/kind 是 String, level 是 String
 *   - TelemetryEvent: 类型化 (TelemetrySourceType enum + TelemetryLevel enum),
 *     UI 层 / sync engine / FamilyPermissionChecker 都消费此类型
 *
 * Converter ([com.chainlesschain.android.feature.familyguard.data.telemetry.
 * TelemetryEventConverter]) 双向转换: TelemetryEvent ↔ ChildEventEntity.
 *
 * @property kind 同 [TelemetrySourceType] 下的细分类:
 *   - FOREGROUND_APP: "run" (app 运行段; FAMILY-20)
 *   - PDH_COLLECTOR: "message" / "order" / "view" / etc. (按 collector 定)
 *   - SNAPSHOT_WRITER: "contact" / "call" / "sms" / "notification"
 *   - ACCESSIBILITY: "window_change" / "click_intent"
 */
data class TelemetryEvent(
    val childDid: String,
    val source: TelemetrySourceType,
    val kind: String,
    val payload: String,
    val timestampMs: Long,
    val durationMs: Long = 0L,
    val level: TelemetryLevel = TelemetryLevel.L1,
)
