package com.chainlesschain.android.core.ui.performance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.PowerManager
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import timber.log.Timber

/**
 * 电池优化工具
 *
 * 提供电池状态监控和智能节能策略
 */
class BatteryOptimization(context: Context) {

    private val context: Context = context.applicationContext
    private val powerManager = this.context.getSystemService(Context.POWER_SERVICE) as PowerManager
    private val batteryManager = this.context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager

    /**
     * 电池信息数据类
     */
    data class BatteryInfo(
        val level: Int,                    // 电量百分比 (0-100)
        val isCharging: Boolean,           // 是否充电中
        val chargingType: ChargingType,    // 充电类型
        val temperature: Float,            // 温度（摄氏度）
        val voltage: Int,                  // 电压（毫伏）
        val isPowerSaveMode: Boolean,      // 是否省电模式
        val batteryHealth: BatteryHealth   // 电池健康状态
    )

    /**
     * 充电类型
     */
    enum class ChargingType {
        NOT_CHARGING,   // 未充电
        USB,            // USB 充电
        AC,             // 交流电充电
        WIRELESS        // 无线充电
    }

    /**
     * 电池健康状态
     */
    enum class BatteryHealth {
        UNKNOWN,        // 未知
        GOOD,           // 良好
        OVERHEAT,       // 过热
        DEAD,           // 损坏
        OVER_VOLTAGE,   // 电压过高
        COLD            // 过冷
    }

    /**
     * 获取当前电池信息
     */
    fun getBatteryInfo(): BatteryInfo {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))

        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val batteryPct = if (level >= 0 && scale > 0) {
            (level.toFloat() / scale.toFloat() * 100).toInt()
        } else {
            0
        }

        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                        status == BatteryManager.BATTERY_STATUS_FULL

        val chargePlug = intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1) ?: -1
        val chargingType = when (chargePlug) {
            BatteryManager.BATTERY_PLUGGED_USB -> ChargingType.USB
            BatteryManager.BATTERY_PLUGGED_AC -> ChargingType.AC
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> ChargingType.WIRELESS
            else -> ChargingType.NOT_CHARGING
        }

        val temperature = (intent?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, -1) ?: -1) / 10f
        val voltage = intent?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) ?: -1

        val health = intent?.getIntExtra(BatteryManager.EXTRA_HEALTH, -1) ?: -1
        val batteryHealth = when (health) {
            BatteryManager.BATTERY_HEALTH_GOOD -> BatteryHealth.GOOD
            BatteryManager.BATTERY_HEALTH_OVERHEAT -> BatteryHealth.OVERHEAT
            BatteryManager.BATTERY_HEALTH_DEAD -> BatteryHealth.DEAD
            BatteryManager.BATTERY_HEALTH_OVER_VOLTAGE -> BatteryHealth.OVER_VOLTAGE
            BatteryManager.BATTERY_HEALTH_COLD -> BatteryHealth.COLD
            else -> BatteryHealth.UNKNOWN
        }

        val isPowerSaveMode = powerManager.isPowerSaveMode

        return BatteryInfo(
            level = batteryPct,
            isCharging = isCharging,
            chargingType = chargingType,
            temperature = temperature,
            voltage = voltage,
            isPowerSaveMode = isPowerSaveMode,
            batteryHealth = batteryHealth
        )
    }

    /**
     * 监控电池状态变化
     */
    fun monitorBatteryStatus(): Flow<BatteryInfo> = callbackFlow {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val batteryInfo = getBatteryInfo()
                trySend(batteryInfo)

                // 电量低警告
                if (batteryInfo.level <= 15 && !batteryInfo.isCharging) {
                    Timber.w("Low battery: ${batteryInfo.level}%")
                }

                // 温度过高警告
                if (batteryInfo.temperature >= 45f) {
                    Timber.w("Battery overheating: ${batteryInfo.temperature}°C")
                }
            }
        }

        val intentFilter = IntentFilter().apply {
            addAction(Intent.ACTION_BATTERY_CHANGED)
            addAction(Intent.ACTION_BATTERY_LOW)
            addAction(Intent.ACTION_BATTERY_OKAY)
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
        }

        context.registerReceiver(receiver, intentFilter)

        // 发送初始状态
        trySend(getBatteryInfo())

        awaitClose {
            context.unregisterReceiver(receiver)
        }
    }

    /**
     * 是否应该启用节能模式
     */
    fun shouldEnablePowerSaving(): Boolean {
        val batteryInfo = getBatteryInfo()
        return when {
            // 系统已开启省电模式
            batteryInfo.isPowerSaveMode -> true
            // 电量低于 20% 且未充电
            batteryInfo.level <= 20 && !batteryInfo.isCharging -> true
            // 温度过高
            batteryInfo.temperature >= 45f -> true
            else -> false
        }
    }

    /**
     * 节能策略配置
     */
    data class PowerSavingConfig(
        val reduceAnimations: Boolean = true,      // 减少动画
        val reduceBackgroundWork: Boolean = true,  // 减少后台任务
        val lowerRefreshRate: Boolean = true,      // 降低刷新频率
        val disableHaptics: Boolean = true,        // 禁用震动反馈
        val dimScreen: Boolean = false             // 降低屏幕亮度（需要用户权限）
    )

    /**
     * 获取推荐的节能配置
     */
    fun getRecommendedPowerSavingConfig(): PowerSavingConfig {
        val batteryInfo = getBatteryInfo()

        return when {
            // 极低电量（<10%）：激进节能
            batteryInfo.level <= 10 && !batteryInfo.isCharging -> {
                PowerSavingConfig(
                    reduceAnimations = true,
                    reduceBackgroundWork = true,
                    lowerRefreshRate = true,
                    disableHaptics = true,
                    dimScreen = true
                )
            }
            // 低电量（10-20%）：中度节能
            batteryInfo.level <= 20 && !batteryInfo.isCharging -> {
                PowerSavingConfig(
                    reduceAnimations = true,
                    reduceBackgroundWork = true,
                    lowerRefreshRate = true,
                    disableHaptics = false,
                    dimScreen = false
                )
            }
            // 系统省电模式：跟随系统
            batteryInfo.isPowerSaveMode -> {
                PowerSavingConfig(
                    reduceAnimations = true,
                    reduceBackgroundWork = true,
                    lowerRefreshRate = false,
                    disableHaptics = false,
                    dimScreen = false
                )
            }
            // 正常模式
            else -> {
                PowerSavingConfig(
                    reduceAnimations = false,
                    reduceBackgroundWork = false,
                    lowerRefreshRate = false,
                    disableHaptics = false,
                    dimScreen = false
                )
            }
        }
    }

    /**
     * 打印电池状态快照
     */
    fun logBatterySnapshot() {
        val batteryInfo = getBatteryInfo()
        Timber.d(
            """
            Battery Snapshot:
            - Level: ${batteryInfo.level}%
            - Charging: ${batteryInfo.isCharging} (${batteryInfo.chargingType})
            - Temperature: ${batteryInfo.temperature}°C
            - Voltage: ${batteryInfo.voltage} mV
            - Power Save Mode: ${batteryInfo.isPowerSaveMode}
            - Health: ${batteryInfo.batteryHealth}
            """.trimIndent()
        )
    }
}

