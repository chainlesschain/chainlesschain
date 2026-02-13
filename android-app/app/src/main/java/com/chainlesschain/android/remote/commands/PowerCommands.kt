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

    // ==================== 电池状态 ====================

    /**
     * 获取电池状态
     */
    suspend fun getBatteryStatus(): Result<BatteryStatusResponse> {
        return client.invoke("power.getBatteryStatus", emptyMap())
    }

    /**
     * 获取电池历史
     *
     * @param duration 时间范围（小时）
     */
    suspend fun getBatteryHistory(duration: Int = 24): Result<BatteryHistoryResponse> {
        return client.invoke("power.getBatteryHistory", mapOf("duration" to duration))
    }

    /**
     * 获取电池健康报告
     */
    suspend fun getBatteryHealth(): Result<BatteryHealthResponse> {
        return client.invoke("power.getBatteryHealth", emptyMap())
    }

    // ==================== 电源计划 ====================

    /**
     * 获取电源计划列表
     */
    suspend fun getPowerPlans(): Result<PowerPlansResponse> {
        return client.invoke("power.getPowerPlans", emptyMap())
    }

    /**
     * 设置当前电源计划
     *
     * @param planId 计划 ID
     */
    suspend fun setPowerPlan(planId: String): Result<SetPowerPlanResponse> {
        return client.invoke("power.setPowerPlan", mapOf("planId" to planId))
    }

    /**
     * 获取当前电源计划
     */
    suspend fun getCurrentPowerPlan(): Result<CurrentPowerPlanResponse> {
        return client.invoke("power.getCurrentPowerPlan", emptyMap())
    }

    /**
     * 获取电源计划设置
     *
     * @param planId 计划 ID
     */
    suspend fun getPowerPlanSettings(planId: String): Result<PowerPlanSettingsResponse> {
        return client.invoke("power.getPowerPlanSettings", mapOf("planId" to planId))
    }

    /**
     * 修改电源计划设置
     *
     * @param planId 计划 ID
     * @param settings 设置键值对
     */
    suspend fun updatePowerPlanSettings(
        planId: String,
        settings: Map<String, Any>
    ): Result<UpdatePowerPlanResponse> {
        return client.invoke("power.updatePowerPlanSettings", mapOf(
            "planId" to planId,
            "settings" to settings
        ))
    }

    // ==================== 屏幕控制 ====================

    /**
     * 获取屏幕亮度
     */
    suspend fun getBrightness(): Result<BrightnessResponse> {
        return client.invoke("power.getBrightness", emptyMap())
    }

    /**
     * 设置屏幕亮度
     *
     * @param level 亮度级别 (0-100)
     */
    suspend fun setBrightness(level: Int): Result<SetBrightnessResponse> {
        return client.invoke("power.setBrightness", mapOf("level" to level))
    }

    /**
     * 关闭显示器
     */
    suspend fun turnOffDisplay(): Result<DisplayPowerResponse> {
        return client.invoke("power.turnOffDisplay", emptyMap())
    }

    /**
     * 打开显示器
     */
    suspend fun turnOnDisplay(): Result<DisplayPowerResponse> {
        return client.invoke("power.turnOnDisplay", emptyMap())
    }

    /**
     * 设置屏幕超时时间
     *
     * @param minutes 分钟数（0 表示永不关闭）
     * @param onBattery 电池模式设置
     * @param pluggedIn 插电模式设置
     */
    suspend fun setDisplayTimeout(
        minutes: Int? = null,
        onBattery: Int? = null,
        pluggedIn: Int? = null
    ): Result<SetTimeoutResponse> {
        val params = mutableMapOf<String, Any>()
        minutes?.let { params["minutes"] = it }
        onBattery?.let { params["onBattery"] = it }
        pluggedIn?.let { params["pluggedIn"] = it }
        return client.invoke("power.setDisplayTimeout", params)
    }

    /**
     * 设置睡眠超时时间
     *
     * @param minutes 分钟数（0 表示永不睡眠）
     * @param onBattery 电池模式设置
     * @param pluggedIn 插电模式设置
     */
    suspend fun setSleepTimeout(
        minutes: Int? = null,
        onBattery: Int? = null,
        pluggedIn: Int? = null
    ): Result<SetTimeoutResponse> {
        val params = mutableMapOf<String, Any>()
        minutes?.let { params["minutes"] = it }
        onBattery?.let { params["onBattery"] = it }
        pluggedIn?.let { params["pluggedIn"] = it }
        return client.invoke("power.setSleepTimeout", params)
    }

    // ==================== 唤醒计时器 ====================

    /**
     * 设置唤醒计时器
     *
     * @param time ISO 8601 时间
     * @param action 唤醒后执行的操作 (none, command, app)
     * @param command 要执行的命令（如果 action 是 command）
     */
    suspend fun setWakeTimer(
        time: String,
        action: String = "none",
        command: String? = null
    ): Result<WakeTimerResponse> {
        val params = mutableMapOf<String, Any>(
            "time" to time,
            "action" to action
        )
        command?.let { params["command"] = it }
        return client.invoke("power.setWakeTimer", params)
    }

    /**
     * 取消唤醒计时器
     *
     * @param timerId 计时器 ID
     */
    suspend fun cancelWakeTimer(timerId: String): Result<CancelWakeTimerResponse> {
        return client.invoke("power.cancelWakeTimer", mapOf("timerId" to timerId))
    }

    /**
     * 获取唤醒计时器列表
     */
    suspend fun getWakeTimers(): Result<WakeTimersResponse> {
        return client.invoke("power.getWakeTimers", emptyMap())
    }

    // ==================== UPS 状态 ====================

    /**
     * 获取 UPS 状态
     */
    suspend fun getUpsStatus(): Result<UpsStatusResponse> {
        return client.invoke("power.getUpsStatus", emptyMap())
    }

    // ==================== 节能设置 ====================

    /**
     * 获取节能设置
     */
    suspend fun getPowerSavingSettings(): Result<PowerSavingSettingsResponse> {
        return client.invoke("power.getPowerSavingSettings", emptyMap())
    }

    /**
     * 设置节能模式
     *
     * @param enabled 是否启用
     */
    suspend fun setPowerSavingMode(enabled: Boolean): Result<SetPowerSavingResponse> {
        return client.invoke("power.setPowerSavingMode", mapOf("enabled" to enabled))
    }

    /**
     * 阻止睡眠
     *
     * @param reason 原因
     * @param duration 持续时间（秒，0 表示无限）
     */
    suspend fun preventSleep(
        reason: String = "User requested",
        duration: Int = 0
    ): Result<PreventSleepResponse> {
        return client.invoke("power.preventSleep", mapOf(
            "reason" to reason,
            "duration" to duration
        ))
    }

    /**
     * 允许睡眠
     *
     * @param preventId 阻止 ID
     */
    suspend fun allowSleep(preventId: String): Result<AllowSleepResponse> {
        return client.invoke("power.allowSleep", mapOf("preventId" to preventId))
    }

    /**
     * 获取睡眠阻止列表
     */
    suspend fun getSleepPreventions(): Result<SleepPreventionsResponse> {
        return client.invoke("power.getSleepPreventions", emptyMap())
    }

    // ==================== 电源事件 ====================

    /**
     * 获取电源事件历史
     *
     * @param limit 数量
     */
    suspend fun getPowerEvents(limit: Int = 50): Result<PowerEventsResponse> {
        return client.invoke("power.getPowerEvents", mapOf("limit" to limit))
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

// ==================== 电池响应 ====================

@Serializable
data class BatteryStatusResponse(
    val success: Boolean,
    val hasBattery: Boolean,
    val level: Int? = null,
    val isCharging: Boolean? = null,
    val isPluggedIn: Boolean? = null,
    val powerSource: String? = null,  // "battery", "ac", "ups"
    val timeRemaining: Int? = null,  // minutes
    val timeToFullCharge: Int? = null,  // minutes
    val cycleCount: Int? = null,
    val voltage: Double? = null,
    val wattage: Double? = null
)

@Serializable
data class BatteryHistoryResponse(
    val success: Boolean,
    val history: List<BatteryDataPoint>,
    val duration: Int
)

@Serializable
data class BatteryDataPoint(
    val timestamp: Long,
    val level: Int,
    val isCharging: Boolean,
    val powerSource: String
)

@Serializable
data class BatteryHealthResponse(
    val success: Boolean,
    val health: String,  // "good", "fair", "poor"
    val designCapacity: Int? = null,  // mWh
    val fullChargeCapacity: Int? = null,  // mWh
    val healthPercent: Double? = null,
    val cycleCount: Int? = null,
    val manufactureDate: String? = null,
    val recommendations: List<String>? = null
)

// ==================== 电源计划响应 ====================

@Serializable
data class PowerPlansResponse(
    val success: Boolean,
    val plans: List<PowerPlan>,
    val activePlanId: String
)

@Serializable
data class PowerPlan(
    val id: String,
    val name: String,
    val description: String? = null,
    val isActive: Boolean,
    val isCustom: Boolean = false
)

@Serializable
data class SetPowerPlanResponse(
    val success: Boolean,
    val planId: String,
    val planName: String,
    val message: String
)

@Serializable
data class CurrentPowerPlanResponse(
    val success: Boolean,
    val planId: String,
    val planName: String,
    val description: String? = null
)

@Serializable
data class PowerPlanSettingsResponse(
    val success: Boolean,
    val planId: String,
    val settings: PowerPlanSettings
)

@Serializable
data class PowerPlanSettings(
    val displayTimeoutAc: Int,  // minutes
    val displayTimeoutBattery: Int,
    val sleepTimeoutAc: Int,
    val sleepTimeoutBattery: Int,
    val hibernateTimeoutAc: Int? = null,
    val hibernateTimeoutBattery: Int? = null,
    val cpuMinAc: Int? = null,
    val cpuMaxAc: Int? = null,
    val cpuMinBattery: Int? = null,
    val cpuMaxBattery: Int? = null
)

@Serializable
data class UpdatePowerPlanResponse(
    val success: Boolean,
    val planId: String,
    val updatedSettings: Int,
    val message: String
)

// ==================== 屏幕响应 ====================

@Serializable
data class BrightnessResponse(
    val success: Boolean,
    val level: Int,
    val isAutomatic: Boolean? = null
)

@Serializable
data class SetBrightnessResponse(
    val success: Boolean,
    val level: Int,
    val message: String
)

@Serializable
data class DisplayPowerResponse(
    val success: Boolean,
    val displayOn: Boolean,
    val message: String
)

@Serializable
data class SetTimeoutResponse(
    val success: Boolean,
    val timeoutType: String,
    val onBattery: Int? = null,
    val pluggedIn: Int? = null,
    val message: String
)

// ==================== 唤醒计时器响应 ====================

@Serializable
data class WakeTimerResponse(
    val success: Boolean,
    val timerId: String,
    val scheduledTime: String,
    val action: String,
    val message: String
)

@Serializable
data class CancelWakeTimerResponse(
    val success: Boolean,
    val timerId: String,
    val message: String
)

@Serializable
data class WakeTimersResponse(
    val success: Boolean,
    val timers: List<WakeTimer>,
    val total: Int
)

@Serializable
data class WakeTimer(
    val id: String,
    val scheduledTime: String,
    val action: String,
    val command: String? = null,
    val createdAt: String
)

// ==================== UPS 响应 ====================

@Serializable
data class UpsStatusResponse(
    val success: Boolean,
    val hasUps: Boolean,
    val status: String? = null,  // "online", "on_battery", "low_battery"
    val batteryLevel: Int? = null,
    val runtimeRemaining: Int? = null,  // minutes
    val load: Int? = null,  // percent
    val model: String? = null,
    val manufacturer: String? = null
)

// ==================== 节能响应 ====================

@Serializable
data class PowerSavingSettingsResponse(
    val success: Boolean,
    val powerSavingEnabled: Boolean,
    val lowBatteryThreshold: Int,
    val criticalBatteryThreshold: Int,
    val lowBatteryAction: String,
    val criticalBatteryAction: String
)

@Serializable
data class SetPowerSavingResponse(
    val success: Boolean,
    val enabled: Boolean,
    val message: String
)

@Serializable
data class PreventSleepResponse(
    val success: Boolean,
    val preventId: String,
    val reason: String,
    val duration: Int,
    val expiresAt: Long? = null
)

@Serializable
data class AllowSleepResponse(
    val success: Boolean,
    val preventId: String,
    val message: String
)

@Serializable
data class SleepPreventionsResponse(
    val success: Boolean,
    val preventions: List<SleepPrevention>,
    val total: Int
)

@Serializable
data class SleepPrevention(
    val id: String,
    val reason: String,
    val createdAt: Long,
    val expiresAt: Long? = null,
    val source: String? = null
)

// ==================== 电源事件响应 ====================

@Serializable
data class PowerEventsResponse(
    val success: Boolean,
    val events: List<PowerEvent>,
    val total: Int
)

@Serializable
data class PowerEvent(
    val timestamp: Long,
    val type: String,  // "sleep", "wake", "shutdown", "hibernate", "ac_connected", "ac_disconnected"
    val source: String? = null,
    val details: String? = null
)
