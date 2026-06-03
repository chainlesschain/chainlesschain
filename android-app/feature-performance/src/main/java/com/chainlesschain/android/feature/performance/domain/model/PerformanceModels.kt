package com.chainlesschain.android.feature.performance.domain.model

import kotlinx.serialization.Serializable

/**
 * Performance metrics
 */
@Serializable
data class PerformanceMetrics(
    val timestamp: Long = System.currentTimeMillis(),
    val cpu: CpuMetrics? = null,
    val memory: MemoryMetrics? = null,
    val network: NetworkMetrics? = null,
    val database: DatabaseMetrics? = null,
    val ai: AIMetrics? = null
)

/**
 * CPU metrics
 */
@Serializable
data class CpuMetrics(
    val usagePercent: Float,
    val coreCount: Int,
    val frequency: Long? = null
)

/**
 * Memory metrics
 */
@Serializable
data class MemoryMetrics(
    val usedBytes: Long,
    val totalBytes: Long,
    val availableBytes: Long,
    val heapUsedBytes: Long? = null,
    val heapMaxBytes: Long? = null
) {
    val usagePercent: Float
        get() = (usedBytes.toFloat() / totalBytes) * 100
}

/**
 * Network metrics
 */
@Serializable
data class NetworkMetrics(
    val bytesSent: Long,
    val bytesReceived: Long,
    val requestCount: Int,
    val averageLatencyMs: Long,
    val errorCount: Int
)

/**
 * Database metrics
 */
@Serializable
data class DatabaseMetrics(
    val sizeBytes: Long,
    val queryCount: Int,
    val averageQueryTimeMs: Long,
    val slowQueryCount: Int,
    val cacheHitRate: Float
)

/**
 * AI/LLM metrics
 */
@Serializable
data class AIMetrics(
    val requestCount: Int,
    val totalTokensUsed: Long,
    val inputTokens: Long,
    val outputTokens: Long,
    val averageLatencyMs: Long,
    val estimatedCost: Double? = null,
    val cacheHitRate: Float? = null
)

/**
 * Operation trace for profiling
 */
@Serializable
data class OperationTrace(
    val id: String,
    val name: String,
    val category: TraceCategory,
    val startTime: Long,
    val endTime: Long? = null,
    val durationMs: Long? = null,
    val parentId: String? = null,
    val metadata: Map<String, String> = emptyMap(),
    val status: TraceStatus = TraceStatus.RUNNING
) {
    val actualDuration: Long
        get() = durationMs ?: (endTime?.minus(startTime) ?: 0)
}

/**
 * Trace categories
 */
@Serializable
enum class TraceCategory {
    DATABASE,
    NETWORK,
    AI,
    UI,
    CRYPTO,
    FILE_IO,
    COMPUTATION,
    OTHER
}

/**
 * Trace status
 */
@Serializable
enum class TraceStatus {
    RUNNING,
    COMPLETED,
    FAILED,
    CANCELLED
}

/**
 * Cache statistics
 */
@Serializable
data class CacheStatistics(
    val name: String,
    val size: Int,
    val maxSize: Int,
    val hitCount: Long,
    val missCount: Long,
    val evictionCount: Long,
    val memoryUsageBytes: Long? = null
) {
    val hitRate: Float
        get() = if (hitCount + missCount > 0) {
            hitCount.toFloat() / (hitCount + missCount)
        } else 0f

    val fillRate: Float
        get() = if (maxSize > 0) size.toFloat() / maxSize else 0f
}

/**
 * Performance alert
 */
@Serializable
data class PerformanceAlert(
    val id: String,
    val type: AlertType,
    val severity: AlertSeverity,
    val message: String,
    val metric: String,
    val currentValue: Double,
    val threshold: Double,
    val timestamp: Long = System.currentTimeMillis(),
    val acknowledged: Boolean = false
)

/**
 * Alert types
 */
@Serializable
enum class AlertType {
    HIGH_MEMORY,
    HIGH_CPU,
    SLOW_QUERY,
    NETWORK_ERROR,
    AI_RATE_LIMIT,
    CACHE_FULL,
    LOW_STORAGE
}

/**
 * Alert severity
 */
@Serializable
enum class AlertSeverity {
    INFO,
    WARNING,
    ERROR,
    CRITICAL
}

/**
 * Performance snapshot
 */
@Serializable
data class PerformanceSnapshot(
    val id: String,
    val timestamp: Long = System.currentTimeMillis(),
    val metrics: PerformanceMetrics,
    val caches: List<CacheStatistics> = emptyList(),
    val activeTraces: Int = 0,
    val alerts: List<PerformanceAlert> = emptyList()
)
