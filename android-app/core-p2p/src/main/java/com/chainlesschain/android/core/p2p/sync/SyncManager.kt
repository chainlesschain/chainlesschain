package com.chainlesschain.android.core.p2p.sync

import timber.log.Timber
import com.chainlesschain.android.core.database.dao.SyncRemoteCursorDao
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
    private val conflictResolver: ConflictResolver,
    private val syncDataApplier: SyncDataApplier,
    // Phase 3d M3 step C：游标 Room 持久化（replace ConcurrentHashMap）
    private val syncRemoteCursorDao: SyncRemoteCursorDao
) {

    companion object {
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
            Timber.w("Auto sync already running")
            return
        }

        Timber.i("Starting auto sync")

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
        Timber.i("Auto sync stopped")
    }

    /**
     * 记录本地变更
     *
     * @param item 变更项
     */
    fun recordChange(item: SyncItem) {
        pendingChanges[item.resourceId] = item
        localState[item.resourceId] = item
        Timber.d("Change recorded: ${item.resourceId} (${item.operation})")
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "Sync failed")
            _syncState.value = SyncState.Failed(e.message ?: "Unknown error")
        }
    }

    /**
     * 执行同步
     */
    private suspend fun performSync(targetDeviceId: String? = null) {
        if (pendingChanges.isEmpty()) {
            Timber.d("No changes to sync")
            return
        }

        Timber.i("Starting sync (${pendingChanges.size} changes)")

        val startedAt = System.currentTimeMillis()
        val changes = pendingChanges.values.toList()
        val totalChanges = changes.size
        var syncedCount = 0
        var lastError: String? = null

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

                Timber.d("Synced: ${change.resourceId} ($syncedCount/$totalChanges)")

            } catch (e: Exception) {
                Timber.e(e, "Failed to sync item: ${change.resourceId}")
                lastError = e.message ?: e.javaClass.simpleName
            }
        }

        val now = System.currentTimeMillis()

        // 更新最后同步时间。in-memory Map 保留供未读路径兜底；Room 是持久化主源。
        if (targetDeviceId != null) {
            lastSyncTimestamp[targetDeviceId] = now

            // Phase 3d M3 step C：游标 Room 持久化。使用 resourceType="ALL" sentinel
            // 与原 ConcurrentHashMap<String, Long> 语义对齐（每设备一行）；后续若需
            // 分 ResourceType 推进，按 SyncItem.resourceType 改写多行即可。
            try {
                syncRemoteCursorDao.advancePush(
                    deviceId = targetDeviceId,
                    resourceType = "ALL",
                    lastPushTs = now,
                    itemsPushedDelta = syncedCount.toLong(),
                    now = now
                )
                val status = when {
                    lastError != null -> "failed"
                    syncedCount < totalChanges -> "partial"
                    else -> "success"
                }
                syncRemoteCursorDao.recordRunResult(
                    deviceId = targetDeviceId,
                    resourceType = "ALL",
                    status = status,
                    error = lastError,
                    durationMs = now - startedAt,
                    conflictedDelta = 0,
                    now = now
                )
            } catch (e: Exception) {
                // Room 写失败不应阻塞 sync 流程（顶多丢统计）
                Timber.w(e, "Failed to persist sync cursor for $targetDeviceId")
            }
        }

        Timber.i("Sync completed: $syncedCount/$totalChanges")
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

                Timber.d("Conflict resolved: ${syncPayload.item.resourceId} -> ${resolution.strategy}")

                SyncResult.ConflictResolved(resolution)
            } else {
                // 应用变更
                applySyncItem(syncPayload.item)

                Timber.d("Sync item applied: ${syncPayload.item.resourceId}")

                SyncResult.Applied(syncPayload.item)
            }

        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "Failed to handle sync message")
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
     *
     * 根据资源类型和操作类型将远程变更持久化到本地状态。
     * 更新本地状态缓存并从待同步队列中移除已应用的变更，
     * 防止已接收的远程变更被回传。
     */
    private suspend fun applySyncItem(item: SyncItem) {
        when (item.operation) {
            SyncOperation.CREATE -> {
                Timber.d("Applying CREATE for ${item.resourceType}: ${item.resourceId}")
                // 持久化到数据库
                syncDataApplier.create(item.resourceType, item.resourceId, item.data)
                // 更新本地状态缓存
                localState[item.resourceId] = item
                // 如果本地也有对同一资源的待同步变更且时间戳更旧，则丢弃本地变更
                pendingChanges[item.resourceId]?.let { pending ->
                    if (pending.timestamp <= item.timestamp) {
                        pendingChanges.remove(item.resourceId)
                        Timber.d("Discarded stale pending change for: ${item.resourceId}")
                    }
                }
            }
            SyncOperation.UPDATE -> {
                Timber.d("Applying UPDATE for ${item.resourceType}: ${item.resourceId}")
                val existing = localState[item.resourceId]
                if (existing != null) {
                    // 仅在远程版本较新或版本号更高时才更新
                    if (item.version > existing.version || item.timestamp > existing.timestamp) {
                        // 持久化到数据库
                        syncDataApplier.update(item.resourceType, item.resourceId, item.data)
                        localState[item.resourceId] = item
                    } else {
                        Timber.d("Skipping UPDATE - local version is newer: ${item.resourceId}")
                        return
                    }
                } else {
                    // 本地不存在该资源，作为新建处理
                    syncDataApplier.create(item.resourceType, item.resourceId, item.data)
                    localState[item.resourceId] = item
                }
                // 清理过时的待同步变更
                pendingChanges[item.resourceId]?.let { pending ->
                    if (pending.timestamp <= item.timestamp) {
                        pendingChanges.remove(item.resourceId)
                        Timber.d("Discarded stale pending change for: ${item.resourceId}")
                    }
                }
            }
            SyncOperation.DELETE -> {
                Timber.d("Applying DELETE for ${item.resourceType}: ${item.resourceId}")
                // 从数据库删除
                syncDataApplier.delete(item.resourceType, item.resourceId)
                localState.remove(item.resourceId)
                // 如果本地也有对该资源的待同步变更，删除优先
                pendingChanges.remove(item.resourceId)
            }
        }

        Timber.i("Sync item applied: ${item.operation} ${item.resourceType} ${item.resourceId} (v${item.version})")
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

    // ============================================================
    // JSON-RPC handlers (Phase 3d M3 step D)
    //
    // 这三个方法是 desktop ↔ Android 走 MobileBridge JSON-RPC envelope 的
    // 入向接口，对应桌面 src/main/sync/mobile-bridge-sync.js 的
    // handlePush / handlePull / handleAck。Phase 3d v1 envelope 由 desktop
    // routeMobileCommand("sync", action) → app.mobileBridgeSync.handleX 路由。
    // Android 端需在 chainlesschain:command:request dispatcher 把
    // method=sync.* 路由到这里（接线 = step D.5，因 Android command-request
    // dispatcher pattern 待我下次补查时识别）。
    //
    // 与既有 handleSyncMessage(P2PMessage) 共存：v1 binary 路径用于
    // Android ↔ Android（KNOWLEDGE_SYNC / CONVERSATION_SYNC 二进制 envelope），
    // JSON-RPC 路径用于 Android ↔ desktop。两者复用同一份 detectConflict
    // + applySyncItem + localState 缓存，不会撕裂状态。
    // ============================================================

    /**
     * 处理 sync.push — 应用对端推过来的 SyncItem。复用 handleSyncMessage 内
     * 的 conflict-resolve + apply 逻辑，但 envelope 已 JSON-RPC 解过，直接
     * 拿 SyncItem。
     *
     * 与 desktop mobile-bridge-sync.js handlePush 行为对齐：
     *   - 无冲突 → applySyncItem，返 status="applied"
     *   - 冲突 → 不 apply（与 handleSyncMessage 一致），返 status="conflict"
     *     带 resolvedItem，让对端拿到本地胜出版反向 apply
     */
    suspend fun handlePushRpc(
        item: SyncItem,
        @Suppress("UNUSED_PARAMETER") deviceId: String? = null
    ): SyncPushResponse {
        return try {
            val conflict = detectConflict(item)
            if (conflict != null) {
                val resolution = conflictResolver.resolve(conflict)
                Timber.d(
                    "sync.push conflict ${item.resourceId} → strategy=${resolution.strategy}"
                )
                SyncPushResponse(
                    status = "conflict",
                    resolved = resolution.resolvedItem
                )
            } else {
                applySyncItem(item)
                Timber.d("sync.push applied ${item.resourceId}")
                SyncPushResponse(status = "applied")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Timber.e(e, "sync.push failed for ${item.resourceId}")
            SyncPushResponse(
                status = "failed",
                error = e.message ?: e.javaClass.simpleName
            )
        }
    }

    /**
     * 处理 sync.pull — 对端要求拉取本地 cursor 之后的变更。
     *
     * **v1 限制**：Android side 不枚举 Repository 历史数据；pendingChanges
     * map 是 in-memory 待推队列，不是历史索引。当前 desktop 靠 Android
     * push-on-write（recordChange）拿到所有变更，离线期间错过的变更**v1
     * 不可恢复**。v1.1 补 walker queries 走 FriendDao / PostDao /
     * NotificationDao / P2PMessageDao 的 updatedAt 索引枚举。
     *
     * v1 实现：返回 pendingChanges 里 timestamp > cursor.ts 的子集，给
     * "Android 还没 push 出去的最近变更" 留一条 catch-up 路径（不完整但好
     * 过 0）。注意：返回后 pendingChanges 不会自动清空——desktop 收到
     * sync.pull 结果后应该 ack（v1 不实现 ack tracking），所以这些 item
     * 后续仍可能被 sync.push 推一次（重复但 LWW 幂等）。
     */
    fun handlePullRpc(
        cursor: PullCursor,
        resourceTypes: List<ResourceType>?,
        limit: Int
    ): SyncPullResponse {
        val safeLimit = limit.coerceIn(1, 500)
        val typeFilter = resourceTypes?.toSet()
        val pending = pendingChanges.values
            .asSequence()
            .filter {
                it.timestamp > cursor.ts ||
                    (it.timestamp == cursor.ts &&
                        cursor.id != null &&
                        it.resourceId > cursor.id)
            }
            .filter { typeFilter == null || typeFilter.contains(it.resourceType) }
            .sortedWith(compareBy({ it.timestamp }, { it.resourceId }))
            .take(safeLimit)
            .toList()
        val nextCursor = pending.lastOrNull()?.let {
            PullCursor(ts = it.timestamp, id = it.resourceId)
        } ?: cursor
        return SyncPullResponse(
            items = pending,
            nextCursor = nextCursor,
            hasMore = pending.size >= safeLimit
        )
    }

    /**
     * 处理 sync.ack — fire-and-forget telemetry。v1 仅 log；后续可累积到
     * SyncStatistics 或 outbound pending tracker（当前 Android 不维护
     * outbound pendingAcks，因为 binary path 走 MessageQueue 自己的 ACK 链）。
     */
    fun handleAckRpc(requestId: String?, status: String?, error: String? = null) {
        val tail = if (error != null) " error=$error" else ""
        Timber.d("sync.ack received: requestId=$requestId status=$status$tail")
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
    SETTING,
    // 社交功能资源类型
    FRIEND,
    FRIEND_GROUP,
    POST,
    POST_COMMENT,
    POST_LIKE,
    POST_SHARE,
    NOTIFICATION
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

// ============================================================
// JSON-RPC envelope data classes (Phase 3d M3 step D)
//
// 与 desktop src/main/sync/mobile-bridge-sync.js 对齐，JSON-RPC over
// MobileBridge 的 sync.* method 入参/出参形状。@Serializable 让
// kotlinx.serialization 直接编解码 JSON。
// ============================================================

/**
 * sync.pull / sync.pull response 的 cursor。(ts, id) lex 序，与 desktop
 * walker 的 ORDER BY timestamp ASC, id ASC 对应。
 */
@Serializable
data class PullCursor(
    val ts: Long = 0,
    val id: String? = null
)

/**
 * sync.push response —— "applied" / "conflict" / "failed"。
 *  - applied：本地已应用，对端不需要反向 apply
 *  - conflict：本地版本胜，resolved 含 winning 版（对端拿去 apply）
 *  - failed：异常，error 描述
 */
@Serializable
data class SyncPushResponse(
    val status: String,
    val resolved: SyncItem? = null,
    val error: String? = null
)

/**
 * sync.pull response —— 含 items + 下一轮 cursor。
 */
@Serializable
data class SyncPullResponse(
    val items: List<SyncItem>,
    val nextCursor: PullCursor,
    val hasMore: Boolean
)
