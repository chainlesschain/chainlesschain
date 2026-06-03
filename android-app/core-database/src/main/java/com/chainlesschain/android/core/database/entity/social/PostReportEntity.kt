package com.chainlesschain.android.core.database.entity.social

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 动态举报实体
 *
 * 记录用户对动态的举报
 */
@Entity(
    tableName = "post_reports",
    indices = [
        Index(value = ["postId"]),
        Index(value = ["reporterDid"]),
        Index(value = ["createdAt"])
    ]
)
data class PostReportEntity(
    @PrimaryKey
    val id: String,

    /** 被举报的动态 ID */
    val postId: String,

    /** 举报人 DID */
    val reporterDid: String,

    /** 举报原因 */
    val reason: ReportReason,

    /** 详细描述（可选） */
    val description: String? = null,

    /** 举报时间 */
    val createdAt: Long,

    /** 处理状态 */
    val status: ReportStatus = ReportStatus.PENDING
)

/**
 * 举报原因
 */
enum class ReportReason {
    /** 垃圾信息 */
    SPAM,

    /** 骚扰 */
    HARASSMENT,

    /** 不实信息 */
    MISINFORMATION,

    /** 不当内容 */
    INAPPROPRIATE_CONTENT,

    /** 侵犯版权 */
    COPYRIGHT_VIOLATION,

    /** 其他 */
    OTHER
}

/**
 * 举报处理状态
 */
enum class ReportStatus {
    /** 待处理 */
    PENDING,

    /** 已处理 */
    RESOLVED,

    /** 已忽略 */
    IGNORED
}
