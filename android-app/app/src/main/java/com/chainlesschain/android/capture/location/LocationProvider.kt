package com.chainlesschain.android.capture.location

import kotlinx.coroutines.flow.Flow

/**
 * GPS / fused location 提供者的抽象。引入此接口的唯一目的：让 [LocationTagger]
 * 可以在 JVM 单测里 mock，而无需 Robolectric / Google Play Services / 真机。
 *
 * 真实实现见 `AndroidFusedLocationProvider`（M3 后续接入 Play Services 时落地）。
 *
 * 权限：实现侧应在调用前检查 [permissionState]；UI 层负责调起权限申请流程。
 */
interface LocationProvider {

    /** 当前权限 / 硬件可用状态。 */
    val permissionState: PermissionState

    /**
     * 订阅位置更新流。
     *
     * - 仅在 [permissionState] == [PermissionState.Granted] 时实际推送数据；否则
     *   返回的 Flow 立即 complete 或不发任何值（由实现决定，UI 应据 permissionState 提前 gate）
     * - cancel 协程即取消订阅
     *
     * @param minIntervalMs 两次推送之间的最小间隔（毫秒），实现侧可适度合并
     */
    fun updates(minIntervalMs: Long = DEFAULT_MIN_INTERVAL_MS): Flow<LocationTag>

    /**
     * 取一次性当前位置（fast path）。若无最近的有效缓存，可能耗时（需启动定位）。
     *
     * @return null 表示无权限 / 硬件不可用 / 超时
     */
    suspend fun lastKnown(timeoutMs: Long = DEFAULT_TIMEOUT_MS): LocationTag?

    enum class PermissionState {
        Granted,
        Denied,
        DeniedPermanent,
        HardwareUnavailable,
        Unknown,
    }

    companion object {
        const val DEFAULT_MIN_INTERVAL_MS: Long = 60_000L
        const val DEFAULT_TIMEOUT_MS: Long = 5_000L
    }
}
