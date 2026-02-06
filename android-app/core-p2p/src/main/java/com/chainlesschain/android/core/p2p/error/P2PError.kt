package com.chainlesschain.android.core.p2p.error

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * P2P 错误基类
 *
 * 统一的错误处理系统，支持：
 * - 错误分类和严重程度
 * - 可观察的错误流
 * - UI 层友好的错误信息
 * - 重试建议
 */
sealed class P2PError(
    /** 错误消息 */
    open val message: String,

    /** 错误严重程度 */
    open val severity: ErrorSeverity = ErrorSeverity.ERROR,

    /** 是否可重试 */
    open val isRetryable: Boolean = false,

    /** 原始异常 */
    open val cause: Throwable? = null
) {
    /** 错误发生时间 */
    val timestamp: Long = System.currentTimeMillis()

    /**
     * 连接相关错误
     */
    sealed class Connection(
        override val message: String,
        override val severity: ErrorSeverity = ErrorSeverity.ERROR,
        override val isRetryable: Boolean = true,
        override val cause: Throwable? = null
    ) : P2PError(message, severity, isRetryable, cause) {

        /** 连接超时 */
        data class Timeout(
            val host: String,
            val timeoutMs: Long,
            override val cause: Throwable? = null
        ) : Connection(
            message = "连接超时: $host (${timeoutMs}ms)",
            isRetryable = true
        )

        /** 连接被拒绝 */
        data class Refused(
            val host: String,
            val port: Int,
            override val cause: Throwable? = null
        ) : Connection(
            message = "连接被拒绝: $host:$port",
            isRetryable = true
        )

        /** 网络不可用 */
        data class NetworkUnavailable(
            override val cause: Throwable? = null
        ) : Connection(
            message = "网络不可用",
            severity = ErrorSeverity.WARNING,
            isRetryable = true
        )

        /** 达到最大重连次数 */
        data class MaxReconnectReached(
            val attempts: Int
        ) : Connection(
            message = "达到最大重连次数: $attempts",
            severity = ErrorSeverity.ERROR,
            isRetryable = false
        )

        /** 连接断开 */
        data class Disconnected(
            val reason: String
        ) : Connection(
            message = "连接断开: $reason",
            severity = ErrorSeverity.WARNING,
            isRetryable = true
        )
    }

    /**
     * ICE/NAT 穿透相关错误
     */
    sealed class Ice(
        override val message: String,
        override val severity: ErrorSeverity = ErrorSeverity.ERROR,
        override val isRetryable: Boolean = true,
        override val cause: Throwable? = null
    ) : P2PError(message, severity, isRetryable, cause) {

        /** ICE 收集超时 */
        data class GatheringTimeout(
            val timeoutMs: Long
        ) : Ice(
            message = "ICE 候选收集超时: ${timeoutMs}ms",
            isRetryable = true
        )

        /** ICE 连接失败 */
        data class ConnectionFailed(
            val attempts: Int,
            override val cause: Throwable? = null
        ) : Ice(
            message = "ICE 连接失败 (尝试 $attempts 次)",
            isRetryable = true
        )

        /** 无可用 TURN 服务器 */
        data object NoTurnServer : Ice(
            message = "无可用 TURN 服务器，无法进行 NAT 穿透",
            severity = ErrorSeverity.WARNING,
            isRetryable = false
        )

        /** STUN 服务器不可达 */
        data class StunUnreachable(
            val serverUrl: String,
            override val cause: Throwable? = null
        ) : Ice(
            message = "STUN 服务器不可达: $serverUrl",
            severity = ErrorSeverity.WARNING,
            isRetryable = true
        )
    }

    /**
     * 信令相关错误
     */
    sealed class Signaling(
        override val message: String,
        override val severity: ErrorSeverity = ErrorSeverity.ERROR,
        override val isRetryable: Boolean = true,
        override val cause: Throwable? = null
    ) : P2PError(message, severity, isRetryable, cause) {

        /** 消息发送失败 */
        data class SendFailed(
            val messageType: String,
            override val cause: Throwable? = null
        ) : Signaling(
            message = "信令消息发送失败: $messageType",
            isRetryable = true
        )

        /** 消息确认超时 */
        data class AckTimeout(
            val messageId: String,
            val timeoutMs: Long
        ) : Signaling(
            message = "消息确认超时: $messageId (${timeoutMs}ms)",
            isRetryable = true
        )

        /** 心跳超时 */
        data class HeartbeatTimeout(
            val lastResponseMs: Long
        ) : Signaling(
            message = "心跳超时，上次响应: ${lastResponseMs}ms 前",
            isRetryable = true
        )

        /** 协议错误 */
        data class ProtocolError(
            val details: String,
            override val cause: Throwable? = null
        ) : Signaling(
            message = "信令协议错误: $details",
            severity = ErrorSeverity.ERROR,
            isRetryable = false
        )
    }

    /**
     * 数据传输相关错误
     */
    sealed class Transport(
        override val message: String,
        override val severity: ErrorSeverity = ErrorSeverity.ERROR,
        override val isRetryable: Boolean = true,
        override val cause: Throwable? = null
    ) : P2PError(message, severity, isRetryable, cause) {

        /** DataChannel 未打开 */
        data object ChannelNotOpen : Transport(
            message = "数据通道未打开",
            isRetryable = true
        )

        /** 消息过大 */
        data class MessageTooLarge(
            val size: Int,
            val maxSize: Int
        ) : Transport(
            message = "消息过大: $size 字节 (最大 $maxSize)",
            isRetryable = false
        )

        /** 发送队列已满 */
        data class QueueFull(
            val queueSize: Int
        ) : Transport(
            message = "发送队列已满: $queueSize 条消息",
            severity = ErrorSeverity.WARNING,
            isRetryable = true
        )

        /** 分片超时 */
        data class FragmentTimeout(
            val messageId: String,
            val receivedCount: Int,
            val totalCount: Int
        ) : Transport(
            message = "分片接收超时: $messageId ($receivedCount/$totalCount)",
            isRetryable = true
        )

        /** 分片重组失败 */
        data class FragmentAssemblyFailed(
            val messageId: String,
            val reason: String
        ) : Transport(
            message = "分片重组失败: $messageId - $reason",
            isRetryable = false
        )

        /** 重传失败 */
        data class RetransmissionFailed(
            val messageId: String,
            val attempts: Int
        ) : Transport(
            message = "消息重传失败: $messageId (尝试 $attempts 次)",
            isRetryable = false
        )
    }

    /**
     * 认证相关错误
     */
    sealed class Authentication(
        override val message: String,
        override val severity: ErrorSeverity = ErrorSeverity.ERROR,
        override val isRetryable: Boolean = false,
        override val cause: Throwable? = null
    ) : P2PError(message, severity, isRetryable, cause) {

        /** 设备未认证 */
        data class DeviceNotAuthenticated(
            val deviceId: String
        ) : Authentication(
            message = "设备未认证: $deviceId"
        )

        /** 密钥交换失败 */
        data class KeyExchangeFailed(
            override val cause: Throwable? = null
        ) : Authentication(
            message = "密钥交换失败",
            isRetryable = true
        )

        /** 签名验证失败 */
        data class SignatureVerificationFailed(
            val deviceId: String
        ) : Authentication(
            message = "签名验证失败: $deviceId"
        )
    }

    /**
     * 未知错误
     */
    data class Unknown(
        override val message: String,
        override val cause: Throwable? = null
    ) : P2PError(
        message = message,
        severity = ErrorSeverity.ERROR,
        isRetryable = false,
        cause = cause
    )
}

