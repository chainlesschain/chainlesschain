package com.chainlesschain.android.core.e2ee.receipt

import kotlinx.serialization.Serializable

/**
 * 已读回执
 *
 * 加密的已读回执，保护隐私
 */
@Serializable
data class ReadReceipt(
    /** 消息ID列表（批量确认） */
    val messageIds: List<String>,

    /** 已读时间戳 */
    val timestamp: Long,

    /** 回执类型 */
    val type: ReceiptType,

    /** 可选：额外数据 */
    val metadata: Map<String, String> = emptyMap()
) {
    companion object {
        /**
         * 创建单条消息的已读回执
         */
        fun forMessage(messageId: String, type: ReceiptType = ReceiptType.READ): ReadReceipt {
            return ReadReceipt(
                messageIds = listOf(messageId),
                timestamp = System.currentTimeMillis(),
                type = type
            )
        }

        /**
         * 创建批量已读回执
         */
        fun forMessages(messageIds: List<String>, type: ReceiptType = ReceiptType.READ): ReadReceipt {
            return ReadReceipt(
                messageIds = messageIds,
                timestamp = System.currentTimeMillis(),
                type = type
            )
        }
    }
}

/**
 * 回执类型
 */
enum class ReceiptType {
    /** 已送达 */
    DELIVERED,

    /** 已读 */
    READ,

    /** 已播放（语音/视频） */
    PLAYED,

    /** 已截屏 */
    SCREENSHOT
}

/**
 * 回执状态
 */
data class MessageReceiptStatus(
    /** 消息ID */
    val messageId: String,

    /** 是否已送达 */
    var delivered: Boolean = false,

    /** 送达时间 */
    var deliveredAt: Long? = null,

    /** 是否已读 */
    var read: Boolean = false,

    /** 已读时间 */
    var readAt: Long? = null,

    /** 是否已播放 */
    var played: Boolean = false,

    /** 播放时间 */
    var playedAt: Long? = null,

    /** 是否已截屏 */
    var screenshot: Boolean = false,

    /** 截屏时间 */
    var screenshotAt: Long? = null
) {
    /**
     * 更新回执状态
     */
    fun update(receipt: ReadReceipt) {
        when (receipt.type) {
            ReceiptType.DELIVERED -> {
                delivered = true
                deliveredAt = receipt.timestamp
            }
            ReceiptType.READ -> {
                read = true
                readAt = receipt.timestamp
                // 已读意味着已送达
                if (!delivered) {
                    delivered = true
                    deliveredAt = receipt.timestamp
                }
            }
            ReceiptType.PLAYED -> {
                played = true
                playedAt = receipt.timestamp
            }
            ReceiptType.SCREENSHOT -> {
                screenshot = true
                screenshotAt = receipt.timestamp
            }
        }
    }

    /**
     * 获取最新状态文本
     */
    fun getStatusText(): String {
        return when {
            read -> "已读"
            played -> "已播放"
            delivered -> "已送达"
            else -> "发送中"
        }
    }
}
