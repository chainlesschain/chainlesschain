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
