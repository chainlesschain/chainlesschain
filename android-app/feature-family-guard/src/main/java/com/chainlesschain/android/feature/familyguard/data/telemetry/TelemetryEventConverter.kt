package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.data.entity.ChildEventEntity
import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType

/**
 * 双向转换 [TelemetryEvent] ↔ [ChildEventEntity] (FAMILY-21).
 *
 * 中间层让 source / dispatcher / permission filter 走类型化 TelemetryEvent;
 * 落 Room 时映射成 ChildEventEntity 的 String 字段。
 *
 * Pure 函数; 不接 IO; 单测可直接调。
 */
object TelemetryEventConverter {

    fun toEntity(event: TelemetryEvent): ChildEventEntity = ChildEventEntity(
        childDid = event.childDid,
        source = event.source.storageValue,
        kind = event.kind,
        payload = event.payload,
        timestamp = event.timestampMs,
        durationMs = event.durationMs,
        level = event.level.name,
    )

    /**
     * 反序列化 entity → event. 失败 (source 不识别 / level 不识别) 返 null,
     * 让调用方处理孤儿数据 (跳过 + 写 audit, 或回退默认值)。
     */
    fun fromEntity(entity: ChildEventEntity): TelemetryEvent? {
        val source = TelemetrySourceType.fromStorage(entity.source) ?: return null
        val level = runCatching { TelemetryLevel.valueOf(entity.level) }.getOrNull()
            ?: return null
        return TelemetryEvent(
            childDid = entity.childDid,
            source = source,
            kind = entity.kind,
            payload = entity.payload,
            timestampMs = entity.timestamp,
            durationMs = entity.durationMs,
            level = level,
        )
    }
}
