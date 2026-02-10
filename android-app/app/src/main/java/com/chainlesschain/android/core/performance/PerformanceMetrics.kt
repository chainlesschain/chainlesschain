package com.chainlesschain.android.core.performance

/**
 * Performance Metrics
 *
 * Data class containing comprehensive performance measurements.
 */
data class PerformanceMetrics(
    /**
     * Current frames per second
     */
    val fps: Float = 0f,

    /**
     * Average frame time in milliseconds
     */
    val frameTimeMs: Float = 0f,

    /**
     * Number of dropped frames
     */
    val droppedFrames: Int = 0,

    /**
     * CPU usage percentage (0-100)
     */
    val cpuUsage: Float = 0f,

    /**
     * Memory usage in MB
     */
    val memoryUsageMB: Float = 0f,

    /**
     * Max available memory in MB
     */
    val maxMemoryMB: Float = 0f,

    /**
     * Battery level percentage (0-100)
     */
    val batteryLevel: Int = 100,

    /**
     * Whether device is charging
     */
    val isCharging: Boolean = false,

    /**
     * Thermal state (0-4, higher is hotter)
     */
    val thermalState: Int = 0,

    /**
     * Measurement timestamp
     */
    val timestamp: Long = System.currentTimeMillis()
) {
    /**
     * Memory usage percentage (0-1)
     */
    val memoryUsagePercent: Float
        get() = if (maxMemoryMB > 0) memoryUsageMB / maxMemoryMB else 0f

    /**
     * Check if FPS is healthy (>= 55)
     */
    val isFpsHealthy: Boolean
        get() = fps >= 55f

    /**
     * Check if memory usage is healthy (< 80%)
     */
    val isMemoryHealthy: Boolean
        get() = memoryUsagePercent < 0.8f

    /**
     * Check if CPU usage is healthy (< 70%)
     */
    val isCpuHealthy: Boolean
        get() = cpuUsage < 70f

    /**
     * Overall health status
     */
    val isHealthy: Boolean
        get() = isFpsHealthy && isMemoryHealthy && isCpuHealthy

    /**
     * Thermal state description
     */
    val thermalStateDescription: String
        get() = when (thermalState) {
            0 -> "None"
            1 -> "Light"
            2 -> "Moderate"
            3 -> "Severe"
            4 -> "Critical"
            else -> "Unknown"
        }
}
