package com.chainlesschain.android.core.p2p.sync

import android.util.Log
import com.chainlesschain.android.core.p2p.model.MessageType
import com.chainlesschain.android.core.p2p.model.P2PMessage
import com.chainlesschain.android.core.p2p.transport.MessageTransport
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 同步管理器
 *
 * 管理设备间的数据同步
 * - 增量同步（仅同步变更）
 * - 冲突检测和解决
 * - Last-Write-Wins策略
 */
@Singleton
class SyncManager @Inject constructor(
    private val messageQueue: MessageQueue,
    private val conflictResolver: ConflictResolver
) {

    companion object {
        private const val TAG = "SyncManager"

        /** 同步间隔（毫秒） */
        private const val SYNC_INTERVAL_MS = 30000L // 30秒
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // 设备最后同步时间戳
    private val lastSyncTimestamp = ConcurrentHashMap<String, Long>()

    // 同步状态
    private val _syncState = MutableStateFlow<SyncState>(SyncState.Idle)
    val syncState: StateFlow<SyncState> = _syncState.asStateFlow()

    // 待同步项（资源ID -> 变更）
    private val pendingChanges = ConcurrentHashMap<String, SyncItem>()

    // 本地状态缓存（资源ID -> 本地项）
    private val localState = ConcurrentHashMap<String, SyncItem>()

    // 同步作业
    private var syncJob: Job? = null

    /**
     * 启动自动同步
     */
    fun startAutoSync() {
        if (syncJob?.isActive == true) {
            Log.w(TAG, "Auto sync already running")
            return
        }

        Log.i(TAG, "Starting auto sync")

        syncJob = scope.launch {
            while (isActive) {
                delay(SYNC_INTERVAL_MS)

                if (pendingChanges.isNotEmpty()) {
                    performSync()
                }
            }
        }
    }

    /**
     * 停止自动同步
     */
    fun stopAutoSync() {
        syncJob?.cancel()
        syncJob = null
        Log.i(TAG, "Auto sync stopped")
    }

    /**
     * 记录本地变更
     *
     * @param item 变更项
     */
    fun recordChange(item: SyncItem) {
        pendingChanges[item.resourceId] = item
        localState[item.resourceId] = item
        Log.d(TAG, "Change recorded: ${item.resourceId} (${item.operation})")
    }

    /**
     * 手动触发同步
     *
     * @param deviceId 目标设备ID，如果为null则同步到所有设备
     */
    suspend fun triggerSync(deviceId: String? = null) {
        _syncState.value = SyncState.Syncing(progress = 0)

        try {
            performSync(deviceId)
            _syncState.value = SyncState.Completed
        } catch (e: Exception) {
            Log.e(TAG, "Sync failed", e)
            _syncState.value = SyncState.Failed(e.message ?: "Unknown error")
        }
    }

    /**
     * 执行同步
     */
    private suspend fun performSync(targetDeviceId: String? = null) {
        if (pendingChanges.isEmpty()) {
            Log.d(TAG, "No changes to sync")
            return
        }

        Log.i(TAG, "Starting sync (${pendingChanges.size} changes)")

        val changes = pendingChanges.values.toList()
        val totalChanges = changes.size
        var syncedCount = 0

        changes.forEach { change ->
            try {
                // 创建同步消息
                val syncMessage = createSyncMessage(change, targetDeviceId)

                // 入队发送
                messageQueue.enqueue(syncMessage)

                // 标记为已同步
                pendingChanges.remove(change.resourceId)

                syncedCount++

                // 更新进度
                val progress = (syncedCount * 100) / totalChanges
                _syncState.value = SyncState.Syncing(progress)

                Log.d(TAG, "Synced: ${change.resourceId} ($syncedCount/$totalChanges)")

            } catch (e: Exception) {
                Log.e(TAG, "Failed to sync item: ${change.resourceId}", e)
            }
        }

        // 更新最后同步时间
        if (targetDeviceId != null) {
            lastSyncTimestamp[targetDeviceId] = System.currentTimeMillis()
        }

        Log.i(TAG, "Sync completed: $syncedCount/$totalChanges")
    }

    /**
     * 处理接收到的同步消息
     *
     * @param message 同步消息
     * @return 处理结果
     */
    suspend fun handleSyncMessage(message: P2PMessage): SyncResult {
        return try {
            val syncPayload = kotlinx.serialization.json.Json.decodeFromString(
                SyncPayload.serializer(),
                message.payload
            )

            // 冲突检测
            val conflict = detectConflict(syncPayload.item)

            if (conflict != null) {
                // 解决冲突
                val resolution = conflictResolver.resolve(conflict)

                Log.d(TAG, "Conflict resolved: ${syncPayload.item.resourceId} -> ${resolution.strategy}")

                SyncResult.ConflictResolved(resolution)
            } else {
                // 应用变更
                applySyncItem(syncPayload.item)

                Log.d(TAG, "Sync item applied: ${syncPayload.item.resourceId}")

                SyncResult.Applied(syncPayload.item)
            }

        } catch (e: Exception) {
            Log.e(TAG, "Failed to handle sync message", e)
            SyncResult.Error(e.message ?: "Unknown error")
        }
    }

    /**
     * 创建同步消息
     */
    private fun createSyncMessage(item: SyncItem, targetDeviceId: String?): P2PMessage {
        val payload = SyncPayload(
            item = item,
            timestamp = System.currentTimeMillis()
        )

        val messageType = when (item.resourceType) {
            ResourceType.KNOWLEDGE_ITEM -> MessageType.KNOWLEDGE_SYNC
            ResourceType.CONVERSATION -> MessageType.CONVERSATION_SYNC
            else -> MessageType.TEXT
        }

        return P2PMessage(
            id = UUID.randomUUID().toString(),
            fromDeviceId = "", // 将由发送方填充
            toDeviceId = targetDeviceId ?: "",
            type = messageType,
            payload = kotlinx.serialization.json.Json.encodeToString(
                SyncPayload.serializer(),
                payload
            ),
            requiresAck = true
        )
    }

    /**
     * 检测冲突
     */
    private fun detectConflict(item: SyncItem): SyncConflict? {
        // 获取本地状态
        val localItem = localState[item.resourceId]

        // 获取默认策略
        val strategy = conflictResolver.getDefaultStrategy(item.resourceType)

        // 使用ConflictResolver检测冲突
        return conflictResolver.detectConflict(localItem, item, strategy)
    }

    /**
     * 应用同步项
     */
    private suspend fun applySyncItem(item: SyncItem) {
        // TODO: 根据resourceType和operation应用变更
        // 这里需要调用相应的Repository来更新数据库

        when (item.operation) {
            SyncOperation.CREATE -> {
                // 创建新记录
                Log.d(TAG, "Creating: ${item.resourceId}")
                localState[item.resourceId] = item
            }
            SyncOperation.UPDATE -> {
                // 更新记录
                Log.d(TAG, "Updating: ${item.resourceId}")
                localState[item.resourceId] = item
            }
            SyncOperation.DELETE -> {
                // 删除记录
                Log.d(TAG, "Deleting: ${item.resourceId}")
                localState.remove(item.resourceId)
            }
        }
    }

    /**
     * 获取增量变更
     *
     * @param deviceId 设备ID
     * @param since 起始时间戳
     * @return 变更列表
     */
    fun getIncrementalChanges(deviceId: String, since: Long): List<SyncItem> {
        val lastSync = lastSyncTimestamp[deviceId] ?: 0

        return pendingChanges.values.filter { item ->
            item.timestamp > lastSync && item.timestamp > since
        }
    }

    /**
     * 获取同步统计
     */
    fun getSyncStatistics(): SyncStatistics {
        return SyncStatistics(
            pendingChanges = pendingChanges.size,
            lastSyncTimestamps = lastSyncTimestamp.toMap()
        )
    }
}

/**
 * 同步状态
 */
sealed class SyncState {
    /** 空闲 */
    data object Idle : SyncState()

    /** 同步中 */
    data class Syncing(val progress: Int) : SyncState()

    /** 完成 */
    data object Completed : SyncState()

    /** 失败 */
    data class Failed(val error: String) : SyncState()
}

/**
 * 同步结果
 */
sealed class SyncResult {
    /** 已应用 */
    data class Applied(val item: SyncItem) : SyncResult()

    /** 冲突已解决 */
    data class ConflictResolved(val resolution: ConflictResolution) : SyncResult()

    /** 错误 */
    data class Error(val message: String) : SyncResult()
}

/**
 * 同步项
 */
@Serializable
data class SyncItem(
    /** 资源ID */
    val resourceId: String,

    /** 资源类型 */
    val resourceType: ResourceType,

    /** 操作类型 */
    val operation: SyncOperation,

    /** 数据内容（JSON） */
    val data: String,

    /** 时间戳 */
    val timestamp: Long,

    /** 版本号 */
    val version: Int = 1
)

/**
 * 资源类型
 */
@Serializable
enum class ResourceType {
    KNOWLEDGE_ITEM,
    CONVERSATION,
    MESSAGE,
    CONTACT,
    SETTING
}

/**
 * 同步操作
 */
@Serializable
enum class SyncOperation {
    CREATE,
    UPDATE,
    DELETE
}

/**
 * 同步负载
 */
@Serializable
data class SyncPayload(
    val item: SyncItem,
    val timestamp: Long
)

/**
 * 同步统计
 */
data class SyncStatistics(
    /** 待同步变更数 */
    val pendingChanges: Int,

    /** 各设备最后同步时间 */
    val lastSyncTimestamps: Map<String, Long>
)
