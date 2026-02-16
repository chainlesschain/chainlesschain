package com.chainlesschain.android.core.p2p.connection

import timber.log.Timber
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 心跳管理器
 *
 * 负责管理P2P连接的心跳机制，包括：
 * - 定期发送心跳包
 * - 检测连接超时
 * - 触发自动重连
 */
@Singleton
class HeartbeatManager @Inject constructor() {

    companion object {
        /** 心跳间隔（毫秒） */
        const val HEARTBEAT_INTERVAL_MS = 15_000L

        /** 连接超时时间（毫秒）- 2个心跳周期 */
        const val CONNECTION_TIMEOUT_MS = 35_000L

        /** 最大重连尝试次数 */
        const val MAX_RECONNECT_ATTEMPTS = 5

        /** 重连基础延迟（毫秒） */
        const val RECONNECT_BASE_DELAY_MS = 2_000L

        /** 最大重连延迟（毫秒） */
        const val MAX_RECONNECT_DELAY_MS = 60_000L
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 每个设备的最后心跳时间
    private val lastHeartbeatTimes = ConcurrentHashMap<String, Long>()

    // 每个设备的重连尝试次数
    private val reconnectAttempts = ConcurrentHashMap<String, Int>()

    // 心跳发送任务
    private var heartbeatJob: Job? = null

    // 超时检测任务
    private var timeoutCheckJob: Job? = null

    // 消息发送回调
    private var onSendHeartbeat: (suspend (String, P2PMessage) -> Unit)? = null

    // 连接超时事件
    private val _connectionTimeoutEvents = MutableSharedFlow<ConnectionTimeoutEvent>()
    val connectionTimeoutEvents: SharedFlow<ConnectionTimeoutEvent> = _connectionTimeoutEvents.asSharedFlow()

    // 重连事件
    private val _reconnectEvents = MutableSharedFlow<ReconnectEvent>()
    val reconnectEvents: SharedFlow<ReconnectEvent> = _reconnectEvents.asSharedFlow()

    // 本地设备ID
    private var localDeviceId: String = ""

    /**
     * 启动心跳管理器
     *
     * @param localDeviceId 本地设备ID
     * @param onSendHeartbeat 发送心跳的回调函数
     */
    fun start(
        localDeviceId: String,
        onSendHeartbeat: suspend (deviceId: String, message: P2PMessage) -> Unit
    ) {
        this.localDeviceId = localDeviceId
        this.onSendHeartbeat = onSendHeartbeat

        startHeartbeatSending()
        startTimeoutChecking()

        Timber.i("HeartbeatManager started for device: $localDeviceId")
    }

    /**
     * 停止心跳管理器
     */
    fun stop() {
        heartbeatJob?.cancel()
        timeoutCheckJob?.cancel()
        heartbeatJob = null
        timeoutCheckJob = null

        lastHeartbeatTimes.clear()
        reconnectAttempts.clear()

        Timber.i("HeartbeatManager stopped")
    }

    /**
     * 注册设备连接
     *
     * @param deviceId 设备ID
     */
    fun registerDevice(deviceId: String) {
        lastHeartbeatTimes[deviceId] = System.currentTimeMillis()
        reconnectAttempts[deviceId] = 0
        Timber.d("Device registered: $deviceId")
    }

    /**
     * 注销设备连接
     *
     * @param deviceId 设备ID
     */
    fun unregisterDevice(deviceId: String) {
        lastHeartbeatTimes.remove(deviceId)
        reconnectAttempts.remove(deviceId)
        Timber.d("Device unregistered: $deviceId")
    }

    /**
     * 记录收到的心跳
     *
     * @param deviceId 设备ID
     */
    fun recordHeartbeat(deviceId: String) {
        lastHeartbeatTimes[deviceId] = System.currentTimeMillis()
        reconnectAttempts[deviceId] = 0 // 重置重连计数
        Timber.v("Heartbeat received from: $deviceId")
    }

    /**
     * 处理接收到的心跳消息
     *
     * @param message 心跳消息
     * @return 是否是心跳消息
     */
    fun handleHeartbeatMessage(message: P2PMessage): Boolean {
        return if (message.type == MessageType.HEARTBEAT) {
            recordHeartbeat(message.fromDeviceId)
            true
        } else {
            false
        }
    }

    /**
     * 获取设备最后活跃时间
     *
     * @param deviceId 设备ID
     * @return 最后活跃时间戳，如果设备不存在返回null
     */
    fun getLastActiveTime(deviceId: String): Long? {
        return lastHeartbeatTimes[deviceId]
    }

    /**
     * 获取设备活跃状态
     *
     * @param deviceId 设备ID
     * @return 设备是否活跃
     */
    fun isDeviceActive(deviceId: String): Boolean {
        val lastTime = lastHeartbeatTimes[deviceId] ?: return false
        return (System.currentTimeMillis() - lastTime) < CONNECTION_TIMEOUT_MS
    }

    /**
     * 获取所有活跃设备ID
     */
    fun getActiveDeviceIds(): Set<String> {
        val currentTime = System.currentTimeMillis()
        return lastHeartbeatTimes.filterValues { lastTime ->
            (currentTime - lastTime) < CONNECTION_TIMEOUT_MS
        }.keys.toSet()
    }

    /**
     * 获取重连尝试次数
     *
     * @param deviceId 设备ID
     * @return 重连尝试次数
     */
    fun getReconnectAttempts(deviceId: String): Int {
        return reconnectAttempts[deviceId] ?: 0
    }

    /**
     * 增加重连尝试次数
     *
     * @param deviceId 设备ID
     * @return 当前重连尝试次数
     */
    fun incrementReconnectAttempts(deviceId: String): Int {
        val current = reconnectAttempts.getOrPut(deviceId) { 0 }
        val newCount = current + 1
        reconnectAttempts[deviceId] = newCount
        return newCount
    }

    /**
     * 重置重连尝试次数
     *
     * @param deviceId 设备ID
     */
    fun resetReconnectAttempts(deviceId: String) {
        reconnectAttempts[deviceId] = 0
    }

    /**
     * 计算重连延迟（指数退避）
     *
     * @param deviceId 设备ID
     * @return 延迟时间（毫秒）
     */
    fun calculateReconnectDelay(deviceId: String): Long {
        val attempts = getReconnectAttempts(deviceId)
        val delay = RECONNECT_BASE_DELAY_MS * (1L shl attempts.coerceAtMost(5))
        return delay.coerceAtMost(MAX_RECONNECT_DELAY_MS)
    }

    /**
     * 是否可以继续重连
     *
     * @param deviceId 设备ID
     * @return 是否可以重连
     */
    fun canRetryReconnect(deviceId: String): Boolean {
        return getReconnectAttempts(deviceId) < MAX_RECONNECT_ATTEMPTS
    }

    /**
     * 启动心跳发送任务
     */
    private fun startHeartbeatSending() {
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(HEARTBEAT_INTERVAL_MS)

                // 向所有已注册的设备发送心跳
                val devices = lastHeartbeatTimes.keys.toList()
                for (deviceId in devices) {
                    try {
                        sendHeartbeat(deviceId)
                    } catch (e: Exception) {
                        Timber.e(e, "Failed to send heartbeat to $deviceId")
                    }
                }
            }
        }
    }

    /**
     * 发送心跳消息
     */
    private suspend fun sendHeartbeat(deviceId: String) {
        val heartbeatMessage = P2PMessage(
            id = "hb-${UUID.randomUUID()}",
            fromDeviceId = localDeviceId,
            toDeviceId = deviceId,
            type = MessageType.HEARTBEAT,
            payload = System.currentTimeMillis().toString(),
            timestamp = System.currentTimeMillis(),
            requiresAck = false,
            isAcknowledged = false
        )

        onSendHeartbeat?.invoke(deviceId, heartbeatMessage)
        Timber.v("Heartbeat sent to: $deviceId")
    }

    /**
     * 启动超时检测任务
     */
    private fun startTimeoutChecking() {
        timeoutCheckJob = scope.launch {
            while (isActive) {
                delay(HEARTBEAT_INTERVAL_MS / 2) // 检测频率为心跳间隔的一半

                val currentTime = System.currentTimeMillis()
                val timedOutDevices = mutableListOf<String>()

                for ((deviceId, lastTime) in lastHeartbeatTimes) {
                    val elapsed = currentTime - lastTime

                    if (elapsed > CONNECTION_TIMEOUT_MS) {
                        timedOutDevices.add(deviceId)
                    }
                }

                // 处理超时的设备
                for (deviceId in timedOutDevices) {
                    handleConnectionTimeout(deviceId)
                }
            }
        }
    }

    /**
     * 处理连接超时
     */
    private suspend fun handleConnectionTimeout(deviceId: String) {
        Timber.w("Connection timeout detected for device: $deviceId")

        val attempts = incrementReconnectAttempts(deviceId)
        val canRetry = canRetryReconnect(deviceId)

        // 发出超时事件
        _connectionTimeoutEvents.emit(
            ConnectionTimeoutEvent(
                deviceId = deviceId,
                lastHeartbeatTime = lastHeartbeatTimes[deviceId] ?: 0,
                reconnectAttempts = attempts,
                willRetry = canRetry
            )
        )

        if (canRetry) {
            val delay = calculateReconnectDelay(deviceId)
            Timber.i("Will retry reconnect to $deviceId in ${delay}ms (attempt $attempts)")

            // 发出重连事件
            _reconnectEvents.emit(
                ReconnectEvent(
                    deviceId = deviceId,
                    attemptNumber = attempts,
                    delayMs = delay,
                    reason = ReconnectReason.HEARTBEAT_TIMEOUT
                )
            )
        } else {
            Timber.e("Max reconnect attempts reached for device: $deviceId")
            // 移除该设备
            unregisterDevice(deviceId)
        }
    }

    /**
     * 释放资源
     */
    fun release() {
        stop()
        scope.cancel()
    }
}

/**
 * 连接超时事件
 */
data class ConnectionTimeoutEvent(
    /** 设备ID */
    val deviceId: String,

    /** 最后心跳时间 */
    val lastHeartbeatTime: Long,

    /** 重连尝试次数 */
    val reconnectAttempts: Int,

    /** 是否会尝试重连 */
    val willRetry: Boolean
)

/**
 * 重连事件
 */
data class ReconnectEvent(
    /** 设备ID */
    val deviceId: String,

    /** 尝试次数 */
    val attemptNumber: Int,

    /** 延迟时间（毫秒） */
    val delayMs: Long,

    /** 重连原因 */
    val reason: ReconnectReason
)

/**
 * 重连原因
 */
enum class ReconnectReason {
    /** 心跳超时 */
    HEARTBEAT_TIMEOUT,

    /** 连接断开 */
    CONNECTION_LOST,

    /** ICE 失败 */
    ICE_FAILED,

    /** 网络变化 */
    NETWORK_CHANGE,

    /** 用户请求 */
    USER_REQUEST
}
