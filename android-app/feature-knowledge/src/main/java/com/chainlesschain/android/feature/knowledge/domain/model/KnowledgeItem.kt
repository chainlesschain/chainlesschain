package com.chainlesschain.android.feature.knowledge.domain.model

/**
 * 知识库条目领域模型
 *
 * Clean Architecture的领域层模型，与数据库实体分离
 */
data class KnowledgeItem(
    val id: String,
    val title: String,
    val content: String,
    val type: KnowledgeType = KnowledgeType.NOTE,
    val folderId: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val syncStatus: SyncStatus = SyncStatus.PENDING,
    val deviceId: String,
    val isDeleted: Boolean = false,
    val tags: List<String> = emptyList(),
    val isFavorite: Boolean = false,
    val isPinned: Boolean = false
)

/**
 * 知识库类型枚举
 */
enum class KnowledgeType(val value: String) {
    NOTE("note"),
    DOCUMENT("document"),
    CONVERSATION("conversation"),
    WEB_CLIP("web_clip");

    companion object {
        fun fromValue(value: String): KnowledgeType {
            return entries.find { it.value == value } ?: NOTE
        }
    }
}

/**
 * 同步状态枚举
 */
enum class SyncStatus(val value: String) {
    PENDING("pending"),
    SYNCED("synced"),
    CONFLICT("conflict");

    companion object {
        fun fromValue(value: String): SyncStatus {
            return entries.find { it.value == value } ?: PENDING
        }
    }
}

/**
 * 文件夹模型
 */
data class Folder(
    val id: String,
    val name: String,
    val parentId: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val itemCount: Int = 0
)
