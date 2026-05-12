package com.chainlesschain.android.feature.knowledge.data.sync

import com.chainlesschain.android.core.database.dao.KnowledgeItemDao
import com.chainlesschain.android.core.database.entity.KnowledgeItemEntity
import com.chainlesschain.android.core.p2p.sync.KnowledgeSyncApplier
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.longOrNull
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * KnowledgeSyncApplier 实现 — Android v1.1 W1 (2026-05-12)。
 *
 * 直接走 KnowledgeItemDao（不经 KnowledgeRepository.createItem 那条手动 UUID
 * 生成的快路径，要保留对端 id + 对端 createdAt/updatedAt）。
 *
 * 字段策略：JSON 解析手动 + 字段级 merge，**保留 Android 独有列**（folderId /
 * tags / isFavorite / isPinned）— 用户在手机端标星 / 归类的状态不会被 desktop
 * sync 覆写。与 desktop `mobile-bridge-sync.js::_applyKnowledgeItem` 的 UPSERT
 * 保留本地列模式对称。
 *
 * 删除策略：走 softDelete (`isDeleted=1`) 不硬删，与本地 deleteItem 路径一致，
 * 保留撤销窗口。
 */
@Singleton
class KnowledgeSyncApplierImpl @Inject constructor(
    private val knowledgeItemDao: KnowledgeItemDao,
) : KnowledgeSyncApplier {

    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun saveFromSync(resourceId: String, data: String) {
        try {
            val obj = parseJsonObject(data) ?: run {
                Timber.w("[KnowledgeSyncApplier] saveFromSync $resourceId: bad JSON")
                return
            }
            val existing = knowledgeItemDao.getItemByIdSync(resourceId)
            val entity = buildEntity(resourceId, obj, existing)
            knowledgeItemDao.insert(entity)
            Timber.d("[KnowledgeSyncApplier] saved $resourceId (from sync)")
        } catch (e: Exception) {
            Timber.e(e, "[KnowledgeSyncApplier] saveFromSync $resourceId failed")
        }
    }

    override suspend fun updateFromSync(resourceId: String, data: String) {
        try {
            val obj = parseJsonObject(data) ?: run {
                Timber.w("[KnowledgeSyncApplier] updateFromSync $resourceId: bad JSON")
                return
            }
            val existing = knowledgeItemDao.getItemByIdSync(resourceId)
            val entity = buildEntity(resourceId, obj, existing)
            knowledgeItemDao.insert(entity)
            Timber.d("[KnowledgeSyncApplier] updated $resourceId (from sync)")
        } catch (e: Exception) {
            Timber.e(e, "[KnowledgeSyncApplier] updateFromSync $resourceId failed")
        }
    }

    override suspend fun deleteFromSync(resourceId: String) {
        try {
            knowledgeItemDao.softDelete(resourceId)
            Timber.d("[KnowledgeSyncApplier] soft-deleted $resourceId (from sync)")
        } catch (e: Exception) {
            Timber.e(e, "[KnowledgeSyncApplier] deleteFromSync $resourceId failed")
        }
    }

    private fun parseJsonObject(data: String): JsonObject? =
        try {
            json.parseToJsonElement(data).jsonObject
        } catch (_: Exception) {
            null
        }

    /**
     * 字段级 merge：对端字段（title/content/type/createdAt/updatedAt/deviceId）覆写，
     * 本地独有字段（folderId/tags/isFavorite/isPinned/isDeleted）从 existing 保留；
     * existing 为 null 时用 KnowledgeItemEntity 默认值。
     *
     * type 桌面端已用 _normalizeKnowledgeType 兜底，这里再保险一次（防绕过 desktop
     * 验证的直连场景）。
     */
    private fun buildEntity(
        id: String,
        obj: JsonObject,
        existing: KnowledgeItemEntity?,
    ): KnowledgeItemEntity {
        val title = obj.stringOrDefault("title", existing?.title ?: "")
        val content = obj.stringOrDefault("content", existing?.content ?: "")
        val type = normalizeType(obj.stringOrNull("type") ?: existing?.type)
        val createdAt = obj.longOrDefault("createdAt", existing?.createdAt ?: System.currentTimeMillis())
        val updatedAt = obj.longOrDefault("updatedAt", existing?.updatedAt ?: System.currentTimeMillis())
        val deviceId = obj.stringOrNull("deviceId") ?: existing?.deviceId ?: ""

        return KnowledgeItemEntity(
            id = id,
            title = title,
            content = content,
            type = type,
            folderId = existing?.folderId, // 本地独有列保留
            createdAt = createdAt,
            updatedAt = updatedAt,
            syncStatus = "synced",
            deviceId = deviceId,
            isDeleted = existing?.isDeleted ?: false,
            tags = existing?.tags,
            isFavorite = existing?.isFavorite ?: false,
            isPinned = existing?.isPinned ?: false,
        )
    }

    private fun normalizeType(raw: String?): String {
        val lower = raw?.lowercase() ?: "note"
        return if (lower in VALID_TYPES) lower else "note"
    }

    private fun JsonObject.stringOrNull(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull

    private fun JsonObject.stringOrDefault(key: String, default: String): String =
        stringOrNull(key) ?: default

    private fun JsonObject.longOrDefault(key: String, default: Long): Long =
        this[key]?.jsonPrimitive?.longOrNull ?: default

    companion object {
        private val VALID_TYPES = setOf("note", "document", "conversation", "web_clip")
    }
}