/**
 * 错误严重程度
 */
enum class ErrorSeverity {
    /** 信息 - 不影响功能 */
    INFO,

    /** 警告 - 可能影响功能但可恢复 */
    WARNING,

    /** 错误 - 功能受影响 */
    ERROR,

    /** 致命 - 需要重新初始化 */
    FATAL
}

/**
 * P2P 错误管理器
 *
 * 统一管理和分发 P2P 错误
 */
object P2PErrorManager {
    private val _errors = MutableSharedFlow<P2PError>(
        extraBufferCapacity = 64
    )

    /** 错误流，供 UI 层观察 */
    val errors: SharedFlow<P2PError> = _errors.asSharedFlow()

    private val errorHistory = mutableListOf<P2PError>()
    private const val MAX_HISTORY_SIZE = 100

    /**
     * 报告错误
     */
    suspend fun reportError(error: P2PError) {
        // 添加到历史
        synchronized(errorHistory) {
            errorHistory.add(error)
            if (errorHistory.size > MAX_HISTORY_SIZE) {
                errorHistory.removeAt(0)
            }
        }

        // 发射到流
        _errors.emit(error)
    }

    /**
     * 获取错误历史
     */
    fun getErrorHistory(): List<P2PError> {
        synchronized(errorHistory) {
            return errorHistory.toList()
        }
    }

