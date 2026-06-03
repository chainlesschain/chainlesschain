package com.chainlesschain.android.feature.project.sync

import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.p2p.sync.PullCursor
import com.chainlesschain.android.core.p2p.sync.ResourceType
import com.chainlesschain.android.core.p2p.sync.SyncItem
import com.chainlesschain.android.core.p2p.sync.SyncOperation
import com.chainlesschain.android.core.p2p.sync.SyncRepositoryWalker
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * ProjectSyncWalker — Android 端 ResourceType.PROJECT 增量枚举 (#21 P2)。
 *
 * 服务 SyncManager.handlePullRpc：desktop sync.pull 时把 Android 端 projects
 * 表 cursor 之后的项目转 SyncItem 推回桌面。补 P2 audit 发现的反向同步缺口
 * （SocialSyncWalker 只覆盖 friends/posts/notifications/messages 4 张表，
 * 不含 projects；同时 ProjectRepository.softDelete 仍依赖此 walker push
 * status='deleted' 信号到对端，因为桌面 walker 过滤 deleted=0 不会拉到对端
 * 的删除回执）。
 *
 * 字段映射对齐 [com.chainlesschain.android.feature.project.data.sync.ProjectSyncApplierImpl]
 * 的反向解析：JSON 字段名用 snake_case (desktop schema 同形)，方便对端
 * direct 用同一 JSON shape。
 *
 * DELETE 语义：Android schema 用 status='deleted' 表示软删（无独立 deleted
 * INT 列，对齐 ProjectStatus.DELETED），walker 不过滤 status，让 deleted
 * 行也 emit；operation 字段标 DELETE 让对端 applier 走 deleteFromSync。
 *
 * Composite pattern：本 walker 与 SocialSyncWalker 一起被 CompositeSyncWalker
 * (in :app) 聚合，让 SyncRepositoryWalker 单一 binding 覆盖跨 feature 的全部
 * 表，避免 feature-p2p 反向依赖 feature-project。
 */
@Singleton
class ProjectSyncWalker @Inject constructor(
    private val projectDao: ProjectDao,
) : SyncRepositoryWalker {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    override suspend fun enumerate(
        cursor: PullCursor,
        resourceTypes: List<ResourceType>?,
        limit: Int,
    ): List<SyncItem> {
        // 类型 filter 短路：未要求 PROJECT 则跳过
        if (resourceTypes != null && !resourceTypes.contains(ResourceType.PROJECT)) {
            return emptyList()
        }
        val safeLimit = limit.coerceIn(1, 500)
        val sinceMs = cursor.ts
        val sinceId = cursor.id ?: ""
        return try {
            projectDao
                .getProjectsSinceCursor(sinceMs, sinceId, safeLimit)
                .map { it.toSyncItem() }
        } catch (e: Exception) {
            Timber.w(e, "[ProjectSyncWalker] enumerate failed; returning empty")
            emptyList()
        }
    }

    /**
     * Map ProjectEntity to SyncItem. Operation:
     *   - status == 'deleted' → DELETE
     *   - updatedAt > createdAt → UPDATE
     *   - else → CREATE
     */
    private fun ProjectEntity.toSyncItem(): SyncItem {
        val op = when {
            status == ProjectStatus.DELETED -> SyncOperation.DELETE
            updatedAt > createdAt -> SyncOperation.UPDATE
            else -> SyncOperation.CREATE
        }
        return SyncItem(
            resourceType = ResourceType.PROJECT,
            resourceId = id,
            operation = op,
            version = 1,
            timestamp = updatedAt,
            data = serialize(this),
        )
    }

    /**
     * Serialize ProjectEntity to JSON object using snake_case keys aligned
     * with desktop walker output (mobile-bridge-sync.js#_fetchProjects).
     * Local-only fields (isFavorite/gitEnabled/etc.) excluded — they don't
     * sync, applier 字段级 merge 保留对端独有列。
     */
    private fun serialize(p: ProjectEntity): String {
        val obj: JsonObject = buildJsonObject {
            put("id", JsonPrimitive(p.id))
            put("user_id", JsonPrimitive(p.userId))
            put("name", JsonPrimitive(p.name))
            p.description?.let { put("description", JsonPrimitive(it)) }
            put("project_type", JsonPrimitive(p.type))
            put("status", JsonPrimitive(p.status))
            p.rootPath?.let { put("root_path", JsonPrimitive(it)) }
            put("file_count", JsonPrimitive(p.fileCount))
            put("total_size", JsonPrimitive(p.totalSize))
            p.tags?.let { put("tags", JsonPrimitive(it)) }
            p.metadata?.let { put("metadata", JsonPrimitive(it)) }
            put("created_at", JsonPrimitive(p.createdAt))
            put("updated_at", JsonPrimitive(p.updatedAt))
        }
        return json.encodeToString(obj)
    }
}
