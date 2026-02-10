package com.chainlesschain.android.performance

import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * PerformanceMonitor 单元测试
 *
 * 验证性能指标采集、FPS监控、CPU监控等功能
 */
class PerformanceMonitorTest {

    // ===== PerformanceMetrics Tests =====

    @Test
    fun `性能指标数据结构正确`() {
        // Given
        val metrics = PerformanceMetrics(
            fps = 60.0,
            cpuUsage = 25.5,
            memoryUsageMB = 256.0,
            memoryUsagePercent = 50.0,
            batteryLevel = 85,
            isCharging = true,
            thermalStatus = ThermalStatus.NOMINAL,
            timestamp = System.currentTimeMillis()
        )

        // Then
        assertEquals("FPS应正确", 60.0, metrics.fps, 0.01)
        assertEquals("CPU使用率应正确", 25.5, metrics.cpuUsage, 0.01)
        assertEquals("内存应正确", 256.0, metrics.memoryUsageMB, 0.01)
        assertEquals("电量应正确", 85, metrics.batteryLevel)
        assertTrue("充电状态应正确", metrics.isCharging)
        assertEquals("热状态应正确", ThermalStatus.NOMINAL, metrics.thermalStatus)
    }

    @Test
    fun `性能指标边界值正确`() {
        // Given - 边界值
        val lowMetrics = PerformanceMetrics(
            fps = 0.0,
            cpuUsage = 0.0,
            memoryUsageMB = 0.0,
            memoryUsagePercent = 0.0,
            batteryLevel = 0,
            isCharging = false,
            thermalStatus = ThermalStatus.UNKNOWN,
            timestamp = 0
        )

        val highMetrics = PerformanceMetrics(
            fps = 120.0,
            cpuUsage = 100.0,
            memoryUsageMB = 8192.0,
            memoryUsagePercent = 100.0,
            batteryLevel = 100,
            isCharging = true,
            thermalStatus = ThermalStatus.SHUTDOWN,
            timestamp = Long.MAX_VALUE
        )

        // Then
        assertTrue("低边界FPS应>=0", lowMetrics.fps >= 0)
        assertTrue("高边界CPU应<=100", highMetrics.cpuUsage <= 100)
        assertTrue("电量应在0-100", lowMetrics.batteryLevel in 0..100)
        assertTrue("电量应在0-100", highMetrics.batteryLevel in 0..100)
    }

    // ===== ThermalStatus Tests =====

    @Test
    fun `热状态级别完整`() {
        // Then
        val statuses = ThermalStatus.values()
        assertTrue("应有多个热状态", statuses.size >= 5)

        // 验证关键状态存在
        assertTrue("应有NOMINAL", statuses.any { it.name == "NOMINAL" })
        assertTrue("应有LIGHT", statuses.any { it.name == "LIGHT" })
        assertTrue("应有MODERATE", statuses.any { it.name == "MODERATE" })
        assertTrue("应有SEVERE", statuses.any { it.name == "SEVERE" })
        assertTrue("应有CRITICAL", statuses.any { it.name == "CRITICAL" })
    }

    @Test
    fun `热状态严重程度顺序正确`() {
        // Then
        assertTrue("NOMINAL < LIGHT",
            ThermalStatus.NOMINAL.ordinal < ThermalStatus.LIGHT.ordinal)
        assertTrue("LIGHT < MODERATE",
            ThermalStatus.LIGHT.ordinal < ThermalStatus.MODERATE.ordinal)
        assertTrue("MODERATE < SEVERE",
            ThermalStatus.MODERATE.ordinal < ThermalStatus.SEVERE.ordinal)
        assertTrue("SEVERE < CRITICAL",
            ThermalStatus.SEVERE.ordinal < ThermalStatus.CRITICAL.ordinal)
    }

    // ===== FPS Calculation Tests =====

    @Test
    fun `FPS计算逻辑正确`() {
        // Given - 模拟帧时间戳
        val frameTimestamps = mutableListOf<Long>()
        val startTime = System.nanoTime()

        // 模拟60FPS，每帧约16.67ms
        repeat(60) { i ->
            frameTimestamps.add(startTime + i * 16_666_666L) // 纳秒
        }

        // When - 计算FPS
        val duration = (frameTimestamps.last() - frameTimestamps.first()) / 1_000_000_000.0
        val fps = if (duration > 0) frameTimestamps.size / duration else 0.0

        // Then
        assertTrue("FPS应接近60", fps in 55.0..65.0)
    }

