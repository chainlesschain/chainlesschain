package com.chainlesschain.android.telemetry

import com.chainlesschain.android.core.p2p.sync.TelemetrySyncApplier
import com.chainlesschain.android.feature.familyguard.domain.repository.ChildEventRepository
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [TelemetrySyncApplier] 的 :app 实装 (FAMILY-26 下行落库)。
 *
 * 家长端收到 [com.chainlesschain.android.core.p2p.sync.ResourceType.TELEMETRY] sync item →
 * [TelemetryIngest.decode] 纯函数解码 → 经 [ChildEventRepository.saveTelemetryEvent] 落
 * child_event 镜像表（与孩子端同一 schema，[childDid] 区分来源孩子）。这之后
 * `ChildActivityDashboard` 即可聚合展示。
 *
 * 鲁棒：解码 [TelemetryIngest.Result.Rejected]（坏 JSON / 未知 source / 非法时间）→ 记日志
 * 丢弃，不落库、不抛异常（避免一条坏事件阻断整条同步管线）。[ReceivedChildTelemetry.notes]
 * （未知 level 容错落 L1 等）一并记日志供审计。
 *
 * 去重：上行侧 `SyncManagerTelemetryOutbox` 以稳定 resourceId 入队 + [SyncManager] 收件冲突
 * 检测构成主去重；child_event 行内容去重（同 childDid+source+kind+timestamp）留 follow-up
 * （需加列 / 查询，属后续 ticket，当前依赖 sync 层去重）。
 */
@Singleton
class TelemetrySyncApplierImpl @Inject constructor(
    private val childEventRepository: ChildEventRepository,
) : TelemetrySyncApplier {

    override suspend fun saveTelemetryFromSync(resourceId: String, data: String) {
        when (val result = TelemetryIngest.decode(data)) {
            is TelemetryIngest.Result.Accepted -> {
                val received = result.received
                childEventRepository.saveTelemetryEvent(received.event)
                if (received.notes.isNotEmpty()) {
                    Timber.w("Telemetry sync stored with notes %s: %s", received.notes, resourceId)
                } else {
                    Timber.d("Telemetry sync stored: %s", resourceId)
                }
            }

            is TelemetryIngest.Result.Rejected ->
                Timber.w("Telemetry sync rejected (%s): %s", result.reason, resourceId)
        }
    }
}
