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

    // 命令取消（与 PC 端对应）
    const val COMMAND_CANCEL = "chainlesschain:command:cancel"

    // Clipboard sync events
    const val CLIPBOARD_CHANGE = "chainlesschain:clipboard:change"

    // Notification events
    const val NOTIFICATION_RECEIVED = "chainlesschain:notification:received"

    // Workflow events
    const val WORKFLOW_PROGRESS = "chainlesschain:workflow:progress"
    const val WORKFLOW_COMPLETED = "chainlesschain:workflow:completed"

    // ==================== 流式消息类型 ====================
    const val STREAM_START = "chainlesschain:stream:start"
    const val STREAM_CHUNK = "chainlesschain:stream:chunk"
    const val STREAM_END = "chainlesschain:stream:end"
    const val STREAM_ERROR = "chainlesschain:stream:error"

    // ==================== 文件传输事件 ====================
    const val FILE_TRANSFER_START = "chainlesschain:file:transfer:start"
    const val FILE_TRANSFER_PROGRESS = "chainlesschain:file:transfer:progress"
    const val FILE_TRANSFER_COMPLETE = "chainlesschain:file:transfer:complete"
    const val FILE_TRANSFER_ERROR = "chainlesschain:file:transfer:error"
    const val FILE_TRANSFER_PAUSE = "chainlesschain:file:transfer:pause"
    const val FILE_TRANSFER_RESUME = "chainlesschain:file:transfer:resume"
    const val FILE_WATCH_EVENT = "chainlesschain:file:watch:event"

    // ==================== AI 相关事件 ====================
    const val AI_CHAT_STREAM = "chainlesschain:ai:chat:stream"
    const val AI_GENERATION_PROGRESS = "chainlesschain:ai:generation:progress"
    const val AI_TRANSCRIPTION_PROGRESS = "chainlesschain:ai:transcription:progress"
    const val AI_EMBEDDING_PROGRESS = "chainlesschain:ai:embedding:progress"

    // ==================== 媒体事件 ====================
    const val MEDIA_PLAYBACK_STATE = "chainlesschain:media:playback:state"
    const val MEDIA_RECORDING_STATE = "chainlesschain:media:recording:state"
    const val MEDIA_VOLUME_CHANGE = "chainlesschain:media:volume:change"
    const val CAMERA_CAPTURE_READY = "chainlesschain:camera:capture:ready"

    // ==================== 桌面事件 ====================
    const val DESKTOP_RECORDING_STATE = "chainlesschain:desktop:recording:state"
    const val DESKTOP_WINDOW_EVENT = "chainlesschain:desktop:window:event"
    const val DESKTOP_SCREENSHOT_READY = "chainlesschain:desktop:screenshot:ready"

    // ==================== 系统事件 ====================
    const val SYSTEM_PROCESS_EVENT = "chainlesschain:system:process:event"
    const val SYSTEM_SERVICE_EVENT = "chainlesschain:system:service:event"
    const val SYSTEM_LOG_EVENT = "chainlesschain:system:log:event"
    const val SYSTEM_SCHEDULED_TASK = "chainlesschain:system:scheduled:task"

    // ==================== 网络事件 ====================
    const val NETWORK_STATE_CHANGE = "chainlesschain:network:state:change"
    const val NETWORK_SPEED_TEST_PROGRESS = "chainlesschain:network:speed:progress"
    const val NETWORK_WIFI_SCAN_RESULT = "chainlesschain:network:wifi:scan"
    const val NETWORK_PORT_SCAN_PROGRESS = "chainlesschain:network:port:progress"

    // ==================== 存储事件 ====================
    const val STORAGE_SPACE_WARNING = "chainlesschain:storage:space:warning"
    const val STORAGE_BENCHMARK_PROGRESS = "chainlesschain:storage:benchmark:progress"
    const val STORAGE_SMART_ALERT = "chainlesschain:storage:smart:alert"

    // ==================== 电源事件 ====================
    const val POWER_BATTERY_STATE = "chainlesschain:power:battery:state"
    const val POWER_CHARGING_STATE = "chainlesschain:power:charging:state"
    const val POWER_WAKE_TIMER = "chainlesschain:power:wake:timer"
    const val POWER_UPS_ALERT = "chainlesschain:power:ups:alert"

    // ==================== 浏览器事件 ====================
    const val BROWSER_TAB_EVENT = "chainlesschain:browser:tab:event"
    const val BROWSER_DOWNLOAD_PROGRESS = "chainlesschain:browser:download:progress"
    const val BROWSER_NETWORK_EVENT = "chainlesschain:browser:network:event"
    const val BROWSER_CONSOLE_MESSAGE = "chainlesschain:browser:console:message"

    // ==================== 扩展事件 ====================
    const val EXTENSION_STATE_CHANGE = "chainlesschain:extension:state:change"
    const val EXTENSION_MESSAGE = "chainlesschain:extension:message"

    // ==================== 进程事件 ====================
    const val PROCESS_MONITOR_UPDATE = "chainlesschain:process:monitor:update"
    const val PROCESS_EXIT = "chainlesschain:process:exit"

    // ==================== 知识库事件 ====================
    const val KNOWLEDGE_SYNC_PROGRESS = "chainlesschain:knowledge:sync:progress"
    const val KNOWLEDGE_INDEX_PROGRESS = "chainlesschain:knowledge:index:progress"
}

