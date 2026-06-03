package com.chainlesschain.android.feature.familyguard.domain.telemetry

import kotlinx.coroutines.flow.Flow

/**
 * 通用 telemetry 数据源抽象 (FAMILY-21).
 *
 * 4 类 (TelemetrySourceType) 实现共享同一接口:
 *   - ForegroundAppTelemetrySource (FAMILY-20)
 *   - PdhTelemetrySource (Epic C 后续 ticket, wrap PDH collector → TelemetryEvent)
 *   - SnapshotTelemetrySource (Plan C ContentResolver)
 *   - AccessibilityTelemetrySource (M4 Enforce)
 *
 * 调用方 (CentralTelemetryDispatcher 留 FAMILY-XX) 启动时 subscribe 所有 source 的
 * [events] flow, 收 event → 走 FamilyPermissionChecker (FAMILY-25 上行权限过滤)
 * → ChildEventRepository.saveTelemetryEvent → Sync engine outbox (FAMILY-26).
 *
 * [pause] / [resume] 在 quiet hours 命中 / emergency freeze (FAMILY-16) 触发时
 * 由 dispatcher 调用; source 实现负责真停采集 (不仅是丢弃 emit, 是停硬件 / IPC).
 */
interface TelemetrySource {

    val sourceType: TelemetrySourceType

    /** Cold flow. 第一个 subscriber 触发 source 启 collection; 没 subscriber 时省电。 */
    fun events(): Flow<TelemetryEvent>

    /** 临时停采集 (quiet hours / freeze). 幂等; 已停时再调 no-op. */
    suspend fun pause()

    /** 恢复采集. 幂等. */
    suspend fun resume()

    /** 当前是否处在 pause 态; UI / Audit 可观察. */
    fun isPaused(): Boolean
}
