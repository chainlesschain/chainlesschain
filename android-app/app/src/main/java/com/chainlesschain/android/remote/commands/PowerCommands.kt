package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import kotlinx.serialization.Serializable
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 电源控制命令 API
 *
 * 提供类型安全的电源控制相关命令
 */
@Singleton
class PowerCommands @Inject constructor(
    private val client: RemoteCommandClient
) {
    /**
     * 关机
     *
     * @param delay 延迟时间（秒）
     * @param force 是否强制关机
     * @param confirm 是否需要确认
     */
    suspend fun shutdown(
        delay: Int = 0,
        force: Boolean = false,
        confirm: Boolean = true
    ): Result<PowerActionResponse> {
        val params = mapOf(
            "delay" to delay,
            "force" to force,
            "confirm" to confirm
        )
        return client.invoke("power.shutdown", params)
    }

    /**
     * 重启
     *
     * @param delay 延迟时间（秒）
     * @param force 是否强制重启
     * @param confirm 是否需要确认
     */
    suspend fun restart(
        delay: Int = 0,
        force: Boolean = false,
        confirm: Boolean = true
    ): Result<PowerActionResponse> {
        val params = mapOf(
            "delay" to delay,
            "force" to force,
            "confirm" to confirm
        )
        return client.invoke("power.restart", params)
    }

    /**
     * 睡眠
     */
    suspend fun sleep(): Result<PowerActionResponse> {
        return client.invoke("power.sleep", emptyMap())
    }

    /**
     * 休眠
     */
    suspend fun hibernate(): Result<PowerActionResponse> {
        return client.invoke("power.hibernate", emptyMap())
    }

    /**
     * 锁屏
     */
    suspend fun lock(): Result<PowerActionResponse> {
        return client.invoke("power.lock", emptyMap())
    }

    /**
     * 注销
     *
     * @param force 是否强制注销
     * @param confirm 是否需要确认
     */
    suspend fun logout(
        force: Boolean = false,
        confirm: Boolean = true
    ): Result<PowerActionResponse> {
        val params = mapOf(
            "force" to force,
            "confirm" to confirm
        )
        return client.invoke("power.logout", params)
    }

    /**
     * 定时关机/重启
     *
     * @param delay 延迟时间（秒），与 time 二选一
     * @param time ISO 8601 时间字符串，与 delay 二选一
     * @param action 操作类型：shutdown 或 restart
     */
    suspend fun scheduleShutdown(
        delay: Int? = null,
        time: String? = null,
        action: String = "shutdown"
    ): Result<ScheduleResponse> {
        val params = mutableMapOf<String, Any>(
            "action" to action
        )
        delay?.let { params["delay"] = it }
        time?.let { params["time"] = it }

        return client.invoke("power.scheduleShutdown", params)
    }

    /**
     * 取消定时任务
     *
     * @param taskId 任务 ID
     */
    suspend fun cancelSchedule(taskId: String): Result<CancelScheduleResponse> {
        val params = mapOf("taskId" to taskId)
        return client.invoke("power.cancelSchedule", params)
    }

    /**
     * 获取定时任务列表
     */
    suspend fun getSchedule(): Result<ScheduleListResponse> {
        return client.invoke("power.getSchedule", emptyMap())
    }

    /**
     * 确认待执行的操作
     *
     * @param confirmId 确认 ID
     */
    suspend fun confirm(confirmId: String): Result<PowerActionResponse> {
        val params = mapOf("confirmId" to confirmId)
        return client.invoke("power.confirm", params)
    }
}

// 响应数据类

@Serializable
data class PowerActionResponse(
    val success: Boolean,
    val message: String,
    val action: String? = null,
    val delay: Int? = null,
    val requiresConfirmation: Boolean? = null,
    val confirmId: String? = null,
    val expiresIn: Long? = null
)

@Serializable
data class ScheduleResponse(
    val success: Boolean,
    val taskId: String,
    val action: String,
    val scheduledTime: String,
    val message: String
)

@Serializable
data class CancelScheduleResponse(
    val success: Boolean,
    val taskId: String,
    val message: String
)

@Serializable
data class ScheduleListResponse(
    val success: Boolean,
    val tasks: List<ScheduledTask>,
    val total: Int
)

@Serializable
data class ScheduledTask(
    val id: String,
    val action: String,
    val scheduledTime: String,
    val createdAt: String,
    val createdBy: String
)
