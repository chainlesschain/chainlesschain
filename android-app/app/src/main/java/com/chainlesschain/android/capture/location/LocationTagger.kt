package com.chainlesschain.android.capture.location

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * 高层 location 服务：订阅 [LocationProvider] 推流，把最新位置以 StateFlow
 * 暴露给 UI / 业务逻辑。
 *
 * 用例（设计文档 §5.3）：
 *  - 拍照笔记打 GPS 标签（在 captureNote 时读 [lastTag]）
 *  - DID 凭证签发时附加位置（高敏 DID 操作的现场证据）
 *  - 位置触发的 sync 上下文（"在公司打卡" 类应用）
 *
 * 该类不强制订阅；调用者通过 [start] / [stop] 控制采样周期，避免后台耗电。
 */
class LocationTagger(
    private val provider: LocationProvider,
    private val scope: CoroutineScope,
) {

    private val _lastTag = MutableStateFlow<LocationTag?>(null)

    /** 最新一次位置；null 表示尚未取到（未启动 / 无权限 / 等待首个 fix）。 */
    val lastTag: StateFlow<LocationTag?> = _lastTag.asStateFlow()

    private val _state = MutableStateFlow(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private var collectJob: Job? = null

    /**
     * 启动订阅。重复调用幂等（已 Running 时直接返回当前 state）。
     *
     * @return 实际进入的状态：Running 表示已订阅 / PermissionRequired 表示需先申请权限
     */
    fun start(minIntervalMs: Long = LocationProvider.DEFAULT_MIN_INTERVAL_MS): State {
        if (_state.value == State.Running) return State.Running

        return when (provider.permissionState) {
            LocationProvider.PermissionState.Granted -> {
                collectJob = scope.launch {
                    provider.updates(minIntervalMs).collect { tag ->
                        _lastTag.value = tag
                        Timber.d(
                            "Location tag: lat=%.4f lon=%.4f accuracy=%.1fm provider=%s",
                            tag.latitude, tag.longitude, tag.accuracyMeters, tag.provider,
                        )
                    }
                }
                _state.value = State.Running
                State.Running
            }
            LocationProvider.PermissionState.Denied,
            LocationProvider.PermissionState.DeniedPermanent,
            -> {
                _state.value = State.PermissionRequired
                State.PermissionRequired
            }
            LocationProvider.PermissionState.HardwareUnavailable -> {
                _state.value = State.HardwareUnavailable
                State.HardwareUnavailable
            }
            LocationProvider.PermissionState.Unknown -> {
                _state.value = State.Idle
                State.Idle
            }
        }
    }

    /** 停止订阅。可重复调用。 */
    fun stop() {
        collectJob?.cancel()
        collectJob = null
        if (_state.value == State.Running) _state.value = State.Idle
    }

    /**
     * 取一次性当前位置（fast path），不影响订阅状态。
     *
     * @return null 表示无权限 / 硬件不可用 / 超时（详情看 [state]）
     */
    suspend fun fetchOnce(timeoutMs: Long = LocationProvider.DEFAULT_TIMEOUT_MS): LocationTag? {
        if (provider.permissionState != LocationProvider.PermissionState.Granted) return null
        val tag = provider.lastKnown(timeoutMs)
        if (tag != null) _lastTag.value = tag
        return tag
    }

    enum class State {
        /** 未启动，或已 stop 后的状态。 */
        Idle,

        /** 正在订阅推流。 */
        Running,

        /** 缺权限；调用者负责调起申请流程。 */
        PermissionRequired,

        /** 设备无 GPS / Location 硬件被关闭。 */
        HardwareUnavailable,
    }
}