    /**
     * 获取最近的错误
     */
    fun getRecentErrors(count: Int = 10): List<P2PError> {
        synchronized(errorHistory) {
            return errorHistory.takeLast(count)
        }
    }

    /**
     * 按类型获取错误
     */
    inline fun <reified T : P2PError> getErrorsByType(): List<T> {
        synchronized(errorHistory) {
            return errorHistory.filterIsInstance<T>()
        }
    }

    /**
     * 清除错误历史
     */
    fun clearHistory() {
        synchronized(errorHistory) {
            errorHistory.clear()
        }
    }

    /**
     * 获取错误统计
     */
    fun getErrorStats(): ErrorStats {
        synchronized(errorHistory) {
            val byType = errorHistory.groupBy { it::class.simpleName ?: "Unknown" }
            val bySeverity = errorHistory.groupBy { it.severity }

            return ErrorStats(
                totalErrors = errorHistory.size,
                byType = byType.mapValues { it.value.size },
                bySeverity = bySeverity.mapValues { it.value.size },
                retryableCount = errorHistory.count { it.isRetryable }
            )
        }
    }
}

/**
 * 错误统计
 */
data class ErrorStats(
    val totalErrors: Int,
    val byType: Map<String, Int>,
    val bySeverity: Map<ErrorSeverity, Int>,
    val retryableCount: Int
)

/**
 * P2PError 日志格式化扩展
 *
 * 提供标准化的日志输出格式，便于调试和问题诊断
 */

/**
 * 格式化为单行日志
 */
fun P2PError.toLogString(): String {
    val severityTag = when (severity) {
        ErrorSeverity.INFO -> "I"
        ErrorSeverity.WARNING -> "W"
        ErrorSeverity.ERROR -> "E"
        ErrorSeverity.FATAL -> "F"
    }
    val retryTag = if (isRetryable) "R" else "-"
    val typeName = this::class.simpleName ?: "Unknown"
    return "[$severityTag/$retryTag] $typeName: $message"
}

/**
 * 格式化为详细的多行日志（包含堆栈跟踪）
 */
fun P2PError.toDetailedLogString(): String {
    val sb = StringBuilder()
    sb.appendLine("═══════════════════════════════════════════")
    sb.appendLine("P2P Error Report")
    sb.appendLine("───────────────────────────────────────────")
    sb.appendLine("Type     : ${this::class.qualifiedName}")
    sb.appendLine("Severity : $severity")
    sb.appendLine("Retryable: $isRetryable")
    sb.appendLine("Message  : $message")
    sb.appendLine("Time     : ${java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", java.util.Locale.getDefault()).format(java.util.Date(timestamp))}")

    cause?.let { throwable ->
        sb.appendLine("───────────────────────────────────────────")
        sb.appendLine("Cause: ${throwable::class.simpleName}: ${throwable.message}")
        sb.appendLine("Stack Trace:")
        throwable.stackTrace.take(10).forEach { element ->
            sb.appendLine("  at $element")
        }
        if (throwable.stackTrace.size > 10) {
            sb.appendLine("  ... ${throwable.stackTrace.size - 10} more")
        }
    }

    sb.appendLine("═══════════════════════════════════════════")
    return sb.toString()
}

