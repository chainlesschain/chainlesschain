package com.chainlesschain.android.core.p2p.monitor

import timber.log.Timber
import com.chainlesschain.android.core.p2p.config.P2PFeatureFlags
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentLinkedQueue
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 连接质量监控器
 *
 * 基于心跳和消息统计计算连接质量指标：
 * - RTT（往返时间）
 * - 丢包率
 * - 抖动（Jitter）
 *
 * 根据质量自适应调整超时和分片大小
 */
@Singleton
class ConnectionQualityMonitor @Inject constructor() {

    companion object {
        /** 采样窗口大小 */
        private const val SAMPLE_WINDOW_SIZE = 50

        /** 更新间隔（毫秒） */
        private const val UPDATE_INTERVAL_MS = 5_000L

        /** RTT 阈值 - 优秀 (ms) */
        private const val RTT_EXCELLENT_MS = 50L

        /** RTT 阈值 - 良好 (ms) */
        private const val RTT_GOOD_MS = 150L

        /** RTT 阈值 - 一般 (ms) */
        private const val RTT_FAIR_MS = 300L

        /** 丢包率阈值 - 优秀 (%) */
        private const val LOSS_EXCELLENT_PERCENT = 0.5

        /** 丢包率阈值 - 良好 (%) */
        private const val LOSS_GOOD_PERCENT = 2.0

        /** 丢包率阈值 - 一般 (%) */
        private const val LOSS_FAIR_PERCENT = 5.0
    }

    // 协程作用域
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // RTT 样本
    private val rttSamples = ConcurrentLinkedQueue<Long>()

    // 丢包统计
    private var messagesSent = 0L
    private var messagesAcked = 0L
    private var messagesLost = 0L

    // 心跳统计
    private var heartbeatsSent = 0
    private var heartbeatsReceived = 0
    private var lastHeartbeatRtt = 0L

    // 连接质量状态
    private val _connectionQuality = MutableStateFlow(ConnectionQuality())
    val connectionQuality: StateFlow<ConnectionQuality> = _connectionQuality.asStateFlow()

    // 更新任务
    private var updateJob: Job? = null

    /**
     * 启动监控
     */
    fun start() {
        if (!P2PFeatureFlags.enableQualityMonitor) {
            Timber.d("Quality monitor disabled by feature flag")
            return
        }

        stop()

        updateJob = scope.launch {
            Timber.i("Connection quality monitor started")

            while (isActive) {
                delay(UPDATE_INTERVAL_MS)
                updateQuality()
            }
        }
    }

    /**
     * 停止监控
     */
    fun stop() {
        updateJob?.cancel()
        updateJob = null
    }

    /**
     * 记录心跳发送
     */
    fun recordHeartbeatSent() {
        heartbeatsSent++
    }

    /**
     * 记录心跳响应
     *
     * @param rttMs 往返时间（毫秒）
     */
    fun recordHeartbeatResponse(rttMs: Long) {
        heartbeatsReceived++
        lastHeartbeatRtt = rttMs

        // 添加 RTT 样本
        addRttSample(rttMs)
    }

    /**
     * 记录消息发送
     */
    fun recordMessageSent() {
        messagesSent++
    }

    /**
     * 记录消息确认
     *
     * @param rttMs 消息往返时间（可选）
     */
    fun recordMessageAcked(rttMs: Long? = null) {
        messagesAcked++
        rttMs?.let { addRttSample(it) }
    }

    /**
     * 记录消息丢失
     */
    fun recordMessageLost() {
        messagesLost++
    }

    /**
     * 添加 RTT 样本
     */
    private fun addRttSample(rttMs: Long) {
        rttSamples.offer(rttMs)

        // 保持样本窗口大小
        while (rttSamples.size > SAMPLE_WINDOW_SIZE) {
            rttSamples.poll()
        }
    }

    /**
     * 更新连接质量
     */
    private fun updateQuality() {
        val rttList = rttSamples.toList()

        // 计算 RTT 统计
        val avgRtt = if (rttList.isNotEmpty()) {
            rttList.average().toLong()
        } else {
            0L
        }

        val minRtt = rttList.minOrNull() ?: 0L
        val maxRtt = rttList.maxOrNull() ?: 0L

        // 计算抖动（RTT 变化的标准差）
        val jitter = if (rttList.size >= 2) {
            val mean = rttList.average()
            val variance = rttList.map { (it - mean) * (it - mean) }.average()
            kotlin.math.sqrt(variance).toLong()
        } else {
            0L
        }

        // 计算丢包率
        val lossRate = if (messagesSent > 0) {
            (messagesLost.toDouble() / messagesSent * 100)
        } else {
            0.0
        }

        // 计算心跳丢失率
        val heartbeatLossRate = if (heartbeatsSent > 0) {
            ((heartbeatsSent - heartbeatsReceived).toDouble() / heartbeatsSent * 100)
        } else {
            0.0
        }

        // 确定质量等级
        val level = determineQualityLevel(avgRtt, lossRate)

        // 计算自适应参数
        val adaptiveParams = calculateAdaptiveParameters(level, avgRtt, jitter)

        val quality = ConnectionQuality(
            level = level,
            averageRttMs = avgRtt,
            minRttMs = minRtt,
            maxRttMs = maxRtt,
            jitterMs = jitter,
            packetLossPercent = lossRate,
            heartbeatLossPercent = heartbeatLossRate,
            messagesSent = messagesSent,
            messagesAcked = messagesAcked,
            messagesLost = messagesLost,
            adaptiveTimeoutMs = adaptiveParams.timeoutMs,
            adaptiveFragmentSize = adaptiveParams.fragmentSize
        )

        _connectionQuality.value = quality

        Timber.d("Quality updated: $level (RTT: ${avgRtt}ms, Loss: ${String.format("%.2f", lossRate)}%)")
    }