/**
 * Compose 电池监控 Hook
 *
 * 用法：
 * ```kotlin
 * @Composable
 * fun MyScreen() {
 *     val batteryInfo by rememberBatteryMonitor()
 *     if (batteryInfo.level <= 20) {
 *         // 启用节能模式
 *     }
 * }
 * ```
 */
@androidx.compose.runtime.Composable
fun rememberBatteryMonitor(): androidx.compose.runtime.State<BatteryOptimization.BatteryInfo> {
    val context = androidx.compose.ui.platform.LocalContext.current
    val batteryOptimization = androidx.compose.runtime.remember { BatteryOptimization(context) }

    return androidx.compose.runtime.produceState(
        initialValue = batteryOptimization.getBatteryInfo()
    ) {
        batteryOptimization.monitorBatteryStatus().collect { batteryInfo ->
            value = batteryInfo
        }
    }
}

/**
 * Compose 节能配置 Hook
 *
 * 用法：
 * ```kotlin
 * @Composable
 * fun MyScreen() {
 *     val powerSavingConfig by rememberPowerSavingConfig()
 *     AnimatedContent(
 *         transitionSpec = {
 *             if (powerSavingConfig.reduceAnimations) {
 *                 fadeIn() with fadeOut()  // 简单动画
 *             } else {
 *                 slideInHorizontally() with slideOutHorizontally()  // 完整动画
 *             }
 *         }
 *     ) { /* content */ }
 * }
 * ```
 */
@androidx.compose.runtime.Composable
fun rememberPowerSavingConfig(): androidx.compose.runtime.State<BatteryOptimization.PowerSavingConfig> {
    val context = androidx.compose.ui.platform.LocalContext.current
    val batteryOptimization = androidx.compose.runtime.remember { BatteryOptimization(context) }

    return androidx.compose.runtime.produceState(
        initialValue = batteryOptimization.getRecommendedPowerSavingConfig()
    ) {
        batteryOptimization.monitorBatteryStatus().collect { _ ->
            value = batteryOptimization.getRecommendedPowerSavingConfig()
        }
    }
}
