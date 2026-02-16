package com.chainlesschain.android.core.p2p.realtime

import timber.log.Timber
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.sync.MessageQueue
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.Json
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 在线状态管理器
 *
 * 负责：
 * 1. 广播本设备的在线状态
 * 2. 监听其他设备的在线状态
 * 3. 维护好友的在线状态缓存
 * 4. 定期心跳更新
 */
@Singleton
class PresenceManager @Inject constructor(
    private val messageQueue: MessageQueue
) {

    companion object {
        /** 心跳间隔（毫秒） */
        private const val HEARTBEAT_INTERVAL_MS = 60000L // 1 分钟

        /** 离线超时（毫秒） */
        private const val OFFLINE_TIMEOUT_MS = 180000L // 3 分钟
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val json = Json { ignoreUnknownKeys = true }

    // 当前设备状态
    private val _currentStatus = MutableStateFlow(PresenceStatus.OFFLINE)
    val currentStatus: StateFlow<PresenceStatus> = _currentStatus.asStateFlow()

    // 好友在线状态缓存（DID -> 状态信息）
    private val presenceCache = ConcurrentHashMap<String, PresenceInfo>()

    // 在线状态变更流
    private val _presenceUpdates = MutableSharedFlow<PresenceUpdateEvent>(
        replay = 0,
        extraBufferCapacity = 50,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val presenceUpdates: SharedFlow<PresenceUpdateEvent> = _presenceUpdates.asSharedFlow()

    private var heartbeatJob: Job? = null
    private var cleanupJob: Job? = null

    /**
     * 开始广播在线状态
     */
    fun startBroadcasting() {
        if (heartbeatJob?.isActive == true) {
            Timber.w("Already broadcasting presence")
            return
        }

        Timber.i("Starting presence broadcasting")

        // 立即广播一次
        scope.launch {
            broadcastPresence()
        }

        // 定期心跳广播
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(HEARTBEAT_INTERVAL_MS)
                broadcastPresence()
            }
        }

        // 定期清理过期状态
        cleanupJob = scope.launch {
            while (isActive) {
                delay(60000L) // 每分钟清理一次
                cleanupExpiredPresence()
            }
        }
    }

    /**
     * 停止广播在线状态
     */
    fun stopBroadcasting() {
        heartbeatJob?.cancel()
        heartbeatJob = null
        cleanupJob?.cancel()
        cleanupJob = null

        // 广播离线状态
        scope.launch {
            setStatus(PresenceStatus.OFFLINE)
            broadcastPresence()
        }

        Timber.i("Stopped presence broadcasting")
    }

    /**
     * 设置当前设备状态
     */
    suspend fun setStatus(status: PresenceStatus) {
        if (_currentStatus.value != status) {
            _currentStatus.value = status
            Timber.d("Status changed to: $status")
            broadcastPresence()
        }
    }

    /**
     * 获取好友的在线状态
     */
    fun getPresence(did: String): PresenceInfo? {
        return presenceCache[did]
    }

    /**
     * 获取所有在线好友
     */
    fun getOnlineFriends(): List<String> {
        val now = System.currentTimeMillis()
        return presenceCache.entries
            .filter { it.value.status == PresenceStatus.ONLINE }
            .filter { now - it.value.lastActiveAt < OFFLINE_TIMEOUT_MS }
            .map { it.key }
    }

    /**
     * 监听特定好友的在线状态
     */
    fun observePresence(did: String): Flow<PresenceInfo?> {
        return presenceUpdates
            .filter { it.did == did }
            .map { getPresence(did) }
            .onStart { emit(getPresence(did)) }
    }

    /**
     * 处理接收到的在线状态更新
     */
    suspend fun handlePresenceUpdate(message: P2PMessage) {
        try {
            val payload = json.decodeFromString(PresencePayload.serializer(), message.payload)
            val did = message.fromDeviceId

            val presenceInfo = PresenceInfo(
                did = did,
                status = payload.status,
                lastActiveAt = payload.lastActiveAt,
                receivedAt = System.currentTimeMillis()
            )

            presenceCache[did] = presenceInfo

            // 发送状态更新事件
            val event = PresenceUpdateEvent(
                did = did,
                status = payload.status,
                lastActiveAt = payload.lastActiveAt
            )
            _presenceUpdates.emit(event)

            Timber.d("Presence updated: $did -> ${payload.status}")

        } catch (e: Exception) {
            Timber.e(e, "Failed to handle presence update")
        }
    }

    /**
     * 广播当前设备的在线状态
     */
    private suspend fun broadcastPresence() {
        val payload = PresencePayload(
            status = _currentStatus.value,
            lastActiveAt = System.currentTimeMillis()
        )

        val message = P2PMessage(
            id = java.util.UUID.randomUUID().toString(),
            fromDeviceId = "", // 将由发送方填充
            toDeviceId = "", // 广播到所有设备
            type = MessageType.PRESENCE_UPDATE,
            payload = json.encodeToString(PresencePayload.serializer(), payload),
            requiresAck = false // 不需要确认
        )

        messageQueue.enqueue(message)
        Timber.d("Presence broadcasted: ${_currentStatus.value}")
    }

    /**
     * 清理过期的在线状态
     */
    private fun cleanupExpiredPresence() {
        val now = System.currentTimeMillis()
        val expiredDids = presenceCache.entries
            .filter { now - it.value.receivedAt > OFFLINE_TIMEOUT_MS }
            .map { it.key }

        expiredDids.forEach { did ->
            presenceCache.remove(did)
            Timber.d("Presence expired and removed: $did")
        }

        if (expiredDids.isNotEmpty()) {
            Timber.i("Cleaned up ${expiredDids.size} expired presence records")
        }
    }
}

/**
 * 在线状态信息
 */
data class PresenceInfo(
    /** 用户 DID */
    val did: String,

    /** 在线状态 */
    val status: PresenceStatus,

    /** 最后活跃时间 */
    val lastActiveAt: Long,

    /** 本地接收时间 */
    val receivedAt: Long
) {
    /**
     * 是否在线
     */
    fun isOnline(): Boolean {
        val now = System.currentTimeMillis()
        return status == PresenceStatus.ONLINE &&
               (now - lastActiveAt < 180000L) // 3 分钟内
    }

    /**
     * 是否最近活跃
     */
    fun isRecentlyActive(): Boolean {
        val now = System.currentTimeMillis()
        return (now - lastActiveAt < 300000L) // 5 分钟内
    }
}