/**
 * 命令取消请求
 */
@Serializable
data class CommandCancelRequest(
    val id: String,  // 要取消的命令 ID
    val reason: String? = null
)

/**
 * 错误码常量
 */
object ErrorCodes {
    const val TIMEOUT = -32000
    const val PERMISSION_DENIED = -32001
    const val CANCELLED = -32002  // 命令被取消（与 PC 端对应）
    const val RATE_LIMITED = -32003
    const val QUOTA_EXCEEDED = -32004
    const val RESOURCE_BUSY = -32005
    const val NOT_SUPPORTED = -32006
    const val CONNECTION_LOST = -32007
    const val AUTHENTICATION_FAILED = -32008
    const val INVALID_REQUEST = -32600
    const val METHOD_NOT_FOUND = -32601
    const val INVALID_PARAMS = -32602
    const val INTERNAL_ERROR = -32603
}

// ==================== 流式消息数据类 ====================

/**
 * 流式响应开始
 */
@Serializable
data class StreamStartMessage(
    val streamId: String,
    val method: String,
    val totalChunks: Int? = null,  // 预估总块数（可选）
    val metadata: Map<String, @Contextual Any> = emptyMap()
)

/**
 * 流式数据块
 */
@Serializable
data class StreamChunkMessage(
    val streamId: String,
    val chunkIndex: Int,
    val data: @Contextual Any,
    val isLast: Boolean = false
)

/**
 * 流式响应结束
 */
@Serializable
data class StreamEndMessage(
    val streamId: String,
    val totalChunks: Int,
    val success: Boolean = true,
    val error: String? = null
)

// ==================== 进度通知数据类 ====================

/**
 * 通用进度通知
 */
@Serializable
data class ProgressNotification(
    val operationId: String,
    val operationType: String,
    val progress: Float,  // 0.0 - 1.0
    val currentStep: String? = null,
    val totalSteps: Int? = null,
    val currentStepIndex: Int? = null,
    val estimatedRemainingMs: Long? = null,
    val metadata: Map<String, @Contextual Any> = emptyMap()
)

/**
 * 文件传输进度
 */
@Serializable
data class FileTransferProgress(
    val transferId: String,
    val fileName: String,
    val filePath: String,
    val direction: String,  // "upload" | "download"
    val bytesTransferred: Long,
    val totalBytes: Long,
    val progress: Float,
    val speed: Long,  // bytes/second
    val estimatedRemainingMs: Long? = null,
    val state: String  // "pending" | "transferring" | "paused" | "completed" | "error"
)

/**
 * AI 生成进度
 */
@Serializable
data class AIGenerationProgress(
    val operationId: String,
    val operationType: String,  // "chat" | "image" | "audio" | "embedding"
    val progress: Float,
    val tokensGenerated: Int? = null,
    val totalTokens: Int? = null,
    val currentStep: String? = null
)

/**
 * 媒体操作进度
 */
@Serializable
data class MediaOperationProgress(
    val operationId: String,
    val operationType: String,  // "recording" | "conversion" | "encoding"
    val progress: Float,
    val duration: Long? = null,  // milliseconds
    val currentPosition: Long? = null,
    val outputPath: String? = null
)

// ==================== 事件订阅数据类 ====================

/**
 * 事件订阅请求
 */
@Serializable
data class EventSubscription(
    val subscriptionId: String,
    val eventTypes: List<String>,
    val filters: Map<String, @Contextual Any> = emptyMap(),
    val includeHistory: Boolean = false,
    val historyLimit: Int = 10
)

/**
 * 事件订阅确认
 */
@Serializable
data class EventSubscriptionAck(
    val subscriptionId: String,
    val eventTypes: List<String>,
    val success: Boolean,
    val error: String? = null
)

/**
 * 批量事件通知
 */
@Serializable
data class BatchEventNotification(
    val subscriptionId: String,
    val events: List<EventNotification>,
    val hasMore: Boolean = false
)

// ==================== 系统状态数据类 ====================

/**
 * 连接质量信息
 */
@Serializable
data class ConnectionQuality(
    val latencyMs: Long,
    val packetLoss: Float,
    val bandwidth: Long,  // bytes/second
    val jitter: Long,  // milliseconds
    val quality: String  // "excellent" | "good" | "fair" | "poor"
)

/**
 * 设备状态
 */
@Serializable
data class DeviceStatus(
    val deviceId: String,
    val deviceName: String,
    val platform: String,
    val isOnline: Boolean,
    val lastSeen: Long,
    val batteryLevel: Int? = null,
    val isCharging: Boolean? = null,
    val networkType: String? = null,
    val cpuUsage: Float? = null,
    val memoryUsage: Float? = null
)

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
