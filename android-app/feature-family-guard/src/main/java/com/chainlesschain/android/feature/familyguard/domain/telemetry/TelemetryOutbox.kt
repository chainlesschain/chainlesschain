package com.chainlesschain.android.feature.familyguard.domain.telemetry

/**
 * 上行 outbox 端口 (FAMILY-26 seam).
 *
 * [CentralTelemetryDispatcher] 在事件过闸 + 落库后调 [enqueue], 把事件排入同步
 * outbox, 由 sync engine 推到对应 guardian 桌面端。
 *
 * :feature-family-guard **不依赖** :core-p2p (SyncManager / SyncOutbound 在那边),
 * 故此处只定义端口; 真实 SyncManager 适配器在 :app 层 (FAMILY-26) 绑定覆盖默认
 * no-op 实装
 * [com.chainlesschain.android.feature.familyguard.data.telemetry.NoOpTelemetryOutbox]。
 */
interface TelemetryOutbox {

    /**
     * @param savedRowId child_event 行 id (sync engine 用来关联本地行)。
     * @param guardianDids 过闸允许接收的 guardian DID 列表 (上行 fan-out 目标)。
     */
    suspend fun enqueue(event: TelemetryEvent, savedRowId: Long, guardianDids: List<String>)
}
