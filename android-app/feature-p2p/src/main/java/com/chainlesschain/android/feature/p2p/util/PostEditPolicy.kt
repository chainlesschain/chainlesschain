package com.chainlesschain.android.feature.p2p.util

import com.chainlesschain.android.core.database.entity.social.PostEntity

/**
 * 动态编辑策略
 *
 * 定义动态编辑的权限规则：
 * - 只有作者可以编辑
 * - 24小时内可以编辑
 * - 已有互动时显示警告
 *
 * @since v0.31.0
 */
object PostEditPolicy {

    /** 编辑时间窗口（小时） */
    const val EDIT_WINDOW_HOURS = 24

    /**
     * 检查是否可以编辑动态
     *
     * @param post 动态实体
     * @param currentUserDid 当前用户DID
     * @return 编辑权限结果
     */
    fun canEdit(post: PostEntity, currentUserDid: String): EditPermission {
        // 1. 检查是否是作者
        if (post.authorDid != currentUserDid) {
            return EditPermission.Denied("只有作者可以编辑")
        }

        // 2. 检查时间窗口（24小时）
        val now = System.currentTimeMillis()
        val createdAt = post.createdAt
        val elapsed = now - createdAt
        val maxDuration = EDIT_WINDOW_HOURS * 60 * 60 * 1000L

        if (elapsed > maxDuration) {
            val hoursAgo = elapsed / (60 * 60 * 1000)
            return EditPermission.Denied("超过${EDIT_WINDOW_HOURS}小时无法编辑（已发布${hoursAgo}小时）")
        }

        // 3. 计算剩余时间
        val remainingTime = maxDuration - elapsed

        return EditPermission.Allowed(
            remainingTime = remainingTime,
            remainingHours = remainingTime / (60 * 60 * 1000),
            remainingMinutes = (remainingTime % (60 * 60 * 1000)) / (60 * 1000)
        )
    }

    /**
     * 检查编辑前是否需要警告
     *
     * @param post 动态实体
     * @return 警告信息，null表示无需警告
     */
    fun shouldWarnBeforeEdit(post: PostEntity): EditWarning? {
        // 检查是否已有互动（点赞或评论）
        val hasInteractions = post.likeCount > 0 || post.commentCount > 0

        if (hasInteractions) {
            return EditWarning.HasInteractions(
                likeCount = post.likeCount,
                commentCount = post.commentCount,
                message = buildString {
                    append("该动态已有")
                    if (post.likeCount > 0) {
                        append(" ${post.likeCount} 个赞")
                    }
                    if (post.commentCount > 0) {
                        if (post.likeCount > 0) append("和")
                        append(" ${post.commentCount} 条评论")
                    }
                    append("，编辑后可能影响他人的阅读体验")
                }
            )
        }

        return null
    }

    /**
     * 格式化剩余时间
     *
     * @param remainingTimeMillis 剩余毫秒数
     * @return 格式化字符串（例如："23小时45分钟"）
     */
    fun formatRemainingTime(remainingTimeMillis: Long): String {
        val hours = remainingTimeMillis / (60 * 60 * 1000)
        val minutes = (remainingTimeMillis % (60 * 60 * 1000)) / (60 * 1000)

        return buildString {
            if (hours > 0) {
                append("${hours}小时")
            }
            if (minutes > 0) {
                append("${minutes}分钟")
            }
            if (hours == 0L && minutes == 0L) {
                append("不到1分钟")
            }
        }
    }

    /**
     * 检查是否已被编辑过
     *
     * @param post 动态实体
     * @return true=已编辑，false=未编辑
     */
    fun isEdited(post: PostEntity): Boolean {
        val updated = post.updatedAt
        return updated != null && updated > post.createdAt
    }

    /**
     * 计算编辑次数限制
     * （当前无限制，可扩展）
     *
     * @param post 动态实体
     * @return 是否还可以编辑
     */
    fun canEditMore(post: PostEntity): Boolean {
        // 当前无编辑次数限制
        // 可扩展：例如限制最多编辑3次
        return true
    }
}

/**
 * 编辑权限结果
 */
sealed class EditPermission {
    /**
     * 允许编辑
     *
     * @param remainingTime 剩余可编辑时间（毫秒）
     * @param remainingHours 剩余小时数
     * @param remainingMinutes 剩余分钟数
     */
    data class Allowed(
        val remainingTime: Long,
        val remainingHours: Long,
        val remainingMinutes: Long
    ) : EditPermission()

    /**
     * 拒绝编辑
     *
     * @param reason 拒绝原因
     */
    data class Denied(val reason: String) : EditPermission()
}

/**
 * 编辑警告
 */
sealed class EditWarning {
    /**
     * 已有互动警告
     *
     * @param likeCount 点赞数
     * @param commentCount 评论数
     * @param message 警告消息
     */
    data class HasInteractions(
        val likeCount: Int,
        val commentCount: Int,
        val message: String
    ) : EditWarning()
}
