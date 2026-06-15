package com.chainlesschain.android.telemetry

import com.chainlesschain.android.feature.familyguard.domain.model.permissions.TelemetryLevel
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetrySourceType
import kotlinx.serialization.json.Json

/**
 * 家长端 telemetry 接收解码 (FAMILY-26 下行侧，主文档 §3.2)。
 *
 * [SyncManagerTelemetryOutbox] 在孩子端把 [TelemetryEvent] 编码成 [TelemetrySyncData]
 * JSON 排入 sync 队列；家长端经 SyncInbound 收到 `SyncItem.data` 后，由本解码器**纯函数**
 * 还原为类型化 [TelemetryEvent] + 来源行 id + fan-out guardian 列表，供家长端落 child_event
 * 镜像表 + [ChildActivityDashboard] 聚合展示。这是"家长真正看到孩子端情况"链路里此前缺的
 * **接收解码层**（采集→上行队列已接通，接收+展示是缺口）。
 *
 * 鲁棒性（家长端可能收到更新版本孩子端发来的事件，**绝不抛异常**）：
 *   - 坏 JSON / 缺必填字段 → [Result.Rejected]
 *   - 未知 source storageValue → Rejected（家长端无法分类未知来源，宁可显式丢弃并计数）
 *   - 未知 level → 容错落 [TelemetryLevel.L1]（粒度未知按最保守可见档）+ note
 *   - 非正 timestamp → Rejected（无法上时间线）
 *   - 负 durationMs → 夹到 0 + note
 *
 * 调用方据 [Result.Rejected.reason] / [ReceivedChildTelemetry.notes] 计数或记日志。
 */
object TelemetryIngest {

    /** decode 容忍未知键（跨版本字段增减不炸）；缺必填键仍抛 → 被 runCatching 捕获为 Rejected。 */
    private val decoder = Json { ignoreUnknownKeys = true }

    sealed interface Result {
        data class Accepted(val received: ReceivedChildTelemetry) : Result
        data class Rejected(val reason: String) : Result
    }

    /** 解码一条家长端收到的 telemetry sync data JSON（= 孩子端 [TelemetrySyncData] 编码结果）。 */
    fun decode(syncDataJson: String): Result {
        val raw = runCatching { decoder.decodeFromString<TelemetrySyncData>(syncDataJson) }.getOrNull()
            ?: return Result.Rejected("malformed JSON or missing required fields")

        if (raw.childDid.isBlank()) return Result.Rejected("blank childDid")
        if (raw.timestampMs <= 0L) return Result.Rejected("non-positive timestamp ${raw.timestampMs}")

        val source = TelemetrySourceType.fromStorage(raw.source)
            ?: return Result.Rejected("unknown source '${raw.source}'")

        val notes = mutableListOf<String>()
        val level = TelemetryLevel.entries.firstOrNull { it.name == raw.level } ?: run {
            notes += "unknown level '${raw.level}' → defaulted to L1"
            TelemetryLevel.L1
        }
        val duration = raw.durationMs.coerceAtLeast(0L)
        if (raw.durationMs < 0L) notes += "negative durationMs ${raw.durationMs} clamped to 0"

        val event = TelemetryEvent(
            childDid = raw.childDid,
            source = source,
            kind = raw.kind,
            payload = raw.payload,
            timestampMs = raw.timestampMs,
            durationMs = duration,
            level = level,
        )
        return Result.Accepted(
            ReceivedChildTelemetry(
                event = event,
                sourceRowId = raw.rowId,
                guardianDids = raw.guardianDids,
                notes = notes,
            ),
        )
    }
}

/**
 * 家长端成功解码的一条孩子 telemetry。[event] 为类型化事件（落 child_event 镜像表 +
 * 喂 [ChildActivityDashboard]）；[sourceRowId] 关联孩子端原始行（去重 / 溯源）；
 * [guardianDids] 为孩子端过闸允许接收的 guardian 列表（家长端可据此校验本机是否在收件人内）。
 */
data class ReceivedChildTelemetry(
    val event: TelemetryEvent,
    val sourceRowId: Long,
    val guardianDids: List<String>,
    val notes: List<String> = emptyList(),
)
