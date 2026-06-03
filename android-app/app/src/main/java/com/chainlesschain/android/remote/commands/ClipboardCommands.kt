package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 剪贴板命令 API
 *
 * 提供类型安全的剪贴板同步命令，支持文本、HTML、图片内容的跨设备同步
 */
@Singleton
class ClipboardCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取PC剪贴板内容
     *
     * @param type 内容类型: "text", "html", "image"
     * @return 剪贴板内容
     */
    suspend fun get(type: ClipboardContentType = ClipboardContentType.TEXT): Result<ClipboardContent> {
        val params = mapOf("type" to type.value)
        return client.invoke("clipboard.get", params)
    }

    /**
     * 设置PC剪贴板内容
     *
     * @param content 要设置的内容
     * @param type 内容类型
     * @return 设置结果
     */
    suspend fun set(
        content: String,
        type: ClipboardContentType = ClipboardContentType.TEXT
    ): Result<ClipboardSetResponse> {
        val params = mapOf(
            "type" to type.value,
            "content" to content
        )
        return client.invoke("clipboard.set", params)
    }

    /**
     * 开始监视PC剪贴板变化
     *
     * @param interval 检查间隔(毫秒)，默认1000ms
     * @return 监视启动结果
     */
    suspend fun watch(interval: Long = 1000): Result<ClipboardWatchResponse> {
        val params = mapOf("interval" to interval)
        return client.invoke("clipboard.watch", params)
    }

    /**
     * 停止监视PC剪贴板
     *
     * @return 停止结果
     */
    suspend fun unwatch(): Result<ClipboardWatchResponse> {
        return client.invoke("clipboard.unwatch", emptyMap())
    }

    /**
     * 获取剪贴板历史
     *
     * @param limit 返回条数限制，默认50
     * @return 剪贴板历史列表
     */
    suspend fun getHistory(limit: Int = 50): Result<ClipboardHistoryResponse> {
        val params = mapOf("limit" to limit)
        return client.invoke("clipboard.getHistory", params)
    }

    /**
     * 清除剪贴板历史
     *
     * @return 清除结果
     */
    suspend fun clearHistory(): Result<ClipboardClearHistoryResponse> {
        return client.invoke("clipboard.clearHistory", emptyMap())
    }

    /**
     * 同步剪贴板到指定设备
     *
     * @param deviceId 目标设备ID (可选，不指定则同步到所有设备)
     * @return 同步结果
     */
    suspend fun sync(deviceId: String? = null): Result<ClipboardSyncResponse> {
        val params = mutableMapOf<String, Any>()
        deviceId?.let { params["deviceId"] = it }
        return client.invoke("clipboard.sync", params)
    }

    /**
     * 从本地剪贴板推送到PC
     *
     * 便捷方法：获取Android本地剪贴板内容并设置到PC
     *
     * @param localContent 本地剪贴板内容
     * @param type 内容类型
     * @return 设置结果
     */
    suspend fun pushToPC(
        localContent: String,
        type: ClipboardContentType = ClipboardContentType.TEXT
    ): Result<ClipboardSetResponse> {
        return set(localContent, type)
    }

    /**
     * 从PC拉取剪贴板到本地
     *
     * 便捷方法：获取PC剪贴板内容
     *
     * @param type 内容类型
     * @return PC剪贴板内容
     */
    suspend fun pullFromPC(
        type: ClipboardContentType = ClipboardContentType.TEXT
    ): Result<ClipboardContent> {
        return get(type)
    }
}

/**
 * 剪贴板内容类型
 */
enum class ClipboardContentType(val value: String) {
    TEXT("text"),
    HTML("html"),
    IMAGE("image")
}

/**
 * 剪贴板内容
 */
@Serializable
data class ClipboardContent(
    val success: Boolean,
    val content: String?,
    val type: String,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * 设置剪贴板响应
 */
@Serializable
data class ClipboardSetResponse(
    val success: Boolean,
    val type: String? = null,
    val error: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * 剪贴板监视响应
 */
@Serializable
data class ClipboardWatchResponse(
    val success: Boolean,
    val watching: Boolean? = null,
    val enabled: Boolean? = null,
    val interval: Long? = null,
    val error: String? = null,
    val message: String? = null
)

/**
 * 剪贴板历史项
 */
@Serializable
data class ClipboardHistoryItem(
    val id: String,
    val content: String,
    val type: String,
    val timestamp: Long,
    val source: String? = null  // "pc" or "mobile"
)

/**
 * 剪贴板历史响应
 */
@Serializable
data class ClipboardHistoryResponse(
    val success: Boolean,
    val history: List<ClipboardHistoryItem>,
    val total: Int? = null
)

/**
 * 清除历史响应
 */
@Serializable
data class ClipboardClearHistoryResponse(
    val success: Boolean,
    val cleared: Int? = null,
    val error: String? = null
)

/**
 * 剪贴板同步响应
 */
@Serializable
data class ClipboardSyncResponse(
    val success: Boolean,
    val synced: Boolean,
    val content: String? = null,
    val type: String? = null,
    val error: String? = null
)

/**
 * 剪贴板变化事件
 *
 * 当PC剪贴板变化时通过P2P事件推送到Android
 */
@Serializable
data class ClipboardChangeEvent(
    val type: String = "clipboard.change",
    val content: String,
    val contentType: String,
    val timestamp: Long,
    val source: String = "pc"
)
