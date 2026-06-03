package com.chainlesschain.android.feature.p2p.sync

import com.chainlesschain.android.core.database.dao.P2PMessageDao
import com.chainlesschain.android.core.database.dao.social.FriendDao
import com.chainlesschain.android.core.database.dao.social.NotificationDao
import com.chainlesschain.android.core.database.dao.social.PostDao
import com.chainlesschain.android.core.database.entity.P2PMessageEntity
import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.NotificationEntity
import com.chainlesschain.android.core.database.entity.social.PostEntity
import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.core.p2p.sync.SyncRepositoryWalker
import com.chainlesschain.android.feature.p2p.repository.social.toSyncData
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * SyncRepositoryWalker 实现 — 4 张表的 cursor 增量枚举（Phase 3d v1.1）。
 *
 * 服务 SyncManager.handlePullRpc 的真数据查询。Desktop 发 sync.pull 后，
 * SyncManager 调 walker.enumerate(cursor, types, limit) 拿到 SyncItem 列表
 * 回包给 desktop。
 *
 * 设计：
 *   - 4 张表（friends / posts / notifications / p2p_messages）按 (timestamp, id)
 *     lex 序各跑一轮 cursor query
 *   - 把所有 walker 结果合并按 timestamp ASC 排序，截到 limit
 *   - resourceTypes filter 在 walker 入口短路，不查无关 DAO
 *   - SyncItem.data 复用 SocialSyncAdapter.toSyncData() 扩展函数（friends/
 *     posts/notifications）+ P2PMessageEntity 直接序列化（与 saveMessageFromSync
 *     反序列化对称）
 *
 * Cursor 字段映射（与 DAO 内的 ORDER BY 一致）：
 *   FRIEND       : addedAt + did
 *   POST         : updatedAt + id
 *   NOTIFICATION : createdAt + id
 *   MESSAGE      : timestamp + id
 *
 * 已知限制（v1.1，可 v1.2 优化）：
 *   - friends 走 addedAt 不是 updatedAt，addFriend 后的 update 不会被 walker
 *     重抓（real-time 走 SocialSyncAdapter.recordChange 路径）
 *   - posts 的 likeCount / commentCount 累加不会重新发（counts 不在 sync data 内）
 *   - 4 张表合并时 limit 是"全局"的，可能某类型撑满 limit 把其他类型 starve；
 *     v1.2 可改成 round-robin 平均分配
 */
@Singleton
class SocialSyncWalker @Inject constructor(
    private val friendDao: FriendDao,
    private val postDao: PostDao,
    private val notificationDao: NotificationDao,
    private val p2pMessageDao: P2PMessageDao
) : SyncRepositoryWalker {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    override suspend fun enumerate(
        cursor: PullCursor,
        resourceTypes: List<ResourceType>?,
        limit: Int
    ): List<SyncItem> {
        val safeLimit = limit.coerceIn(1, 500)
        val typeFilter = resourceTypes?.toSet()
        val results = mutableListOf<SyncItem>()
        val sinceMs = cursor.ts
        val sinceId = cursor.id ?: ""

        try {
            if (typeFilter == null || typeFilter.contains(ResourceType.FRIEND)) {
                results += friendDao
                    .getFriendsSinceCursor(sinceMs, sinceId, safeLimit)
                    .map { it.toFriendSyncItem() }
            }
            if (typeFilter == null || typeFilter.contains(ResourceType.POST)) {
                results += postDao
                    .getPostsSinceCursor(sinceMs, sinceId, safeLimit)
                    .map { it.toPostSyncItem() }
            }
            if (typeFilter == null || typeFilter.contains(ResourceType.NOTIFICATION)) {
                results += notificationDao
                    .getNotificationsSinceCursor(sinceMs, sinceId, safeLimit)
                    .map { it.toNotificationSyncItem() }
            }
            if (typeFilter == null || typeFilter.contains(ResourceType.MESSAGE)) {
                results += p2pMessageDao
                    .getMessagesSinceCursor(sinceMs, sinceId, safeLimit)
                    .map { it.toMessageSyncItem() }
            }
        } catch (e: Exception) {
            Timber.e(e, "SocialSyncWalker.enumerate 异常 cursor=(${cursor.ts}, ${cursor.id})")
            // 部分失败不阻塞 — 返回到目前为止收集的 items
        }

        // 按 timestamp 全局排序，截 limit
        return results
            .sortedWith(compareBy({ it.timestamp }, { it.resourceId }))
            .take(safeLimit)
    }

    // ===== Entity → SyncItem converters =====
    // 与 SocialSyncAdapter.syncXxxAdded 出向 emit 的形状对齐，保证 desktop
    // 端 _applyXxx 反序列化时无字段差异。

    private fun FriendEntity.toFriendSyncItem(): SyncItem = SyncItem(
        resourceId = did,
        resourceType = ResourceType.FRIEND,
        operation = SyncOperation.UPDATE,
        data = json.encodeToString(toSyncData()),
        timestamp = addedAt,
        version = 1
    )

    private fun PostEntity.toPostSyncItem(): SyncItem = SyncItem(
        resourceId = id,
        resourceType = ResourceType.POST,
        operation = SyncOperation.UPDATE,
        data = json.encodeToString(toSyncData()),
        timestamp = updatedAt ?: createdAt,
        version = 1
    )

    private fun NotificationEntity.toNotificationSyncItem(): SyncItem = SyncItem(
        resourceId = id,
        resourceType = ResourceType.NOTIFICATION,
        operation = SyncOperation.CREATE,
        data = json.encodeToString(toSyncData()),
        timestamp = createdAt,
        version = 1
    )

    /**
     * MESSAGE — 直接序列化 P2PMessageEntity（与 P2PMessageRepository.
     * saveMessageFromSync 反序列化对称，参见 M3 step B 的设计）。不通过中间
     * SyncData 类。
     */
    private fun P2PMessageEntity.toMessageSyncItem(): SyncItem = SyncItem(
        resourceId = id,
        resourceType = ResourceType.MESSAGE,
        operation = SyncOperation.CREATE,
        data = json.encodeToString(this),
        timestamp = timestamp,
        version = 1
    )
}
