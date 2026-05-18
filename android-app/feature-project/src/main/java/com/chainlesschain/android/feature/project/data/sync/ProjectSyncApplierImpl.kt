package com.chainlesschain.android.feature.project.data.sync

import com.chainlesschain.android.core.database.dao.ProjectDao
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectStatus
import com.chainlesschain.android.core.database.entity.ProjectType
import com.chainlesschain.android.core.p2p.sync.ProjectSyncApplier
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * ProjectSyncApplier 实现 — Android v1.3 (2026-05-17)。
 *
 * 直接走 ProjectDao（绕开 ProjectRepository.createProject 那条 UUID 生成的快路径），
 * 要保留对端 id + 对端 createdAt/updatedAt。
 *
 * 字段策略：JSON 解析手动 + 字段级 merge，**保留 Android 独有列**（isFavorite /
 * isArchived / gitEnabled / git* / lastAccessedAt / accessCount / completedAt / icon
 * / coverImage）— 用户在手机端的状态不会被 desktop sync 覆写。
 *
 * 桌面 schema → Android schema 字段映射：
 *   id, name, description           → 直通
 *   project_type → type             → 走 normalizeType（共同子集 5 个，其余 OTHER）
 *   status       → status           → 桌面 draft→ACTIVE，其余直通
 *   root_path    → rootPath
 *   user_id      → userId
 *   file_count   → fileCount
 *   total_size   → totalSize
 *   tags         → tags             (JSON 字符串直通)
 *   metadata     → metadata         (JSON 字符串直通)
 *   created_at   → createdAt
 *   updated_at   → updatedAt
 *   source_peer_id → sourcePeerId   (v1.3: Android 项目管理 → 远程终端入口)
 *   pc_root_path   → pcRootPath     (v1.3: 同上；fallback to root_path)
 *
 * 删除策略 (v1.3 改)：
 *   - LOCAL 项目（无 sourcePeerId）→ softDelete (status='deleted')，与本地 deleteProject(hard=false) 一致
 *   - FROM_PC 项目（有 sourcePeerId）→ **不联级删**，标 metadata.orphan=true + orphanedAt
 *     ProjectDetailScreenV2 检测 orphan tag 显 banner，用户决定是否归档或彻底删
 *     详见 docs/design/Android_Project_Remote_Terminal_Entry.md trap 7.13
 */