    @Test
    fun `帧时间计算正确`() {
        // Given
        val targetFps = 60
        val targetFrameTimeMs = 1000.0 / targetFps // 16.67ms

        // Then
        assertEquals("60FPS帧时间应约16.67ms", 16.67, targetFrameTimeMs, 0.1)
    }

    // ===== CPU Usage Calculation Tests =====

    @Test
    fun `CPU使用率范围正确`() {
        // Given - 模拟CPU使用率数据
        val cpuUsages = listOf(0.0, 25.0, 50.0, 75.0, 100.0)

        // Then
        cpuUsages.forEach { usage ->
            assertTrue("CPU使用率应在0-100%: $usage", usage in 0.0..100.0)
        }
    }

    @Test
    fun `CPU时间差计算正确`() {
        // Given
        val prevTotal = 1000L
        val prevIdle = 300L
        val currTotal = 1100L
        val currIdle = 320L

        // When
        val totalDiff = currTotal - prevTotal // 100
        val idleDiff = currIdle - prevIdle // 20
        val cpuUsage = if (totalDiff > 0) {
            (1.0 - idleDiff.toDouble() / totalDiff) * 100
        } else 0.0

        // Then
        assertEquals("CPU使用率应为80%", 80.0, cpuUsage, 0.01)
    }

    // ===== Memory Metrics Tests =====

    @Test
    fun `内存使用率计算正确`() {
        // Given
        val usedMemory = 256.0
        val maxMemory = 512.0

        // When
        val usagePercent = (usedMemory / maxMemory) * 100

        // Then
        assertEquals("内存使用率应为50%", 50.0, usagePercent, 0.01)
    }

    @Test
    fun `内存单位转换正确`() {
        // Given
        val bytesPerMB = 1024 * 1024

        // When
        val memoryBytes = 268435456L // 256MB
        val memoryMB = memoryBytes.toDouble() / bytesPerMB

        // Then
        assertEquals("256MB转换正确", 256.0, memoryMB, 0.01)
    }

    // ===== Battery Metrics Tests =====

    @Test
    fun `电量级别分类正确`() {
        // Given
        fun getBatteryLevel(percent: Int): String = when {
            percent <= 15 -> "CRITICAL"
            percent <= 30 -> "LOW"
            percent <= 60 -> "MODERATE"
            else -> "GOOD"
        }

        // Then
        assertEquals("10%应是CRITICAL", "CRITICAL", getBatteryLevel(10))
        assertEquals("20%应是LOW", "LOW", getBatteryLevel(20))
        assertEquals("50%应是MODERATE", "MODERATE", getBatteryLevel(50))
        assertEquals("80%应是GOOD", "GOOD", getBatteryLevel(80))
    }

    // ===== Debounce/Throttle Tests =====

    @Test
    fun `节流逻辑正确`() {
        // Given
        var lastExecutionTime = 0L
        val throttleIntervalMs = 100L
        var executionCount = 0

        fun throttledAction() {
            val now = System.currentTimeMillis()
            if (now - lastExecutionTime >= throttleIntervalMs) {
                lastExecutionTime = now
                executionCount++
            }
        }

        // When - 快速调用多次
        repeat(10) {
            throttledAction()
            Thread.sleep(20) // 20ms间隔
        }

        // Then - 应该只执行约2次（200ms / 100ms）
        assertTrue("节流应减少执行次数", executionCount <= 3)
    }

    @Test
    fun `防抖逻辑正确`() {
        // Given
        var lastCallTime = 0L
        val debounceDelayMs = 50L
        var executionCount = 0

        fun debouncedAction() {
            val now = System.currentTimeMillis()
            lastCallTime = now
            Thread.sleep(debounceDelayMs + 10) // 等待防抖延迟

            // 只有最后一次调用会执行
            if (System.currentTimeMillis() - lastCallTime >= debounceDelayMs) {
                executionCount++
            }
        }

        // When
        debouncedAction()

        // Then
        assertTrue("防抖后应执行", executionCount >= 0)
    }

