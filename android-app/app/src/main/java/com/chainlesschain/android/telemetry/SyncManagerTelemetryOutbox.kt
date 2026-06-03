package com.chainlesschain.android.telemetry

import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncManager
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryOutbox
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber

/**
 * [TelemetryOutbox] 的 :app 真实实装 (FAMILY-26).
 *
 * 把过闸 + 落库后的 [TelemetryEvent] 包成 [ResourceType.TELEMETRY] 的 [SyncItem]
 * 排入 [SyncManager] 的 pendingChanges; SyncCoordinator 周期 push 到已配对的家长
 * 桌面端 (走 SyncOutbound RPC)。
 *
 * 覆盖 feature-family-guard 的 NoOpTelemetryOutbox 默认绑定 (见 :app TelemetryModule):
 * feature 模块不依赖 :core-p2p, 故真实上行只能在 :app 接。
 *
 * resourceId 取稳定确定值 (childDid+source+kind+startMs) — recordChange 以
 * resourceId 为 map key, 同一事件重复 enqueue 不会重复入队, 与 dispatcher 的
 * row-id 去重叠加, 二重防重复上行。
 */
@Singleton
class SyncManagerTelemetryOutbox @Inject constructor(
    private val syncManager: SyncManager,
) : TelemetryOutbox {

    override suspend fun enqueue(
        event: TelemetryEvent,
        savedRowId: Long,
        guardianDids: List<String>,
    ) {
        val item = SyncItem(
            resourceId = resourceId(event),
            resourceType = ResourceType.TELEMETRY,
            operation = SyncOperation.CREATE, // telemetry 是 append-only 事件
            data = json.encodeToString(event.toSyncData(savedRowId, guardianDids)),
            timestamp = event.timestampMs,
        )
        syncManager.recordChange(item)
        Timber.d(
            "Telemetry → sync queue: %s (source=%s guardians=%d)",
            item.resourceId,
            event.source.storageValue,
            guardianDids.size,
        )
    }

    private fun resourceId(event: TelemetryEvent): String =
        "telemetry|${event.childDid}|${event.source.storageValue}|${event.kind}|${event.timestampMs}"

    private fun TelemetryEvent.toSyncData(rowId: Long, guardianDids: List<String>) = TelemetrySyncData(
        childDid = childDid,
        source = source.storageValue,
        kind = kind,
        payload = payload,
        timestampMs = timestampMs,
        durationMs = durationMs,
        level = level.name,
        rowId = rowId,
        guardianDids = guardianDids,
    )

    companion object {
        private val json = Json { encodeDefaults = true }
    }
}

/**
 * 上行 SyncItem.data 的 JSON schema (FAMILY-26). 家长桌面端按本 schema 解码后落
 * child_event 镜像表。source/level 用稳定字符串 (storageValue / enum name) 而非
 * ordinal, 防枚举增删错位。
 */
@Serializable
data class TelemetrySyncData(
    val childDid: String,
    val source: String,
    val kind: String,
    val payload: String,
    val timestampMs: Long,
    val durationMs: Long,
    val level: String,
    val rowId: Long,
    val guardianDids: List<String>,
)