@Singleton
class ProjectSyncApplierImpl @Inject constructor(
    private val projectDao: ProjectDao,
) : ProjectSyncApplier {

    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun saveFromSync(resourceId: String, data: String) {
        try {
            val obj = parseJsonObject(data) ?: run {
                Timber.w("[ProjectSyncApplier] saveFromSync $resourceId: bad JSON")
                return
            }
            val existing = projectDao.getProjectById(resourceId)
            val entity = buildEntity(resourceId, obj, existing)
            projectDao.insertProject(entity)
            Timber.d("[ProjectSyncApplier] saved $resourceId (from sync)")
        } catch (e: Exception) {
            Timber.e(e, "[ProjectSyncApplier] saveFromSync $resourceId failed")
        }
    }

    override suspend fun updateFromSync(resourceId: String, data: String) {
        try {
            val obj = parseJsonObject(data) ?: run {
                Timber.w("[ProjectSyncApplier] updateFromSync $resourceId: bad JSON")
                return
            }
            val existing = projectDao.getProjectById(resourceId)
            val entity = buildEntity(resourceId, obj, existing)
            projectDao.insertProject(entity)  // REPLACE on conflict
            Timber.d("[ProjectSyncApplier] updated $resourceId (from sync)")
        } catch (e: Exception) {
            Timber.e(e, "[ProjectSyncApplier] updateFromSync $resourceId failed")
        }
    }

    override suspend fun deleteFromSync(resourceId: String) {
        try {
            val existing = projectDao.getProjectById(resourceId)
            if (existing != null && existing.sourcePeerId != null) {
                // v1.3 FROM_PC 项目：不联级删，标 orphan tag + 保留本地（用户决定后续处理）
                val orphanedMetadata = mergeOrphanIntoMetadata(existing.metadata)
                projectDao.insertProject(
                    existing.copy(
                        metadata = orphanedMetadata,
                        updatedAt = System.currentTimeMillis(),
                    ),
                )
                Timber.i(
                    "[ProjectSyncApplier] orphan-tagged $resourceId (FROM_PC project; PC side deleted)",
                )
            } else {
                projectDao.softDeleteProject(resourceId)
                Timber.d("[ProjectSyncApplier] soft-deleted $resourceId (from sync)")
            }
        } catch (e: Exception) {
            Timber.e(e, "[ProjectSyncApplier] deleteFromSync $resourceId failed")
        }
    }

    /**
     * 把 orphan=true + orphanedAt=<now> 合并进 metadata JSON。
     *
     * existing 可能：(a) null → 新建 `{"orphan":true,"orphanedAt":...}` (b) 已是 JSON object
     * → 覆盖加这两 key (c) bad JSON → 用 (a) 兜底。
     */
    internal fun mergeOrphanIntoMetadata(existing: String?): String {
        val now = System.currentTimeMillis()
        val orphanFields = mapOf(
            "orphan" to kotlinx.serialization.json.JsonPrimitive(true),
            "orphanedAt" to kotlinx.serialization.json.JsonPrimitive(now),
        )
        val baseMap: Map<String, kotlinx.serialization.json.JsonElement> = if (existing == null) {
            emptyMap()
        } else {
            try {
                json.parseToJsonElement(existing).jsonObject.toMap()
            } catch (_: Exception) {
                emptyMap()
            }
        }
        return kotlinx.serialization.json.JsonObject(baseMap + orphanFields).toString()
    }

    private fun parseJsonObject(data: String): JsonObject? =
        try {
            json.parseToJsonElement(data).jsonObject
        } catch (_: Exception) {
            null
        }

    /**
     * 字段级 merge：对端字段覆写，本地独有列保留。
     * - existing != null：merge
     * - existing == null：新建，用对端字段，本地独有列走 ProjectEntity 默认值
     *
     * userId fallback 优先级：obj.user_id → existing.userId → ""，因为
     * ProjectEntity.userId 是 NOT NULL；缺失时只能用空串，触发后续过滤。
     */
    private fun buildEntity(
        id: String,
        obj: JsonObject,
        existing: ProjectEntity?,
    ): ProjectEntity {
        val name = obj.stringOrDefault("name", existing?.name ?: "")
        val description = obj.stringOrNull("description") ?: existing?.description
        val type = normalizeType(obj.stringOrNull("project_type") ?: obj.stringOrNull("type"))
        val status = normalizeStatus(obj.stringOrNull("status") ?: existing?.status)
        val userId = obj.stringOrNull("user_id")
            ?: obj.stringOrNull("userId")
            ?: existing?.userId
            ?: ""
        val rootPath = obj.stringOrNull("root_path") ?: obj.stringOrNull("rootPath") ?: existing?.rootPath
        // v1.3 Android 项目管理 → 远程终端入口字段
        val sourcePeerId = obj.stringOrNull("source_peer_id")
            ?: obj.stringOrNull("sourcePeerId")
            ?: existing?.sourcePeerId
        // pc_root_path 兜底链：显式 pc_root_path → 顶层 root_path（桌面端 walker
        // 兼容兜底）→ existing。在 Android 端 rootPath 通常存 SAF URI，pcRootPath
        // 才是 PC 路径，所以**不**复用 rootPath 当兜底。
        val pcRootPath = obj.stringOrNull("pc_root_path")
            ?: obj.stringOrNull("pcRootPath")
            ?: existing?.pcRootPath
        val tags = obj.stringOrNull("tags") ?: existing?.tags
        val metadata = obj.stringOrNull("metadata") ?: existing?.metadata
        val fileCount = obj.intOrDefault("file_count", existing?.fileCount ?: 0)
        val totalSize = obj.longOrDefault("total_size", existing?.totalSize ?: 0L)
        val createdAt = obj.longOrDefault("created_at", existing?.createdAt ?: System.currentTimeMillis())
        val updatedAt = obj.longOrDefault("updated_at", existing?.updatedAt ?: System.currentTimeMillis())

        return ProjectEntity(
            id = id,
            name = name,
            description = description,
            type = type,
            status = status,
            userId = userId,
            rootPath = rootPath,
            pcRootPath = pcRootPath,                // v1.3
            sourcePeerId = sourcePeerId,            // v1.3
            icon = existing?.icon,                  // 本地独有：保留
            coverImage = existing?.coverImage,
            tags = tags,
            metadata = metadata,
            isFavorite = existing?.isFavorite ?: false,
            isArchived = existing?.isArchived ?: (status == ProjectStatus.ARCHIVED),
            isSynced = true,
            remoteId = existing?.remoteId,
            lastSyncedAt = System.currentTimeMillis(),
            fileCount = fileCount,
            totalSize = totalSize,
            lastAccessedAt = existing?.lastAccessedAt,
            accessCount = existing?.accessCount ?: 0,
            gitEnabled = existing?.gitEnabled ?: false,
            gitRemoteUrl = existing?.gitRemoteUrl,
            gitBranch = existing?.gitBranch,
            lastCommitHash = existing?.lastCommitHash,
            uncommittedChanges = existing?.uncommittedChanges ?: 0,
            createdAt = createdAt,
            updatedAt = updatedAt,
            completedAt = existing?.completedAt,
        )
    }

    /**
     * 桌面 project_type 值集 ≠ Android。共同子集直通，其余映射 OTHER。
     * 显式映射防止落库时（Room 没有 CHECK）后续查询按 type filter 时漏掉。
     */
    private fun normalizeType(raw: String?): String {
        val lower = raw?.lowercase() ?: return ProjectType.OTHER
        return when (lower) {
            "web" -> ProjectType.WEB
            "document" -> ProjectType.DOCUMENT
            "data" -> ProjectType.DATA
            "app" -> ProjectType.APP
            "design" -> ProjectType.DESIGN
            // Android 端独有但同名也接（同手机 deeplink 场景）
            "android", "backend", "data_science", "multiplatform", "flutter", "research" -> lower
            // 桌面独有：presentation / spreadsheet / code / workflow / knowledge → OTHER
            else -> ProjectType.OTHER
        }
    }

    /**
     * 桌面 status (draft/active/completed/archived) → Android (active/paused/completed/archived/deleted)。
     * draft → ACTIVE（Android 没 draft 概念），其余直通。
     */
    private fun normalizeStatus(raw: String?): String {
        val lower = raw?.lowercase() ?: return ProjectStatus.ACTIVE
        return when (lower) {
            "draft" -> ProjectStatus.ACTIVE
            in ProjectStatus.ALL_STATUS -> lower
            ProjectStatus.DELETED -> lower
            else -> ProjectStatus.ACTIVE
        }
    }

    private fun JsonObject.stringOrNull(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull

    private fun JsonObject.stringOrDefault(key: String, default: String): String =
        stringOrNull(key) ?: default

    private fun JsonObject.longOrDefault(key: String, default: Long): Long =
        this[key]?.jsonPrimitive?.longOrNull ?: default

    private fun JsonObject.intOrDefault(key: String, default: Int): Int =
        this[key]?.jsonPrimitive?.longOrNull?.toInt() ?: default
}
