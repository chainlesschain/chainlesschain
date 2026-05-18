package com.chainlesschain.android.core.database.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 审核队列实体
 *
 * 用于存储待人工复审的内容和审核结果
 *
 * 流程：
 * 1. AI审核检测到疑似违规内容
 * 2. 将内容和审核结果添加到审核队列
 * 3. 管理员/审核员人工复审
 * 4. 确认处理后移除或标记为已处理
 */
@Entity(
    tableName = "moderation_queue",
    indices = [
        Index(value = ["status"]),
        Index(value = ["created_at"]),
        Index(value = ["content_type"]),
        Index(value = ["author_did"])
    ]
)
data class ModerationQueueEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0,

    /** 内容类型（POST/COMMENT/MESSAGE） */
    @ColumnInfo(name = "content_type")
    val contentType: ContentType,

    /** 关联的内容ID（如帖子ID、评论ID） */
    @ColumnInfo(name = "content_id")
    val contentId: String,

    /** 待审核的内容文本 */
    @ColumnInfo(name = "content_text")
    val contentText: String,

    /** 内容作者DID */
    @ColumnInfo(name = "author_did")
    val authorDid: String,

    /** 作者昵称 */
    @ColumnInfo(name = "author_name")
    val authorName: String?,

    /** 审核状态 */
    @ColumnInfo(name = "status")
    val status: ModerationStatus,

    /** AI审核结果JSON（存储ModerationResult序列化） */
    @ColumnInfo(name = "ai_result_json")
    val aiResultJson: String,

    /** 人工审核决定（APPROVE/REJECT/DELETE） */
    @ColumnInfo(name = "human_decision")
    val humanDecision: HumanDecision?,

    /** 人工审核备注 */
    @ColumnInfo(name = "human_note")
    val humanNote: String?,

    /** 审核员DID */
    @ColumnInfo(name = "reviewer_did")
    val reviewerDid: String?,

    /** 申诉状态（是否已申诉） */
    @ColumnInfo(name = "appeal_status")
    val appealStatus: AppealStatus,

    /** 申诉内容 */
    @ColumnInfo(name = "appeal_text")
    val appealText: String?,

    /** 申诉时间（Unix时间戳，毫秒） */
    @ColumnInfo(name = "appeal_at")
    val appealAt: Long?,

    /** 申诉处理结果 */
    @ColumnInfo(name = "appeal_result")
    val appealResult: String?,

    /** 创建时间（Unix时间戳，毫秒） */
    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    /** 处理时间（Unix时间戳，毫秒） */
    @ColumnInfo(name = "reviewed_at")
    val reviewedAt: Long?
) {
    /** 是否待处理 */
    fun isPending(): Boolean = status == ModerationStatus.PENDING

    /** 是否已处理 */
    fun isProcessed(): Boolean = status in listOf(
        ModerationStatus.APPROVED,
        ModerationStatus.REJECTED,
        ModerationStatus.DELETED
    )

    /** 是否有申诉 */
    fun hasAppeal(): Boolean = appealStatus != AppealStatus.NONE

    /** 获取等待时长（小时） */
    fun getWaitingHours(): Long {
        return (System.currentTimeMillis() - createdAt) / (60 * 60 * 1000)
    }
}

/**
 * 内容类型枚举
 */
enum class ContentType {
    /** 社交帖子 */
    POST,

    /** 评论 */
    COMMENT,

    /** 私信 */
    MESSAGE;

    companion object {
        fun fromString(value: String?): ContentType? {
            if (value == null) return null
            return try {
                valueOf(value.uppercase())
            } catch (e: IllegalArgumentException) {
                null
            }
        }
    }
}

/**
 * 审核状态枚举
 */
enum class ModerationStatus {
    /** 待审核 */
    PENDING,

    /** 审核通过（允许发布） */
    APPROVED,

    /** 审核拒绝（禁止发布但保留内容） */
    REJECTED,

    /** 删除（严重违规，删除内容） */
    DELETED,

    /** 申诉中 */
    APPEALING;

    companion object {
        fun fromString(value: String?): ModerationStatus? {
            if (value == null) return null
            return try {
                valueOf(value.uppercase())
            } catch (e: IllegalArgumentException) {
                null
            }
        }
    }
}

/**
 * 人工审核决定枚举
 */
enum class HumanDecision {
    /** 批准发布 */
    APPROVE,

    /** 拒绝发布 */
    REJECT,

    /** 删除内容 */
    DELETE,

    /** 警告用户 */
    WARN;

    companion object {
        fun fromString(value: String?): HumanDecision? {
            if (value == null) return null
            return try {
                valueOf(value.uppercase())
            } catch (e: IllegalArgumentException) {
                null
            }
        }
    }
}

/**
 * 申诉状态枚举
 */
enum class AppealStatus {
    /** 无申诉 */
    NONE,

    /** 申诉待处理 */
    PENDING,

    /** 申诉通过 */
    APPROVED,

    /** 申诉拒绝 */
    REJECTED;

    companion object {
        fun fromString(value: String?): AppealStatus? {
            if (value == null) return null
            return try {
                valueOf(value.uppercase())
            } catch (e: IllegalArgumentException) {
                null
            }
        }
    }
}