/**
 * 格式化为 JSON 字符串（便于日志收集系统处理）
 */
fun P2PError.toJsonLogString(): String {
    val escapedMessage = message.replace("\"", "\\\"").replace("\n", "\\n")
    val causeName = cause?.let { "\"${it::class.simpleName}\"" } ?: "null"
    val causeMessage = cause?.message?.replace("\"", "\\\"")?.replace("\n", "\\n")?.let { "\"$it\"" } ?: "null"

    return """{"type":"${this::class.simpleName}","severity":"$severity","retryable":$isRetryable,"message":"$escapedMessage","timestamp":$timestamp,"cause":{"type":$causeName,"message":$causeMessage}}"""
}

/**
 * 获取 Android Log 级别
 */
fun P2PError.getLogLevel(): Int {
    return when (severity) {
        ErrorSeverity.INFO -> android.util.Log.INFO
        ErrorSeverity.WARNING -> android.util.Log.WARN
        ErrorSeverity.ERROR -> android.util.Log.ERROR
        ErrorSeverity.FATAL -> android.util.Log.ASSERT
    }
}

/**
 * 使用 Android Log 输出
 */
fun P2PError.logToAndroid(tag: String = "P2P") {
    val level = getLogLevel()
    val message = toLogString()

    when (level) {
        android.util.Log.INFO -> android.util.Log.i(tag, message, cause)
        android.util.Log.WARN -> android.util.Log.w(tag, message, cause)
        android.util.Log.ERROR -> android.util.Log.e(tag, message, cause)
        android.util.Log.ASSERT -> android.util.Log.wtf(tag, message, cause)
        else -> android.util.Log.d(tag, message, cause)
    }
}

/**
 * 获取用户友好的错误描述
 */
fun P2PError.getUserFriendlyMessage(): String {
    return when (this) {
        is P2PError.Connection.Timeout -> "连接超时，请检查网络"
        is P2PError.Connection.Refused -> "连接被拒绝，对方可能离线"
        is P2PError.Connection.NetworkUnavailable -> "网络不可用，请检查网络设置"
        is P2PError.Connection.MaxReconnectReached -> "多次重连失败，请稍后重试"
        is P2PError.Connection.Disconnected -> "连接已断开"

        is P2PError.Ice.GatheringTimeout -> "网络发现超时"
        is P2PError.Ice.ConnectionFailed -> "P2P连接失败，尝试使用中继"
        is P2PError.Ice.NoTurnServer -> "中继服务器不可用"
        is P2PError.Ice.StunUnreachable -> "网络发现服务不可达"

        is P2PError.Signaling.SendFailed -> "消息发送失败"
        is P2PError.Signaling.AckTimeout -> "消息确认超时"
        is P2PError.Signaling.HeartbeatTimeout -> "连接心跳超时"
        is P2PError.Signaling.ProtocolError -> "通信协议错误"

        is P2PError.Transport.ChannelNotOpen -> "数据通道未就绪"
        is P2PError.Transport.MessageTooLarge -> "消息太大，请分批发送"
        is P2PError.Transport.QueueFull -> "发送队列已满，请稍后重试"
        is P2PError.Transport.FragmentTimeout -> "消息分片接收超时"
        is P2PError.Transport.FragmentAssemblyFailed -> "消息重组失败"
        is P2PError.Transport.RetransmissionFailed -> "消息重发失败"

        is P2PError.Authentication.DeviceNotAuthenticated -> "设备未认证"
        is P2PError.Authentication.KeyExchangeFailed -> "密钥交换失败"
        is P2PError.Authentication.SignatureVerificationFailed -> "签名验证失败"

        is P2PError.Unknown -> "未知错误: $message"
    }
}
