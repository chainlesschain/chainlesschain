package com.chainlesschain.android.core.p2p.connection

import android.util.Log
import com.chainlesschain.android.core.p2p.model.P2PDevice
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 自动重连管理器
 *
 * 负责在连接断开时自动尝试重新连接，支持：
 * - 指数退避重连策略
 * - 最大重连次数限制
 * - 网络状态感知
 * - 重连队列管理
 */
@Singleton
class AutoReconnectManager @Inject constructor(
    private val heartbeatManager: HeartbeatManager,
    dispatcher: CoroutineDispatcher = Dispatchers.IO
) {

    companion object {
        private const val TAG = "AutoReconnectManager"

        /** 重连队列处理间隔（毫秒） */
        const val QUEUE_PROCESS_INTERVAL_MS = 1_000L
    }

    private val scope = CoroutineScope(dispatcher + SupervisorJob())

    // 待重连设备队列
    private val reconnectQueue = ConcurrentHashMap<String, ReconnectTask>()

    // 已知设备信息缓存
    private val deviceCache = ConcurrentHashMap<String, P2PDevice>()

    // 重连回调
    private var onReconnect: (suspend (P2PDevice) -> Unit)? = null

    // 重连状态事件 - 使用extraBufferCapacity确保事件不会丢失
    private val _reconnectStatusEvents = MutableSharedFlow<ReconnectStatusEvent>(
        extraBufferCapacity = 64
    )
    val reconnectStatusEvents: SharedFlow<ReconnectStatusEvent> = _reconnectStatusEvents.asSharedFlow()

    // 队列处理任务
    private var queueProcessJob: Job? = null

    // 是否暂停重连（例如网络不可用时）
    private var isPaused = false

    /**
     * 启动自动重连管理器
     *
     * @param onReconnect 重连回调
     */
    fun start(onReconnect: suspend (P2PDevice) -> Unit) {
        this.onReconnect = onReconnect

        // 监听心跳管理器的重连事件
        scope.launch {
            heartbeatManager.reconnectEvents.collect { event ->
                scheduleReconnect(event.deviceId, event.delayMs, event.reason)
            }
        }

        startQueueProcessing()
        Log.i(TAG, "AutoReconnectManager started")
    }

    /**
     * 停止自动重连管理器
     */
    fun stop() {
        queueProcessJob?.cancel()
        queueProcessJob = null
        reconnectQueue.clear()
        Log.i(TAG, "AutoReconnectManager stopped")
    }

    /**
     * 缓存设备信息
     *
     * @param device 设备信息
     */
    fun cacheDevice(device: P2PDevice) {
        deviceCache[device.deviceId] = device
        Log.d(TAG, "Device cached: ${device.deviceName}")
    }

    /**
     * 移除缓存的设备
     *
     * @param deviceId 设备ID
     */
    fun removeDeviceCache(deviceId: String) {
        deviceCache.remove(deviceId)
        Log.d(TAG, "Device cache removed: $deviceId")
    }

    /**
     * 获取缓存的设备信息
     *
     * @param deviceId 设备ID
     * @return 设备信息
     */
    fun getCachedDevice(deviceId: String): P2PDevice? {
        return deviceCache[deviceId]
    }

    /**
     * 安排重连任务
     *
     * @param deviceId 设备ID
     * @param delayMs 延迟时间
     * @param reason 重连原因
     */
    fun scheduleReconnect(deviceId: String, delayMs: Long, reason: ReconnectReason) {
        if (isPaused) {
            Log.d(TAG, "Reconnect paused, skipping schedule for: $deviceId")
            return
        }

        val device = deviceCache[deviceId]
        if (device == null) {
            Log.w(TAG, "No cached device info for: $deviceId, cannot schedule reconnect")
            return
        }

        val executeAt = System.currentTimeMillis() + delayMs
        val attemptNumber = heartbeatManager.getReconnectAttempts(deviceId)

        val task = ReconnectTask(
            deviceId = deviceId,
            device = device,
            executeAt = executeAt,
            attemptNumber = attemptNumber,
            reason = reason
        )

        reconnectQueue[deviceId] = task

        Log.i(TAG, "Reconnect scheduled for $deviceId at +${delayMs}ms (attempt $attemptNumber)")

        scope.launch {
            _reconnectStatusEvents.emit(
                ReconnectStatusEvent(
                    deviceId = deviceId,
                    status = ReconnectStatus.SCHEDULED,
                    attemptNumber = attemptNumber,
                    scheduledAt = executeAt
                )
            )
        }
    }

    /**
     * 取消重连任务
     *
     * @param deviceId 设备ID
     */
    fun cancelReconnect(deviceId: String) {
        reconnectQueue.remove(deviceId)
        heartbeatManager.resetReconnectAttempts(deviceId)
        Log.i(TAG, "Reconnect cancelled for: $deviceId")

        scope.launch {
            _reconnectStatusEvents.emit(
                ReconnectStatusEvent(
                    deviceId = deviceId,
                    status = ReconnectStatus.CANCELLED
                )
            )
        }
    }

    /**
     * 暂停所有重连
     */
    fun pause() {
        isPaused = true
        Log.i(TAG, "AutoReconnect paused")
    }

    /**
     * 恢复重连
     */
    fun resume() {
        isPaused = false
        Log.i(TAG, "AutoReconnect resumed")
    }

    /**
     * 立即重连设备
     *
     * @param deviceId 设备ID
     */
    suspend fun reconnectNow(deviceId: String) {
        val device = deviceCache[deviceId]
        if (device == null) {
            Log.w(TAG, "No cached device info for: $deviceId")
            return
        }

        // 移除队列中的任务
        reconnectQueue.remove(deviceId)

        // 执行重连
        executeReconnect(device)
    }

    /**
     * 获取队列中的待重连设备数量
     */
    fun getPendingReconnectCount(): Int {
        return reconnectQueue.size
    }

    /**
     * 获取所有待重连设备ID
     */
    fun getPendingReconnectDeviceIds(): Set<String> {
        return reconnectQueue.keys.toSet()
    }

    /**
     * 启动队列处理任务
     */
    private fun startQueueProcessing() {
        queueProcessJob = scope.launch {
            while (isActive) {
                delay(QUEUE_PROCESS_INTERVAL_MS)

                if (isPaused) continue

                val currentTime = System.currentTimeMillis()
                val readyTasks = reconnectQueue.values.filter { it.executeAt <= currentTime }

                for (task in readyTasks) {
                    reconnectQueue.remove(task.deviceId)
                    launch {
                        executeReconnect(task.device)
                    }
                }
            }
        }
    }

    /**
     * 执行重连
     */
    private suspend fun executeReconnect(device: P2PDevice) {
        val deviceId = device.deviceId
        val attemptNumber = heartbeatManager.getReconnectAttempts(deviceId)

        Log.i(TAG, "Executing reconnect for ${device.deviceName} (attempt $attemptNumber)")

        _reconnectStatusEvents.emit(
            ReconnectStatusEvent(
                deviceId = deviceId,
                status = ReconnectStatus.IN_PROGRESS,
                attemptNumber = attemptNumber
            )
        )

        try {
            onReconnect?.invoke(device)

            _reconnectStatusEvents.emit(
                ReconnectStatusEvent(
                    deviceId = deviceId,
                    status = ReconnectStatus.SUCCESS,
                    attemptNumber = attemptNumber
                )
            )

            Log.i(TAG, "Reconnect successful for: ${device.deviceName}")
        } catch (e: Exception) {
            Log.e(TAG, "Reconnect failed for ${device.deviceName}", e)

            _reconnectStatusEvents.emit(
                ReconnectStatusEvent(
                    deviceId = deviceId,
                    status = ReconnectStatus.FAILED,
                    attemptNumber = attemptNumber,
                    error = e.message
                )
            )

            // 检查是否可以继续重连
            if (heartbeatManager.canRetryReconnect(deviceId)) {
                val nextAttempt = heartbeatManager.incrementReconnectAttempts(deviceId)
                val delay = heartbeatManager.calculateReconnectDelay(deviceId)
                scheduleReconnect(deviceId, delay, ReconnectReason.CONNECTION_LOST)
            } else {
                Log.e(TAG, "Max reconnect attempts reached for: ${device.deviceName}")

                _reconnectStatusEvents.emit(
                    ReconnectStatusEvent(
                        deviceId = deviceId,
                        status = ReconnectStatus.EXHAUSTED,
                        attemptNumber = attemptNumber
                    )
                )
            }
        }
    }

    /**
     * 释放资源
     */
    fun release() {
        stop()
        deviceCache.clear()
        scope.cancel()
    }
}

/**
 * 重连任务
 */
data class ReconnectTask(
    /** 设备ID */
    val deviceId: String,

    /** 设备信息 */
    val device: P2PDevice,

    /** 计划执行时间 */
    val executeAt: Long,

    /** 尝试次数 */
    val attemptNumber: Int,

    /** 重连原因 */
    val reason: ReconnectReason
)

/**
 * 重连状态事件
 */
data class ReconnectStatusEvent(
    /** 设备ID */
    val deviceId: String,

    /** 重连状态 */
    val status: ReconnectStatus,

    /** 尝试次数 */
    val attemptNumber: Int = 0,

    /** 计划执行时间 */
    val scheduledAt: Long? = null,

    /** 错误信息 */
    val error: String? = null
)

/**
 * 重连状态
 */
enum class ReconnectStatus {
    /** 已安排 */
    SCHEDULED,

    /** 进行中 */
    IN_PROGRESS,

    /** 成功 */
    SUCCESS,

    /** 失败 */
    FAILED,

    /** 已取消 */
    CANCELLED,

    /** 尝试次数用尽 */
    EXHAUSTED
}
