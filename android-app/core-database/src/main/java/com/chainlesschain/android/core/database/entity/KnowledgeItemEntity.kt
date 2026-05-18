package com.chainlesschain.android.core.database.entity

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * 知识库条目实体
 *
 * 对应PC端的knowledge_items表
 */
@Entity(
    tableName = "knowledge_items",
    indices = [
        Index(value = ["title"]),
        Index(value = ["type"]),
        Index(value = ["folderId"]),
        Index(value = ["createdAt"]),
        Index(value = ["updatedAt"]),
        Index(value = ["syncStatus"])
    ]
)
data class KnowledgeItemEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),

    /** 标题 */
    val title: String,

    /** Markdown内容 */
    val content: String,

    /** 类型：note, document, conversation, web_clip */
    val type: String = "note",

    /** 所属文件夹ID */
    val folderId: String? = null,

    /** 创建时间戳 */
    val createdAt: Long = System.currentTimeMillis(),

    /** 更新时间戳 */
    val updatedAt: Long = System.currentTimeMillis(),

    /** 同步状态：pending, synced, conflict */
    val syncStatus: String = "pending",

    /** 设备ID */
    val deviceId: String,

    /** 软删除标记 */
    val isDeleted: Boolean = false,

    /** 标签（JSON数组） */
    val tags: String? = null,

    /** 是否收藏 */
    val isFavorite: Boolean = false,

    /** 是否置顶 */
    val isPinned: Boolean = false
)