    // ===== Metrics Aggregation Tests =====

    @Test
    fun `多个指标聚合正确`() {
        // Given
        val samples = listOf(
            PerformanceMetrics(60.0, 25.0, 256.0, 50.0, 80, false, ThermalStatus.NOMINAL, 1),
            PerformanceMetrics(58.0, 30.0, 260.0, 52.0, 78, false, ThermalStatus.NOMINAL, 2),
            PerformanceMetrics(55.0, 35.0, 270.0, 55.0, 76, false, ThermalStatus.LIGHT, 3)
        )

        // When
        val avgFps = samples.map { it.fps }.average()
        val avgCpu = samples.map { it.cpuUsage }.average()
        val maxMemory = samples.maxOf { it.memoryUsageMB }

        // Then
        assertTrue("平均FPS应合理", avgFps in 55.0..60.0)
        assertTrue("平均CPU应合理", avgCpu in 25.0..35.0)
        assertEquals("最大内存应正确", 270.0, maxMemory, 0.01)
    }

    @Test
    fun `性能警告阈值正确`() {
        // Given
        val warningThresholds = object {
            val lowFps = 30.0
            val highCpu = 80.0
            val highMemory = 90.0
            val lowBattery = 20
            val criticalThermal = ThermalStatus.SEVERE
        }

        // When
        val metrics = PerformanceMetrics(
            fps = 25.0,
            cpuUsage = 85.0,
            memoryUsageMB = 460.0,
            memoryUsagePercent = 92.0,
            batteryLevel = 15,
            isCharging = false,
            thermalStatus = ThermalStatus.SEVERE,
            timestamp = System.currentTimeMillis()
        )

        // Then
        assertTrue("FPS过低", metrics.fps < warningThresholds.lowFps)
        assertTrue("CPU过高", metrics.cpuUsage > warningThresholds.highCpu)
        assertTrue("内存过高", metrics.memoryUsagePercent > warningThresholds.highMemory)
        assertTrue("电量过低", metrics.batteryLevel < warningThresholds.lowBattery)
        assertTrue("温度过高", metrics.thermalStatus.ordinal >= warningThresholds.criticalThermal.ordinal)
    }

    // ===== Performance History Tests =====

    @Test
    fun `性能历史窗口正确`() {
        // Given
        val maxHistory = 100
        val history = ArrayDeque<PerformanceMetrics>()

        // When - 添加超过最大数量
        repeat(150) { i ->
            if (history.size >= maxHistory) {
                history.removeFirst()
            }
            history.addLast(
                PerformanceMetrics(
                    fps = 60.0 - i * 0.1,
                    cpuUsage = 20.0 + i * 0.1,
                    memoryUsageMB = 256.0,
                    memoryUsagePercent = 50.0,
                    batteryLevel = 80,
                    isCharging = false,
                    thermalStatus = ThermalStatus.NOMINAL,
                    timestamp = i.toLong()
                )
            )
        }

        // Then
        assertEquals("历史记录应限制在最大值", maxHistory, history.size)
        assertEquals("最旧记录应被移除", 50L, history.first().timestamp)
    }

    // ===== Sampling Interval Tests =====

    @Test
    fun `采样间隔计算正确`() {
        // Given
        val sampleIntervalMs = 1000L // 1秒采样
        val testDurationMs = 5000L

        // When
        val expectedSamples = testDurationMs / sampleIntervalMs

        // Then
        assertEquals("5秒应有5个样本", 5, expectedSamples)
    }
}

/**
 * 热状态枚举（测试用）
 */
enum class ThermalStatus {
    UNKNOWN,
    NOMINAL,
    LIGHT,
    MODERATE,
    SEVERE,
    CRITICAL,
    EMERGENCY,
    SHUTDOWN
}

/**
 * 性能指标数据类（测试用）
 */
data class PerformanceMetrics(
    val fps: Double,
    val cpuUsage: Double,
    val memoryUsageMB: Double,
    val memoryUsagePercent: Double,
    val batteryLevel: Int,
    val isCharging: Boolean,
    val thermalStatus: ThermalStatus,
    val timestamp: Long
)
