package com.chainlesschain.android.core.database.entity.social

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import androidx.room.TypeConverters
import com.chainlesschain.android.core.database.util.Converters

/**
 * 动态编辑历史记录
 *
 * 用于保存动态的编辑历史，支持查看编辑前的内容
 *
 * @since v0.31.0
 */
@Entity(
    tableName = "post_edit_history",
    indices = [
        Index(value = ["postId"]),
        Index(value = ["editedAt"]),
        Index(value = ["postId", "editedAt"])
    ]
)
@TypeConverters(Converters::class)
data class PostEditHistoryEntity(
    @PrimaryKey
    val id: String,

    /** 动态 ID */
    val postId: String,

    /** 编辑前的文字内容 */
    val previousContent: String,

    /** 编辑前的图片 URLs */
    val previousImages: List<String> = emptyList(),

    /** 编辑前的链接 URL */
    val previousLinkUrl: String? = null,

    /** 编辑前的链接预览 */
    val previousLinkPreview: String? = null,

    /** 编辑前的话题标签 */
    val previousTags: List<String> = emptyList(),

    /** 编辑时间 */
    val editedAt: Long,

    /** 编辑原因（可选） */
    val editReason: String? = null,

    /** 扩展信息（JSON 格式） */
    val metadata: String? = null
)
