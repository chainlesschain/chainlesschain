package com.chainlesschain.android.remote.p2p

import com.chainlesschain.android.R
import com.chainlesschain.android.remote.data.MessageTypes
import com.chainlesschain.android.remote.data.P2PMessage
import com.chainlesschain.android.remote.data.toJsonString
import com.chainlesschain.android.remote.webrtc.WebRTCClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 设备活动跟踪管理器
 *
 * 功能：
 * - 记录设备最后活动时间
 * - 定期上报活动信息到 PC 端
 * - 检测长期无活动的设备（提醒用户）
 *
 * 与 PC 端配合：
 * - PC 端会跟踪 last_activity 字段
 * - 7 天无活动会自动降级权限到 PUBLIC
 */
@Singleton
class DeviceActivityManager @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val webRTCClient: WebRTCClient
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var activityReportJob: Job? = null

    companion object {
        private const val ACTIVITY_REPORT_INTERVAL = 5 * 60 * 1000L  // 5 分钟上报一次
        private const val INACTIVITY_WARNING_DAYS = 5  // 5 天无活动警告
        private const val INACTIVITY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000L  // 7 天（与 PC 端一致）
    }

    // 活动统计 (accessed from multiple coroutines)
    @Volatile
    private var lastActivityTime = System.currentTimeMillis()
    @Volatile
    private var activityCount = 0
    @Volatile
    private var commandCount = 0
    @Volatile
    private var sessionStartTime = System.currentTimeMillis()

    // 连接状态监听
    @Volatile
    private var isConnected = false

    /**
     * 初始化活动追踪
     */
    fun initialize() {
        Timber.d("[DeviceActivityManager] 初始化设备活动追踪")
        sessionStartTime = System.currentTimeMillis()
        lastActivityTime = System.currentTimeMillis()
    }

    /**
     * 设置连接状态
     */
    fun setConnected(connected: Boolean) {
        isConnected = connected
        if (connected) {
            startActivityReporting()
        } else {
            stopActivityReporting()
        }
    }

    /**
     * 记录活动（每次执行命令时调用）
     *
     * @param activityType 活动类型（如 "command_executed", "file_transfer" 等）
     */
    fun recordActivity(activityType: String = "command_executed") {
        lastActivityTime = System.currentTimeMillis()
        activityCount++

        if (activityType == "command_executed") {
            commandCount++
        }

        Timber.v("[DeviceActivityManager] 记录活动: $activityType (总计: $activityCount)")
    }

    /**
     * 启动活动定期上报
     */
    private fun startActivityReporting() {
        activityReportJob?.cancel()
        activityReportJob = scope.launch {
            // 立即上报一次
            reportActivity()

            while (isActive && isConnected) {
                try {
                    delay(ACTIVITY_REPORT_INTERVAL)
                    reportActivity()
                } catch (e: Exception) {
                    Timber.w(e, "[DeviceActivityManager] 活动上报异常")
                }
            }
        }
        Timber.d("[DeviceActivityManager] 活动上报已启动 (间隔: ${ACTIVITY_REPORT_INTERVAL / 1000}s)")
    }

    /**
     * 停止活动上报
     */
    private fun stopActivityReporting() {
        activityReportJob?.cancel()
        activityReportJob = null
        Timber.d("[DeviceActivityManager] 活动上报已停止")
    }

    /**
     * 上报活动信息到 PC 端
     */
    private suspend fun reportActivity() {
        try {
            val now = System.currentTimeMillis()
            val inactivityDays = (now - lastActivityTime) / (24 * 60 * 60 * 1000)

            val activityPayload = mapOf(
                "timestamp" to now,
                "lastActivityTime" to lastActivityTime,
                "activityCount" to activityCount,
                "commandCount" to commandCount,
                "sessionDuration" to (now - sessionStartTime),
                "inactivityDays" to inactivityDays
            )

            val message = P2PMessage(
                type = MessageTypes.EVENT_NOTIFICATION,
                payload = mapOf(
                    "jsonrpc" to "2.0",
                    "method" to "device.reportActivity",
                    "params" to activityPayload
                ).toJsonString()
            )

            webRTCClient.sendMessage(message.toJsonString())
            Timber.d("[DeviceActivityManager] 已上报活动: count=$activityCount, commands=$commandCount")
        } catch (e: Exception) {
            Timber.w(e, "[DeviceActivityManager] 活动上报失败")
        }
    }

    /**
     * 获取活动统计
     */
    fun getActivityStats(): ActivityStats {
        val now = System.currentTimeMillis()
        val inactivityMs = now - lastActivityTime
        val inactivityDays = inactivityMs / (24 * 60 * 60 * 1000)

        return ActivityStats(
            lastActivityTime = lastActivityTime,
            activityCount = activityCount,
            commandCount = commandCount,
            sessionDuration = now - sessionStartTime,
            inactivityDays = inactivityDays.toInt(),
            isHealthy = inactivityMs < INACTIVITY_THRESHOLD_MS,
            warningLevel = when {
                inactivityDays >= INACTIVITY_WARNING_DAYS -> WarningLevel.HIGH
                inactivityDays >= 3 -> WarningLevel.MEDIUM
                else -> WarningLevel.NONE
            }
        )
    }

    /**
     * 检查是否需要警告用户
     */
    fun checkInactivityWarning(): InactivityWarning? {
        val stats = getActivityStats()

        return when (stats.warningLevel) {
            WarningLevel.HIGH -> InactivityWarning(
                level = WarningLevel.HIGH,
                message = context.getString(R.string.device_inactivity_warning, stats.inactivityDays),
                daysRemaining = 7 - stats.inactivityDays
            )
            WarningLevel.MEDIUM -> InactivityWarning(
                level = WarningLevel.MEDIUM,
                message = context.getString(R.string.device_inactivity_notice, stats.inactivityDays),
                daysRemaining = 7 - stats.inactivityDays
            )
            else -> null
        }
    }

    /**
     * 重置活动计数（新会话时调用）
     */
    fun resetSession() {
        sessionStartTime = System.currentTimeMillis()
        commandCount = 0
        Timber.d("[DeviceActivityManager] 会话已重置")
    }

    /**
     * 停止活动追踪
     */
    fun stop() {
        stopActivityReporting()
        Timber.d("[DeviceActivityManager] 已停止活动追踪")
    }
}

/**
 * 活动统计信息
 */
data class ActivityStats(
    val lastActivityTime: Long,
    val activityCount: Int,
    val commandCount: Int,
    val sessionDuration: Long,
    val inactivityDays: Int,
    val isHealthy: Boolean,
    val warningLevel: WarningLevel
)

/**
 * 警告级别
 */
enum class WarningLevel {
    NONE,    // 无警告
    MEDIUM,  // 中等警告（3-5 天无活动）
    HIGH     // 高警告（5-7 天无活动）
}

/**
 * 不活跃警告
 */
data class InactivityWarning(
    val level: WarningLevel,
    val message: String,
    val daysRemaining: Int
)
