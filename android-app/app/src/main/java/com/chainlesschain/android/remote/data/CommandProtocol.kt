package com.chainlesschain.android.remote.data

import com.google.gson.Gson
import kotlinx.serialization.Contextual
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 命令协议数据模型
 *
 * 基于 JSON-RPC 2.0 标准
 */

/**
 * 命令请求
 */
@Serializable
data class CommandRequest(
    val jsonrpc: String = "2.0",
    val id: String,
    val method: String,
    val params: Map<String, @Contextual Any> = emptyMap(),
    val auth: AuthInfo
)

/**
 * 命令响应
 */
@Serializable
data class CommandResponse(
    val jsonrpc: String,
    val id: String,
    val result: @Contextual Any? = null,
    val error: ErrorInfo? = null
) {
    fun isSuccess(): Boolean = error == null
    fun isError(): Boolean = error != null
}

/**
 * 认证信息
 */
@Serializable
data class AuthInfo(
    val did: String,
    val signature: String,
    val timestamp: Long,
    val nonce: String
)

/**
 * 错误信息
 */
@Serializable
data class ErrorInfo(
    val code: Int,
    val message: String,
    val data: String? = null
)

/**
 * 事件通知
 */
@Serializable
data class EventNotification(
    val jsonrpc: String,
    val method: String,
    val params: Map<String, @Contextual Any> = emptyMap()
)

/**
 * P2P 消息封装
 */
@Serializable
data class P2PMessage(
    val type: String,
    val payload: String
)

/**
 * 消息类型常量
 */
object MessageTypes {
    const val COMMAND_REQUEST = "chainlesschain:command:request"
    const val COMMAND_RESPONSE = "chainlesschain:command:response"
    const val EVENT_NOTIFICATION = "chainlesschain:event:notification"
    const val HEARTBEAT = "chainlesschain:heartbeat"
    const val HEARTBEAT_ACK = "chainlesschain:heartbeat:ack"

    // Clipboard sync events
    const val CLIPBOARD_CHANGE = "chainlesschain:clipboard:change"

    // Notification events
    const val NOTIFICATION_RECEIVED = "chainlesschain:notification:received"

    // Workflow events
    const val WORKFLOW_PROGRESS = "chainlesschain:workflow:progress"
    const val WORKFLOW_COMPLETED = "chainlesschain:workflow:completed"
}

/**
 * 错误码常量
 */
object ErrorCodes {
    const val TIMEOUT = -32000
    const val PERMISSION_DENIED = -32001
    const val INVALID_REQUEST = -32600
    const val METHOD_NOT_FOUND = -32601
    const val INVALID_PARAMS = -32602
    const val INTERNAL_ERROR = -32603
}

/**
 * JSON 序列化器配置
 */
val JsonSerializer = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    encodeDefaults = true
}

/**
 * Gson 实例，用于处理 Map<String, Any> 等动态类型序列化
 */
private val gson = Gson()

/**
 * 辅助扩展函数
 */

/**
 * 将对象序列化为 JSON 字符串
 */
inline fun <reified T> T.toJsonString(): String {
    return JsonSerializer.encodeToString(kotlinx.serialization.serializer(), this)
}

/**
 * 从 JSON 字符串反序列化对象
 */
inline fun <reified T> String.fromJson(): T {
    return JsonSerializer.decodeFromString(kotlinx.serialization.serializer(), this)
}

/**
 * 将 Map<String, Any> 序列化为 JSON 字符串
 * 使用 Gson 处理动态类型，因为 kotlinx.serialization 不支持 Any 类型
 */
fun Map<String, Any?>.toJsonString(): String {
    return gson.toJson(this)
}
