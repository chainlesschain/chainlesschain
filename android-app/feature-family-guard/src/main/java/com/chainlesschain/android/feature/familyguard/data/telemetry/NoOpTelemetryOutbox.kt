package com.chainlesschain.android.feature.familyguard.data.telemetry

import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryEvent
import com.chainlesschain.android.feature.familyguard.domain.telemetry.TelemetryOutbox
import javax.inject.Inject
import javax.inject.Singleton
import timber.log.Timber

/**
 * [TelemetryOutbox] 默认 no-op 实装。
 *
 * 事件已落本地 child_event 表, 但**不上行** — :feature-family-guard 不依赖
 * :core-p2p 的 SyncManager。FAMILY-26 在 :app 层提供把 [TelemetryEvent] 包成
 * SyncItem 并 `SyncManager.recordChange` 的真实适配器, 在 Hilt 图中覆盖本绑定。
 */
@Singleton
class NoOpTelemetryOutbox @Inject constructor() : TelemetryOutbox {

    override suspend fun enqueue(
        event: TelemetryEvent,
        savedRowId: Long,
        guardianDids: List<String>,
    ) {
        Timber.d(
            "TelemetryOutbox no-op: row=%d source=%s guardians=%d (FAMILY-26 上行未接通)",
            savedRowId,
            event.source,
            guardianDids.size,
        )
    }
}