    /**
     * 确定质量等级
     */
    private fun determineQualityLevel(avgRtt: Long, lossRate: Double): QualityLevel {
        return when {
            avgRtt <= RTT_EXCELLENT_MS && lossRate <= LOSS_EXCELLENT_PERCENT -> QualityLevel.EXCELLENT
            avgRtt <= RTT_GOOD_MS && lossRate <= LOSS_GOOD_PERCENT -> QualityLevel.GOOD
            avgRtt <= RTT_FAIR_MS && lossRate <= LOSS_FAIR_PERCENT -> QualityLevel.FAIR
            else -> QualityLevel.POOR
        }
    }

    /**
     * 计算自适应参数
     */
    private fun calculateAdaptiveParameters(
        level: QualityLevel,
        avgRtt: Long,
        jitter: Long
    ): AdaptiveParams {
        // 基于质量等级和 RTT 调整超时和分片大小
        return when (level) {
            QualityLevel.EXCELLENT -> AdaptiveParams(
                timeoutMs = maxOf(5000L, avgRtt * 4 + jitter * 2),
                fragmentSize = 64 * 1024 // 64KB
            )
            QualityLevel.GOOD -> AdaptiveParams(
                timeoutMs = maxOf(10000L, avgRtt * 5 + jitter * 3),
                fragmentSize = 32 * 1024 // 32KB
            )
            QualityLevel.FAIR -> AdaptiveParams(
                timeoutMs = maxOf(15000L, avgRtt * 6 + jitter * 4),
                fragmentSize = 16 * 1024 // 16KB
            )
            QualityLevel.POOR -> AdaptiveParams(
                timeoutMs = maxOf(30000L, avgRtt * 8 + jitter * 5),
                fragmentSize = 8 * 1024 // 8KB
            )
        }
    }

    /**
     * 获取推荐的超时时间
     */
    fun getRecommendedTimeout(): Long {
        return _connectionQuality.value.adaptiveTimeoutMs
    }

    /**
     * 获取推荐的分片大小
     */
    fun getRecommendedFragmentSize(): Int {
        return _connectionQuality.value.adaptiveFragmentSize
    }

    /**
     * 重置统计
     */
    fun reset() {
        rttSamples.clear()
        messagesSent = 0
        messagesAcked = 0
        messagesLost = 0
        heartbeatsSent = 0
        heartbeatsReceived = 0
        lastHeartbeatRtt = 0
        _connectionQuality.value = ConnectionQuality()
    }

    /**
     * 释放资源
     */
    fun release() {
        stop()
        reset()
        scope.cancel()
    }
}

/**
 * 连接质量等级
 */
enum class QualityLevel {
    /** 优秀 - RTT < 50ms, 丢包 < 0.5% */
    EXCELLENT,

    /** 良好 - RTT < 150ms, 丢包 < 2% */
    GOOD,

    /** 一般 - RTT < 300ms, 丢包 < 5% */
    FAIR,

    /** 较差 - RTT > 300ms 或 丢包 > 5% */
    POOR
}

/**
 * 连接质量数据
 */
data class ConnectionQuality(
    /** 质量等级 */
    val level: QualityLevel = QualityLevel.GOOD,

    /** 平均 RTT（毫秒） */
    val averageRttMs: Long = 0,

    /** 最小 RTT（毫秒） */
    val minRttMs: Long = 0,

    /** 最大 RTT（毫秒） */
    val maxRttMs: Long = 0,

    /** 抖动（毫秒） */
    val jitterMs: Long = 0,

    /** 丢包率（百分比） */
    val packetLossPercent: Double = 0.0,

    /** 心跳丢失率（百分比） */
    val heartbeatLossPercent: Double = 0.0,

    /** 已发送消息数 */
    val messagesSent: Long = 0,

    /** 已确认消息数 */
    val messagesAcked: Long = 0,

    /** 丢失消息数 */
    val messagesLost: Long = 0,

    /** 自适应超时时间（毫秒） */
    val adaptiveTimeoutMs: Long = 10_000,

    /** 自适应分片大小（字节） */
    val adaptiveFragmentSize: Int = 64 * 1024
)

/**
 * 自适应参数
 */
private data class AdaptiveParams(
    val timeoutMs: Long,
    val fragmentSize: Int
)
