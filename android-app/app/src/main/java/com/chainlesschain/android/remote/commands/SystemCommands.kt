package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 系统命令 API
 *
 * 提供类型安全的系统相关命令
 */
@Singleton
class SystemCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 获取系统状态
     */
    suspend fun getStatus(): Result<SystemStatus> {
        return client.invoke("system.getStatus", emptyMap())
    }

    /**
     * 获取系统信息
     */
    suspend fun getInfo(): Result<SystemInfo> {
        return client.invoke("system.getInfo", emptyMap())
    }

    /**
     * 截图
     */
    suspend fun screenshot(
        display: Int = 0,
        format: String = "png",
        quality: Int = 80
    ): Result<ScreenshotResponse> {
        val params = mapOf(
            "display" to display,
            "format" to format,
            "quality" to quality
        )

        return client.invoke("system.screenshot", params)
    }

    /**
     * 发送通知
     */
    suspend fun notify(
        title: String,
        body: String,
        urgency: NotificationUrgency = NotificationUrgency.NORMAL
    ): Result<NotifyResponse> {
        val params = mapOf(
            "title" to title,
            "body" to body,
            "urgency" to urgency.value
        )

        return client.invoke("system.notify", params)
    }

    /**
     * 执行 Shell 命令（需要高权限）
     */
    suspend fun execCommand(
        command: String,
        cwd: String? = null,
        timeout: Long = 30000
    ): Result<ExecCommandResponse> {
        val params = mutableMapOf<String, Any>(
            "command" to command,
            "timeout" to timeout
        )

        cwd?.let { params["cwd"] = it }

        return client.invoke("system.execCommand", params)
    }
}

/**
 * 系统状态
 */
@Serializable
data class SystemStatus(
    val cpu: CPUStatus,
    val memory: MemoryStatus,
    val system: SystemBasicInfo,
    val timestamp: Long
)

/**
 * CPU 状态
 */
@Serializable
data class CPUStatus(
    val usage: String,
    val cores: Int,
    val model: String
)

/**
 * 内存状态
 */
@Serializable
data class MemoryStatus(
    val total: Long,
    val used: Long,
    val free: Long,
    val usagePercent: String
)

/**
 * 系统基本信息
 */
@Serializable
data class SystemBasicInfo(
    val platform: String,
    val arch: String,
    val hostname: String,
    val uptime: Long
)

/**
 * 系统详细信息
 */
@Serializable
data class SystemInfo(
    val os: OSInfo,
    val cpu: CPUInfo,
    val memory: MemoryInfo,
    val hostname: String,
    val uptime: Long,
    val timestamp: Long
)

/**
 * 操作系统信息
 */
@Serializable
data class OSInfo(
    val type: String,
    val platform: String,
    val arch: String,
    val release: String,
    val version: String
)

/**
 * CPU 详细信息
 */
@Serializable
data class CPUInfo(
    val model: String,
    val cores: Int,
    val speed: Int
)

/**
 * 内存详细信息
 */
@Serializable
data class MemoryInfo(
    val total: Long,
    val free: Long
)

/**
 * 截图响应
 */
@Serializable
data class ScreenshotResponse(
    val format: String,
    val data: String,  // Base64 encoded
    val width: Int,
    val height: Int,
    val display: Int,
    val timestamp: Long
)

/**
 * 通知响应
 */
@Serializable
data class NotifyResponse(
    val success: Boolean,
    val title: String,
    val body: String,
    val timestamp: Long
)

/**
 * 执行命令响应
 */
@Serializable
data class ExecCommandResponse(
    val success: Boolean,
    val command: String,
    val stdout: String,
    val stderr: String,
    val exitCode: Int,
    val timestamp: Long
)

/**
 * 通知紧急程度
 */
enum class NotificationUrgency(val value: String) {
    LOW("low"),
    NORMAL("normal"),
    CRITICAL("critical")
}
