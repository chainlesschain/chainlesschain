package com.chainlesschain.android.core.e2ee.recall

import kotlinx.serialization.Serializable

/**
 * 消息撤回请求
 *
 * 加密的消息撤回请求
 */
@Serializable
data class MessageRecallRequest(
    /** 要撤回的消息ID */
    val messageId: String,

    /** 撤回原因（可选） */
    val reason: RecallReason,

    /** 撤回时间戳 */
    val timestamp: Long,

    /** 可选：替换文本 */
    val replacementText: String? = null
) {
    companion object {
        /**
         * 创建撤回请求
         */
        fun create(
            messageId: String,
            reason: RecallReason = RecallReason.USER_REQUEST,
            replacementText: String? = null
        ): MessageRecallRequest {
            return MessageRecallRequest(
                messageId = messageId,
                reason = reason,
                timestamp = System.currentTimeMillis(),
                replacementText = replacementText
            )
        }
    }
}

/**
 * 撤回原因
 */
enum class RecallReason {
    /** 用户主动撤回 */
    USER_REQUEST,

    /** 内容违规 */
    CONTENT_VIOLATION,

    /** 发错对象 */
    WRONG_RECIPIENT,

    /** 内容错误 */
    CONTENT_ERROR,

    /** 其他 */
    OTHER
}

/**
 * 消息撤回响应
 */
@Serializable
data class MessageRecallResponse(
    /** 原消息ID */
    val messageId: String,

    /** 是否成功 */
    val success: Boolean,

    /** 响应时间戳 */
    val timestamp: Long,

    /** 失败原因（如果失败） */
    val failureReason: String? = null
) {
    companion object {
        fun success(messageId: String): MessageRecallResponse {
            return MessageRecallResponse(
                messageId = messageId,
                success = true,
                timestamp = System.currentTimeMillis()
            )
        }

        fun failure(messageId: String, reason: String): MessageRecallResponse {
            return MessageRecallResponse(
                messageId = messageId,
                success = false,
                timestamp = System.currentTimeMillis(),
                failureReason = reason
            )
        }
    }
}

/**
 * 消息撤回状态
 */
data class MessageRecallStatus(
    /** 消息ID */
    val messageId: String,

    /** 撤回状态 */
    var status: RecallStatus,

    /** 撤回请求时间 */
    val requestedAt: Long,

    /** 撤回原因 */
    val reason: RecallReason,

    /** 替换文本 */
    val replacementText: String? = null,

    /** 撤回确认时间 */
    var confirmedAt: Long? = null,

    /** 失败原因 */
    var failureReason: String? = null
) {
    /**
     * 是否已撤回
     */
    val isRecalled: Boolean
        get() = status == RecallStatus.RECALLED

    /**
     * 获取显示文本
     */
    fun getDisplayText(): String {
        return when (status) {
            RecallStatus.PENDING -> "撤回中..."
            RecallStatus.RECALLED -> replacementText ?: "消息已撤回"
            RecallStatus.FAILED -> "撤回失败: $failureReason"
            RecallStatus.EXPIRED -> "撤回超时"
        }
    }
}

/**
 * 撤回状态
 */
enum class RecallStatus {
    /** 撤回中 */
    PENDING,

    /** 已撤回 */
    RECALLED,

    /** 撤回失败 */
    FAILED,

    /** 撤回超时 */
    EXPIRED
}

/**
 * 撤回策略
 */
data class RecallPolicy(
    /** 消息可撤回的最长时间（毫秒），默认 2 分钟 */
    val maxRecallTime: Long = 2 * 60 * 1000L,

    /** 是否允许撤回已读消息 */
    val allowRecallAfterRead: Boolean = false,

    /** 是否保留撤回记录 */
    val keepRecallRecord: Boolean = true,

    /** 撤回超时时间（毫秒），默认 10 秒 */
    val recallTimeout: Long = 10 * 1000L
) {
    companion object {
        /**
         * 默认策略
         */
        val DEFAULT = RecallPolicy()

        /**
         * 宽松策略（允许撤回已读消息，更长的撤回时间）
         */
        val PERMISSIVE = RecallPolicy(
            maxRecallTime = 5 * 60 * 1000L, // 5 分钟
            allowRecallAfterRead = true
        )

        /**
         * 严格策略（不允许撤回已读消息，较短的撤回时间）
         */
        val STRICT = RecallPolicy(
            maxRecallTime = 1 * 60 * 1000L, // 1 分钟
            allowRecallAfterRead = false
        )
    }

    /**
     * 检查消息是否可以撤回
     *
     * @param messageSentAt 消息发送时间
     * @param isRead 是否已读
     * @return 是否可以撤回
     */
    fun canRecall(messageSentAt: Long, isRead: Boolean): Boolean {
        val now = System.currentTimeMillis()
        val elapsed = now - messageSentAt

        // 检查时间限制
        if (elapsed > maxRecallTime) {
            return false
        }

        // 检查已读限制
        if (isRead && !allowRecallAfterRead) {
            return false
        }

        return true
    }
}
